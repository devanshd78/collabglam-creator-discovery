import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

/** First-run only: creates the first admin while the user table is empty, then closes for good. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; email?: string; password?: string };
  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!name || !email || password.length < 8) {
    return NextResponse.json({ error: "Name, email and a password of at least 8 characters are required" }, { status: 400 });
  }

  const user = await prisma.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return null;
    return tx.user.create({ data: { name, email, passwordHash: await hashPassword(password), role: "ADMIN", lastLoginAt: new Date() } });
  });
  if (!user) return NextResponse.json({ error: "Setup is already complete — sign in instead" }, { status: 409 });

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
