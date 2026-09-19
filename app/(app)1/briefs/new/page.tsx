import { requirePageUser } from "@/lib/auth";
import { todayKey } from "@/lib/usage";
import { PageHeader } from "../../../components/ui";
import BriefForm from "../BriefForm";

export default async function NewBriefPage() {
  await requirePageUser({ admin: true });
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title="New brand brief" subtitle="Everyone on the team sees this and finds creators against it." />
      <BriefForm initial={{ briefDate: todayKey() }} />
    </div>
  );
}
