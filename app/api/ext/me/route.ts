import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { DEFAULT_DAILY_REVEALS_PER_ACCOUNT, revealsToday } from "@/lib/reveals";

/** Who the extension is signed in as, their lists with how many creators still need an email, and
 * today's reveal counts per Google account. */
export async function GET() {
  const { user, error } = await requireApiUser({ allowExtension: true });
  if (error) return error;
  const lists = await prisma.creatorList.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, _count: { select: { creators: { where: { email: null, noPublicEmail: false } } } } },
  });
  return NextResponse.json({
    user: { name: user.name, email: user.email },
    lists: lists.map((l) => ({ id: l.id, name: l.name, needsEmail: l._count.creators })),
    today: await revealsToday(user.id),
    defaultDailyLimit: DEFAULT_DAILY_REVEALS_PER_ACCOUNT,
  });
}
