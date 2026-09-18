import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL or DIRECT_URL is required.");
  process.exit(1);
}

const attempts = Math.max(1, Number(process.env.DB_WAIT_ATTEMPTS || 30));
const delayMs = Math.max(250, Number(process.env.DB_WAIT_DELAY_MS || 2000));
const target = (() => {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "PostgreSQL";
  }
})();

for (let attempt = 1; attempt <= attempts; attempt++) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("select 1");
    await client.end();
    console.log(`Database is ready at ${target}.`);
    process.exit(0);
  } catch (error) {
    await client.end().catch(() => undefined);
    if (attempt === attempts) {
      console.error(`Database did not become ready at ${target}.`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    console.log(`Waiting for database (${attempt}/${attempts})...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
