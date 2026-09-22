"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, ExternalLink, Loader2, Mail, Pencil, X } from "lucide-react";
import { compact, dateTime } from "@/lib/format";

export interface ListCreatorRow {
  id: string;
  title: string;
  channelUrl: string;
  thumbnailUrl: string | null;
  country: string | null;
  subscriberCount: number;
  averageViews: number | null;
  engagementRate: number | null;
  email: string | null;
  emailSource: string | null;
  matchScore: number | null;
  tier: string | null;
  mainContent: string | null;
  source: string;
  claimedAt: string;
  platforms: string[];
  listId?: string;
  listName?: string;
  ownerName?: string;
}

export default function ListCreatorsTable({
  listId,
  rows,
  showTeamContext = false,
  allowSelectiveExport = false,
}: {
  listId?: string;
  rows: ListCreatorRow[];
  showTeamContext?: boolean;
  allowSelectiveExport?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [emailFilter, setEmailFilter] = useState<"all" | "with" | "missing">("all");
  const [removing, setRemoving] = useState<string | null>(null);
  // Emails typed in this session, shown immediately while the page refreshes in the background.
  const [edited, setEdited] = useState<Map<string, { email: string | null; source: string | null }>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const merged = useMemo(
    () => rows.map((r) => (edited.has(r.id) ? { ...r, email: edited.get(r.id)!.email, emailSource: edited.get(r.id)!.source } : r)),
    [rows, edited]
  );
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return merged.filter(
      (r) =>
        (emailFilter === "all" || (emailFilter === "with" ? !!r.email : !r.email)) &&
        (!q ||
          r.title.toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.ownerName ?? "").toLowerCase().includes(q) ||
          (r.listName ?? "").toLowerCase().includes(q))
    );
  }, [merged, filter, emailFilter]);
  const missing = merged.filter((r) => !r.email).length;
  const allShownSelected = shown.length > 0 && shown.every((row) => selected.has(row.id));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) shown.forEach((row) => next.delete(row.id));
      else shown.forEach((row) => next.add(row.id));
      return next;
    });
  }

  async function downloadSelected() {
    if (!allowSelectiveExport || selected.size === 0) return;
    const endpoint = showTeamContext ? "/api/admin/export" : listId ? `/api/lists/${listId}/export` : null;
    if (!endpoint) return;

    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorIds: [...selected] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not export selected creators");
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? "selected-creators.csv";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Could not export selected creators");
    } finally {
      setDownloading(false);
    }
  }

  function onEmailSaved(row: ListCreatorRow, email: string | null) {
    setEdited((prev) => new Map(prev).set(row.id, { email, source: email ? "YouTube About page (revealed by hand)" : null }));
    // Straight on to the next creator that still needs one.
    const index = shown.findIndex((r) => r.id === row.id);
    const next = shown.slice(index + 1).find((r) => !r.email);
    setEditing(email && next ? next.id : null);
    router.refresh();
  }

  async function remove(row: ListCreatorRow) {
    const targetListId = row.listId ?? listId;
    if (!targetListId) return;
    if (!window.confirm(`Remove ${row.title}? They'll be available to the team again.`)) return;
    setRemoving(row.id);
    const res = await fetch(`/api/lists/${targetListId}/creators/${row.id}`, { method: "DELETE" });
    setRemoving(null);
    if (res.ok) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <input className="input w-64 py-1.5 text-xs" placeholder="Filter by name or email" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="input w-auto py-1.5 text-xs" value={emailFilter} onChange={(e) => setEmailFilter(e.target.value as typeof emailFilter)}>
          <option value="all">All creators</option>
          <option value="with">With email</option>
          <option value="missing">Needs email ({missing})</option>
        </select>
        <span className="text-[12px] text-[var(--muted-2)]">{shown.length} shown</span>
        {allowSelectiveExport && (
          <>
            <span className="h-5 w-px bg-[var(--border)]" aria-hidden="true" />
            <span className="text-[12px] text-[var(--muted)]">{selected.size} selected</span>
            <button
              type="button"
              onClick={() => void downloadSelected()}
              disabled={downloading || selected.size === 0}
              className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
            >
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Download selected CSV
            </button>
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]">
                Clear selection
              </button>
            )}
          </>
        )}
      </div>
      {downloadError && (
        <p className="text-[12px]" style={{ color: "var(--danger-fg)" }}>
          {downloadError}
        </p>
      )}
      {missing > 0 && (
        <p className="text-[12px] rounded-lg px-3 py-2" style={{ background: "var(--info-bg)", color: "var(--info-fg)" }}>
          {missing} {missing === 1 ? "creator still needs" : "creators still need"} an email. Click <b>Get email</b>: the channel&apos;s About page opens in a new
          tab — press &ldquo;View email address&rdquo;, complete YouTube&apos;s check, copy the email and paste it here. The next creator opens for
          input automatically. YouTube allows about 10 reveals per Google account per day. Faster: the{" "}
          <a href="/extension" className="underline font-medium">
            email reveal extension
          </a>{" "}
          saves them for you and switches between your Google accounts.
        </p>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[900px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-[var(--muted-2)] border-b border-[var(--border)]">
              {allowSelectiveExport && (
                <th className="px-3 py-2.5 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all shown creators"
                    checked={allShownSelected}
                    onChange={toggleAllShown}
                  />
                </th>
              )}
              <th className="px-3 py-2.5">Creator</th>
              <th className="px-3 py-2.5">Email</th>
              <th className="px-3 py-2.5">Subscribers</th>
              <th className="px-3 py-2.5">Avg views</th>
              <th className="px-3 py-2.5">Eng. %</th>
              <th className="px-3 py-2.5">Content</th>
              <th className="px-3 py-2.5">Match</th>
              {showTeamContext && <th className="px-3 py-2.5">Team list</th>}
              <th className="px-3 py-2.5">Saved</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0 align-top">
                {allowSelectiveExport && (
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.title} for CSV export`}
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelected(r.id)}
                    />
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-[var(--bg)]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail */}
                      {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" className="w-full h-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <a href={r.channelUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--ink)] hover:underline truncate block max-w-[200px]">
                        {r.title}
                      </a>
                      <div className="text-[11px] text-[var(--muted-2)]">
                        {[r.country, r.platforms.join(", ")].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 w-[260px]">
                  <EmailCell
                    key={`${r.id}-${editing === r.id}`}
                    listId={r.listId ?? listId ?? ""}
                    row={r}
                    editing={editing === r.id}
                    onEdit={(on) => setEditing(on ? r.id : null)}
                    onSaved={(email) => onEmailSaved(r, email)}
                  />
                </td>
                <td className="px-3 py-2.5 tabular-nums">{compact(r.subscriberCount)}</td>
                <td className="px-3 py-2.5 tabular-nums">{compact(r.averageViews)}</td>
                <td className="px-3 py-2.5 tabular-nums">{r.engagementRate ?? "—"}</td>
                <td className="px-3 py-2.5 text-[var(--muted)] max-w-[200px]">{r.mainContent || "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.matchScore ?? "—"}
                  {r.tier && <span className="text-[var(--muted-2)]"> · Tier {r.tier}</span>}
                </td>
                {showTeamContext && (
                  <td className="px-3 py-2.5 text-[var(--muted)] min-w-[150px]">
                    <div className="font-medium text-[var(--ink)]">{r.ownerName ?? "—"}</div>
                    <div className="text-[10.5px] text-[var(--muted-2)]">{r.listName ?? "—"}</div>
                  </td>
                )}
                <td className="px-3 py-2.5 text-[var(--muted-2)] whitespace-nowrap">
                  {dateTime(r.claimedAt)}
                  <div className="text-[10.5px]">{r.source === "campaign" ? "Campaign match" : r.source === "manual" ? "Manual add" : "Filter search"}</div>
                </td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => void remove(r)}
                    disabled={removing === r.id}
                    title="Remove from list"
                    aria-label={`Remove ${r.title}`}
                    className="p-1 rounded text-[var(--muted-2)] hover:text-[var(--danger-fg)]"
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function aboutUrl(channelUrl: string): string {
  return `${channelUrl.replace(/\/$/, "")}/about`;
}

/** Shows the email, or a "Get email" button that opens the About page and a box to paste into. */
function EmailCell({
  listId,
  row,
  editing,
  onEdit,
  onSaved,
}: {
  listId: string;
  row: ListCreatorRow;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onSaved: (email: string | null) => void;
}) {
  const [value, setValue] = useState(row.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/lists/${listId}/creators/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: value }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't save");
      return;
    }
    onSaved(data.email ?? null);
  }

  if (editing) {
    return (
      <form onSubmit={save} className="space-y-1">
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className="input py-1 text-xs"
            style={{ minHeight: 30 }}
            placeholder="Paste the email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(e) => {
              // A copied "mailto:" link or stray spaces shouldn't need cleaning by hand.
              const text = e.clipboardData.getData("text").trim().replace(/^mailto:/i, "");
              if (text) {
                e.preventDefault();
                setValue(text);
              }
            }}
            onKeyDown={(e) => e.key === "Escape" && onEdit(false)}
          />
          <button type="submit" disabled={busy} aria-label="Save email" className="btn-primary p-1.5 shrink-0">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          </button>
          <button type="button" aria-label="Cancel" onClick={() => onEdit(false)} className="p-1 text-[var(--muted-2)] shrink-0">
            <X size={13} />
          </button>
        </div>
        <a href={aboutUrl(row.channelUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10.5px] text-[var(--brand-teal-dark)]">
          <ExternalLink size={10} /> Open About page
        </a>
        {error && (
          <div className="text-[10.5px]" style={{ color: "var(--danger-fg)" }}>
            {error}
          </div>
        )}
      </form>
    );
  }

  if (row.email) {
    return (
      <div className="group min-w-0">
        <div className="flex items-center gap-1">
          <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1 text-[var(--ink)] hover:underline break-all">
            <Mail size={12} className="shrink-0" /> {row.email}
          </a>
          <button
            type="button"
            aria-label="Edit email"
            onClick={() => onEdit(true)}
            className="p-0.5 text-[var(--muted-2)] opacity-0 group-hover:opacity-100 focus:opacity-100"
          >
            <Pencil size={11} />
          </button>
        </div>
        <div className="text-[10.5px] text-[var(--muted-2)] truncate">{row.emailSource}</div>
      </div>
    );
  }

  return (
    <a
      href={aboutUrl(row.channelUrl)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onEdit(true)}
      className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px]"
    >
      <ExternalLink size={12} /> Get email
    </a>
  );
}
