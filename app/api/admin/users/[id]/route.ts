import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { hashPassword } from "@/lib/passwords";

type Ctx = { params: Promise<{ id: string }> };

/** Admin: rename, change role, reset password, or deactivate/reactivate a member. Accounts are
 * never deleted — their saved creators and history stay attributed to them. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { user: admin, error } = await requireApiUser({ admin: true });
  if (error) return error;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; role?: string; active?: boolean; password?: string };

  const data: { name?: string; role?: "ADMIN" | "MEMBER"; active?: boolean; passwordHash?: string } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 120);
  if (body.role === "ADMIN" || body.role === "MEMBER") data.role = body.role;
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.password === "string") {
    if (body.password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    data.passwordHash = await hashPassword(body.password);
  }
  if (id === admin.id && (data.active === false || data.role === "MEMBER")) {
    return NextResponse.json({ error: "You can't deactivate or demote your own account" }, { status: 400 });
  }
  await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}
