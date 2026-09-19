import { NextRequest, NextResponse } from "next/server";
import { heuristicParseBrief, normalizeProfile } from "@/lib/discovery/campaignProfile";
import { DEPTH_SETTINGS, estimateCampaignUnits, type DiscoveryDepth } from "@/lib/discovery/campaignDiscovery";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { briefClosedReason } from "@/lib/briefAvailability";
import { hasUsableAssignedYoutubeApiKey } from "@/lib/youtube/keys";

/**
 * Brief → structured discovery profile. Spends no YouTube quota. When the brief comes from an
 * admin's brand brief, its structured fields (required niche, market, subscriber range, creator count) win over
 * whatever the text parser guessed.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await requireApiUser();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { brief?: unknown; briefId?: unknown };
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) return NextResponse.json({ error: "Describe the campaign first" }, { status: 400 });
  if (brief.length > 4000) return NextResponse.json({ error: "Keep the brief under 4,000 characters" }, { status: 400 });

  const source =
    typeof body.briefId === "string" && body.briefId
      ? await prisma.brandBrief.findUnique({ where: { id: body.briefId } })
      : null;

  if (source) {
    const closed = briefClosedReason(source);
    if (closed) return NextResponse.json({ error: closed }, { status: 409 });
  }

  const nicheTerms = source?.targetNiche
    ? source.targetNiche
        .split(/[,;\n|]/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const parserText = source?.targetNiche ? `Target niche: ${source.targetNiche}. Campaign requirements: ${brief}` : brief;
  const parsed = heuristicParseBrief(parserText);

  if (source) {
    parsed.profile = normalizeProfile({
      ...parsed.profile,
      category: nicheTerms[0] ?? parsed.profile.category,
      targetProducts: [...nicheTerms, ...parsed.profile.targetProducts],
      market: source.market ?? parsed.profile.market,
      minSubscribers: source.minSubscribers ?? parsed.profile.minSubscribers,
      maxSubscribers: source.maxSubscribers ?? parsed.profile.maxSubscribers,
      creatorCount: source.targetCreators ?? parsed.profile.creatorCount,
    });
    parsed.notes = parsed.notes.filter((n) => {
      if (source.market && n.startsWith("No market")) return false;
      if ((source.minSubscribers || source.maxSubscribers) && n.startsWith("No subscriber range")) return false;
      return true;
    });
  }

  const depths = (Object.keys(DEPTH_SETTINGS) as DiscoveryDepth[]).map((key) => ({
    key,
    ...DEPTH_SETTINGS[key],
    estimatedUnits: estimateCampaignUnits(key),
  }));
  return NextResponse.json({ ...parsed, depths, youtubeKeyConfigured: await hasUsableAssignedYoutubeApiKey(user.id) });
}
