import type { CampaignRunResult } from "./discovery/campaignDiscovery";
import type { EvidenceVideo, ScoreBreakdown } from "./discovery/creatorQualifier";
import type { StoredCreator } from "./creatorRecord";

export interface CampaignDetail {
  score: ScoreBreakdown;
  evidence: EvidenceVideo[];
  commercialEvidence: string[];
  rejectionReasons: string[];
  marketEvidence: string;
  productTypesReviewed: string[];
  relatedVideoCount: number;
  viewToSubscriberRate: number | null;
  emailPagesChecked: number;
}

export interface CampaignRunResponse {
  runId: string;
  creators: StoredCreator[];
  details: Record<string, CampaignDetail>;
  tierCounts: CampaignRunResult["tierCounts"];
  stats: CampaignRunResult["stats"];
}

export interface SearchRunResponse {
  runId: string;
  creators: StoredCreator[];
  candidateCount: number;
  hiddenAsClaimed: number;
  searchedPhrases: string[];
  unitsUsed: number;
}

export interface BriefOption {
  id: string;
  brandName: string;
  title: string;
  brief: string;
  targetNiche: string;
  briefDate: string;
  market: string | null;
  minSubscribers: number | null;
  maxSubscribers: number | null;
}

/** Reads an NDJSON stream, handing each event to `onEvent`; resolves with the `result` payload. */
export async function readNdjson<T>(res: Response, onEvent: (event: { type: string } & Record<string, unknown>) => void): Promise<T> {
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "The request failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      const event = JSON.parse(line) as { type: string } & Record<string, unknown>;
      if (event.type === "result") result = event.result as T;
      else if (event.type === "error") throw new Error(String(event.message ?? "Discovery failed"));
      else onEvent(event);
    }
  }
  if (result === undefined) throw new Error("The connection closed before results arrived — try again");
  return result;
}
