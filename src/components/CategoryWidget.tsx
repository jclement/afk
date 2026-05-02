/**
 * Category usage widget — shows used / available / total for one category
 * with a colored progress bar. Quantities are always days; accruing
 * categories show a subtle warning when usage exceeds what's been earned.
 */

import { AlertTriangle } from "lucide-react";
import type { CategorySummary } from "@shared/types";

export function CategoryWidget({ summary }: { summary: CategorySummary }) {
  const {
    category,
    used_days,
    total_days,
    available_days,
    over_accrual_days,
  } = summary;
  const pct = total_days > 0 ? Math.min(100, (used_days / total_days) * 100) : 0;
  const availPct =
    total_days > 0 ? Math.min(100, (available_days / total_days) * 100) : 0;

  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="pill" style={{ backgroundColor: category.color }}>
          {category.name}
        </span>
        <div className="text-xs text-muted font-mono">
          {fmt(total_days - used_days)} d left
        </div>
      </div>
      <div className="text-2xl font-semibold text-heading font-mono">
        {fmt(used_days)}{" "}
        <span className="text-muted text-sm font-normal">
          / {fmt(available_days)}
          {category.accrues && available_days !== total_days && (
            <> avail / {fmt(total_days)}</>
          )}{" "}
          d
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[color:var(--color-hover)] overflow-hidden">
        {category.accrues && (
          <div
            className="absolute top-0 bottom-0 w-px bg-[color:var(--color-text)] opacity-40"
            style={{ left: `${availPct}%` }}
            title={`${fmt(available_days)} d accrued so far`}
          />
        )}
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: category.color }}
        />
      </div>
      {total_days === 0 && (
        <div className="text-xs text-muted">No allowance set yet — head to settings.</div>
      )}
      {over_accrual_days > 0 && (
        <div className="flex items-start gap-1 text-xs text-[color:var(--color-warning,#b45309)]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Borrowing {fmt(over_accrual_days)} d from later in the year — make
            sure you stick around to earn it back.
          </span>
        </div>
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
