import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { claimCreators, ClaimError } from "@/lib/team";

type Ctx = { params: Promise<{ id: string }> };

/** Save creators from one of your runs into one of your lists. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; channelIds?: unknown };
  const runId = typeof body.runId === "string" ? body.runId : "";
  const channelIds = Array.isArray(body.channelIds) ? body.channelIds.filter((c): c is string => typeof c === "string").slice(0, 200) : [];
  if (!runId || channelIds.length === 0) return NextResponse.json({ error: "Select at least one creator" }, { status: 400 });

  try {
    return NextResponse.json(await claimCreators({ userId: user.id, listId: id, runId, channelIds }));
  } catch (err) {
    if (err instanceof ClaimError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
