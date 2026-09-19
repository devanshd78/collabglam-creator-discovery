import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getYoutubeApiKeyCatalog } from "@/lib/youtube/keys";

import { PageHeader } from "../../../components/ui";

import UsersClient from "./UsersClient";

export default async function UsersPage() {
  const me =
    await requirePageUser({
      admin: true,
    });

  const users =
    await prisma.user.findMany({
      orderBy: [
        {
          active: "desc",
        },
        {
          name: "asc",
        },
      ],

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        lastLoginAt: true,
        youtubeApiKeyId: true,

        _count: {
          select: {
            creators: true,
          },
        },
      },
    });

  /*
   * Maps:
   *
   * keyFingerprint -> user
   *
   * so the Admin UI knows which key is already
   * allocated.
   */
  const allocation =
    new Map<
      string,
      {
        id: string;
        name: string;
      }
    >();

  for (const user of users) {
    if (!user.youtubeApiKeyId) {
      continue;
    }

    allocation.set(
      user.youtubeApiKeyId,
      {
        id: user.id,
        name: user.name,
      }
    );
  }

  /*
   * This MUST contain all configured server keys.
   *
   * No key secret is exposed here.
   */
  const apiKeys =
    getYoutubeApiKeyCatalog().map(
      (key) => {
        const owner =
          allocation.get(
            key.id
          );

        return {
          id: key.id,

          index:
            key.index,

          label:
            key.label,

          allocatedToId:
            owner?.id ??
            null,

          allocatedToName:
            owner?.name ??
            null,
        };
      }
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team members"
        subtitle="Add people, assign one YouTube API key per account, reset passwords, and turn off access. Allocated keys cannot be reused by another user."
      />

      <UsersClient
        meId={me.id}
        users={users.map(
          (user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            active: user.active,

            lastLoginAt:
              user.lastLoginAt?.toISOString() ??
              null,

            saved:
              user._count
                .creators,

            youtubeApiKeyId:
              user.youtubeApiKeyId,
          })
        )}
        apiKeys={apiKeys}
      />
    </div>
  );
}