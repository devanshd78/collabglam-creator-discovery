import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadManageableList } from "@/lib/lists";
import { BriefClosedError, requireBriefAcceptingEntries } from "@/lib/briefAvailability";
import { getAssignedYoutubeApiKey, withYoutubeApiKey, YoutubeApiKeyAssignmentError } from "@/lib/youtube/keys";
import { getChannelsDetailsBatch, youtubeGet, YouTubeApiError } from "@/lib/youtube/api";
import { normalizeChannel, type NormalizedChannel } from "@/lib/youtube/normalize";
import { recordUnitsUsed } from "@/lib/usage";
import { profileFromBrandBrief } from "@/lib/discovery/briefProfile";
import { enrichManualCreator, type ManualCreatorEnrichment } from "@/lib/discovery/manualCreatorEnrichment";

type Ctx = { params: Promise<{ id: string }> };

type ChannelLookup =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string };

function parseYoutubeChannel(value: string): ChannelLookup | null {
  const raw = value.trim();
  if (!raw) return null;

  if (/^UC[\w-]{22}$/.test(raw)) return { kind: "id", value: raw };
  if (/^@[A-Za-z0-9._-]{3,30}$/.test(raw)) return { kind: "handle", value: raw.slice(1) };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;

  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length === 0) return null;

  if (parts[0] === "channel" && /^UC[\w-]{22}$/.test(parts[1] ?? "")) {
    return { kind: "id", value: parts[1] };
  }
  if (parts[0].startsWith("@") && parts[0].length > 1) {
    return { kind: "handle", value: parts[0].slice(1) };
  }
  if (parts[0] === "user" && parts[1]) {
    return { kind: "username", value: parts[1] };
  }

  return null;
}

async function resolveChannel(input: ChannelLookup): Promise<NormalizedChannel | null> {
  if (input.kind === "id") {
    const rows = await getChannelsDetailsBatch([input.value]);
    return rows[0] ? normalizeChannel(rows[0]) : null;
  }

  const response = await youtubeGet<{ items?: Record<string, unknown>[] }>("channels", {
    part: "snippet,contentDetails,statistics,status,brandingSettings,topicDetails",
    ...(input.kind === "handle" ? { forHandle: input.value } : { forUsername: input.value }),
    maxResults: 1,
  });
  return response.items?.[0] ? normalizeChannel(response.items[0]) : null;
}

function cleanOptionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isP2002(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

/**
 * Manually add a known YouTube creator to a list.
 *
 * The creator is resolved through the official YouTube Data API so duplicate protection is based
 * on the stable channel ID, even when two people paste different URLs/handles for the same channel.
 * Campaign-linked lists are checked across the whole campaign before insert; the existing
 * team-wide Creator.channelId unique constraint remains the final concurrency guard.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { user, error } = await requireApiUser();
  if (error) return error;

  const list = await loadManageableList((await params).id, user);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    channel?: unknown;
    email?: unknown;
    mainContent?: unknown;
  };

  const channelInput = typeof body.channel === "string" ? body.channel.trim() : "";
  const lookup = parseYoutubeChannel(channelInput);
  if (!lookup) {
    return NextResponse.json(
      { error: "Paste a YouTube @handle, /channel/UC… URL, legacy /user/ URL, or channel ID." },
      { status: 400 }
    );
  }

  const email = cleanOptionalText(body.email, 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address or leave it blank." }, { status: 400 });
  }
  const mainContent = cleanOptionalText(body.mainContent, 500);

  if (list.briefId) {
    try {
      await requireBriefAcceptingEntries(list.briefId);
    } catch (err) {
      if (err instanceof BriefClosedError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }

  const campaignBrief = list.briefId
    ? await prisma.brandBrief.findUnique({
        where: { id: list.briefId },
        select: { brief: true, targetNiche: true, market: true, minSubscribers: true, maxSubscribers: true, targetCreators: true },
      })
    : null;
  const campaignProfile = campaignBrief ? profileFromBrandBrief(campaignBrief).profile : null;

  let assignedKey: { id: string; secret: string; label: string };
  try {
    assignedKey = await getAssignedYoutubeApiKey(user.id);
  } catch (err) {
    if (err instanceof YoutubeApiKeyAssignmentError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  // Resolve the stable channel ID first. Duplicate checks happen before the heavier upload analysis
  // so an already-saved creator costs only this one cheap channel lookup.
  let channel: NormalizedChannel | null = null;
  try {
    channel = await withYoutubeApiKey(assignedKey.secret, () => resolveChannel(lookup));
    await recordUnitsUsed(1).catch(() => undefined);
  } catch (err) {
    if (err instanceof YouTubeApiError) return NextResponse.json({ error: err.message }, { status: err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502 });
    throw err;
  }

  if (!channel?.channelId) {
    return NextResponse.json({ error: "That YouTube channel could not be found. Check the URL or handle and try again." }, { status: 404 });
  }

  const existing = await prisma.creator.findUnique({
    where: { channelId: channel.channelId },
    select: {
      id: true,
      briefId: true,
      title: true,
      source: true,
      email: true,
      emailSource: true,
      mainContent: true,
      list: { select: { id: true, name: true } },
      claimedBy: { select: { name: true } },
      brief: { select: { brandName: true } },
    },
  });

  // A manual row already in this exact list is refreshable; every other existing placement remains
  // a duplicate and is rejected before spending quota on recent-video analysis.
  const refreshingExistingManual = !!existing && existing.list.id === list.id && existing.source === "manual";
  if (existing && !refreshingExistingManual) {
    if (list.briefId && existing.briefId === list.briefId) {
      return NextResponse.json(
        {
          error: `${existing.title} is already in this campaign (${existing.list.name}, saved by ${existing.claimedBy.name}). No duplicate was added.`,
          duplicate: true,
          existingCreatorId: existing.id,
          existingListId: existing.list.id,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: `${existing.title} is already saved in ${existing.list.name}${existing.brief ? ` for ${existing.brief.brandName}` : ""}. The platform keeps YouTube channels unique team-wide, so no duplicate was added.`,
        duplicate: true,
        existingCreatorId: existing.id,
        existingListId: existing.list.id,
      },
      { status: 409 }
    );
  }

  let enrichment: ManualCreatorEnrichment;
  try {
    enrichment = await withYoutubeApiKey(assignedKey.secret, () => enrichManualCreator(channel!, campaignProfile));
    await recordUnitsUsed(enrichment.unitsUsed).catch(() => undefined);
  } catch (err) {
    if (err instanceof YouTubeApiError) return NextResponse.json({ error: err.message }, { status: err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502 });
    throw err;
  }

  // Re-pasting a creator that was manually added to this exact list refreshes its analytics
  // instead of creating a duplicate. This also upgrades manual rows created by older versions
  // of the app that only stored subscribers and left Avg views / Eng. / Content / Match blank.
  if (existing && refreshingExistingManual) {
    const refreshed = await prisma.creator.update({
      where: { id: existing.id },
      data: {
        title: channel.title || existing.title,
        channelUrl: channel.channelUrl || `https://www.youtube.com/channel/${channel.channelId}`,
        thumbnailUrl: channel.thumbnailUrl || null,
        country: channel.country || null,
        subscriberCount: channel.subscriberCount,
        averageViews: enrichment.averageViews,
        medianViews: enrichment.medianViews,
        engagementRate: enrichment.engagementRate,
        email: email ?? existing.email ?? enrichment.email ?? undefined,
        emailSource: email ? "Manual entry" : existing.email ? existing.emailSource : enrichment.email ? enrichment.emailSource : undefined,
        mainContent: mainContent ?? existing.mainContent ?? enrichment.mainContent,
        matchScore: enrichment.matchScore,
        tier: enrichment.tier,
        relevantVideos: enrichment.relevantVideos,
        analyzedVideos: enrichment.analyzedVideos,
        lastUploadAt: enrichment.lastUploadAt,
        platformLinks: { ...enrichment.platformLinks } as Record<string, string>,
        whyFit: enrichment.whyFit,
        concerns: enrichment.concerns,
        evidenceTitle: enrichment.evidenceTitle,
        evidenceUrl: enrichment.evidenceUrl,
      },
      select: { id: true, title: true, channelId: true },
    });
    await prisma.creatorList.update({ where: { id: list.id }, data: { updatedAt: new Date() } });
    return NextResponse.json({ creator: refreshed, refreshed: true });
  }

  try {
    const creator = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction for a clear campaign-wide duplicate response in the normal
      // case. The database unique constraint below still closes races between concurrent requests.
      if (list.briefId) {
        const duplicate = await tx.creator.findFirst({
          where: { briefId: list.briefId, channelId: channel!.channelId },
          select: { id: true, title: true, list: { select: { id: true, name: true } }, claimedBy: { select: { name: true } } },
        });
        if (duplicate) {
          throw new CampaignDuplicateError(duplicate.title, duplicate.list.name, duplicate.claimedBy.name, duplicate.id, duplicate.list.id);
        }
      }

      const created = await tx.creator.create({
        data: {
          channelId: channel!.channelId,
          title: channel!.title || lookup.value,
          channelUrl: channel!.channelUrl || `https://www.youtube.com/channel/${channel!.channelId}`,
          thumbnailUrl: channel!.thumbnailUrl || null,
          country: channel!.country || null,
          subscriberCount: channel!.subscriberCount,
          averageViews: enrichment!.averageViews,
          medianViews: enrichment!.medianViews,
          engagementRate: enrichment!.engagementRate,
          email: email ?? enrichment!.email,
          emailSource: email ? "Manual entry" : enrichment!.emailSource,
          otherEmails:
            email && enrichment!.email && email.toLowerCase() !== enrichment!.email.toLowerCase() ? [enrichment!.email] : [],
          mainContent: mainContent ?? enrichment!.mainContent,
          matchScore: enrichment!.matchScore,
          tier: enrichment!.tier,
          relevantVideos: enrichment!.relevantVideos,
          analyzedVideos: enrichment!.analyzedVideos,
          lastUploadAt: enrichment!.lastUploadAt,
          platformLinks: { ...enrichment!.platformLinks } as Record<string, string>,
          websiteLinks: [],
          foundVia: ["manual"],
          whyFit: enrichment!.whyFit,
          concerns: enrichment!.concerns,
          evidenceTitle: enrichment!.evidenceTitle,
          evidenceUrl: enrichment!.evidenceUrl,
          source: "manual",
          claimedById: list.ownerId,
          listId: list.id,
          briefId: list.briefId,
        },
        select: { id: true, title: true, channelId: true },
      });

      await tx.creatorList.update({ where: { id: list.id }, data: { updatedAt: new Date() } });
      // A manually added creator is now definitively saved, so any old discovery reservation for
      // that channel is stale and must not keep it in another member's pending assignment pool.
      await tx.discoveryAssignment.deleteMany({ where: { channelId: channel!.channelId } });
      return created;
    });

    return NextResponse.json({ creator }, { status: 201 });
  } catch (err) {
    if (err instanceof CampaignDuplicateError) {
      return NextResponse.json(
        {
          error: `${err.title} is already in this campaign (${err.listName}, saved by ${err.ownerName}). No duplicate was added.`,
          duplicate: true,
          existingCreatorId: err.creatorId,
          existingListId: err.listId,
        },
        { status: 409 }
      );
    }
    if (isP2002(err)) {
      return NextResponse.json({ error: "This YouTube creator was saved at the same time by another request. No duplicate was added.", duplicate: true }, { status: 409 });
    }
    throw err;
  }
}

class CampaignDuplicateError extends Error {
  constructor(
    readonly title: string,
    readonly listName: string,
    readonly ownerName: string,
    readonly creatorId: string,
    readonly listId: string
  ) {
    super("Campaign duplicate");
  }
}
