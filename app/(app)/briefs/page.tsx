import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { briefDay } from "@/lib/format";
import { PageHeader, Td, Th } from "../../components/ui";

export default async function BriefsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePageUser();
  const showArchived = (await searchParams).show === "archived";
  const briefs = await prisma.brandBrief.findMany({
    where: { status: showArchived ? "ARCHIVED" : "ACTIVE" },
    orderBy: [{ briefDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { createdBy: { select: { name: true } }, _count: { select: { creators: true } } },
  });
  const emails = await prisma.creator.groupBy({
    by: ["briefId"],
    where: { briefId: { in: briefs.map((b) => b.id) }, email: { not: null } },
    _count: { _all: true },
  });
  const emailsByBrief = new Map(emails.map((e) => [e.briefId, e._count._all]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Brand briefs"
        subtitle="The campaigns the team is finding creators for. Open one to see who has found what."
        actions={
          <>
            <Link href={showArchived ? "/briefs" : "/briefs?show=archived"} className="btn-secondary px-3 py-1.5 text-xs">
              {showArchived ? "Show active" : "Show archived"}
            </Link>
            {user.role === "ADMIN" && (
              <Link href="/briefs/new" className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
                <Plus size={14} /> New brief
              </Link>
            )}
          </>
        }
      />
      {briefs.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted-2)]">{showArchived ? "No archived briefs." : "No active briefs."}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px] min-w-[760px]">
            <thead className="border-b border-[var(--border)]">
              <tr>
                <Th>Date</Th>
                <Th>Brand</Th>
                <Th>Niche / brief</Th>
                <Th>Creators saved</Th>
                <Th>With email</Th>
                <Th>Posted by</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {briefs.map((b) => (
                <tr key={b.id} className="border-b border-[var(--border)] last:border-0">
                  <Td className="whitespace-nowrap text-[var(--muted)]">{briefDay(b.briefDate)}</Td>
                  <Td>
                    <Link href={`/briefs/${b.id}`} className="font-semibold text-[var(--ink)] hover:underline">
                      {b.brandName}
                    </Link>
                    {b.market && <div className="text-[11px] text-[var(--muted-2)]">{b.market}</div>}
                  </Td>
                  <Td className="max-w-[380px] text-[var(--muted)]">
                    <div className="font-medium text-[var(--ink)] line-clamp-1">{b.targetNiche}</div>
                    <span className="line-clamp-2">{b.brief}</span>
                  </Td>
                  <Td className="tabular-nums">
                    {b._count.creators}
                    {b.targetCreators ? <span className="text-[var(--muted-2)]"> / {b.targetCreators}</span> : null}
                  </Td>
                  <Td className="tabular-nums">{emailsByBrief.get(b.id) ?? 0}</Td>
                  <Td className="text-[var(--muted)]">{b.createdBy.name}</Td>
                  <Td>
                    <Link href={`/discover?brief=${b.id}`} className="text-xs font-medium text-[var(--brand-teal-dark)] whitespace-nowrap">
                      Find creators →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
