/**
 * Numeric and formatting helpers for the YouTube pipeline: safe number parsing, percentages,
 * ISO-8601 durations and compact display values.
 */

export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function safeDivide(numerator: unknown, denominator: unknown): number {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  if (!d) return 0;
  return n / d;
}

export function percent(numerator: unknown, denominator: unknown, decimals = 2): number {
  return Number((safeDivide(numerator, denominator) * 100).toFixed(decimals));
}

export function clamp(value: unknown, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, toNumber(value)));
}

export function round(value: unknown, decimals = 2): number {
  return Number(toNumber(value).toFixed(decimals));
}

/** ISO 8601 duration ("PT4M13S") to seconds — the shape YouTube reports video length in. */
export function parseIsoDurationToSeconds(duration: unknown): number {
  if (!duration || typeof duration !== "string") return 0;
  const match = duration.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;

  return (
    toNumber(match[1]) * 86400 + toNumber(match[2]) * 3600 + toNumber(match[3]) * 60 + toNumber(match[4])
  );
}

export function formatDurationFromSeconds(seconds: unknown): string {
  const total = Math.max(0, Math.round(toNumber(seconds)));
  if (!total) return "Not available";

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function getAgeLabel(dateString: unknown): string {
  if (!dateString) return "";
  const date = new Date(String(dateString));
  if (Number.isNaN(date.getTime())) return "";

  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days < 30) return `${days} days`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} months`;

  const years = Math.floor(months / 12);
  const extraMonths = months % 12;
  return extraMonths ? `${years} years ${extraMonths} months` : `${years} years`;
}

export function compactNumber(value: unknown): string {
  const n = toNumber(value, 0);
  if (n >= 1_000_000_000) return `${round(n / 1_000_000_000, 1)}B`;
  if (n >= 1_000_000) return `${round(n / 1_000_000, 1)}M`;
  if (n >= 1_000) return `${round(n / 1_000, 1)}K`;
  return String(Math.round(n));
}

export function money(value: unknown, decimals = 2): string {
  return `$${toNumber(value, 0).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
