"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";

export default function BriefStatusButton({ id, status }: { id: string; status: "ACTIVE" | "ARCHIVED" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const archived = status === "ARCHIVED";

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/briefs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: archived ? "ACTIVE" : "ARCHIVED" }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function remove() {
    if (!window.confirm("Delete this campaign brief? Saved creator lists and creators will be kept, but they will no longer be linked to this brief.")) return;
    setBusy(true);
    const res = await fetch(`/api/briefs/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/briefs");
      router.refresh();
      return;
    }
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    window.alert(data.error ?? "Could not delete the campaign brief.");
  }

  return (
    <>
      <button onClick={() => void toggle()} disabled={busy} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
        {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
        {archived ? "Restore" : "Archive"}
      </button>
      <button onClick={() => void remove()} disabled={busy} className="btn-danger inline-flex items-center gap-1 px-3 py-1.5 text-xs">
        <Trash2 size={13} /> Delete
      </button>
    </>
  );
}
