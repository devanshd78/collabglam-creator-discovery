import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { hashPassword } from "@/lib/passwords";

/** Admin: add a team member. */
export async function POST(req: NextRequest) {
  const { error } = await requireApiUser({ admin: true });
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { name?: string; email?: string; password?: string; role?: string };
  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a name and a valid email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: "Someone with that email already has an account" }, { status: 409 });
  }
  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password), role: body.role === "ADMIN" ? "ADMIN" : "MEMBER" },
    select: { id: true },
  });
  return NextResponse.json({ id: user.id });
}
