export interface BriefInput {
  brandName: string;
  title: string;
  brief: string;
  targetNiche: string;
  website: string | null;
  market: string | null;
  minSubscribers: number | null;
  maxSubscribers: number | null;
  targetCreators: number | null;
  notes: string | null;
  briefDate: Date;
  deadlineAt: Date;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function count(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Validates an admin's brief form. Returns an error message instead of throwing. */
export function parseBriefInput(raw: unknown): { data: BriefInput } | { error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const brandName = text(r.brandName, 120);
  const brief = text(r.brief, 4000);
  const targetNiche = text(r.targetNiche, 1000);
  if (!brandName) return { error: "Brand name is required" };
  if (!brief) return { error: "Write the campaign requirements — it's what the team searches from" };
  if (!targetNiche) return { error: "Target niche is required" };
  const dateText = text(r.briefDate, 10);
  const briefDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00Z`) : null;
  if (!briefDate || Number.isNaN(briefDate.getTime())) return { error: "Pick the date this brief is for" };
  const deadlineText = text(r.deadlineAt, 40);
  const deadlineAt = deadlineText ? new Date(deadlineText) : null;
  if (!deadlineAt || Number.isNaN(deadlineAt.getTime())) return { error: "Campaign deadline is required" };
  const market = text(r.market, 2).toUpperCase();
  return {
    data: {
      brandName,
      title: text(r.title, 160) || brandName,
      brief,
      targetNiche,
      website: text(r.website, 300) || null,
      market: /^[A-Z]{2}$/.test(market) ? market : null,
      minSubscribers: count(r.minSubscribers),
      maxSubscribers: count(r.maxSubscribers),
      targetCreators: count(r.targetCreators),
      notes: text(r.notes, 4000) || null,
      briefDate,
      deadlineAt,
    },
  };
}
