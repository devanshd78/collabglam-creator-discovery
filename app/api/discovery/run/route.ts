import { NextRequest, NextResponse } from "next/server";
import { normalizeProfile } from "@/lib/discovery/campaignProfile";
import { ALREADY_CLAIMED, DEPTH_SETTINGS, runCampaignDiscovery, type DiscoveryDepth } from "@/lib/discovery/campaignDiscovery";
import { requireApiUser } from "@/lib/auth";
import { fromQualified } from "@/lib/creatorRecord";
import { ndjsonResponse } from "@/lib/ndjson";
import { findClaimed, saveRun } from "@/lib/team";
import { recordUnitsUsed } from "@/lib/usage";
import { BriefClosedError, requireBriefAcceptingEntries } from "@/lib/briefAvailability";
import { getAssignedYoutubeApiKey, withYoutubeApiKey, YoutubeApiKeyAssignmentError } from "@/lib/youtube/keys";

export const maxDuration = 600;

/** Campaign discovery (the Campaign tab). Streams progress, then returns the ranked creators and
 * the id of the saved run that "Save to list" refers back to. */
export async function POST(req: NextRequest) {
  const { user, error } = await requireApiUser();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as { profile?: unknown; depth?: unknown; briefId?: unknown; brief?: unknown };
  const profile = normalizeProfile(body.profile);
  if (profile.targetProducts.length === 0) {
    return NextResponse.json({ error: "Add at least one target product or niche before running discovery" }, { status: 400 });
  }
  const depth: DiscoveryDepth = typeof body.depth === "string" && body.depth in DEPTH_SETTINGS ? (body.depth as DiscoveryDepth) : "standard";
  const briefId = typeof body.briefId === "string" && body.briefId ? body.briefId : null;
  if (briefId) {
    try {
      await requireBriefAcceptingEntries(briefId);
    } catch (err) {
      if (err instanceof BriefClosedError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }
  let assignedKey: { id: string; secret: string; label: string };
  try {
    assignedKey = await getAssignedYoutubeApiKey(user.id);
  } catch (err) {
    if (err instanceof YoutubeApiKeyAssignmentError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  return ndjsonResponse((send) =>
    withYoutubeApiKey(assignedKey.secret, async () => {
    const result = await runCampaignDiscovery(profile, depth, send, { findClaimed });
    await recordUnitsUsed(result.stats.unitsUsed).catch(() => undefined);
    const stored = result.creators.map(fromQualified);
    const savedRun = await saveRun({
      userId: user.id,
      briefId,
      kind: "campaign",
      query: typeof body.brief === "string" && body.brief.trim() ? body.brief : profile.targetProducts.join(", "),
      results: stored,
      hiddenAsClaimed: result.stats.notQualified[ALREADY_CLAIMED] ?? 0,
      unitsUsed: result.stats.unitsUsed,
    });
    const assignedIds = new Set(savedRun.results.map((c) => c.channelId));
    const assignedCreators = result.creators.filter((c) => assignedIds.has(c.channelId));
    const tierCounts = { A: 0, B: 0, C: 0, D: 0 } as Record<"A" | "B" | "C" | "D", number>;
    for (const creator of assignedCreators) tierCounts[creator.tier]++;

    // The table shows only creators atomically assigned to this member. The expanded row keeps
    // the campaign evidence from the server-side analysis for those same creators.
    const details = Object.fromEntries(
      assignedCreators.map((c) => [
        c.channelId,
        {
          score: c.score,
          evidence: c.evidence,
          commercialEvidence: c.commercialEvidence,
          rejectionReasons: c.rejectionReasons,
          marketEvidence: c.marketEvidence,
          productTypesReviewed: c.productTypesReviewed,
          relatedVideoCount: c.relatedVideoCount,
          viewToSubscriberRate: c.viewToSubscriberRate,
          emailPagesChecked: c.emailPagesChecked,
        },
      ])
    );
    const stats = {
      ...result.stats,
      emailsFound: savedRun.results.filter((c) => c.email).length,
      notQualified: { ...result.stats.notQualified, [ALREADY_CLAIMED]: savedRun.hiddenAsClaimed },
    };
    return { runId: savedRun.runId, creators: savedRun.results, details, tierCounts, stats };
    })
  );
}
