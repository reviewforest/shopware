#!/usr/bin/env bash
# Rebuilds the storefront JavaScript from Resources/app/storefront/src with the official shopware-cli
# (Docker image, no local Node or PHP needed). Run after changing src/main.js and commit the dist file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
docker run --rm -v "$ROOT":/ext ghcr.io/shopware/shopware-cli:latest extension build /ext
