import "server-only";
import { prisma } from "./prisma";
import type { StoredCreator } from "./creatorRecord";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Which channels are already unavailable to discovery for this team.
 * A channel is unavailable once it has either been shown in a previous discovery run or saved.
 */
export async function findClaimed(channelIds: string[]): Promise<Set<string>> {
  if (channelIds.length === 0) return new Set();
  const [saved, assigned] = await Promise.all([
    prisma.creator.findMany({ where: { channelId: { in: channelIds } }, select: { channelId: true } }),
    prisma.discoveryAssignment.findMany({ where: { channelId: { in: channelIds } }, select: { channelId: true } }),
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
 * Saves a discovery run and atomically reserves every returned channel for this member.
 * DiscoveryAssignment.channelId is unique, so concurrent searches cannot return the same creator
 * to two different team members. Any channel another request reserved first is removed from the
 * saved run and from the response sent back to the browser.
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

    if (candidates.length > 0) {
      await tx.discoveryAssignment.createMany({
        data: candidates.map((r) => ({
          channelId: r.channelId,
          userId: input.userId,
          runId: run.id,
          briefId: input.briefId,
          kind: input.kind,
        })),
        skipDuplicates: true,
      });
    }

    const mine = candidates.length
      ? await tx.discoveryAssignment.findMany({ where: { runId: run.id }, select: { channelId: true } })
      : [];
    const assignedIds = new Set(mine.map((r) => r.channelId));
    const uniqueResults = candidates.filter((r) => assignedIds.has(r.channelId));
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
