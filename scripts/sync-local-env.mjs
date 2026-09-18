import fs from "node:fs";
import path from "node:path";

const dockerEnvPath = path.resolve(process.cwd(), ".env.docker");
const localEnvPath = path.resolve(process.cwd(), ".env");

if (!fs.existsSync(dockerEnvPath)) {
  console.error(".env.docker was not found. Create it from .env.docker.example first.");
  process.exit(1);
}

function parseEnvFile(contents) {
  const values = {};
  for (const originalLine of contents.split(/\r?\n/)) {
    let line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        console.error(`Invalid quoted value for ${key} in .env.docker`);
        process.exit(1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const source = parseEnvFile(fs.readFileSync(dockerEnvPath, "utf8"));
const required = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "YOUTUBE_API_KEY", "SESSION_SECRET"];
const missing = required.filter((name) => !source[name]?.trim());
if (missing.length) {
  console.error(`Missing required values in .env.docker: ${missing.join(", ")}`);
  process.exit(1);
}

const devPort = source.POSTGRES_DEV_PORT?.trim() || "5433";
if (!/^\d+$/.test(devPort)) {
  console.error("POSTGRES_DEV_PORT must be a numeric TCP port.");
  process.exit(1);
}

const user = encodeURIComponent(source.POSTGRES_USER);
const password = encodeURIComponent(source.POSTGRES_PASSWORD);
const database = encodeURIComponent(source.POSTGRES_DB);
const databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${devPort}/${database}?schema=public`;

const quote = (value) => JSON.stringify(String(value ?? ""));
const output = [
  "# Generated from .env.docker by npm run env:local:sync.",
  "# Edit .env.docker, then run the sync command again instead of editing this file by hand.",
  "",
  `YOUTUBE_API_KEY=${quote(source.YOUTUBE_API_KEY)}`,
  `DATABASE_URL=${quote(databaseUrl)}`,
  `DIRECT_URL=${quote(databaseUrl)}`,
  `SESSION_SECRET=${quote(source.SESSION_SECRET)}`,
  `APP_BASE_URL=${quote("http://localhost:3000")}`,
  `YOUTUBE_TIMEOUT_MS=${quote(source.YOUTUBE_TIMEOUT_MS || "20000")}`,
  `DB_POOL_MAX=${quote(source.DB_POOL_MAX || "10")}`,
  `DB_CONNECTION_TIMEOUT_MS=${quote(source.DB_CONNECTION_TIMEOUT_MS || "10000")}`,
  `DB_IDLE_TIMEOUT_MS=${quote(source.DB_IDLE_TIMEOUT_MS || "30000")}`,
  "",
].join("\n");

fs.writeFileSync(localEnvPath, output, { mode: 0o600 });
console.log(`Wrote ${localEnvPath}`);
console.log(`Local PostgreSQL target: 127.0.0.1:${devPort}/${source.POSTGRES_DB}`);
