import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import { prisma } from "../prisma";

interface InternalKeyEntry {
  id: string;
  index: number;
  label: string;
  secret: string;
}

export interface YoutubeApiKeyOption {
  id: string;
  index: number;
  label: string;
}

const requestKey = new AsyncLocalStorage<string>();

function fingerprint(secret: string): string {
  return `yt_${createHash("sha256")
    .update(secret)
    .digest("hex")
    .slice(0, 24)}`;
}

function splitConfiguredValue(
  value: string | undefined
): string[] {
  if (!value) return [];

  return value
    .split(/[\n,;]+/)
    .map((item) =>
      item
        .trim()
        .replace(/^["']+|["']+$/g, "")
    )
    .filter(Boolean);
}

/**
 * Supports:
 *
 * YOUTUBE_API_KEY_1=...
 * YOUTUBE_API_KEY_2=...
 *
 * and:
 *
 * YOUTUBE_API_KEY1=...
 * YOUTUBE_API_KEY2=...
 */
function getNumberedEnvironmentVariables(): Array<{
  name: string;
  index: number;
}> {
  return Object.keys(process.env)
    .map((name) => {
      const match =
        /^YOUTUBE_API_KEY_?(\d+)$/i.exec(name);

      if (!match) {
        return null;
      }

      return {
        name,
        index: Number(match[1]),
      };
    })
    .filter(
      (
        item
      ): item is {
        name: string;
        index: number;
      } =>
        item !== null &&
        Number.isInteger(item.index) &&
        item.index > 0
    )
    .sort(
      (a, b) =>
        a.index - b.index ||
        a.name.localeCompare(b.name)
    );
}

/**
 * Loads every configured YouTube API key.
 *
 * Supported formats:
 *
 * 1)
 * YOUTUBE_API_KEY=key1,key2,key3
 *
 * 2)
 * YOUTUBE_API_KEYS=key1,key2,key3
 *
 * 3)
 * YOUTUBE_API_KEY_1=key1
 * YOUTUBE_API_KEY_2=key2
 * YOUTUBE_API_KEY_3=key3
 *
 * 4)
 * YOUTUBE_API_KEY1=key1
 * YOUTUBE_API_KEY2=key2
 */
function configuredEntries(): InternalKeyEntry[] {
  const numberedVariables =
    getNumberedEnvironmentVariables();

  const reservedIndexes =
    new Set(
      numberedVariables.map(
        (item) => item.index
      )
    );

  const byIndex =
    new Map<number, string>();

  const seenSecrets =
    new Set<string>();

  const pooledSecrets: string[] = [];

  /*
   * First load explicitly numbered keys.
   *
   * This makes:
   *
   * YOUTUBE_API_KEY_7
   *
   * appear as:
   *
   * Key 7
   */
  for (const variable of numberedVariables) {
    const values =
      splitConfiguredValue(
        process.env[variable.name]
      );

    if (values.length === 0) {
      continue;
    }

    const first = values[0];

    if (!seenSecrets.has(first)) {
      byIndex.set(
        variable.index,
        first
      );

      seenSecrets.add(first);
    }

    /*
     * Normally numbered variables should contain
     * only one key.
     *
     * If somebody adds multiple values accidentally,
     * still preserve them instead of dropping them.
     */
    for (const extra of values.slice(1)) {
      pooledSecrets.push(extra);
    }
  }

  /*
   * Then support the comma-separated variables.
   */
  pooledSecrets.push(
    ...splitConfiguredValue(
      process.env.YOUTUBE_API_KEY
    )
  );

  pooledSecrets.push(
    ...splitConfiguredValue(
      process.env.YOUTUBE_API_KEYS
    )
  );

  let nextIndex = 1;

  for (const secret of pooledSecrets) {
    if (seenSecrets.has(secret)) {
      continue;
    }

    while (
      reservedIndexes.has(nextIndex) ||
      byIndex.has(nextIndex)
    ) {
      nextIndex += 1;
    }

    byIndex.set(
      nextIndex,
      secret
    );

    seenSecrets.add(secret);

    nextIndex += 1;
  }

  return [...byIndex.entries()]
    .sort(
      ([a], [b]) => a - b
    )
    .map(
      ([index, secret]) => ({
        id: fingerprint(secret),

        index,

        /*
         * IMPORTANT:
         *
         * Never return any part of the actual key
         * to the browser.
         */
        label: `Key ${index}`,

        secret,
      })
    );
}

/**
 * Safe catalog for Admin UI.
 *
 * Browser receives only:
 *
 * Key 1
 * Key 2
 * Key 3
 *
 * It never receives API-key values.
 */
export function getYoutubeApiKeyCatalog(): YoutubeApiKeyOption[] {
  return configuredEntries().map(
    ({
      id,
      index,
      label,
    }) => ({
      id,
      index,
      label,
    })
  );
}

export function getConfiguredYoutubeApiKeyCount(): number {
  return configuredEntries().length;
}

export function resolveYoutubeApiKey(
  id: string | null | undefined
): string | null {
  if (!id) {
    return null;
  }

  return (
    configuredEntries().find(
      (entry) =>
        entry.id === id
    )?.secret ?? null
  );
}

/**
 * STRICT USER KEY ISOLATION
 *
 * A request gets exactly one assigned key.
 *
 * Never automatically use another team member's
 * key when quota is exhausted.
 */
export function youtubeApiKeysForCurrentContext(): string[] {
  const assigned =
    requestKey.getStore();

  if (!assigned) {
    return [];
  }

  return [assigned];
}

export function withYoutubeApiKey<T>(
  secret: string,
  work: () => T
): T {
  return requestKey.run(
    secret,
    work
  );
}

export class YoutubeApiKeyAssignmentError extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message);

    this.name =
      "YoutubeApiKeyAssignmentError";
  }
}

/**
 * Resolve the API key allocated to one user.
 */
export async function getAssignedYoutubeApiKey(
  userId: string
): Promise<{
  id: string;
  secret: string;
  label: string;
}> {
  const user =
    await prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        youtubeApiKeyId: true,
      },
    });

  if (!user?.youtubeApiKeyId) {
    throw new YoutubeApiKeyAssignmentError(
      "No YouTube API key is assigned to your account. Ask an admin to assign one."
    );
  }

  const entry =
    configuredEntries().find(
      (key) =>
        key.id ===
        user.youtubeApiKeyId
    );

  if (!entry) {
    throw new YoutubeApiKeyAssignmentError(
      "Your assigned YouTube API key is no longer configured on the server. Ask an admin to reassign it."
    );
  }

  return {
    id: entry.id,
    secret: entry.secret,
    label: entry.label,
  };
}

export async function hasUsableAssignedYoutubeApiKey(
  userId: string
): Promise<boolean> {
  const user =
    await prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        youtubeApiKeyId: true,
      },
    });

  return Boolean(
    user?.youtubeApiKeyId &&
      resolveYoutubeApiKey(
        user.youtubeApiKeyId
      )
  );
}