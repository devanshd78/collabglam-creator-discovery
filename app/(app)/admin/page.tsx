import Link from "next/link";
import { Download } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dailyUnitBudget, getUnitsUsedToday, startOfTodayIst, todayKey } from "@/lib/usage";
import { dateTime } from "@/lib/format";
import { PageHeader, StatCard, Td, Th } from "../../components/ui";

const PERIODS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "all", label: "All time", days: null },
] as const;

function istDay(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requirePageUser({ admin: true });
  const periodKey = (await searchParams).period ?? "today";
  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[0];
  const since = period.days ? new Date(startOfTodayIst().getTime() - (period.days - 1) * 86_400_000) : null;
  const claimedAt = since ? { gte: since } : undefined;
  const createdAt = since ? { gte: since } : undefined;

  const [users, saved, savedEmail, runs, recentRuns, unitsToday, reveals] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true } }),
    prisma.creator.groupBy({ by: ["claimedById"], where: { claimedAt }, _count: { _all: true }, _max: { claimedAt: true } }),
    prisma.creator.groupBy({ by: ["claimedById"], where: { claimedAt, email: { not: null } }, _count: { _all: true } }),
    prisma.searchRun.groupBy({ by: ["userId"], where: { createdAt }, _count: { _all: true }, _sum: { unitsUsed: true, resultCount: true } }),
    prisma.searchRun.findMany({
      where: { createdAt },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        kind: true,
        query: true,
        resultCount: true,
        emailsFound: true,
        hiddenAsClaimed: true,
        unitsUsed: true,
        createdAt: true,
        user: { select: { name: true } },
        brief: { select: { id: true, brandName: true } },
      },
    }),
    getUnitsUsedToday(),
    prisma.emailReveal.groupBy({ by: ["userId"], where: { createdAt, outcome: "revealed" }, _count: { _all: true } }),
  ]);
  const revealsBy = new Map(reveals.map((r) => [r.userId, r._count._all]));
  const savedBy = new Map(saved.map((r) => [r.claimedById, r]));
  const emailBy = new Map(savedEmail.map((r) => [r.claimedById, r._count._all]));
  const runsBy = new Map(runs.map((r) => [r.userId, r]));
  const totalSaved = saved.reduce((s, r) => s + r._count._all, 0);
  const totalEmail = savedEmail.reduce((s, r) => s + r._count._all, 0);
  const totalRuns = runs.reduce((s, r) => s + r._count._all, 0);
  const totalUnits = runs.reduce((s, r) => s + (r._sum.unitsUsed ?? 0), 0);

  const rows = users
    .map((u) => ({
      ...u,
      saved: savedBy.get(u.id)?._count._all ?? 0,
      lastSaved: savedBy.get(u.id)?._max.claimedAt ?? null,
      emails: emailBy.get(u.id) ?? 0,
      runs: runsBy.get(u.id)?._count._all ?? 0,
      units: runsBy.get(u.id)?._sum.unitsUsed ?? 0,
      revealed: revealsBy.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.saved - a.saved || b.emails - a.emails || a.name.localeCompare(b.name));

  const exportQuery = since ? `&from=${istDay(since)}&to=${todayKey()}` : "";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team performance"
        subtitle="How many creators each member found and saved, and how many of those have a real email."
        actions={
          <>
            <div className="flex rounded-full border border-[var(--border)] p-0.5 bg-[var(--surface)]">
              {PERIODS.map((p) => (
                <Link
                  key={p.key}
                  href={`/admin?period=${p.key}`}
                  className="px-3 py-1 rounded-full text-xs font-medium"
                  style={p.key === period.key ? { background: "var(--ink)", color: "var(--ink-inverse)" } : { color: "var(--muted)" }}
                >
                  {p.label}
                </Link>
              ))}
            </div>
            <a href={`/api/admin/export?${exportQuery.slice(1)}`} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
              <Download size={13} /> Export all ({totalSaved})
            </a>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Creators saved" value={totalSaved} hint={period.label} />
        <StatCard label="With real email" value={totalEmail} hint={totalSaved ? `${Math.round((totalEmail / totalSaved) * 100)}% of saved` : undefined} />
        <StatCard label="Searches run" value={totalRuns} hint={`${totalUnits.toLocaleString()} API units`} />
        <StatCard label="API quota today" value={`${unitsToday.toLocaleString()} / ${dailyUnitBudget().toLocaleString()}`} hint="YouTube resets it at midnight Pacific time (early afternoon IST)" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] min-w-[860px]">
          <thead className="border-b border-[var(--border)]">
            <tr>
              <Th>Member</Th>
              <Th className="text-right">Saved</Th>
              <Th className="text-right">With email</Th>
              <Th className="text-right">Email rate</Th>
              <Th className="text-right">Revealed on YouTube</Th>
              <Th className="text-right">Searches</Th>
              <Th className="text-right">API units</Th>
              <Th>Last saved</Th>
              <Th>Last sign-in</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0" style={r.active ? undefined : { opacity: 0.55 }}>
                <Td>
                  <div className="font-semibold text-[var(--ink)]">
                    {r.name}
                    {r.role === "ADMIN" && <span className="ml-1.5 text-[10.5px] font-medium text-[var(--muted-2)]">Admin</span>}
                    {!r.active && <span className="ml-1.5 text-[10.5px] font-medium text-[var(--danger-fg)]">Deactivated</span>}
                  </div>
                  <div className="text-[11px] text-[var(--muted-2)]">{r.email}</div>
                </Td>
                <Td className="text-right tabular-nums font-semibold">{r.saved}</Td>
                <Td className="text-right tabular-nums">{r.emails}</Td>
                <Td className="text-right tabular-nums text-[var(--muted)]">{r.saved ? `${Math.round((r.emails / r.saved) * 100)}%` : "—"}</Td>
                <Td className="text-right tabular-nums">{r.revealed}</Td>
                <Td className="text-right tabular-nums">{r.runs}</Td>
                <Td className="text-right tabular-nums text-[var(--muted)]">{r.units.toLocaleString()}</Td>
                <Td className="text-[var(--muted-2)] whitespace-nowrap">{dateTime(r.lastSaved)}</Td>
                <Td className="text-[var(--muted-2)] whitespace-nowrap">{dateTime(r.lastLoginAt)}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/lists?user=${r.id}`} className="text-xs font-medium text-[var(--brand-teal-dark)] mr-3">
                    Lists
                  </Link>
                  <a href={`/api/admin/export?userId=${r.id}${exportQuery}`} className="text-xs font-medium text-[var(--brand-teal-dark)]">
                    CSV
                  </a>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Recent searches</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[860px]">
            <thead className="border-b border-[var(--border)]">
              <tr>
                <Th>When</Th>
                <Th>Member</Th>
                <Th>Type</Th>
                <Th>Brand</Th>
                <Th>Query</Th>
                <Th className="text-right">Results</Th>
                <Th className="text-right">Emails</Th>
                <Th className="text-right">Hidden (assigned)</Th>
                <Th className="text-right">Units</Th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.length === 0 && (
                <tr>
                  <Td className="text-[var(--muted-2)]">No searches in this period.</Td>
                </tr>
              )}
              {recentRuns.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                  <Td className="text-[var(--muted-2)] whitespace-nowrap">{dateTime(r.createdAt)}</Td>
                  <Td>{r.user.name}</Td>
                  <Td className="text-[var(--muted)]">{r.kind === "campaign" ? "Campaign" : "Search"}</Td>
                  <Td className="text-[var(--muted)]">
                    {r.brief ? (
                      <Link href={`/briefs/${r.brief.id}`} className="hover:underline">
                        {r.brief.brandName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="max-w-[320px] text-[var(--muted)]">
                    <span className="line-clamp-1">{r.query}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{r.resultCount}</Td>
                  <Td className="text-right tabular-nums">{r.emailsFound}</Td>
                  <Td className="text-right tabular-nums text-[var(--muted)]">{r.hiddenAsClaimed}</Td>
                  <Td className="text-right tabular-nums text-[var(--muted)]">{r.unitsUsed}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
