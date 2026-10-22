# ReviewForest app for Shopware 6

Shopware app (app system, no PHP in the shop) for Shopware 6.6 and 6.7, including Shopware SaaS.

- **Widgets without code:** shows your ReviewForest widgets (floating badge, footer widget, more widget IDs) on every shop page, configurable per sales channel. Checkout and customer account pages stay free of the widget script unless you switch that on.
- **Cookie consent for the widgets:** by default the widget script loads only after the visitor allowed "ReviewForest" under comfort features in Shopware's cookie settings, right away and without a reload. Alternatively the widgets load always.
- **Review invitations after shipping:** a set number of days after shipping (or payment, or completion) the buyer gets one review invitation, but only if they agreed.
- **Consent:** either a question with "Yes, please" and "No, thanks" on the order confirmation page, or an unchecked checkbox in the checkout. Answer, time, source and text version are stored on the order.
- **Sender and replies (0.2.0):** the invitation comes from "<shop name> über ReviewForest" (German orders) or "<shop name> via ReviewForest", sent from noreply-invite@reviewforest.org. Replies go to the shop's email address from Settings > Basic information.
- **Consent copy (0.2.0):** when an invitation is scheduled, ReviewForest keeps its own copy of the consent record. If the record on the order is changed before sending, the invitation is not sent ("Consent record on the order was changed").
- **Tree per order (0.2.0):** every order that reaches the chosen state gets a tree in your Bewertungswald, ordered as additional trees once a day or, if you prefer one invoice a month, once a month. An optional monthly limit caps the trees per sales channel. Buyers choose on the order confirmation page whether the tree shows their name, their initials, a dedication or no name. The page links to your Bewertungswald, and a planted order gets the link to its tree ("Link zum Baum"), which you can send to the buyer.
- **Safety nets:** cancelled, returned or refunded orders cancel the waiting invitation and tree; status, reason and date of both are shown on the order in the admin language; Flow Builder action "Schedule review invitation" for your own rules.

The server side lives in the ReviewForest API (`/integrations/shopware/*`). This repository only contains what runs inside the shop.

## Settings (per sales channel)

| Setting | Meaning |
|---|---|
| ReviewForest API key | Read-write key from ReviewForest (Integrations, API). Needed for invitations and tree per order. |
| Forest ID | The Bewertungswald that receives this sales channel's invitations. |
| Test mode: no invitations, no trees | Off by default. For test and staging shops: buyers see the consent question and the tree choice as usual, but no invitation is sent and no tree is ordered, also none already scheduled, and nothing is made up later. Orders show the reason "Test mode: nothing sent" / "Test mode: no tree". |
| Widget IDs | The part after `reviewforest-app-` in the embed code, or the whole embed code. |
| When the widgets load | Only after consent in the cookie banner (default) or always. With consent, the app adds the entry "ReviewForest" (cookie `reviewforest-widgets`, 30 days) to the comfort features; Shopware's "Accept all cookies" button should be on. Shop owners with another consent tool call `ReviewForestWidgets.load()` from it. |
| Send review invitations | Off by default. |
| Start the delay when / Delay in days | Shipped, paid or completed, or only through your Flow Builder flows; 1 to 60 days (default: shipped, 7). |
| Style of the email | Formal or friendly. |
| How buyers agree | Question on the order confirmation page (default) or checkbox in the checkout. |
| Own consent text | Optional, German and English; `{shop}` is replaced by the shop name. |
| Do not invite these customer groups | For example B2B or marketplace customers. They are not asked for consent; tree per order still applies. |
| Plant a tree for every order | Off by default. Each tree is an additional tree at your price for additional trees. |
| Plant the tree when | Shipped, paid or completed (default: shipped). |
| Order and bill the trees | Once a day (default; usually one invoice per day with orders) or once a month: the trees of a calendar month (UTC) are ordered together at the start of the next month. |
| At most this many trees per month | Optional; empty or 0 means no limit. Counted per sales channel, for the calendar month (UTC) in which the trees are ordered. Orders beyond the limit get no tree (reason "Monthly limit reached"). |
| Let buyers name their tree | Name, initials, a dedication of at most 40 characters, or no name (default: on). |
| Occasion shown with the tree | Optional, at most 100 characters (default: "Für eine Bestellung" / "For an order"). |

## Development

The end-to-end setup needs a local copy of the ReviewForest API, which is not public. Building and validating the ZIPs (below) works without it.

Requirements: Docker, Node 24 and pnpm for the ReviewForest API, mongosh, Python 3.

```bash
docker compose -f dev/docker-compose.yml up -d mongo sw67                    # Shopware 6.7 on :8067
COMPOSE_PROFILES=sw66 docker compose -f dev/docker-compose.yml up -d sw66    # Shopware 6.6 on :8066
mongosh "mongodb://localhost:27019/rf_shopware_dev?replicaSet=rs0&directConnection=true" dev/seed-api.js
cp dev/api.env.example <api checkout>/apps/api/.env                          # then start the API on :3000
dev/sync-app.sh sw67                                                         # copy, install, compile theme
python3 dev/e2e.py --port 8067                                               # end-to-end checks
```

Configure the app in the shop admin (or with `bin/console system:config:set ReviewForest.config.<key> <value>`, with `--json` for switches such as `true`) with the API key and forest ID printed by the seed script. Admin login of the dockware images: admin / shopware.

The cookie consent logic of the storefront script has a test page without a shop: open `dev/widget-consent-test.html` in a browser (file:// works; add `?src=1` to test the source instead of the build). It simulates Shopware's `CookieConfiguration_Update` event and sends no requests.

Notes from the first run (October 2026):
- MongoDB 8 refuses to start on Docker Desktop's Linux kernel 7.0.12 (SERVER-121912), so the dev setup uses MongoDB 7.
- Shopware 6.6.10+ only lets apps call public HTTPS targets; `dev/sync-app.sh` allows the Docker host for the local API.
- dockware runs no message consumer; webhooks and flow actions wait in the queue until `messenger:consume` runs (the e2e script does that).
- The link to the Bewertungswald on the order confirmation page points to the API under the Docker host name of the development manifest, which a browser on the host cannot open; the e2e script calls the redirect on `localhost:3000` instead.

## Build and release

```bash
bin/build-assets.sh                              # rebuild storefront JS from Resources/app/storefront/src
bin/build.sh store                               # Shopware Store ZIP, no secret
SHOPWARE_APP_SECRET=... bin/build.sh zip         # help centre ZIP for self-hosted shops
```

The technical name is `ReviewForest`. It has to start with our Shopware manufacturer prefix and cannot change once the app is published in the Store.

The build fails if a development URL or the development secret would end up in the package. Validate with `docker run --rm -v "$PWD/<unzipped>":/ext ghcr.io/shopware/shopware-cli:latest extension validate --full --store-compliance /ext`.

GitHub Actions builds and validates the Store ZIP on every pull request and push to `main`. A tag `v*` also builds the help-centre ZIP (with the `SHOPWARE_APP_SECRET` repository secret) and creates a draft release; publishing it is a manual step.

## License

MIT, see [LICENSE](LICENSE).
