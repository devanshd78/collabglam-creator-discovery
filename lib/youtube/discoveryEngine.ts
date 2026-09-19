/**
 * Quick keyword search — the Search tab: one search.list call per keyword phrase (merged by
 * channel), one batched channels.list, cheap filters on what that returns, then recent-upload stats
 * only for the best-matching survivors. Creators already assigned to the team are dropped before any
 * per-channel spend, and every result gets the same deep email research as a campaign run.
 */
import { searchChannels, getChannelsDetailsBatch, getRecentChannelVideoIds, getVideosStats, type SearchChannelsOptions } from "./api";
import { normalizeChannel, normalizeVideo, calculateCreatorAverage, type NormalizedChannel, type NormalizedVideo } from "./normalize";
import { extractChannelContact, type ExtractedPlatformLinks } from "./channelExtractor";
import { estimateAudienceDemographics } from "./audienceEstimation";
import {
  splitKeywordIntoPhrases,
  expandKeywords,
  computeRelevance,
  computeQualityScore,
  computeConsistency,
  computeBrandSafety,
  computeSponsorshipFrequencyPercent,
  computeContentFormatMix,
  computeUploadsInLastDays,
  countryMatchConfidence,
  countryConfidenceRank,
  detectChannelKind,
  matchesAnyTier,
  sizeTierLabel,
  median,
  type CountryConfidence,
  type ChannelKind,
} from "./creatorSignals";
import { researchEmails } from "../emailResearch";

export const PLATFORM_KEYS = ["instagram", "tiktok", "twitter", "pinterest", "facebook", "amazonStorefront"] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/** search.list has no boolean query language, so each phrase is its own 100-unit call. */
const MAX_QUERY_PHRASES = 5;
const MAX_SEARCH_HITS_PER_PHRASE = 50;
const MAX_SEARCH_PAGES_PER_PHRASE = 3;
const CHANNELS_LOOKUP_CHUNK = 50;
/** Search deeper when filters/team claims thin the first YouTube page. */
const MAX_CHANNELS_TO_INSPECT = 600;
/** Enough recent uploads to read engagement, cadence and the creator's repeated footer. */
const RECENT_SAMPLE_SIZE = 15;
/** The smallest size band offered starts at 1K; an explicit minSubscribers overrides this. */
const DEFAULT_MIN_SUBSCRIBERS = 1_000;
const SEARCH_UNIT_COST = 100;
const LOOKUP_UNIT_COST = 1;

export type DiscoverySortBy = "relevance" | "quality" | "subscribers" | "engagement" | "avgViews" | "recentUpload";

export interface DiscoveryFilters {
  /** Comma-separated phrases are searched separately and merged. */
  query: string;
  expandKeywords?: boolean;
  /** Filters on the channel's declared country; undeclared channels are kept but ranked lower. */
  country?: string;
  language?: string;
  minSubscribers?: number;
  maxSubscribers?: number;
  subscriberTiers?: string[];
  minAverageViews?: number;
  maxAverageViews?: number;
  minEngagementRate?: number;
  postedWithinDays?: number;
  platforms?: PlatformKey[];
  /** Keep only creators whose email turned up — applied after research, not just on the description. */
  hasEmail?: boolean;
  minBrandSafety?: number;
  minSponsorshipFrequency?: number;
  excludeBrandChannels?: boolean;
  categories?: string[];
  sortOrder?: "relevance" | "viewCount" | "date";
  sortBy?: DiscoverySortBy;
  maxResults: number;
}

export interface DiscoveredCreator {
  channelId: string;
  title: string;
  description: string;
  channelUrl: string;
  thumbnailUrl: string;
  country: string;
  subscriberCount: number;
  totalViewCount: number;
  videoCount: number;
  averageViews: number;
  medianViews: number;
  engagementRate: number;
  lastUploadAt: string | null;
  email: string | null;
  emailSource: string | null;
  emailSourceUrl: string | null;
  otherEmails: string[];
  platformLinks: ExtractedPlatformLinks;
  websiteLinks: string[];
  relevanceScore: number;
  matchedTerms: string[];
  qualityScore: number;
  brandSafetyLabel: string;
  brandSafetyScore: number;
  sponsorshipFrequencyPercent: number;
  uploadsLast90Days: number;
  shortsPercent: number;
  category: string;
  countryConfidence: CountryConfidence;
  channelKind: ChannelKind;
  sizeTier: string;
}

export type SearchProgressEvent =
  | { type: "stage"; message: string }
  | { type: "emailProgress"; researched: number; toResearch: number; found: number };

export interface DiscoverySearchResult {
  results: DiscoveredCreator[];
  /** Channels that passed the cheap filters — so "asked for 20, got 6" reads as "loosen filters". */
  candidateCount: number;
  hiddenAsClaimed: number;
  searchedPhrases: string[];
  unitsUsed: number;
}

function parseQueryPhrases(query: string): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const section of query.split(",")) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    for (const phrase of splitKeywordIntoPhrases(trimmed)) {
      const key = phrase.toLowerCase();
      if (!phrase || seen.has(key)) continue;
      seen.add(key);
      phrases.push(phrase);
      if (phrases.length >= MAX_QUERY_PHRASES) return phrases;
    }
  }
  return phrases;
}

function matchesAnyPlatform(platformLinks: ExtractedPlatformLinks, wanted: PlatformKey[] | undefined): boolean {
  if (!wanted || wanted.length === 0) return true;
  return wanted.some((key) => !!platformLinks[key]);
}

function sortResults(results: DiscoveredCreator[], sortBy: DiscoverySortBy | undefined): DiscoveredCreator[] {
  const sorted = [...results];
  switch (sortBy) {
    case "quality":
      return sorted.sort((a, b) => b.qualityScore - a.qualityScore || b.relevanceScore - a.relevanceScore);
    case "subscribers":
      return sorted.sort((a, b) => b.subscriberCount - a.subscriberCount);
    case "engagement":
      return sorted.sort((a, b) => b.engagementRate - a.engagementRate);
    case "avgViews":
      return sorted.sort((a, b) => b.averageViews - a.averageViews);
    case "recentUpload":
      return sorted.sort((a, b) => (b.lastUploadAt ?? "").localeCompare(a.lastUploadAt ?? ""));
    case "relevance":
    default:
      // An on-topic creator in the wrong market is the wrong answer when a country was asked for.
      return sorted.sort(
        (a, b) =>
          countryConfidenceRank(b.countryConfidence) - countryConfidenceRank(a.countryConfidence) ||
          b.relevanceScore - a.relevanceScore ||
          b.qualityScore - a.qualityScore
      );
  }
}

export async function runDiscoverySearch(
  filters: DiscoveryFilters,
  onEvent: (event: SearchProgressEvent) => void,
  findClaimed: (channelIds: string[]) => Promise<Set<string>>
): Promise<DiscoverySearchResult> {
  const basePhrases = parseQueryPhrases(filters.query);
  if (basePhrases.length === 0) return { results: [], candidateCount: 0, hiddenAsClaimed: 0, searchedPhrases: [], unitsUsed: 0 };
  const phrases = filters.expandKeywords ? expandKeywords(basePhrases, MAX_QUERY_PHRASES - basePhrases.length) : basePhrases;
  let unitsUsed = 0;

  type Candidate = NormalizedChannel & {
    email: string | null;
    platformLinks: ExtractedPlatformLinks;
    channelKind: ChannelKind;
    countryConfidence: CountryConfidence;
    preliminaryRelevance: number;
  };

  // Filters that are only knowable after recent-video/email enrichment can remove otherwise valid
  // channels. Search extra candidates up front so requesting 30 does not collapse to 6 simply
  // because the first YouTube page was thin after filtering.
  const needsHeadroom = !!(
    filters.postedWithinDays ||
    filters.minAverageViews ||
    filters.maxAverageViews ||
    filters.minEngagementRate ||
    filters.minBrandSafety ||
    filters.minSponsorshipFrequency ||
    filters.hasEmail ||
    (filters.categories && filters.categories.length > 0)
  );
  const candidateGoal = Math.min(
    MAX_CHANNELS_TO_INSPECT,
    filters.hasEmail
      ? Math.max(filters.maxResults * 4, filters.maxResults + 50)
      : needsHeadroom
        ? Math.max(filters.maxResults * 3, filters.maxResults + 20)
        : filters.maxResults
  );

  const searchOpts: Omit<SearchChannelsOptions, "pageToken"> = {
    maxResults: MAX_SEARCH_HITS_PER_PHRASE,
    relevanceLanguage: filters.language,
    regionCode: filters.country,
    order: filters.sortOrder,
  };
  const nextPageTokens: Array<string | undefined> = phrases.map(() => undefined);
  const activePhrases = phrases.map(() => true);
  const inspectedIds = new Set<string>();
  const claimed = new Set<string>();
  const candidatesById = new Map<string, Candidate>();
  const minSubscribers = filters.minSubscribers ?? DEFAULT_MIN_SUBSCRIBERS;

  onEvent({ type: "stage", message: `Searching YouTube for ${phrases.length} phrase${phrases.length === 1 ? "" : "s"}…` });

  for (let page = 0; page < MAX_SEARCH_PAGES_PER_PHRASE; page += 1) {
    if (candidatesById.size >= candidateGoal || inspectedIds.size >= MAX_CHANNELS_TO_INSPECT) break;

    const calls = phrases.map(async (phrase, index) => {
      if (!activePhrases[index]) return null;
      const pageToken = page === 0 ? undefined : nextPageTokens[index];
      if (page > 0 && !pageToken) {
        activePhrases[index] = false;
        return null;
      }
      const result = await searchChannels(phrase, { ...searchOpts, pageToken });
      return { index, result };
    });
    const pageResults = (await Promise.all(calls)).filter(
      (value): value is { index: number; result: Awaited<ReturnType<typeof searchChannels>> } => value !== null
    );
    if (pageResults.length === 0) break;
    unitsUsed += SEARCH_UNIT_COST * pageResults.length;

    const newIds: string[] = [];
    for (const { index, result } of pageResults) {
      nextPageTokens[index] = result.nextPageToken;
      activePhrases[index] = !!result.nextPageToken;
      for (const hit of result.items) {
        if (inspectedIds.has(hit.channelId) || newIds.includes(hit.channelId)) continue;
        if (inspectedIds.size + newIds.length >= MAX_CHANNELS_TO_INSPECT) break;
        newIds.push(hit.channelId);
      }
    }

    if (newIds.length === 0) {
      if (!activePhrases.some(Boolean)) break;
      continue;
    }
    for (const id of newIds) inspectedIds.add(id);

    const claimedThisPage = await findClaimed(newIds);
    for (const id of claimedThisPage) claimed.add(id);
    const unclaimedIds = newIds.filter((id) => !claimedThisPage.has(id));

    if (unclaimedIds.length > 0) {
      onEvent({ type: "stage", message: `Checking ${unclaimedIds.length} new channels (${candidatesById.size}/${filters.maxResults} eligible so far)…` });
      const chunks: string[][] = [];
      for (let i = 0; i < unclaimedIds.length; i += CHANNELS_LOOKUP_CHUNK) chunks.push(unclaimedIds.slice(i, i + CHANNELS_LOOKUP_CHUNK));
      const rawChannels = (await Promise.all(chunks.map((chunk) => getChannelsDetailsBatch(chunk)))).flat();
      unitsUsed += LOOKUP_UNIT_COST * chunks.length;

      for (const raw of rawChannels) {
        const c = normalizeChannel(raw);
        if (filters.country && c.country && c.country.toUpperCase() !== filters.country.toUpperCase()) continue;
        if (c.subscriberCount < minSubscribers) continue;
        if (filters.maxSubscribers && c.subscriberCount > filters.maxSubscribers) continue;
        if (!matchesAnyTier(c.subscriberCount, filters.subscriberTiers)) continue;

        const contact = extractChannelContact(c.description);
        const candidate: Candidate = {
          ...c,
          ...contact,
          channelKind: detectChannelKind(c.title, c.description),
          countryConfidence: countryMatchConfidence(c.country, filters.country),
          preliminaryRelevance: computeRelevance({ channelText: `${c.title} ${c.description}`, videoTexts: [], phrases: basePhrases }).score,
        };
        if (!matchesAnyPlatform(candidate.platformLinks, filters.platforms)) continue;
        if (filters.excludeBrandChannels && candidate.channelKind !== "creator") continue;
        candidatesById.set(candidate.channelId, candidate);
      }
    }

    if (candidatesById.size < candidateGoal && activePhrases.some(Boolean) && page + 1 < MAX_SEARCH_PAGES_PER_PHRASE) {
      onEvent({
        type: "stage",
        message: `Found ${candidatesById.size} eligible creator${candidatesById.size === 1 ? "" : "s"}; searching deeper to reach ${filters.maxResults}…`,
      });
    }
  }

  const candidates = [...candidatesById.values()];
  if (candidates.length === 0) {
    return { results: [], candidateCount: 0, hiddenAsClaimed: claimed.size, searchedPhrases: phrases, unitsUsed };
  }

  const survivorCap = Math.min(candidates.length, candidateGoal);
  const survivors = [...candidates].sort((a, b) => b.preliminaryRelevance - a.preliminaryRelevance).slice(0, survivorCap);

  onEvent({ type: "stage", message: `Reading recent uploads for ${survivors.length} creators…` });
  const descriptionsByChannel = new Map<string, string[]>();
  const scored = await Promise.all(
    survivors.map(async (channel): Promise<DiscoveredCreator | null> => {
      const videoIds = await getRecentChannelVideoIds(channel.uploadsPlaylistId, RECENT_SAMPLE_SIZE);
      unitsUsed += LOOKUP_UNIT_COST;
      const rawVideos = videoIds.length > 0 ? await getVideosStats(videoIds) : [];
      if (videoIds.length > 0) unitsUsed += LOOKUP_UNIT_COST;
      const average = calculateCreatorAverage(rawVideos, "");
      const videos: NormalizedVideo[] = rawVideos.map(normalizeVideo);
      descriptionsByChannel.set(channel.channelId, videos.map((v) => v.description));

      if (filters.postedWithinDays) {
        if (!average.lastPublishedAt) return null;
        const ageDays = (Date.now() - average.lastPublishedAt.getTime()) / 86_400_000;
        if (ageDays > filters.postedWithinDays) return null;
      }
      const averageViews = Math.round(average.averageViews);
      if (filters.minAverageViews && averageViews < filters.minAverageViews) return null;
      if (filters.maxAverageViews && averageViews > filters.maxAverageViews) return null;
      if (filters.minEngagementRate && average.averageEngagementRate < filters.minEngagementRate) return null;

      const { label: brandSafetyLabel, score: brandSafetyScore } = computeBrandSafety(videos);
      if (filters.minBrandSafety && brandSafetyScore < filters.minBrandSafety) return null;
      const sponsorshipFrequencyPercent = computeSponsorshipFrequencyPercent(videos);
      if (filters.minSponsorshipFrequency && sponsorshipFrequencyPercent < filters.minSponsorshipFrequency) return null;

      const { shortsPercent } = computeContentFormatMix(videos);
      const category = estimateAudienceDemographics({
        tags: videos.flatMap((v) => v.tags),
        topics: videos.map((v) => v.categoryName).filter(Boolean),
        contentText: [channel.description, ...videos.map((v) => v.title)].filter(Boolean).join(" "),
        shortsPercentage: shortsPercent,
      }).categoryLabel;
      if (filters.categories && filters.categories.length > 0 && !filters.categories.includes(category)) return null;

      const daysSinceLastUpload = average.lastPublishedAt ? (Date.now() - average.lastPublishedAt.getTime()) / 86_400_000 : null;
      const viewToSubscriberRate = channel.subscriberCount > 0 ? (averageViews / channel.subscriberCount) * 100 : 0;
      const relevance = computeRelevance({
        channelText: `${channel.title} ${channel.description}`,
        videoTexts: videos.map((v) => `${v.title} ${v.description}`),
        phrases: basePhrases,
      });

      return {
        channelId: channel.channelId,
        title: channel.title,
        description: channel.description,
        channelUrl: channel.channelUrl,
        thumbnailUrl: channel.thumbnailUrl,
        country: channel.country,
        subscriberCount: channel.subscriberCount,
        totalViewCount: channel.totalViewCount,
        videoCount: channel.videoCount,
        averageViews,
        medianViews: median(videos.map((v) => v.viewCount)),
        engagementRate: average.averageEngagementRate,
        lastUploadAt: average.lastPublishedAt ? average.lastPublishedAt.toISOString() : null,
        email: channel.email ? channel.email.toLowerCase() : null,
        emailSource: channel.email ? "Channel description" : null,
        emailSourceUrl: null,
        otherEmails: [],
        platformLinks: channel.platformLinks,
        websiteLinks: [],
        relevanceScore: relevance.score,
        matchedTerms: relevance.matchedTerms,
        qualityScore: computeQualityScore({
          engagementRate: average.averageEngagementRate,
          viewToSubscriberRate,
          consistency: computeConsistency(videos),
          brandSafetyScore,
          daysSinceLastUpload,
        }),
        brandSafetyLabel,
        brandSafetyScore,
        sponsorshipFrequencyPercent,
        uploadsLast90Days: computeUploadsInLastDays(videos, 90),
        shortsPercent,
        category,
        countryConfidence: channel.countryConfidence,
        channelKind: channel.channelKind,
        sizeTier: sizeTierLabel(channel.subscriberCount),
      };
    })
  );

  // Research more than asked for when only emailed creators are wanted, then trim.
  let results = sortResults(scored.filter((r): r is DiscoveredCreator => r !== null), filters.sortBy);
  if (!filters.hasEmail) results = results.slice(0, filters.maxResults);

  onEvent({ type: "stage", message: `Researching contact emails for ${results.length} creators…` });
  const research = await researchEmails(
    results.map((r) => ({
      channelId: r.channelId,
      title: r.title,
      channelUrl: r.channelUrl,
      description: r.description,
      videoDescriptions: descriptionsByChannel.get(r.channelId) ?? [],
    })),
    (researched, found) => onEvent({ type: "emailProgress", researched, toResearch: results.length, found })
  );
  for (const r of results) {
    const found = research.get(r.channelId);
    if (!found) continue;
    r.platformLinks = { ...found.platformLinks, ...r.platformLinks };
    r.websiteLinks = found.websiteLinks;
    r.otherEmails = found.candidates.map((c) => c.email).filter((e) => e !== found.email).slice(0, 4);
    if (found.email) {
      r.email = found.email;
      r.emailSource = found.source;
      r.emailSourceUrl = found.sourceUrl;
    }
  }
  if (filters.hasEmail) results = results.filter((r) => r.email).slice(0, filters.maxResults);

  return { results, candidateCount: candidates.length, hiddenAsClaimed: claimed.size, searchedPhrases: phrases, unitsUsed };
}

/** Worst-case unit estimate, shown before a search runs. */
export function estimateSearchUnits(phraseCount: number, maxResults: number, needsHeadroom: boolean): number {
  const phrases = Math.max(1, Math.min(phraseCount, MAX_QUERY_PHRASES));
  const candidateGoal = Math.min(MAX_CHANNELS_TO_INSPECT, needsHeadroom ? Math.max(maxResults * 3, maxResults + 20) : maxResults);
  const maxSearchCalls = phrases * MAX_SEARCH_PAGES_PER_PHRASE;
  const maxHits = Math.min(maxSearchCalls * MAX_SEARCH_HITS_PER_PHRASE, MAX_CHANNELS_TO_INSPECT);
  const lookupCalls = Math.ceil(maxHits / CHANNELS_LOOKUP_CHUNK);
  return maxSearchCalls * SEARCH_UNIT_COST + lookupCalls * LOOKUP_UNIT_COST + candidateGoal * 2 * LOOKUP_UNIT_COST;
}
