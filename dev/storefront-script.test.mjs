import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPTS = [
    ['src/main.js', path.join(ROOT, 'Resources/app/storefront/src/main.js')],
    ['dist/review-forest.js', path.join(ROOT, 'Resources/app/storefront/dist/storefront/js/review-forest/review-forest.js')],
];

/** Minimal DOM/window harness to exercise storefront JS behavior without a browser. */
function makeElement(tag, attrs = {}) {
    const listeners = new Map();
    const el = {
        tagName: tag.toUpperCase(),
        nodeType: 1,
        attributes: { ...attrs },
        children: [],
        parentElement: null,
        hidden: Boolean(attrs.hidden),
        checked: Boolean(attrs.checked),
        disabled: false,
        value: attrs.value ?? '',
        textContent: attrs.textContent ?? '',
        className: attrs.class ?? '',
        style: {
            _props: new Map(),
            getPropertyValue(k) {
                return this._props.get(k)?.value ?? '';
            },
            getPropertyPriority(k) {
                return this._props.get(k)?.priority ?? '';
            },
            setProperty(k, v, p = '') {
                this._props.set(k, { value: v, priority: p });
                if (k === 'display') this.display = v;
            },
            removeProperty(k) {
                this._props.delete(k);
                if (k === 'display') this.display = '';
            },
            display: '',
        },
        elements: {},
        get firstChild() {
            return this.children[0] ?? null;
        },
        appendChild(child) {
            child.parentElement = this;
            this.children.push(child);
            if (child.tagName === 'INPUT' && child.attributes.name) {
                this.elements[child.attributes.name] = child;
            }
            return child;
        },
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx >= 0) this.children.splice(idx, 1);
            child.parentElement = null;
            return child;
        },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
            if (name === 'name' && this.parentElement) this.parentElement.elements[value] = this;
        },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        dispatch(type, event = {}) {
            event.preventDefault ??= () => {
                event.defaultPrevented = true;
            };
            for (const fn of listeners.get(type) ?? []) fn(event);
            return event;
        },
        matches(sel) {
            if (sel === '.card-body') return this.className.split(/\s+/).includes('card-body');
            if (sel === '.reviewforest-tree-result') return this.className.split(/\s+/).includes('reviewforest-tree-result');
            if (sel === 'button') return this.tagName === 'BUTTON';
            if (sel === 'button[type="submit"]') return this.tagName === 'BUTTON' && this.attributes.type === 'submit';
            if (sel === 'input[name="treeChoice"][value="dedication"]') {
                return this.tagName === 'INPUT' && this.attributes.name === 'treeChoice' && this.value === 'dedication';
            }
            if (sel === 'input[name="treeChoice"]:checked') {
                return this.tagName === 'INPUT' && this.attributes.name === 'treeChoice' && this.checked;
            }
            const attrMatch = /^\[([a-z0-9-]+)\]$/i.exec(sel);
            if (attrMatch) return Object.prototype.hasOwnProperty.call(this.attributes, attrMatch[1]);
            return false;
        },
        closest(sel) {
            let cur = this;
            while (cur) {
                if (cur.matches(sel)) return cur;
                cur = cur.parentElement;
            }
            return null;
        },
        querySelectorAll(sel) {
            const out = [];
            const visit = (node) => {
                for (const child of node.children) {
                    if (child.matches(sel)) out.push(child);
                    visit(child);
                }
            };
            visit(this);
            return out;
        },
        querySelector(sel) {
            return this.querySelectorAll(sel)[0] ?? null;
        },
        submit() {
            this.submitted = true;
        },
    };
    return el;
}

function makeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        _map: map,
    };
}

function runScript(code, { root, storage, fetchImpl, cookie = '', pathname = '/checkout/finish' }) {
    const docListeners = new Map();
    const winListeners = new Map();
    const head = makeElement('head');
    const document = {
        readyState: 'complete',
        cookie,
        head,
        body: root,
        getElementById(id) {
            const find = (node) => {
                if (node.attributes.id === id) return node;
                for (const c of node.children) {
                    const hit = find(c);
                    if (hit) return hit;
                }
                return null;
            };
            return find(root);
        },
        querySelectorAll: (sel) => root.querySelectorAll(sel),
        querySelector: (sel) => root.querySelector(sel),
        getElementsByTagName: (tag) => root.querySelectorAll(tag.toLowerCase()),
        createElement: (tag) => makeElement(tag),
        addEventListener(type, fn) {
            if (!docListeners.has(type)) docListeners.set(type, []);
            docListeners.get(type).push(fn);
        },
        dispatch(type, event = {}) {
            for (const fn of docListeners.get(type) ?? []) fn(event);
        },
    };
    const window = {
        document,
        location: { pathname },
        sessionStorage: storage,
        fetch: fetchImpl,
        console: { warn: () => {} },
        addEventListener(type, fn) {
            if (!winListeners.has(type)) winListeners.set(type, []);
            winListeners.get(type).push(fn);
        },
        dispatch(type, event = {}) {
            for (const fn of winListeners.get(type) ?? []) fn(event);
        },
    };
    const sandbox = { window, document, Number, Date, JSON, Math, String, Boolean, Error, Array, Object, console };
    vm.runInNewContext(code, sandbox);
    return { window, document };
}

function buildConfirmDom(cartTotal = '19.9', cartItems = 'prod-a:1') {
    const root = makeElement('body');
    const form = makeElement('form', { id: 'confirmOrderForm', action: '/checkout/order' });
    const wrapper = makeElement('div', {
        'data-reviewforest-checkbox': '',
        'data-cart-total': cartTotal,
        'data-cart-items': cartItems,
    });
    const input = makeElement('input', { type: 'checkbox', 'data-reviewforest-checkbox-input': '' });
    wrapper.appendChild(input);
    form.appendChild(wrapper);
    root.appendChild(form);
    return { root, form, wrapper, input };
}

function buildFinishCheckboxDom({
    orderTotal = '19.90',
    orderItems = 'prod-a:1',
    orderCreatedSec = Math.floor(Date.now() / 1000),
    fallbackEligible = '1',
} = {}) {
    const root = makeElement('body');
    const container = makeElement('div', {
        class: 'reviewforest-consent card checkout-card border',
        hidden: true,
        'data-reviewforest-consent': '',
        'data-order-created': String(orderCreatedSec),
        'data-order-total': orderTotal,
        'data-order-items': orderItems,
        'data-fallback-eligible': fallbackEligible,
        'data-thanks-yes': 'Danke!',
        'data-thanks-no': 'Alles klar.',
        'data-withdrawn': 'Widerrufen.',
        'data-withdraw-label': 'Einwilligung widerrufen',
    });
    const body = makeElement('div', { class: 'card-body' });
    const submitForm = makeElement('form', { action: '/storefront/script/reviewforest-consent', hidden: true, 'data-reviewforest-checkbox-submit': '' });
    submitForm.appendChild(makeElement('input', { name: 'orderId', value: '0'.repeat(32) }));
    submitForm.appendChild(makeElement('input', { name: 'deepLinkCode', value: 'x'.repeat(32) }));
    submitForm.appendChild(makeElement('input', { name: 'source', value: 'checkout_checkbox' }));

    const fallbackForm = makeElement('form', {
        action: '/storefront/script/reviewforest-consent',
        hidden: true,
        'data-reviewforest-consent-form': '',
        'data-reviewforest-checkbox-fallback': '',
    });
    fallbackForm.appendChild(makeElement('input', { name: 'orderId', value: '0'.repeat(32) }));
    fallbackForm.appendChild(makeElement('input', { name: 'deepLinkCode', value: 'x'.repeat(32) }));
    fallbackForm.appendChild(makeElement('input', { name: 'source', value: 'finish_dialog' }));
    fallbackForm.appendChild(makeElement('button', { type: 'submit', name: 'consent', value: 'yes' }));
    fallbackForm.appendChild(makeElement('button', { type: 'submit', name: 'consent', value: 'no' }));

    body.appendChild(submitForm);
    body.appendChild(fallbackForm);
    container.appendChild(body);
    root.appendChild(container);
    return { root, container, body, submitForm, fallbackForm };
}

for (const [label, scriptPath] of SCRIPTS) {
    const code = fs.readFileSync(scriptPath, 'utf8');

    test(`[${label}] checkout checkbox saves on change (JS payment button without form submit) and matches 19.9 vs 19.90`, async () => {
        const storage = makeStorage();
        const confirmDom = buildConfirmDom('19.9');
        runScript(code, { root: confirmDom.root, storage });

        // Buyer ticks checkbox and pays via PayPal Smart Button (no native form submit!).
        confirmDom.input.checked = true;
        confirmDom.input.dispatch('change');

        const posts = [];
        const finishDom = buildFinishCheckboxDom({ orderTotal: '19.90' });
        runScript(code, {
            root: finishDom.root,
            storage,
            fetchImpl: async (url, init) => {
                posts.push({ url, body: JSON.parse(init.body) });
                return { ok: true, json: async () => ({ success: true, consent: 'yes' }) };
            },
        });
        await new Promise((r) => setImmediate(r));

        assert.equal(posts.length, 1);
        assert.deepEqual(posts[0].body, {
            orderId: '0'.repeat(32),
            deepLinkCode: 'x'.repeat(32),
            source: 'checkout_checkbox',
            consent: 'yes',
        });
        assert.equal(finishDom.container.hidden, false);
        assert.equal(storage.getItem('reviewforest-checkout-consent'), null);
        // Thank-you message + withdraw button rendered
        assert.ok(finishDom.body.querySelector('button')?.textContent === 'Einwilligung widerrufen');
    });

    test(`[${label}] untouched checkbox on /checkout/confirm records "no" even via JS payment button and keeps finish hidden`, async () => {
        const storage = makeStorage();
        const confirmDom = buildConfirmDom('29.99');
        runScript(code, { root: confirmDom.root, storage });
        // No change, no submit — buyer clicked JS payment button directly on /checkout/confirm.
        const posts = [];
        const finishDom = buildFinishCheckboxDom({ orderTotal: '30.00' }); // 1-cent rounding tolerance
        runScript(code, {
            root: finishDom.root,
            storage,
            fetchImpl: async (url, init) => {
                posts.push({ url, body: JSON.parse(init.body) });
                return { ok: true, json: async () => ({ success: true, consent: 'no' }) };
            },
        });
        await new Promise((r) => setImmediate(r));

        assert.equal(posts.length, 1);
        assert.equal(posts[0].body.consent, 'no');
        assert.equal(posts[0].body.source, 'checkout_checkbox');
        assert.equal(finishDom.container.hidden, true);
        assert.equal(finishDom.fallbackForm.hidden, true);
    });

    test(`[${label}] Express Checkout (no confirm page visit -> empty storage) reveals fallback question and submits as finish_dialog`, async () => {
        const storage = makeStorage();
        const posts = [];
        const finishDom = buildFinishCheckboxDom({ orderTotal: '49.95' });
        runScript(code, {
            root: finishDom.root,
            storage,
            fetchImpl: async (url, init) => {
                posts.push({ url, body: JSON.parse(init.body) });
                return { ok: true, json: async () => ({ success: true, consent: 'yes' }) };
            },
        });

        assert.equal(posts.length, 0);
        assert.equal(finishDom.container.hidden, false);
        assert.equal(finishDom.fallbackForm.hidden, false);

        // Buyer answers "Yes" on the revealed fallback form.
        finishDom.fallbackForm.dispatch('submit', { submitter: { value: 'yes' } });
        await new Promise((r) => setImmediate(r));

        assert.equal(posts.length, 1);
        assert.equal(posts[0].body.source, 'finish_dialog');
        assert.equal(posts[0].body.consent, 'yes');
    });

    test(`[${label}] mismatched cart total (different checkout) ignores stale answer and reveals fallback`, () => {
        const storage = makeStorage();
        const confirmDom = buildConfirmDom('19.99');
        runScript(code, { root: confirmDom.root, storage });
        confirmDom.input.checked = true;
        confirmDom.input.dispatch('change');

        const posts = [];
        const finishDom = buildFinishCheckboxDom({ orderTotal: '49.99' });
        runScript(code, {
            root: finishDom.root,
            storage,
            fetchImpl: async (url, init) => {
                posts.push({ url, body: JSON.parse(init.body) });
                return { ok: true, json: async () => ({ success: true, consent: 'yes' }) };
            },
        });

        assert.equal(posts.length, 0);
        assert.equal(finishDom.container.hidden, false);
        assert.equal(finishDom.fallbackForm.hidden, false);
    });

    test(`[${label}] revisiting an old order (server data-fallback-eligible=0) does not reveal fallback`, () => {
        const storage = makeStorage();
        const oldCreated = Math.floor((Date.now() - 3 * 60 * 60 * 1000) / 1000);
        const finishDom = buildFinishCheckboxDom({
            orderTotal: '49.95',
            orderCreatedSec: oldCreated,
            fallbackEligible: '0',
        });
        runScript(code, { root: finishDom.root, storage, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });

        assert.equal(finishDom.container.hidden, true);
        assert.equal(finishDom.fallbackForm.hidden, true);
    });

    test(`[${label}] device clock skewed >2h ahead still reveals fallback when server says data-fallback-eligible=1`, () => {
        const storage = makeStorage();
        const skewedOrderCreated = Math.floor((Date.now() - 5 * 60 * 60 * 1000) / 1000);
        const finishDom = buildFinishCheckboxDom({
            orderTotal: '49.95',
            orderCreatedSec: skewedOrderCreated,
            fallbackEligible: '1',
        });
        runScript(code, { root: finishDom.root, storage, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });

        assert.equal(finishDom.container.hidden, false);
        assert.equal(finishDom.fallbackForm.hidden, false);
    });

    test(`[${label}] abandoning /checkout/confirm to another shop page clears stored consent before a same-total express order`, () => {
        const storage = makeStorage();
        const confirmDom = buildConfirmDom('19.90', 'prod-a:1');
        runScript(code, { root: confirmDom.root, storage, pathname: '/checkout/confirm' });
        confirmDom.input.checked = true;
        confirmDom.input.dispatch('change');
        assert.ok(storage.getItem('reviewforest-checkout-consent'));

        // Buyer leaves /checkout/confirm back to /checkout/cart (abandoned checkout).
        runScript(code, { root: makeElement('body'), storage, pathname: '/checkout/cart' });
        assert.equal(storage.getItem('reviewforest-checkout-consent'), null);

        // Even a same-total, same-item Express order now asks cleanly via the fallback question.
        const posts = [];
        const finishDom = buildFinishCheckboxDom({ orderTotal: '19.90', orderItems: 'prod-a:1' });
        runScript(code, {
            root: finishDom.root,
            storage,
            pathname: '/checkout/finish',
            fetchImpl: async (url, init) => {
                posts.push({ url, body: JSON.parse(init.body) });
                return { ok: true, json: async () => ({ success: true, consent: 'yes' }) };
            },
        });
        assert.equal(posts.length, 0);
        assert.equal(finishDom.container.hidden, false);
        assert.equal(finishDom.fallbackForm.hidden, false);
    });

    test(`[${label}] same total but different product items rejects stale checkbox answer and reveals fallback`, () => {
        const storage = makeStorage();
        const confirmDom = buildConfirmDom('19.90', 'prod-a:1');
        runScript(code, { root: confirmDom.root, storage, pathname: '/checkout/confirm' });
        confirmDom.input.checked = true;
        confirmDom.input.dispatch('change');

        const posts = [];
        const finishDom = buildFinishCheckboxDom({ orderTotal: '19.90', orderItems: 'prod-b:1' });
        runScript(code, {
            root: finishDom.root,
            storage,
            pathname: '/checkout/finish',
            fetchImpl: async (url, init) => {
                posts.push({ url, body: JSON.parse(init.body) });
                return { ok: true, json: async () => ({ success: true, consent: 'yes' }) };
            },
        });
        assert.equal(posts.length, 0);
        assert.equal(finishDom.container.hidden, false);
        assert.equal(finishDom.fallbackForm.hidden, false);
    });

    test(`[${label}] tree dedication input updates live character counter and selects dedication radio`, () => {
        const root = makeElement('body');
        const container = makeElement('div', { 'data-reviewforest-tree': '' });
        const form = makeElement('form', { 'data-reviewforest-tree-form': '', action: '/storefront/script/reviewforest-tree' });
        const radio = makeElement('input', { type: 'radio', name: 'treeChoice', value: 'dedication' });
        const input = makeElement('input', { type: 'text', name: 'dedication', maxlength: '40', value: '' });
        const counter = makeElement('small', { 'data-reviewforest-tree-counter': '' });
        const result = makeElement('span', { class: 'reviewforest-tree-result' });
        form.appendChild(radio);
        form.appendChild(input);
        form.appendChild(counter);
        form.appendChild(result);
        container.appendChild(form);
        root.appendChild(container);

        runScript(code, { root, storage: makeStorage() });
        assert.equal(counter.textContent, '0 / 40');
        assert.equal(radio.checked, false);

        input.value = 'Für Oma Erna';
        input.dispatch('input');
        assert.equal(counter.textContent, '12 / 40');
        assert.equal(radio.checked, true);
    });
}
