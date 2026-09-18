/**
 * Per-video classification for campaign discovery — steps 4 and 5 of the qualification workflow.
 *
 * Every video a creator has published gets two independent readings: what KIND of video it is
 * (review, unboxing, tutorial, vlog…) and how closely it relates to the campaign's products (0-5).
 * They're kept separate on purpose. "Reviews physical products" and "covers treadmills" are
 * different questions — a phone reviewer reviews constantly but never treadmills, a fitness coach
 * films on a treadmill but never reviews one — and the creator score needs both answers.
 *
 * Rule-based and deterministic, so every classification can be shown to the user with the exact
 * reason it was made, and re-running a search never re-labels the same video differently.
 */
import type { NormalizedVideo } from "@/lib/youtube/normalize";
import { isSponsoredVideo } from "@/lib/youtube/creatorSignals";
import type { CampaignProfile } from "./campaignProfile";

/* -------------------------------------------------------------------------- */
/* Term matching                                                               */
/* -------------------------------------------------------------------------- */

/** Lowercased, accent-stripped, punctuation collapsed to single spaces, padded with a space on each
 * side — so " walking pad " matches in "Walking-Pad Review!" and never inside "skywalking padding". */
export function normText(text: string): string {
  const flat = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${flat} `;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface TermMatcher {
  term: string;
  regex: RegExp;
}

/** Whole-phrase matchers that tolerate a plural on the last word ("treadmill" ↔ "treadmills"). */
export function buildMatchers(terms: string[]): TermMatcher[] {
  const out: TermMatcher[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const words = normText(term).trim().split(" ").filter(Boolean);
    if (words.length === 0) continue;
    const key = words.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    const last = words[words.length - 1];
    const stem = last.length > 3 && last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
    const pattern = [...words.slice(0, -1).map(escapeRegex), `${escapeRegex(stem)}(?:s|es)?`].join(" ");
    out.push({ term: key, regex: new RegExp(` ${pattern} `) });
  }
  return out;
}

export interface RelevanceContext {
  products: TermMatcher[];
  related: TermMatcher[];
  category: TermMatcher[];
  brands: TermMatcher[];
}

export function buildRelevanceContext(profile: CampaignProfile): RelevanceContext {
  return {
    products: buildMatchers(profile.targetProducts),
    related: buildMatchers(profile.relatedTerms),
    category: buildMatchers(profile.category ? [profile.category] : []),
    brands: buildMatchers(profile.brands),
  };
}

function hits(matchers: TermMatcher[], text: string): string[] {
  return matchers.filter((m) => m.regex.test(text)).map((m) => m.term);
}

/* -------------------------------------------------------------------------- */
/* Product relevance (0-5)                                                     */
/* -------------------------------------------------------------------------- */

export type ProductRelevance = 0 | 1 | 2 | 3 | 4 | 5;

export interface RelevanceReading {
  score: ProductRelevance;
  matchedTerms: string[];
  reason: string;
}

/**
 * 5 exact product in the title · 4 exact product in tags or the top of the description (or a named
 * brand alongside a related product) · 3 related product in the title · 2 somewhat related · 1
 * weakly related · 0 unrelated.
 *
 * The title carries the most weight because it's what the video is actually about. A product named
 * only deep in a description is capped at 2: that's where affiliate footers ("my treadmill: link")
 * live on cooking and gaming videos, which is the classic incidental-keyword false positive.
 */
export function scoreProductRelevance(title: string, description: string, tags: string[], ctx: RelevanceContext): RelevanceReading {
  const t = normText(title);
  const tagsAndHead = normText(`${tags.join(" | ")} ${description.slice(0, 250)}`);
  const deep = normText(description.slice(0, 1500));

  const productsInTitle = hits(ctx.products, t);
  if (productsInTitle.length > 0) {
    return { score: 5, matchedTerms: [...new Set([...productsInTitle, ...hits(ctx.related, t)])], reason: `Title names ${productsInTitle.join(", ")}` };
  }

  const productsInTags = hits(ctx.products, tagsAndHead);
  if (productsInTags.length > 0) {
    return { score: 4, matchedTerms: productsInTags, reason: `Tags or description lead name ${productsInTags.join(", ")}` };
  }

  const brandsInTitle = hits(ctx.brands, t);
  const relatedInTitle = hits(ctx.related, t);
  const categoryInTitle = hits(ctx.category, t);
  if (brandsInTitle.length > 0 && (relatedInTitle.length > 0 || categoryInTitle.length > 0)) {
    return { score: 4, matchedTerms: relatedInTitle, reason: `Title names ${brandsInTitle[0]} with ${relatedInTitle[0] ?? categoryInTitle[0]}` };
  }

  if (relatedInTitle.length > 0) {
    return { score: 3, matchedTerms: relatedInTitle, reason: `Title names related product ${relatedInTitle.join(", ")}` };
  }

  const productsDeep = hits(ctx.products, deep);
  if (productsDeep.length > 0) {
    return { score: 2, matchedTerms: productsDeep, reason: `Mentioned only in the description (${productsDeep.join(", ")})` };
  }

  const relatedInTags = hits(ctx.related, tagsAndHead);
  if (relatedInTags.length > 0) {
    return { score: 2, matchedTerms: relatedInTags, reason: `Tags mention related product ${relatedInTags.join(", ")}` };
  }

  if (categoryInTitle.length > 0) {
    return { score: 2, matchedTerms: [], reason: `Title is about ${categoryInTitle[0]} generally` };
  }

  const categoryInTags = hits(ctx.category, tagsAndHead);
  if (categoryInTags.length > 0) {
    return { score: 1, matchedTerms: [], reason: `Tags mention ${categoryInTags[0]}` };
  }

  const relatedDeep = hits(ctx.related, deep);
  if (relatedDeep.length > 0) {
    return { score: 1, matchedTerms: relatedDeep, reason: `Description mentions ${relatedDeep[0]}` };
  }

  return { score: 0, matchedTerms: [], reason: "No target or related product mentioned" };
}

/* -------------------------------------------------------------------------- */
/* Content type                                                                */
/* -------------------------------------------------------------------------- */

export type ContentType =
  | "Long-Term Review"
  | "Product Comparison"
  | "Buying Guide"
  | "Product Unboxing"
  | "Product Installation"
  | "Product Setup"
  | "Product Testing"
  | "Product Review"
  | "Product Demonstration"
  | "Tutorial"
  | "Lifestyle"
  | "General Content";

/** The formats where a creator is handling and assessing a physical product — what "regularly
 * reviews, unboxes or tests products" is measured against. */
export const PRODUCT_FORMAT_TYPES: ReadonlySet<ContentType> = new Set<ContentType>([
  "Long-Term Review",
  "Product Comparison",
  "Buying Guide",
  "Product Unboxing",
  "Product Installation",
  "Product Setup",
  "Product Testing",
  "Product Review",
  "Product Demonstration",
]);

/** Most specific first: "Treadmill vs Walking Pad Review" is a comparison before it's a review, and
 * "6 months later" is a long-term review before it's a review. */
const CONTENT_RULES: [ContentType, RegExp][] = [
  ["Long-Term Review", /\blong[\s-]?term\b|\b\d+\s+(?:months?|years?)\s+later\b|\bafter\s+\d+\s+(?:months?|years?)\b/i],
  ["Product Comparison", /\bvs\.?(?=\s|$)|\bversus\b|\bcompar(?:e|ed|es|ison|isons|ing)\b|\bhead[\s-]to[\s-]head\b|\bwhich (?:one )?is better\b/i],
  // "Best" only marks a buying guide when it leads the title — "Treadmill Review, best fitness
  // upgrade for any home" is a review that happens to use the word.
  ["Buying Guide", /\bbuy(?:ing|er'?s?)\s+guides?\b|\bbefore you buy\b|\bwhat to buy\b|\btop\s+\d+\b|^\s*(?:the\s+)?best\b/i],
  ["Product Unboxing", /\bunbox(?:ing|ed)?\b|\bfirst look\b|\bout of the box\b|\bwhat'?s in the box\b/i],
  ["Product Installation", /\binstall(?:ation|ing|ed)?\b|\bmounting\b/i],
  ["Product Setup", /\bset[\s-]?up\b|\bassembl(?:y|e|ing|ed)\b/i],
  ["Product Testing", /\btest(?:ed|ing|s)?\b|\bhands[\s-]on\b|\bput to the test\b|\bi tried\b/i],
  ["Product Review", /\breview(?:s|ed|ing)?\b|\bworth it\b|\bpros (?:and|&) cons\b|\bshould you buy\b|\bhonest (?:opinion|thoughts)\b/i],
  ["Product Demonstration", /\bdemo(?:nstration)?\b|\bhow it works\b|\bin action\b|\bwalk[\s-]?through\b|\bshowcase\b/i],
  // Lifestyle before Tutorial: its patterns are the specific ones, and "morning routine" is a vlog
  // even though Tutorial's broader "routine" would also match it.
  ["Lifestyle", /\bvlog\b|\bday in (?:the|my) life\b|\bweek in\b|\blifestyle\b|\bmorning routine\b/i],
  ["Tutorial", /\bhow to\b|\btutorial\b|\bguide\b|\btips\b|\bworkout\b|\broutine\b|\bexercises?\b|\bbeginners?\b|\bfollow along\b/i],
];

export function classifyContentType(title: string, tags: string[]): ContentType {
  for (const [type, pattern] of CONTENT_RULES) {
    if (pattern.test(title)) return type;
  }
  // Creators often keep titles hook-shaped ("I can't believe this happened") and put the format in
  // tags — only the unambiguous product formats are trusted from there.
  const tagText = tags.join(" | ");
  for (const [type, pattern] of CONTENT_RULES) {
    if (PRODUCT_FORMAT_TYPES.has(type) && pattern.test(tagText)) return type;
  }
  return "General Content";
}

/* -------------------------------------------------------------------------- */
/* Commercial and market signals                                               */
/* -------------------------------------------------------------------------- */

const AFFILIATE_PATTERN =
  /amazon\.[a-z.]+\/(?:dp|gp|shop|stores)\b|\bamzn\.to\b|\bgeni\.us\b|\bshareasale\b|\bimpact\.com\b|\bawin1?\b|\brstyle\.me\b|\blinktr\.ee\b|\bas an amazon associate\b|\baffiliate\b|\bcommissions? earned\b|#commissionsearned/i;

/** Evidence a video's audience is in a given market — store domains and currency, not language
 * alone (English is spoken everywhere a brief is likely to target). */
const COUNTRY_SIGNALS: [RegExp, string][] = [
  [/amazon\.com(?![.\w])|\bwalmart\b|\bbest buy\b|\bhome depot\b|\bcostco\b|\bunited states\b|\$\s?\d/i, "US"],
  [/amazon\.co\.uk\b|£\s?\d|\bargos\b|\bcurrys\b/i, "GB"],
  [/amazon\.in\b|\bflipkart\b|₹\s?\d|\brs\.?\s?\d|[ऀ-ॿ]/i, "IN"],
  [/amazon\.ca\b|\bcad\b|\bcanadian tire\b/i, "CA"],
  [/amazon\.com\.au\b|\baud\b|\bjb hi-?fi\b/i, "AU"],
  [/amazon\.de\b/i, "DE"],
  [/amazon\.fr\b/i, "FR"],
  [/amazon\.co\.jp\b|[぀-ヿ]/i, "JP"],
  [/amazon\.com\.br\b|R\$\s?\d/, "BR"],
  [/amazon\.com\.mx\b/i, "MX"],
  [/amazon\.es\b/i, "ES"],
  [/amazon\.it\b/i, "IT"],
  [/amazon\.nl\b/i, "NL"],
  [/amazon\.sg\b/i, "SG"],
  [/amazon\.ae\b|\baed\b/i, "AE"],
];

function detectCountrySignals(text: string): string[] {
  return COUNTRY_SIGNALS.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
}

/* -------------------------------------------------------------------------- */
/* Classified video                                                            */
/* -------------------------------------------------------------------------- */

export interface ClassifiedVideo {
  videoId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  contentType: ContentType;
  productRelevance: ProductRelevance;
  matchedTerms: string[];
  relevanceReason: string;
  /** Outside the creator's most recent uploads — still counted as history, but kept out of "what
   * they make now" shares so an old burst of relevant videos can't pass for current focus. */
  isHistorical: boolean;
  /** Search queries that surfaced this exact video, empty if it was only found by browsing the
   * channel. */
  discoveredVia: string[];
  sponsored: boolean;
  paidPlacement: boolean;
  hasAffiliateLinks: boolean;
  mentionsBrand: boolean;
  countrySignals: string[];
}

export function classifyVideo(
  video: NormalizedVideo,
  ctx: RelevanceContext,
  opts: { isHistorical: boolean; discoveredVia: string[] }
): ClassifiedVideo {
  const relevance = scoreProductRelevance(video.title, video.description, video.tags, ctx);
  const text = `${video.title} ${video.description}`;
  return {
    videoId: video.videoId,
    title: video.title,
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    publishedAt: video.publishedAt ? video.publishedAt.toISOString() : null,
    views: video.viewCount,
    likes: video.likeCount,
    comments: video.commentCount,
    contentType: classifyContentType(video.title, video.tags),
    productRelevance: relevance.score,
    matchedTerms: relevance.matchedTerms,
    relevanceReason: relevance.reason,
    isHistorical: opts.isHistorical,
    discoveredVia: opts.discoveredVia,
    sponsored: isSponsoredVideo(video),
    paidPlacement: video.hasPaidProductPlacement,
    hasAffiliateLinks: AFFILIATE_PATTERN.test(video.description),
    mentionsBrand: hits(ctx.brands, normText(text)).length > 0,
    countrySignals: detectCountrySignals(text),
  };
}
