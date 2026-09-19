import Link from "next/link";
import { Download, Layers3 } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateTime } from "@/lib/format";
import { PageHeader, Td, Th } from "../../components/ui";

export default async function ListsPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const user = await requirePageUser();
  const isAdmin = user.role === "ADMIN";
  const { user: userFilter } = await searchParams;
  const ownerId = isAdmin ? userFilter || undefined : user.id;

  const [lists, members, mergedTotal, mergedEmails] = await Promise.all([
    prisma.creatorList.findMany({
      where: ownerId ? { ownerId } : {},
      orderBy: { updatedAt: "desc" },
      take: 500,
      include: {
        owner: { select: { name: true } },
        brief: { select: { id: true, brandName: true } },
        _count: { select: { creators: true } },
      },
    }),
    isAdmin ? prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    isAdmin ? prisma.creator.count() : Promise.resolve(0),
    isAdmin ? prisma.creator.count({ where: { email: { not: null } } }) : Promise.resolve(0),
  ]);
  const emails = await prisma.creator.groupBy({
    by: ["listId"],
    where: { listId: { in: lists.map((l) => l.id) }, email: { not: null } },
    _count: { _all: true },
  });
  const emailsByList = new Map(emails.map((e) => [e.listId, e._count._all]));

  return (
    <div className="space-y-5">
      <PageHeader
        title={isAdmin ? "All lists" : "My lists"}
        subtitle={
          isAdmin
            ? "Review each member's list individually or open the merged team list to see every saved creator together."
            : "Each list is a CSV you can download. Deleting a list, or removing a creator from it, frees those creators for the rest of the team."
        }
        actions={
          isAdmin ? (
            <form className="flex items-center gap-2">
              <select name="user" defaultValue={userFilter ?? ""} className="input w-auto py-1.5 text-xs">
                <option value="">Everyone</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary px-3 py-1.5 text-xs">Filter</button>
            </form>
          ) : undefined
        }
      />

      {isAdmin && (
        <div className="card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-[var(--brand-teal)]/30">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--info-bg)", color: "var(--brand-teal-dark)" }}>
              <Layers3 size={19} />
            </div>
            <div>
              <Link href="/lists/merged" className="font-semibold text-[var(--ink)] hover:underline">
                Merged team list
              </Link>
              <p className="text-[12px] text-[var(--muted)] mt-0.5">Every creator saved by every team member, automatically combined into one admin view.</p>
              <div className="text-[11.5px] text-[var(--muted-2)] mt-1">
                {mergedTotal.toLocaleString()} creators · {mergedEmails.toLocaleString()} with email
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/lists/merged" className="btn-primary px-3 py-1.5 text-xs">Open merged list</Link>
            <a href="/api/admin/export" className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
              <Download size={12} /> CSV
            </a>
          </div>
        </div>
      )}

      {lists.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted-2)]">
          No lists yet. Run a search on the{" "}
          <Link href="/discover" className="text-[var(--brand-teal-dark)] font-medium">
            Discover
          </Link>{" "}
          page and save creators to start one.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead className="border-b border-[var(--border)]">
              <tr>
                <Th>List</Th>
                <Th>Brand</Th>
                {isAdmin && <Th>Owner</Th>}
                <Th className="text-right">Creators</Th>
                <Th className="text-right">With email</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id} className="border-b border-[var(--border)] last:border-0">
                  <Td>
                    <Link href={`/lists/${l.id}`} className="font-semibold text-[var(--ink)] hover:underline">
                      {l.name}
                    </Link>
                  </Td>
                  <Td className="text-[var(--muted)]">
                    {l.brief ? (
                      <Link href={`/briefs/${l.brief.id}`} className="hover:underline">
                        {l.brief.brandName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  {isAdmin && <Td className="text-[var(--muted)]">{l.owner.name}</Td>}
                  <Td className="text-right tabular-nums">{l._count.creators}</Td>
                  <Td className="text-right tabular-nums">{emailsByList.get(l.id) ?? 0}</Td>
                  <Td className="text-[var(--muted-2)] whitespace-nowrap">{dateTime(l.updatedAt)}</Td>
                  <Td>
                    <a href={`/api/lists/${l.id}/export`} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-teal-dark)] whitespace-nowrap">
                      <Download size={12} /> CSV
                    </a>
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
