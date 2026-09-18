#!/bin/sh
set -eu

# Docker Compose can provide regular PostgreSQL fields instead of a pre-built URL.
# Building the URL here safely percent-encodes usernames/passwords that contain @, :, /, etc.
if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(node ./scripts/build-database-url.mjs)"
  export DATABASE_URL
fi

if [ -z "${DIRECT_URL:-}" ]; then
  DIRECT_URL="$DATABASE_URL"
  export DIRECT_URL
fi

node ./scripts/validate-env.mjs
node ./scripts/wait-for-db.mjs

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  ./node_modules/.bin/prisma migrate deploy
fi

exec "$@"
