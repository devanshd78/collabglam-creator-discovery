/* eslint-disable @typescript-eslint/no-explicit-any -- raw YouTube API payloads are untyped JSON */
import "server-only";
import { toNumber } from "./numbers";
import { getBestThumbnail } from "./fields";

/**
 * YouTube Data API client with safe rotation across comma-separated API keys.
 *
 * Important quota note (YouTube's granular quota model):
 * - search.list uses its own Search Queries bucket (default: 100 calls/day/project).
 * - most other read endpoints use the general project quota bucket.
 * - API keys that belong to the same Google Cloud project share that project's quota.
 *
 * Rotation here is for resilience and load distribution across configured credentials. It does not
 * create additional quota for multiple keys that belong to the same Google Cloud project.
 */

const YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3";
const SEARCH_QUOTA_COOLDOWN_MS = boundedInt(
  process.env.YOUTUBE_SEARCH_QUOTA_COOLDOWN_MS,
  60 * 60 * 1000,
  60_000,
  24 * 60 * 60 * 1000
);
const KEY_ERROR_COOLDOWN_MS = boundedInt(
  process.env.YOUTUBE_KEY_ERROR_COOLDOWN_MS,
  15 * 60 * 1000,
  60_000,
  24 * 60 * 60 * 1000
);
const KEY_DEBUG = /^(1|true|yes|on)$/i.test(process.env.YOUTUBE_KEY_DEBUG ?? "");

const PUBLIC_CHANNEL_PARTS = [
  "snippet",
  "contentDetails",
  "statistics",
  "status",
  "brandingSettings",
  "topicDetails",
  "localizations",
].join(",");

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Accepts both of these forms:
 *   YOUTUBE_API_KEY="key1,key2,key3,key4"
 *   YOUTUBE_API_KEY=key1,key2,key3,key4
 *
 * It also defensively strips accidental per-key quotes and removes duplicates.
 */
function apiKeys(): string[] {
  return [
    ...new Set(
      String(process.env.YOUTUBE_API_KEY ?? "")
        .split(",")
        .map((key) => key.trim().replace(/^["']+|["']+$/g, ""))
        .filter(Boolean)
    ),
  ];
}

interface KeyRuntimeState {
  /** Only search.list is suppressed when its dedicated daily Search Queries bucket is exhausted. */
  searchBlockedUntil: number;
  /** Used for invalid/restricted credentials. Other endpoints may still use a search-blocked key. */
  keyBlockedUntil: number;
  /** Learned from Google's error message when available. Never contains the API key itself. */
  projectNumber?: string;
}

const keyState = new Map<string, KeyRuntimeState>();
let keyCursor = Math.floor(Math.random() * 1_000_000);
let loggedKeyCount = false;

function stateFor(key: string): KeyRuntimeState {
  const current = keyState.get(key);
  if (current) return current;
  const created: KeyRuntimeState = { searchBlockedUntil: 0, keyBlockedUntil: 0 };
  keyState.set(key, created);
  return created;
}

/**
 * Each request reserves its own starting key before awaiting network I/O. This matters because the
 * discovery code intentionally runs several YouTube requests concurrently. Without this, every
 * concurrent request can begin on the same key and burn one project's search quota much faster.
 */
function takeStartIndex(length: number): number {
  const index = ((keyCursor % length) + length) % length;
  keyCursor = (index + 1) % length;
  return index;
}

function projectNumberFromMessage(message: string): string | undefined {
  return /project_number:(\d+)/i.exec(message)?.[1];
}

function isDailySearchQuotaError(endpoint: string, status: number, reason: string, message: string): boolean {
  if (endpoint !== "search" || ![403, 429].includes(status)) return false;
  if (!/quotaexceeded|dailylimitexceeded|ratelimitexceeded|userratelimitexceeded/i.test(reason)) return false;
  return /search queries/i.test(message) && /per day|daily/i.test(message);
}

function isCredentialError(status: number, reason: string): boolean {
  if (![400, 403].includes(status)) return false;
  return /keyinvalid|accessnotconfigured|iprefererblocked|forbidden/i.test(reason);
}

function isQuotaOrKeyError(status: number, reason: string): boolean {
  if (![400, 403, 429].includes(status)) return false;
  return /quotaexceeded|dailylimitexceeded|ratelimitexceeded|userratelimitexceeded|keyinvalid|accessnotconfigured|iprefererblocked|forbidden/.test(
    reason.toLowerCase()
  );
}

function debug(message: string): void {
  if (KEY_DEBUG) console.log(message);
}

export class YouTubeApiError extends Error {
  readonly statusCode: number;
  readonly reason: string;

  constructor(message: string, statusCode: number, reason = "") {
    super(message);
    this.name = "YouTubeApiError";
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

type YouTubeListResponse = {
  items?: Record<string, unknown>[];
  nextPageToken?: string;
};

export async function youtubeGet<T = YouTubeListResponse>(
  endpoint: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const keys = apiKeys();
  if (keys.length === 0) {
    throw new YouTubeApiError(
      "YOUTUBE_API_KEY is not set. Add one or more comma-separated YouTube Data API keys.",
      500
    );
  }

  if (!loggedKeyCount) {
    console.log(`[YouTube API] configured keys: ${keys.length}`);
    loggedKeyCount = true;
  }

  const now = Date.now();
  const usableKeyIndexes = keys
    .map((key, index) => ({ index, state: stateFor(key) }))
    .filter(({ state }) => state.keyBlockedUntil <= now)
    .filter(({ state }) => endpoint !== "search" || state.searchBlockedUntil <= now)
    .map(({ index }) => index);

  if (usableKeyIndexes.length === 0) {
    throw new YouTubeApiError(
      endpoint === "search"
        ? "YouTube Search Queries quota is temporarily exhausted for all currently usable configured keys. Check the Search Queries quota in Google Cloud or retry after the quota window resets."
        : "All configured YouTube API keys are temporarily unavailable.",
      429,
      "rateLimitExceeded"
    );
  }

  // Round-robin across the keys that are actually usable for this endpoint. If keys 2 and 3 are
  // search-exhausted while keys 1 and 4 are healthy, concurrent calls alternate 1,4,1,4 instead of
  // repeatedly landing on key 4 after skipping blocked entries.
  const usableStart = takeStartIndex(usableKeyIndexes.length);
  const orderedKeyIndexes = [
    ...usableKeyIndexes.slice(usableStart),
    ...usableKeyIndexes.slice(0, usableStart),
  ];

  let lastError: YouTubeApiError | null = null;
  let attempted = 0;

  for (let position = 0; position < orderedKeyIndexes.length; position += 1) {
    const keyIndex = orderedKeyIndexes[position];
    const key = keys[keyIndex];
    const state = stateFor(key);
    const currentTime = Date.now();

    // State can change while concurrent requests are in flight, so re-check immediately before use.
    if (state.keyBlockedUntil > currentTime) {
      debug(`[YouTube API] skip key ${keyIndex + 1}/${keys.length}: credential cooldown active`);
      continue;
    }
    if (endpoint === "search" && state.searchBlockedUntil > currentTime) {
      debug(`[YouTube API] skip key ${keyIndex + 1}/${keys.length}: search quota cooldown active`);
      continue;
    }

    attempted += 1;

    const search = new URLSearchParams({ key });
    for (const [name, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      search.set(name, String(value));
    }

    let res: Response;
    try {
      res = await fetch(`${YOUTUBE_BASE_URL}/${endpoint}?${search.toString()}`, {
        signal: AbortSignal.timeout(Number(process.env.YOUTUBE_TIMEOUT_MS ?? 20000)),
        cache: "no-store",
      });
    } catch (err) {
      // A network/timeout failure is not evidence that the credential is bad. We still allow the
      // next configured key to try once, which is useful if a provider edge produced the failure.
      lastError = new YouTubeApiError(
        err instanceof Error ? err.message : "YouTube API request failed.",
        504
      );
      console.warn(`[YouTube API] ${endpoint} key ${keyIndex + 1}/${keys.length} network error: ${lastError.message}`);
      continue;
    }

    if (res.ok) {
      debug(`[YouTube API] ${endpoint} succeeded with key ${keyIndex + 1}/${keys.length}`);
      return (await res.json()) as T;
    }

    const payload = await res.json().catch(() => null);
    const apiError = (
      payload as { error?: { message?: string; errors?: { reason?: string }[] } } | null
    )?.error;
    const reason = apiError?.errors?.[0]?.reason ?? "";
    const message = apiError?.message ?? "YouTube API request failed.";
    const projectNumber = projectNumberFromMessage(message);

    if (projectNumber) state.projectNumber = projectNumber;

    console.warn(
      `[YouTube API] ${endpoint} key ${keyIndex + 1}/${keys.length} HTTP ${res.status} reason=${reason || "unknown"}${
        projectNumber ? ` project=${projectNumber}` : ""
      }`
    );

    if (isDailySearchQuotaError(endpoint, res.status, reason, message)) {
      state.searchBlockedUntil = Date.now() + SEARCH_QUOTA_COOLDOWN_MS;

      // If we have already learned that another configured key belongs to the same project, suppress
      // that key's search calls for the same cooldown too. This avoids repeatedly paying for known
      // failures from two credentials that share one exhausted project-level Search Queries bucket.
      if (projectNumber) {
        for (const [otherKey, otherState] of keyState.entries()) {
          if (otherKey !== key && otherState.projectNumber === projectNumber) {
            otherState.searchBlockedUntil = Math.max(otherState.searchBlockedUntil, state.searchBlockedUntil);
          }
        }
      }

      console.warn(
        `[YouTube API] search quota exhausted for key ${keyIndex + 1}/${keys.length}; suppressing search calls on this key for ${Math.round(
          SEARCH_QUOTA_COOLDOWN_MS / 60_000
        )} minutes`
      );
    } else if (isCredentialError(res.status, reason)) {
      state.keyBlockedUntil = Date.now() + KEY_ERROR_COOLDOWN_MS;
      console.warn(
        `[YouTube API] key ${keyIndex + 1}/${keys.length} is invalid/restricted for this request; cooldown ${Math.round(
          KEY_ERROR_COOLDOWN_MS / 60_000
        )} minutes`
      );
    }

    lastError = new YouTubeApiError(message, res.status, reason);

    if (position < orderedKeyIndexes.length - 1 && isQuotaOrKeyError(res.status, reason)) {
      continue;
    }

    throw lastError;
  }

  if (endpoint === "search" && attempted === 0) {
    throw new YouTubeApiError(
      "YouTube Search Queries quota is temporarily exhausted for all currently usable configured keys. Check the Search Queries quota in Google Cloud or retry after the quota window resets.",
      429,
      "rateLimitExceeded"
    );
  }

  throw lastError ?? new YouTubeApiError("YouTube API request failed.", 500);
}

/** Same batching trick as getVideosStats — one call for up to 50 channels instead of one call
 * each, since channels.list accepts a comma-joined id list just like videos.list does. This is
 * what makes Discovery's search results affordable: a page of 50 search hits costs 1 extra unit
 * to fully resolve, not 50. */
export async function getChannelsDetailsBatch(channelIds: string[]): Promise<Record<string, any>[]> {
  const ids = [...new Set(channelIds.filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return [];

  const data = await youtubeGet("channels", { part: PUBLIC_CHANNEL_PARTS, id: ids.join(",") });
  return (data.items ?? []) as Record<string, any>[];
}

export interface SearchChannelsOptions {
  /** 1-50, YouTube's own per-page cap. */
  maxResults?: number;
  /** ISO 3166-1 alpha-2 (e.g. "IN", "US"). Biases relevance toward that region — it does NOT
   * hard-filter a channel's actual location, which only channels.list's snippet.country reports. */
  regionCode?: string;
  relevanceLanguage?: string;
  order?: "relevance" | "viewCount" | "date";
  pageToken?: string;
}

export interface SearchChannelHit {
  channelId: string;
  title: string;
  thumbnailUrl: string;
}

/**
 * search.list, type=channel. Under YouTube's granular quota model, each call consumes 1 unit from
 * the Search Queries bucket, whose default allocation is 100 calls/day/project.
 *
 * Returns bare id/title/thumbnail only; a search hit's own snippet.description is truncated and
 * unsuitable for email/platform-link extraction — resolve full channel details separately via
 * getChannelsDetailsBatch for anything beyond "does this channel exist and what's it called."
 */
export async function searchChannels(
  query: string,
  opts: SearchChannelsOptions = {}
): Promise<{ items: SearchChannelHit[]; nextPageToken?: string }> {
  const data = await youtubeGet("search", {
    part: "snippet",
    q: query,
    type: "channel",
    maxResults: Math.min(Math.max(opts.maxResults ?? 25, 1), 50),
    regionCode: opts.regionCode,
    relevanceLanguage: opts.relevanceLanguage,
    order: opts.order,
    pageToken: opts.pageToken,
  });

  const items = ((data.items ?? []) as any[])
    .map((hit) => ({
      channelId: hit.snippet?.channelId ?? hit.id?.channelId ?? "",
      title: hit.snippet?.title ?? "",
      thumbnailUrl: getBestThumbnail(hit.snippet?.thumbnails),
    }))
    .filter((hit) => hit.channelId);

  return { items, nextPageToken: data.nextPageToken };
}

export interface VideoSearchHit {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: string | null;
}

export interface SearchVideosOptions {
  /** 1-50, YouTube's own per-page cap. */
  maxResults?: number;
  regionCode?: string;
  relevanceLanguage?: string;
  order?: "relevance" | "viewCount" | "date";
  pageToken?: string;
}

/** search.list HTML-escapes snippet text while videos.list does not — decoded so a title read from a
 * search hit matches the same title read later from videos.list. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * search.list, type=video. Campaign discovery searches videos rather than channels because a
 * creator's channel name and blurb rarely say "treadmill reviews" even when half their uploads are
 * exactly that — the videos do. Each call consumes 1 Search Queries unit.
 */
export async function searchVideos(
  query: string,
  opts: SearchVideosOptions = {}
): Promise<{ items: VideoSearchHit[]; nextPageToken?: string }> {
  const data = await youtubeGet("search", {
    part: "snippet",
    q: query,
    type: "video",
    maxResults: Math.min(Math.max(opts.maxResults ?? 50, 1), 50),
    regionCode: opts.regionCode,
    relevanceLanguage: opts.relevanceLanguage,
    order: opts.order,
    pageToken: opts.pageToken,
  });

  const items = ((data.items ?? []) as any[])
    .map((hit) => ({
      videoId: hit.id?.videoId ?? "",
      channelId: hit.snippet?.channelId ?? "",
      channelTitle: decodeEntities(hit.snippet?.channelTitle ?? ""),
      title: decodeEntities(hit.snippet?.title ?? ""),
      publishedAt: hit.snippet?.publishedAt ?? null,
    }))
    .filter((hit) => hit.videoId && hit.channelId);

  return { items, nextPageToken: (data as { nextPageToken?: string }).nextPageToken };
}

/** One page of a channel's uploads playlist (newest first) plus the token for the next page —
 * getRecentChannelVideoIds only ever returns the first page. 1 general quota unit per page. */
export async function getChannelUploadsPage(
  uploadPlaylistId: string,
  pageToken?: string,
  maxResults = 50
): Promise<{ videoIds: string[]; nextPageToken?: string }> {
  if (!uploadPlaylistId) return { videoIds: [] };
  const data = await youtubeGet("playlistItems", {
    part: "contentDetails",
    playlistId: uploadPlaylistId,
    maxResults: Math.min(Math.max(maxResults, 1), 50),
    pageToken,
  });
  const videoIds: string[] = ((data.items ?? []) as any[]).map((item) => item.contentDetails?.videoId).filter(Boolean);
  return { videoIds, nextPageToken: (data as { nextPageToken?: string }).nextPageToken };
}

export async function getRecentChannelVideoIds(uploadPlaylistId: string, limit = 12): Promise<string[]> {
  if (!uploadPlaylistId) return [];

  const safeLimit = Math.min(Math.max(toNumber(limit, 12), 1), 50);
  const data = await youtubeGet("playlistItems", {
    part: "snippet,contentDetails,status",
    playlistId: uploadPlaylistId,
    maxResults: safeLimit,
  });

  return ((data.items ?? []) as any[])
    .map((item) => item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId)
    .filter(Boolean);
}

export async function getVideosStats(videoIds: string[]): Promise<Record<string, any>[]> {
  const ids = [...new Set(videoIds.filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return [];

  const data = await youtubeGet("videos", {
    part: "snippet,contentDetails,statistics,status,topicDetails",
    id: ids.join(","),
  });
  return (data.items ?? []) as Record<string, any>[];
}
