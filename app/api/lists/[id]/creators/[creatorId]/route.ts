import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { loadManageableList } from "@/lib/lists";
import { cleanEmail, EMAIL_PATTERN, setCreatorEmail } from "@/lib/reveals";

type Ctx = { params: Promise<{ id: string; creatorId: string }> };

/**
 * Set or correct a creator's email by hand — typically one a member revealed themselves on the
 * channel's About page. An empty email clears it.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const { id, creatorId } = await params;
  const list = await loadManageableList(id, user);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
  const creator = await prisma.creator.findFirst({ where: { id: creatorId, listId: list.id }, select: { id: true, channelUrl: true, email: true } });
  if (!creator) return NextResponse.json({ error: "Creator not found in this list" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = cleanEmail(body.email);
  if (!email) {
    await prisma.creator.update({ where: { id: creator.id }, data: { email: null, emailSource: null, emailSourceUrl: null } });
    return NextResponse.json({ ok: true, email: null });
  }
  if (!EMAIL_PATTERN.test(email)) return NextResponse.json({ error: "That doesn't look like an email address" }, { status: 400 });
  await setCreatorEmail(creator, email, "YouTube About page (revealed by hand)");
  return NextResponse.json({ ok: true, email });
}

/** Remove one creator from a list and release its team-wide discovery assignment. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const { id, creatorId } = await params;
  const list = await loadManageableList(id, user);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
  const creator = await prisma.creator.findFirst({ where: { id: creatorId, listId: list.id }, select: { id: true, channelId: true } });
  if (!creator) return NextResponse.json({ error: "Creator not found in this list" }, { status: 404 });

  await prisma.$transaction([
    prisma.creator.delete({ where: { id: creator.id } }),
    prisma.discoveryAssignment.deleteMany({ where: { channelId: creator.channelId } }),
  ]);
  return NextResponse.json({ ok: true });
}
