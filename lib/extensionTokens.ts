import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

const PREFIX = "cgx_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new extension key. The plain key is returned once; only its hash is kept. */
export async function createExtensionToken(userId: string, label: string): Promise<string> {
  const token = `${PREFIX}${randomBytes(24).toString("base64url")}`;
  await prisma.extensionToken.create({ data: { userId, label: label.slice(0, 80) || "Chrome extension", tokenHash: hashToken(token) } });
  return token;
}

/** The active user behind an `Authorization: Bearer cgx_…` header, or null. */
export async function userFromExtensionToken(header: string | null) {
  const token = header?.match(/^Bearer\s+(cgx_[\w-]{20,})$/)?.[1];
  if (!token) return null;
  const row = await prisma.extensionToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, lastUsedAt: true, user: { select: { id: true, name: true, email: true, role: true, active: true } } },
  });
  if (!row || !row.user.active) return null;
  // Touch at most once a minute — this is called on every extension request.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.extensionToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return { id: row.user.id, name: row.user.name, email: row.user.email, role: row.user.role };
}
