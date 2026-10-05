#!/usr/bin/env bash
# Copies the app into a running dockware container and (re)installs it.
#   dev/sync-app.sh sw67    or    dev/sync-app.sh sw66
set -euo pipefail
SERVICE="${1:-sw67}"
cd "$(dirname "$0")"
docker compose exec -T "$SERVICE" bash -lc '
  set -e
  # Shopware 6.6.10+ only lets apps call public HTTPS targets. In this local container the API runs on the
  # Docker host (private IP, plain HTTP), so allow exactly that address. Not needed for real shops.
  HOST_IPS=$(getent ahosts host.docker.internal | awk "{print \$1}" | sort -u | sed "s/.*/\"&\"/" | paste -sd, -)
  CONF=/var/www/html/config/packages/zz_reviewforest_dev.yaml
  WANT="shopware:\n  app_system:\n    allow_unencrypted_traffic: true\n    allowed_private_ip_addresses: [$HOST_IPS]\n"
  if [ -n "$HOST_IPS" ] && [ "$(printf "$WANT")" != "$(cat "$CONF" 2>/dev/null)" ]; then
    printf "$WANT" > "$CONF"
    php /var/www/html/bin/console cache:clear >/dev/null
  fi
  mkdir -p /var/www/html/custom/apps/ReviewForest
  rsync -a --delete --exclude /dev --exclude /bin --exclude /dist --exclude /.git /mnt/reviewforest-app/ /var/www/html/custom/apps/ReviewForest/
  cd /var/www/html
  # app:list only exists from 6.7 on, so install first and refresh if it is already there.
  if php bin/console app:install --activate --force ReviewForest 2>&1 | grep -q "already installed"; then
    php bin/console app:refresh --force --no-interaction >/dev/null
    php bin/console app:activate ReviewForest >/dev/null 2>&1 || true
  fi
  php bin/console theme:compile --no-interaction >/dev/null
  php bin/console cache:clear --no-interaction >/dev/null
  mysql -h 127.0.0.1 -uroot -proot shopware -N -e "select name, version, active from app where name=\"ReviewForest\"" 2>/dev/null
'
