import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { userFromExtensionToken } from "./extensionTokens";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
}

/** The signed-in, still-active user, or null. The cookie only proves who signed in — the database
 * decides whether that account still exists and is allowed in, so deactivating someone takes
 * effect on their very next request. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySessionToken(token) : null;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/** For pages: sends anyone not signed in (or not an admin, when asked) elsewhere. */
export async function requirePageUser(opts: { admin?: boolean } = {}): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (opts.admin && user.role !== "ADMIN") redirect("/");
  return user;
}

type ApiAuth = { user: SessionUser; error?: undefined } | { user?: undefined; error: NextResponse };

/** For route handlers: `const { user, error } = await requireApiUser(); if (error) return error;`
 * `allowExtension` also accepts the Chrome extension's bearer key (routes under /api/ext only). */
export async function requireApiUser(opts: { admin?: boolean; allowExtension?: boolean } = {}): Promise<ApiAuth> {
  const user =
    (opts.allowExtension ? await userFromExtensionToken((await headers()).get("authorization")) : null) ?? (await getCurrentUser());
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (opts.admin && user.role !== "ADMIN") return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  return { user };
}
