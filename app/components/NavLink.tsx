"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({
  href,
  children,
  exact = false,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors ${className}`}
      style={active ? { background: "var(--brand-teal-light)", color: "var(--brand-teal-dark)" } : { color: "var(--muted)" }}
    >
      {children}
    </Link>
  );
}
