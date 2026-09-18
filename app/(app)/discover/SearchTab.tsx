"use client";

import { useMemo, useState } from "react";
import { Search, Loader2, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { heuristicParseBrief } from "@/lib/discovery/campaignProfile";
import { readNdjson, type BriefOption, type SearchRunResponse } from "@/lib/discoveryTypes";
import { MARKETS } from "@/lib/markets";
import ResultsTable from "./ResultsTable";

const LANGUAGES = [
  { code: "", label: "Any language" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "id", label: "Indonesian" },
];

const FRESHNESS_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "30", label: "Posted in last 30 days" },
  { value: "90", label: "Posted in last 90 days" },
  { value: "180", label: "Posted in last 6 months" },
  { value: "365", label: "Posted in last year" },
];

const SEARCH_ORDER_OPTIONS = [
  { value: "relevance", label: "YouTube relevance" },
  { value: "viewCount", label: "Most total views" },
  { value: "date", label: "Newest channels" },
];

const SORT_BY_OPTIONS = [
  { value: "relevance", label: "Best match" },
  { value: "quality", label: "Highest quality" },
  { value: "subscribers", label: "Most subscribers" },
  { value: "engagement", label: "Highest engagement" },
  { value: "avgViews", label: "Most avg views" },
  { value: "recentUpload", label: "Most recently active" },
];

const RESULT_COUNTS = [10, 20, 30, 50];

const PLATFORM_OPTIONS = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "twitter", label: "Twitter/X" },
  { key: "pinterest", label: "Pinterest" },
  { key: "facebook", label: "Facebook" },
  { key: "amazonStorefront", label: "Amazon storefront" },
];

const TIER_OPTIONS = [
  { key: "nano", label: "Nano 1K–10K" },
  { key: "micro", label: "Micro 10K–100K" },
  { key: "mid", label: "Mid 100K–500K" },
  { key: "macro", label: "Macro 500K–1M" },
  { key: "mega", label: "Mega 1M+" },
];

const CATEGORY_OPTIONS = [
  "technology", "gaming", "beauty", "fashion", "finance", "business", "food", "travel", "fitness", "health", "parenting",
  "automotive", "sports", "music", "comedy", "entertainment", "education", "news", "pets", "diy", "lifestyle", "vlogging",
  "podcast", "review", "unboxing", "tutorial",
];

const SEARCH_UNIT_COST = 100;
const MAX_PHRASES = 5;

function estimateUnits(query: string, maxResults: number, headroom: boolean, expand: boolean): number {
  const typed = Math.min(new Set(query.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)).size || 1, MAX_PHRASES);
  const phrases = expand ? MAX_PHRASES : typed;
  const survivors = headroom ? Math.min(maxResults * 2, 60) : maxResults;
  return phrases * SEARCH_UNIT_COST + Math.ceil(Math.min(phrases * 50, 150) / 50) + survivors * 2;
}

function briefKeywords(brief: BriefOption | null): string {
  if (!brief) return "";
  const niches = brief.targetNiche
    .split(/[,;\n|]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_PHRASES);
  if (niches.length > 0) return niches.join(", ");
  return heuristicParseBrief(brief.brief).profile.targetProducts.slice(0, MAX_PHRASES).join(", ");
}

export default function SearchTab({ brief, defaultListName }: { brief: BriefOption | null; defaultListName: string }) {
  const [query, setQuery] = useState(briefKeywords(brief));
  const [expandKeywords, setExpandKeywords] = useState(false);
  const [country, setCountry] = useState(brief?.market ?? "");
  const [language, setLanguage] = useState("");
  const [minSubscribers, setMinSubscribers] = useState(brief?.minSubscribers?.toString() ?? "");
  const [maxSubscribers, setMaxSubscribers] = useState(brief?.maxSubscribers?.toString() ?? "");
  const [subscriberTiers, setSubscriberTiers] = useState<string[]>([]);
  const [minAverageViews, setMinAverageViews] = useState("");
  const [maxAverageViews, setMaxAverageViews] = useState("");
  const [minEngagementRate, setMinEngagementRate] = useState("");
  const [postedWithinDays, setPostedWithinDays] = useState("");
  const [sortOrder, setSortOrder] = useState("relevance");
  const [sortBy, setSortBy] = useState("relevance");
  const [maxResults, setMaxResults] = useState(20);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [hasEmail, setHasEmail] = useState(false);
  const [excludeBrandChannels, setExcludeBrandChannels] = useState(true);
  const [minBrandSafety, setMinBrandSafety] = useState("");
  const [minSponsorshipFrequency, setMinSponsorshipFrequency] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(!!(brief?.minSubscribers || brief?.maxSubscribers));

  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [emailProgress, setEmailProgress] = useState<{ researched: number; toResearch: number; found: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchRunResponse | null>(null);

  const headroom = !!(postedWithinDays || minAverageViews || maxAverageViews || minEngagementRate || minBrandSafety || minSponsorshipFrequency || hasEmail || categories.length);
  const estimatedUnits = useMemo(() => estimateUnits(query, maxResults, headroom, expandKeywords), [query, maxResults, headroom, expandKeywords]);

  function toggle(list: string[], setList: (v: string[]) => void, key: string) {
    setList(list.includes(key) ? list.filter((p) => p !== key) : [...list, key]);
  }

  async function search() {
    if (!query.trim()) {
      setError("Enter a niche or keyword to search for");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setEmailProgress(null);
    setStage("Starting…");
    try {
      const res = await fetch("/api/discovery/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          briefId: brief?.id,
          expandKeywords,
          country,
          language,
          minSubscribers,
          maxSubscribers,
          subscriberTiers,
          minAverageViews,
          maxAverageViews,
          minEngagementRate,
          postedWithinDays,
          platforms,
          categories,
          hasEmail,
          excludeBrandChannels,
          minBrandSafety,
          minSponsorshipFrequency,
          sortOrder,
          sortBy,
          maxResults,
        }),
      });
      const data = await readNdjson<SearchRunResponse>(res, (event) => {
        if (event.type === "stage") setStage(String(event.message));
        else if (event.type === "emailProgress") setEmailProgress(event as unknown as { researched: number; toResearch: number; found: number });
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const chip = (active: boolean): React.CSSProperties =>
    active ? { background: "var(--brand-teal-light)", color: "var(--brand-teal-dark)" } : { background: "var(--neutral-bg)", color: "var(--neutral-fg)" };

  return (
    <div className="space-y-5">
      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-2)]" />
            <input
              className="input pl-9"
              placeholder="Niche or keywords — separate a few with commas, e.g. tech unboxing, gadget review, smartphone deals"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && void search()}
            />
          </div>
          <button onClick={() => void search()} disabled={loading} className="btn-primary inline-flex items-center justify-center gap-1.5 px-5 py-2 text-sm">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        <label className="flex items-center gap-2 text-[11.5px] text-[var(--muted)] cursor-pointer w-fit">
          <input type="checkbox" checked={expandKeywords} onChange={(e) => setExpandKeywords(e.target.checked)} />
          <Sparkles size={12} style={{ color: "var(--brand-teal-dark)" }} />
          Also search &ldquo;review&rdquo;, &ldquo;unboxing&rdquo; and &ldquo;best …&rdquo; variants
          <span className="text-[var(--muted-2)]">(wider net, +100 units per added phrase)</span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto py-1.5 text-xs" value={country} onChange={(e) => setCountry(e.target.value)}>
            {MARKETS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code ? c.label : "Any country"}
              </option>
            ))}
          </select>
          <select className="input w-auto py-1.5 text-xs" value={postedWithinDays} onChange={(e) => setPostedWithinDays(e.target.value)}>
            {FRESHNESS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select className="input w-auto py-1.5 text-xs" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label}
              </option>
            ))}
          </select>
          <select className="input w-auto py-1.5 text-xs" value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))}>
            {RESULT_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n} results
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--muted)] cursor-pointer">
            <input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} />
            Only creators with an email
          </label>
          <button type="button" onClick={() => setAdvancedOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-teal-dark)] ml-auto">
            {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Advanced filters
          </button>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[var(--muted-2)] uppercase tracking-wide mb-1.5">Audience size</label>
          <div className="flex flex-wrap gap-1.5">
            {TIER_OPTIONS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => toggle(subscriberTiers, setSubscriberTiers, t.key)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                style={chip(subscriberTiers.includes(t.key))}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {advancedOpen && (
          <div className="space-y-3 rounded-xl p-3 border border-[var(--border)]" style={{ background: "var(--bg)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto py-1.5 text-xs" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <select className="input w-auto py-1.5 text-xs" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                {SEARCH_ORDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    Fetch by: {o.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <input type="number" className="input w-28 py-1.5 text-xs" placeholder="Min subs" value={minSubscribers} onChange={(e) => setMinSubscribers(e.target.value)} />
                <span className="text-[var(--muted-2)] text-xs">–</span>
                <input type="number" className="input w-28 py-1.5 text-xs" placeholder="Max subs" value={maxSubscribers} onChange={(e) => setMaxSubscribers(e.target.value)} />
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" className="input w-32 py-1.5 text-xs" placeholder="Min avg views" value={minAverageViews} onChange={(e) => setMinAverageViews(e.target.value)} />
                <span className="text-[var(--muted-2)] text-xs">–</span>
                <input type="number" className="input w-32 py-1.5 text-xs" placeholder="Max avg views" value={maxAverageViews} onChange={(e) => setMaxAverageViews(e.target.value)} />
              </div>
              <input type="number" step="0.1" className="input w-36 py-1.5 text-xs" placeholder="Min engagement %" value={minEngagementRate} onChange={(e) => setMinEngagementRate(e.target.value)} />
              <input type="number" className="input w-40 py-1.5 text-xs" placeholder="Min brand safety (0-100)" value={minBrandSafety} onChange={(e) => setMinBrandSafety(e.target.value)} />
              <input
                type="number"
                className="input w-44 py-1.5 text-xs"
                placeholder="Min % sponsored uploads"
                value={minSponsorshipFrequency}
                onChange={(e) => setMinSponsorshipFrequency(e.target.value)}
              />
            </div>

            <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--muted)] cursor-pointer w-fit">
              <input type="checkbox" checked={excludeBrandChannels} onChange={(e) => setExcludeBrandChannels(e.target.checked)} />
              Exclude brand &amp; news channels
            </label>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted-2)] uppercase tracking-wide mb-1.5">Also active on (any of)</label>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORM_OPTIONS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => toggle(platforms, setPlatforms, p.key)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                    style={chip(platforms.includes(p.key))}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted-2)] uppercase tracking-wide mb-1.5">Content category (any of)</label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggle(categories, setCategories, c)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium capitalize transition-colors"
                    style={chip(categories.includes(c))}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {error ? (
            <p className="text-xs" style={{ color: "var(--danger-fg)" }}>
              {error}
            </p>
          ) : (
            <span />
          )}
          <span className="text-[11px] text-[var(--muted-2)]">~{estimatedUnits} API units for this search</span>
        </div>
      </div>

      {loading && (
        <div className="card p-4 flex items-center gap-2 text-sm text-[var(--ink)] flex-wrap">
          <Loader2 size={15} className="animate-spin" /> {stage}
          {emailProgress && (
            <span className="text-[12px] text-[var(--muted)]">
              · {emailProgress.researched}/{emailProgress.toResearch} researched · {emailProgress.found} emails found
            </span>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted-2)]">
            {result.creators.length} shown{result.candidateCount > result.creators.length ? ` of ${result.candidateCount} matching the basic filters` : ""} ·{" "}
            {result.creators.filter((c) => c.email).length} with email
            {result.hiddenAsClaimed > 0 ? ` · ${result.hiddenAsClaimed} hidden because they were already assigned to the team` : ""} · searched{" "}
            {result.searchedPhrases.map((p) => `“${p}”`).join(", ")} · {result.unitsUsed} API units
          </p>
          <ResultsTable key={result.runId} runId={result.runId} creators={result.creators} briefId={brief?.id ?? null} defaultListName={defaultListName} />
        </div>
      )}
    </div>
  );
}
