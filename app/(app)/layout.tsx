import { LayoutDashboard, Megaphone, Search, FolderOpen, ShieldCheck, Users, MailSearch } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import NavLink from "../components/NavLink";
import SignOutButton from "../components/SignOutButton";
import ThemeToggle from "../components/ThemeToggle";
import MobileNav from "../components/MobileNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [lists, mergedTotal, mergedEmails] = await Promise.all([
    prisma.creatorList.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { id: true, name: true, _count: { select: { creators: true } } },
    }),
    user.role === "ADMIN" ? prisma.creator.count() : Promise.resolve(0),
    user.role === "ADMIN" ? prisma.creator.count({ where: { email: { not: null } } }) : Promise.resolve(0),
  ]);
  const emailCounts = await prisma.creator.groupBy({
    by: ["listId"],
    where: { listId: { in: lists.map((l) => l.id) }, email: { not: null } },
    _count: { _all: true },
  });
  const emailsByList = new Map(emailCounts.map((e) => [e.listId, e._count._all]));

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-3 pb-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--brand-teal)", color: "#fff" }}>
          <Search size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-[var(--ink)] leading-tight">CollabGlam</div>
          <div className="text-[11px] text-[var(--muted-2)]">Creator Discovery</div>
        </div>
      </div>

      <nav className="space-y-0.5">
        <NavLink href="/" exact>
          <LayoutDashboard size={17} /> Dashboard
        </NavLink>
        <NavLink href="/briefs">
          <Megaphone size={17} /> Brand briefs
        </NavLink>
        <NavLink href="/discover">
          <Search size={17} /> Discover
        </NavLink>
        <NavLink href="/lists">
          <FolderOpen size={17} /> {user.role === "ADMIN" ? "All lists" : "My lists"}
        </NavLink>
        <NavLink href="/extension">
          <MailSearch size={17} /> Email reveal extension
        </NavLink>
        {user.role === "ADMIN" && (
          <>
            <NavLink href="/admin" exact>
              <ShieldCheck size={17} /> Team performance
            </NavLink>
            <NavLink href="/admin/users">
              <Users size={17} /> Team members
            </NavLink>
          </>
        )}
      </nav>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {user.role === "ADMIN" && (
          <div className="mb-3">
            <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">Team list</div>
            <NavLink href="/lists/merged" className="!py-1.5 !text-[12.5px]">
              <span className="truncate flex-1">Merged team list</span>
              <span className="text-[10.5px] tabular-nums shrink-0" title={`${mergedTotal} creators · ${mergedEmails} with email`}>
                {mergedTotal}<span className="opacity-60"> · {mergedEmails}✉</span>
              </span>
            </NavLink>
          </div>
        )}
        <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">My lists</div>
        {lists.length === 0 ? (
          <p className="px-3 text-[11.5px] text-[var(--muted-2)]">Lists you save creators into show up here.</p>
        ) : (
          <div className="space-y-0.5">
            {lists.map((l) => (
              <NavLink key={l.id} href={`/lists/${l.id}`} className="!py-1.5 !text-[12.5px]">
                <span className="truncate flex-1">{l.name}</span>
                <span className="text-[10.5px] tabular-nums shrink-0" title={`${l._count.creators} creators · ${emailsByList.get(l.id) ?? 0} with email`}>
                  {l._count.creators}
                  <span className="opacity-60"> · {emailsByList.get(l.id) ?? 0}✉</span>
                </span>
              </NavLink>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] pt-3 mt-3 space-y-0.5">
        <div className="px-3 pb-1.5">
          <div className="text-[12.5px] font-semibold text-[var(--ink)] truncate">{user.name}</div>
          <div className="text-[11px] text-[var(--muted-2)] truncate">
            {user.email} · {user.role === "ADMIN" ? "Admin" : "Member"}
          </div>
        </div>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden lg:block w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-3 h-screen sticky top-0">{sidebar}</aside>
      <MobileNav>{sidebar}</MobileNav>
      <main className="flex-1 min-w-0 px-4 sm:px-6 py-6">
        <div className="max-w-[1280px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
