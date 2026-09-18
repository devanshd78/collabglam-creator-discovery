import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Pencil, Search } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { briefDay, compact, dateTime } from "@/lib/format";
import { MARKETS } from "@/lib/markets";
import { PageHeader, StatCard, Td, Th } from "../../../components/ui";
import BriefStatusButton from "./BriefStatusButton";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const brief = await prisma.brandBrief.findUnique({ where: { id }, include: { createdBy: { select: { name: true } } } });
  if (!brief) notFound();

  const [byUser, byUserEmail, users, recent] = await Promise.all([
    prisma.creator.groupBy({ by: ["claimedById"], where: { briefId: id }, _count: { _all: true } }),
    prisma.creator.groupBy({ by: ["claimedById"], where: { briefId: id, email: { not: null } }, _count: { _all: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.creator.findMany({
      where: { briefId: id, ...(user.role === "ADMIN" ? {} : { claimedById: user.id }) },
      orderBy: { claimedAt: "desc" },
      take: 25,
      include: { claimedBy: { select: { name: true } } },
    }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const emailCount = new Map(byUserEmail.map((r) => [r.claimedById, r._count._all]));
  const total = byUser.reduce((s, r) => s + r._count._all, 0);
  const totalEmail = byUserEmail.reduce((s, r) => s + r._count._all, 0);
  const marketLabel = MARKETS.find((m) => m.code === brief.market)?.label;
  const range =
    brief.minSubscribers || brief.maxSubscribers
      ? `${brief.minSubscribers ? compact(brief.minSubscribers) : "any"} – ${brief.maxSubscribers ? compact(brief.maxSubscribers) : "any"} subscribers`
      : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={brief.brandName}
        subtitle={`${brief.title !== brief.brandName ? `${brief.title} · ` : ""}${briefDay(brief.briefDate)} · posted by ${brief.createdBy.name}${brief.status === "ARCHIVED" ? " · archived" : ""}`}
        actions={
          <>
            {user.role === "ADMIN" && (
              <>
                <a href={`/api/admin/export?briefId=${brief.id}`} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
                  <Download size={13} /> Export all ({total})
                </a>
                <Link href={`/briefs/${brief.id}/edit`} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
                  <Pencil size={13} /> Edit
                </Link>
                <BriefStatusButton id={brief.id} status={brief.status} />
              </>
            )}
            <Link href={`/discover?brief=${brief.id}`} className="btn-primary inline-flex items-center gap-1 px-4 py-1.5 text-xs">
              <Search size={13} /> Find creators
            </Link>
          </>
        }
      />

      <div className="card p-4 space-y-3">
        <p className="text-[13.5px] text-[var(--ink)] whitespace-pre-wrap">{brief.brief}</p>
        <div className="flex flex-wrap gap-2 text-[11.5px]">
          <Chip>Niche: {brief.targetNiche}</Chip>
          <Chip>Platform: YouTube</Chip>
          {marketLabel && brief.market && <Chip>Country: {marketLabel}</Chip>}
          {range && <Chip>{range}</Chip>}
          {brief.targetCreators && <Chip>{brief.targetCreators} creators wanted</Chip>}
          {brief.website && (
            <a href={brief.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--brand-teal-dark)]">
              <ExternalLink size={12} /> {brief.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
        {brief.notes && <p className="text-[12.5px] text-[var(--muted)]">Note: {brief.notes}</p>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="Creators saved" value={total} hint={brief.targetCreators ? `of ${brief.targetCreators} wanted` : undefined} />
        <StatCard label="With email" value={totalEmail} hint={total ? `${Math.round((totalEmail / total) * 100)}%` : undefined} />
        <StatCard label="Team members contributing" value={byUser.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-[var(--border)]">
              <tr>
                <Th>Member</Th>
                <Th className="text-right">Saved</Th>
                <Th className="text-right">Emails</Th>
              </tr>
            </thead>
            <tbody>
              {byUser.length === 0 && (
                <tr>
                  <Td className="text-[var(--muted-2)]">Nobody has saved creators for this brief yet.</Td>
                </tr>
              )}
              {[...byUser]
                .sort((a, b) => b._count._all - a._count._all)
                .map((r) => (
                  <tr key={r.claimedById} className="border-b border-[var(--border)] last:border-0">
                    <Td>{names.get(r.claimedById) ?? "Unknown"}</Td>
                    <Td className="text-right tabular-nums">{r._count._all}</Td>
                    <Td className="text-right tabular-nums">{emailCount.get(r.claimedById) ?? 0}</Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="card overflow-x-auto lg:col-span-2">
          <div className="px-3 pt-3 text-[12px] font-semibold text-[var(--ink)]">
            {user.role === "ADMIN" ? "Latest saved creators" : "Your latest saved creators"}
          </div>
          <table className="w-full text-[13px] min-w-[560px]">
            <thead className="border-b border-[var(--border)]">
              <tr>
                <Th>Creator</Th>
                <Th>Email</Th>
                <Th className="text-right">Subs</Th>
                {user.role === "ADMIN" && <Th>Saved by</Th>}
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <Td className="text-[var(--muted-2)]">Nothing saved yet.</Td>
                </tr>
              )}
              {recent.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                  <Td>
                    <a href={c.channelUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--ink)] hover:underline">
                      {c.title}
                    </a>
                  </Td>
                  <Td className="text-[var(--muted)] break-all">{c.email ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{compact(c.subscriberCount)}</Td>
                  {user.role === "ADMIN" && <Td className="text-[var(--muted)]">{c.claimedBy.name}</Td>}
                  <Td className="text-[var(--muted-2)] whitespace-nowrap">{dateTime(c.claimedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="badge" style={{ background: "var(--neutral-bg)", color: "var(--neutral-fg)", fontWeight: 500 }}>
      {children}
    </span>
  );
}
