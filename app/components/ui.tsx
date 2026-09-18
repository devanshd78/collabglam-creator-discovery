export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-[var(--ink)]">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-[var(--muted-2)] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[10.5px] uppercase tracking-wide text-[var(--muted-2)]">{label}</div>
      <div className="text-2xl font-semibold text-[var(--ink)] tabular-nums mt-0.5">{typeof value === "number" ? value.toLocaleString() : value}</div>
      {hint && <div className="text-[11.5px] text-[var(--muted)] mt-0.5">{hint}</div>}
    </div>
  );
}

export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--muted-2)] ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
}
