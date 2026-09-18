"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { dateTime } from "@/lib/format";

interface Key {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ExtensionKeys({ keys }: { keys: Key[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/ext/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label || "Chrome extension" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't create a key");
      return;
    }
    setNewKey(data.token);
    setCopied(false);
    setLabel("");
    router.refresh();
  }

  async function revoke(key: Key) {
    if (!window.confirm(`Revoke “${key.label}”? The extension using it will stop working until it gets a new key.`)) return;
    const res = await fetch(`/api/ext/token/${key.id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="card p-5 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--ink)]">Extension keys</h2>
      <div className="flex gap-2 flex-wrap">
        <input className="input w-64" placeholder="Label, e.g. Office laptop" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        <button onClick={() => void create()} disabled={busy} className="btn-primary inline-flex items-center gap-1.5 px-4 text-sm">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Create key
        </button>
      </div>
      {error && (
        <p className="text-[12px]" style={{ color: "var(--danger-fg)" }}>
          {error}
        </p>
      )}
      {newKey && (
        <div className="rounded-lg p-3 space-y-1.5" style={{ background: "var(--success-bg)" }}>
          <p className="text-[12px]" style={{ color: "var(--success-fg)" }}>
            Copy this key into the extension now — it won&apos;t be shown again.
          </p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 break-all text-[12px] bg-[var(--surface)] rounded px-2 py-1.5">{newKey}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(newKey);
                setCopied(true);
              }}
              className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
            >
              <Copy size={12} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      {keys.length === 0 ? (
        <p className="text-[12px] text-[var(--muted-2)]">No keys yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] text-[13px]">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="font-medium text-[var(--ink)]">{k.label}</div>
                <div className="text-[11px] text-[var(--muted-2)]">
                  Created {dateTime(k.createdAt)} · last used {k.lastUsedAt ? dateTime(k.lastUsedAt) : "never"}
                </div>
              </div>
              <button onClick={() => void revoke(k)} className="btn-danger px-3 py-1 text-xs">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
