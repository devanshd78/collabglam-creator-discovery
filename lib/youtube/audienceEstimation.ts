/**
 * Category-benchmark audience estimation, and the content-category resolver Discovery uses.
 *
 * YouTube's public API does not expose per-creator audience age/gender — that data lives only in
 * the channel owner's own YouTube Analytics. When there's no verified source (a human transcribed
 * it from the creator's own analytics), the honest fallback is a *category benchmark*: the typical
 * audience shape for this kind of content, adjusted by real signals we can actually observe
 * (content format mix, language, declared country) — never a per-creator measurement.
 *
 * Everything this module returns is explicitly an estimate and must be rendered as one (a neutral
 * "Category benchmark" badge, "~" before every percentage, a Method footnote) — never given the
 * "Verified" badge real transcribed numbers get. Percentages are rounded to the nearest 5 so they
 * never imply a precision the underlying data doesn't have.
 */

export interface DemographicSlice {
  label: string;
  percent: number;
}

interface CategoryBenchmark {
  male: number;
  ages: Record<string, number>;
}

// Published industry norms for YouTube audience composition by content category. `male` is the
// share of the audience that skews male; `ages` are the typical age-band shares. Directional
// category averages, not creator measurements.
const CATEGORY_AUDIENCE_BENCHMARKS: Record<string, CategoryBenchmark> = {
  technology: { male: 72, ages: { "13-17": 3, "18-24": 22, "25-34": 38, "35-44": 24, "45-54": 9, "55+": 4 } },
  gaming: { male: 70, ages: { "13-17": 14, "18-24": 34, "25-34": 32, "35-44": 13, "45-54": 5, "55+": 2 } },
  beauty: { male: 24, ages: { "13-17": 10, "18-24": 32, "25-34": 33, "35-44": 16, "45-54": 6, "55+": 3 } },
  fashion: { male: 30, ages: { "13-17": 9, "18-24": 31, "25-34": 33, "35-44": 17, "45-54": 7, "55+": 3 } },
  finance: { male: 68, ages: { "13-17": 2, "18-24": 18, "25-34": 37, "35-44": 26, "45-54": 12, "55+": 5 } },
  business: { male: 64, ages: { "13-17": 2, "18-24": 17, "25-34": 36, "35-44": 27, "45-54": 13, "55+": 5 } },
  food: { male: 42, ages: { "13-17": 5, "18-24": 20, "25-34": 32, "35-44": 24, "45-54": 12, "55+": 7 } },
  travel: { male: 48, ages: { "13-17": 4, "18-24": 21, "25-34": 34, "35-44": 24, "45-54": 11, "55+": 6 } },
  fitness: { male: 55, ages: { "13-17": 6, "18-24": 28, "25-34": 35, "35-44": 19, "45-54": 8, "55+": 4 } },
  health: { male: 43, ages: { "13-17": 3, "18-24": 18, "25-34": 31, "35-44": 25, "45-54": 14, "55+": 9 } },
  parenting: { male: 20, ages: { "13-17": 2, "18-24": 14, "25-34": 40, "35-44": 29, "45-54": 10, "55+": 5 } },
  automotive: { male: 84, ages: { "13-17": 5, "18-24": 24, "25-34": 34, "35-44": 22, "45-54": 10, "55+": 5 } },
  sports: { male: 76, ages: { "13-17": 8, "18-24": 26, "25-34": 33, "35-44": 20, "45-54": 9, "55+": 4 } },
  music: { male: 50, ages: { "13-17": 12, "18-24": 31, "25-34": 30, "35-44": 16, "45-54": 7, "55+": 4 } },
  comedy: { male: 56, ages: { "13-17": 12, "18-24": 32, "25-34": 30, "35-44": 16, "45-54": 7, "55+": 3 } },
  entertainment: { male: 52, ages: { "13-17": 11, "18-24": 31, "25-34": 31, "35-44": 16, "45-54": 8, "55+": 3 } },
  education: { male: 54, ages: { "13-17": 10, "18-24": 33, "25-34": 31, "35-44": 16, "45-54": 7, "55+": 3 } },
  news: { male: 60, ages: { "13-17": 2, "18-24": 13, "25-34": 26, "35-44": 26, "45-54": 19, "55+": 14 } },
  pets: { male: 35, ages: { "13-17": 7, "18-24": 24, "25-34": 32, "35-44": 21, "45-54": 10, "55+": 6 } },
  diy: { male: 58, ages: { "13-17": 4, "18-24": 19, "25-34": 32, "35-44": 25, "45-54": 13, "55+": 7 } },
  lifestyle: { male: 38, ages: { "13-17": 8, "18-24": 29, "25-34": 33, "35-44": 18, "45-54": 8, "55+": 4 } },
  vlogging: { male: 45, ages: { "13-17": 10, "18-24": 31, "25-34": 31, "35-44": 17, "45-54": 8, "55+": 3 } },
  podcast: { male: 58, ages: { "13-17": 3, "18-24": 22, "25-34": 36, "35-44": 23, "45-54": 11, "55+": 5 } },
  review: { male: 66, ages: { "13-17": 5, "18-24": 24, "25-34": 35, "35-44": 22, "45-54": 10, "55+": 4 } },
  unboxing: { male: 62, ages: { "13-17": 8, "18-24": 27, "25-34": 34, "35-44": 19, "45-54": 8, "55+": 4 } },
  tutorial: { male: 55, ages: { "13-17": 7, "18-24": 30, "25-34": 33, "35-44": 18, "45-54": 8, "55+": 4 } },
};

// Used when no category matches — a broad YouTube-wide average. Confidence is reported as "low"
// in this case so the UI can say so.
const DEFAULT_BENCHMARK: CategoryBenchmark = {
  male: 55,
  ages: { "13-17": 8, "18-24": 27, "25-34": 32, "35-44": 19, "45-54": 9, "55+": 5 },
};

const AGE_BANDS = ["13-17", "18-24", "25-34", "35-44", "45-54", "55+"];

/** Every category a creator can resolve to — shared with Discovery's category filter so the two
 * can't drift apart. */
export const AUDIENCE_CATEGORY_KEYS = Object.keys(CATEGORY_AUDIENCE_BENCHMARKS);

// These describe how a video is made rather than what it is about — only used when no genuine
// subject-matter category can be identified.
const FORMAT_CATEGORIES = new Set(["review", "unboxing", "tutorial", "podcast", "vlogging"]);

// Extra keyword hints so a creator whose declared category is vague still lands on a sensible
// benchmark based on their tags/topics.
const CATEGORY_KEYWORD_HINTS: [string, RegExp][] = [
  ["gaming", /\b(gaming|gamer|gameplay|esports|playthrough|walkthrough|fps|rpg)\b/i],
  ["technology", /\b(tech|gadget|smartphone|laptop|pc build|software|ai|coding|developer)\b/i],
  ["beauty", /\b(beauty|makeup|skincare|skin care|cosmetics?|haircare|sunscreens?|sunblock|spf|serums?|moisturi[sz]ers?|cleansers?|lipsticks?)\b/i],
  ["fashion", /\b(fashion|outfit|styling|streetwear|haul|lookbook)\b/i],
  ["finance", /\b(finance|investing|stocks|crypto|trading|money|budget)\b/i],
  ["business", /\b(business|entrepreneur|startup|marketing|ecommerce)\b/i],
  ["food", /\b(food|cooking|recipe|baking|kitchen|restaurant|chef)\b/i],
  ["travel", /\b(travel|vlog abroad|tourism|backpack|destination)\b/i],
  ["fitness", /\b(fitness|workout|gym|bodybuilding|training)\b/i],
  ["health", /\b(health|medical|wellness|nutrition|doctor|mental health)\b/i],
  ["parenting", /\b(parenting|mom|dad|baby|toddler|pregnancy|kids)\b/i],
  ["automotive", /\b(cars?|auto|automotive|motorbike|motorcycle|vehicles?|vans?|trucks?|driving|drive|supercar|evs?|electric car|electric van|charging|road trip)\b/i],
  ["sports", /\b(sports|football|cricket|basketball|nba|fifa|athlete)\b/i],
  ["music", /\b(music|song|songs|guitar|piano|producer|cover|band|album|lyrics|official video|official audio|remix|feat|ft|live performance|concert|tour|single|vevo)\b/i],
  ["comedy", /\b(comedy|funny|sketch|prank|humor|standup)\b/i],
  ["entertainment", /\b(challenge|challenges|survive|survived|giveaway|extreme|24 hours|100 days|last to leave|vs\b|reacts|reaction|experiment)\b/i],
  ["education", /\b(education|learn|study|exam|lecture|course|explained)\b/i],
  ["news", /\b(news|politics|current affairs|journalism|breaking)\b/i],
  ["pets", /\b(pet|dog|cat|animal|puppy|aquarium)\b/i],
  ["diy", /\b(diy|woodworking|home improvement|craft|renovation|build)\b/i],
  ["podcast", /\b(podcast|interview|conversation|episode)\b/i],
  ["unboxing", /\b(unboxing|first look)\b/i],
  ["review", /\b(review|comparison|versus|buying guide)\b/i],
  ["tutorial", /\b(tutorial|how to|guide|walkthrough|tips)\b/i],
  ["lifestyle", /\b(lifestyle|daily vlog|routine|minimalism)\b/i],
];

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

/** Round to the nearest 5 so benchmark figures never imply measured precision. */
function roundTo5(n: number): number {
  return Math.max(0, Math.round(n / 5) * 5);
}

type MatchedBy = "youtube_topic" | "content" | "category" | "default";

/**
 * Pick the benchmark bucket for a creator from their category/topic signals. Returns the matched
 * key plus how the match was made, so the UI can be honest about how confident the estimate is.
 */
function resolveCategoryKey(params: {
  youtubeTopicCategory?: string;
  category?: string;
  channelCategory?: string;
  topics?: string[];
  tags?: string[];
  contentText?: string;
}): { key: string | null; matchedBy: MatchedBy; label: string } {
  const { youtubeTopicCategory = "", category, channelCategory, topics = [], tags = [], contentText = "" } = params;

  // 1. YouTube's own declared topic for the channel is the most trustworthy signal — it
  //    describes the creator, not how we happened to find them.
  const declared = cleanText(youtubeTopicCategory).toLowerCase();
  if (declared && CATEGORY_AUDIENCE_BENCHMARKS[declared]) {
    return { key: declared, matchedBy: "youtube_topic", label: declared };
  }

  // 2. The creator's own content (channel tags, video titles, description). This deliberately
  //    outranks the stored `category` field, because that field holds the *search query that
  //    discovered* the creator — a music channel surfaced by a beauty-keyword search would
  //    otherwise inherit a beauty audience profile, which would be flatly wrong.
  //
  //    Categories are *scored* by how often their hints occur rather than first-match-wins: a
  //    single incidental word must not outvote a whole channel's worth of another topic's
  //    signals. Channel tags are weighted highest since they are author-declared.
  const weightedSources = [
    { text: tags.map(cleanText).filter(Boolean).join(" "), weight: 3 },
    { text: topics.map(cleanText).filter(Boolean).join(" "), weight: 2 },
    { text: cleanText(contentText), weight: 1 },
  ].filter((s) => s.text);

  if (weightedSources.length) {
    const scores = new Map<string, number>();

    for (const [key, pattern] of CATEGORY_KEYWORD_HINTS) {
      const global = new RegExp(pattern.source, "gi");
      let score = 0;

      for (const { text, weight } of weightedSources) {
        const hits = (text.match(global) || []).length;
        score += hits * weight;
      }

      // "review"/"unboxing"/"tutorial" describe a video *format*, not a subject — a car
      // reviewer is automotive first. Discount them so a genuine topic match wins whenever
      // one exists.
      if (FORMAT_CATEGORIES.has(key)) score *= 0.4;

      if (score > 0) scores.set(key, (scores.get(key) ?? 0) + score);
    }

    if (scores.size) {
      const [bestKey, bestScore] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
      // Require more than a single incidental mention before trusting it.
      if (bestScore >= 2) {
        return { key: bestKey, matchedBy: "content", label: bestKey };
      }
    }
  }

  // 3. Fall back to the stored category, but only when it looks like an actual category rather
  //    than a multi-word search phrase.
  const storedCandidates = [category, channelCategory]
    .map((c) => cleanText(c))
    .filter((c) => c && c.split(/\s+/).length <= 3)
    .map((c) => c.toLowerCase());

  const direct = storedCandidates.find((c) => CATEGORY_AUDIENCE_BENCHMARKS[c]);
  if (direct) return { key: direct, matchedBy: "category", label: direct };

  return { key: null, matchedBy: "default", label: "general" };
}

/**
 * Shift the age curve based on content format. Shorts-heavy channels skew meaningfully younger
 * than long-form ones — this is a real, observable signal from the creator's own upload mix, not
 * a guess.
 */
function applyFormatSkew(ages: Record<string, number>, shortsPercentage: number | null): { ages: Record<string, number>; note: string | null } {
  const shorts = Number(shortsPercentage);
  if (!Number.isFinite(shorts)) return { ages, note: null };

  const adjusted = { ...ages };

  if (shorts >= 60) {
    const move = 8;
    const takeFrom = ["35-44", "45-54", "55+"];
    let moved = 0;
    for (const band of takeFrom) {
      const take = Math.min(adjusted[band] || 0, move / takeFrom.length);
      adjusted[band] = (adjusted[band] || 0) - take;
      moved += take;
    }
    adjusted["13-17"] = (adjusted["13-17"] || 0) + moved * 0.4;
    adjusted["18-24"] = (adjusted["18-24"] || 0) + moved * 0.6;
    return { ages: adjusted, note: "Shorts-heavy upload mix — skewed younger" };
  }

  if (shorts <= 15) {
    const move = 5;
    const takeFrom = ["13-17", "18-24"];
    let moved = 0;
    for (const band of takeFrom) {
      const take = Math.min(adjusted[band] || 0, move / takeFrom.length);
      adjusted[band] = (adjusted[band] || 0) - take;
      moved += take;
    }
    adjusted["25-34"] = (adjusted["25-34"] || 0) + moved * 0.5;
    adjusted["35-44"] = (adjusted["35-44"] || 0) + moved * 0.5;
    return { ages: adjusted, note: "Long-form upload mix — skewed slightly older" };
  }

  return { ages: adjusted, note: null };
}

function normalizeTo100(ages: Record<string, number>): Record<string, number> {
  const total = AGE_BANDS.reduce((sum, band) => sum + (Number(ages[band]) || 0), 0);
  if (!total) return ages;

  const scaled: Record<string, number> = {};
  for (const band of AGE_BANDS) scaled[band] = ((Number(ages[band]) || 0) / total) * 100;
  return scaled;
}

export interface AudienceDemographicEstimate {
  isEstimate: true;
  /** The resolved content category (e.g. "automotive"), or "" when none could be identified. */
  categoryLabel: string;
  confidence: "medium" | "low-medium" | "low";
  /** Human-readable basis lines — content category, format-skew note, content language — joined
   * for the "Method:" footnote the UI is required to show alongside these numbers. */
  basis: string[];
  genderSplit: DemographicSlice[];
  ageSplit: DemographicSlice[];
  dominantAgeBand: string | null;
}

/**
 * Build a clearly-labelled estimated audience profile for a creator. Every number here is a
 * category benchmark adjusted by real observable signals — never a per-creator measurement, and
 * never to be rendered without its confidence/basis alongside it.
 */
export function estimateAudienceDemographics(params: {
  youtubeTopicCategory?: string;
  category?: string;
  channelCategory?: string;
  topics?: string[];
  tags?: string[];
  contentText?: string;
  shortsPercentage?: number | null;
  primaryLanguage?: string;
}): AudienceDemographicEstimate {
  const resolved = resolveCategoryKey(params);
  const benchmark = resolved.key ? CATEGORY_AUDIENCE_BENCHMARKS[resolved.key] : DEFAULT_BENCHMARK;

  const { ages: skewedAges, note: formatNote } = applyFormatSkew(benchmark.ages, params.shortsPercentage ?? null);
  const normalized = normalizeTo100(skewedAges);

  const ageSplit = AGE_BANDS.map((band) => ({
    label: band,
    percent: roundTo5(normalized[band] || 0),
  })).filter((b) => b.percent > 0);

  const dominant = [...ageSplit].sort((a, b) => b.percent - a.percent)[0] ?? null;

  const malePct = roundTo5(benchmark.male);
  const genderSplit: DemographicSlice[] = [
    { label: "Male", percent: malePct },
    { label: "Female", percent: 100 - malePct },
  ];

  const basis: string[] = [];
  if (resolved.matchedBy === "youtube_topic") {
    basis.push(`Content category: ${resolved.label} (YouTube-declared channel topic)`);
  } else if (resolved.matchedBy === "content") {
    basis.push(`Content category: ${resolved.label} (inferred from the creator's own videos and tags)`);
  } else if (resolved.matchedBy === "category") {
    basis.push(`Content category: ${cleanText(params.category) || cleanText(params.channelCategory)}`);
  } else {
    basis.push("No clear content category — using a broad YouTube-wide average");
  }

  if (formatNote) basis.push(formatNote);
  if (cleanText(params.primaryLanguage)) basis.push(`Content language: ${cleanText(params.primaryLanguage)}`);

  const confidence: AudienceDemographicEstimate["confidence"] =
    resolved.matchedBy === "youtube_topic" ? "medium" : resolved.matchedBy === "content" ? "low-medium" : resolved.matchedBy === "category" ? "low-medium" : "low";

  return {
    isEstimate: true,
    categoryLabel: resolved.key || "",
    confidence,
    basis,
    genderSplit,
    ageSplit,
    dominantAgeBand: dominant ? dominant.label : null,
  };
}
