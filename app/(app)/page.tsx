import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dailyUnitBudget, getUnitsUsedToday, startOfTodayIst, todayKey } from "@/lib/usage";
import { briefDay } from "@/lib/format";
import { StatCard, PageHeader } from "../components/ui";

export default async function Dashboard() {
  const user = await requirePageUser();
  const today = startOfTodayIst();
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
  const mine = { claimedById: user.id };

  const [todaySaved, todayEmails, weekSaved, totalSaved, totalEmails, unitsToday, briefs] = await Promise.all([
    prisma.creator.count({ where: { ...mine, claimedAt: { gte: today } } }),
    prisma.creator.count({ where: { ...mine, claimedAt: { gte: today }, email: { not: null } } }),
    prisma.creator.count({ where: { ...mine, claimedAt: { gte: weekAgo } } }),
    prisma.creator.count({ where: mine }),
    prisma.creator.count({ where: { ...mine, email: { not: null } } }),
    getUnitsUsedToday(),
    prisma.brandBrief.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ briefDate: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: { _count: { select: { creators: true } } },
    }),
  ]);
  const mineByBrief = await prisma.creator.groupBy({
    by: ["briefId"],
    where: { ...mine, briefId: { in: briefs.map((b) => b.id) } },
    _count: { _all: true },
  });
  const myCount = new Map(mineByBrief.map((r) => [r.briefId, r._count._all]));
  const todayIso = todayKey();
  const budget = dailyUnitBudget();

  return (
    <div className="space-y-6">
      <PageHeader title={`Hi, ${user.name.split(" ")[0]}`} subtitle="Pick today's brand brief, find matching creators, and save them to a list." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Saved today" value={todaySaved} hint={`${todayEmails} with email`} />
        <StatCard label="Last 7 days" value={weekSaved} />
        <StatCard label="All time" value={totalSaved} hint={`${totalEmails} with email`} />
        <StatCard
          label="Team API quota today"
          value={`${Math.round((unitsToday / Math.max(budget, 1)) * 100)}%`}
          hint={`${unitsToday.toLocaleString()} of ${budget.toLocaleString()} units`}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Active brand briefs</h2>
          <Link href="/briefs" className="text-xs font-medium text-[var(--brand-teal-dark)]">
            All briefs
          </Link>
        </div>
        {briefs.length === 0 ? (
          <div className="card p-8 text-center text-sm text-[var(--muted-2)]">
            <Megaphone size={22} className="mx-auto mb-2 opacity-60" />
            No active briefs yet.{" "}
            {user.role === "ADMIN" ? (
              <Link href="/briefs/new" className="text-[var(--brand-teal-dark)] font-medium">
                Post today&apos;s brief
              </Link>
            ) : (
              "Your admin will post today's brief here."
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {briefs.map((b) => {
              const isToday = b.briefDate.toISOString().slice(0, 10) === todayIso;
              return (
                <div key={b.id} className="card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/briefs/${b.id}`} className="font-semibold text-[var(--ink)] hover:underline">
                        {b.brandName}
                      </Link>
                      <div className="text-[12px] text-[var(--muted)] truncate">{b.title !== b.brandName ? b.title : ""}</div>
                    </div>
                    <span
                      className="badge shrink-0"
                      style={isToday ? { background: "var(--success-bg)", color: "var(--success-fg)" } : { background: "var(--neutral-bg)", color: "var(--neutral-fg)" }}
                    >
                      {isToday ? "Today" : briefDay(b.briefDate)}
                    </span>
                  </div>
                  <p className="text-[11.5px] font-medium text-[var(--ink)] line-clamp-1">{b.targetNiche}</p>
                  <p className="text-[12.5px] text-[var(--muted)] line-clamp-2">{b.brief}</p>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11.5px] text-[var(--muted-2)]">
                      Team {b._count.creators}
                      {b.targetCreators ? ` / ${b.targetCreators}` : ""} · you {myCount.get(b.id) ?? 0}
                    </span>
                    <Link href={`/discover?brief=${b.id}`} className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
                      Find creators <ArrowRight size={13} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
