#!/bin/sh
set -eu
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="backups/collabglam-${stamp}.sql.gz"
docker compose --env-file .env.docker exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' | gzip > "$out"
echo "Backup written to $out"
