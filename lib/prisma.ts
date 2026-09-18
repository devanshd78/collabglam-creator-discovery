import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

let productionPrisma: PrismaClient | undefined;

function boundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function createPrismaClient(): PrismaClient {
  const connectionString =
    process.env.DATABASE_URL?.trim() ||
    process.env.DIRECT_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg({
    connectionString,

    max: boundedInt(
      process.env.DB_POOL_MAX,
      10,
      1,
      50
    ),

    connectionTimeoutMillis: boundedInt(
      process.env.DB_CONNECTION_TIMEOUT_MS,
      10_000,
      1_000,
      120_000
    ),

    idleTimeoutMillis: boundedInt(
      process.env.DB_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      600_000
    ),

    allowExitOnIdle: process.env.NODE_ENV !== "production",
  });

  return new PrismaClient({
    adapter,
  });
}

function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV !== "production") {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }

    return globalForPrisma.prisma;
  }

  if (!productionPrisma) {
    productionPrisma = createPrismaClient();
  }

  return productionPrisma;
}

/**
 * Lazy Prisma proxy.
 *
 * Next.js can import this module during `next build`
 * without requiring DATABASE_URL.
 *
 * The actual database client is initialized only when
 * a request accesses Prisma at runtime.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();

    const value = Reflect.get(
      client,
      property,
      client
    );

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});