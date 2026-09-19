import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "../../../components/ui";
import UsersClient from "./UsersClient";
import { getYoutubeApiKeyCatalog } from "@/lib/youtube/keys";

export default async function UsersPage() {
  const me = await requirePageUser({ admin: true });
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true, youtubeApiKeyId: true, _count: { select: { creators: true } } },
  });
  const allocation = new Map<string, { id: string; name: string }>();
  for (const u of users) {
    if (u.youtubeApiKeyId) allocation.set(u.youtubeApiKeyId, { id: u.id, name: u.name });
  }
  const apiKeys = getYoutubeApiKeyCatalog().map((key) => ({
    ...key,
    allocatedToId: allocation.get(key.id)?.id ?? null,
    allocatedToName: allocation.get(key.id)?.name ?? null,
  }));

  return (
    <div className="space-y-5">
      <PageHeader title="Team members" subtitle="Add people, assign one YouTube API key per account, reset passwords, and turn off access. Allocated keys cannot be reused by another user." />
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
          youtubeApiKeyId: u.youtubeApiKeyId,
        }))}
        apiKeys={apiKeys}
      />
    </div>
  );
}
