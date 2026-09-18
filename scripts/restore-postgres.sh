#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 backups/file.sql.gz" >&2
  exit 1
fi
file="$1"
[ -f "$file" ] || { echo "Backup not found: $file" >&2; exit 1; }
gzip -dc "$file" | docker compose --env-file .env.docker exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
echo "Restore completed from $file"
