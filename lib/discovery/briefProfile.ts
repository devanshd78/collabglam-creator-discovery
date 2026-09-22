import "server-only";

import { heuristicParseBrief, normalizeProfile, type ParsedBrief } from "./campaignProfile";

export interface CampaignBriefProfileSource {
  brief: string;
  targetNiche: string;
  market: string | null;
  minSubscribers: number | null;
  maxSubscribers: number | null;
  targetCreators: number | null;
}

/**
 * Build the same campaign profile from a saved BrandBrief everywhere server-side.
 * Keeping this in one helper prevents manual additions and Discover from scoring
 * the same campaign with different niche/market/subscriber rules.
 */
export function profileFromBrandBrief(source: CampaignBriefProfileSource): ParsedBrief {
  const nicheTerms = source.targetNiche
    .split(/[,;\n|]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);

  const parserText = `Target niche: ${source.targetNiche}. Campaign requirements: ${source.brief}`;
  const parsed = heuristicParseBrief(parserText);

  parsed.profile = normalizeProfile({
    ...parsed.profile,
    category: nicheTerms[0] ?? parsed.profile.category,
    targetProducts: [...nicheTerms, ...parsed.profile.targetProducts],
    market: source.market ?? parsed.profile.market,
    minSubscribers: source.minSubscribers ?? parsed.profile.minSubscribers,
    maxSubscribers: source.maxSubscribers ?? parsed.profile.maxSubscribers,
    creatorCount: source.targetCreators ?? parsed.profile.creatorCount,
  });

  parsed.notes = parsed.notes.filter((note) => {
    if (source.market && note.startsWith("No market")) return false;
    if ((source.minSubscribers || source.maxSubscribers) && note.startsWith("No subscriber range")) return false;
    return true;
  });

  return parsed;
}
