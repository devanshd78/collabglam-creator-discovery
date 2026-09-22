"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";

export default function ManualCreatorButton({ listId, campaignName }: { listId: string; campaignName?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [channel, setChannel] = useState("");
  const [email, setEmail] = useState("");
  const [mainContent, setMainContent] = useState("");

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
    setSuccess(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!channel.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    const res = await fetch(`/api/lists/${listId}/creators/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, email, mainContent }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; creator?: { title?: string }; refreshed?: boolean };
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "Could not add this creator");
      return;
    }

    const creatorName = data.creator?.title ?? "Creator";
    setSuccess(data.refreshed ? `${creatorName} analytics refreshed — no duplicate was added.` : `${creatorName} added successfully.`);
    setChannel("");
    setEmail("");
    setMainContent("");
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
        <Plus size={13} /> Add creator manually
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="card w-full max-w-lg p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="manual-creator-title">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 id="manual-creator-title" className="text-base font-semibold text-[var(--ink)]">Add creator manually</h2>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Paste a YouTube channel. Recent uploads are analyzed automatically for average views, engagement, content and campaign match. The stable channel ID is checked before saving, so the same creator cannot be duplicated{campaignName ? ` anywhere in ${campaignName}` : ""}.
                </p>
              </div>
              <button type="button" onClick={close} disabled={busy} className="p-1 text-[var(--muted-2)] hover:text-[var(--ink)]" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-[var(--ink)]">YouTube channel *</span>
                <input
                  autoFocus
                  className="input mt-1 w-full"
                  placeholder="https://youtube.com/@creator or UC… channel ID"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  disabled={busy}
                />
                <span className="block text-[10.5px] text-[var(--muted-2)] mt-1">Supports @handles, /channel/UC… links, legacy /user/ links, and raw UC channel IDs.</span>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-[var(--ink)]">Email <span className="font-normal text-[var(--muted-2)]">(optional)</span></span>
                <input
                  type="email"
                  className="input mt-1 w-full"
                  placeholder="creator@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-[var(--ink)]">Content / niche note <span className="font-normal text-[var(--muted-2)]">(optional)</span></span>
                <input
                  className="input mt-1 w-full"
                  placeholder="RV travel, home improvement, beauty…"
                  value={mainContent}
                  onChange={(e) => setMainContent(e.target.value)}
                  disabled={busy}
                  maxLength={500}
                />
              </label>

              {error && <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>{error}</div>}
              {success && <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--success-bg)", color: "var(--success-fg)" }}>{success}</div>}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={close} disabled={busy} className="btn-secondary px-3 py-1.5 text-xs">Close</button>
                <button type="submit" disabled={busy || !channel.trim()} className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  {busy ? "Analyzing & adding…" : "Add creator"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
