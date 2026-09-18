"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

/** The sidebar as a slide-over on narrow screens. */
export default function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the drawer after navigating
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="lg:hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-30">
        <span className="text-[13.5px] font-semibold text-[var(--ink)]">CollabGlam Discovery</span>
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="p-1.5 rounded-lg text-[var(--muted)]">
          <Menu size={20} />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-[var(--surface)] p-3 shadow-xl">
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-3 top-3 p-1 text-[var(--muted)]">
              <X size={18} />
            </button>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
