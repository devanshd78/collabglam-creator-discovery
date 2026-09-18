/**
 * Steps 6–9 of campaign discovery: one creator's classified video history becomes a score, a tier,
 * collaboration evidence and false-positive checks.
 *
 * The creator is the unit being judged, never a single video — one on-topic upload is exactly the
 * pattern the false-positive rules exist to catch. And every sentence this produces is built from
 * counts over videos that were actually fetched: nothing here states a number, a market or a
 * sponsorship that wasn't observed, and anything that couldn't be observed says so.
 */
import type { NormalizedChannel } from "@/lib/youtube/normalize";
import { extractChannelContact, type ExtractedPlatformLinks } from "@/lib/youtube/channelExtractor";
import { median } from "@/lib/youtube/creatorSignals";
import type { CampaignProfile } from "./campaignProfile";
import { PRODUCT_FORMAT_TYPES, type ClassifiedVideo, type ContentType, type ProductRelevance } from "./videoClassifier";

const DAY_MS = 86_400_000;

export type CreatorTier = "A" | "B" | "C" | "D";
export type MarketFit = "verified" | "likely" | "not verified" | "mismatch" | "not required";

export const SCORE_WEIGHTS = {
  contentRelevance: 35,
  reviewBehavior: 20,
  productSimilarity: 15,
  marketFit: 10,
  consistency: 10,
  engagement: 10,
} as const;

export interface ScoreBreakdown {
  contentRelevance: number;
  reviewBehavior: number;
  productSimilarity: number;
  marketFit: number;
  consistency: number;
  engagement: number;
  total: number;
}

export interface EvidenceVideo {
  title: string;
  url: string;
  views: number;
  publishedAt: string | null;
  contentType: ContentType;
  productRelevance: ProductRelevance;
  whyRelevant: string;
}

export interface QualifiedCreator {
  rank: number;
  channelId: string;
  title: string;
  channelUrl: string;
  thumbnailUrl: string;
  description: string;
  /** The channel's own declared country, or "" when it doesn't set one. */
  country: string;
  subscriberCount: number;
  videoCount: number;
  email: string | null;
  /** Where the email was found ("Channel description", "linktr.ee/jane", "janedoe.com/contact"…). */
  emailSource: string | null;
  emailSourceUrl: string | null;
  /** Other addresses seen during research, best first — for a human to double-check. */
  emailCandidates: string[];
  emailPagesChecked: number;
  platformLinks: ExtractedPlatformLinks;
  /** The creator's own websites and link-in-bio pages. */
  websiteLinks: string[];

  tier: CreatorTier;
  score: ScoreBreakdown;
  analyzedVideoCount: number;
  /** Videos scoring 3+ on product relevance — directly about the target or a related product. */
  relevantVideoCount: number;
  relatedVideoCount: number;
  productFormatVideoCount: number;
  newestRelevantAt: string | null;
  lastUploadAt: string | null;

  mainContent: string;
  resolvedCategory: string;
  productTypesReviewed: string[];
  whyFit: string[];
  concerns: string[];
  rejectionReasons: string[];
  /** Observed commercial/product-review activity. Distinct from sponsorshipAvailability below. */
  commercialEvidence: string[];
  /** Public data can show that a creator does commercial work; it can never show whether they're
   * currently open to a sponsorship, so this is never anything but unverified. */
  sponsorshipAvailability: "Not verified";
  marketFit: MarketFit;
  marketEvidence: string;

  engagementRate: number | null;
  medianViews: number | null;
  averageViews: number | null;
  viewToSubscriberRate: number | null;
  evidence: EvidenceVideo[];
  discoveredVia: string[];
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isProductFormat(v: ClassifiedVideo): boolean {
  return PRODUCT_FORMAT_TYPES.has(v.contentType);
}

function summarizeTypes(videos: ClassifiedVideo[], limit: number): string {
  const counts = new Map<ContentType, number>();
  for (const v of videos) counts.set(v.contentType, (counts.get(v.contentType) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([type, n]) => `${type} ×${n}`)
    .join(", ");
}

function assessMarket(declared: string, target: string, videos: ClassifiedVideo[]): { fit: MarketFit; points: number; evidence: string } {
  if (!target) return { fit: "not required", points: SCORE_WEIGHTS.marketFit, evidence: "No market requested" };

  if (declared) {
    return declared.toUpperCase() === target
      ? { fit: "verified", points: SCORE_WEIGHTS.marketFit, evidence: `Channel country is set to ${target}` }
      : { fit: "mismatch", points: 0, evidence: `Channel country is ${declared.toUpperCase()}, not ${target}` };
  }

  // Most channels never declare a country, so an undeclared one is judged on the store domains and
  // currency their own videos use — and even strong signals only ever reach "likely".
  const counts = new Map<string, number>();
  for (const v of videos) for (const code of new Set(v.countrySignals)) counts.set(code, (counts.get(code) ?? 0) + 1);
  const matching = counts.get(target) ?? 0;
  const [otherCode, otherCount] = [...counts.entries()].filter(([code]) => code !== target).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

  if (matching >= 2 && matching >= otherCount) {
    return { fit: "likely", points: 6, evidence: `No declared country, but ${matching} videos carry ${target} market signals (store links or currency)` };
  }
  if (otherCount >= 3 && matching === 0) {
    return { fit: "not verified", points: 1, evidence: `No declared country, and uploads point to ${otherCode} rather than ${target}` };
  }
  return { fit: "not verified", points: 3, evidence: `Market not verified — no declared country and no clear ${target} signals` };
}

export function qualifyCreator(input: {
  channel: NormalizedChannel;
  videos: ClassifiedVideo[];
  profile: CampaignProfile;
  discoveredVia: string[];
  resolvedCategory: string;
}): QualifiedCreator {
  const { channel, videos, profile, resolvedCategory } = input;

  // "What they make now" is read from recent uploads only; history (older pages, older videos
  // search surfaced) still counts toward depth and consistency, but can't pass for current focus.
  const recent = videos.filter((v) => !v.isHistorical);
  const base = recent.length > 0 ? recent : videos;

  const strong = videos.filter((v) => v.productRelevance >= 3);
  const related = videos.filter((v) => v.productRelevance >= 2);
  const productFormat = videos.filter(isProductFormat);
  const shareStrong = base.length > 0 ? base.filter((v) => v.productRelevance >= 3).length / base.length : 0;
  const formatShare = base.length > 0 ? base.filter(isProductFormat).length / base.length : 0;
  const tutorialShare = base.length > 0 ? base.filter((v) => v.contentType === "Tutorial").length / base.length : 0;

  /* ---- Content relevance (35): share of current uploads, depth of evidence, strength of the best ---- */
  const top5Strength = [...videos]
    .sort((a, b) => b.productRelevance - a.productRelevance)
    .slice(0, 5)
    .reduce((sum, v) => sum + v.productRelevance, 0) / 25;
  const contentRelevance =
    SCORE_WEIGHTS.contentRelevance * (0.4 * Math.min(1, shareStrong / 0.5) + 0.35 * Math.min(1, strong.length / 6) + 0.25 * top5Strength);

  /* ---- Review/unboxing behavior (20): any product, not just the target — it measures the habit ---- */
  const reviewBehavior = SCORE_WEIGHTS.reviewBehavior * (0.6 * Math.min(1, formatShare / 0.4) + 0.4 * Math.min(1, productFormat.length / 10));

  /* ---- Product similarity (15): product-format videos about the target or related products ---- */
  const similar = videos.filter((v) => isProductFormat(v) && v.productRelevance >= 2);
  const termFrequency = new Map<string, number>();
  for (const v of similar) for (const term of v.matchedTerms) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
  const productSimilarity =
    SCORE_WEIGHTS.productSimilarity * (0.6 * Math.min(1, similar.length / 5) + 0.4 * Math.min(1, termFrequency.size / 3));

  /* ---- Market fit (10) ---- */
  const market = assessMarket(channel.country, profile.market, videos);

  /* ---- Consistency (10): recurring rather than a one-off burst ---- */
  const relevantDates = strong
    .map((v) => v.publishedAt)
    .filter((d): d is string => !!d)
    .sort();
  const relevantMonths = new Set(relevantDates.map((d) => d.slice(0, 7))).size;
  const countPart = strong.length >= 8 ? 6 : strong.length >= 5 ? 5 : strong.length >= 3 ? 4 : strong.length === 2 ? 2 : 0;
  const consistency = countPart + Math.min(4, relevantMonths);

  /* ---- Engagement (10) ---- */
  const withViews = base.filter((v) => v.views > 0);
  let engagementRate: number | null = null;
  let medianViews: number | null = null;
  let averageViews: number | null = null;
  let viewToSubscriberRate: number | null = null;
  let engagement = 0;
  if (withViews.length > 0) {
    const totalViews = withViews.reduce((sum, v) => sum + v.views, 0);
    const interactions = withViews.reduce((sum, v) => sum + v.likes + v.comments, 0);
    const er = Math.round((interactions / totalViews) * 10_000) / 100;
    const typical = median(withViews.map((v) => v.views));
    const reach = channel.subscriberCount > 0 ? round1((typical / channel.subscriberCount) * 100) : null;
    engagementRate = er;
    medianViews = typical;
    averageViews = Math.round(totalViews / withViews.length);
    viewToSubscriberRate = reach;
    const erPart = er >= 4 ? 5 : er >= 2 ? 4 : er >= 1 ? 3 : er >= 0.5 ? 2 : 1;
    const reachPart = reach === null ? 0 : reach >= 30 ? 5 : reach >= 15 ? 4 : reach >= 8 ? 3 : reach >= 3 ? 2 : 1;
    engagement = erPart + reachPart;
  }

  const newestRelevantAt = relevantDates.length > 0 ? relevantDates[relevantDates.length - 1] : null;
  const recentDates = recent
    .map((v) => v.publishedAt)
    .filter((d): d is string => !!d)
    .sort();
  const lastUploadAt = recentDates.length > 0 ? recentDates[recentDates.length - 1] : null;

  /* ---- False positives (step 9) ---- */
  const productLabel = profile.targetProducts.slice(0, 3).join(", ") || profile.category || "the target products";
  const rejectionReasons: string[] = [];
  if (strong.length === 0) {
    rejectionReasons.push(`No videos directly about ${productLabel} — the channel matched a search keyword only`);
  } else if (strong.length === 1 && shareStrong < 0.05) {
    rejectionReasons.push(`Only 1 relevant video in ${videos.length} analyzed — looks incidental to their normal content`);
  }
  if (newestRelevantAt && Date.now() - Date.parse(newestRelevantAt) > 3 * 365 * DAY_MS) {
    rejectionReasons.push(`Most recent relevant video is from ${monthYear(newestRelevantAt)} — no longer representative`);
  }
  if (profile.requireProductReviewers) {
    if (productFormat.length === 0) {
      rejectionReasons.push(`No review, unboxing or testing videos in ${videos.length} analyzed uploads`);
    } else if (formatShare < 0.1 && tutorialShare >= 0.4) {
      rejectionReasons.push(`Mostly tutorial/workout content (${pct(tutorialShare)} of recent uploads) with little product-review behavior`);
    }
  }
  if (market.fit === "mismatch") rejectionReasons.push(market.evidence);
  if (profile.minSubscribers && channel.subscriberCount < profile.minSubscribers) {
    rejectionReasons.push(`${channel.subscriberCount.toLocaleString()} subscribers is below the ${profile.minSubscribers.toLocaleString()} minimum`);
  }
  if (profile.maxSubscribers && channel.subscriberCount > profile.maxSubscribers) {
    rejectionReasons.push(`${channel.subscriberCount.toLocaleString()} subscribers is above the ${profile.maxSubscribers.toLocaleString()} maximum`);
  }
  if (profile.minEngagementRate && engagementRate !== null && engagementRate < profile.minEngagementRate) {
    rejectionReasons.push(`Engagement of ${engagementRate}% is below the ${profile.minEngagementRate}% requirement`);
  }

  /* ---- Score and tier (steps 6–7) ---- */
  const total = Math.round(contentRelevance + reviewBehavior + productSimilarity + market.points + consistency + engagement);
  const score: ScoreBreakdown = {
    contentRelevance: round1(contentRelevance),
    reviewBehavior: round1(reviewBehavior),
    productSimilarity: round1(productSimilarity),
    marketFit: market.points,
    consistency,
    engagement,
    total,
  };

  const tier: CreatorTier =
    rejectionReasons.length > 0
      ? "D"
      : total >= 72 && strong.length >= 4 && (!profile.requireProductReviewers || formatShare >= 0.2)
        ? "A"
        : // Two relevant videos in fifty-plus is "occasionally covers it" (C), not meaningful coverage.
          total >= 55 && strong.length >= 3
          ? "B"
          : total >= 35
            ? "C"
            : "D";

  /* ---- Summary ---- */
  const typeCounts = new Map<ContentType, number>();
  for (const v of base) typeCounts.set(v.contentType, (typeCounts.get(v.contentType) ?? 0) + 1);
  const rankedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const specificTypes = rankedTypes.filter(([type]) => type !== "General Content");
  const leadTypes = (specificTypes.length > 0 ? specificTypes : rankedTypes).slice(0, 2).map(([type]) => type);
  const mainContent = [leadTypes.join(" & "), resolvedCategory].filter(Boolean).join(" · ") || "Not available";

  const productTypesReviewed = [...termFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([term]) => term);

  const whyFit: string[] = [];
  if (strong.length > 0) {
    const terms = [...new Set(strong.flatMap((v) => v.matchedTerms))].slice(0, 3);
    whyFit.push(`${strong.length} of ${videos.length} analyzed videos are directly about ${terms.join(", ") || productLabel}`);
  }
  if (productFormat.length > 0) whyFit.push(`${productFormat.length} product-focused videos (${summarizeTypes(productFormat, 3)})`);
  if (relevantMonths > 1 && newestRelevantAt) {
    whyFit.push(`Relevant uploads span ${relevantMonths} different months, most recently ${monthYear(newestRelevantAt)}`);
  }
  if (market.fit === "verified" || market.fit === "likely") whyFit.push(market.evidence);
  if (engagementRate !== null && viewToSubscriberRate !== null) {
    whyFit.push(`${engagementRate}% engagement; a typical upload reaches ${viewToSubscriberRate}% of subscribers`);
  }

  const { email, platformLinks } = extractChannelContact(channel.description);

  const concerns: string[] = [];
  if (!email) concerns.push("No business email in the channel description — contact details not verified");
  if (market.fit === "not verified") concerns.push(market.evidence);
  if (strong.length > 0 && shareStrong < 0.2) {
    concerns.push(`Not their main focus — ${pct(shareStrong)} of recent uploads are directly relevant`);
  }
  if (strong.length > 0 && strong.every((v) => v.isHistorical)) concerns.push("Every relevant video is older than their most recent uploads");
  if (newestRelevantAt) {
    const age = Date.now() - Date.parse(newestRelevantAt);
    if (age > 548 * DAY_MS && age <= 3 * 365 * DAY_MS) concerns.push(`No relevant upload since ${monthYear(newestRelevantAt)}`);
  }
  if (engagementRate === null) concerns.push("Engagement not available");
  else if (engagementRate < 0.5) concerns.push(`Low engagement (${engagementRate}%)`);

  /* ---- Collaboration evidence (step 8) ---- */
  const commercialEvidence: string[] = [];
  if (email) commercialEvidence.push("Business email listed in the channel description");
  const affiliate = videos.filter((v) => v.hasAffiliateLinks).length;
  if (affiliate > 0) commercialEvidence.push(`Affiliate or shopping links in ${affiliate} of ${videos.length} analyzed videos`);
  const sponsored = videos.filter((v) => v.sponsored).length;
  if (sponsored > 0) commercialEvidence.push(`Sponsorship or promo-code markers in ${sponsored} videos`);
  const paid = videos.filter((v) => v.paidPlacement).length;
  if (paid > 0) commercialEvidence.push(`YouTube's "includes paid promotion" label on ${paid} videos`);
  const brandMentions = videos.filter((v) => v.mentionsBrand).length;
  if (profile.brands.length > 0 && brandMentions > 0) {
    commercialEvidence.push(`Mentions ${profile.brands.join(", ")} in ${brandMentions} videos`);
  }

  const evidence: EvidenceVideo[] = [...related]
    .sort((a, b) => b.productRelevance - a.productRelevance || Number(isProductFormat(b)) - Number(isProductFormat(a)) || b.views - a.views)
    .slice(0, 5)
    .map((v) => ({
      title: v.title,
      url: v.url,
      views: v.views,
      publishedAt: v.publishedAt,
      contentType: v.contentType,
      productRelevance: v.productRelevance,
      whyRelevant: [v.relevanceReason, v.isHistorical ? "older upload" : "", v.discoveredVia.length > 0 ? `found via "${v.discoveredVia[0]}"` : ""]
        .filter(Boolean)
        .join(" · "),
    }));

  return {
    rank: 0,
    channelId: channel.channelId,
    title: channel.title,
    channelUrl: channel.channelUrl,
    thumbnailUrl: channel.thumbnailUrl,
    description: channel.description,
    country: channel.country ? channel.country.toUpperCase() : "",
    subscriberCount: channel.subscriberCount,
    videoCount: channel.videoCount,
    email,
    emailSource: email ? "Channel description" : null,
    emailSourceUrl: null,
    emailCandidates: email ? [email.toLowerCase()] : [],
    emailPagesChecked: 0,
    platformLinks,
    websiteLinks: [],
    tier,
    score,
    analyzedVideoCount: videos.length,
    relevantVideoCount: strong.length,
    relatedVideoCount: related.length,
    productFormatVideoCount: productFormat.length,
    newestRelevantAt,
    lastUploadAt,
    mainContent,
    resolvedCategory,
    productTypesReviewed,
    whyFit,
    concerns,
    rejectionReasons,
    commercialEvidence,
    sponsorshipAvailability: "Not verified",
    marketFit: market.fit,
    marketEvidence: market.evidence,
    engagementRate,
    medianViews,
    averageViews,
    viewToSubscriberRate,
    evidence,
    discoveredVia: input.discoveredVia,
  };
}

const TIER_ORDER: Record<CreatorTier, number> = { A: 0, B: 1, C: 2, D: 3 };
const MARKET_RANK: Record<MarketFit, number> = { verified: 4, "not required": 4, likely: 3, "not verified": 2, mismatch: 0 };

/** Step 10's ordering: tier, then overall score, relevant-video count, recency of relevant content,
 * product similarity, review frequency, market fit, engagement, and commercial signals — never
 * subscriber count. */
export function compareQualified(a: QualifiedCreator, b: QualifiedCreator): number {
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    b.score.total - a.score.total ||
    b.relevantVideoCount - a.relevantVideoCount ||
    (b.newestRelevantAt ?? "").localeCompare(a.newestRelevantAt ?? "") ||
    b.score.productSimilarity - a.score.productSimilarity ||
    b.score.reviewBehavior - a.score.reviewBehavior ||
    MARKET_RANK[b.marketFit] - MARKET_RANK[a.marketFit] ||
    b.score.engagement - a.score.engagement ||
    b.commercialEvidence.length - a.commercialEvidence.length
  );
}
