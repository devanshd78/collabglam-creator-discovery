import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";

/** The member's saved creators that still need an email, oldest first. `?listId=` narrows to one list. */
export async function GET(req: NextRequest) {
  const { user, error } = await requireApiUser({ allowExtension: true });
  if (error) return error;
  const listId = req.nextUrl.searchParams.get("listId") || undefined;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 100, 1), 500);

  const creators = await prisma.creator.findMany({
    where: { list: { ownerId: user.id }, ...(listId ? { listId } : {}), email: null, noPublicEmail: false },
    orderBy: { claimedAt: "asc" },
    take: limit,
    select: { id: true, channelId: true, title: true, channelUrl: true, thumbnailUrl: true, subscriberCount: true, list: { select: { name: true } } },
  });
  return NextResponse.json({
    creators: creators.map(({ list, ...c }) => ({ ...c, listName: list.name })),
  });
}
