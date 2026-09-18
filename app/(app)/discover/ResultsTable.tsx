"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, Mail, AlertTriangle, FolderPlus } from "lucide-react";
import type { StoredCreator } from "@/lib/creatorRecord";
import { compact } from "@/lib/format";

interface ListOption {
  id: string;
  name: string;
  briefId: string | null;
  count: number;
}

const TIER_STYLE: Record<string, React.CSSProperties> = {
  A: { background: "var(--success-bg)", color: "var(--success-fg)" },
  B: { background: "var(--brand-teal-light)", color: "var(--brand-teal-dark)" },
  C: { background: "var(--neutral-bg)", color: "var(--neutral-fg)" },
  D: { background: "var(--neutral-bg)", color: "var(--danger-fg)" },
};
const TIER_LABEL: Record<string, string> = { A: "Excellent", B: "Strong", C: "Possible", D: "Poor" };

/**
 * The result rows for either Discover tab, with selection and saving. A saved creator stays in the
 * table marked "Saved"; one a teammate got first is marked "Taken by …" — neither can be selected.
 * Render it with `key={runId}` so a new run starts with a clean selection.
 */
export default function ResultsTable({
  runId,
  creators,
  briefId,
  defaultListName,
  renderDetail,
  toolbar,
}: {
  runId: string;
  creators: StoredCreator[];
  briefId: string | null;
  defaultListName: string;
  renderDetail?: (c: StoredCreator) => React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Map<string, string>>(new Map());
  const [expanded, setExpanded] = useState<string | null>(null);

  const selectable = useMemo(() => creators.filter((c) => !status.has(c.channelId)), [creators, status]);
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.channelId));
  const withEmail = selectable.filter((c) => c.email);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSaved(listName: string, saved: string[], taken: { channelId: string; takenBy: string }[]) {
    setStatus((prev) => {
      const next = new Map(prev);
      for (const id of saved) next.set(id, `Saved to ${listName}`);
      for (const t of taken) next.set(t.channelId, t.takenBy === "you" ? "Already in your lists" : `Taken by ${t.takenBy}`);
      return next;
    });
    setSelected(new Set());
  }

  return (
    <div className="space-y-3">
      <div className="card p-3 flex items-center justify-between gap-3 flex-wrap text-[12px]">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer text-[var(--muted)]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.channelId)))}
            />
            Select all ({selectable.length})
          </label>
          <button
            type="button"
            onClick={() => setSelected(new Set(withEmail.map((c) => c.channelId)))}
            className="font-medium text-[var(--brand-teal-dark)]"
            disabled={withEmail.length === 0}
          >
            Select all with email ({withEmail.length})
          </button>
          {toolbar}
        </div>
        <SaveToList
          runId={runId}
          channelIds={[...selected]}
          briefId={briefId}
          defaultListName={defaultListName}
          onSaved={onSaved}
        />
      </div>

      {creators.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--muted-2)]">No creators match these filters.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[980px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-[var(--muted-2)] border-b border-[var(--border)]">
                <th className="px-3 py-2.5 w-10" />
                <th className="px-3 py-2.5">Creator</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Subscribers</th>
                <th className="px-3 py-2.5">Avg views</th>
                <th className="px-3 py-2.5">Main content</th>
                <th className="px-3 py-2.5">Match</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => {
                const open = expanded === c.channelId;
                const rowStatus = status.get(c.channelId);
                return (
                  <Fragment key={c.channelId}>
                    <tr
                      className="border-b border-[var(--border)] align-top hover:bg-[var(--bg)] cursor-pointer"
                      onClick={() => setExpanded(open ? null : c.channelId)}
                      style={rowStatus ? { opacity: 0.75 } : undefined}
                    >
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.title}`}
                          disabled={!!rowStatus}
                          checked={selected.has(c.channelId)}
                          onChange={() => toggle(c.channelId)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {open ? <ChevronDown size={13} className="shrink-0 text-[var(--muted-2)]" /> : <ChevronRight size={13} className="shrink-0 text-[var(--muted-2)]" />}
                          <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-[var(--bg)]">
                            {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail */}
                            {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="w-full h-full object-cover" /> : null}
                          </div>
                          <div className="min-w-0">
                            <a
                              href={c.channelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="font-semibold text-[var(--ink)] hover:underline truncate block max-w-[200px]"
                            >
                              {c.title}
                            </a>
                            <div className="text-[11px] text-[var(--muted-2)]">{c.country || "Country not declared"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 max-w-[220px]">
                        {c.email ? (
                          <div className="min-w-0">
                            <span className="inline-flex items-center gap-1 text-[var(--ink)] break-all">
                              <Mail size={12} className="shrink-0" /> {c.email}
                            </span>
                            <div className="text-[10.5px] text-[var(--muted-2)] truncate">{c.emailSource}</div>
                          </div>
                        ) : (
                          <span className="text-[var(--muted-2)]">{c.tier === "D" ? "Not researched" : "Not found"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{compact(c.subscriberCount)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{compact(c.averageViews)}</td>
                      <td className="px-3 py-2.5 text-[var(--muted)] max-w-[200px]">
                        {c.mainContent || "—"}
                        {c.relevantVideos !== null && (
                          <div className="text-[11px] text-[var(--muted-2)]">
                            {c.relevantVideos} / {c.analyzedVideos} relevant videos
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[14px] font-semibold text-[var(--ink)]">{c.matchScore}</span>
                        <span className="text-[var(--muted-2)]">/100</span>
                        {c.tier && (
                          <div>
                            <span className="badge mt-0.5" style={{ ...TIER_STYLE[c.tier], fontSize: 10.5, padding: "1px 8px" }}>
                              Tier {c.tier} · {TIER_LABEL[c.tier]}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11.5px]">
                        {rowStatus ? (
                          <span
                            className="inline-flex items-center gap-1 font-medium"
                            style={{ color: rowStatus.startsWith("Saved") ? "var(--success-fg)" : "var(--warn-fg)" }}
                          >
                            {rowStatus.startsWith("Saved") ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                            {rowStatus}
                          </span>
                        ) : (
                          <span className="text-[var(--muted-2)]">Available</span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-[var(--border)]">
                        <td colSpan={8} className="px-4 py-4" style={{ background: "var(--bg)" }}>
                          <BasicDetail creator={c} />
                          {renderDetail && <div className="mt-4">{renderDetail(c)}</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BasicDetail({ creator: c }: { creator: StoredCreator }) {
  const links = [
    ...c.websiteLinks.map((url) => ({ label: url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), url })),
    ...Object.entries(c.platformLinks).map(([key, url]) => ({ label: key, url })),
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[12.5px]">
      <Bullets title="Why they fit" items={c.whyFit} icon={<CheckCircle2 size={12} style={{ color: "var(--success-fg)" }} />} />
      <Bullets title="Concerns" items={c.concerns} empty="None flagged" icon={<AlertTriangle size={12} style={{ color: "var(--muted-2)" }} />} />
      <section className="space-y-1.5">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Contact research</h4>
        <p className="text-[var(--ink)]">
          {c.email ? (
            <>
              {c.email} —{" "}
              {c.emailSourceUrl ? (
                <a href={c.emailSourceUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-teal-dark)] hover:underline">
                  {c.emailSource}
                </a>
              ) : (
                c.emailSource
              )}
            </>
          ) : (
            "No email found"
          )}
        </p>
        {c.otherEmails.length > 0 && <p className="text-[11.5px] text-[var(--muted)]">Also seen: {c.otherEmails.join(", ")}</p>}
        {links.length === 0 ? (
          <p className="text-[11.5px] text-[var(--muted-2)]">No websites or social profiles found.</p>
        ) : (
          <ul className="space-y-0.5 text-[11.5px]">
            {links.map((l) => (
              <li key={l.url} className="truncate">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--brand-teal-dark)] hover:underline">
                  <ExternalLink size={11} /> {l.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function Bullets({ title, items, empty, icon }: { title: string; items: string[]; empty?: string; icon?: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-2)] mb-1.5">{title}</h4>
      {items.length === 0 ? (
        <p className="text-[var(--muted-2)]">{empty ?? "None"}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-[var(--ink)]">
              <span className="mt-0.5 shrink-0">{icon ?? "•"}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const NEW_LIST = "__new__";

function SaveToList({
  runId,
  channelIds,
  briefId,
  defaultListName,
  onSaved,
}: {
  runId: string;
  channelIds: string[];
  briefId: string | null;
  defaultListName: string;
  onSaved: (listName: string, saved: string[], taken: { channelId: string; takenBy: string }[]) => void;
}) {
  const router = useRouter();
  const [lists, setLists] = useState<ListOption[] | null>(null);
  const [target, setTarget] = useState<string>(NEW_LIST);
  const [newName, setNewName] = useState(defaultListName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" | "error" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/lists")
      .then((r) => r.json())
      .then((data: { lists?: ListOption[] }) => {
        if (cancelled) return;
        const all = data.lists ?? [];
        setLists(all);
        // Default to the newest list already made for this brief, if any.
        const match = all.find((l) => briefId && l.briefId === briefId);
        setTarget(match ? match.id : NEW_LIST);
      })
      .catch(() => setLists([]));
    return () => {
      cancelled = true;
    };
  }, [briefId]);

  async function save() {
    if (channelIds.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      let listId = target;
      let listName = lists?.find((l) => l.id === target)?.name ?? newName;
      if (target === NEW_LIST) {
        const res = await fetch("/api/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName, briefId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't create the list");
        listId = data.list.id;
        listName = data.list.name;
        setLists((prev) => [{ id: listId, name: listName, briefId, count: 0 }, ...(prev ?? [])]);
        setTarget(listId);
      }
      const res = await fetch(`/api/lists/${listId}/creators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, channelIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      const saved: string[] = data.saved;
      const taken: { channelId: string; takenBy: string }[] = data.taken;
      onSaved(listName, saved, taken);
      setLists((prev) => prev?.map((l) => (l.id === listId ? { ...l, count: l.count + saved.length } : l)) ?? null);
      setMessage({
        text: `Saved ${saved.length} to “${listName}”${taken.length ? ` · ${taken.length} already taken by teammates` : ""}`,
        tone: taken.length ? "warn" : "ok",
      });
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Couldn't save", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {message && (
        <span
          className="text-[11.5px] font-medium"
          style={{ color: message.tone === "ok" ? "var(--success-fg)" : message.tone === "warn" ? "var(--warn-fg)" : "var(--danger-fg)" }}
        >
          {message.text}
        </span>
      )}
      <select className="input w-auto py-1 text-xs" style={{ minHeight: 32 }} value={target} onChange={(e) => setTarget(e.target.value)} disabled={!lists}>
        <option value={NEW_LIST}>+ New list…</option>
        {(lists ?? []).map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} ({l.count})
          </option>
        ))}
      </select>
      {target === NEW_LIST && (
        <input
          className="input w-52 py-1 text-xs"
          style={{ minHeight: 32 }}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="List name"
          aria-label="New list name"
        />
      )}
      <button
        onClick={() => void save()}
        disabled={busy || channelIds.length === 0 || (target === NEW_LIST && !newName.trim())}
        className="btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-xs disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />}
        Save {channelIds.length > 0 ? channelIds.length : ""} to list
      </button>
    </div>
  );
}
