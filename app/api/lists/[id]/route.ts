import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { loadManageableList } from "@/lib/lists";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const list = await loadManageableList((await params).id, user);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Give the list a name" }, { status: 400 });
  await prisma.creatorList.update({ where: { id: list.id }, data: { name } });
  return NextResponse.json({ ok: true });
}

/** Deleting a list also releases its creators' team-wide discovery assignments. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const list = await loadManageableList((await params).id, user);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const creators = await prisma.creator.findMany({ where: { listId: list.id }, select: { channelId: true } });
  await prisma.$transaction([
    prisma.creatorList.delete({ where: { id: list.id } }),
    prisma.discoveryAssignment.deleteMany({ where: { channelId: { in: creators.map((c) => c.channelId) } } }),
  ]);
  return NextResponse.json({ ok: true });
}
