import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "../../../components/ui";
import UsersClient from "./UsersClient";

export default async function UsersPage() {
  const me = await requirePageUser({ admin: true });
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true, _count: { select: { creators: true } } },
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Team members" subtitle="Add people, reset passwords, and turn off access. Deactivated members keep their saved creators." />
      <UsersClient
        meId={me.id}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          saved: u._count.creators,
        }))}
      />
    </div>
  );
}
