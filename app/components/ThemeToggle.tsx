"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "light" | "dark";

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeToggle() {
  // Starts null so the server-rendered markup and the first client render match (avoids a
  // hydration mismatch) — the real value is read from localStorage/OS right after mount.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // localStorage/matchMedia don't exist during SSR, so the real theme can only be read once
    // mounted in the browser — there's no external-store subscription to use instead here.
    const saved = localStorage.getItem("theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(saved === "light" || saved === "dark" ? saved : getSystemTheme());
  }, []);

  function toggle() {
    const next: Theme = (theme ?? getSystemTheme()) === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--ink)] transition-colors"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun size={17} strokeWidth={2} /> : <Moon size={17} strokeWidth={2} />}
      {isDark ? "Light Mode" : "Dark Mode"}
    </button>
  );
}
