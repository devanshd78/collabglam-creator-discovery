import "dotenv/config";

const errors = [];
const required = ["DATABASE_URL", "SESSION_SECRET", "YOUTUBE_API_KEY"];
for (const name of required) {
  if (!process.env[name]?.trim()) errors.push(`${name} is required`);
}

const placeholders = /YOUR_|CHANGE_ME|user:password@host|ep-cool-cloud-a1b2c3d4|ep-REALNAME|example\.com/i;
for (const name of ["DATABASE_URL", "DIRECT_URL", "SESSION_SECRET", "YOUTUBE_API_KEY"]) {
  const value = process.env[name]?.trim();
  if (value && placeholders.test(value)) errors.push(`${name} still contains a placeholder value`);
}

const secret = process.env.SESSION_SECRET?.trim() || "";
if (secret && secret.length < 32) errors.push("SESSION_SECRET must be at least 32 characters");

if (process.env.NODE_ENV === "production") {
  const base = process.env.APP_BASE_URL?.trim();
  if (!base) errors.push("APP_BASE_URL is required in production");
  else {
    try {
      const url = new URL(base);
      if (!/^https?:$/.test(url.protocol)) errors.push("APP_BASE_URL must start with http:// or https://");
    } catch {
      errors.push("APP_BASE_URL must be a valid absolute URL");
    }
  }
}

for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
  const value = process.env[name]?.trim();
  if (!value) continue;
  try {
    const url = new URL(value);
    if (!url.protocol.startsWith("postgres")) errors.push(`${name} must be a PostgreSQL URL`);
  } catch {
    errors.push(`${name} is not a valid URL`);
  }
}

if (errors.length) {
  console.error("Environment validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("Environment validation passed.");
