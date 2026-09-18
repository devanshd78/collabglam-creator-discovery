import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { csvDownload, exportCreatorsCsv } from "@/lib/exportCreators";

type Ctx = { params: Promise<{ id: string }> };

/** Download a list as CSV. `?emailOnly=1` keeps only creators with an email. Admins can export any list. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const list = await prisma.creatorList.findUnique({ where: { id: (await params).id }, select: { id: true, name: true, ownerId: true } });
  if (!list || (list.ownerId !== user.id && user.role !== "ADMIN")) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const emailOnly = req.nextUrl.searchParams.get("emailOnly") === "1";
  const csv = await exportCreatorsCsv({ listId: list.id, ...(emailOnly ? { email: { not: null } } : {}) });
  return csvDownload(csv, `${list.name}-${new Date().toISOString().slice(0, 10)}.csv`);
}
