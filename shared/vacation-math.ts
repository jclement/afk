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
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m! - 1 || date.getUTCDate() !== d) {
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
export function businessDaysBetween(startDate: string, endDate: string): number {
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);
  if (end.getTime() < start.getTime()) return 0;

  // Walk day by day. The maximum sensible vacation entry is well under a
  // year so this is fine — no need for a clever modulo formula.
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
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
export function vacationDayCost(
  v: Pick<Vacation, "start_date" | "end_date" | "partial_amount" | "cancelled_at">,
): number {
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
 * Same as `vacationDayCost`, but only counts the portion of the entry that
 * falls inside the given calendar year. A Dec 29 → Jan 2 booking would
 * otherwise count its full 4 business days against BOTH years' allowances.
 */
export function vacationDayCostInYear(
  v: Pick<Vacation, "start_date" | "end_date" | "partial_amount" | "cancelled_at">,
  year: number,
): number {
  if (v.cancelled_at) return 0;
  if (v.partial_amount != null) {
    // Partial entries are single-day, so the year is whichever year the start
    // date falls in.
    if (v.start_date.slice(0, 4) !== String(year)) return 0;
    return vacationDayCost(v);
  }
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (v.end_date < yearStart || v.start_date > yearEnd) return 0;
  const clippedStart = v.start_date < yearStart ? yearStart : v.start_date;
  const clippedEnd = v.end_date > yearEnd ? yearEnd : v.end_date;
  return businessDaysBetween(clippedStart, clippedEnd);
}

/**
 * Today's date as `YYYY-MM-DD` in the given IANA timezone. Falls back to
 * UTC if the runtime can't resolve the zone (shouldn't happen in modern
 * browsers / Workers).
 */
export function todayInTimezone(tz: string, asOf: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(asOf);
    const y = parts.find((p) => p.type === "year")!.value;
    const m = parts.find((p) => p.type === "month")!.value;
    const d = parts.find((p) => p.type === "day")!.value;
    return `${y}-${m}-${d}`;
  } catch {
    return formatISODate(asOf);
  }
}

/** Calendar year `asOf` falls into, in the given IANA timezone. */
export function currentYearInTimezone(tz: string, asOf: Date = new Date()): number {
  return Number(todayInTimezone(tz, asOf).slice(0, 4));
}

/**
 * Fraction of the calendar year that has elapsed at `asOf`, evaluated in
 * the user's `tz`. Returns:
 *   - 1 if `asOf` (in tz) is in a year after `year`
 *   - 0 if `asOf` (in tz) is before `year` starts
 *   - else day-of-year + fraction-of-day, divided by year length
 *
 * `tz` defaults to UTC for callers that don't have a user context (tests,
 * the print template's older signature).
 */
export function yearElapsedFraction(
  year: number,
  asOf: Date = new Date(),
  tz: string = "UTC",
): number {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(asOf);
  } catch {
    return yearElapsedFraction(year, asOf, "UTC");
  }
  const get = (type: string) => Number(parts!.find((p) => p.type === type)!.value);
  const localYear = get("year");
  if (localYear < year) return 0;
  if (localYear > year) return 1;
  const month = get("month"); // 1..12
  const day = get("day"); // 1..31
  // Intl returns "24" for midnight in some zones via hour12:false; normalise.
  const hour = get("hour") % 24;
  const minute = get("minute");
  const second = get("second");
  const yearLength = isLeapYear(year) ? 366 : 365;
  const dayOfYear = computeDayOfYear(year, month, day);
  const fractionOfDay = (hour * 3600 + minute * 60 + second) / 86_400;
  return (dayOfYear - 1 + fractionOfDay) / yearLength;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function computeDayOfYear(y: number, m: number, d: number): number {
  const months = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let total = 0;
  for (let i = 0; i < m - 1; i++) total += months[i]!;
  return total + d;
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
  tz: string = "UTC",
): {
  used_days: number;
  total_days: number;
  available_days: number;
  remaining_days: number;
  over_accrual_days: number;
} {
  const yr = year ?? allowance?.year ?? currentYearInTimezone(tz, asOf);
  // Clip each vacation to the year boundary so a Dec 29 → Jan 2 entry isn't
  // double-counted into both years' allowances.
  const used = vacations.reduce((sum, v) => sum + vacationDayCostInYear(v, yr), 0);
  const allotted = allowance?.days_allotted ?? 0;
  const carryover = allowance?.days_carryover ?? 0;
  const total = allotted + carryover;
  const fraction = category.accrues ? yearElapsedFraction(yr, asOf, tz) : 1;
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
    // Number.isFinite catches NaN and Infinity — both slip past `<= 0 || > 1`
    // because every comparison with NaN is false.
    if (
      !Number.isFinite(input.partial_amount) ||
      input.partial_amount <= 0 ||
      input.partial_amount > 1
    ) {
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
  return all.filter((v) => !v.cancelled_at && v.start_date <= yearEnd && v.end_date >= yearStart);
}
