"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";

export default function AuthForm({ mode }: { mode: "login" | "setup" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = mode === "setup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(setup ? "/api/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setup ? { name, email, password } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--brand-teal)", color: "#fff" }}>
            <Search size={18} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[var(--ink)]">CollabGlam Creator Discovery</h1>
            <p className="text-[12px] text-[var(--muted-2)]">{setup ? "Create the first admin account" : "Sign in to your team account"}</p>
          </div>
        </div>
        {setup && (
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-[var(--muted)]">Your name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-[12px] font-medium text-[var(--muted)]">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] font-medium text-[var(--muted)]">Password{setup ? " (8+ characters)" : ""}</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={setup ? 8 : undefined}
            autoComplete={setup ? "new-password" : "current-password"}
          />
        </label>
        {error && (
          <p className="text-[12px]" style={{ color: "var(--danger-fg)" }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5">
          {busy && <Loader2 size={15} className="animate-spin" />}
          {setup ? "Create admin account" : "Sign in"}
        </button>
        {!setup && <p className="text-[11.5px] text-[var(--muted-2)] text-center">No account? Ask your admin to add you.</p>}
      </form>
    </div>
  );
}
