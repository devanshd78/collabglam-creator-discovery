/* eslint-disable @typescript-eslint/no-explicit-any -- raw YouTube API payloads are untyped JSON */

import "server-only";

import { toNumber } from "./numbers";
import { getBestThumbnail } from "./fields";
import { youtubeApiKeysForCurrentContext } from "./keys";

/**
 * YouTube Data API client.
 *
 * Every discovery request runs inside the logged-in
 * user's assigned API-key context.
 *
 * IMPORTANT:
 * There is NO API-key rotation or fallback.
 *
 * Example:
 *
 * Priyanshu -> Key 1
 *
 * If Key 1 reaches its quota:
 *
 * - request stops
 * - Key 2 is NOT used
 * - Key 3 is NOT used
 * - Key 4 is NOT used
 *
 * Priyanshu must wait for the assigned key's quota
 * to become available again.
 */

const YOUTUBE_BASE_URL =
  "https://www.googleapis.com/youtube/v3";

const PUBLIC_CHANNEL_PARTS = [
  "snippet",
  "contentDetails",
  "statistics",
  "status",
  "brandingSettings",
  "topicDetails",
  "localizations",
].join(",");

export class YouTubeApiError extends Error {
  readonly statusCode: number;
  readonly reason: string;

  constructor(
    message: string,
    statusCode: number,
    reason = ""
  ) {
    super(message);

    this.name = "YouTubeApiError";
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

function isDailyQuotaError(
  reason: string,
  message: string
): boolean {
  const text =
    `${reason} ${message}`.toLowerCase();

  return /quotaexceeded|dailylimitexceeded|daily limit|quota metric|quota limit/.test(
    text
  );
}

function isRateLimitError(
  reason: string,
  message: string
): boolean {
  const text =
    `${reason} ${message}`.toLowerCase();

  return /ratelimitexceeded|userratelimitexceeded|too many requests/.test(
    text
  );
}

function isInvalidKeyError(
  reason: string,
  message: string
): boolean {
  const text =
    `${reason} ${message}`.toLowerCase();

  return /keyinvalid|api key not valid|api key invalid|invalid api key/.test(
    text
  );
}

function isApiDisabledError(
  reason: string,
  message: string
): boolean {
  const text =
    `${reason} ${message}`.toLowerCase();

  return /accessnotconfigured|api has not been used|api is disabled|service disabled/.test(
    text
  );
}

type YouTubeListResponse = {
  items?: Record<string, unknown>[];
  nextPageToken?: string;
};

/**
 * Makes one YouTube request using EXACTLY ONE
 * assigned API key.
 */
export async function youtubeGet<
  T = YouTubeListResponse
>(
  endpoint: string,
  params: Record<
    string,
    string | number | undefined
  >
): Promise<T> {
  const keys =
    youtubeApiKeysForCurrentContext();

  /**
   * Strictly expect one key.
   */
  if (keys.length !== 1) {
    throw new YouTubeApiError(
      "No assigned YouTube API key is available for this request.",
      500
    );
  }

  const key = keys[0];

  const search =
    new URLSearchParams({
      key,
    });

  for (
    const [name, value]
    of Object.entries(params)
  ) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    search.set(
      name,
      String(value)
    );
  }

  let response: Response;

  try {
    response = await fetch(
      `${YOUTUBE_BASE_URL}/${endpoint}?${search.toString()}`,
      {
        signal:
          AbortSignal.timeout(
            Number(
              process.env
                .YOUTUBE_TIMEOUT_MS ??
                20000
            )
          ),

        cache: "no-store",
      }
    );
  } catch (err) {
    throw new YouTubeApiError(
      err instanceof Error
        ? err.message
        : "YouTube API request failed.",
      504
    );
  }

  if (response.ok) {
    return (await response.json()) as T;
  }

  const payload =
    await response
      .json()
      .catch(() => null);

  const apiError = (
    payload as {
      error?: {
        message?: string;

        errors?: Array<{
          reason?: string;
          message?: string;
        }>;
      };
    } | null
  )?.error;

  const reason =
    apiError?.errors?.[0]
      ?.reason ?? "";

  const message =
    apiError?.message ??
    apiError?.errors?.[0]
      ?.message ??
    "YouTube API request failed.";

  /**
   * Daily quota exhausted.
   *
   * DO NOT fall back to another team key.
   */
  if (
    isDailyQuotaError(
      reason,
      message
    )
  ) {
    throw new YouTubeApiError(
      "Your assigned YouTube API key has reached its quota. No other team member's API key will be used. Please wait until the quota renews and try again.",
      429,
      reason
    );
  }

  /**
   * Temporary rate limit.
   *
   * Still do NOT switch keys.
   */
  if (
    isRateLimitError(
      reason,
      message
    )
  ) {
    throw new YouTubeApiError(
      "Your assigned YouTube API key is temporarily rate-limited. No other API key will be used. Please wait and try again.",
      429,
      reason
    );
  }

  /**
   * Invalid key.
   */
  if (
    isInvalidKeyError(
      reason,
      message
    )
  ) {
    throw new YouTubeApiError(
      "Your assigned YouTube API key is invalid. Ask an admin to assign or configure another key for your account.",
      response.status,
      reason
    );
  }

  /**
   * API disabled for this key/project.
   */
  if (
    isApiDisabledError(
      reason,
      message
    )
  ) {
    throw new YouTubeApiError(
      "The YouTube Data API is not enabled for your assigned API key. Ask an admin to check the key configuration.",
      response.status,
      reason
    );
  }

  throw new YouTubeApiError(
    message,
    response.status,
    reason
  );
}

/**
 * Same batching trick as getVideosStats:
 * one call for up to 50 channels.
 */
export async function getChannelsDetailsBatch(
  channelIds: string[]
): Promise<Record<string, any>[]> {
  const ids = [
    ...new Set(
      channelIds.filter(Boolean)
    ),
  ].slice(0, 50);

  if (ids.length === 0) {
    return [];
  }

  const data =
    await youtubeGet("channels", {
      part: PUBLIC_CHANNEL_PARTS,
      id: ids.join(","),
    });

  return (
    data.items ?? []
  ) as Record<string, any>[];
}

export interface SearchChannelsOptions {
  /**
   * 1-50, YouTube's own per-page cap.
   */
  maxResults?: number;

  /**
   * ISO 3166-1 alpha-2.
   *
   * Example:
   * US
   * IN
   * CA
   */
  regionCode?: string;

  relevanceLanguage?: string;

  order?:
    | "relevance"
    | "viewCount"
    | "date";

  pageToken?: string;
}

export interface SearchChannelHit {
  channelId: string;
  title: string;
  thumbnailUrl: string;
}

/**
 * search.list type=channel.
 */
export async function searchChannels(
  query: string,
  opts: SearchChannelsOptions = {}
): Promise<{
  items: SearchChannelHit[];
  nextPageToken?: string;
}> {
  const data =
    await youtubeGet("search", {
      part: "snippet",

      q: query,

      type: "channel",

      maxResults: Math.min(
        Math.max(
          opts.maxResults ?? 25,
          1
        ),
        50
      ),

      regionCode:
        opts.regionCode,

      relevanceLanguage:
        opts.relevanceLanguage,

      order:
        opts.order,

      pageToken:
        opts.pageToken,
    });

  const items = (
    (data.items ?? []) as any[]
  )
    .map((hit) => ({
      channelId:
        hit.snippet?.channelId ??
        hit.id?.channelId ??
        "",

      title:
        hit.snippet?.title ??
        "",

      thumbnailUrl:
        getBestThumbnail(
          hit.snippet?.thumbnails
        ),
    }))
    .filter(
      (hit) =>
        Boolean(hit.channelId)
    );

  return {
    items,

    nextPageToken:
      data.nextPageToken,
  };
}

export interface VideoSearchHit {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: string | null;
}

export interface SearchVideosOptions {
  /**
   * 1-50.
   */
  maxResults?: number;

  regionCode?: string;

  relevanceLanguage?: string;

  order?:
    | "relevance"
    | "viewCount"
    | "date";

  pageToken?: string;
}

/**
 * YouTube search results can contain HTML
 * entities in titles.
 */
function decodeEntities(
  text: string
): string {
  return text
    .replace(
      /&#(\d+);/g,
      (_, code) =>
        String.fromCharCode(
          Number(code)
        )
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&apos;/g,
      "'"
    )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    )
    .replace(
      /&amp;/g,
      "&"
    );
}

/**
 * search.list type=video.
 */
export async function searchVideos(
  query: string,
  opts: SearchVideosOptions = {}
): Promise<{
  items: VideoSearchHit[];
  nextPageToken?: string;
}> {
  const data =
    await youtubeGet("search", {
      part: "snippet",

      q: query,

      type: "video",

      maxResults: Math.min(
        Math.max(
          opts.maxResults ?? 50,
          1
        ),
        50
      ),

      regionCode:
        opts.regionCode,

      relevanceLanguage:
        opts.relevanceLanguage,

      order:
        opts.order,

      pageToken:
        opts.pageToken,
    });

  const items = (
    (data.items ?? []) as any[]
  )
    .map((hit) => ({
      videoId:
        hit.id?.videoId ??
        "",

      channelId:
        hit.snippet
          ?.channelId ??
        "",

      channelTitle:
        decodeEntities(
          hit.snippet
            ?.channelTitle ??
            ""
        ),

      title:
        decodeEntities(
          hit.snippet
            ?.title ??
            ""
        ),

      publishedAt:
        hit.snippet
          ?.publishedAt ??
        null,
    }))
    .filter(
      (hit) =>
        Boolean(
          hit.videoId &&
            hit.channelId
        )
    );

  return {
    items,

    nextPageToken:
      (
        data as {
          nextPageToken?: string;
        }
      ).nextPageToken,
  };
}

/**
 * One page of a channel's uploads playlist.
 */
export async function getChannelUploadsPage(
  uploadPlaylistId: string,
  pageToken?: string,
  maxResults = 50
): Promise<{
  videoIds: string[];
  nextPageToken?: string;
}> {
  if (!uploadPlaylistId) {
    return {
      videoIds: [],
    };
  }

  const data =
    await youtubeGet(
      "playlistItems",
      {
        part: "contentDetails",

        playlistId:
          uploadPlaylistId,

        maxResults: Math.min(
          Math.max(
            maxResults,
            1
          ),
          50
        ),

        pageToken,
      }
    );

  const videoIds: string[] = (
    (data.items ?? []) as any[]
  )
    .map(
      (item) =>
        item.contentDetails
          ?.videoId
    )
    .filter(Boolean);

  return {
    videoIds,

    nextPageToken:
      (
        data as {
          nextPageToken?: string;
        }
      ).nextPageToken,
  };
}

export async function getRecentChannelVideoIds(
  uploadPlaylistId: string,
  limit = 12
): Promise<string[]> {
  if (!uploadPlaylistId) {
    return [];
  }

  const safeLimit =
    Math.min(
      Math.max(
        toNumber(
          limit,
          12
        ),
        1
      ),
      50
    );

  const data =
    await youtubeGet(
      "playlistItems",
      {
        part:
          "snippet,contentDetails,status",

        playlistId:
          uploadPlaylistId,

        maxResults:
          safeLimit,
      }
    );

  return (
    (data.items ?? []) as any[]
  )
    .map(
      (item) =>
        item.contentDetails
          ?.videoId ??
        item.snippet
          ?.resourceId
          ?.videoId
    )
    .filter(Boolean);
}

export async function getVideosStats(
  videoIds: string[]
): Promise<
  Record<string, any>[]
> {
  const ids = [
    ...new Set(
      videoIds.filter(Boolean)
    ),
  ].slice(0, 50);

  if (ids.length === 0) {
    return [];
  }

  const data =
    await youtubeGet(
      "videos",
      {
        part:
          "snippet,contentDetails,statistics,status,topicDetails",

        id:
          ids.join(","),
      }
    );

  return (
    data.items ?? []
  ) as Record<string, any>[];
}