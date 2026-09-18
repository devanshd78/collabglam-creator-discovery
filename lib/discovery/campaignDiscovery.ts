/**
 * The campaign discovery pipeline:
 *
 *   search videos → collect creators → dedupe → load each channel's upload history → classify every
 *   video → score the creator → tier → rank → research contact emails → return evidence
 *
 * The creator is the final unit of analysis. Search is only how candidates get found; a creator
 * qualifies on what their own uploads show, not on the one video that happened to surface them.
 *
 * Quota shape (YouTube Data API): search.list uses its own Search Queries bucket, so the
 * search phase is adaptive — it stops early once new query batches mostly re-find creators already
 * in the pool. Loading a creator's history is cheap by comparison (1 unit per 50 uploads, 1 per 50
 * video stat lookups), which is what makes inspecting 50–100 uploads per creator affordable.
 */
import { searchVideos, getChannelsDetailsBatch, getChannelUploadsPage, getVideosStats } from "@/lib/youtube/api";
import { normalizeChannel, normalizeVideo, type NormalizedChannel, type NormalizedVideo } from "@/lib/youtube/normalize";
import { detectChannelKind } from "@/lib/youtube/creatorSignals";
import { estimateAudienceDemographics } from "@/lib/youtube/audienceEstimation";
import { mapWithConcurrency, researchEmails, type ResearchOutcome } from "@/lib/emailResearch";
import { buildKeywordMatrix, buildMinedQueries, mineRelatedTerms, type CampaignProfile } from "./campaignProfile";
import { buildRelevanceContext, classifyVideo, scoreProductRelevance, type ClassifiedVideo, type RelevanceContext } from "./videoClassifier";
import { compareQualified, qualifyCreator, type CreatorTier, type QualifiedCreator } from "./creatorQualifier";

export type DiscoveryDepth = "quick" | "standard" | "deep";

export const DEPTH_SETTINGS: Record<DiscoveryDepth, { label: string; maxQueries: number; analyzeLimit: number }> = {
  quick: { label: "Quick", maxQueries: 8, analyzeLimit: 25 },
  standard: { label: "Standard", maxQueries: 16, analyzeLimit: 45 },
  deep: { label: "Deep", maxQueries: 30, analyzeLimit: 70 },
};

export const ALREADY_CLAIMED = "Already assigned to someone on the team";
const SEARCH_UNIT_COST = 1;
const LOOKUP_UNIT_COST = 1;
const SEARCH_BATCH_SIZE = 4;
const MAX_POOL = 400;
/** A batch where fewer than this share of the creators it surfaced were new is "mostly duplicates". */
const NOVELTY_FLOOR = 0.15;
const MINED_TERMS_PER_PASS = 3;
const ANALYSIS_CONCURRENCY = 8;
/** Below this many relevant videos in the first 50 uploads, a second page is fetched — relevant
 * content can sit further back in a channel's history. */
const DEEPER_PAGE_THRESHOLD = 3;
const SEARCH_DEADLINE_MS = 75_000;
const ANALYSIS_DEADLINE_MS = 240_000;

export function estimateCampaignUnits(depth: DiscoveryDepth): number {
  const settings = DEPTH_SETTINGS[depth];
  const channelLookups = Math.ceil(Math.min(MAX_POOL, settings.maxQueries * 30) / 50);
  // Worst case per analyzed creator: two upload pages, their two stats calls, and one call for older
  // videos search surfaced. Most creators need two or three.
  return settings.maxQueries * SEARCH_UNIT_COST + channelLookups * LOOKUP_UNIT_COST + settings.analyzeLimit * 5 * LOOKUP_UNIT_COST;
}

const MARKET_LANGUAGE: Record<string, string> = {
  US: "en", GB: "en", CA: "en", AU: "en", NG: "en", ZA: "en", SG: "en", PH: "en",
  DE: "de", FR: "fr", ES: "es", MX: "es", BR: "pt", JP: "ja", ID: "id", IT: "it", NL: "nl",
};

export type CampaignProgressEvent =
  | { type: "stage"; stage: "search" | "channels" | "analysis" | "ranking" | "emails" | "done"; message: string }
  | { type: "progress"; queriesRun: number; queriesPlanned: number; uniqueChannels: number; analyzed: number; toAnalyze: number; unitsUsed: number }
  | { type: "emailProgress"; researched: number; toResearch: number; found: number };

export interface CampaignRunStats {
  queriesRun: string[];
  minedTerms: string[];
  stopReason: string;
  uniqueChannelsFound: number;
  analyzedCreators: number;
  /** Creators whose email was researched (every non-D creator), and how many turned one up. */
  emailsResearched: number;
  emailsFound: number;
  /** Why candidates never became results, with counts — shown so a short list reads as "the filters
   * did their job", not as a search that found nothing. */
  notQualified: Record<string, number>;
  unitsUsed: number;
  durationMs: number;
}

export interface CampaignRunResult {
  /** Every analyzed creator, ranked — tier filtering happens in the UI, since it costs nothing. */
  creators: QualifiedCreator[];
  tierCounts: Record<CreatorTier, number>;
  stats: CampaignRunStats;
}

interface PoolEntry {
  channelId: string;
  queries: Set<string>;
  videos: Map<string, { title: string; queries: Set<string> }>;
}

async function loadCreatorVideos(
  channel: NormalizedChannel,
  entry: PoolEntry,
  ctx: RelevanceContext
): Promise<{ classified: ClassifiedVideo[]; normalized: NormalizedVideo[]; units: number }> {
  let units = 0;
  const classified = new Map<string, ClassifiedVideo>();
  const normalized: NormalizedVideo[] = [];

  const add = (rawVideos: Record<string, unknown>[], isHistorical: boolean) => {
    for (const raw of rawVideos) {
      const video = normalizeVideo(raw);
      if (!video.videoId || classified.has(video.videoId)) continue;
      normalized.push(video);
      classified.set(
        video.videoId,
        classifyVideo(video, ctx, { isHistorical, discoveredVia: [...(entry.videos.get(video.videoId)?.queries ?? [])] })
      );
    }
  };

  const firstPage = await getChannelUploadsPage(channel.uploadsPlaylistId);
  units += LOOKUP_UNIT_COST;
  if (firstPage.videoIds.length > 0) {
    add(await getVideosStats(firstPage.videoIds), false);
    units += LOOKUP_UNIT_COST;
  }

  // Videos search surfaced that aren't among the recent uploads are older history — still evidence.
  const olderDiscovered = [...entry.videos.keys()].filter((id) => !classified.has(id)).slice(0, 50);
  if (olderDiscovered.length > 0) {
    add(await getVideosStats(olderDiscovered), true);
    units += LOOKUP_UNIT_COST;
  }

  const strongSoFar = [...classified.values()].filter((v) => v.productRelevance >= 3).length;
  if (strongSoFar < DEEPER_PAGE_THRESHOLD && firstPage.nextPageToken && channel.videoCount > firstPage.videoIds.length) {
    const secondPage = await getChannelUploadsPage(channel.uploadsPlaylistId, firstPage.nextPageToken);
    units += LOOKUP_UNIT_COST;
    const unseen = secondPage.videoIds.filter((id) => !classified.has(id));
    if (unseen.length > 0) {
      add(await getVideosStats(unseen), true);
      units += LOOKUP_UNIT_COST;
    }
  }

  return { classified: [...classified.values()], normalized, units };
}

export interface CampaignRunOptions {
  /** Channels already assigned to someone on the team — returns the ones in the given pool. They're
   * dropped before any history is loaded, so no quota or research time is spent on them. */
  findClaimed?: (channelIds: string[]) => Promise<Set<string>>;
}

export async function runCampaignDiscovery(
  profile: CampaignProfile,
  depth: DiscoveryDepth,
  onEvent: (event: CampaignProgressEvent) => void,
  options: CampaignRunOptions = {}
): Promise<CampaignRunResult> {
  const started = Date.now();
  const settings = DEPTH_SETTINGS[depth];
  const ctx = buildRelevanceContext(profile);
  let unitsUsed = 0;

  /* ------------------------------ Search ------------------------------ */

  const queue = buildKeywordMatrix(profile);
  const queriesRun: string[] = [];
  const minedTerms: string[] = [];
  const pool = new Map<string, PoolEntry>();
  let stopReason = "";
  let lowNoveltyStreak = 0;
  let batchNumber = 0;
  let lastError = "";

  onEvent({ type: "stage", stage: "search", message: `Searching YouTube videos across ${Math.min(queue.length, settings.maxQueries)} keyword combinations…` });

  while (queue.length > 0 && queriesRun.length < settings.maxQueries) {
    if (Date.now() - started > SEARCH_DEADLINE_MS) {
      stopReason = "Search time budget reached";
      break;
    }

    const batch = queue.splice(0, Math.min(SEARCH_BATCH_SIZE, settings.maxQueries - queriesRun.length));
    batchNumber++;
    const responses = await Promise.all(
      batch.map(async (q) => {
        try {
          return await searchVideos(q.query, {
            maxResults: 50,
            regionCode: profile.market || undefined,
            relevanceLanguage: MARKET_LANGUAGE[profile.market],
          });
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          return null;
        }
      })
    );
    unitsUsed += SEARCH_UNIT_COST * batch.length;
    queriesRun.push(...batch.map((q) => q.query));

    if (responses.every((r) => r === null)) {
      if (pool.size === 0) {
        throw new Error(`YouTube search failed${lastError ? `: ${lastError}` : ""}`);
      }
      stopReason = `YouTube stopped returning results${lastError ? ` (${lastError})` : ""} — continuing with the creators already found`;
      break;
    }

    const seenThisBatch = new Set<string>();
    let newChannels = 0;
    responses.forEach((response, i) => {
      if (!response) return;
      const query = batch[i].query;
      for (const hit of response.items) {
        seenThisBatch.add(hit.channelId);
        let entry = pool.get(hit.channelId);
        if (!entry) {
          entry = { channelId: hit.channelId, queries: new Set(), videos: new Map() };
          pool.set(hit.channelId, entry);
          newChannels++;
        }
        entry.queries.add(query);
        const known = entry.videos.get(hit.videoId);
        if (known) known.queries.add(query);
        else entry.videos.set(hit.videoId, { title: hit.title, queries: new Set([query]) });
      }
    });

    // Semantic expansion from the results themselves, after the first two batches — early enough
    // for the new searches to run at every depth, late enough to have titles worth reading.
    if (batchNumber <= 2) {
      const titlesByChannel = new Map([...pool.values()].map((e) => [e.channelId, [...e.videos.values()].map((v) => v.title)]));
      const mined = mineRelatedTerms(titlesByChannel, profile, minedTerms, MINED_TERMS_PER_PASS);
      if (mined.length > 0) {
        minedTerms.push(...mined);
        const planned = new Set([...queriesRun, ...queue.map((q) => q.query)]);
        queue.splice(Math.min(SEARCH_BATCH_SIZE, queue.length), 0, ...buildMinedQueries(profile, mined, planned));
      }
    }

    const novelty = seenThisBatch.size > 0 ? newChannels / seenThisBatch.size : 0;
    lowNoveltyStreak = batchNumber >= 3 && novelty < NOVELTY_FLOOR ? lowNoveltyStreak + 1 : 0;

    onEvent({
      type: "progress",
      queriesRun: queriesRun.length,
      queriesPlanned: Math.min(settings.maxQueries, queriesRun.length + queue.length),
      uniqueChannels: pool.size,
      analyzed: 0,
      toAnalyze: 0,
      unitsUsed,
    });

    if (lowNoveltyStreak >= 2) {
      stopReason = "Diminishing returns — the last two query batches mostly re-found creators already in the pool";
      break;
    }
    if (pool.size >= MAX_POOL) {
      stopReason = `Candidate pool reached ${MAX_POOL} creators`;
      break;
    }
  }
  if (!stopReason) {
    stopReason = queue.length === 0 ? "Every planned keyword combination was searched" : `Reached the ${settings.maxQueries}-search limit for ${settings.label} depth`;
  }

  /* ------------------------------ Channels ------------------------------ */

  onEvent({ type: "stage", stage: "channels", message: `Loading ${pool.size} channels and applying hard filters…` });

  const ids = [...pool.keys()];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const rawChannels = (await Promise.all(chunks.map((chunk) => getChannelsDetailsBatch(chunk)))).flat();
  unitsUsed += LOOKUP_UNIT_COST * chunks.length;

  const notQualified: Record<string, number> = {};
  const skip = (reason: string) => {
    notQualified[reason] = (notQualified[reason] ?? 0) + 1;
  };

  const claimed = options.findClaimed ? await options.findClaimed(ids) : new Set<string>();
  const candidates: { channel: NormalizedChannel; entry: PoolEntry; strength: number }[] = [];
  for (const raw of rawChannels) {
    const channel = normalizeChannel(raw);
    const entry = pool.get(channel.channelId);
    if (!entry) continue;
    if (claimed.has(channel.channelId)) {
      skip(ALREADY_CLAIMED);
      continue;
    }
    if (profile.minSubscribers && channel.subscriberCount < profile.minSubscribers) {
      skip("Below the minimum subscriber count");
      continue;
    }
    if (profile.maxSubscribers && channel.subscriberCount > profile.maxSubscribers) {
      skip("Above the maximum subscriber count");
      continue;
    }
    if (profile.market && channel.country && channel.country.toUpperCase() !== profile.market) {
      skip(`Declared country isn't ${profile.market}`);
      continue;
    }
    if (detectChannelKind(channel.title, channel.description) !== "creator") {
      skip("Brand or news/media channel, not a creator");
      continue;
    }
    if (channel.videoCount === 0 || !channel.uploadsPlaylistId) {
      skip("No public uploads");
      continue;
    }
    // Ranks who gets the (cheap, but not free) history lookup: found by several different queries,
    // with several matching videos, whose titles actually name the product.
    const titleStrength = Math.max(0, ...[...entry.videos.values()].map((v) => scoreProductRelevance(v.title, "", [], ctx).score));
    candidates.push({ channel, entry, strength: entry.queries.size * 3 + Math.min(entry.videos.size, 10) * 2 + titleStrength * 4 });
  }

  candidates.sort((a, b) => b.strength - a.strength);
  const toAnalyze = candidates.slice(0, settings.analyzeLimit);
  if (candidates.length > toAnalyze.length) {
    notQualified[`Not analyzed — below the top ${settings.analyzeLimit} by discovery evidence`] = candidates.length - toAnalyze.length;
  }

  /* ------------------------------ History analysis ------------------------------ */

  onEvent({ type: "stage", stage: "analysis", message: `Analyzing upload history for ${toAnalyze.length} creators…` });

  let analyzed = 0;
  const uploadDescriptions = new Map<string, string[]>();
  const qualified = await mapWithConcurrency(toAnalyze, ANALYSIS_CONCURRENCY, async ({ channel, entry }) => {
    try {
      if (Date.now() - started > ANALYSIS_DEADLINE_MS) {
        skip("Skipped — analysis time budget reached");
        return null;
      }
      const { classified, normalized, units } = await loadCreatorVideos(channel, entry, ctx);
      unitsUsed += units;
      uploadDescriptions.set(channel.channelId, normalized.slice(0, 30).map((v) => v.description));
      if (classified.length === 0) {
        skip("No readable uploads");
        return null;
      }
      const benchmarkCategory = estimateAudienceDemographics({
        tags: normalized.flatMap((v) => v.tags),
        topics: normalized.map((v) => v.categoryName).filter(Boolean),
        contentText: [channel.description, ...normalized.slice(0, 15).map((v) => v.title)].join(" "),
      }).categoryLabel;
      // Format-style categories describe how a creator films, which Main Content already states —
      // only a subject category ("fitness") adds information.
      const resolvedCategory = ["review", "unboxing", "tutorial", "podcast", "vlogging"].includes(benchmarkCategory) ? "" : benchmarkCategory;
      return qualifyCreator({ channel, videos: classified, profile, discoveredVia: [...entry.queries], resolvedCategory });
    } catch {
      skip("Couldn't load this creator's uploads");
      return null;
    } finally {
      analyzed++;
      onEvent({ type: "progress", queriesRun: queriesRun.length, queriesPlanned: queriesRun.length, uniqueChannels: pool.size, analyzed, toAnalyze: toAnalyze.length, unitsUsed });
    }
  });

  /* ------------------------------ Ranking ------------------------------ */

  onEvent({ type: "stage", stage: "ranking", message: "Scoring and ranking creators…" });

  const creators = qualified.filter((c): c is QualifiedCreator => c !== null).sort(compareQualified);
  creators.forEach((c, i) => {
    c.rank = i + 1;
  });

  const tierCounts: Record<CreatorTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const c of creators) tierCounts[c.tier]++;

  /* ------------------------------ Email research ------------------------------ */

  const toResearch = creators.filter((c) => c.tier !== "D");
  onEvent({ type: "stage", stage: "emails", message: `Researching contact emails for ${toResearch.length} matched creators…` });
  const research = await researchEmails(
    toResearch.map((c) => ({
      channelId: c.channelId,
      title: c.title,
      channelUrl: c.channelUrl,
      description: c.description,
      videoDescriptions: uploadDescriptions.get(c.channelId) ?? [],
    })),
    (researched, found) => onEvent({ type: "emailProgress", researched, toResearch: toResearch.length, found })
  );
  for (const c of toResearch) applyResearch(c, research.get(c.channelId));
  const emailsFound = toResearch.filter((c) => c.email).length;

  onEvent({ type: "stage", stage: "done", message: "Done" });

  return {
    creators,
    tierCounts,
    stats: {
      queriesRun,
      minedTerms,
      stopReason,
      uniqueChannelsFound: pool.size,
      analyzedCreators: creators.length,
      emailsResearched: toResearch.length,
      emailsFound,
      notQualified,
      unitsUsed,
      durationMs: Date.now() - started,
    },
  };
}

/** An email already written in the channel description is kept unless research found a better one. */
function applyResearch(c: QualifiedCreator, result: ResearchOutcome | undefined): void {
  if (result) {
    c.platformLinks = { ...result.platformLinks, ...c.platformLinks };
    c.websiteLinks = result.websiteLinks;
    c.emailCandidates = result.candidates.slice(0, 5).map((e) => e.email);
    c.emailPagesChecked = result.checkedUrls.length;
    if (result.email) {
      c.email = result.email;
      c.emailSource = result.source;
      c.emailSourceUrl = result.sourceUrl;
    }
  }
  if (c.email) c.concerns = c.concerns.filter((line) => !line.startsWith("No business email"));
}
