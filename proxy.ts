import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// /api/ext is called by the Chrome extension with a bearer key instead of a cookie; each route
// checks that key itself (requireApiUser with allowExtension).
const PUBLIC_PATHS = ["/login", "/setup", "/api/setup", "/api/auth/login", "/api/ext", "/api/health", "/api/ready"];

/**
 * Optimistic gate: anyone without a valid signed cookie is sent to /login. Whether the account is
 * still active, and whether it's an admin, is checked against the database in each page and route
 * (lib/auth.ts) — this only keeps signed-out visitors away from the app shell.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySessionToken(token) : null;
  if (userId) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const loginUrl = new URL("/login", req.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
