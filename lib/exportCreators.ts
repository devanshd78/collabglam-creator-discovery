import "server-only";
import { prisma } from "./prisma";
import { creatorsToCsv, type CsvRow } from "./creatorRecord";
import type { Prisma } from "@/app/generated/prisma/client";

const EXPORT_LIMIT = 20_000;

/** CSV of saved creators matching `where`, with who saved each and for which brand. */
export async function exportCreatorsCsv(where: Prisma.CreatorWhereInput): Promise<string> {
  const rows = await prisma.creator.findMany({
    where,
    orderBy: [{ claimedAt: "asc" }],
    take: EXPORT_LIMIT,
    include: { claimedBy: { select: { name: true } }, brief: { select: { brandName: true } } },
  });
  const csvRows: CsvRow[] = rows.map((c) => ({
    channelId: c.channelId,
    title: c.title,
    channelUrl: c.channelUrl,
    thumbnailUrl: c.thumbnailUrl ?? "",
    country: c.country ?? "",
    subscriberCount: c.subscriberCount,
    averageViews: c.averageViews,
    medianViews: c.medianViews,
    engagementRate: c.engagementRate,
    email: c.email,
    emailSource: c.emailSource,
    emailSourceUrl: c.emailSourceUrl,
    otherEmails: c.otherEmails,
    platformLinks: (c.platformLinks ?? {}) as Record<string, string>,
    websiteLinks: c.websiteLinks,
    mainContent: c.mainContent ?? "",
    matchScore: c.matchScore ?? 0,
    tier: c.tier,
    relevantVideos: c.relevantVideos,
    analyzedVideos: c.analyzedVideos,
    lastUploadAt: c.lastUploadAt?.toISOString() ?? null,
    whyFit: c.whyFit,
    concerns: c.concerns,
    evidenceTitle: c.evidenceTitle,
    evidenceUrl: c.evidenceUrl,
    foundVia: c.foundVia,
    brand: c.brief?.brandName ?? "",
    savedBy: c.claimedBy.name,
    savedAt: c.claimedAt.toISOString().replace("T", " ").slice(0, 16),
  }));
  return creatorsToCsv(csvRows);
}

export function csvDownload(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]+/g, "-")}"`,
      "Cache-Control": "no-store",
    },
  });
}
