import "server-only";
import { prisma } from "./prisma";

export interface BriefAvailability {
  status: "ACTIVE" | "ARCHIVED";
  deadlineAt: Date | null;
}

export function briefClosedReason(brief: BriefAvailability, now = new Date()): string | null {
  if (brief.status === "ARCHIVED") return "This campaign is archived. No further entries are accepted.";
  if (brief.deadlineAt && brief.deadlineAt.getTime() <= now.getTime()) {
    return "This campaign deadline has been reached. No further entries are accepted.";
  }
  return null;
}

export function isBriefClosed(brief: BriefAvailability, now = new Date()): boolean {
  return briefClosedReason(brief, now) !== null;
}

export class BriefClosedError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function requireBriefAcceptingEntries(briefId: string): Promise<void> {
  const brief = await prisma.brandBrief.findUnique({
    where: { id: briefId },
    select: { status: true, deadlineAt: true },
  });
  if (!brief) throw new BriefClosedError("That brand brief no longer exists", 404);
  const reason = briefClosedReason(brief);
  if (reason) throw new BriefClosedError(reason, 409);
}
