/**
 * Theme controller — three-state cycle (system / light / dark) persisted in
 * localStorage. The initial application happens in index.html via an inline
 * script to avoid FOUC; this module handles the runtime toggle.
 */

import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

const KEY = "afk-theme";

function applyTheme(pref: ThemePref) {
  const dark =
    pref === "dark" ||
    (pref === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(
    () => (localStorage.getItem(KEY) as ThemePref) || "system",
  );

  useEffect(() => {
    applyTheme(pref);
    localStorage.setItem(KEY, pref);
  }, [pref]);

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => applyTheme("system");
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [pref]);

  function cycle() {
    setPref((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));
  }
  return { pref, setPref, cycle };
}
