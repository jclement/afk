// Theme FOUC prevention — set .dark on <html> before paint based on saved
// preference (system/light/dark). Loaded as an external script (not inline)
// so it satisfies a strict Content-Security-Policy that disallows
// 'unsafe-inline'.
(function () {
  try {
    var pref = localStorage.getItem("afk-theme") || "system";
    var dark =
      pref === "dark" ||
      (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (_) {
    /* localStorage unavailable — fall through to default light theme */
  }
})();
