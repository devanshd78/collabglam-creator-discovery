import "dotenv/config";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
const directUrl = process.env.DIRECT_URL?.trim() || databaseUrl;
const entries = [
  ["DATABASE_URL", databaseUrl],
  ["DIRECT_URL", directUrl],
];

function looksLikePlaceholder(value) {
  if (!value) return false;
  return /YOUR_|CHANGE_ME|user:password@host|ep-cool-cloud-a1b2c3d4|ep-REALNAME|example/i.test(value);
}

function safeTarget(value) {
  try {
    const url = new URL(value);
    return `${url.username || "(no-user)"}@${url.hostname}${url.port ? `:${url.port}` : ""}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "invalid connection URL";
  }
}

let failed = false;
for (const [name, connectionString] of entries) {
  if (!connectionString) {
    console.error(`${name}: MISSING`);
    failed = true;
    continue;
  }
  if (looksLikePlaceholder(connectionString)) {
    console.error(`${name}: PLACEHOLDER VALUE DETECTED (${safeTarget(connectionString)})`);
    failed = true;
    continue;
  }

  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10_000, max: 1 });
  try {
    const result = await pool.query("select current_database() as db, current_user as user, now() as now");
    const alias = name === "DIRECT_URL" && !process.env.DIRECT_URL?.trim() ? " (using DATABASE_URL)" : "";
    console.log(`${name}${alias}: OK -> ${safeTarget(connectionString)} (database ${result.rows[0].db}, user ${result.rows[0].user})`);
  } catch (error) {
    console.error(`${name}: FAILED -> ${safeTarget(connectionString)}`);
    console.error(error instanceof Error ? error.message : String(error));
    failed = true;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (failed) {
  console.error("\nDatabase check failed. Verify the PostgreSQL host, user, password, database, network access, and SSL settings.");
  process.exitCode = 1;
}
