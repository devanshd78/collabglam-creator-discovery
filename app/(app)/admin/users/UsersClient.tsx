"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, UserPlus } from "lucide-react";
import { dateTime } from "@/lib/format";

interface Member {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  active: boolean;
  lastLoginAt: string | null;
  saved: number;
}

export default function UsersClient({ users, meId }: { users: Member[]; meId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "MEMBER" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function call(url: string, method: string, body: unknown): Promise<boolean> {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ text: data.error ?? "Something went wrong", ok: false });
      return false;
    }
    router.refresh();
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    if (await call("/api/admin/users", "POST", form)) {
      setMessage({ text: `Added ${form.name}. Share their email and password with them directly.`, ok: true });
      setForm({ name: "", email: "", password: "", role: "MEMBER" });
    }
    setBusy(false);
  }

  async function resetPassword(u: Member) {
    const password = window.prompt(`New password for ${u.name} (8+ characters)`);
    if (!password) return;
    if (await call(`/api/admin/users/${u.id}`, "PATCH", { password })) setMessage({ text: `Password updated for ${u.name}.`, ok: true });
  }

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Add a team member</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input
            className="input"
            type="text"
            placeholder="Temporary password (8+)"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            autoComplete="new-password"
          />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center justify-center gap-1.5 px-4 text-sm">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Add member
          </button>
        </div>
        {message && (
          <p className="text-[12px]" style={{ color: message.ok ? "var(--success-fg)" : "var(--danger-fg)" }}>
            {message.text}
          </p>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] min-w-[760px]">
          <thead className="border-b border-[var(--border)]">
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-[var(--muted-2)]">
              <th className="px-3 py-2.5">Member</th>
              <th className="px-3 py-2.5">Role</th>
              <th className="px-3 py-2.5 text-right">Creators saved</th>
              <th className="px-3 py-2.5">Last sign-in</th>
              <th className="px-3 py-2.5">Access</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === meId;
              return (
                <tr key={u.id} className="border-b border-[var(--border)] last:border-0" style={u.active ? undefined : { opacity: 0.6 }}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-[var(--ink)]">
                      {u.name}
                      {isMe && <span className="ml-1.5 text-[10.5px] text-[var(--muted-2)]">(you)</span>}
                    </div>
                    <div className="text-[11px] text-[var(--muted-2)]">{u.email}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      className="input w-auto py-1 text-xs"
                      style={{ minHeight: 30 }}
                      value={u.role}
                      disabled={isMe}
                      onChange={(e) => void call(`/api/admin/users/${u.id}`, "PATCH", { role: e.target.value })}
                    >
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{u.saved}</td>
                  <td className="px-3 py-2.5 text-[var(--muted-2)] whitespace-nowrap">{dateTime(u.lastLoginAt)}</td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      disabled={isMe}
                      onClick={() => void call(`/api/admin/users/${u.id}`, "PATCH", { active: !u.active })}
                      className={`${u.active ? "btn-danger" : "btn-secondary"} px-3 py-1 text-xs`}
                    >
                      {u.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => void resetPassword(u)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-teal-dark)]">
                      <KeyRound size={12} /> Reset password
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
