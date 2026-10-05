#!/usr/bin/env bash
# Builds the release ZIP of the ReviewForest app for Shopware 6.
#
#   bin/build.sh zip     ZIP for self-hosted shops (help centre download). Needs SHOPWARE_APP_SECRET,
#                        because apps outside the Shopware Store must carry their secret in the manifest.
#   bin/build.sh store   ZIP for the Shopware Store. No secret: the Store provides it.
#
# Environment:
#   APP_NAME              technical name, must start with the Shopware manufacturer prefix (default ReviewForest)
#   API_URL               backend base URL, public https (default https://api.reviewforest.org)
#   SHOPWARE_APP_SECRET   only for "zip"; read from the environment, never from the command line
#
# The repository manifest is the local development manifest (host.docker.internal, dev secret). The build
# fails closed: it aborts if any development URL or the development secret is left in the package.
set -euo pipefail

MODE="${1:-zip}"
case "$MODE" in
  zip) : "${SHOPWARE_APP_SECRET:?SHOPWARE_APP_SECRET is required for the self-hosted ZIP}" ;;
  store) ;;
  *) echo "usage: bin/build.sh zip|store" >&2; exit 1 ;;
esac

export BUILD_MODE="$MODE"
export APP_NAME="${APP_NAME:-ReviewForest}"
export API_URL="${API_URL:-https://api.reviewforest.org}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE_PARENT="$(mktemp -d)"
STAGE="$STAGE_PARENT/$APP_NAME"
trap 'rm -rf "$STAGE_PARENT"' EXIT

mkdir -p "$STAGE" "$ROOT/dist"
cp -R "$ROOT/Resources" "$STAGE/"
cp "$ROOT/manifest.xml" "$ROOT/LICENSE" "$ROOT/CHANGELOG.md" "$STAGE/"
[ -f "$ROOT/README.md" ] && cp "$ROOT/README.md" "$STAGE/"

python3 - "$STAGE" <<'PY'
import os, re, sys
from pathlib import Path
from urllib.parse import urlparse
from xml.sax.saxutils import escape

stage = Path(sys.argv[1])
mode, app_name, api_url = os.environ['BUILD_MODE'], os.environ['APP_NAME'], os.environ['API_URL'].rstrip('/')
secret = os.environ.get('SHOPWARE_APP_SECRET', '')
dev_url, dev_secret = 'http://host.docker.internal:3000', 'local-dev-app-secret'

parsed = urlparse(api_url)
if parsed.scheme != 'https' or not parsed.hostname or parsed.hostname in ('localhost', 'host.docker.internal'):
    sys.exit(f'API_URL must be a public https URL, got {api_url}')
if not re.fullmatch(r'[A-Z][A-Za-z0-9]{2,63}', app_name):
    sys.exit(f'APP_NAME must be a valid technical name, got {app_name}')
if mode == 'zip' and (len(secret) < 32 or secret == dev_secret):
    sys.exit('SHOPWARE_APP_SECRET must be the production app secret (at least 32 characters)')

kebab = re.sub(r'([a-z0-9])([A-Z])', r'\1-\2', app_name).lower()

for path in stage.rglob('*'):
    if not path.is_file() or path.suffix not in ('.xml', '.twig', '.js', '.md'):
        continue
    text = path.read_text(encoding='utf-8')
    original = text
    text = text.replace(dev_url, api_url)
    if app_name != 'ReviewForest':
        text = text.replace('ReviewForest.config', f'{app_name}.config').replace('@ReviewForest/', f'@{app_name}/')
    if path.name == 'manifest.xml' and path.parent == stage:
        text = re.sub(r'<!--.*?-->\s*', '', text, count=1, flags=re.S)  # drop the development comment
        text = re.sub(r'<name>ReviewForest</name>', f'<name>{escape(app_name)}</name>', text, count=1)
        if mode == 'store':
            text = re.sub(r'\s*<secret>.*?</secret>', '', text)
        else:
            text = re.sub(r'<secret>.*?</secret>', lambda _: f'<secret>{escape(secret)}</secret>', text)
    if text != original:
        path.write_text(text, encoding='utf-8')

js_dir = stage / 'Resources/app/storefront/dist/storefront/js'
if app_name != 'ReviewForest':
    (js_dir / 'review-forest').rename(js_dir / kebab)
    (js_dir / kebab / 'review-forest.js').rename(js_dir / kebab / f'{kebab}.js')

# Fail closed: nothing from the development setup may remain in the package.
leftovers = [str(p.relative_to(stage)) for p in stage.rglob('*') if p.is_file() and p.suffix != '.png'
             and any(marker in p.read_text(encoding='utf-8', errors='ignore') for marker in ('host.docker.internal', dev_secret))]
if leftovers:
    sys.exit(f'Development URL or secret left in: {", ".join(leftovers)}')
manifest = (stage / 'manifest.xml').read_text(encoding='utf-8')
if mode == 'store' and '<secret>' in manifest:
    sys.exit('Store build must not contain a secret')
if re.search(r'url="http://|<registrationUrl>http://|<url>http://', manifest + (stage / 'Resources/flow.xml').read_text(encoding='utf-8')):
    sys.exit('Release URLs must use https')
PY

VERSION="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$STAGE/manifest.xml" | head -1)"
ZIP="$ROOT/dist/${APP_NAME}-${VERSION}-${MODE}.zip"
rm -f "$ZIP"
(cd "$STAGE_PARENT" && zip -qr "$ZIP" "$APP_NAME" -x '*.DS_Store')
echo "$ZIP"
