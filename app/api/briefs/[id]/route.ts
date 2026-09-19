import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { parseBriefInput } from "@/lib/briefs";

type Ctx = { params: Promise<{ id: string }> };

/** Edit the brief, or archive/restore it with `{ status }`. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { error } = await requireApiUser({ admin: true });
  if (error) return error;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (body && Object.keys(body).length === 1 && (body.status === "ACTIVE" || body.status === "ARCHIVED")) {
    await prisma.brandBrief.update({ where: { id }, data: { status: body.status } });
    return NextResponse.json({ ok: true });
  }

  const parsed = parseBriefInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Do not allow an admin form save to create an already-expired deadline.
  // To reopen an expired campaign, the admin must explicitly choose a new future deadline.
  if (parsed.data.deadlineAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Campaign deadline must be in the future" }, { status: 400 });
  }

  await prisma.brandBrief.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}

/** Deletes the brief only. Lists and saved creators stay with the people who found them. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { error } = await requireApiUser({ admin: true });
  if (error) return error;
  const { id } = await params;
  await prisma.brandBrief.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
