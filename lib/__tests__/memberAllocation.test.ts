import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: {
  findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
} } }));
vi.mock("@/lib/auth", () => ({ requireApiUser: vi.fn(async () => ({ user: { id: "admin" } })) }));
vi.mock("@/lib/session", () => ({ SESSION_COOKIE: "session", createSessionToken: vi.fn(async () => "signed-session") }));

import { prisma } from "@/lib/prisma";
import { getYoutubeApiKeyCatalog } from "@/lib/youtube/keys";
import { POST as createMember } from "@/app/api/admin/users/route";
import { POST as login } from "@/app/api/auth/login/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("YOUTUBE_API_KEY", Array.from({ length: 10 }, (_, i) => `test-secret-${i}`).join(","));
});
afterEach(() => vi.unstubAllEnvs());

const request = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});

it("lists the full pool without secrets and creates a member who can log in with the admin's credentials", async () => {
  const keys = getYoutubeApiKeyCatalog();
  expect(keys).toHaveLength(10);
  expect(JSON.stringify(keys)).not.toContain("test-secret");
  vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: "member", name: "Member", email: "member@example.com", youtubeApiKeyId: keys[1].id } as never);
  const credentials = { email: "member@example.com", password: "temporary-password" };
  const response = await createMember(request("/api/admin/users", {
    name: "Member", ...credentials, youtubeApiKeyId: keys[1].id,
  }));
  expect(response.status).toBe(201);
  const saved = vi.mocked(prisma.user.create).mock.calls[0][0].data;
  expect(saved.youtubeApiKeyId).toBe(keys[1].id);
  expect(saved.passwordHash).not.toBe(credentials.password);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "member", ...saved, active: true } as never);
  const loggedIn = await login(request("/api/auth/login", credentials));
  expect(loggedIn.status).toBe(200);
  expect(loggedIn.cookies.get("session")?.value).toBe("signed-session");
});

it("rejects a key already allocated to the admin", async () => {
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "admin", name: "Admin" } as never);
  const response = await createMember(request("/api/admin/users", {
    name: "Member", email: "member@example.com", password: "temporary-password",
    youtubeApiKeyId: getYoutubeApiKeyCatalog()[0].id,
  }));
  expect(response.status).toBe(409);
  expect(prisma.user.create).not.toHaveBeenCalled();
});
