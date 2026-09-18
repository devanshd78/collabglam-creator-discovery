/**
 * Pulls a business contact email and cross-platform links straight out of a YouTube channel's
 * About description — the exact text a human currently reads by eye to do this by hand. No
 * scraping, no unofficial API: `channels.list`'s `snippet.description` already returns this for
 * free as part of the same call that gets subscriber count, so there's nothing extra to fetch.
 *
 * Deliberately dependency-free and synchronous, same style as lib/emailExtractorHeuristic.ts —
 * no `server-only` import, no network, no Prisma — so it's usable from anywhere (including tests)
 * without dragging in the YouTube API client.
 *
 * Verified against real channel descriptions before writing these patterns (a handful of Indian
 * tech-review channels, September 2026): business emails and social links both appear as plain
 * text — "Business & Sponsorship: name@gmail.com", "Instagram → https://instagram.com/handle" —
 * never obfuscated and never routed through YouTube's outbound-link redirect wrapper (that
 * wrapping applies to rendered page links, not the raw description string the API returns).
 */

export interface ExtractedPlatformLinks {
  instagram?: string;
  tiktok?: string;
  twitter?: string;
  pinterest?: string;
  facebook?: string;
  amazonStorefront?: string;
}

export interface ExtractedChannelContact {
  email: string | null;
  platformLinks: ExtractedPlatformLinks;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** One pattern per platform a brand might ask about. Ordered by the URL shape each site actually
 * uses in the wild (tiktok/twitter handles are prefixed with "@", instagram/facebook/pinterest
 * aren't); amazon's creator storefront is always under "/shop/<handle>". */
const PLATFORM_PATTERNS: { key: keyof ExtractedPlatformLinks; pattern: RegExp }[] = [
  { key: "instagram", pattern: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+/i },
  { key: "tiktok", pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._-]+/i },
  { key: "twitter", pattern: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]+/i },
  { key: "pinterest", pattern: /https?:\/\/(?:www\.)?pinterest\.[a-z.]+\/[A-Za-z0-9._-]+/i },
  { key: "facebook", pattern: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9.-]+/i },
  { key: "amazonStorefront", pattern: /https?:\/\/(?:www\.)?amazon\.[a-z.]+\/shop\/[A-Za-z0-9._-]+/i },
];

export function extractChannelContact(description: string): ExtractedChannelContact {
  const text = description ?? "";
  const emailMatch = text.match(EMAIL_REGEX);

  const platformLinks: ExtractedPlatformLinks = {};
  for (const { key, pattern } of PLATFORM_PATTERNS) {
    const match = text.match(pattern);
    if (match) platformLinks[key] = match[0];
  }

  return { email: emailMatch?.[0] ?? null, platformLinks };
}
