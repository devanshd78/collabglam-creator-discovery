"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, Trash2 } from "lucide-react";

export default function ListActions({ id, name, total, withEmail }: { id: string; name: string; total: number; withEmail: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function rename() {
    const next = window.prompt("Rename list", name)?.trim();
    if (!next || next === name) return;
    setBusy(true);
    const res = await fetch(`/api/lists/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: next }) });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Delete “${name}”? Its ${total} creators will be released so teammates can save them again.`)) return;
    setBusy(true);
    const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/lists");
      router.refresh();
    } else setBusy(false);
  }

  return (
    <>
      <a href={`/api/lists/${id}/export`} className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs" aria-disabled={total === 0}>
        <Download size={13} /> Download CSV ({total})
      </a>
      <a href={`/api/lists/${id}/export?emailOnly=1`} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
        <Download size={13} /> Only with email ({withEmail})
      </a>
      <button onClick={() => void rename()} disabled={busy} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
        <Pencil size={13} /> Rename
      </button>
      <button onClick={() => void remove()} disabled={busy} className="btn-danger inline-flex items-center gap-1 px-3 py-1.5 text-xs">
        <Trash2 size={13} /> Delete
      </button>
    </>
  );
}
