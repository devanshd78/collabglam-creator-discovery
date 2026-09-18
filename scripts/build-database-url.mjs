const required = ["POSTGRES_HOST", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`${name} is required when DATABASE_URL is not set.`);
    process.exit(1);
  }
}

const host = process.env.POSTGRES_HOST;
const port = process.env.POSTGRES_PORT || "5432";
if (!/^[A-Za-z0-9._-]+$/.test(host) || !/^\d+$/.test(port)) {
  console.error("Invalid PostgreSQL host or port.");
  process.exit(1);
}

const user = encodeURIComponent(process.env.POSTGRES_USER);
const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
const database = encodeURIComponent(process.env.POSTGRES_DB);
const schema = encodeURIComponent(process.env.POSTGRES_SCHEMA || "public");
const sslMode = process.env.POSTGRES_SSLMODE?.trim();
const params = new URLSearchParams({ schema });
if (sslMode) params.set("sslmode", sslMode);

process.stdout.write(`postgresql://${user}:${password}@${host}:${port}/${database}?${params.toString()}`);
