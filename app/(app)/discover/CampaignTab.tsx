"use client";

import { useMemo, useState } from "react";
import { Loader2, Wand2, X, Play, AlertTriangle } from "lucide-react";
import { buildKeywordMatrix, type CampaignProfile, type ContentFormat } from "@/lib/discovery/campaignProfile";
import type { DiscoveryDepth } from "@/lib/discovery/campaignDiscovery";
import type { ScoreBreakdown } from "@/lib/discovery/creatorQualifier";
import { readNdjson, type BriefOption, type CampaignDetail, type CampaignRunResponse } from "@/lib/discoveryTypes";
import { MARKETS } from "@/lib/markets";
import { compact } from "@/lib/format";
import ResultsTable, { Bullets } from "./ResultsTable";

const CONTENT_OPTIONS: ContentFormat[] = [
  "review", "unboxing", "test", "setup", "installation", "first look", "hands on", "comparison", "demo", "buying guide",
  "long term review", "worth it", "tutorial",
];

const TIERS = [
  { tier: "A", label: "A · Excellent", hint: "Repeatedly covers the category and regularly reviews products" },
  { tier: "B", label: "B · Strong", hint: "Meaningful relevant content, not their dominant focus" },
  { tier: "C", label: "C · Possible", hint: "Occasionally covers the category" },
  { tier: "D", label: "D · Rejected", hint: "Keyword match without enough relevant content — emails not researched" },
];

const SCORE_PARTS: { key: Exclude<keyof ScoreBreakdown, "total">; label: string; max: number }[] = [
  { key: "contentRelevance", label: "Content relevance", max: 35 },
  { key: "reviewBehavior", label: "Review / unboxing behavior", max: 20 },
  { key: "productSimilarity", label: "Product similarity", max: 15 },
  { key: "marketFit", label: "Audience / market fit", max: 10 },
  { key: "consistency", label: "Channel consistency", max: 10 },
  { key: "engagement", label: "Engagement", max: 10 },
];

const BRIEF_EXAMPLE =
  "Find US YouTube creators with 10K–50K subscribers who create treadmill, walking pad, home gym, fitness equipment, unboxing, testing, and review videos.";

interface DepthOption {
  key: DiscoveryDepth;
  label: string;
  maxQueries: number;
  analyzeLimit: number;
  estimatedUnits: number;
}

export default function CampaignTab({ brief, defaultListName }: { brief: BriefOption | null; defaultListName: string }) {
  const [briefText, setBriefText] = useState(brief?.brief ?? "");
  const [parsing, setParsing] = useState(false);
  const [profile, setProfile] = useState<CampaignProfile | null>(null);
  const [parseNotes, setParseNotes] = useState<string[]>([]);
  const [depths, setDepths] = useState<DepthOption[]>([]);
  const [depth, setDepth] = useState<DiscoveryDepth>("standard");

  const [running, setRunning] = useState(false);
  const [stageMessage, setStageMessage] = useState("");
  const [progress, setProgress] = useState<Record<string, number> | null>(null);
  const [emailProgress, setEmailProgress] = useState<Record<string, number> | null>(null);
  const [result, setResult] = useState<CampaignRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleTiers, setVisibleTiers] = useState<string[]>(["A", "B", "C"]);
  const [emailOnly, setEmailOnly] = useState(false);

  const keywordPreview = useMemo(() => (profile ? buildKeywordMatrix(profile, 30).map((q) => q.query) : []), [profile]);
  const selectedDepth = depths.find((d) => d.key === depth);
  const shown = useMemo(() => {
    if (!result || !profile) return [];
    return result.creators.filter((c) => visibleTiers.includes(c.tier ?? "") && (!emailOnly || c.email)).slice(0, profile.creatorCount);
  }, [result, visibleTiers, profile, emailOnly]);

  function patch(update: Partial<CampaignProfile>) {
    setProfile((prev) => (prev ? { ...prev, ...update } : prev));
  }

  async function buildProfile() {
    if (brief?.closed) {
      setError("This campaign deadline has been reached. No further entries are accepted.");
      return;
    }
    if (!briefText.trim()) {
      setError("Describe the campaign first");
      return;
    }
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/discovery/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: briefText, briefId: brief?.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't read that brief");
      setProfile(data.profile);
      setParseNotes(data.notes ?? []);
      setDepths(data.depths ?? []);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that brief");
    } finally {
      setParsing(false);
    }
  }

  async function runDiscovery() {
    if (brief?.closed) {
      setError("This campaign deadline has been reached. No further entries are accepted.");
      return;
    }
    if (!profile) return;
    if (profile.targetProducts.length === 0) {
      setError("Add at least one target product or niche");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setEmailProgress(null);
    setStageMessage("Starting…");
    try {
      const res = await fetch("/api/discovery/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, depth, briefId: brief?.id, brief: briefText }),
      });
      const data = await readNdjson<CampaignRunResponse>(res, (event) => {
        if (event.type === "stage") setStageMessage(String(event.message));
        else if (event.type === "progress") setProgress(event as unknown as Record<string, number>);
        else if (event.type === "emailProgress") setEmailProgress(event as unknown as Record<string, number>);
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">Describe the campaign</h2>
          <p className="text-[12px] text-[var(--muted-2)] mt-0.5">
            {brief
              ? `Filled in from the ${brief.brandName} brief — adjust it if you want a different angle.`
              : "Market, subscriber range, products or niche, content types, brands — in plain language."}{" "}
            Nothing is searched until you&apos;ve reviewed the profile.
          </p>
        </div>
        <textarea
          className="input font-sans text-sm"
          style={{ minHeight: 88, resize: "vertical" }}
          placeholder={BRIEF_EXAMPLE}
          value={briefText}
          onChange={(e) => setBriefText(e.target.value)}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => void buildProfile()} disabled={parsing || running || !!brief?.closed} className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm">
            {parsing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {parsing ? "Reading brief…" : "Build discovery profile"}
          </button>
          {!briefText && (
            <button type="button" onClick={() => setBriefText(BRIEF_EXAMPLE)} className="text-xs font-medium text-[var(--brand-teal-dark)]">
              Use the example brief
            </button>
          )}
        </div>
      </div>

      {profile && (
        <div className="card p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Discovery profile</h2>
            <span className="badge" style={{ background: "var(--neutral-bg)", color: "var(--neutral-fg)", fontSize: 10.5 }}>
              Review and edit before running
            </span>
          </div>

          {parseNotes.length > 0 && (
            <ul className="text-[11.5px] text-[var(--muted)] space-y-0.5">
              {parseNotes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Market">
              <select className="input py-1.5 text-xs" value={profile.market} onChange={(e) => patch({ market: e.target.value })}>
                {MARKETS.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Subscribers">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  className="input py-1.5 text-xs"
                  placeholder="Min"
                  value={profile.minSubscribers ?? ""}
                  onChange={(e) => patch({ minSubscribers: e.target.value ? Number(e.target.value) : null })}
                />
                <span className="text-[var(--muted-2)] text-xs">–</span>
                <input
                  type="number"
                  className="input py-1.5 text-xs"
                  placeholder="Max"
                  value={profile.maxSubscribers ?? ""}
                  onChange={(e) => patch({ maxSubscribers: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
            </Field>
            <Field label="Category">
              <input className="input py-1.5 text-xs" value={profile.category} placeholder="e.g. fitness" onChange={(e) => patch({ category: e.target.value })} />
            </Field>
            <Field label="Creators to show · min engagement %">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  className="input py-1.5 text-xs"
                  value={profile.creatorCount}
                  min={5}
                  max={70}
                  onChange={(e) => patch({ creatorCount: Math.min(Math.max(Number(e.target.value) || 20, 5), 70) })}
                />
                <input
                  type="number"
                  step="0.1"
                  className="input py-1.5 text-xs"
                  placeholder="Any"
                  value={profile.minEngagementRate ?? ""}
                  onChange={(e) => patch({ minEngagementRate: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
            </Field>
          </div>

          <ChipEditor
            label="Target products / niche — exact matches"
            values={profile.targetProducts}
            placeholder="Add a product and press Enter"
            onChange={(targetProducts) => patch({ targetProducts })}
          />
          <ChipEditor
            label="Related products — widen the search, scored as related"
            values={profile.relatedTerms}
            placeholder="Add a related product"
            onChange={(relatedTerms) => patch({ relatedTerms })}
          />
          <ChipEditor label="Brands (optional)" values={profile.brands} placeholder="Add a brand" onChange={(brands) => patch({ brands })} />

          <div>
            <Label>Content types</Label>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_OPTIONS.map((format) => {
                const active = profile.desiredContent.includes(format);
                return (
                  <button
                    key={format}
                    type="button"
                    onClick={() =>
                      patch({ desiredContent: active ? profile.desiredContent.filter((f) => f !== format) : [...profile.desiredContent, format] })
                    }
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium capitalize transition-colors"
                    style={active ? { background: "var(--brand-teal-light)", color: "var(--brand-teal-dark)" } : { background: "var(--neutral-bg)", color: "var(--neutral-fg)" }}
                  >
                    {format}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-[12px] text-[var(--muted)] cursor-pointer w-fit">
            <input type="checkbox" checked={profile.requireProductReviewers} onChange={(e) => patch({ requireProductReviewers: e.target.checked })} />
            Require product-review behavior — reject creators who never review, unbox or test products
          </label>

          <div>
            <Label>Keyword matrix · {keywordPreview.length} available searches</Label>
            <div className="flex flex-wrap gap-1">
              {keywordPreview.slice(0, 18).map((q) => (
                <span key={q} className="px-2 py-0.5 rounded text-[11px]" style={{ background: "var(--bg)", color: "var(--muted)" }}>
                  {q}
                </span>
              ))}
              {keywordPreview.length > 18 && <span className="px-2 py-0.5 text-[11px] text-[var(--muted-2)]">+{keywordPreview.length - 18} more</span>}
            </div>
          </div>

          <div className="flex items-end justify-between gap-3 flex-wrap border-t border-[var(--border)] pt-3">
            <div>
              <Label>Search depth</Label>
              <div className="flex gap-1.5 flex-wrap">
                {depths.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => {
                      setDepth(d.key);
                      patch({ creatorCount: d.analyzeLimit });
                    }}
                    className="px-3 py-1.5 rounded-lg text-[11.5px] text-left transition-colors border"
                    style={
                      depth === d.key
                        ? { background: "var(--brand-teal-light)", color: "var(--brand-teal-dark)", borderColor: "var(--brand-teal-dark)" }
                        : { background: "transparent", color: "var(--muted)", borderColor: "var(--border)" }
                    }
                  >
                    <span className="font-semibold">{d.label}</span>
                    <span className="block text-[10.5px] opacity-80">
                      up to {d.maxQueries} searches · analyze up to {d.analyzeLimit} candidates · ≤{d.estimatedUnits.toLocaleString()} units
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => void runDiscovery()} disabled={running || !!brief?.closed} className="btn-primary inline-flex items-center gap-1.5 px-5 py-2 text-sm">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {running ? "Running…" : `Run discovery${selectedDepth ? ` (≤${selectedDepth.estimatedUnits.toLocaleString()} units)` : ""}`}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: "var(--danger-fg)" }}>
          {error}
        </p>
      )}

      {running && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
            <Loader2 size={15} className="animate-spin" /> {stageMessage}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
            {progress && (
              <>
                <Stat label="Searches run" value={`${progress.queriesRun} / ${progress.queriesPlanned}`} />
                <Stat label="Creators found" value={progress.uniqueChannels.toLocaleString()} />
                <Stat label="Histories analyzed" value={progress.toAnalyze > 0 ? `${progress.analyzed} / ${progress.toAnalyze}` : "—"} />
                <Stat label="API units" value={progress.unitsUsed.toLocaleString()} />
              </>
            )}
            {emailProgress && (
              <>
                <Stat label="Emails researched" value={`${emailProgress.researched} / ${emailProgress.toResearch}`} />
                <Stat label="Emails found" value={emailProgress.found.toLocaleString()} />
              </>
            )}
          </div>
        </div>
      )}

      {result && profile && (
        <div className="space-y-3">
          <div className="card p-4 space-y-1.5 text-[12px] text-[var(--muted)]">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[var(--ink)] font-medium">
                {result.stats.analyzedCreators} creators analyzed · emails found for {result.stats.emailsFound} of {result.stats.emailsResearched} matched
              </span>
              <span>
                {result.stats.queriesRun.length} searches · {result.stats.uniqueChannelsFound} creators found · {result.stats.unitsUsed.toLocaleString()} units ·{" "}
                {Math.round(result.stats.durationMs / 1000)}s
              </span>
            </div>
            <p>Stopped: {result.stats.stopReason}.</p>
            {Object.keys(result.stats.notQualified).length > 0 && (
              <p>
                Filtered out before scoring:{" "}
                {Object.entries(result.stats.notQualified)
                  .map(([reason, n]) => `${reason} (${n})`)
                  .join(" · ")}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {TIERS.map(({ tier, label, hint }) => {
                const active = visibleTiers.includes(tier);
                return (
                  <button
                    key={tier}
                    type="button"
                    title={hint}
                    onClick={() => setVisibleTiers((prev) => (active ? prev.filter((t) => t !== tier) : [...prev, tier]))}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                    style={
                      active
                        ? { background: "var(--brand-teal-light)", color: "var(--brand-teal-dark)" }
                        : { background: "transparent", color: "var(--muted-2)", border: "1px solid var(--border)" }
                    }
                  >
                    {label} ({result.tierCounts[tier as keyof typeof result.tierCounts]})
                  </button>
                );
              })}
            </div>
          </div>

          <ResultsTable
            key={result.runId}
            runId={result.runId}
            creators={shown}
            briefId={brief?.id ?? null}
            briefClosed={!!brief?.closed}
            defaultListName={defaultListName}
            toolbar={
              <label className="flex items-center gap-1.5 cursor-pointer text-[var(--muted)]">
                <input type="checkbox" checked={emailOnly} onChange={(e) => setEmailOnly(e.target.checked)} />
                Only with email
              </label>
            }
            renderDetail={(c) => <CampaignEvidence detail={result.details[c.channelId]} />}
          />
        </div>
      )}
    </div>
  );
}

function CampaignEvidence({ detail }: { detail: CampaignDetail | undefined }) {
  if (!detail) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 text-[12.5px]">
      <div className="lg:col-span-2 space-y-4">
        {detail.rejectionReasons.length > 0 && (
          <Bullets title="Why this creator was rejected" items={detail.rejectionReasons} icon={<AlertTriangle size={12} style={{ color: "var(--danger-fg)" }} />} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Bullets title="Commercial / product-review activity" items={detail.commercialEvidence} empty="None found in the analyzed videos" />
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)] mb-1.5">Market & products</h4>
            <p className="text-[var(--ink)]">{detail.marketEvidence}</p>
            <p className="text-[var(--muted)] mt-1">
              {detail.productTypesReviewed.length > 0 ? `Covers: ${detail.productTypesReviewed.join(", ")}` : "No specific products identified"}
            </p>
          </section>
        </div>
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)] mb-1.5">Relevant video evidence</h4>
          {detail.evidence.length === 0 ? (
            <p className="text-[var(--muted-2)]">No relevant videos found.</p>
          ) : (
            <ol className="space-y-2">
              {detail.evidence.map((video) => (
                <li key={video.url} className="rounded-lg border border-[var(--border)] px-3 py-2" style={{ background: "var(--surface)" }}>
                  <a href={video.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--brand-teal-dark)] hover:underline">
                    {video.title}
                  </a>
                  <div className="text-[11.5px] text-[var(--muted-2)] mt-0.5">
                    {compact(video.views)} views · {video.publishedAt ? new Date(video.publishedAt).toLocaleDateString("en-IN") : "date unknown"} ·{" "}
                    {video.contentType} · relevance {video.productRelevance}/5
                  </div>
                  <div className="text-[11.5px] text-[var(--muted)] mt-0.5">{video.whyRelevant}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)] mb-2">Score breakdown · {detail.score.total}/100</h4>
        <div className="space-y-2">
          {SCORE_PARTS.map((part) => {
            const value = detail.score[part.key];
            return (
              <div key={part.key}>
                <div className="flex justify-between text-[11.5px] mb-0.5">
                  <span className="text-[var(--muted)]">{part.label}</span>
                  <span className="font-semibold text-[var(--ink)]">
                    {Math.round(value)}/{part.max}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--neutral-bg)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / part.max) * 100)}%`, background: "var(--brand-teal-dark)" }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-[var(--muted-2)] mt-3">{detail.emailPagesChecked} web pages checked for an email.</p>
      </section>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-[var(--muted-2)] uppercase tracking-wide mb-1.5">{children}</label>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-[var(--muted-2)]">{label}</div>
      <div className="text-[15px] font-semibold text-[var(--ink)]">{value}</div>
    </div>
  );
}

function ChipEditor({ label, values, placeholder, onChange }: { label: string; values: string[]; placeholder: string; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function commit() {
    const parts = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const part of parts) if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    onChange(next);
    setDraft("");
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px]" style={{ background: "var(--brand-teal-light)", color: "var(--brand-teal-dark)" }}>
            {value}
            <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((v) => v !== value))}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[140px] bg-transparent outline-none text-[12px] text-[var(--ink)] py-0.5"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
        />
      </div>
    </div>
  );
}
