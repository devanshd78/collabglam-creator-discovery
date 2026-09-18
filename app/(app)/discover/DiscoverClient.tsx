"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Search, Target } from "lucide-react";
import type { BriefOption } from "@/lib/discoveryTypes";
import CampaignTab from "./CampaignTab";
import SearchTab from "./SearchTab";

type Tab = "campaign" | "search";

export default function DiscoverClient({ briefs, initialBriefId, initialTab }: { briefs: BriefOption[]; initialBriefId: string; initialTab: Tab }) {
  const router = useRouter();
  const [briefId, setBriefId] = useState(briefs.some((b) => b.id === initialBriefId) ? initialBriefId : "");
  const [tab, setTab] = useState<Tab>(initialTab);
  const brief = useMemo(() => briefs.find((b) => b.id === briefId) ?? null, [briefs, briefId]);
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const defaultListName = brief ? `${brief.brandName} – ${today}` : `Creators – ${today}`;

  function update(nextBrief: string, nextTab: Tab) {
    const params = new URLSearchParams();
    if (nextBrief) params.set("brief", nextBrief);
    if (nextTab === "search") params.set("tab", "search");
    router.replace(`/discover${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <Megaphone size={16} className="text-[var(--muted-2)]" />
        <label className="text-[12px] font-medium text-[var(--muted)]" htmlFor="brief-select">
          Finding creators for
        </label>
        <select
          id="brief-select"
          className="input w-auto min-w-[260px] py-1.5 text-sm"
          value={briefId}
          onChange={(e) => {
            setBriefId(e.target.value);
            update(e.target.value, tab);
          }}
        >
          <option value="">No brief — free search</option>
          {briefs.map((b) => (
            <option key={b.id} value={b.id}>
              {b.brandName} · {new Date(`${b.briefDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}
              {b.title !== b.brandName ? ` · ${b.title}` : ""}
            </option>
          ))}
        </select>
        {brief && (
          <p className="text-[12px] text-[var(--muted)] flex-1 min-w-[200px] line-clamp-2">
            <span className="font-medium text-[var(--ink)]">Niche:</span> {brief.targetNiche} · {brief.brief}
          </p>
        )}
      </div>

      <div className="flex gap-1 border-b border-[var(--border)]">
        {(
          [
            { key: "campaign", label: "Campaign match", icon: <Target size={15} />, hint: "Brief → deep analysis of each creator's videos" },
            { key: "search", label: "Search by filters", icon: <Search size={15} />, hint: "Keywords, country, size, views, engagement, category" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.hint}
            onClick={() => {
              setTab(t.key);
              update(briefId, t.key);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium -mb-px border-b-2 transition-colors"
            style={
              tab === t.key
                ? { borderColor: "var(--brand-teal)", color: "var(--ink)" }
                : { borderColor: "transparent", color: "var(--muted)" }
            }
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Both tabs stay mounted so switching doesn't throw away a finished run; picking another
          brief remounts them, which refills each form from that brief. */}
      <div hidden={tab !== "campaign"}>
        <CampaignTab key={`campaign-${briefId}`} brief={brief} defaultListName={defaultListName} />
      </div>
      <div hidden={tab !== "search"}>
        <SearchTab key={`search-${briefId}`} brief={brief} defaultListName={defaultListName} />
      </div>
    </div>
  );
}
