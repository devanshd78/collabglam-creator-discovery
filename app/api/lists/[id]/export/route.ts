import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { csvDownload, exportCreatorsCsv } from "@/lib/exportCreators";

type Ctx = { params: Promise<{ id: string }> };

async function loadExportableList(id: string, userId: string, role: string) {
  const list = await prisma.creatorList.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true } });
  if (!list || (list.ownerId !== userId && role !== "ADMIN")) return null;
  return list;
}

function selectedCreatorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 20_000);
}

/** Download a list as CSV. `?emailOnly=1` keeps only creators with an email. Admins can export any list. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const list = await loadExportableList((await params).id, user.id, user.role);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const emailOnly = req.nextUrl.searchParams.get("emailOnly") === "1";
  const csv = await exportCreatorsCsv({ listId: list.id, ...(emailOnly ? { email: { not: null } } : {}) });
  return csvDownload(csv, `${list.name}-${new Date().toISOString().slice(0, 10)}.csv`);
}


/** Export only creator rows explicitly selected in the list UI. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;

  const list = await loadExportableList((await params).id, user.id, user.role);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { creatorIds?: unknown };
  const creatorIds = selectedCreatorIds(body.creatorIds);
  if (creatorIds.length === 0) return NextResponse.json({ error: "Select at least one creator" }, { status: 400 });

  const csv = await exportCreatorsCsv({ listId: list.id, id: { in: creatorIds } });
  return csvDownload(csv, `${list.name}-selected-${new Date().toISOString().slice(0, 10)}.csv`);
}
