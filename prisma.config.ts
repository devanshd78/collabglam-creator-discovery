import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` does not connect to PostgreSQL, so allow dependency installation/image builds
// to generate the client before runtime secrets are injected. Migration/runtime commands receive the
// real URL through environment variables and the deployment entrypoint validates it first.
const databaseUrl = process.env.DATABASE_URL?.trim() || "postgresql://build:build@127.0.0.1:5432/build";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: databaseUrl,
    // Ordinary PostgreSQL can use the same URL for migrations. If the runtime URL points at a
    // transaction pooler, set DIRECT_URL to the provider's direct/unpooled URL.
    directUrl: process.env.DIRECT_URL?.trim() || databaseUrl,
  },
});
