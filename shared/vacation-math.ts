/**
 * Vacation math — the boring-but-load-bearing functions that decide how
 * many days an entry consumes and what the remaining balance looks like
 * for a given year. Pure functions, no side effects, fully unit-tested.
 *
 * Conventions:
 *   - All quantities are in business days. We don't track weeks or hours.
 *   - "business day" = Monday..Friday (we ignore public holidays for now;
 *     the user enters their own real-world entries and can split a block
 *     around statutory holidays if they care)
 *   - Dates are ISO `YYYY-MM-DD` strings parsed in UTC. Vacation is a
 *     date concept, not a wall-clock timestamp, so UTC keeps the arithmetic
 *     stable across time zones.
 */

import type { Allowance, Category, Vacation } from "./types.js";

const MS_PER_DAY = 86_400_000;

/** Parse a `YYYY-MM-DD` string into a UTC Date. Throws on invalid input. */
export function parseISODate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Invalid ISO date: ${s}`);
  }
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m! - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new Error(`Invalid ISO date: ${s}`);
  }
  return date;
}

/** Format a UTC Date as `YYYY-MM-DD`. */
export function formatISODate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** True if `d` (UTC) is Monday..Friday. */
export function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Count business days between two ISO dates, inclusive. Returns 0 if
 * `endDate` is before `startDate`. Public holidays are not subtracted.
 */
export function businessDaysBetween(
  startDate: string,
  endDate: string,
): number {
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);
  if (end.getTime() < start.getTime()) return 0;

  // Walk day by day. The maximum sensible vacation entry is well under a
  // year so this is fine — no need for a clever modulo formula.
  let count = 0;
  for (
    let t = start.getTime();
    t <= end.getTime();
    t += MS_PER_DAY
  ) {
    if (isBusinessDay(new Date(t))) count++;
  }
  return count;
}

/**
 * Compute how many days an entry consumes from its category allowance.
 *
 *   - partial_amount set → must be a single-day entry, consumes that fraction
 *   - otherwise → business days from start..end inclusive
 *
 * Cancelled entries always consume 0.
 */
export function vacationDayCost(v: Pick<Vacation, "start_date" | "end_date" | "partial_amount" | "cancelled_at">): number {
  if (v.cancelled_at) return 0;
  if (v.partial_amount != null) {
    // Partial only makes sense on a single business day.
    const start = parseISODate(v.start_date);
    if (!isBusinessDay(start)) return 0;
    return v.partial_amount;
  }
  return businessDaysBetween(v.start_date, v.end_date);
}

/**
 * Fraction of the calendar year that has elapsed at `asOf`. Returns:
 *   - 1 if `asOf` is in a year after `year`
 *   - 0 if `asOf` is before `year` starts
 *   - elapsed_days / year_days otherwise (uses calendar days, not business
 *     days — accrual happens at HR's pace, not the work week's)
 */
export function yearElapsedFraction(year: number, asOf: Date = new Date()): number {
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const t = asOf.getTime();
  if (t <= yearStart) return 0;
  if (t >= yearEnd) return 1;
  return (t - yearStart) / (yearEnd - yearStart);
}

/**
 * Compute used / available / total / remaining / over-accrual for a single
 * category and its filtered list of vacations.
 *
 *   - `total_days` = allotted + carryover (the full year's pool)
 *   - `available_days` = carryover + allotted × elapsed-fraction (accruing)
 *                       or = total_days (non-accruing)
 *   - `over_accrual_days` = max(0, used - available); only nonzero when
 *     accruing and the user has dipped into days they haven't earned yet.
 */
export function categoryUsage(
  category: Pick<Category, "accrues">,
  allowance: Allowance | null,
  vacations: Vacation[],
  asOf: Date = new Date(),
  year?: number,
): {
  used_days: number;
  total_days: number;
  available_days: number;
  remaining_days: number;
  over_accrual_days: number;
} {
  const used = vacations.reduce((sum, v) => sum + vacationDayCost(v), 0);
  const allotted = allowance?.days_allotted ?? 0;
  const carryover = allowance?.days_carryover ?? 0;
  const total = allotted + carryover;
  const yr = year ?? allowance?.year ?? asOf.getUTCFullYear();
  const fraction = category.accrues ? yearElapsedFraction(yr, asOf) : 1;
  const available = carryover + allotted * fraction;
  const overAccrual = category.accrues ? Math.max(0, used - available) : 0;
  return {
    used_days: roundDays(used),
    total_days: roundDays(total),
    available_days: roundDays(available),
    remaining_days: roundDays(total - used),
    over_accrual_days: roundDays(overAccrual),
  };
}

/**
 * Round to the nearest 0.25 so totals don't display 1.5000000004 from
 * floating-point sums. Vacation increments are 0.25, 0.5, 0.75, 1.
 */
export function roundDays(n: number): number {
  return Math.round(n * 4) / 4;
}

/**
 * Validate that an entry is one of the three shapes:
 *   1. multi-day (start < end, no partial)
 *   2. single full day (start == end, no partial)
 *   3. single partial day (start == end, partial in (0,1])
 *
 * Returns null on success, an error message on failure.
 */
export function validateVacationShape(input: {
  start_date: string;
  end_date: string;
  partial_amount: number | null;
}): string | null {
  let start: Date;
  let end: Date;
  try {
    start = parseISODate(input.start_date);
    end = parseISODate(input.end_date);
  } catch (e) {
    return (e as Error).message;
  }
  if (end.getTime() < start.getTime()) {
    return "End date is before start date.";
  }
  if (input.partial_amount != null) {
    if (start.getTime() !== end.getTime()) {
      return "Partial-day vacations must start and end on the same day.";
    }
    if (input.partial_amount <= 0 || input.partial_amount > 1) {
      return "Partial amount must be between 0 (exclusive) and 1 (inclusive).";
    }
    if (!isBusinessDay(start)) {
      return "Partial day must fall on a business day.";
    }
  } else {
    // Multi-day or single full day. Must contain at least one business day.
    if (businessDaysBetween(input.start_date, input.end_date) === 0) {
      return "Selected range contains no business days.";
    }
  }
  return null;
}

/** Pretty-print an entry for human display: "Mar 3", "Mar 3–7", "Mar 3 (½)". */
export function describeVacation(
  v: Pick<Vacation, "start_date" | "end_date" | "partial_amount">,
): string {
  const start = parseISODate(v.start_date);
  const end = parseISODate(v.end_date);
  const sameDay = v.start_date === v.end_date;
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  if (sameDay && v.partial_amount != null) {
    const label =
      v.partial_amount === 0.5
        ? "½ day"
        : `${v.partial_amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} day`;
    return `${fmt(start)} (${label})`;
  }
  if (sameDay) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Filter a list of vacations to those that overlap a given calendar year.
 * Cancelled entries are excluded.
 */
export function vacationsInYear(year: number, all: Vacation[]): Vacation[] {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return all.filter(
    (v) =>
      !v.cancelled_at && v.start_date <= yearEnd && v.end_date >= yearStart,
  );
}
