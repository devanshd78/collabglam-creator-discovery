"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { MARKETS } from "@/lib/markets";

export interface BriefFormValues {
  brandName?: string;
  title?: string;
  brief?: string;
  targetNiche?: string;
  website?: string | null;
  market?: string | null;
  minSubscribers?: number | null;
  maxSubscribers?: number | null;
  targetCreators?: number | null;
  notes?: string | null;
  briefDate: string;
  deadlineAt?: string | null;
}

const REQUIREMENTS_EXAMPLE =
  "We’re looking for creators to test and review our new faucet filter. Reviews, installation videos, comparisons, demonstrations and real-use feedback are all relevant.";

const NICHE_EXAMPLE = "Home Improvement, Kitchen, DIY, Plumbing, Home Appliances, Water Filtration";

function toLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BriefForm({ id, initial }: { id?: string; initial: BriefFormValues }) {
  const router = useRouter();
  const [v, setV] = useState({
    brandName: initial.brandName ?? "",
    title: initial.title ?? "",
    brief: initial.brief ?? "",
    targetNiche: initial.targetNiche ?? "",
    website: initial.website ?? "",
    market: initial.market ?? "",
    minSubscribers: initial.minSubscribers?.toString() ?? "",
    maxSubscribers: initial.maxSubscribers?.toString() ?? "",
    targetCreators: initial.targetCreators?.toString() ?? "",
    notes: initial.notes ?? "",
    briefDate: initial.briefDate,
    deadlineAt: toLocalDateTimeInput(initial.deadlineAt),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(id ? `/api/briefs/${id}` : "/api/briefs", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          deadlineAt: v.deadlineAt ? new Date(v.deadlineAt).toISOString() : "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save the brief");
      router.push(`/briefs/${id ?? data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the brief");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Brand name *">
          <input className="input" value={v.brandName} onChange={set("brandName")} required maxLength={120} />
        </Field>
        <Field label="Campaign name">
          <input className="input" value={v.title} onChange={set("title")} placeholder="e.g. Frizzlife MF1080 Faucet Filter – Creator Collaboration" maxLength={160} />
        </Field>
        <Field label="Brief date *">
          <input className="input" type="date" value={v.briefDate} onChange={set("briefDate")} required />
        </Field>
        <Field label="Deadline *">
          <input className="input" type="datetime-local" value={v.deadlineAt} onChange={set("deadlineAt")} required />
          <span className="block text-[10.5px] text-[var(--muted-2)]">No new discovery or creator entries are accepted after this time.</span>
        </Field>
      </div>

      <Field label="Campaign requirements *">
        <textarea
          className="input"
          rows={4}
          value={v.brief}
          onChange={set("brief")}
          placeholder={REQUIREMENTS_EXAMPLE}
          required
          maxLength={4000}
        />
        <span className="block text-[10.5px] text-[var(--muted-2)]">
          This can be shorter or more detailed depending on the campaign; keep the targeting niche explicit below.
        </span>
      </Field>

      <Field label="Target niche *">
        <textarea
          className="input"
          rows={2}
          value={v.targetNiche}
          onChange={set("targetNiche")}
          placeholder={NICHE_EXAMPLE}
          required
          maxLength={1000}
        />
        <span className="block text-[10.5px] text-[var(--muted-2)]">Required. Add one or more niches separated by commas.</span>
      </Field>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Country">
          <select className="input" value={v.market} onChange={set("market")}>
            {MARKETS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minimum followers / subscribers">
          <input className="input" type="number" min={0} value={v.minSubscribers} onChange={set("minSubscribers")} />
        </Field>
        <Field label="Maximum followers / subscribers">
          <input className="input" type="number" min={0} value={v.maxSubscribers} onChange={set("maxSubscribers")} />
        </Field>
        <Field label="Platform">
          <input className="input" value="YouTube" readOnly aria-readonly="true" />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Campaign URL">
          <input className="input" value={v.website} onChange={set("website")} placeholder="https://" />
        </Field>
        <Field label="Creators wanted">
          <input className="input" type="number" min={0} value={v.targetCreators} onChange={set("targetCreators")} />
        </Field>
        <Field label="Notes for the team">
          <input className="input" value={v.notes} onChange={set("notes")} placeholder="e.g. avoid creators who promoted competitor X" />
        </Field>
      </div>

      {error && (
        <p className="text-[12px]" style={{ color: "var(--danger-fg)" }}>
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} className="btn-secondary px-4 py-2 text-sm">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary px-5 py-2 text-sm inline-flex items-center gap-1.5">
          {busy && <Loader2 size={15} className="animate-spin" />}
          {id ? "Save changes" : "Post brief"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11.5px] font-medium text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
