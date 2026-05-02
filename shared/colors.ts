/**
 * Stable category color palette. New categories pick the first color in the
 * palette that isn't already in use; once assigned the color is persisted
 * with the category so it never changes. The palette is tuned to sit nicely
 * on both the light and dark themes.
 */

export const CATEGORY_PALETTE: readonly string[] = [
  "#2563eb", // blue
  "#16a34a", // green
  "#d97706", // amber
  "#dc2626", // red
  "#9333ea", // purple
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d", // lime
  "#f59e0b", // gold
  "#0d9488", // teal
  "#7c3aed", // violet
  "#b45309", // bronze
];

/**
 * Pick the first palette color not already used by `existing`. If every
 * color is taken, falls back to a deterministic hash of the name.
 */
export function nextCategoryColor(name: string, existingColors: readonly string[]): string {
  for (const c of CATEGORY_PALETTE) {
    if (!existingColors.includes(c)) return c;
  }
  // Hash the name to get a deterministic fallback color.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length]!;
}
