"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";

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

  return (
    <button onClick={() => void toggle()} disabled={busy} className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs">
      {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
      {archived ? "Restore" : "Archive"}
    </button>
  );
}
