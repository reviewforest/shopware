#!/usr/bin/env bash
# Builds the release ZIP of the ReviewForest app for Shopware 6.
#
#   bin/build.sh zip     ZIP for self-hosted shops (help centre download). Needs SHOPWARE_APP_SECRET,
#                        because apps outside the Shopware Store must carry their secret in the manifest.
#   bin/build.sh store   ZIP for the Shopware Store. No secret: the Store provides it.
#
# Environment:
#   APP_NAME              technical name, must start with the Shopware manufacturer prefix (default ReviewForest)
#   API_URL               backend base URL (default https://api.reviewforest.org)
#   SHOPWARE_APP_SECRET   only for "zip"
set -euo pipefail

MODE="${1:-zip}"
APP_NAME="${APP_NAME:-ReviewForest}"
API_URL="${API_URL:-https://api.reviewforest.org}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$ROOT/manifest.xml" | head -1)"
OUT="$ROOT/dist"
STAGE="$(mktemp -d)/$APP_NAME"

case "$MODE" in
  zip)
    : "${SHOPWARE_APP_SECRET:?SHOPWARE_APP_SECRET is required for the self-hosted ZIP}"
    ;;
  store) ;;
  *) echo "usage: bin/build.sh zip|store" >&2; exit 1 ;;
esac

mkdir -p "$STAGE" "$OUT"
cp -R "$ROOT/Resources" "$STAGE/"
cp "$ROOT/manifest.xml" "$ROOT/LICENSE" "$ROOT/CHANGELOG.md" "$STAGE/"
[ -f "$ROOT/README.md" ] && cp "$ROOT/README.md" "$STAGE/"

# Backend URL in the flow action as well.
sed -i.bak "s#http://host.docker.internal:3000#${API_URL%/}#g" "$STAGE/Resources/flow.xml" && rm -f "$STAGE/Resources/flow.xml.bak"

python3 - "$STAGE/manifest.xml" "$MODE" "$APP_NAME" "$API_URL" "${SHOPWARE_APP_SECRET:-}" <<'PY'
import re, sys
path, mode, app_name, api_url, secret = sys.argv[1:]
s = open(path, encoding='utf-8').read()
s = re.sub(r'<!--.*?-->\s*', '', s, count=1, flags=re.S)  # drop the dev comment
s = s.replace('http://host.docker.internal:3000', api_url.rstrip('/'))
s = re.sub(r'<name>ReviewForest</name>', f'<name>{app_name}</name>', s, count=1)
if mode == 'store':
    s = re.sub(r'\s*<secret>.*?</secret>', '', s)
else:
    s = re.sub(r'<secret>.*?</secret>', f'<secret>{secret}</secret>', s)
assert 'host.docker.internal' not in s
open(path, 'w', encoding='utf-8').write(s)
PY

# Templates and scripts read the configuration under the technical name.
if [ "$APP_NAME" != "ReviewForest" ]; then
  grep -rl "ReviewForest.config" "$STAGE/Resources" | xargs sed -i.bak "s/ReviewForest\.config/${APP_NAME}.config/g"
  grep -rl "@ReviewForest/" "$STAGE/Resources" | xargs sed -i.bak "s#@ReviewForest/#@${APP_NAME}/#g"
  find "$STAGE" -name '*.bak' -delete
  KEBAB="$(echo "$APP_NAME" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr '[:upper:]' '[:lower:]')"
  mv "$STAGE/Resources/app/storefront/dist/storefront/js/review-forest" "$STAGE/Resources/app/storefront/dist/storefront/js/$KEBAB"
  mv "$STAGE/Resources/app/storefront/dist/storefront/js/$KEBAB/review-forest.js" "$STAGE/Resources/app/storefront/dist/storefront/js/$KEBAB/$KEBAB.js"
fi

ZIP="$OUT/${APP_NAME}-${VERSION}-${MODE}.zip"
rm -f "$ZIP"
(cd "$(dirname "$STAGE")" && zip -qr "$ZIP" "$APP_NAME" -x '*.DS_Store')
echo "$ZIP"
