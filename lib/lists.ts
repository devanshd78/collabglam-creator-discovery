import "server-only";
import { prisma } from "./prisma";
import type { SessionUser } from "./auth";

/** Owners manage their own lists; admins can manage anyone's. */
export async function loadManageableList(id: string, user: SessionUser) {
  const list = await prisma.creatorList.findUnique({ where: { id }, select: { id: true, ownerId: true, name: true } });
  if (!list || (list.ownerId !== user.id && user.role !== "ADMIN")) return null;
  return list;
}
