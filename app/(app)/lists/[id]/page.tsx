import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateTime } from "@/lib/format";
import { PageHeader, StatCard } from "../../../components/ui";
import ListActions from "./ListActions";
import ListCreatorsTable, { type ListCreatorRow } from "./ListCreatorsTable";
import ManualCreatorButton from "./ManualCreatorButton";

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const list = await prisma.creatorList.findUnique({
    where: { id: (await params).id },
    include: { owner: { select: { name: true } }, brief: { select: { id: true, brandName: true } } },
  });
  if (!list || (list.ownerId !== user.id && user.role !== "ADMIN")) notFound();

  const creators = await prisma.creator.findMany({ where: { listId: list.id }, orderBy: { claimedAt: "desc" } });
  const withEmail = creators.filter((c) => c.email).length;
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
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={list.name}
        subtitle={[
          list.brief ? `Brand: ${list.brief.brandName}` : "No brief",
          list.ownerId !== user.id ? `Owner: ${list.owner.name}` : null,
          `Created ${dateTime(list.createdAt)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <ManualCreatorButton listId={list.id} campaignName={list.brief?.brandName} />
            <ListActions id={list.id} name={list.name} total={creators.length} withEmail={withEmail} />
          </>
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Creators" value={creators.length} />
        <StatCard label="With email" value={withEmail} hint={creators.length ? `${Math.round((withEmail / creators.length) * 100)}%` : undefined} />
        <StatCard label="From campaign match" value={creators.filter((c) => c.source === "campaign").length} />
        <StatCard label="From filter search" value={creators.filter((c) => c.source === "search").length} />
        <StatCard label="Added manually" value={creators.filter((c) => c.source === "manual").length} />
      </div>
      {creators.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted-2)]">
          This list is empty. You can add a known creator manually above, or {" "}
          <Link href={list.brief ? `/discover?brief=${list.brief.id}` : "/discover"} className="text-[var(--brand-teal-dark)] font-medium">
            find creators with Discover
          </Link>
        </div>
      ) : (
        <ListCreatorsTable listId={list.id} rows={rows} allowSelectiveExport={user.role === "ADMIN"} />
      )}
    </div>
  );
}
