import { Database, Terminal } from "lucide-react";

export default function DatabaseUnavailable() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
            <Database size={19} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[var(--ink)]">Database connection unavailable</h1>
            <p className="mt-1 text-[12.5px] text-[var(--muted)]">
              The Next.js app is running, but PostgreSQL cannot be reached. Check the PostgreSQL configuration, then apply the Prisma migrations. Docker deployments normally provide the connection automatically from <code>.env.docker</code>.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-[12px] text-[var(--muted)] space-y-2">
          <div><b>DATABASE_URL</b> is the PostgreSQL URL used by the running application.</div>
          <div><b>DIRECT_URL</b> is optional and is only needed when a hosted pooler requires a separate direct migration URL.</div>
          <div className="flex items-center gap-2 font-mono text-[11.5px] text-[var(--ink)]"><Terminal size={13} /> npm run db:migrate</div>
        </div>
        <p className="text-[11.5px] text-[var(--muted-2)]">After fixing the connection, refresh this page. Database credentials are never shown here.</p>
      </div>
    </div>
  );
}
