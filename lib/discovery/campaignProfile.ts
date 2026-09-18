/**
 * Step 1 and 2 of campaign discovery: turn a free-text brief into the structured profile every
 * later step reads from, and build the keyword matrix that profile is searched with.
 *
 * Everything here is rule-based and runs without any external call. campaignProfileAI.ts produces a
 * richer profile when an Anthropic key is configured, but its output lands back in
 * normalizeProfile() below, so the rest of the pipeline sees one validated shape either way — and
 * the user reviews and edits that shape before any YouTube quota is spent.
 */
import { estimateAudienceDemographics } from "@/lib/youtube/audienceEstimation";
import { buildMatchers, normText } from "./videoClassifier";

/** Every content format the matrix knows how to phrase. All but "tutorial" describe a creator
 * handling a physical product, which is what requireProductReviewers checks for. */
export const CONTENT_FORMATS = [
  "review",
  "unboxing",
  "test",
  "setup",
  "installation",
  "first look",
  "hands on",
  "comparison",
  "demo",
  "buying guide",
  "long term review",
  "worth it",
  "tutorial",
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

const PRODUCT_FORMATS = new Set<string>(CONTENT_FORMATS.filter((f) => f !== "tutorial"));
export const DEFAULT_CONTENT: ContentFormat[] = ["review", "unboxing", "test"];
const DEFAULT_CREATOR_COUNT = 20;

export interface CampaignProfile {
  /** ISO 3166-1 alpha-2, or "" for any market. */
  market: string;
  minSubscribers: number | null;
  maxSubscribers: number | null;
  /** The niche in a word or two — the weakest, category-level relevance signal. */
  category: string;
  /** The products or product categories the campaign is about — the strongest relevance signal. */
  targetProducts: string[];
  /** Adjacent products a genuinely relevant creator would also cover. Searched, and scored as
   * "related" — never as an exact product match. */
  relatedTerms: string[];
  desiredContent: ContentFormat[];
  brands: string[];
  minEngagementRate: number | null;
  creatorCount: number;
  /** When set, a creator with no review/unboxing/testing behavior is rejected however on-topic
   * their content is — a fitness coach who films on a treadmill isn't a treadmill reviewer. */
  requireProductReviewers: boolean;
}

export interface ParsedBrief {
  profile: CampaignProfile;
  source: "ai" | "rules";
  notes: string[];
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function stringList(value: unknown, max: number, lowercase: boolean): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.replace(/\s+/g, " ").trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || trimmed.length > 60 || seen.has(key)) continue;
    seen.add(key);
    out.push(lowercase ? key : trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** The single gate every profile passes through — from the rule parser, the AI parser, or the
 * user's own edits posted back from the browser. Anything unrecognized is dropped, not guessed. */
export function normalizeProfile(raw: unknown): CampaignProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  let minSubscribers = positiveInt(r.minSubscribers);
  let maxSubscribers = positiveInt(r.maxSubscribers);
  if (minSubscribers !== null && maxSubscribers !== null && minSubscribers > maxSubscribers) {
    [minSubscribers, maxSubscribers] = [maxSubscribers, minSubscribers];
  }

  const market = typeof r.market === "string" && /^[a-z]{2}$/i.test(r.market.trim()) ? r.market.trim().toUpperCase() : "";
  const desiredContent = stringList(r.desiredContent, CONTENT_FORMATS.length, true).filter((c): c is ContentFormat =>
    (CONTENT_FORMATS as readonly string[]).includes(c)
  );
  const targetProducts = stringList(r.targetProducts, 10, true);
  const productKeys = new Set(targetProducts);
  const engagement = Number(r.minEngagementRate);
  const creatorCount = positiveInt(r.creatorCount);

  return {
    market,
    minSubscribers,
    maxSubscribers,
    category: typeof r.category === "string" ? r.category.trim().toLowerCase().slice(0, 40) : "",
    targetProducts,
    relatedTerms: stringList(r.relatedTerms, 15, true).filter((t) => !productKeys.has(t)),
    desiredContent,
    brands: stringList(r.brands, 8, false),
    minEngagementRate: Number.isFinite(engagement) && engagement > 0 && engagement <= 100 ? engagement : null,
    creatorCount: creatorCount ? Math.min(Math.max(creatorCount, 5), 50) : DEFAULT_CREATOR_COUNT,
    requireProductReviewers:
      typeof r.requireProductReviewers === "boolean"
        ? r.requireProductReviewers
        : desiredContent.length === 0 || desiredContent.some((c) => PRODUCT_FORMATS.has(c)),
  };
}

/* -------------------------------------------------------------------------- */
/* Rule-based brief parsing                                                    */
/* -------------------------------------------------------------------------- */

const COUNTRY_ALIASES: [RegExp, string][] = [
  // Uppercase-only, so "creators near us" never becomes a US market.
  [/\bU\.S\.(?=\s|,|$)|\bUSA?\b/, "US"],
  [/\bunited states\b|\bamerica(?:n)?\b/i, "US"],
  [/\bU\.K\.(?=\s|,|$)|\bUK\b/, "GB"],
  [/\bunited kingdom\b|\bbritain\b|\bbritish\b|\bengland\b/i, "GB"],
  [/\bindia(?:n)?\b/i, "IN"],
  [/\bcanad(?:a|ian)\b/i, "CA"],
  [/\baustralia(?:n)?\b/i, "AU"],
  [/\bgermany\b|\bgerman\b/i, "DE"],
  [/\bfrance\b|\bfrench\b/i, "FR"],
  [/\bbrazil(?:ian)?\b/i, "BR"],
  [/\bmexic(?:o|an)\b/i, "MX"],
  [/\bphilippines\b|\bfilipino\b/i, "PH"],
  [/\bindonesia(?:n)?\b/i, "ID"],
  [/\bnigeria(?:n)?\b/i, "NG"],
  [/\bsouth africa(?:n)?\b/i, "ZA"],
  [/\bjapan(?:ese)?\b/i, "JP"],
  [/\bspain\b|\bspanish\b/i, "ES"],
  [/\bital(?:y|ian)\b/i, "IT"],
  [/\bnetherlands\b|\bdutch\b/i, "NL"],
  [/\bUAE\b|\bunited arab emirates\b|\bdubai\b/i, "AE"],
  [/\bsingapore\b/i, "SG"],
  [/\bpakistan(?:i)?\b/i, "PK"],
];

/** Longer phrasings first so "long term review" is recognized before its "review" is. */
const CONTENT_ALIASES: [RegExp, ContentFormat][] = [
  [/\blong[\s-]?term(?:\s+reviews?)?\b/i, "long term review"],
  [/\bbuy(?:ing|er'?s?)\s+guides?\b/i, "buying guide"],
  [/\bfirst\s+looks?\b/i, "first look"],
  [/\bhands[\s-]?on\b/i, "hands on"],
  [/\bworth\s+it\b/i, "worth it"],
  [/\b(?:honest\s+)?review(?:s|ing|ed|ers?)?\b/i, "review"],
  [/\bunbox(?:ing|ings|ed)?\b/i, "unboxing"],
  [/\btest(?:s|ing|ed)?\b/i, "test"],
  [/\bset[\s-]?ups?\b|\bassembl(?:y|e|ing)\b/i, "setup"],
  [/\binstall(?:ation|ations|ing)?\b/i, "installation"],
  [/\bcompar(?:e|es|ison|isons|ing)\b|\bversus\b|\bvs\.?(?=\s|$)/i, "comparison"],
  [/\bdemo(?:s|nstrations?)?\b/i, "demo"],
  [/\btutorials?\b|\bhow[\s-]to\b/i, "tutorial"],
];

const FILLER = new Set([
  "find", "finding", "looking", "look", "search", "get", "show", "list", "give", "me", "us", "we", "i", "our", "my",
  "youtube", "youtuber", "youtubers", "creator", "creators", "influencer", "influencers", "channel", "channels",
  "video", "videos", "content", "who", "whose", "that", "which", "create", "creates", "creating", "make", "makes",
  "making", "post", "posts", "posting", "publish", "publishes", "cover", "covers", "covering", "do", "does", "film",
  "films", "filming", "with", "subscribers", "subscriber", "subs", "the", "a", "an", "of", "for", "in", "on", "at",
  "to", "their", "them", "they", "and", "or", "etc", "like", "such", "as", "also", "based", "from", "about",
  "around", "focused", "focus", "specialize", "specializing", "want", "need", "some", "any", "best", "top", "good",
  "great", "relevant", "genuine", "people", "brand", "brands", "campaign", "campaigns", "collaboration",
  "collaborations", "partnership", "sponsorship", "k", "m", "plus",
  // Conversational brief wording ("who try the product and create a 3-min video while applying and
  // showcasing it") — describes the deliverable, never the product to search for.
  "try", "tries", "trying", "tried", "product", "products", "item", "items", "while", "when", "applying", "apply",
  "applies", "showcasing", "showcase", "showcases", "showing", "show", "shows", "using", "use", "uses", "wearing",
  "min", "mins", "minute", "minutes", "sec", "secs", "second", "seconds", "long", "short", "quick", "detailed",
  "honest", "own", "new", "latest", "our", "your", "it", "its", "this", "these", "those", "into", "is", "are",
  "will", "would", "should", "can", "could", "then", "also", "both", "each", "every", "per", "one", "two", "three",
]);

const PRODUCT_TRIGGER =
  /\b(?:who|that)\s+(?:create|creates|make|makes|post|posts|publish|publishes|cover|covers|do|does|review|reviews|film|films|feature|features)\b|\b(?:covering|creating|making|reviewing|featuring|focused on|specializ(?:e|es|ing) in|about)\b/i;

const NUM = String.raw`\d[\d,]*(?:\.\d+)?\s*[kKmM]?`;
const SUBS = String.raw`(?:subs|subscribers?)\b`;
const SUB_RANGE = new RegExp(`(${NUM})\\s*(?:–|—|-|to|and)\\s*(${NUM})\\s*${SUBS}`, "i");
const SUB_MIN = new RegExp(`(?:over|above|more than|at least|min(?:imum)?(?: of)?)\\s+(${NUM})\\s*${SUBS}`, "i");
const SUB_PLUS = new RegExp(`(${NUM})\\s*\\+\\s*${SUBS}`, "i");
const SUB_MAX = new RegExp(`(?:under|below|less than|up to|max(?:imum)?(?: of)?)\\s+(${NUM})\\s*${SUBS}`, "i");
const ENGAGEMENT_BEFORE = /(\d+(?:\.\d+)?)\s*%\s*\+?\s*(?:engagement|er)\b/i;
const ENGAGEMENT_AFTER = /\bengagement(?:\s+rate)?\s*(?:of|above|over|at least|minimum|min|>=?)?\s*(\d+(?:\.\d+)?)\s*%/i;
const CREATOR_COUNT = /\b(\d{1,3})\s+(?:youtube\s+)?(?:creators?|influencers?|youtubers?|channels?)\b/i;
const BRANDS = /\bbrands?\s*(?:like|such as|including|:)\s*([^.;\n]+)/i;

/** Format-style categories describe how a video is made, not what it's about — never a niche. */
const FORMAT_CATEGORIES = new Set(["review", "unboxing", "tutorial", "podcast", "vlogging"]);

function parseCount(raw: string): number | null {
  const m = raw.replace(/[\s,]/g, "").toLowerCase().match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function singularize(word: string): string {
  if (word.length <= 4) return word;
  if (/(?:sses|ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function cleanPhrase(phrase: string): string {
  const words = phrase
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length && (FILLER.has(words[0]) || /^\d/.test(words[0]))) words.shift();
  while (words.length && (FILLER.has(words[words.length - 1]) || /^\d/.test(words[words.length - 1]))) words.pop();
  if (words.length === 0 || words.length > 5 || words.every((w) => FILLER.has(w))) return "";
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.join(" ");
}

export function heuristicParseBrief(brief: string): ParsedBrief {
  const notes: string[] = [];
  let text = ` ${brief.replace(/\s+/g, " ").trim()} `;

  let minSubscribers: number | null = null;
  let maxSubscribers: number | null = null;
  const range = text.match(SUB_RANGE);
  if (range) {
    minSubscribers = parseCount(range[1]);
    maxSubscribers = parseCount(range[2]);
    text = text.replace(range[0], " ");
  } else {
    const min = text.match(SUB_MIN) ?? text.match(SUB_PLUS);
    if (min) {
      minSubscribers = parseCount(min[1]);
      text = text.replace(min[0], " ");
    }
    const max = text.match(SUB_MAX);
    if (max) {
      maxSubscribers = parseCount(max[1]);
      text = text.replace(max[0], " ");
    }
  }

  let minEngagementRate: number | null = null;
  const engagement = text.match(ENGAGEMENT_BEFORE) ?? text.match(ENGAGEMENT_AFTER);
  if (engagement) {
    minEngagementRate = Number(engagement[1]);
    text = text.replace(engagement[0], " ");
  }

  let creatorCount: number | null = null;
  const count = text.match(CREATOR_COUNT);
  if (count) {
    creatorCount = Number(count[1]);
    text = text.replace(count[0], " creators ");
  }

  let brands: string[] = [];
  const brandMatch = text.match(BRANDS);
  if (brandMatch) {
    brands = brandMatch[1]
      .split(/,|\band\b|&|\//i)
      .map((b) => b.replace(/[^\p{L}\p{N}&.\s-]/gu, "").trim())
      .filter((b) => b && b.length <= 30);
    text = text.replace(brandMatch[0], " ");
  }

  let market = "";
  for (const [pattern, code] of COUNTRY_ALIASES) {
    if (pattern.test(text)) {
      market = code;
      break;
    }
  }
  if (market) {
    for (const [pattern, code] of COUNTRY_ALIASES) {
      if (code === market) text = text.replace(new RegExp(pattern.source, `${pattern.flags}g`), " ");
    }
  }

  const desiredContent: ContentFormat[] = [];
  for (const [pattern, format] of CONTENT_ALIASES) {
    if (pattern.test(text) && !desiredContent.includes(format)) desiredContent.push(format);
  }

  // Products are read from what follows "who create / covering / about …" when the brief has one,
  // which keeps "Find US YouTube creators with…" out of the product list.
  const trigger = text.match(PRODUCT_TRIGGER);
  let segment = trigger?.index !== undefined ? text.slice(trigger.index + trigger[0].length) : text;
  for (const [pattern] of CONTENT_ALIASES) segment = segment.replace(new RegExp(pattern.source, `${pattern.flags}g`), ",");
  const targetProducts = [
    ...new Set(
      segment
        .split(/,|;|\/|&|\band\b|\bor\b|\bplus\b|\bas well as\b|\bfor\b|\bwith\b|\bwho\b|\bthat\b/i)
        .map(cleanPhrase)
        .filter(Boolean)
    ),
  ];

  const resolved = estimateAudienceDemographics({ topics: targetProducts, contentText: brief }).categoryLabel;
  const category = FORMAT_CATEGORIES.has(resolved) ? "" : resolved;

  if (targetProducts.length > 0 && suggestRelatedTerms(targetProducts).length > 0) {
    notes.push("Related products were suggested to widen the search — remove any that don't fit.");
  }
  if (targetProducts.length === 0) notes.push("Couldn't pick out a product or niche — add at least one target product.");
  if (desiredContent.length === 0) notes.push("No content format named — defaulting to reviews, unboxings and tests.");
  if (!market) notes.push("No market named — creators from any country will be considered.");
  if (minSubscribers === null && maxSubscribers === null) notes.push("No subscriber range named — any channel size will be considered.");

  return {
    profile: normalizeProfile({
      market,
      minSubscribers,
      maxSubscribers,
      category,
      targetProducts,
      relatedTerms: suggestRelatedTerms(targetProducts),
      desiredContent: desiredContent.length > 0 ? desiredContent : DEFAULT_CONTENT,
      brands,
      minEngagementRate,
      creatorCount,
    }),
    source: "rules",
    notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Keyword matrix                                                              */
/* -------------------------------------------------------------------------- */

const FORMAT_TEMPLATES: Record<ContentFormat, (term: string) => string> = {
  review: (t) => `${t} review`,
  unboxing: (t) => `${t} unboxing`,
  test: (t) => `${t} test`,
  setup: (t) => `${t} setup`,
  installation: (t) => `${t} installation`,
  "first look": (t) => `${t} first look`,
  "hands on": (t) => `${t} hands on`,
  comparison: (t) => `${t} comparison`,
  demo: (t) => `${t} demo`,
  "buying guide": (t) => `${t} buying guide`,
  "long term review": (t) => `${t} long term review`,
  "worth it": (t) => `is ${t} worth it`,
  tutorial: (t) => `${t} tutorial`,
};

export interface KeywordQuery {
  query: string;
  source: "product" | "brand" | "buying" | "related" | "mined";
}

function contentFor(profile: CampaignProfile): ContentFormat[] {
  return profile.desiredContent.length > 0 ? profile.desiredContent : DEFAULT_CONTENT;
}

/**
 * [PRODUCT] × [CONTENT TYPE], [BRAND] + [PRODUCT] + review, best [PRODUCT], and the related terms.
 *
 * Ordered for breadth rather than completeness: a search depth that stops after eight queries should
 * already have touched every product and the highest-precision shapes, not exhausted every format
 * for the first product while never searching the second.
 */
export function buildKeywordMatrix(profile: CampaignProfile): KeywordQuery[] {
  const content = contentFor(profile);
  const products = profile.targetProducts;
  const out: KeywordQuery[] = [];
  const seen = new Set<string>();
  const add = (query: string, source: KeywordQuery["source"]) => {
    const q = query.replace(/\s+/g, " ").trim().toLowerCase();
    if (!q || seen.has(q)) return;
    seen.add(q);
    out.push({ query: q, source });
  };

  for (const p of products) add(FORMAT_TEMPLATES[content[0]](p), "product");
  for (const b of profile.brands) add(`${b} ${products[0] ?? profile.category} review`, "brand");
  for (const p of products.slice(0, 2)) add(`best ${p}`, "buying");
  for (const r of profile.relatedTerms) add(FORMAT_TEMPLATES[content[0]](r), "related");
  if (content[1]) {
    for (const p of products) add(FORMAT_TEMPLATES[content[1]](p), "product");
    for (const r of profile.relatedTerms.slice(0, 6)) add(FORMAT_TEMPLATES[content[1]](r), "related");
  }
  for (const format of content.slice(2)) {
    for (const p of products) add(FORMAT_TEMPLATES[format](p), "product");
  }
  // A brief naming one product and one format yields only a couple of searches, which finds few
  // creators — pad with the other product-review shapes creators title videos with.
  for (const format of PADDING_FORMATS) {
    if (out.length >= MIN_MATRIX_SIZE) break;
    for (const p of products) add(FORMAT_TEMPLATES[format](p), "product");
  }
  return out;
}

const MIN_MATRIX_SIZE = 8;
const PADDING_FORMATS: ContentFormat[] = ["unboxing", "test", "worth it", "comparison", "first look", "long term review"];

/**
 * Adjacent products for common campaign categories, so a one-product brief ("sunscreen") still
 * searches the neighbouring vocabulary creators use. Shown in the editable profile, where the member
 * can remove any that don't fit.
 */
const RELATED_BY_PRODUCT: [RegExp, string[]][] = [
  [/sunscreen|sunblock|spf/, ["spf", "sunblock", "tinted sunscreen", "skincare routine", "moisturizer"]],
  [/skin ?care|serum|moisturi[sz]er|cleanser|toner/, ["skincare routine", "serum", "moisturizer", "cleanser", "skincare products"]],
  [/makeup|foundation|lipstick|mascara|concealer/, ["makeup haul", "foundation", "drugstore makeup", "makeup tutorial"]],
  [/hair ?care|shampoo|conditioner|hair dryer|straightener/, ["haircare routine", "shampoo", "hair dryer", "hair products"]],
  [/treadmill|walking pad/, ["walking pad", "under desk treadmill", "home gym equipment", "exercise bike"]],
  [/protein|supplement|pre ?workout|creatine/, ["protein powder", "pre workout", "supplements", "creatine"]],
  [/headphone|earbud|earphone/, ["earbuds", "headphones", "noise cancelling headphones", "wireless earbuds"]],
  [/phone|smartphone/, ["smartphone", "phone accessories", "budget phone"]],
  [/laptop|notebook computer/, ["laptop", "budget laptop", "gaming laptop"]],
  [/vacuum|robot vacuum|mop/, ["robot vacuum", "cordless vacuum", "cleaning gadgets"]],
  [/coffee|espresso/, ["espresso machine", "coffee maker", "coffee grinder"]],
  [/mattress|pillow|bedding/, ["mattress", "pillow", "sleep products"]],
  [/dog|cat|pet/, ["pet products", "dog toys", "cat products"]],
  [/baby|stroller|diaper/, ["baby products", "stroller", "baby gear"]],
  [/kitchen|air fryer|blender|cookware/, ["air fryer", "kitchen gadgets", "blender", "cookware"]],
];

export function suggestRelatedTerms(products: string[]): string[] {
  const have = new Set(products.map((p) => p.toLowerCase()));
  const out: string[] = [];
  for (const product of products) {
    for (const [pattern, related] of RELATED_BY_PRODUCT) {
      if (!pattern.test(product.toLowerCase())) continue;
      for (const term of related) if (!have.has(term) && !out.includes(term)) out.push(term);
    }
  }
  return out.slice(0, 8);
}

export function buildMinedQueries(profile: CampaignProfile, terms: string[], alreadyPlanned: Set<string>): KeywordQuery[] {
  const primary = contentFor(profile)[0];
  const out: KeywordQuery[] = [];
  for (const term of terms) {
    const query = FORMAT_TEMPLATES[primary](term).toLowerCase();
    if (alreadyPlanned.has(query)) continue;
    alreadyPlanned.add(query);
    out.push({ query, source: "mined" });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Vocabulary mining                                                           */
/* -------------------------------------------------------------------------- */

const MINING_STOP = new Set([
  ...FILLER,
  "review", "reviews", "unboxing", "unbox", "test", "testing", "tested", "setup", "set", "up", "install",
  "installation", "first", "look", "hands", "demo", "comparison", "compare", "vs", "versus", "guide", "buying",
  "worth", "honest", "long", "term", "tutorial", "how", "why", "what", "is", "it", "this", "these", "those",
  "should", "you", "your", "buy", "new", "after", "before", "not", "no", "yes", "can", "will", "its", "are", "was",
  "did", "got", "really", "actually", "finally", "ever", "just", "so", "one", "two", "three", "day", "days", "week",
  "weeks", "month", "months", "year", "years", "time", "part", "episode", "ep", "full", "official", "shorts",
  "short", "ultimate", "watch", "here", "there", "every", "all",
]);

/** A phrase must recur across this many different creators' titles to count as real vocabulary
 * rather than one channel's naming habit. */
const MIN_MINING_SUPPORT = 3;

/**
 * Semantic expansion grounded in what YouTube actually returned rather than a fixed list: titles
 * that already mention a target or related product are scanned for the two- and three-word phrases
 * that keep appearing next to it ("under desk treadmill", "walking pad") across different creators,
 * and those phrases become new searches.
 */
export function mineRelatedTerms(
  titlesByChannel: Map<string, string[]>,
  profile: CampaignProfile,
  exclude: string[],
  limit: number
): string[] {
  const anchors = buildMatchers([...profile.targetProducts, ...profile.relatedTerms]);
  if (anchors.length === 0 || limit <= 0) return [];
  const knownWords = new Set(
    [...profile.targetProducts, ...profile.relatedTerms, ...profile.brands, ...exclude]
      .flatMap((t) => normText(t).trim().split(" "))
      .flatMap((w) => [w, w.replace(/e?s$/, "")])
  );
  const isKnownWord = (w: string) => knownWords.has(w) || knownWords.has(w.replace(/e?s$/, ""));

  const support = new Map<string, Set<string>>();
  for (const [channelId, titles] of titlesByChannel) {
    for (const title of titles) {
      const normalized = normText(title);
      if (!anchors.some((a) => a.regex.test(normalized))) continue;
      const words = normalized.trim().split(" ");
      for (let size = 2; size <= 3; size++) {
        for (let i = 0; i + size <= words.length; i++) {
          const gram = words.slice(i, i + size);
          if (MINING_STOP.has(gram[0]) || MINING_STOP.has(gram[size - 1])) continue;
          if (gram.some((w) => w.length < 2 || /\d/.test(w))) continue;
          // Already-searched words recombined — a plural ("walking pads"), two products run together
          // ("walking pad treadmill"), or a fragment of one ("pad treadmill") — isn't new vocabulary,
          // however often it appears. At least one genuinely new word is required.
          if (!gram.some((w) => !MINING_STOP.has(w) && !isKnownWord(w))) continue;
          const phrase = gram.join(" ");
          let channels = support.get(phrase);
          if (!channels) {
            channels = new Set();
            support.set(phrase, channels);
          }
          channels.add(channelId);
        }
      }
    }
  }

  const supported = [...support.entries()].filter(([, channels]) => channels.size >= MIN_MINING_SUPPORT);
  // "desk treadmill" is usually just a slice of "under desk treadmill" — when a longer phrase carries
  // most of a shorter one's support, the longer one is the real vocabulary.
  const ranked = supported
    .filter(
      ([phrase, channels]) =>
        !supported.some(([other, otherChannels]) => other !== phrase && other.includes(phrase) && otherChannels.size >= channels.size * 0.8)
    )
    .sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length);

  const picked: string[] = [];
  const usedWords = new Set<string>();
  for (const [phrase] of ranked) {
    // Two picks sharing a new word ("under desk", "desk treadmill") are one idea searched twice, at
    // 100 quota units a search.
    const newWords = phrase.split(" ").filter((w) => !MINING_STOP.has(w) && !isKnownWord(w));
    if (newWords.some((w) => usedWords.has(w))) continue;
    picked.push(phrase);
    newWords.forEach((w) => usedWords.add(w));
    if (picked.length >= limit) break;
  }
  return picked;
}
