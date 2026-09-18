import type { QualifiedCreator } from "./discovery/creatorQualifier";
import type { DiscoveredCreator } from "./youtube/discoveryEngine";

/**
 * One shape for a found creator, whichever Discover tab produced it. It's what a run stores, what
 * the results table renders, what a save copies into the Creator table, and what the CSV exports —
 * so the four can't drift apart.
 */
export interface StoredCreator {
  channelId: string;
  title: string;
  channelUrl: string;
  thumbnailUrl: string;
  country: string;
  subscriberCount: number;
  averageViews: number | null;
  medianViews: number | null;
  engagementRate: number | null;
  email: string | null;
  emailSource: string | null;
  emailSourceUrl: string | null;
  otherEmails: string[];
  platformLinks: Record<string, string>;
  websiteLinks: string[];
  mainContent: string;
  matchScore: number;
  /** A–D for campaign results; null for quick-search results, which aren't tiered. */
  tier: string | null;
  relevantVideos: number | null;
  analyzedVideos: number | null;
  lastUploadAt: string | null;
  whyFit: string[];
  concerns: string[];
  evidenceTitle: string | null;
  evidenceUrl: string | null;
  foundVia: string[];
}

export function fromQualified(c: QualifiedCreator): StoredCreator {
  return {
    channelId: c.channelId,
    title: c.title,
    channelUrl: c.channelUrl,
    thumbnailUrl: c.thumbnailUrl,
    country: c.country,
    subscriberCount: c.subscriberCount,
    averageViews: c.averageViews,
    medianViews: c.medianViews,
    engagementRate: c.engagementRate,
    email: c.email,
    emailSource: c.email ? c.emailSource : null,
    emailSourceUrl: c.emailSourceUrl,
    otherEmails: c.emailCandidates.filter((e) => e !== c.email),
    platformLinks: { ...c.platformLinks } as Record<string, string>,
    websiteLinks: c.websiteLinks,
    mainContent: c.mainContent,
    matchScore: c.score.total,
    tier: c.tier,
    relevantVideos: c.relevantVideoCount,
    analyzedVideos: c.analyzedVideoCount,
    lastUploadAt: c.lastUploadAt,
    whyFit: c.whyFit,
    concerns: c.concerns,
    evidenceTitle: c.evidence[0]?.title ?? null,
    evidenceUrl: c.evidence[0]?.url ?? null,
    foundVia: c.discoveredVia,
  };
}

export function fromDiscovered(c: DiscoveredCreator): StoredCreator {
  const whyFit: string[] = [];
  if (c.matchedTerms.length > 0) whyFit.push(`Content mentions ${c.matchedTerms.join(", ")}`);
  whyFit.push(`Quality ${c.qualityScore}/100 · brand safety ${c.brandSafetyLabel.toLowerCase()}`);
  if (c.sponsorshipFrequencyPercent > 0) whyFit.push(`${c.sponsorshipFrequencyPercent}% of recent uploads are sponsored`);
  if (c.uploadsLast90Days > 0) whyFit.push(`${c.uploadsLast90Days} uploads in the last 90 days`);
  return {
    channelId: c.channelId,
    title: c.title,
    channelUrl: c.channelUrl,
    thumbnailUrl: c.thumbnailUrl,
    country: c.country ? c.country.toUpperCase() : "",
    subscriberCount: c.subscriberCount,
    averageViews: c.averageViews,
    medianViews: c.medianViews,
    engagementRate: c.engagementRate,
    email: c.email,
    emailSource: c.email ? c.emailSource : null,
    emailSourceUrl: c.emailSourceUrl,
    otherEmails: c.otherEmails,
    platformLinks: { ...c.platformLinks } as Record<string, string>,
    websiteLinks: c.websiteLinks,
    mainContent: [c.category, c.sizeTier].filter(Boolean).join(" · "),
    matchScore: c.relevanceScore,
    tier: null,
    relevantVideos: null,
    analyzedVideos: null,
    lastUploadAt: c.lastUploadAt,
    whyFit,
    concerns: c.email ? [] : ["No public business email found"],
    evidenceTitle: null,
    evidenceUrl: null,
    foundVia: c.matchedTerms,
  };
}

/** Quoted, and a leading = + - @ neutralized so a channel title can't run as a spreadsheet formula. */
export function csvCell(value: string | number | null | undefined): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export interface CsvRow extends StoredCreator {
  savedBy?: string;
  savedAt?: string;
  brand?: string;
}

const COLUMNS: [string, (c: CsvRow) => string | number | null | undefined][] = [
  ["Creator", (c) => c.title],
  ["Channel URL", (c) => c.channelUrl],
  ["Email", (c) => c.email],
  ["Email source", (c) => c.emailSource],
  ["Email source URL", (c) => c.emailSourceUrl],
  ["Other emails seen", (c) => c.otherEmails.join(" | ")],
  ["Subscribers", (c) => c.subscriberCount],
  ["Average views", (c) => c.averageViews],
  ["Median views", (c) => c.medianViews],
  ["Engagement %", (c) => c.engagementRate],
  ["Country", (c) => c.country],
  ["Main content", (c) => c.mainContent],
  ["Match score", (c) => c.matchScore],
  ["Tier", (c) => c.tier],
  ["Relevant videos", (c) => c.relevantVideos],
  ["Analyzed videos", (c) => c.analyzedVideos],
  ["Last upload", (c) => c.lastUploadAt?.slice(0, 10)],
  ["Instagram", (c) => c.platformLinks.instagram],
  ["TikTok", (c) => c.platformLinks.tiktok],
  ["X / Twitter", (c) => c.platformLinks.twitter],
  ["Facebook", (c) => c.platformLinks.facebook],
  ["Pinterest", (c) => c.platformLinks.pinterest],
  ["Amazon storefront", (c) => c.platformLinks.amazonStorefront],
  ["Websites", (c) => c.websiteLinks.join(" | ")],
  ["Why they fit", (c) => c.whyFit.join(" | ")],
  ["Concerns", (c) => c.concerns.join(" | ")],
  ["Best evidence title", (c) => c.evidenceTitle],
  ["Best evidence URL", (c) => c.evidenceUrl],
  ["Found via", (c) => c.foundVia.join(" | ")],
  ["Brand", (c) => c.brand],
  ["Saved by", (c) => c.savedBy],
  ["Saved at", (c) => c.savedAt],
];

export function creatorsToCsv(rows: CsvRow[]): string {
  const lines = [COLUMNS.map(([h]) => csvCell(h)).join(","), ...rows.map((r) => COLUMNS.map(([, get]) => csvCell(get(r))).join(","))];
  // BOM so Excel opens non-English channel names correctly.
  return `﻿${lines.join("\r\n")}`;
}
