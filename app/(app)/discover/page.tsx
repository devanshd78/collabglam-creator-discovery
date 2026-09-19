import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { BriefOption } from "@/lib/discoveryTypes";
import { PageHeader } from "../../components/ui";
import { isBriefClosed } from "@/lib/briefAvailability";
import DiscoverClient from "./DiscoverClient";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ brief?: string; tab?: string }> }) {
  await requirePageUser();
  const { brief: briefParam, tab } = await searchParams;
  const briefs = await prisma.brandBrief.findMany({
    where: {
      OR: [
        { status: "ACTIVE", OR: [{ deadlineAt: null }, { deadlineAt: { gt: new Date() } }] },
        ...(briefParam ? [{ id: briefParam }] : []),
      ],
    },
    orderBy: [{ briefDate: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: { id: true, brandName: true, title: true, brief: true, targetNiche: true, briefDate: true, market: true, minSubscribers: true, maxSubscribers: true, deadlineAt: true, status: true },
  });
  const options: BriefOption[] = briefs.map((b) => ({
    id: b.id,
    brandName: b.brandName,
    title: b.title,
    brief: b.brief,
    targetNiche: b.targetNiche,
    briefDate: b.briefDate.toISOString().slice(0, 10),
    market: b.market,
    minSubscribers: b.minSubscribers,
    maxSubscribers: b.maxSubscribers,
    deadlineAt: b.deadlineAt?.toISOString() ?? null,
    closed: isBriefClosed(b),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Discover creators"
        subtitle="Creators already returned or saved for someone on the team are hidden automatically, so each member gets a unique set of creators."
      />
      <DiscoverClient briefs={options} initialBriefId={briefParam ?? ""} initialTab={tab === "search" ? "search" : "campaign"} />
    </div>
  );
}
