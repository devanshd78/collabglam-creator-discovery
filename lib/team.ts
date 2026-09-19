import "server-only";
import { prisma } from "./prisma";
import type { StoredCreator } from "./creatorRecord";
import type { Prisma } from "@/app/generated/prisma/client";
import { briefClosedReason } from "./briefAvailability";

/**
 * Which channels are unavailable to this discovery request.
 * Saved creators stay team-wide unique. Discovery reservations owned by OTHER members are hidden,
 * but a member may re-run their own search without their previous preview results disappearing.
 */
export async function findClaimed(channelIds: string[], currentUserId?: string): Promise<Set<string>> {
  if (channelIds.length === 0) return new Set();
  const [saved, assigned] = await Promise.all([
    prisma.creator.findMany({ where: { channelId: { in: channelIds } }, select: { channelId: true } }),
    prisma.discoveryAssignment.findMany({
      where: {
        channelId: { in: channelIds },
        ...(currentUserId ? { userId: { not: currentUserId } } : {}),
      },
      select: { channelId: true },
    }),
  ]);
  return new Set([...saved.map((r) => r.channelId), ...assigned.map((r) => r.channelId)]);
}

export interface SavedRun {
  runId: string;
  results: StoredCreator[];
  hiddenAsClaimed: number;
  newlyHidden: number;
}

/**
 * Saves a discovery run and atomically reserves eligible results for this member.
 * DiscoveryAssignment.channelId is unique, so concurrent searches cannot return the same eligible
 * creator to two different team members. A member's own older reservation is reusable on re-runs,
 * and rejected campaign diagnostics (tier D) are stored without consuming the team reservation pool.
 */
export async function saveRun(input: {
  userId: string;
  briefId: string | null;
  kind: "campaign" | "search";
  query: string;
  results: StoredCreator[];
  hiddenAsClaimed: number;
  unitsUsed: number;
}): Promise<SavedRun> {
  // Search providers normally return one row per channel, but normalize here as a final guard so
  // a duplicated API candidate can never be duplicated in the saved run or browser response.
  const candidates = Array.from(new Map(input.results.map((creator) => [creator.channelId, creator])).values());

  return prisma.$transaction(async (tx) => {
    if (input.briefId) {
      const brief = await tx.brandBrief.findUnique({ where: { id: input.briefId }, select: { status: true, deadlineAt: true } });
      if (!brief) throw new Error("That brand brief no longer exists");
      const closed = briefClosedReason(brief);
      if (closed) throw new Error(closed);
    }

    const run = await tx.searchRun.create({
      data: {
        userId: input.userId,
        briefId: input.briefId,
        kind: input.kind,
        query: input.query.slice(0, 4000),
        hiddenAsClaimed: input.hiddenAsClaimed,
        unitsUsed: input.unitsUsed,
        results: [] as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Campaign tier D rows are useful diagnostics (the UI can explain why they were rejected), but
    // reserving rejected channels permanently starves later searches for no benefit. Search-tab
    // results and campaign A/B/C rows remain team-reserved.
    const reservable = input.kind === "campaign" ? candidates.filter((r) => r.tier !== "D") : candidates;
    const diagnosticOnlyIds = new Set(input.kind === "campaign" ? candidates.filter((r) => r.tier === "D").map((r) => r.channelId) : []);

    // Re-check saved creators inside the transaction. This closes the race where another member
    // saves a creator while this request is still analyzing YouTube data.
    const alreadySaved = reservable.length
      ? await tx.creator.findMany({ where: { channelId: { in: reservable.map((r) => r.channelId) } }, select: { channelId: true } })
      : [];
    const savedIds = new Set(alreadySaved.map((r) => r.channelId));
    const availableToReserve = reservable.filter((r) => !savedIds.has(r.channelId));

    if (availableToReserve.length > 0) {
      await tx.discoveryAssignment.createMany({
        data: availableToReserve.map((r) => ({
          channelId: r.channelId,
          userId: input.userId,
          runId: run.id,
          briefId: input.briefId,
          kind: input.kind,
        })),
        skipDuplicates: true,
      });
    }

    // A channel reserved by this same member in an older run is still valid for this new run. The
    // old code looked only for runId === current run, which is exactly why a second Deep search could
    // return zero even though the first run had found matching creators.
    const reservations = availableToReserve.length
      ? await tx.discoveryAssignment.findMany({
          where: { channelId: { in: availableToReserve.map((r) => r.channelId) } },
          select: { channelId: true, userId: true },
        })
      : [];
    const assignedToMe = new Set(reservations.filter((r) => r.userId === input.userId).map((r) => r.channelId));
    const uniqueResults = candidates.filter((r) => diagnosticOnlyIds.has(r.channelId) || assignedToMe.has(r.channelId));
    const newlyHidden = candidates.length - uniqueResults.length;
    const hiddenAsClaimed = input.hiddenAsClaimed + newlyHidden;

    await tx.searchRun.update({
      where: { id: run.id },
      data: {
        resultCount: uniqueResults.length,
        emailsFound: uniqueResults.filter((r) => r.email).length,
        hiddenAsClaimed,
        results: uniqueResults as unknown as Prisma.InputJsonValue,
      },
    });

    return { runId: run.id, results: uniqueResults, hiddenAsClaimed, newlyHidden };
  });
}

export interface ClaimResult {
  saved: string[];
  taken: { channelId: string; title: string; takenBy: string }[];
}

/**
 * Copies the chosen creators from a run the user made into one of their lists. Each creator is
 * inserted on its own: the unique channelId means that if a teammate saved the same channel first —
 * even a moment earlier — this insert fails and the creator is reported as taken, never duplicated.
 */
export async function claimCreators(input: { userId: string; listId: string; runId: string; channelIds: string[] }): Promise<ClaimResult> {
  const [list, run] = await Promise.all([
    prisma.creatorList.findUnique({ where: { id: input.listId }, select: { ownerId: true, briefId: true } }),
    prisma.searchRun.findUnique({ where: { id: input.runId }, select: { userId: true, kind: true, briefId: true, results: true } }),
  ]);
  if (!list || list.ownerId !== input.userId) throw new ClaimError("List not found", 404);
  if (!run || run.userId !== input.userId) throw new ClaimError("Search run not found — run the search again", 404);

  const effectiveBriefId = list.briefId ?? run.briefId;
  if (effectiveBriefId) {
    const brief = await prisma.brandBrief.findUnique({ where: { id: effectiveBriefId }, select: { status: true, deadlineAt: true } });
    if (!brief) throw new ClaimError("That brand brief no longer exists", 404);
    const closed = briefClosedReason(brief);
    if (closed) throw new ClaimError(closed, 409);
  }

  const wanted = new Set(input.channelIds);
  const rows = (run.results as unknown as StoredCreator[]).filter((r) => wanted.has(r.channelId));
  const saved: string[] = [];
  const takenIds: string[] = [];

  for (const r of rows) {
    try {
      await prisma.creator.create({
        data: {
          channelId: r.channelId,
          title: r.title,
          channelUrl: r.channelUrl,
          thumbnailUrl: r.thumbnailUrl || null,
          country: r.country || null,
          subscriberCount: r.subscriberCount,
          averageViews: r.averageViews,
          medianViews: r.medianViews,
          engagementRate: r.engagementRate,
          email: r.email,
          emailSource: r.emailSource,
          emailSourceUrl: r.emailSourceUrl,
          otherEmails: r.otherEmails,
          platformLinks: r.platformLinks,
          websiteLinks: r.websiteLinks,
          mainContent: r.mainContent || null,
          matchScore: r.matchScore,
          tier: r.tier,
          relevantVideos: r.relevantVideos,
          analyzedVideos: r.analyzedVideos,
          lastUploadAt: r.lastUploadAt ? new Date(r.lastUploadAt) : null,
          whyFit: r.whyFit,
          concerns: r.concerns,
          evidenceTitle: r.evidenceTitle,
          evidenceUrl: r.evidenceUrl,
          foundVia: r.foundVia,
          source: run.kind,
          claimedById: input.userId,
          listId: input.listId,
          briefId: list.briefId ?? run.briefId,
          runId: input.runId,
        },
      });
      saved.push(r.channelId);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") takenIds.push(r.channelId);
      else throw err;
    }
  }

  const owners = takenIds.length
    ? await prisma.creator.findMany({
        where: { channelId: { in: takenIds } },
        select: { channelId: true, title: true, claimedById: true, claimedBy: { select: { name: true } } },
      })
    : [];
  const taken = owners.map((o) => ({
    channelId: o.channelId,
    title: o.title,
    takenBy: o.claimedById === input.userId ? "you" : o.claimedBy.name,
  }));

  if (saved.length > 0) await prisma.creatorList.update({ where: { id: input.listId }, data: { updatedAt: new Date() } });
  return { saved, taken };
}

export class ClaimError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
