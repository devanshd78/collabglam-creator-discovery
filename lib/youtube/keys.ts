import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";

interface InternalKeyEntry {
  id: string;
  index: number;
  label: string;
  maskedKey: string;
  secret: string;
}

export interface YoutubeApiKeyOption {
  id: string;
  index: number;
  label: string;
  maskedKey: string;
}

const requestKey = new AsyncLocalStorage<string>();

function fingerprint(secret: string): string {
  return `yt_${createHash("sha256").update(secret).digest("hex").slice(0, 24)}`;
}

function mask(secret: string): string {
  if (secret.length <= 10) return `${secret.slice(0, 2)}…${secret.slice(-2)}`;
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

function configuredEntries(): InternalKeyEntry[] {
  const raw = String(process.env.YOUTUBE_API_KEY ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const entries: InternalKeyEntry[] = [];
  for (const secret of raw) {
    if (seen.has(secret)) continue;
    seen.add(secret);
    const index = entries.length + 1;
    const maskedKey = mask(secret);
    entries.push({ id: fingerprint(secret), index, maskedKey, label: `Key ${index} · ${maskedKey}`, secret });
  }
  return entries;
}

export function getYoutubeApiKeyCatalog(): YoutubeApiKeyOption[] {
  return configuredEntries().map(({ id, index, label, maskedKey }) => ({ id, index, label, maskedKey }));
}

export function resolveYoutubeApiKey(id: string | null | undefined): string | null {
  if (!id) return null;
  return configuredEntries().find((entry) => entry.id === id)?.secret ?? null;
}

export function youtubeApiKeysForCurrentContext(): string[] {
  const assigned = requestKey.getStore();
  if (assigned) return [assigned];
  return configuredEntries().map((entry) => entry.secret);
}

export function withYoutubeApiKey<T>(secret: string, work: () => T): T {
  return requestKey.run(secret, work);
}

export class YoutubeApiKeyAssignmentError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function getAssignedYoutubeApiKey(userId: string): Promise<{ id: string; secret: string; label: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { youtubeApiKeyId: true } });
  if (!user?.youtubeApiKeyId) {
    throw new YoutubeApiKeyAssignmentError("No YouTube API key is assigned to your account. Ask an admin to assign one.");
  }
  const entry = configuredEntries().find((key) => key.id === user.youtubeApiKeyId);
  if (!entry) {
    throw new YoutubeApiKeyAssignmentError("Your assigned YouTube API key is no longer configured on the server. Ask an admin to reassign it.");
  }
  return { id: entry.id, secret: entry.secret, label: entry.label };
}

export async function hasUsableAssignedYoutubeApiKey(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { youtubeApiKeyId: true } });
  return Boolean(user?.youtubeApiKeyId && resolveYoutubeApiKey(user.youtubeApiKeyId));
}
