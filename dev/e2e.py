#!/usr/bin/env python3
"""
End-to-end test of the ReviewForest app against a local dockware shop and the local ReviewForest API.

    python3 dev/e2e.py --port 8067          # Shopware 6.7 (dev/docker-compose.yml, service sw67)
    python3 dev/e2e.py --port 8066          # Shopware 6.6 (service sw66, profile sw66)

Prerequisites (see README): containers running, app installed with dev/sync-app.sh and configured for the
sales channel (API key and forest from dev/seed-api.js, invitations on, trigger "shipped"), API running
with apps/api/.env from dev/api.env.example, mongosh on the PATH.

What it checks, as a buyer and as the merchant would do it:
  1. widget placeholders and the loader on home, category, product and cart; none on account pages
  2. guest order, consent "yes" through the app's storefront script, stored on the order
  3. delivery shipped -> invitation scheduled with the configured delay, status written to the order
  4. order cancelled -> invitation cancelled
  5. second order with consent "no" -> shipped -> nothing scheduled; a no cannot become a yes
  6. yes, shipped, then withdrawn on the finish page -> the invitation is skipped at due time
  7. tree per order: the buyer names the tree on the finish page, shipped adds it, a cancelled order cancels
     it, and the daily run checks the order against the shop and reports back. Locally the run stops in the
     billing code (no Stripe products in the dev database), so it ends "failed: order_rejected".
     The tree card links to the Bewertungswald (the API redirects the forest ID to the forest page), and a
     planted order links to its tree.
Only standard library; the dockware admin login admin/shopware is the image's default for local shops.
"""
import argparse
import calendar
import http.cookiejar
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid

MONGO = 'mongodb://localhost:27019/rf_shopware_dev?replicaSet=rs0&directConnection=true'
CONTAINER = {8067: 'reviewforest-shopware-dev-sw67-1', 8066: 'reviewforest-shopware-dev-sw66-1'}
# The shops reach the local API as host.docker.internal:3000; this script runs on the host.
API = 'http://localhost:3000'
results = []


def check(name, ok, detail=''):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


class Storefront:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def get(self, path):
        with self.opener.open(self.base + path) as response:
            return response.geturl(), response.read().decode('utf-8', 'replace')

    def post_form(self, path, fields):
        data = urllib.parse.urlencode(fields).encode()
        with self.opener.open(urllib.request.Request(self.base + path, data=data, method='POST')) as response:
            return response.geturl(), response.read().decode('utf-8', 'replace')

    def post_json(self, path, payload):
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(payload).encode(),
            method='POST',
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        )
        try:
            with self.opener.open(request) as response:
                return response.status, json.loads(response.read() or b'{}')
        except urllib.error.HTTPError as error:
            return error.code, {}


class Admin:
    def __init__(self, base):
        self.base = base
        token = self.request('POST', '/api/oauth/token', {
            'grant_type': 'password', 'client_id': 'administration', 'username': 'admin', 'password': 'shopware', 'scopes': 'write',
        }, auth=False)
        self.token = token['access_token']

    def request(self, method, path, body=None, auth=True):
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
        if auth:
            headers['Authorization'] = f'Bearer {self.token}'
        request = urllib.request.Request(self.base + path, data=json.dumps(body or {}).encode(), method=method, headers=headers)
        with urllib.request.urlopen(request) as response:
            text = response.read()
            return json.loads(text) if text else {}

    def search(self, entity, criteria):
        return self.request('POST', f'/api/search/{entity}', criteria).get('data', [])


def mongo(js):
    out = subprocess.run(['mongosh', '--quiet', MONGO, '--eval', js], capture_output=True, text=True, check=True)
    return out.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def api_get(path):
    """GET on the local API without following redirects: (status, Location header)."""
    try:
        with urllib.request.build_opener(NoRedirect).open(API + path) as response:
            return response.status, response.headers.get('Location')
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get('Location')


def consume_queue(port):
    # dockware runs no message consumer; webhooks and flow actions are dispatched through the queue.
    subprocess.run(['docker', 'exec', CONTAINER[port], 'bash', '-lc',
                    'cd /var/www/html && php bin/console messenger:consume async low_priority --time-limit=10 -q'],
                   capture_output=True)


def wait_for(fn, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(1)
    return fn()


def widget_count(html):
    return len(set(re.findall(r'reviewforest-app-([A-Za-z0-9-]+)', html)))


def place_guest_order(shop, product_id, email):
    shop.post_form('/checkout/line-item/add', {
        f'lineItems[{product_id}][id]': product_id,
        f'lineItems[{product_id}][type]': 'product',
        f'lineItems[{product_id}][referencedId]': product_id,
        f'lineItems[{product_id}][quantity]': '1',
        'redirectTo': 'frontend.cart.offcanvas',
    })
    url, html = shop.get('/checkout/register')
    if '/checkout/register' in url:
        form = re.search(r'<form[^>]*action="/account/register"[^>]*>(.*?)</form>', html, re.S).group(1)
        fields = dict(re.findall(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', form))
        country = re.search(r'<option[^>]*value="([0-9a-f]{32})"[^>]*>\s*(?:Germany|Deutschland)', form)
        uses_billing_names = 'billingAddress[firstName]' in form
        names = ('billingAddress[firstName]', 'billingAddress[lastName]') if uses_billing_names else ('firstName', 'lastName')
        fields.update({
            names[0]: 'E2E', names[1]: 'Testkauf', 'email': email, 'guest': '1',
            'billingAddress[street]': 'Teststrasse 9', 'billingAddress[zipcode]': '10115', 'billingAddress[city]': 'Berlin',
            'billingAddress[countryId]': country.group(1) if country else '',
        })
        shop.post_form('/account/register', fields)
    url, html = shop.get('/checkout/confirm')
    form = re.search(r'<form[^>]*id="confirmOrderForm"[^>]*>(.*?)</form>', html, re.S)
    fields = dict(re.findall(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', form.group(1) if form else ''))
    fields['tos'] = 'on'
    url, html = shop.post_form('/checkout/order', fields)
    order_id = re.search(r'orderId=([0-9a-f]{32})', url)
    return order_id.group(1) if order_id else None, html


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8067)
    args = parser.parse_args()
    base = f'http://localhost:{args.port}'
    shop, admin = Storefront(base), Admin(base)

    config = admin.request('GET', '/api/_action/system-config?domain=ReviewForest.config')
    delay_days = int(config.get('ReviewForest.config.delayDays') or 7)
    product = admin.search('product', {'filter': [{'type': 'equals', 'field': 'parentId', 'value': None}], 'limit': 1})[0]
    category = admin.search('category', {'filter': [{'type': 'equals', 'field': 'level', 'value': 2}], 'limit': 1})[0]

    # 1. widgets
    for label, page in [('home', '/'), ('category', f"/navigation/{category['id']}"), ('product', f"/detail/{product['id']}"), ('cart', '/checkout/cart')]:
        _, html = shop.get(page)
        check(f'widgets on {label}', widget_count(html) >= 1 and 'widgets.reviewforest.org/main.js' in html, f'{widget_count(html)} placeholders')
    _, html = shop.get('/account/login')
    check('no widget script on account pages', widget_count(html) == 0 and 'widgets.reviewforest.org' not in html)

    # 2. order with consent yes
    run = uuid.uuid4().hex[:8]
    order_id, finish_html = place_guest_order(shop, product['id'], f'e2e-yes-{run}@example.com')
    check('guest order placed', bool(order_id))
    check('consent question shown on the order confirmation page', 'data-reviewforest-consent-form' in finish_html)
    deep_link = re.search(r'name="deepLinkCode" value="([^"]+)"', finish_html)
    deep_link = deep_link.group(1) if deep_link else ''
    check('order token rendered for the buyer', len(deep_link) >= 20)
    status, _ = shop.post_json('/storefront/script/reviewforest-consent', {'orderId': order_id, 'source': 'finish_dialog', 'consent': 'yes'})
    check('consent without the order token is rejected', status == 400, f'HTTP {status}')
    status, answer = shop.post_json('/storefront/script/reviewforest-consent',
                                    {'orderId': order_id, 'deepLinkCode': deep_link, 'source': 'finish_dialog', 'consent': 'yes'})
    check('consent endpoint accepts the buyer', status == 200 and answer.get('consent') == 'yes', f'HTTP {status}')
    order = admin.search('order', {'ids': [order_id], 'associations': {'deliveries': {}}})[0]
    custom = order.get('customFields') or {}
    check('consent stored on the order', custom.get('reviewforest_consent') == 'yes' and str(custom.get('reviewforest_consent_text', '')).startswith('rf-'),
          json.dumps({k: v for k, v in custom.items() if k.startswith('reviewforest')}))
    stranger = Storefront(base)
    status, _ = stranger.post_json('/storefront/script/reviewforest-consent',
                                   {'orderId': order_id, 'deepLinkCode': 'x' * 32, 'source': 'finish_dialog', 'consent': 'no'})
    check('another visitor cannot answer for this order', status in (403, 404), f'HTTP {status}')

    # 3. shipped -> scheduled
    delivery_id = order['deliveries'][0]['id']
    admin.request('POST', f'/api/_action/order_delivery/{delivery_id}/state/ship')
    consume_queue(args.port)
    job = wait_for(lambda: json.loads(mongo(f"JSON.stringify(db.invitationJobs.findOne({{externalRef: /{order_id}/}}, {{status: 1, dueAt: 1, createdAt: 1}}))") or 'null'))
    if job:
        # UTC timestamps: a local-time difference would be off by an hour across a daylight saving change.
        days = (calendar.timegm(time.strptime(job['dueAt'][:19], '%Y-%m-%dT%H:%M:%S')) - calendar.timegm(time.strptime(job['createdAt'][:19], '%Y-%m-%dT%H:%M:%S'))) / 86400
        check('shipped schedules one invitation', job['status'] == 'scheduled' and abs(days - delay_days) < 0.01, f'due in {days:.2f} days')
    else:
        check('shipped schedules one invitation', False, 'no job')
    status_field = wait_for(lambda: (admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}).get('reviewforest_invitation_status'))
    custom = admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}
    check('invitation status written to the order', status_field == 'scheduled' and bool(custom.get('reviewforest_invitation_date')), json.dumps(custom))
    subject = mongo(f"db.invitationJobs.findOne({{externalRef: /{order_id}/}}).payload.subject")
    check('the invitation subject names the shop', subject.startswith(('Ihre Bewertung für ', 'Deine Bewertung für ', 'Your review for ')), subject)

    # 4. cancelled -> cancelled
    admin.request('POST', f'/api/_action/order/{order_id}/state/cancel')
    consume_queue(args.port)
    cancelled = wait_for(lambda: mongo(f"db.invitationJobs.findOne({{externalRef: /{order_id}/}}).status") == 'cancelled')
    check('cancelling the order cancels the invitation', bool(cancelled))

    # 5. consent no -> nothing scheduled; a no cannot be turned into a yes
    order_id, finish_html = place_guest_order(shop, product['id'], f'e2e-no-{run}@example.com')
    deep_link = re.search(r'name="deepLinkCode" value="([^"]+)"', finish_html).group(1)
    shop.post_json('/storefront/script/reviewforest-consent', {'orderId': order_id, 'deepLinkCode': deep_link, 'source': 'finish_dialog', 'consent': 'no'})
    _, again = shop.post_json('/storefront/script/reviewforest-consent', {'orderId': order_id, 'deepLinkCode': deep_link, 'source': 'finish_dialog', 'consent': 'yes'})
    check('a no stays a no', again.get('consent') == 'no')
    order = admin.search('order', {'ids': [order_id], 'associations': {'deliveries': {}}})[0]
    admin.request('POST', f"/api/_action/order_delivery/{order['deliveries'][0]['id']}/state/ship")
    consume_queue(args.port)
    status_field = wait_for(lambda: (admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}).get('reviewforest_invitation_status'))
    jobs = int(mongo(f"db.invitationJobs.countDocuments({{externalRef: /{order_id}/}})"))
    reason = (admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}).get('reviewforest_invitation_reason')
    check('no consent schedules nothing', jobs == 0 and status_field == 'not_scheduled' and reason == 'no_consent', f'{status_field} {reason}')

    # 6. withdrawal: yes, then withdrawn -> the waiting invitation is skipped at due time
    order_id, finish_html = place_guest_order(shop, product['id'], f'e2e-withdraw-{run}@example.com')
    deep_link = re.search(r'name="deepLinkCode" value="([^"]+)"', finish_html).group(1)
    shop.post_json('/storefront/script/reviewforest-consent', {'orderId': order_id, 'deepLinkCode': deep_link, 'source': 'finish_dialog', 'consent': 'yes'})
    _, html = shop.get(f'/checkout/finish?orderId={order_id}')
    check('withdraw option shown after yes', 'name="source" value="withdrawal"' in html)
    order = admin.search('order', {'ids': [order_id], 'associations': {'deliveries': {}}})[0]
    admin.request('POST', f"/api/_action/order_delivery/{order['deliveries'][0]['id']}/state/ship")
    consume_queue(args.port)
    wait_for(lambda: mongo(f"db.invitationJobs.countDocuments({{externalRef: /{order_id}/, status: 'scheduled'}})") == '1')
    _, answer = shop.post_json('/storefront/script/reviewforest-consent', {'orderId': order_id, 'deepLinkCode': deep_link, 'source': 'withdrawal', 'consent': 'no'})
    custom = admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}
    check('withdrawal stored on the order', answer.get('consent') == 'no' and custom.get('reviewforest_consent') == 'no' and bool(custom.get('reviewforest_consent_withdrawn_at')))
    mongo(f"db.invitationJobs.updateOne({{externalRef: /{order_id}/, status: 'scheduled'}}, {{$set: {{dueAt: new Date()}}}})")
    skipped = wait_for(lambda: mongo(f"db.invitationJobs.findOne({{externalRef: /{order_id}/}}).statusReason") == 'no_consent', timeout=30)
    check('withdrawn consent skips the invitation at due time', bool(skipped))

    # 7. tree per order
    admin.request('POST', '/api/_action/system-config', {'ReviewForest.config.treePerOrderEnabled': True})
    order_id, finish_html = place_guest_order(shop, product['id'], f'e2e-tree-{run}@example.com')
    check('tree name question shown on the order confirmation page', 'data-reviewforest-tree-form' in finish_html)
    # RF-12251: the tree card links to the shop's Bewertungswald through the API, which redirects by forest ID.
    # The forest ID can be set per sales channel, so it is taken from the link and compared with a global value.
    link = re.search(r'<p class="reviewforest-tree-link[^"]*">\s*<a href="([^"]+)" target="_blank" rel="noopener">', finish_html)
    href = urllib.parse.urlsplit(link.group(1).replace('&amp;', '&')) if link else None
    path = re.fullmatch(r'/integrations/shopware/forest-page/([0-9a-fA-F]{24})', href.path) if href else None
    forest_id = path.group(1) if path else ''
    configured = str(config.get('ReviewForest.config.forestId') or '').strip()
    check('the tree card links to the Bewertungswald', bool(forest_id) and configured in ('', forest_id), link.group(1) if link else 'no link')
    if forest_id:
        status, location = api_get(f'{href.path}?{href.query}')
        slug = mongo(f"db.forests.findOne({{_id: ObjectId('{forest_id}')}})?.slug")
        target = urllib.parse.urlsplit(location or '')
        check('the API redirects the forest link to the forest page', status == 302 and target.path == f'/{slug}', f'HTTP {status} {location}')
    status, location = api_get('/integrations/shopware/forest-page/' + '0' * 24)
    check('an unknown forest gets no redirect', status == 404 and not location, f'HTTP {status} {location}')
    deep_link = re.search(r'name="deepLinkCode" value="([^"]+)"', finish_html).group(1)
    status, answer = shop.post_json('/storefront/script/reviewforest-tree', {'orderId': order_id, 'deepLinkCode': deep_link, 'treeChoice': 'initials'})
    check('initials are built from the order, not from the request', status == 200 and answer.get('name') == 'E. T.', f"HTTP {status} {answer}")
    status, answer = shop.post_json('/storefront/script/reviewforest-tree',
                                    {'orderId': order_id, 'deepLinkCode': deep_link, 'treeChoice': 'dedication', 'dedication': ' Für <b>Oma</b>\nErna ' + 'x' * 60})
    name = str(answer.get('name', ''))
    check('a dedication is one plain line of at most 40 characters', status == 200 and name.startswith('Für Oma Erna') and '<' not in name and len(name) <= 40, repr(name))
    status, _ = Storefront(base).post_json('/storefront/script/reviewforest-tree', {'orderId': order_id, 'deepLinkCode': 'x' * 32, 'treeChoice': 'name'})
    check('another visitor cannot name this tree', status in (403, 404), f'HTTP {status}')
    custom = admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}
    check('tree name stored on the order', custom.get('reviewforest_tree_choice') == 'dedication' and custom.get('reviewforest_tree_name') == name)
    order = admin.search('order', {'ids': [order_id], 'associations': {'deliveries': {}}})[0]
    admin.request('POST', f"/api/_action/order_delivery/{order['deliveries'][0]['id']}/state/ship")
    consume_queue(args.port)
    tree = wait_for(lambda: mongo(f"db.orderTrees.findOne({{externalRef: /{order_id}/}})?.status") == 'pending')
    tree_status = (admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}).get('reviewforest_tree_status')
    check('shipped adds one tree for the next daily run', bool(tree) and tree_status == 'pending', str(tree_status))
    admin.request('POST', f"/api/_action/order_delivery/{order['deliveries'][0]['id']}/state/ship")
    consume_queue(args.port)
    check('a repeated webhook adds no second tree', mongo(f"db.orderTrees.countDocuments({{externalRef: /{order_id}/}})") == '1')

    cancelled_id, _ = place_guest_order(shop, product['id'], f'e2e-tree-cancel-{run}@example.com')
    other = admin.search('order', {'ids': [cancelled_id], 'associations': {'deliveries': {}}})[0]
    admin.request('POST', f"/api/_action/order_delivery/{other['deliveries'][0]['id']}/state/ship")
    consume_queue(args.port)
    wait_for(lambda: mongo(f"db.orderTrees.findOne({{externalRef: /{cancelled_id}/}})?.status") == 'pending')
    admin.request('POST', f'/api/_action/order/{cancelled_id}/state/cancel')
    consume_queue(args.port)
    cancelled = wait_for(lambda: mongo(f"db.orderTrees.findOne({{externalRef: /{cancelled_id}/}})?.status") == 'cancelled')
    custom = wait_for(lambda: (lambda c: c if c.get('reviewforest_tree_status') == 'not_planted' else None)(
        admin.search('order', {'ids': [cancelled_id]})[0].get('customFields') or {}))
    check('a cancelled order cancels its waiting tree', bool(cancelled) and bool(custom) and custom.get('reviewforest_tree_reason') == 'order_cancelled',
          json.dumps(custom or {}))

    # The daily run takes trees from before today (UTC), once per forest and day, and never starts between
    # 23:00 and 24:00 UTC: move the tree to yesterday and forget earlier local runs, then the API's worker
    # picks it up within seconds (outside that last hour).
    mongo(f"db.orderTrees.updateOne({{externalRef: /{order_id}/}}, {{$set: {{createdAt: new Date(Date.now() - 864e5)}}}}); db.orderTreeRuns.deleteMany({{}})")
    final = wait_for(lambda: mongo(f"db.orderTrees.findOne({{externalRef: /{order_id}/}})?.status") in ('planted', 'failed', 'uncertain'), timeout=60)
    record = json.loads(mongo(f"JSON.stringify(db.orderTrees.findOne({{externalRef: /{order_id}/}}, {{status: 1, statusReason: 1}}))") or '{}')
    reported = wait_for(lambda: (admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}).get('reviewforest_tree_status') not in (None, 'pending'))
    tree_status = (admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}).get('reviewforest_tree_status')
    # 'order_rejected' means the shop check passed and the run reached the billing code, which stops locally
    # because the dev database has no Stripe products. With real Stripe test data the status is 'planted'.
    check('the daily run checks the order and reaches the billing call',
          record.get('status') == 'planted' or (record.get('status') == 'failed' and record.get('statusReason') == 'order_rejected'), json.dumps(record))
    check('the result of the daily run is written to the order', bool(reported), str(tree_status))
    # RF-12251: a planted tree gets its link on the order. Locally the run stops before billing (see above), so this
    # only runs with Stripe test data or the usability test's time machine.
    if record.get('status') == 'planted':
        unique_id = mongo(f"db.orderTrees.findOne({{externalRef: /{order_id}/}})?.treeUniqueId")
        tree_url = str((admin.search('order', {'ids': [order_id]})[0].get('customFields') or {}).get('reviewforest_tree_url') or '')
        check('a planted tree gets its link on the order', bool(unique_id) and tree_url.endswith(f'/?review={unique_id}'), tree_url)
    else:
        print('SKIP  a planted tree gets its link on the order (the local run did not plant)')
    # The confirmation page of a planted order links to the tree. The status is set by hand on a new order (the
    # finish page only opens for the session's latest guest), which stays open, so it gets no tree.
    planted_id, _ = place_guest_order(shop, product['id'], f'e2e-tree-link-{run}@example.com')
    tree_url = f'https://forest.example.test/shopware-dev/?review=e2e-{run}'
    admin.request('PATCH', f'/api/order/{planted_id}', {'customFields': {'reviewforest_tree_status': 'planted', 'reviewforest_tree_url': tree_url}})
    _, html = shop.get(f'/checkout/finish?orderId={planted_id}')
    check('the confirmation page of a planted order links to the tree', f'<a href="{tree_url}" target="_blank" rel="noopener">' in html)
    admin.request('POST', '/api/_action/system-config', {'ReviewForest.config.treePerOrderEnabled': False})

    failed = [name for name, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed on {base}")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
