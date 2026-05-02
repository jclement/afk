/**
 * Theme controller — three-state cycle (system / light / dark) persisted in
 * localStorage. The initial application happens in /theme-init.js via a
 * preload script to avoid FOUC; this module handles the runtime toggle and
 * listens for OS-level theme changes when the user's preference is "system".
 */

import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

const KEY = "afk-theme";

function applyTheme(pref: ThemePref) {
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

// Module-level listener: stays alive for the lifetime of the page so that
// OS theme changes flow through even when the user is on a route without a
// mounted Header (e.g., /login). Re-applies whenever the OS preference flips
// AND the user's stored preference is "system".
if (typeof window !== "undefined") {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    const pref = (localStorage.getItem(KEY) as ThemePref) || "system";
    if (pref === "system") applyTheme("system");
  });
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(
    () => (localStorage.getItem(KEY) as ThemePref) || "system",
  );

  useEffect(() => {
    applyTheme(pref);
    localStorage.setItem(KEY, pref);
  }, [pref]);

  function cycle() {
    setPref((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));
  }
  return { pref, setPref, cycle };
}
