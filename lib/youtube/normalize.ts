/* eslint-disable @typescript-eslint/no-explicit-any -- raw YouTube API payloads are untyped JSON */
import {
  toNumber,
  percent,
  round,
  parseIsoDurationToSeconds,
  formatDurationFromSeconds,
  getAgeLabel,
  compactNumber,
} from "./numbers";
import { getBestThumbnail, getVideoCategoryName } from "./fields";

/**
 * Turns raw YouTube API payloads into the flat video and channel shapes the rest of the app reads.
 */

export interface NormalizedVideo {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: Date | null;
  thumbnails: Record<string, { url?: string }>;
  thumbnailUrl: string;
  tags: string[];
  categoryId: string;
  categoryName: string;
  defaultLanguage: string;
  defaultAudioLanguage: string;
  liveBroadcastContent: string;
  duration: string;
  durationSeconds: number;
  durationDisplay: string;
  definition: string;
  captionAvailable: boolean;
  licensedContent: boolean;
  privacyStatus: string;
  embeddable: boolean;
  madeForKids: boolean;
  hasPaidProductPlacement: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  engagementRate: number;
  likeRate: number;
  commentRate: number;
  topicDetails: Record<string, unknown>;
}

export function normalizeVideo(video: Record<string, any>): NormalizedVideo {
  const snippet = video.snippet ?? {};
  const statistics = video.statistics ?? {};
  const contentDetails = video.contentDetails ?? {};
  const status = video.status ?? {};

  const viewCount = toNumber(statistics.viewCount);
  const likeCount = toNumber(statistics.likeCount);
  const commentCount = toNumber(statistics.commentCount);
  const durationSeconds = parseIsoDurationToSeconds(contentDetails.duration);

  return {
    videoId: video.id,
    title: snippet.title ?? "",
    description: snippet.description ?? "",
    channelId: snippet.channelId ?? "",
    channelTitle: snippet.channelTitle ?? "",
    publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : null,
    thumbnails: snippet.thumbnails ?? {},
    thumbnailUrl: getBestThumbnail(snippet.thumbnails),
    tags: Array.isArray(snippet.tags) ? snippet.tags : [],
    categoryId: snippet.categoryId ?? "",
    categoryName: getVideoCategoryName(snippet.categoryId),
    defaultLanguage: snippet.defaultLanguage ?? "",
    defaultAudioLanguage: snippet.defaultAudioLanguage ?? "",
    liveBroadcastContent: snippet.liveBroadcastContent ?? "none",
    duration: contentDetails.duration ?? "",
    durationSeconds,
    durationDisplay: formatDurationFromSeconds(durationSeconds),
    definition: contentDetails.definition ?? "",
    captionAvailable: contentDetails.caption === "true",
    licensedContent: Boolean(contentDetails.licensedContent),
    privacyStatus: status.privacyStatus ?? "",
    embeddable: Boolean(status.embeddable),
    madeForKids: Boolean(status.madeForKids),
    hasPaidProductPlacement: Boolean(video.paidProductPlacementDetails?.hasPaidProductPlacement),
    viewCount,
    likeCount,
    commentCount,
    favoriteCount: toNumber(statistics.favoriteCount),
    engagementRate: percent(likeCount + commentCount, viewCount),
    likeRate: percent(likeCount, viewCount),
    commentRate: percent(commentCount, viewCount),
    topicDetails: video.topicDetails ?? {},
  };
}

export interface NormalizedChannel {
  channelId: string;
  title: string;
  description: string;
  customUrl: string;
  channelUrl: string;
  publishedAt: Date | null;
  channelAge: string;
  country: string;
  thumbnails: Record<string, { url?: string }>;
  thumbnailUrl: string;
  /** The channel's own cover/banner image (brandingSettings.image.bannerExternalUrl). Empty string if unset. */
  bannerUrl: string;
  subscriberCount: number;
  subscriberCountDisplay: string;
  hiddenSubscriberCount: boolean;
  totalViewCount: number;
  totalViewCountDisplay: string;
  videoCount: number;
  videoCountDisplay: string;
  uploadsPlaylistId: string;
  privacyStatus: string;
  madeForKids: boolean;
  topicDetails: Record<string, unknown>;
}

function buildChannelUrl(channel: Record<string, any>): string {
  const custom = channel.snippet?.customUrl;
  if (custom) {
    return custom.startsWith("@")
      ? `https://www.youtube.com/${custom}`
      : `https://www.youtube.com/c/${custom}`;
  }
  return channel.id ? `https://www.youtube.com/channel/${channel.id}` : "";
}

export function normalizeChannel(channel: Record<string, any>): NormalizedChannel {
  const snippet = channel.snippet ?? {};
  const statistics = channel.statistics ?? {};
  const brandingSettings = channel.brandingSettings ?? {};

  const subscriberCount = toNumber(statistics.subscriberCount);
  const totalViewCount = toNumber(statistics.viewCount);
  const videoCount = toNumber(statistics.videoCount);

  return {
    channelId: channel.id,
    title: snippet.title ?? "",
    description: snippet.description ?? "",
    customUrl: snippet.customUrl ?? "",
    channelUrl: buildChannelUrl(channel),
    publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : null,
    channelAge: getAgeLabel(snippet.publishedAt),
    country: snippet.country ?? brandingSettings.channel?.country ?? "",
    thumbnails: snippet.thumbnails ?? {},
    thumbnailUrl: getBestThumbnail(snippet.thumbnails),
    bannerUrl: brandingSettings.image?.bannerExternalUrl ?? "",
    subscriberCount,
    subscriberCountDisplay: compactNumber(subscriberCount),
    hiddenSubscriberCount: Boolean(statistics.hiddenSubscriberCount),
    totalViewCount,
    totalViewCountDisplay: compactNumber(totalViewCount),
    videoCount,
    videoCountDisplay: compactNumber(videoCount),
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? "",
    privacyStatus: channel.status?.privacyStatus ?? "",
    madeForKids: Boolean(channel.status?.madeForKids),
    topicDetails: channel.topicDetails ?? {},
  };
}

export interface CreatorAverage {
  sampleSize: number;
  averageViews: number;
  averageLikes: number;
  averageComments: number;
  averageEngagementRate: number;
  averageDurationSeconds: number;
  lastPublishedAt: Date | null;
}

/**
 * The creator's own baseline, used to judge whether a given video over- or under-performed for
 * them. The video being analysed is excluded so it isn't compared against itself, and videos with
 * no views are dropped so a just-published upload can't drag the average to nothing.
 */
export function calculateCreatorAverage(
  videos: Record<string, any>[],
  currentVideoId: string
): CreatorAverage {
  const usable = videos
    .filter((video) => video.id !== currentVideoId)
    .map(normalizeVideo)
    .filter((video) => video.viewCount > 0);

  if (usable.length === 0) {
    return {
      sampleSize: 0,
      averageViews: 0,
      averageLikes: 0,
      averageComments: 0,
      averageEngagementRate: 0,
      averageDurationSeconds: 0,
      lastPublishedAt: null,
    };
  }

  const totals = usable.reduce(
    (acc, video) => {
      acc.views += video.viewCount;
      acc.likes += video.likeCount;
      acc.comments += video.commentCount;
      acc.engagementRate += video.engagementRate;
      acc.durationSeconds += video.durationSeconds;
      return acc;
    },
    { views: 0, likes: 0, comments: 0, engagementRate: 0, durationSeconds: 0 }
  );

  const mostRecent = usable
    .filter((v) => v.publishedAt)
    .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())[0];

  return {
    sampleSize: usable.length,
    averageViews: Math.round(totals.views / usable.length),
    averageLikes: Math.round(totals.likes / usable.length),
    averageComments: Math.round(totals.comments / usable.length),
    averageEngagementRate: round(totals.engagementRate / usable.length),
    averageDurationSeconds: Math.round(totals.durationSeconds / usable.length),
    lastPublishedAt: mostRecent?.publishedAt ?? null,
  };
}
