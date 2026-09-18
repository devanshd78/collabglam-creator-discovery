/**
 * The signals Discovery reads a creator through: keyword relevance, country confidence, size
 * tiers, sponsorship frequency, brand safety, consistency and an overall quality score.
 *
 * Everything here is derived from public YouTube data only — no viewer analytics, no paid
 * provider — and every score is a disclosed formula rather than an opaque rating.
 */
import { clamp } from "./numbers";
import type { NormalizedVideo } from "./normalize";

/* -------------------------------------------------------------------------- */
/* Keyword handling                                                            */
/* -------------------------------------------------------------------------- */

/** Words that end one search idea and begin the next, so a run-on query typed as a single line
 * ("bluetooth speaker review headphone review earbuds review") becomes the three separate searches
 * the user meant, instead of one absurdly narrow phrase that matches nothing. */
const PHRASE_TERMINATORS = new Set([
  "review",
  "reviews",
  "unboxing",
  "unboxings",
  "comparison",
  "comparisons",
  "vs",
  "test",
  "tests",
  "demo",
  "demos",
  "setup",
  "setups",
  "guide",
  "guides",
  "tutorial",
  "tutorials",
  "haul",
  "tips",
]);

const MAX_SPLIT_PHRASES = 6;

/**
 * Splits a run-on query at its terminator words. Returns the original string untouched when it
 * yields only one phrase, so a deliberately-worded single query is never mangled.
 */
export function splitKeywordIntoPhrases(raw: string): string[] {
  const words = raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    // "speaker speaker review" — collapse an immediately repeated word rather than searching it twice
    .filter((word, i, all) => word !== all[i - 1]);
  if (words.length === 0) return [];

  const phrases: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    if (PHRASE_TERMINATORS.has(word) && current.length > 1) {
      phrases.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) phrases.push(current.join(" "));

  if (phrases.length <= 1) return [raw.trim()];
  return phrases.slice(0, MAX_SPLIT_PHRASES);
}

/** Suffix/prefix patterns that turn one product or niche term into the shapes creators actually
 * title videos with. Kept as data so it works for any vertical. */
const EXPANSION_TEMPLATES = [
  (k: string) => `${k} review`,
  (k: string) => `${k} unboxing`,
  (k: string) => `best ${k}`,
  (k: string) => `${k} comparison`,
  (k: string) => `${k} tutorial`,
];

/**
 * Widens a keyword set toward how creators phrase things, without turning one search into ten.
 * Only the first phrase is expanded and only up to `budget` extra phrases — each phrase is its own
 * 100-unit search.list call, so expansion is the single most expensive knob in Discovery.
 */
export function expandKeywords(phrases: string[], budget: number): string[] {
  if (budget <= 0 || phrases.length === 0) return phrases;
  const seen = new Set(phrases.map((p) => p.toLowerCase()));
  const out = [...phrases];
  for (const template of EXPANSION_TEMPLATES) {
    if (out.length - phrases.length >= budget) break;
    const candidate = template(phrases[0]);
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Relevance                                                                   */
/* -------------------------------------------------------------------------- */

/** Terms too generic to prove a creator is actually in a niche — every creator's "about" text
 * says some of these, so counting them as evidence would rank noise above real matches. */
const GENERIC_TERMS = new Set([
  "the",
  "and",
  "for",
  "with",
  "you",
  "your",
  "best",
  "top",
  "new",
  "video",
  "videos",
  "channel",
  "youtube",
  "creator",
  "creators",
  "subscribe",
  "review",
  "reviews",
  "unboxing",
  "content",
]);

export interface RelevanceInput {
  /** Channel name, description and channel keywords — what the creator says they are. */
  channelText: string;
  /** Titles/descriptions of the sampled recent uploads — what they actually publish. Empty when
   * the search skipped the per-channel video lookup (see the lazy-enrichment note in
   * discoveryEngine.ts); relevance then scores on channel text alone. */
  videoTexts: string[];
  /** The searched phrases, before expansion. */
  phrases: string[];
}

export interface RelevanceResult {
  /** 0-100. How strongly this creator's own content matches the searched terms. */
  score: number;
  /** Which searched terms were actually found, for showing the user *why* a result ranked. */
  matchedTerms: string[];
}

/**
 * How well a creator matches what was searched for, weighted toward evidence in their actual
 * uploads over evidence in their channel blurb — anyone can write "tech reviews" in a description,
 * far fewer publish twenty of them. Deliberately returns the matched terms too: an unexplained
 * relevance number is just a vibe, and a brand-facing shortlist shouldn't ship those.
 */
export function computeRelevance({ channelText, videoTexts, phrases }: RelevanceInput): RelevanceResult {
  const terms = [
    ...new Set(
      phrases
        .flatMap((p) => p.toLowerCase().split(/[\s,|/]+/))
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !GENERIC_TERMS.has(t))
    ),
  ];
  if (terms.length === 0) return { score: 0, matchedTerms: [] };

  const channel = channelText.toLowerCase();
  const videos = videoTexts.map((t) => t.toLowerCase());

  const matchedTerms: string[] = [];
  let channelHits = 0;
  let videoHitRatioTotal = 0;

  for (const term of terms) {
    const inChannel = channel.includes(term);
    const videosWithTerm = videos.filter((v) => v.includes(term)).length;
    if (inChannel) channelHits++;
    if (inChannel || videosWithTerm > 0) matchedTerms.push(term);
    if (videos.length > 0) videoHitRatioTotal += videosWithTerm / videos.length;
  }

  // Channel text caps at 40 — it proves self-description. Upload coverage caps at 60 and is the
  // dominant signal: a creator whose recent uploads consistently hit the terms is the real match.
  const channelScore = (channelHits / terms.length) * 40;
  const videoScore = videos.length > 0 ? (videoHitRatioTotal / terms.length) * 60 : 0;

  // With no video sample at all, channel evidence alone can still reach a usable score rather than
  // capping every unenriched result at 40 and making relevance sorting meaningless.
  const score = videos.length > 0 ? channelScore + videoScore : channelScore * 2;

  return { score: Math.round(clamp(score)), matchedTerms };
}

/* -------------------------------------------------------------------------- */
/* Country confidence                                                          */
/* -------------------------------------------------------------------------- */

export type CountryConfidence = "verified" | "likely" | "unknown" | "mismatch";

/**
 * Country as a confidence tier rather than a yes/no. Most channels simply don't set a country, and
 * dropping every one of them (or counting them as matches) are both wrong — this keeps them
 * visible, ranked below channels that actually declare the target country.
 */
export function countryMatchConfidence(channelCountry: string, target: string | undefined): CountryConfidence {
  if (!target) return "unknown";
  if (!channelCountry) return "unknown";
  return channelCountry.toUpperCase() === target.toUpperCase() ? "verified" : "mismatch";
}

const COUNTRY_CONFIDENCE_RANK: Record<CountryConfidence, number> = {
  verified: 3,
  likely: 2,
  unknown: 1,
  mismatch: 0,
};

export function countryConfidenceRank(confidence: CountryConfidence): number {
  return COUNTRY_CONFIDENCE_RANK[confidence];
}

/* -------------------------------------------------------------------------- */
/* Subscriber tiers                                                            */
/* -------------------------------------------------------------------------- */

export interface SubscriberTier {
  key: string;
  label: string;
  min: number;
  /** Exclusive upper bound; null means open-ended. */
  max: number | null;
}

/** The industry-standard size bands, so a filter can be picked as "micro + mid-tier" instead of
 * typed as two numbers — and so several non-adjacent bands can be selected at once. */
export const SUBSCRIBER_TIERS: SubscriberTier[] = [
  { key: "nano", label: "Nano · 1K–10K", min: 1_000, max: 10_000 },
  { key: "micro", label: "Micro · 10K–100K", min: 10_000, max: 100_000 },
  { key: "mid", label: "Mid · 100K–500K", min: 100_000, max: 500_000 },
  { key: "macro", label: "Macro · 500K–1M", min: 500_000, max: 1_000_000 },
  { key: "mega", label: "Mega · 1M+", min: 1_000_000, max: null },
];

const TIER_BY_KEY = new Map(SUBSCRIBER_TIERS.map((t) => [t.key, t]));

/** True when the count falls in ANY of the selected tiers — non-adjacent selections ("nano or
 * mega, nothing between") are a real shortlisting pattern, so these OR rather than bracket. */
export function matchesAnyTier(subscriberCount: number, tierKeys: string[] | undefined): boolean {
  if (!tierKeys || tierKeys.length === 0) return true;
  return tierKeys.some((key) => {
    const tier = TIER_BY_KEY.get(key);
    if (!tier) return false;
    return subscriberCount >= tier.min && (tier.max === null || subscriberCount < tier.max);
  });
}

export function sizeTierLabel(subscriberCount: number): string {
  if (subscriberCount < 10_000) return "Nano";
  if (subscriberCount < 100_000) return "Micro";
  if (subscriberCount < 1_000_000) return "Mid-tier";
  return "Macro";
}

/* -------------------------------------------------------------------------- */
/* Content signals                                                             */
/* -------------------------------------------------------------------------- */

const SPONSORSHIP_KEYWORDS = [
  "sponsored",
  "paid partnership",
  "paid promotion",
  "in partnership with",
  "in collaboration with",
  "brought to you by",
  "#ad",
  "promo code",
  "discount code",
  "use code",
  "affiliate link",
  "thanks to our sponsor",
];

const BRAND_RISK_KEYWORDS = ["scam", "fake", "clickbait", "banned", "controversy", "lawsuit", "fraud", "misleading", "offensive", "hate speech", "nsfw"];

/** hasPaidProductPlacement is a real signal YouTube exposes per-video; the keyword match on
 * title/description catches the sponsorships that don't set that flag (most don't). */
export function isSponsoredVideo(v: NormalizedVideo): boolean {
  if (v.hasPaidProductPlacement) return true;
  const text = `${v.title} ${v.description}`.toLowerCase();
  return SPONSORSHIP_KEYWORDS.some((k) => text.includes(k));
}

export function computeSponsorshipFrequencyPercent(videos: NormalizedVideo[]): number {
  if (videos.length === 0) return 0;
  return Math.round((videos.filter(isSponsoredVideo).length / videos.length) * 100);
}

/** A coarse public-metadata scan, not a substitute for an actual brand-safety review — flags
 * titles/descriptions carrying risk-adjacent language and scores down from there. */
export function computeBrandSafety(videos: NormalizedVideo[]): { label: string; score: number } {
  const flagged = videos.filter((v) => {
    const text = `${v.title} ${v.description}`.toLowerCase();
    return BRAND_RISK_KEYWORDS.some((k) => text.includes(k));
  }).length;
  const score = Math.round(clamp(100 - flagged * 20, 30, 100));
  const label = score >= 85 ? "Strong" : score >= 65 ? "Moderate" : "Needs Review";
  return { label, score };
}

/** Coefficient of variation of per-video engagement, inverted to a 0-1 "consistency" score — a
 * creator whose engagement swings wildly video to video is a riskier bet than one who performs
 * about the same every time, even at a similar average. */
export function computeConsistency(videos: NormalizedVideo[]): number {
  const rates = videos.map((v) => v.engagementRate).filter((r) => r > 0);
  if (rates.length < 2) return 0.5; // not enough signal either way
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean === 0) return 0;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(1, 1 - cv / 2));
}

export function computeContentFormatMix(videos: NormalizedVideo[]): { longFormPercent: number; shortsPercent: number } {
  if (videos.length === 0) return { longFormPercent: 0, shortsPercent: 0 };
  const shorts = videos.filter((v) => v.durationSeconds > 0 && v.durationSeconds <= 90).length;
  const shortsPercent = Math.round((shorts / videos.length) * 100);
  return { longFormPercent: 100 - shortsPercent, shortsPercent };
}

export function computeUploadsInLastDays(videos: NormalizedVideo[], days: number): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return videos.filter((v) => v.publishedAt && v.publishedAt.getTime() >= cutoff).length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/* -------------------------------------------------------------------------- */
/* Channel type                                                                */
/* -------------------------------------------------------------------------- */

export type ChannelKind = "creator" | "brand" | "media";

const BRAND_CHANNEL_PATTERNS = [/official (youtube )?channel/i, /welcome to the official/i, /\bwe are\b.{0,20}\bcompany\b/i];
const MEDIA_CHANNEL_PATTERNS = [/\bnews\b/i, /\bnewsroom\b/i, /\bbreaking news\b/i, /\bpublication\b/i, /\bmedia outlet\b/i];

/**
 * Separates individual creators from brand-owned and news/publisher channels. A brand's own
 * channel matching a product keyword is the classic false positive in keyword discovery — it's
 * the most on-topic result and the least useful one, since you can't sponsor a brand's own feed.
 *
 * Deliberately narrow patterns: rejecting on broad words ("food", "comedy") would throw away real
 * creators on every search.
 */
export function detectChannelKind(channelTitle: string, description: string): ChannelKind {
  const text = `${channelTitle} ${description}`;
  if (MEDIA_CHANNEL_PATTERNS.some((p) => p.test(text))) return "media";
  if (BRAND_CHANNEL_PATTERNS.some((p) => p.test(text))) return "brand";
  return "creator";
}

/* -------------------------------------------------------------------------- */
/* Quality                                                                     */
/* -------------------------------------------------------------------------- */

export interface QualityInput {
  engagementRate: number;
  /** Average views as a share of subscriber count, in percent — how much of the audience an upload
   * actually reaches. */
  viewToSubscriberRate: number;
  /** 0-1, from computeConsistency. */
  consistency: number;
  /** 0-100, from computeBrandSafety. */
  brandSafetyScore: number;
  daysSinceLastUpload: number | null;
}

/**
 * A 0-100 "is this creator worth contacting" score — engagement and real reach over raw subscriber count,
 * because a smaller channel whose audience actually watches outperforms a bigger one whose
 * audience doesn't. Size is deliberately absent: that's what the tier filter is for, and baking it
 * in here would just re-sort by subscribers wearing a different hat.
 */
export function computeQualityScore(params: QualityInput): number {
  const engagementScore = Math.min(35, params.engagementRate * 6); // ~6% engagement caps this out
  const reachScore = Math.min(30, params.viewToSubscriberRate * 0.6); // 50% view-to-sub caps this out
  const consistencyScore = params.consistency * 15;
  const safetyScore = (params.brandSafetyScore / 100) * 10;
  const recencyScore =
    params.daysSinceLastUpload === null
      ? 0
      : params.daysSinceLastUpload <= 14
        ? 10
        : params.daysSinceLastUpload <= 45
          ? 6
          : params.daysSinceLastUpload <= 120
            ? 2
            : 0;

  return Math.round(clamp(engagementScore + reachScore + consistencyScore + safetyScore + recencyScore));
}
