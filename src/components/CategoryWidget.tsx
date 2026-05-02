/**
 * Category usage widget — shows used / total / remaining for one category
 * with a colored progress bar. Auto-converts to weeks when the category's
 * unit is weeks.
 */

import { daysToCategoryUnit } from "@shared/vacation-math";
import type { CategorySummary } from "@shared/types";

export function CategoryWidget({ summary }: { summary: CategorySummary }) {
  const { category, used_days, total_days, remaining_days } = summary;
  const used = daysToCategoryUnit(used_days, category.unit);
  const total = daysToCategoryUnit(total_days, category.unit);
  const remaining = daysToCategoryUnit(remaining_days, category.unit);
  const pct = total > 0 ? Math.min(100, (used_days / total_days) * 100) : 0;
  const unitShort = category.unit === "weeks" ? "wk" : "d";

  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="pill" style={{ backgroundColor: category.color }}>
            {category.name}
          </span>
        </div>
        <div className="text-xs text-muted font-mono">
          {fmt(remaining)} {unitShort} left
        </div>
      </div>
      <div className="text-2xl font-semibold text-heading font-mono">
        {fmt(used)} <span className="text-muted text-sm font-normal">/ {fmt(total)} {unitShort}</span>
      </div>
      <div className="h-2 rounded-full bg-[color:var(--color-hover)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: category.color }}
        />
      </div>
      {total === 0 && (
        <div className="text-xs text-muted">No allowance set yet — head to settings.</div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  return n
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .replace(/^-?0$/, "0");
}
