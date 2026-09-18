/**
 * Finds a creator's business email in the places they chose to publish it: their channel
 * description, the link-in-bio page (Linktree, Beacons, Stan…) linked from it, and their own website
 * and its contact page.
 *
 * What it deliberately does not do: get past a login, CAPTCHA or "reveal email" gate. YouTube's
 * "View email address" button and Instagram/TikTok/Facebook profiles sit behind exactly that, so
 * they're recorded as platform links and never fetched. It also honours robots.txt, identifies
 * itself, reads only a handful of pages per creator, and refuses private/internal addresses so a
 * crafted link in a description can't point it at the app's own network.
 *
 * Only an email with an ownership signal is accepted — written by the creator on YouTube or their
 * link page, or on a site that's evidently theirs — because a sponsor's "partnerships@brand.com"
 * picked up from a discount link would be worse than no email at all.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractChannelContact, type ExtractedPlatformLinks } from "./youtube/channelExtractor";

export interface EmailCandidate {
  email: string;
  /** Short label for where it was found, shown next to the email. */
  source: string;
  sourceUrl: string | null;
  score: number;
}

export interface EmailSearchResult {
  email: string | null;
  source: string | null;
  sourceUrl: string | null;
  candidates: EmailCandidate[];
  checkedUrls: string[];
  /** Platform profiles found in the description or on the pages read. */
  platformLinks: ExtractedPlatformLinks;
  /** The creator's own websites and link pages. */
  websiteLinks: string[];
}

export type LinkKind = "linkInBio" | "website" | "shortener" | "social" | "skip";

const USER_AGENT = "Mozilla/5.0 (compatible; CollabGlamBot/1.0; creator business-contact lookup)";
const ROBOTS_AGENT = "collabglambot";
const MAX_PAGE_BYTES = 1_000_000;
const PAGE_TIMEOUT_MS = 8_000;
export const ACCEPT_SCORE = 40;
const STRONG_SCORE = 60;

const LINK_IN_BIO_HOSTS = [
  "linktr.ee", "beacons.ai", "stan.store", "bio.link", "lnk.bio", "campsite.bio", "carrd.co", "taplink.cc",
  "komi.io", "snipfeed.co", "hoo.be", "msha.ke", "allmylinks.com", "solo.to", "linkin.bio", "tap.bio",
  "linkpop.com", "bio.site", "linkfly.to", "withkoji.com", "direct.me",
];

// Profiles behind logins or bot protection — recorded, never read.
const SOCIAL_HOSTS = [
  "instagram.com", "tiktok.com", "facebook.com", "fb.com", "fb.me", "twitter.com", "x.com", "threads.net",
  "snapchat.com", "twitch.tv", "linkedin.com", "discord.gg", "discord.com", "reddit.com", "patreon.com",
  "onlyfans.com", "t.me", "telegram.me", "wa.me", "whatsapp.com", "youtube.com", "youtu.be",
];

// Stores, affiliate redirects, sponsors, payment and app pages: nothing here is the creator's own
// contact page, and a sponsor's site would hand back the sponsor's email.
const SKIP_HOSTS = [
  "amzn.to", "amzn.eu", "a.co", "shopltk.com", "liketoknow.it", "rstyle.me", "geni.us", "howl.me",
  "shopstyle.com", "walmart.com", "target.com", "bestbuy.com", "homedepot.com", "lowes.com", "wayfair.com",
  "ikea.com", "etsy.com", "ebay.com", "aliexpress.com", "temu.com", "shein.com", "costco.com", "paypal.com",
  "paypal.me", "venmo.com", "cash.app", "buymeacoffee.com", "ko-fi.com", "gofundme.com", "nordvpn.com",
  "expressvpn.com", "surfshark.com", "audible.com", "skillshare.com", "squarespace.com", "hellofresh.com",
  "google.com", "goo.gl", "apple.com", "spotify.com", "soundcloud.com", "vimeo.com", "epidemicsound.com",
  "artlist.io", "canva.com", "tubebuddy.com", "vidiq.com", "teespring.com", "creator-spring.com",
  "honey.com", "joinhoney.com", "rakuten.com", "shopmy.us", "tidd.ly", "sjv.io", "pxf.io", "go.skimresources.com",
];

const SHORTENER_HOSTS = ["bit.ly", "tinyurl.com", "t.co", "ow.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "is.gd", "buff.ly"];

const FREEMAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "zoho.com"]);

const BUSINESS_LOCAL = /business|collab|partner|sponsor|brand|media|press|\bpr\b|booking|deals|inquir|enquir|work|hello|contact|manage|mgmt|team|talent|info|creator|ads/i;
const SUPPORT_LOCAL = /support|order|return|help|billing|customerservice|customer-service|shop|sales|careers|jobs|privacy|legal|abuse|dmca/i;
const JUNK_EMAIL = /(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|example\.|sentry|wixpress|@domain\.com|@email\.com|yourname|your-?email|name@|user@)/i;
const JUNK_TLD = /\.(png|jpe?g|gif|webp|svg|css|js|ico|woff2?)$/i;
const PLATFORM_EMAIL_DOMAINS = [...LINK_IN_BIO_HOSTS, "squarespace.com", "shopify.com", "wix.com", "godaddy.com", "cloudflare.com", "wordpress.com", "youtube.com", "instagram.com", "tiktok.com", "facebook.com", "amazon.com", "google.com", "sentry.io"];

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;

// --- Pure helpers (exported for tests) -----------------------------------------------------------

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/** "shop.jane-doe.co.uk" -> "jane-doe.co.uk", "blog.janedoe.com" -> "janedoe.com". */
export function rootDomain(hostname: string): string {
  const labels = normalizeHost(hostname).split(".");
  if (labels.length <= 2) return labels.join(".");
  const secondLevel = labels[labels.length - 2];
  const tld = labels[labels.length - 1];
  const keep = tld.length === 2 && ["co", "com", "org", "net", "ac", "gov"].includes(secondLevel) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export function classifyUrl(raw: string): LinkKind {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "skip";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "skip";
  const host = normalizeHost(url.hostname);
  if (hostMatches(host, LINK_IN_BIO_HOSTS)) return "linkInBio";
  if (hostMatches(host, SOCIAL_HOSTS) || /(^|\.)pinterest\.[a-z.]+$/.test(host)) return "social";
  if (hostMatches(host, SHORTENER_HOSTS)) return "shortener";
  if (hostMatches(host, SKIP_HOSTS) || /(^|\.)amazon\.[a-z.]+$/.test(host)) return "skip";
  // Tracking/discount links are how sponsors appear in descriptions.
  if (/[?&](ref|aff|affiliate|coupon|discount|promo|utm_campaign|irclickid|clickid)=/i.test(url.search) || /\/(go|ref|aff)\//i.test(url.pathname)) {
    return "skip";
  }
  return "website";
}

/** Every link written in a block of text, with or without a scheme. */
export function extractUrls(text: string): string[] {
  const found = new Set<string>();
  const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+|\b(?:linktr\.ee|beacons\.ai|stan\.store|bio\.link|lnk\.bio)\/[^\s<>"'()[\]{}]+/gi;
  for (const match of text.matchAll(pattern)) {
    let candidate = match[0].replace(/[.,;:!?]+$/, "");
    if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
    try {
      found.add(new URL(candidate).href);
    } catch {
      // not a real URL
    }
  }
  return [...found];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

/** Plain emails plus the common hand-obfuscated forms: "name [at] gmail [dot] com", "name(at)site.com". */
export function extractEmailsFromText(text: string): string[] {
  const normalized = decodeEntities(text)
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, ".")
    .replace(/([a-z0-9._%+-])\s+@\s+([a-z0-9-])/gi, "$1@$2");
  // "name@gmail dot com" once the @ is real.
  const dotted = normalized.replace(/@([a-z0-9-]+(?:\.[a-z0-9-]+)*)\s+dot\s+([a-z]{2,24})\b/gi, "@$1.$2");
  const emails = new Set<string>();
  for (const match of dotted.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase().replace(/^[._%+-]+/, "").replace(/\.+$/, "");
    if (!isJunkEmail(email)) emails.add(email);
  }
  return [...emails];
}

export function isJunkEmail(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return JUNK_EMAIL.test(email) || JUNK_TLD.test(email) || hostMatches(domain, PLATFORM_EMAIL_DOMAINS);
}

const GENERIC_NAME_WORDS = new Set(["official", "channel", "review", "reviews", "home", "life", "with", "the", "and", "family", "tech", "vlog", "vlogs", "studio", "media", "show", "daily", "style", "living", "house", "world", "youtube", "films", "productions"]);

/** Distinctive fragments of the channel name/handle, to recognise the creator's own domain or inbox. */
export function channelTokens(channelTitle: string, channelUrl?: string | null): string[] {
  const tokens = new Set<string>();
  const words = channelTitle.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/);
  for (const w of words) if (w.length >= 4 && !GENERIC_NAME_WORDS.has(w)) tokens.add(w);
  const squashed = words.join("");
  if (squashed.length >= 5) tokens.add(squashed);
  const handle = channelUrl?.match(/\/@([\w.-]+)/)?.[1]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (handle && handle.length >= 4) tokens.add(handle);
  return [...tokens];
}

function containsToken(value: string, tokens: string[]): boolean {
  const squashed = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return tokens.some((t) => t.length >= 4 && squashed.includes(t));
}

export interface ScoreContext {
  fromDescription?: boolean;
  fromLinkPage?: boolean;
  /** A contact/about/work-with-me page on the creator's own site. */
  fromContactPage?: boolean;
  /** Root domain of a site that's evidently the creator's own. */
  ownedRoot?: string | null;
  tokens: string[];
}

export function scoreEmail(email: string, ctx: ScoreContext): number {
  const [local, domain = ""] = email.split("@");
  let score = 0;
  if (ctx.fromDescription) score += 50;
  if (ctx.fromLinkPage) score += 40;
  if (ctx.fromContactPage && ctx.ownedRoot) score += 15;
  if (ctx.ownedRoot && rootDomain(domain) === ctx.ownedRoot) score += 35;
  else if (ctx.ownedRoot && FREEMAIL.has(domain)) score += 25;
  if (BUSINESS_LOCAL.test(local)) score += 15;
  if (containsToken(local, ctx.tokens) || containsToken(domain.split(".")[0], ctx.tokens)) score += 15;
  if (SUPPORT_LOCAL.test(local)) score -= 25;
  return score;
}

export function decodeCfEmail(hex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out.toLowerCase();
}

/** Links and emails in an HTML page, including the JSON link lists Linktree-style pages embed. */
export function parseHtml(html: string, baseUrl: string): { emails: string[]; links: string[] } {
  const emails = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    try {
      const email = decodeURIComponent(m[1]).trim().toLowerCase();
      if (!isJunkEmail(email) && /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(email)) emails.add(email);
    } catch {
      // malformed mailto
    }
  }
  // Cloudflare's "email protection" swaps addresses for an XOR-encoded hex string.
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const email = decodeCfEmail(m[1] ?? m[2]);
    if (email && !isJunkEmail(email) && /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(email)) emails.add(email);
  }
  // Page descriptions ("email us at …") live in meta attributes, which the tag strip below drops.
  const metaText = [...html.matchAll(/<meta\s[^>]*content\s*=\s*["']([^"']*)["'][^>]*>/gi)].map((m) => m[1]).join(" ");
  for (const email of extractEmailsFromText(metaText)) emails.add(email);

  const text = html
    .replace(/<script(?![^>]*application\/(?:ld\+)?json)[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  for (const email of extractEmailsFromText(text)) emails.add(email);

  const links = new Set<string>();
  const addLink = (href: string) => {
    try {
      const url = new URL(href.replace(/\\u002F/gi, "/").replace(/\\\//g, "/"), baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") links.add(url.href);
    } catch {
      // not a URL
    }
  };
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) addLink(m[1]);
  for (const m of html.matchAll(/"url"\s*:\s*"(https?:[^"]+)"/gi)) addLink(m[1]);
  return { emails: [...emails], links: [...links] };
}

function robotsPatternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped.endsWith("\\$") ? escaped.slice(0, -2) + "$" : escaped}`);
}

/** robots.txt check: rules for this bot win over "*"; the longest matching rule decides. */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  type Rule = { allow: boolean; pattern: string };
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
      lastWasAgent = false;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ROBOTS_AGENT.includes(a)));
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!robotsPatternToRegex(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

export function sourceLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${normalizeHost(u.hostname)}${path}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

// --- Network ------------------------------------------------------------------------------------

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Unsupported port");
  if (url.username || url.password) throw new Error("Credentials in URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error("Private host");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error("Private address");
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(value);
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

async function rawGet(url: URL, deadline: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(PAGE_TIMEOUT_MS, deadline - Date.now())));
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function robotsFor(origin: string, cache: Map<string, string>, deadline: number): Promise<string> {
  const cached = cache.get(origin);
  if (cached !== undefined) return cached;
  let text = "";
  try {
    const url = new URL("/robots.txt", origin);
    await assertPublicUrl(url);
    const res = await rawGet(url, deadline);
    if (res.ok) text = (await readCapped(res)).slice(0, 100_000);
  } catch {
    text = "";
  }
  cache.set(origin, text);
  return text;
}

/** GETs one page with SSRF, redirect, robots, size and time limits. Null when not readable. */
async function fetchPage(rawUrl: string, robots: Map<string, string>, deadline: number): Promise<{ finalUrl: string; body: string } | null> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 4; hop++) {
    if (Date.now() > deadline) return null;
    await assertPublicUrl(url);
    if (!robotsAllows(await robotsFor(url.origin, robots, deadline), url.pathname)) return null;
    const res = await rawGet(url, deadline);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      url = new URL(location, url);
      // A shortener that lands on a store or a social profile stops here.
      const kind = classifyUrl(url.href);
      if (kind === "social" || kind === "skip") return null;
      continue;
    }
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;
    return { finalUrl: url.href, body: await readCapped(res) };
  }
  return null;
}

/** One key per page regardless of scheme, "www.", query, fragment or trailing slash. */
export function pageKey(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "");
}

const CONTACT_PAGE = /\/(contact|about|work-with|business|advertis|sponsor|partner|collab|press|media-kit)/i;
const CONTACT_PATHS = ["/contact", "/contact-us", "/work-with-me", "/about", "/about-us"];

/**
 * The lines a creator repeats across their own uploads — the standard footer with their website,
 * socials and "business inquiries:" address. A line has to recur in at least two different videos,
 * which keeps one-off sponsor copy out; a line that names an email next to a business cue is kept
 * even once, since that's how many creators write it.
 */
export function recurringFooterText(videoDescriptions: string[], maxLines = 40): string {
  const counts = new Map<string, number>();
  const cued = new Set<string>();
  for (const description of videoDescriptions) {
    const lines = new Set(
      description
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 6 && l.length <= 300)
    );
    for (const line of lines) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
      if (/@/.test(line) && /business|inquir|enquir|collab|sponsor|partner|contact|email|booking|pr\b/i.test(line)) cued.add(line);
    }
  }
  const recurring = [...counts.entries()].filter(([, n]) => n >= 2).map(([line]) => line);

  // "Full review: janedoe.com/product-x" differs in every video, but the domain doesn't — a site
  // linked from several uploads is listed by its homepage. Ownership is still judged by the finder.
  const domainCounts = new Map<string, { count: number; origin: string }>();
  for (const description of videoDescriptions) {
    const origins = new Map<string, string>();
    for (const url of extractUrls(description)) {
      const { hostname, origin } = new URL(url);
      origins.set(rootDomain(hostname), origin);
    }
    for (const [root, origin] of origins) {
      const entry = domainCounts.get(root) ?? { count: 0, origin };
      entry.count++;
      domainCounts.set(root, entry);
    }
  }
  const sites = [...domainCounts.values()].filter((d) => d.count >= 2).map((d) => `${d.origin}/`);

  return [...new Set([...cued, ...recurring])].slice(0, maxLines).concat(sites.slice(0, 10)).join("\n");
}
const OWNERSHIP_CUE = /(website|blog|my site|contact|business|inquir|enquir|collab|partner|work with me|booking)[^\n]{0,60}$/i;

/**
 * Looks for the creator's business email. Pages are read in order of how likely they are to be the
 * creator's own — link-in-bio page, then a site the description introduces as theirs or that carries
 * their name — and the search stops early once a strong match turns up.
 */
export async function findCreatorEmail(
  input: {
    description: string;
    channelTitle: string;
    channelUrl?: string | null;
    /** Links from the channel's About panel — listed by the creator, so treated as theirs. */
    aboutLinks?: string[];
    /** Text the creator repeats across their own video descriptions (see recurringFooterText). */
    videoFooter?: string;
  },
  options: { deadlineMs?: number; maxFetches?: number } = {}
): Promise<EmailSearchResult> {
  const deadline = Date.now() + (options.deadlineMs ?? 20_000);
  const maxFetches = options.maxFetches ?? 8;
  const description = input.description ?? "";
  const footer = input.videoFooter ?? "";
  const tokens = channelTokens(input.channelTitle, input.channelUrl);

  const byEmail = new Map<string, EmailCandidate>();
  const addCandidates = (emails: string[], source: string, sourceUrl: string | null, ctx: Omit<ScoreContext, "tokens">) => {
    for (const email of emails) {
      const score = scoreEmail(email, { ...ctx, tokens });
      const existing = byEmail.get(email);
      if (!existing || score > existing.score) byEmail.set(email, { email, source, sourceUrl, score });
    }
  };
  const best = () => [...byEmail.values()].sort((a, b) => b.score - a.score)[0];

  addCandidates(extractEmailsFromText(description), "Channel description", null, { fromDescription: true });
  addCandidates(extractEmailsFromText(footer), "Video descriptions", null, { fromDescription: true });

  const aboutLinks = input.aboutLinks ?? [];
  const platformLinks: ExtractedPlatformLinks = {
    ...extractChannelContact(`${aboutLinks.join(" ")} ${footer}`).platformLinks,
    ...extractChannelContact(description).platformLinks,
  };
  const websiteLinks = new Set<string>();

  type Job = { url: string; kind: LinkKind | "contact"; owned: boolean; depth: number; priority: number };
  const queue: Job[] = [];
  const queued = new Set<string>();
  const enqueue = (url: string, kind: LinkKind, owned: boolean) => {
    // A creator's own homepage is where the contact link lives, not a deep review page.
    const target = kind === "website" ? new URL("/", url).href : url;
    const key = pageKey(target);
    if (queued.has(key)) return;
    queued.add(key);
    queue.push({ url: target, kind, owned, depth: 0, priority: kind === "linkInBio" ? 0 : kind === "website" ? 1 : 2 });
    if (kind !== "shortener") websiteLinks.add(target);
  };

  for (const url of aboutLinks) {
    const kind = classifyUrl(url);
    if (kind === "social" || kind === "skip") continue;
    enqueue(url, kind, true);
  }
  for (const text of [description, footer]) {
    for (const url of extractUrls(text)) {
      const kind = classifyUrl(url);
      if (kind === "social" || kind === "skip") continue;
      const index = text.indexOf(url.replace(/^https:\/\//, "").replace(/\/$/, ""));
      const before = index > 0 ? text.slice(Math.max(0, index - 80), index) : "";
      const owned = kind === "linkInBio" || containsToken(new URL(url).hostname, tokens) || OWNERSHIP_CUE.test(before);
      // A website the creator doesn't present as theirs is most often a sponsor — not read. Unowned
      // shorteners in video descriptions are almost always affiliate links, so those are skipped too.
      if (!owned && (kind === "website" || text === footer)) continue;
      enqueue(url, kind, owned);
    }
  }
  queue.sort((a, b) => a.priority - b.priority);

  const robots = new Map<string, string>();
  const seen = new Set<string>();
  const checkedUrls: string[] = [];
  let fetches = 0;

  while (queue.length > 0 && fetches < maxFetches && Date.now() < deadline) {
    if ((best()?.score ?? 0) >= STRONG_SCORE) break;
    const job = queue.shift()!;
    const key = pageKey(job.url);
    if (seen.has(key)) continue;
    seen.add(key);

    let page: { finalUrl: string; body: string } | null = null;
    try {
      fetches++;
      page = await fetchPage(job.url, robots, deadline);
    } catch {
      page = null;
    }
    if (!page) continue;
    // Several links often redirect to the same page (http → https, bare → www).
    const finalKey = pageKey(page.finalUrl);
    if (finalKey !== key && seen.has(finalKey)) continue;
    seen.add(finalKey);
    checkedUrls.push(page.finalUrl);

    const finalKind = classifyUrl(page.finalUrl);
    if (finalKind === "social" || finalKind === "skip") continue;
    const finalHost = new URL(page.finalUrl).hostname;
    const owned = job.owned || finalKind === "linkInBio" || containsToken(finalHost, tokens);
    if (!owned) continue;
    if (finalKind !== "shortener") websiteLinks.add(page.finalUrl);

    const { emails, links } = parseHtml(page.body, page.finalUrl);
    addCandidates(emails, sourceLabel(page.finalUrl), page.finalUrl, {
      fromLinkPage: finalKind === "linkInBio",
      ownedRoot: finalKind === "linkInBio" ? null : rootDomain(finalHost),
      fromContactPage: CONTACT_PAGE.test(new URL(page.finalUrl).pathname),
    });

    const listed = extractChannelContact(links.join(" ")).platformLinks;
    for (const key of Object.keys(listed) as (keyof ExtractedPlatformLinks)[]) {
      if (!platformLinks[key]) platformLinks[key] = listed[key];
    }

    if (finalKind === "linkInBio" && job.depth === 0) {
      // Sites a creator lists on their own link page are theirs (or at least chosen by them).
      let added = 0;
      for (const link of links) {
        const kind = classifyUrl(link);
        if ((kind !== "website" && kind !== "shortener") || normalizeHost(new URL(link).hostname) === normalizeHost(finalHost)) continue;
        queue.push({ url: link, kind, owned: true, depth: 1, priority: 1 });
        if (++added >= 3) break;
      }
      queue.sort((a, b) => a.priority - b.priority);
    } else if (finalKind === "website" && emails.length === 0 && job.kind !== "contact") {
      for (const path of CONTACT_PATHS) {
        queue.push({ url: new URL(path, page.finalUrl).href, kind: "contact", owned: true, depth: job.depth + 1, priority: 3 });
      }
    }
  }

  const candidates = [...byEmail.values()].sort((a, b) => b.score - a.score);
  const winner = candidates[0] && candidates[0].score >= ACCEPT_SCORE ? candidates[0] : null;
  return {
    email: winner?.email ?? null,
    source: winner?.source ?? null,
    sourceUrl: winner?.sourceUrl ?? null,
    candidates,
    checkedUrls,
    platformLinks,
    websiteLinks: [...websiteLinks].slice(0, 10),
  };
}
