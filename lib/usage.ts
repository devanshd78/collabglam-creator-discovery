import { prisma } from "./prisma";

/** IST calendar day, the team's working day, as "YYYY-MM-DD". */
export function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Midnight IST today, as an instant — for "found today" counts. */
export function startOfTodayIst(): Date {
  return new Date(`${todayKey()}T00:00:00+05:30`);
}

export async function recordUnitsUsed(units: number): Promise<void> {
  if (units <= 0) return;
  const date = todayKey();
  await prisma.youtubeApiUsage.upsert({
    where: { date },
    create: { date, units },
    update: { units: { increment: units } },
  });
}

export async function getUnitsUsedToday(): Promise<number> {
  const row = await prisma.youtubeApiUsage.findUnique({ where: { date: todayKey() } });
  return row?.units ?? 0;
}

