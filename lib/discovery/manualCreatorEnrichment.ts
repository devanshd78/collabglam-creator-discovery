import "server-only";

import { getChannelUploadsPage, getVideosStats } from "@/lib/youtube/api";
import { estimateAudienceDemographics } from "@/lib/youtube/audienceEstimation";
import { extractChannelContact, type ExtractedPlatformLinks } from "@/lib/youtube/channelExtractor";
import { median } from "@/lib/youtube/creatorSignals";
import { normalizeVideo, type NormalizedChannel, type NormalizedVideo } from "@/lib/youtube/normalize";
import type { CampaignProfile } from "./campaignProfile";
import { qualifyCreator } from "./creatorQualifier";
import {
  buildRelevanceContext,
  classifyContentType,
  classifyVideo,
  type ClassifiedVideo,
  type ContentType,
} from "./videoClassifier";

const FORMAT_CATEGORIES = new Set(["review", "unboxing", "tutorial", "podcast", "vlogging"]);
const DEEPER_PAGE_THRESHOLD = 3;

export interface ManualCreatorEnrichment {
  unitsUsed: number;
  averageViews: number | null;
  medianViews: number | null;
  engagementRate: number | null;
  mainContent: string | null;
  matchScore: number | null;
  tier: string | null;
  relevantVideos: number | null;
  analyzedVideos: number | null;
  lastUploadAt: Date | null;
  whyFit: string[];
  concerns: string[];
  evidenceTitle: string | null;
  evidenceUrl: string | null;
  email: string | null;
  emailSource: string | null;
  platformLinks: ExtractedPlatformLinks;
}

function resolvedCategory(channel: NormalizedChannel, videos: NormalizedVideo[]): string {
  const category = estimateAudienceDemographics({
    tags: videos.flatMap((video) => video.tags),
    topics: videos.map((video) => video.categoryName).filter(Boolean),
    contentText: [channel.description, ...videos.slice(0, 15).map((video) => video.title)].join(" "),
  }).categoryLabel;

  return FORMAT_CATEGORIES.has(category) ? "" : category;
}

function genericMainContent(videos: NormalizedVideo[], category: string): string | null {
  const counts = new Map<ContentType, number>();
  for (const video of videos) {
    const type = classifyContentType(video.title, video.tags);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const specific = ranked.filter(([type]) => type !== "General Content");
  const lead = (specific.length > 0 ? specific : ranked)
    .slice(0, 2)
    .map(([type]) => type)
    .join(" & ");

  return [lead, category].filter(Boolean).join(" · ") || null;
}

function genericPerformance(videos: NormalizedVideo[]): Pick<ManualCreatorEnrichment, "averageViews" | "medianViews" | "engagementRate" | "lastUploadAt"> {
  const withViews = videos.filter((video) => video.viewCount > 0);
  const lastUpload = videos
    .filter((video) => video.publishedAt)
    .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())[0]?.publishedAt ?? null;

  if (withViews.length === 0) {
    return { averageViews: null, medianViews: null, engagementRate: null, lastUploadAt: lastUpload };
  }

  const totalViews = withViews.reduce((sum, video) => sum + video.viewCount, 0);
  const totalInteractions = withViews.reduce((sum, video) => sum + video.likeCount + video.commentCount, 0);

  return {
    averageViews: Math.round(totalViews / withViews.length),
    medianViews: median(withViews.map((video) => video.viewCount)),
    engagementRate: Math.round((totalInteractions / totalViews) * 10_000) / 100,
    lastUploadAt: lastUpload,
  };
}

/**
 * Enrich a manually supplied channel with the same recent-upload analysis used by campaign
 * discovery. A known channel does not need an expensive search.list call: one playlist page plus
 * one videos.list call normally provides Avg views, engagement and content; a second page is read
 * only when the campaign-match evidence is still sparse.
 */
export async function enrichManualCreator(channel: NormalizedChannel, profile: CampaignProfile | null): Promise<ManualCreatorEnrichment> {
  const contact = extractChannelContact(channel.description);
  const empty: ManualCreatorEnrichment = {
    unitsUsed: 0,
    averageViews: null,
    medianViews: null,
    engagementRate: null,
    mainContent: null,
    matchScore: null,
    tier: null,
    relevantVideos: null,
    analyzedVideos: null,
    lastUploadAt: null,
    whyFit: [],
    concerns: [],
    evidenceTitle: null,
    evidenceUrl: null,
    email: contact.email,
    emailSource: contact.email ? "Channel description" : null,
    platformLinks: contact.platformLinks,
  };

  if (!channel.uploadsPlaylistId || channel.videoCount <= 0) {
    return {
      ...empty,
      mainContent: resolvedCategory(channel, []) || null,
      concerns: ["No public uploads available to calculate creator performance"],
    };
  }

  let unitsUsed = 0;
  const firstPage = await getChannelUploadsPage(channel.uploadsPlaylistId);
  unitsUsed += 1;
  if (firstPage.videoIds.length === 0) {
    return { ...empty, unitsUsed, concerns: ["No public uploads available to calculate creator performance"] };
  }

  const firstRaw = await getVideosStats(firstPage.videoIds);
  unitsUsed += 1;
  const recentVideos = firstRaw.map(normalizeVideo).filter((video) => video.videoId);
  if (recentVideos.length === 0) {
    return { ...empty, unitsUsed, concerns: ["Recent uploads could not be read from YouTube"] };
  }

  const category = resolvedCategory(channel, recentVideos);

  if (!profile) {
    const performance = genericPerformance(recentVideos);
    return {
      ...empty,
      ...performance,
      unitsUsed,
      mainContent: genericMainContent(recentVideos, category),
      analyzedVideos: recentVideos.length,
    };
  }

  const ctx = buildRelevanceContext(profile);
  const classified: ClassifiedVideo[] = recentVideos.map((video) =>
    classifyVideo(video, ctx, { isHistorical: false, discoveredVia: ["manual"] })
  );

  const strongOnFirstPage = classified.filter((video) => video.productRelevance >= 3).length;
  if (strongOnFirstPage < DEEPER_PAGE_THRESHOLD && firstPage.nextPageToken && channel.videoCount > recentVideos.length) {
    const secondPage = await getChannelUploadsPage(channel.uploadsPlaylistId, firstPage.nextPageToken);
    unitsUsed += 1;
    if (secondPage.videoIds.length > 0) {
      const secondRaw = await getVideosStats(secondPage.videoIds);
      unitsUsed += 1;
      const seen = new Set(recentVideos.map((video) => video.videoId));
      for (const raw of secondRaw) {
        const video = normalizeVideo(raw);
        if (!video.videoId || seen.has(video.videoId)) continue;
        classified.push(classifyVideo(video, ctx, { isHistorical: true, discoveredVia: ["manual"] }));
      }
    }
  }

  const qualified = qualifyCreator({
    channel,
    videos: classified,
    profile,
    discoveredVia: ["manual"],
    resolvedCategory: category,
  });

  return {
    unitsUsed,
    averageViews: qualified.averageViews,
    medianViews: qualified.medianViews,
    engagementRate: qualified.engagementRate,
    mainContent: qualified.mainContent || null,
    matchScore: qualified.score.total,
    tier: qualified.tier,
    relevantVideos: qualified.relevantVideoCount,
    analyzedVideos: qualified.analyzedVideoCount,
    lastUploadAt: qualified.lastUploadAt ? new Date(qualified.lastUploadAt) : null,
    whyFit: qualified.whyFit,
    concerns: qualified.concerns,
    evidenceTitle: qualified.evidence[0]?.title ?? null,
    evidenceUrl: qualified.evidence[0]?.url ?? null,
    email: qualified.email,
    emailSource: qualified.email ? qualified.emailSource : null,
    platformLinks: qualified.platformLinks,
  };
}
