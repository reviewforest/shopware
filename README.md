# ReviewForest app for Shopware 6

Shopware app (app system, no PHP in the shop) for Shopware 6.6 and 6.7, including Shopware SaaS.

- **Widgets without code:** shows your ReviewForest widgets (floating badge, footer widget, more widget IDs) on every shop page, configurable per sales channel. Checkout and customer account pages stay free of the widget script unless you switch that on.
- **Review invitations after shipping:** a set number of days after shipping (or payment, or completion) the buyer gets one review invitation, but only if they agreed.
- **Consent:** either a question with "Yes, please" and "No, thanks" on the order confirmation page, or an unchecked checkbox in the checkout. Answer, time, source and text version are stored on the order.
- **Safety nets:** cancelled, returned or refunded orders cancel the waiting invitation; the invitation status is shown on the order; Flow Builder action "Schedule review invitation" for your own rules.

The server side lives in the ReviewForest API (`/integrations/shopware/*`). This repository only contains what runs inside the shop.

## Settings (per sales channel)

| Setting | Meaning |
|---|---|
| ReviewForest API key | Read-write key from ReviewForest (Integrations, API). Needed for invitations only. |
| Forest ID | The Bewertungswald that receives this sales channel's invitations. |
| Widget IDs | The part after `reviewforest-app-` in the embed code. |
| Send review invitations | Off by default. |
| Start the delay when / Delay in days | Shipped, paid or completed; 1 to 60 days (default: shipped, 7). |
| Style of the email | Formal or friendly. |
| How buyers agree | Question on the order confirmation page (default) or checkbox in the checkout. |
| Own consent text | Optional, German and English; `{shop}` is replaced by the shop name. |
| Do not invite these customer groups | For example B2B or marketplace customers. |

## Development

Requirements: Docker, Node 24 and pnpm for the ReviewForest API worktree, mongosh, Python 3.

```bash
docker compose -f dev/docker-compose.yml up -d mongo sw67                    # Shopware 6.7 on :8067
COMPOSE_PROFILES=sw66 docker compose -f dev/docker-compose.yml up -d sw66    # Shopware 6.6 on :8066
mongosh "mongodb://localhost:27019/rf_shopware_dev?replicaSet=rs0&directConnection=true" dev/seed-api.js
cp dev/api.env.example <api worktree>/apps/api/.env                          # then start the API on :3000
dev/sync-app.sh sw67                                                         # copy, install, compile theme
python3 dev/e2e.py --port 8067                                               # end-to-end checks
```

Configure the app in the shop admin (or with `bin/console system:config:set ReviewForest.config.<key> <value>`) with the API key and forest ID printed by the seed script. Admin login of the dockware images: admin / shopware.

Notes from the first run (October 2026):
- MongoDB 8 refuses to start on Docker Desktop's Linux kernel 7.0.12 (SERVER-121912), so the dev setup uses MongoDB 7.
- Shopware 6.6.10+ only lets apps call public HTTPS targets; `dev/sync-app.sh` allows the Docker host for the local API.
- dockware runs no message consumer; webhooks and flow actions wait in the queue until `messenger:consume` runs (the e2e script does that).

## Build and release

```bash
bin/build-assets.sh                              # rebuild storefront JS from Resources/app/storefront/src
bin/build.sh store                               # Shopware Store ZIP, no secret
SHOPWARE_APP_SECRET=... bin/build.sh zip         # help centre ZIP for self-hosted shops
APP_NAME=<Prefix>ReviewForest bin/build.sh store  # technical name with the manufacturer prefix
```

The build fails if a development URL or the development secret would end up in the package. Validate with `docker run --rm -v "$PWD/<unzipped>":/ext ghcr.io/shopware/shopware-cli:latest extension validate --full --store-compliance /ext`.

## License

MIT, see [LICENSE](LICENSE).
