import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isoDay } from "@/lib/format";
import { PageHeader } from "../../../../components/ui";
import BriefForm from "../../BriefForm";

export default async function EditBriefPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser({ admin: true });
  const brief = await prisma.brandBrief.findUnique({ where: { id: (await params).id } });
  if (!brief) notFound();
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title={`Edit — ${brief.brandName}`} />
      <BriefForm
        id={brief.id}
        initial={{ ...brief, briefDate: isoDay(brief.briefDate), deadlineAt: brief.deadlineAt?.toISOString() ?? null }}
      />
    </div>
  );
}
