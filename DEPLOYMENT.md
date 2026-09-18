# Production deployment

This package is ready to run as a three-container stack:

`Internet -> Caddy -> Next.js -> PostgreSQL 17`

- **Caddy** is the only public container. With a real domain it obtains and renews HTTPS certificates automatically.
- **Next.js** runs as a non-root user, is reachable only on the internal Docker network, validates required configuration, waits for PostgreSQL, and applies Prisma migrations before starting.
- **PostgreSQL** is reachable only inside Docker and stores data in the persistent `postgres_data` volume.
- Docker health checks, restart policies and bounded JSON logs are enabled.


## Local development with the bundled PostgreSQL

Production keeps PostgreSQL private. For `npm run dev`, use the included local override instead of exposing the production database:

```bash
cp .env.docker.example .env.docker
# Fill .env.docker with your real values.
npm install
npm run dev:setup
npm run dev
```

The local PostgreSQL binding defaults to `127.0.0.1:5433`. This avoids collisions with an existing database on port 5432. `npm run env:local:sync` regenerates `.env` from `.env.docker` and percent-encodes special characters in the PostgreSQL password automatically.

## 1. Server prerequisites

Install Docker Engine and Docker Compose v2. On Ubuntu/Debian, use Docker's official repository rather than an old distro package. Make sure inbound TCP 80/443 and UDP 443 are allowed when using a domain with HTTPS.

Recommended minimum for a small team: 2 vCPU, 4 GB RAM, SSD storage. Increase resources if many members run deep discovery concurrently.

## 2. Configure production secrets

```bash
cp .env.docker.example .env.docker
```

Edit `.env.docker` and set:

- `POSTGRES_PASSWORD`: long random PostgreSQL password.
- `YOUTUBE_API_KEY`: one or more YouTube Data API v3 keys, comma-separated.
- `SESSION_SECRET`: 64 hex characters is recommended.
- `APP_BASE_URL`: the exact public URL members will use.
- `CADDY_SITE_ADDRESS`: `:80` for local/IP-only HTTP testing, or a real DNS name for automatic HTTPS.

Generate secrets with:

```bash
openssl rand -hex 32
```

Do not commit `.env.docker`; it is ignored by Git.

### Domain example

```env
APP_BASE_URL=https://creators.example.com
CADDY_SITE_ADDRESS=creators.example.com
```

Create an A/AAAA DNS record for the domain pointing to the server, then start the stack. Caddy handles TLS automatically.

## 3. Build and start

```bash
docker compose --env-file .env.docker up -d --build
```

Watch startup:

```bash
docker compose --env-file .env.docker logs -f app caddy db
```

The app container waits for PostgreSQL and runs `prisma migrate deploy` before starting Next.js. On the first successful start, visit the public URL and create the first admin account.

## 4. Health checks

Liveness:

```bash
curl -fsS http://127.0.0.1/api/health
```

Readiness (also checks PostgreSQL):

```bash
curl -fsS http://127.0.0.1/api/ready
```

For HTTPS/domain deployments, replace `http://127.0.0.1` with the public URL.

Container state:

```bash
docker compose --env-file .env.docker ps
```

## 5. Updating the application

Back up first, replace/pull the code, then rebuild:

```bash
npm run db:backup
docker compose --env-file .env.docker up -d --build
```

Prisma applies pending migrations automatically. Existing PostgreSQL data remains in the Docker volume.

## 6. Backup and restore

Create a compressed logical backup:

```bash
npm run db:backup
```

Backups are written under `backups/` and excluded from Git.

Restore a backup (stop web traffic first):

```bash
docker compose --env-file .env.docker stop caddy app
./scripts/restore-postgres.sh backups/collabglam-YYYYMMDDTHHMMSSZ.sql.gz
docker compose --env-file .env.docker start app caddy
```

Treat backups as sensitive because they contain application data. Copy them off-server to encrypted/object storage on a schedule.

## 7. Stop/restart

```bash
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker start
```

Remove containers without deleting database data:

```bash
docker compose --env-file .env.docker down
```

Do **not** add `-v` unless you intentionally want to destroy the PostgreSQL and Caddy volumes.

## 8. External PostgreSQL instead of the bundled database

The application remains standard PostgreSQL-compatible. For Neon, RDS, Supabase or another provider, run the app with `DATABASE_URL` and optionally `DIRECT_URL`. `DIRECT_URL` is only necessary when the runtime URL is a transaction pooler that cannot safely run migrations. Ordinary PostgreSQL can use the same URL for both.

The default Docker Compose stack deliberately uses its own private PostgreSQL service so deployment does not depend on Neon.

## 9. Multiple app replicas

For a single VPS, keep one app container as provided. If you later deploy multiple replicas behind a load balancer, run migrations as a separate release step or enable `RUN_MIGRATIONS=true` on only one release/migration job and `false` on normal replicas.

## 10. Security notes

- Only Caddy publishes host ports; the database and application ports stay private.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Caddy and Next.js add basic anti-sniffing/frame/referrer headers.
- The app image runs as an unprivileged user and containers use `no-new-privileges`.
- Secrets are runtime environment variables and are excluded from the Docker build context.
- Never place real API keys/passwords in the repository or Docker image.
- Rotate any credential that has previously been posted publicly or shared where it should not be retained.
