import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";

/** Revoke one of your extension keys. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const { count } = await prisma.extensionToken.deleteMany({ where: { id: (await params).id, userId: user.id } });
  if (count === 0) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
