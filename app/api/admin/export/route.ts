import { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { csvDownload, exportCreatorsCsv } from "@/lib/exportCreators";
import type { Prisma } from "@/app/generated/prisma/client";

/** Admin: every saved creator, optionally narrowed by `userId`, `briefId`, `from`/`to` (YYYY-MM-DD). */
export async function GET(req: NextRequest) {
  const { error } = await requireApiUser({ admin: true });
  if (error) return error;
  const q = req.nextUrl.searchParams;
  const where: Prisma.CreatorWhereInput = {};
  if (q.get("userId")) where.claimedById = q.get("userId")!;
  if (q.get("briefId")) where.briefId = q.get("briefId")!;
  const from = q.get("from");
  const to = q.get("to");
  if (from || to) {
    where.claimedAt = {
      ...(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}),
      ...(to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { lt: new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000) } : {}),
    };
  }
  if (q.get("emailOnly") === "1") where.email = { not: null };
  return csvDownload(await exportCreatorsCsv(where), `team-creators-${new Date().toISOString().slice(0, 10)}.csv`);
}


function selectedCreatorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 20_000);
}

/** Admin: export only creator rows explicitly selected in the merged/list UI. */
export async function POST(req: NextRequest) {
  const { error } = await requireApiUser({ admin: true });
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as { creatorIds?: unknown };
  const creatorIds = selectedCreatorIds(body.creatorIds);
  if (creatorIds.length === 0) {
    return new Response(JSON.stringify({ error: "Select at least one creator" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return csvDownload(
    await exportCreatorsCsv({ id: { in: creatorIds } }),
    `team-creators-selected-${new Date().toISOString().slice(0, 10)}.csv`
  );
}
