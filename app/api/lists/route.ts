import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { BriefClosedError, requireBriefAcceptingEntries } from "@/lib/briefAvailability";

/** The signed-in user's own lists, newest first — for the "Save to list" picker. */
export async function GET() {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const lists = await prisma.creatorList.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, briefId: true, _count: { select: { creators: true } } },
  });
  return NextResponse.json({ lists: lists.map((l) => ({ id: l.id, name: l.name, briefId: l.briefId, count: l._count.creators })) });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; briefId?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Give the list a name" }, { status: 400 });
  const briefId = typeof body.briefId === "string" && body.briefId ? body.briefId : null;
  if (briefId) {
    try {
      await requireBriefAcceptingEntries(briefId);
    } catch (err) {
      if (err instanceof BriefClosedError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }
  const list = await prisma.creatorList.create({ data: { name, ownerId: user.id, briefId }, select: { id: true, name: true } });
  return NextResponse.json({ list });
}
