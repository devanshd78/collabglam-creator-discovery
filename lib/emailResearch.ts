import { findCreatorEmail, recurringFooterText, type EmailSearchResult } from "./creatorEmailFinder";
import { fetchAboutLinks } from "./youtube/aboutLinks";

export interface ResearchTarget {
  channelId: string;
  title: string;
  channelUrl: string;
  description: string;
  /** Descriptions of the creator's recent uploads, for their repeated footer. */
  videoDescriptions: string[];
}

export interface ResearchOutcome extends EmailSearchResult {
  /** Where the winning email came from, including the plain description case. */
  resolvedSource: string | null;
}

const CONCURRENCY = 6;
const TOTAL_DEADLINE_MS = 180_000;
const PER_CREATOR_MS = 20_000;

export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * The deep-research step shared by both Discover tabs: for each creator, the channel description,
 * About-panel links, the footer they repeat across videos, their link-in-bio page and their own
 * website (plus its contact/about pages) are read for a business email. One creator failing never
 * loses the others; the whole step has a time budget so a run can't hang on slow sites.
 */
export async function researchEmails(
  targets: ResearchTarget[],
  onProgress: (researched: number, found: number) => void
): Promise<Map<string, ResearchOutcome>> {
  const started = Date.now();
  const out = new Map<string, ResearchOutcome>();
  let researched = 0;
  let found = 0;

  await mapWithConcurrency(targets, CONCURRENCY, async (t) => {
    try {
      const remaining = TOTAL_DEADLINE_MS - (Date.now() - started);
      if (remaining < 2_000) return;
      const aboutLinks = await fetchAboutLinks(t.channelId);
      const result = await findCreatorEmail(
        {
          description: t.description,
          channelTitle: t.title,
          channelUrl: t.channelUrl,
          aboutLinks: aboutLinks.map((l) => l.url),
          videoFooter: recurringFooterText(t.videoDescriptions.slice(0, 30)),
        },
        { deadlineMs: Math.min(PER_CREATOR_MS, remaining) }
      );
      out.set(t.channelId, { ...result, resolvedSource: result.source });
      if (result.email) found++;
    } catch (err) {
      console.error(`[Email research] ${t.channelId} failed:`, err);
    } finally {
      researched++;
      onProgress(researched, found);
    }
  });
  return out;
}
