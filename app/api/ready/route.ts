import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Read model columns as well as checking connectivity. SELECT 1 can succeed
    // while missing migrations still make login and campaign pages fail.
    await Promise.all([
      prisma.user.findMany({ take: 1 }),
      prisma.brandBrief.findMany({ take: 1 }),
    ]);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "database_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
