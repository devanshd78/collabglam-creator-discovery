import { Download } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader, StatCard } from "../../../components/ui";
import ListCreatorsTable, { type ListCreatorRow } from "../[id]/ListCreatorsTable";

const MERGED_VIEW_LIMIT = 20_000;

export default async function MergedTeamListPage() {
  await requirePageUser({ admin: true });

  const [total, withEmail, memberGroups, creators] = await Promise.all([
    prisma.creator.count(),
    prisma.creator.count({ where: { email: { not: null } } }),
    prisma.creator.groupBy({ by: ["claimedById"], _count: { _all: true } }),
    prisma.creator.findMany({
      orderBy: { claimedAt: "desc" },
      take: MERGED_VIEW_LIMIT,
      include: {
        claimedBy: { select: { name: true } },
        list: { select: { id: true, name: true } },
      },
    }),
  ]);

  const rows: ListCreatorRow[] = creators.map((c) => ({
    id: c.id,
    title: c.title,
    channelUrl: c.channelUrl,
    thumbnailUrl: c.thumbnailUrl,
    country: c.country,
    subscriberCount: c.subscriberCount,
    averageViews: c.averageViews,
    engagementRate: c.engagementRate,
    email: c.email,
    emailSource: c.emailSource,
    matchScore: c.matchScore,
    tier: c.tier,
    mainContent: c.mainContent,
    source: c.source,
    claimedAt: c.claimedAt.toISOString(),
    platforms: Object.keys((c.platformLinks ?? {}) as Record<string, string>),
    listId: c.list.id,
    listName: c.list.name,
    ownerName: c.claimedBy.name,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Merged team list"
        subtitle="All creators saved by every team member in one admin view. A YouTube channel can belong to only one member at a time."
        actions={
          <>
            <a href="/api/admin/export" className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
              <Download size={13} /> Download merged CSV ({total})
            </a>
            <a href="/api/admin/export?emailOnly=1" className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
              <Download size={13} /> Only with email ({withEmail})
            </a>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Team creators" value={total} />
        <StatCard label="With email" value={withEmail} hint={total ? `${Math.round((withEmail / total) * 100)}%` : undefined} />
        <StatCard label="Contributors" value={memberGroups.length} />
        <StatCard label="Visible here" value={rows.length} hint={total > MERGED_VIEW_LIMIT ? `Latest ${MERGED_VIEW_LIMIT.toLocaleString()} shown; CSV includes all exportable rows` : "All saved creators"} />
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted-2)]">No team creators have been saved yet.</div>
      ) : (
        <ListCreatorsTable rows={rows} showTeamContext />
      )}
    </div>
  );
}
