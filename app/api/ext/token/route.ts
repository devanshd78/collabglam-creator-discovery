import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { createExtensionToken } from "@/lib/extensionTokens";

/** Create a key for the Chrome extension. Signed-in (cookie) users only — a key can't mint keys. */
export async function POST(req: NextRequest) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "Chrome extension";
  const count = await prisma.extensionToken.count({ where: { userId: user.id } });
  if (count >= 10) return NextResponse.json({ error: "You already have 10 keys — revoke an old one first" }, { status: 400 });
  return NextResponse.json({ token: await createExtensionToken(user.id, label) });
}
