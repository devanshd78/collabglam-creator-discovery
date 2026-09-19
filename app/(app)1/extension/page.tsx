import { headers } from "next/headers";
import { Download } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revealsToday } from "@/lib/reveals";
import { PageHeader, StatCard } from "../../components/ui";
import ExtensionKeys from "./ExtensionKeys";

export default async function ExtensionPage() {
  const user = await requirePageUser();
  const h = await headers();
  const appUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const [keys, today, waiting] = await Promise.all([
    prisma.extensionToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    }),
    revealsToday(user.id),
    prisma.creator.count({ where: { list: { ownerId: user.id }, email: null, noPublicEmail: false } }),
  ]);
  const revealedToday = Object.values(today).reduce((s, t) => s + t.revealed, 0);

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="Email reveal extension"
        subtitle="For creators whose email is behind YouTube's “View email address” check: you complete the check, the extension saves the email to your list."
        actions={
          <a href="/api/ext/download" className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm">
            <Download size={15} /> Download extension
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Your creators still needing an email" value={waiting} />
        <StatCard label="Revealed by you today" value={revealedToday} hint={`across ${Object.keys(today).length || 0} Google accounts`} />
      </div>

      <div className="card p-5 space-y-3 text-[13px] text-[var(--ink)]">
        <h2 className="text-sm font-semibold">Set up (once, about 2 minutes)</h2>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>
            Download the extension above, right-click the zip → <b>Extract All</b>. Keep the folder somewhere permanent (not a temp folder) —
            the browser loads it from there.
          </li>
          <li>
            Open <code className="px-1 rounded bg-[var(--bg)]">chrome://extensions</code> (Edge:{" "}
            <code className="px-1 rounded bg-[var(--bg)]">edge://extensions</code>), switch on <b>Developer mode</b>, click <b>Load unpacked</b>{" "}
            and choose the extracted <b>collabglam-email-reveal</b> folder — the one that directly contains <b>manifest.json</b>.
          </li>
          <li>Pin it (puzzle-piece icon → pin), then click it — the CollabGlam panel opens beside the page.</li>
          <li>
            Create a key below and paste it into the panel with this address: <code className="px-1 rounded bg-[var(--bg)]">{appUrl}</code>
          </li>
          <li>
            Sign in to YouTube. To reveal more per day, add more Google accounts in the same browser (YouTube avatar → <b>Switch account</b> →{" "}
            <b>Add account</b>) and set “Google accounts signed in” in the panel.
          </li>
        </ol>
        <h2 className="text-sm font-semibold pt-2">Daily use</h2>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Save creators to your lists as usual, then open the panel and press <b>Start revealing</b>.</li>
          <li>
            The tab opens the first creator&apos;s About panel with “View email address” highlighted. Click it and complete YouTube&apos;s check.
          </li>
          <li>The email is saved to your list — and to its CSV — straight away, and the next creator opens.</li>
          <li>
            Each Google account can reveal about 10 emails a day. When one runs out (or YouTube says so), the panel switches to your next account
            automatically. Channels without a “View email address” button: press <b>No email here</b>.
          </li>
        </ol>
        <p className="text-[12px] text-[var(--muted)]">
          The extension only reads the email YouTube shows you after you complete the check. It never solves or skips the check, and it only
          talks to YouTube and to this CollabGlam site.
        </p>
      </div>

      <ExtensionKeys
        keys={keys.map((k) => ({ id: k.id, label: k.label, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
