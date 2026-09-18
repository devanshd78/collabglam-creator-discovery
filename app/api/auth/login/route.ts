import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/passwords";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email || !body.password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  if (!user.active) return NextResponse.json({ error: "This account has been deactivated — ask your admin" }, { status: 403 });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
