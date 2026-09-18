import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { parseBriefInput } from "@/lib/briefs";

export async function POST(req: NextRequest) {
  const { user, error } = await requireApiUser({ admin: true });
  if (error) return error;
  const parsed = parseBriefInput(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const brief = await prisma.brandBrief.create({ data: { ...parsed.data, createdById: user.id }, select: { id: true } });
  return NextResponse.json({ id: brief.id });
}
