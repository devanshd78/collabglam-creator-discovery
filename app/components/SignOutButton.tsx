"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export default function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <button
      onClick={() => void signOut()}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--ink)] transition-colors"
    >
      <LogOut size={17} strokeWidth={2} />
      Sign out
    </button>
  );
}
