# CollabGlam Creator Discovery

A team tool for finding YouTube creators who match a brand campaign, researching public business-email sources, assigning discovery results uniquely across the team, saving member lists, and exporting CSVs.

## Existing application behavior

The application functionality is unchanged by the production packaging:

1. Admins create brand briefs and manage team members. Every brief requires a **Target Niche**; requirements, URL, country, subscriber range and other campaign details can be as detailed or concise as needed.
2. Members discover creators with Campaign Match or Search by Filters.
3. Public email/link research runs as part of discovery.
4. Discovery results are reserved team-wide, so a channel shown to one member is not returned to another member.
5. Members save creators into their own lists.
6. Admins can open **All lists -> Merged team list** to see the combined team output and export one CSV.
7. The email-reveal Chrome extension continues to use the existing `/api/ext/*` endpoints and does not bypass CAPTCHAs.

## Fastest local development setup

Requires Node.js 20.9+ and Docker Desktop/Engine. The project can start a dedicated PostgreSQL 17 container for local development on `127.0.0.1:5433`, keeping it separate from the production Compose network and from any PostgreSQL already using port 5432.

First create `.env.docker` and fill the real values:

```bash
cp .env.docker.example .env.docker
npm install
```

Then bootstrap local development:

```bash
npm run dev:setup
npm run dev
```

`npm run dev:setup` does four things: generates `.env` from `.env.docker` with the PostgreSQL password safely URL-encoded, starts only the PostgreSQL container with a loopback-only port mapping, waits for it, and applies Prisma migrations.

Open `http://localhost:3000`. If there are no users, the first-run screen creates the first admin.

After the first setup, normal development is simply:

```bash
npm run db:docker:up
npm run dev
```

If you intentionally use your own PostgreSQL instead, copy `.env.example` to `.env` and set `DATABASE_URL` manually.

## Production Docker deployment

The included production stack is:

```text
Internet
   |
   v
Caddy (HTTP/HTTPS, automatic TLS with a domain)
   |
   v
Next.js 16 application (private Docker network)
   |
   v
PostgreSQL 17 (private Docker network + persistent volume)
```

First create the deployment environment file:

```bash
cp .env.docker.example .env.docker
```

Fill its real secrets, then:

```bash
docker compose --env-file .env.docker up -d --build
```

For full VPS/domain/TLS/update/backup/restore instructions, read **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Production features included

- Multi-stage Node 22 Docker image.
- Application runs as a non-root user under `dumb-init`.
- PostgreSQL 17 container with persistent volume and health checks.
- Caddy reverse proxy; real domains receive automatic HTTPS and certificate renewal.
- PostgreSQL is not published to the host/internet.
- Next.js port is not published to the host/internet.
- Startup waits for the database and applies `prisma migrate deploy` before serving traffic.
- Environment/placeholder validation prevents deployment with example credentials.
- PostgreSQL credentials containing URL-special characters are encoded safely by the Docker entrypoint.
- `/api/health` liveness and `/api/ready` database-readiness endpoints.
- Bounded PostgreSQL pool settings (`DB_POOL_MAX`, connection and idle timeouts).
- Reverse-proxy settings preserve long NDJSON discovery streams.
- Container restart policies, health checks, security headers and bounded Docker logs.
- PostgreSQL backup/restore scripts.
- `.dockerignore` excludes local env files, node_modules, build cache and backups from images.

## Useful commands

```bash
# Code quality
npm run typecheck
npm run lint
npm test
npm run build

# Database
npm run db:check
npm run db:migrate
npm run db:studio

# Docker
npm run docker:up
npm run docker:logs
npm run docker:down
npm run db:backup
```

## Code map

- `lib/discovery/*`: campaign discovery/scoring engine.
- `lib/youtube/*`: YouTube search, normalization and creator signals.
- `lib/emailResearch.ts`, `lib/creatorEmailFinder.ts`: public email research.
- `lib/team.ts`: team-wide discovery reservations and creator claims.
- `app/(app)/lists/merged`: admin merged team list.
- `prisma/schema.prisma`: PostgreSQL schema.
- `prisma/migrations`: production database migrations.
- `extension/`: email-reveal Chrome extension.
- `Dockerfile`: production application image.
- `docker-compose.yml`: PostgreSQL + app + Caddy stack.
- `docker/caddy/Caddyfile`: reverse proxy and HTTPS configuration.
- `docker/entrypoint.sh`: env validation, database wait and migration startup.
- `DEPLOYMENT.md`: production operations guide.
