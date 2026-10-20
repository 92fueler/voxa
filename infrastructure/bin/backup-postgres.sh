#!/bin/sh
# Manual logical backup for the production stack. Contains private transcripts.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
directory=/srv/voxa/backups
if ! mountpoint -q /srv/voxa; then
    echo "Refusing to back up: /srv/voxa is not mounted." >&2
    exit 1
fi
mkdir -p "$directory"
temporary=$(mktemp "$directory/.voxa-backup.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM

# Keep original owners: the app's objects belong to voxa, extensions to postgres.
sh "$root/infrastructure/bin/production-compose.sh" exec -T postgres \
    pg_dump --username=postgres --dbname=voxa --format=custom > "$temporary"
test -s "$temporary"
destination="$directory/voxa-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
mv "$temporary" "$destination"
trap - EXIT HUP INT TERM
echo "Created $destination. Encrypt and copy it off-host, then verify a restore."
