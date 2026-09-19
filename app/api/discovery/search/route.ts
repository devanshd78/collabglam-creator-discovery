import { NextRequest, NextResponse } from "next/server";
import { runDiscoverySearch, PLATFORM_KEYS, type PlatformKey, type DiscoverySortBy } from "@/lib/youtube/discoveryEngine";
import { SUBSCRIBER_TIERS } from "@/lib/youtube/creatorSignals";
import { AUDIENCE_CATEGORY_KEYS } from "@/lib/youtube/audienceEstimation";
import { requireApiUser } from "@/lib/auth";
import { fromDiscovered } from "@/lib/creatorRecord";
import { ndjsonResponse } from "@/lib/ndjson";
import { findClaimed, saveRun } from "@/lib/team";
import { recordUnitsUsed } from "@/lib/usage";
import { BriefClosedError, requireBriefAcceptingEntries } from "@/lib/briefAvailability";
import { getAssignedYoutubeApiKey, withYoutubeApiKey, YoutubeApiKeyAssignmentError } from "@/lib/youtube/keys";

export const maxDuration = 300;

const VALID_PLATFORMS = new Set<string>(PLATFORM_KEYS);
const VALID_SORT_ORDERS = new Set(["relevance", "viewCount", "date"]);
const VALID_SORT_BY = new Set<string>(["relevance", "quality", "subscribers", "engagement", "avgViews", "recentUpload"]);
const VALID_TIERS = new Set(SUBSCRIBER_TIERS.map((t) => t.key));
const VALID_CATEGORIES = new Set(AUDIENCE_CATEGORY_KEYS);

function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.max(n, min), max);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Quick keyword search (the Search tab). Same streaming and run-saving as campaign discovery. */
export async function POST(req: NextRequest) {
  const { user, error } = await requireApiUser();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return NextResponse.json({ error: "Enter a niche or keyword to search for" }, { status: 400 });
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
  const platforms = stringList(body.platforms).filter((p): p is PlatformKey => VALID_PLATFORMS.has(p));
  const subscriberTiers = stringList(body.subscriberTiers).filter((t) => VALID_TIERS.has(t));
  const categories = stringList(body.categories).filter((c) => VALID_CATEGORIES.has(c));
  const country = typeof body.country === "string" && /^[A-Za-z]{2}$/.test(body.country) ? body.country.toUpperCase() : undefined;
  const language = typeof body.language === "string" && /^[a-z]{2}$/.test(body.language) ? body.language : undefined;

  return ndjsonResponse((send) =>
    withYoutubeApiKey(assignedKey.secret, async () => {
    const result = await runDiscoverySearch(
      {
        query,
        expandKeywords: !!body.expandKeywords,
        country,
        language,
        minSubscribers: optionalNumber(body.minSubscribers, 1, 1e9),
        maxSubscribers: optionalNumber(body.maxSubscribers, 1, 1e9),
        subscriberTiers: subscriberTiers.length > 0 ? subscriberTiers : undefined,
        minAverageViews: optionalNumber(body.minAverageViews, 1, 1e9),
        maxAverageViews: optionalNumber(body.maxAverageViews, 1, 1e9),
        minEngagementRate: optionalNumber(body.minEngagementRate, 0.01, 100),
        postedWithinDays: optionalNumber(body.postedWithinDays, 1, 3650),
        platforms: platforms.length > 0 ? platforms : undefined,
        hasEmail: !!body.hasEmail,
        minBrandSafety: optionalNumber(body.minBrandSafety, 1, 100),
        minSponsorshipFrequency: optionalNumber(body.minSponsorshipFrequency, 1, 100),
        excludeBrandChannels: body.excludeBrandChannels !== false,
        categories: categories.length > 0 ? categories : undefined,
        sortOrder: VALID_SORT_ORDERS.has(String(body.sortOrder)) ? (body.sortOrder as "relevance" | "viewCount" | "date") : undefined,
        sortBy: VALID_SORT_BY.has(String(body.sortBy)) ? (body.sortBy as DiscoverySortBy) : "relevance",
        maxResults: Math.min(Math.max(Number(body.maxResults) || 20, 5), 50),
      },
      send,
      findClaimed
    );
    await recordUnitsUsed(result.unitsUsed).catch(() => undefined);
    const stored = result.results.map(fromDiscovered);
    const savedRun = await saveRun({
      userId: user.id,
      briefId,
      kind: "search",
      query,
      results: stored,
      hiddenAsClaimed: result.hiddenAsClaimed,
      unitsUsed: result.unitsUsed,
    });
    return {
      runId: savedRun.runId,
      creators: savedRun.results,
      candidateCount: result.candidateCount,
      hiddenAsClaimed: savedRun.hiddenAsClaimed,
      searchedPhrases: result.searchedPhrases,
      unitsUsed: result.unitsUsed,
    };
    })
  );
}
