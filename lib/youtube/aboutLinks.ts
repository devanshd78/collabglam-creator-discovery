/**
 * The links a creator lists in their channel's About panel (website, Instagram, Linktree…).
 *
 * The Data API doesn't return these: `snippet.description` is only the description text, and many
 * creators leave that link-free and put their links in the dedicated section. The About page is a
 * public page that YouTube's robots.txt allows, and it carries the links in its embedded page data
 * as `channelExternalLinkViewModel` entries. Nothing behind a login or the "View email address"
 * CAPTCHA is touched.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; CollabGlamBot/1.0; creator business-contact lookup)";
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 3_000_000;

export interface AboutLink {
  title: string;
  url: string;
}

/** Pure parser, exported for tests. The real destination sits URL-encoded in the `q=` parameter of
 * YouTube's redirect wrapper; the displayed `link.content` (no scheme) is the fallback. */
export function parseAboutLinks(html: string): AboutLink[] {
  const out: AboutLink[] = [];
  const seen = new Set<string>();
  const marker = '"channelExternalLinkViewModel":';
  let index = html.indexOf(marker);
  while (index >= 0) {
    const next = html.indexOf(marker, index + marker.length);
    const segment = html.slice(index, next >= 0 ? Math.min(next, index + 4000) : index + 4000);
    index = next;

    const title = segment.match(/"title":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    const shown = segment.match(/"link":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    const redirect = segment.match(/(?:\\u0026|[?&])q=([^"\\&]+)/)?.[1];
    let url = "";
    try {
      url = redirect ? decodeURIComponent(redirect) : shown ? `https://${shown}` : "";
      url = new URL(url).href;
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: unescapeJson(title), url });
  }
  return out;
}

function unescapeJson(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

export async function fetchAboutLinks(channelId: string): Promise<AboutLink[]> {
  if (!/^UC[\w-]{22}$/.test(channelId)) return [];
  try {
    const res = await fetch(`https://www.youtube.com/channel/${channelId}/about`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.8", Accept: "text/html" },
      cache: "no-store",
    });
    if (!res.ok || !res.body) return [];
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return parseAboutLinks(new TextDecoder("utf-8").decode(Buffer.concat(chunks)));
  } catch {
    return [];
  }
}
