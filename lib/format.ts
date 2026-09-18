export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function shortDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function dateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** A brief's date column is a calendar date stored at UTC midnight — read it back in UTC. */
export function briefDay(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function isoDay(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}
