import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const connectionString = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is not set");

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

const adapter = new PrismaPg({
  connectionString,
  max: boundedInt(process.env.DB_POOL_MAX, 10, 1, 50),
  connectionTimeoutMillis: boundedInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10_000, 1_000, 120_000),
  idleTimeoutMillis: boundedInt(process.env.DB_IDLE_TIMEOUT_MS, 30_000, 1_000, 600_000),
  allowExitOnIdle: process.env.NODE_ENV !== "production",
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
