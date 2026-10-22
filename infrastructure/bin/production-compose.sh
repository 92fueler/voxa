#!/bin/sh
# Run from any directory. Secrets stay in the repository's ignored .env file.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

# Fail closed rather than silently create a fresh database on the instance root disk.
if ! mountpoint -q /srv/voxa; then
    echo "Refusing to run: the persistent data disk is not mounted at /srv/voxa." >&2
    exit 1
fi
for directory in postgres caddy-data caddy-config; do
    if [ ! -d "/srv/voxa/$directory" ]; then
        echo "Refusing to run: /srv/voxa/$directory is missing; complete the storage setup." >&2
        exit 1
    fi
done
cd "$root"
exec docker compose --env-file .env -f compose.production.yaml "$@"
