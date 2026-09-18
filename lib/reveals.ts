import "server-only";
import { prisma } from "./prisma";
import { startOfTodayIst } from "./usage";
import type { SessionUser } from "./auth";

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i;
export const REVEAL_OUTCOMES = ["revealed", "none", "limit"] as const;
export type RevealOutcome = (typeof REVEAL_OUTCOMES)[number];

/** YouTube's cap is roughly this many reveals per Google account per day. The extension lets a
 * member lower or raise it if YouTube behaves differently for their accounts. */
export const DEFAULT_DAILY_REVEALS_PER_ACCOUNT = 10;

export function cleanEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase().replace(/^mailto:/, "") : "";
}

/** Creators a member may set emails on: ones they saved, or any, for an admin. */
export function editableCreatorWhere(user: SessionUser) {
  return user.role === "ADMIN" ? {} : { claimedById: user.id };
}

/**
 * Stores an email a member revealed (or typed) for a creator. Whatever research had found before is
 * kept in otherEmails, so a correction never loses information.
 */
export async function setCreatorEmail(creator: { id: string; channelUrl: string; email: string | null }, email: string, source: string) {
  await prisma.creator.update({
    where: { id: creator.id },
    data: {
      email,
      emailSource: source,
      emailSourceUrl: `${creator.channelUrl.replace(/\/$/, "")}/about`,
      noPublicEmail: false,
      ...(creator.email && creator.email !== email ? { otherEmails: { push: creator.email } } : {}),
    },
  });
}

/** Today's reveal attempts per signed-in Google account: how many succeeded and whether YouTube
 * said the account's limit was reached. */
export async function revealsToday(userId: string): Promise<Record<number, { revealed: number; none: number; limitHit: boolean }>> {
  const rows = await prisma.emailReveal.groupBy({
    by: ["accountIndex", "outcome"],
    where: { userId, createdAt: { gte: startOfTodayIst() } },
    _count: { _all: true },
  });
  const out: Record<number, { revealed: number; none: number; limitHit: boolean }> = {};
  for (const r of rows) {
    const entry = (out[r.accountIndex] ??= { revealed: 0, none: 0, limitHit: false });
    if (r.outcome === "revealed") entry.revealed += r._count._all;
    else if (r.outcome === "none") entry.none += r._count._all;
    else if (r.outcome === "limit") entry.limitHit = true;
  }
  return out;
}
