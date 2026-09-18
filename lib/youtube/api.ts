/* eslint-disable @typescript-eslint/no-explicit-any -- raw YouTube API payloads are untyped JSON */
import "server-only";
import { toNumber } from "./numbers";
import { getBestThumbnail } from "./fields";

/**
 * The YouTube Data API client, with rotation across several comma-separated API keys.
 *
 * The key cursor starts at a random offset (see below), because serverless invocations don't share
 * module state, and a fixed start would exhaust key #1 first.
 */

const YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3";

const PUBLIC_CHANNEL_PARTS = [
  "snippet",
  "contentDetails",
  "statistics",
  "status",
  "brandingSettings",
  "topicDetails",
  "localizations",
].join(",");

function apiKeys(): string[] {
  return String(process.env.YOUTUBE_API_KEY ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Where in the key list to start.
 *
 * Serverless instances are short-lived and don't share memory, so a fixed start would hammer key #1
 * from every cold instance and exhaust its daily quota while the rest sat idle. Starting at a
 * random offset spreads load across instances; within one instance the cursor advances to the
 * next key on quota errors.
 */
let keyCursor = -1;

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

/** Quota and bad-key failures are the ones worth retrying on a different key; everything else is
 * a real error that another key would fail at identically. */
function isQuotaOrKeyError(status: number, reason: string): boolean {
  if (![400, 403, 429].includes(status)) return false;
  return /quotaexceeded|dailylimitexceeded|ratelimitexceeded|userratelimitexceeded|keyinvalid|forbidden/.test(
    reason.toLowerCase()
  );
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

  if (keyCursor < 0) keyCursor = Math.floor(Math.random() * keys.length);

  let lastError: YouTubeApiError | null = null;

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const keyIndex = (keyCursor + attempt) % keys.length;

    const search = new URLSearchParams({ key: keys[keyIndex] });
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
      lastError = new YouTubeApiError(
        err instanceof Error ? err.message : "YouTube API request failed.",
        504
      );
      continue;
    }

    if (res.ok) {
      keyCursor = keyIndex;
      return (await res.json()) as T;
    }

    const payload = await res.json().catch(() => null);
    const apiError = (payload as { error?: { message?: string; errors?: { reason?: string }[] } } | null)?.error;
    const reason = apiError?.errors?.[0]?.reason ?? "";
    lastError = new YouTubeApiError(
      apiError?.message ?? "YouTube API request failed.",
      res.status,
      reason
    );

    if (attempt < keys.length - 1 && isQuotaOrKeyError(res.status, reason)) continue;
    throw lastError;
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
 * search.list, type=channel — the one endpoint that finds channels by keyword rather than
 * requiring an already-known ID. Costs 100 quota units per call regardless of maxResults, so
 * callers should fetch one full page (up to 50) and filter it down rather than requesting a
 * small page and re-searching to top it up — see lib/youtube/discoveryEngine.ts.
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
    // A channel-type search hit carries its id at snippet.channelId, with id.channelId as a
    // fallback — the same shape lib/youtube/resolveInput.ts already relies on.
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
 * exactly that — the videos do. 100 quota units per call regardless of maxResults.
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
 * getRecentChannelVideoIds only ever returns the first page. 1 quota unit per page. */
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

