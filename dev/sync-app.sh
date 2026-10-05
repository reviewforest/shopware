#!/usr/bin/env bash
# Copies the app into a running dockware container and (re)installs it.
#   dev/sync-app.sh sw67    or    dev/sync-app.sh sw66
set -euo pipefail
SERVICE="${1:-sw67}"
cd "$(dirname "$0")"
docker compose exec -T "$SERVICE" bash -lc '
  set -e
  mkdir -p /var/www/html/custom/apps/ReviewForest
  rsync -a --delete --exclude /dev --exclude /bin --exclude /dist --exclude /.git /mnt/reviewforest-app/ /var/www/html/custom/apps/ReviewForest/
  cd /var/www/html
  if php bin/console app:list 2>/dev/null | grep -q ReviewForest; then
    php bin/console app:refresh --force --no-interaction
  else
    php bin/console app:install --activate --force ReviewForest
  fi
  php bin/console theme:compile --no-interaction >/dev/null
  php bin/console cache:clear --no-interaction >/dev/null
  php bin/console app:list | grep -i reviewforest
'
