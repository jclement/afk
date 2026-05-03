/**
 * Heavy unit tests for vacation math. This file is the safety net for the
 * accounting logic — every branch in vacation-math.ts is covered.
 */

import { describe, it, expect } from "vitest";
import {
  businessDaysBetween,
  categoryUsage,
  currentYearInTimezone,
  describeVacation,
  formatISODate,
  isBusinessDay,
  parseISODate,
  roundDays,
  todayInTimezone,
  vacationDayCost,
  vacationDayCostInYear,
  vacationsInYear,
  validateVacationShape,
  yearElapsedFraction,
} from "./vacation-math";
import type { Allowance, Category, Vacation } from "./types";

const cat: Category = {
  id: "cat1",
  user_id: "u",
  name: "Vacation",
  accrues: false,
  color: "#000",
  sort_order: 0,
  archived: false,
  created_at: "2026-01-01",
};

const accruingCat: Category = { ...cat, accrues: true };

function v(partial: Partial<Vacation>): Vacation {
  return {
    id: "v",
    user_id: "u",
    category_id: "cat1",
    start_date: "2026-03-02", // Monday
    end_date: "2026-03-02",
    partial_amount: null,
    public_desc: "",
    internal_desc: "",
    cancelled_at: null,
    ical_sequence: 0,
    approval_state: null,
    created_at: "2026-03-01",
    updated_at: "2026-03-01",
    ...partial,
  };
}

describe("parseISODate / formatISODate", () => {
  it("round-trips a known date", () => {
    const d = parseISODate("2026-05-02");
    expect(formatISODate(d)).toBe("2026-05-02");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(4);
    expect(d.getUTCDate()).toBe(2);
  });
  it("rejects garbage", () => {
    expect(() => parseISODate("nope")).toThrow();
    expect(() => parseISODate("2026-13-01")).toThrow();
    expect(() => parseISODate("2026-02-30")).toThrow();
  });
});

describe("isBusinessDay", () => {
  it.each([
    ["2026-05-04", true], // Mon
    ["2026-05-05", true], // Tue
    ["2026-05-06", true], // Wed
    ["2026-05-07", true], // Thu
    ["2026-05-08", true], // Fri
    ["2026-05-09", false], // Sat
    ["2026-05-10", false], // Sun
  ])("%s -> %s", (d, expected) => {
    expect(isBusinessDay(parseISODate(d))).toBe(expected);
  });
});

describe("businessDaysBetween", () => {
  it("counts a single Monday", () => {
    expect(businessDaysBetween("2026-05-04", "2026-05-04")).toBe(1);
  });
  it("counts a full work week", () => {
    expect(businessDaysBetween("2026-05-04", "2026-05-08")).toBe(5);
  });
  it("ignores the weekend", () => {
    expect(businessDaysBetween("2026-05-04", "2026-05-10")).toBe(5);
  });
  it("returns 0 if end is before start", () => {
    expect(businessDaysBetween("2026-05-04", "2026-05-03")).toBe(0);
  });
  it("two-week stretch", () => {
    // Mon-Fri then Mon-Fri across a weekend
    expect(businessDaysBetween("2026-05-04", "2026-05-15")).toBe(10);
  });
  it("starts on Saturday", () => {
    expect(businessDaysBetween("2026-05-09", "2026-05-12")).toBe(2); // Mon, Tue
  });
});

describe("vacationDayCost", () => {
  it("multi-day full", () => {
    expect(vacationDayCost(v({ start_date: "2026-05-04", end_date: "2026-05-08" }))).toBe(5);
  });
  it("single full day", () => {
    expect(vacationDayCost(v({ start_date: "2026-05-04", end_date: "2026-05-04" }))).toBe(1);
  });
  it("partial single day (half)", () => {
    expect(
      vacationDayCost(v({ start_date: "2026-05-04", end_date: "2026-05-04", partial_amount: 0.5 })),
    ).toBe(0.5);
  });
  it("partial on a weekend counts 0", () => {
    expect(
      vacationDayCost(v({ start_date: "2026-05-09", end_date: "2026-05-09", partial_amount: 0.5 })),
    ).toBe(0);
  });
  it("cancelled entry is 0", () => {
    expect(
      vacationDayCost(v({ start_date: "2026-05-04", end_date: "2026-05-08", cancelled_at: "x" })),
    ).toBe(0);
  });
});

describe("validateVacationShape", () => {
  it("rejects end-before-start", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-04",
        end_date: "2026-05-03",
        partial_amount: null,
      }),
    ).toMatch(/before/);
  });
  it("rejects partial on multi-day", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-04",
        end_date: "2026-05-05",
        partial_amount: 0.5,
      }),
    ).toMatch(/same day/);
  });
  it("rejects partial out of range", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: 0,
      }),
    ).toMatch(/between/);
    expect(
      validateVacationShape({
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: 1.5,
      }),
    ).toMatch(/between/);
  });
  it("rejects partial on weekend", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-09",
        end_date: "2026-05-09",
        partial_amount: 0.5,
      }),
    ).toMatch(/business day/);
  });
  it("rejects range with no business days", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-09",
        end_date: "2026-05-10",
        partial_amount: null,
      }),
    ).toMatch(/no business days/);
  });
  it("accepts a normal week-long vacation", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        partial_amount: null,
      }),
    ).toBe(null);
  });
  it("accepts a half-day", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: 0.5,
      }),
    ).toBe(null);
  });
  it("rejects NaN partial_amount", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: NaN,
      }),
    ).toMatch(/between/);
  });
  it("rejects Infinity partial_amount", () => {
    expect(
      validateVacationShape({
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: Infinity,
      }),
    ).toMatch(/between/);
  });
});

describe("vacationDayCostInYear", () => {
  it("clips a year-spanning entry to just the in-year portion", () => {
    // Mon Dec 28 2026 → Mon Jan 4 2027 (6 business days total). Year 2026
    // contains Dec 28-31 = 4 business days. Year 2027 contains Jan 1, 4 = 2
    // business days. The full-cost vacationDayCost would be 6 in both years.
    const v0: Vacation = v({ start_date: "2026-12-28", end_date: "2027-01-04" });
    expect(vacationDayCost(v0)).toBe(6);
    expect(vacationDayCostInYear(v0, 2026)).toBe(4);
    expect(vacationDayCostInYear(v0, 2027)).toBe(2);
  });
  it("returns 0 for a year the entry doesn't touch", () => {
    expect(
      vacationDayCostInYear(v({ start_date: "2026-05-04", end_date: "2026-05-08" }), 2027),
    ).toBe(0);
  });
  it("partial-day attributes to the start date's year", () => {
    expect(
      vacationDayCostInYear(
        v({ start_date: "2026-05-04", end_date: "2026-05-04", partial_amount: 0.5 }),
        2026,
      ),
    ).toBe(0.5);
    expect(
      vacationDayCostInYear(
        v({ start_date: "2026-05-04", end_date: "2026-05-04", partial_amount: 0.5 }),
        2025,
      ),
    ).toBe(0);
  });
});

describe("yearElapsedFraction", () => {
  it("returns 0 before the year starts (UTC)", () => {
    expect(yearElapsedFraction(2026, new Date("2025-12-31T00:00:00Z"))).toBe(0);
  });
  it("returns 1 after the year ends (UTC)", () => {
    expect(yearElapsedFraction(2026, new Date("2027-01-01T00:00:00Z"))).toBe(1);
  });
  it("is roughly half on July 2 mid-year (UTC)", () => {
    const f = yearElapsedFraction(2026, new Date("2026-07-02T12:00:00Z"));
    expect(f).toBeGreaterThan(0.49);
    expect(f).toBeLessThan(0.51);
  });
  it("respects per-user tz when crossing midnight", () => {
    // Jan 1 04:00 UTC == Dec 31 20:00 in America/Vancouver (UTC-8) the day
    // before. So in UTC the fraction is just past zero, but in Vancouver
    // tz it's still last year (returns 1 because asOf > Vancouver-2026 has
    // not yet started, but year=2025 returns 1 since 2025 has fully passed).
    const asOf = new Date("2026-01-01T04:00:00Z");
    expect(yearElapsedFraction(2026, asOf, "America/Vancouver")).toBe(0);
    expect(yearElapsedFraction(2026, asOf, "UTC")).toBeGreaterThan(0);
  });
});

describe("todayInTimezone", () => {
  it("formats YYYY-MM-DD in the named tz", () => {
    // Same instant: 04:00 UTC on Jan 1. In Vancouver tz that's still Dec 31.
    const asOf = new Date("2026-01-01T04:00:00Z");
    expect(todayInTimezone("UTC", asOf)).toBe("2026-01-01");
    expect(todayInTimezone("America/Vancouver", asOf)).toBe("2025-12-31");
    expect(todayInTimezone("Asia/Tokyo", asOf)).toBe("2026-01-01");
  });
  it("falls back to UTC when given an unknown tz", () => {
    const asOf = new Date("2026-06-04T12:00:00Z");
    expect(todayInTimezone("Atlantis/Lemuria", asOf)).toBe("2026-06-04");
  });
});

describe("currentYearInTimezone", () => {
  it("rolls earlier in westward zones", () => {
    const asOf = new Date("2026-01-01T04:00:00Z");
    expect(currentYearInTimezone("UTC", asOf)).toBe(2026);
    expect(currentYearInTimezone("America/Vancouver", asOf)).toBe(2025);
  });
});

describe("categoryUsage", () => {
  const baseAllowance: Allowance = {
    id: "a",
    user_id: "u",
    category_id: "cat1",
    year: 2026,
    days_allotted: 30,
    days_carryover: 2,
    notes: null,
  };

  it("computes used / available / total / remaining for non-accruing", () => {
    const vacations: Vacation[] = [
      v({ id: "v1", start_date: "2026-05-04", end_date: "2026-05-08" }), // 5
      v({
        id: "v2",
        start_date: "2026-05-11",
        end_date: "2026-05-11",
        partial_amount: 0.5,
      }), // 0.5
    ];
    const r = categoryUsage(cat, baseAllowance, vacations, new Date("2026-06-01T00:00:00Z"));
    expect(r.used_days).toBe(5.5);
    expect(r.total_days).toBe(32);
    expect(r.available_days).toBe(32); // non-accruing → fully available
    expect(r.remaining_days).toBe(26.5);
    expect(r.over_accrual_days).toBe(0);
  });

  it("prorates available_days for accruing categories", () => {
    const r = categoryUsage(accruingCat, baseAllowance, [], new Date("2026-07-02T12:00:00Z"), 2026);
    // ~half year elapsed → carryover (2) + 30 * ~0.5 = ~17, rounded to 0.25
    expect(r.available_days).toBeGreaterThan(16);
    expect(r.available_days).toBeLessThan(18);
    expect(r.total_days).toBe(32);
  });

  it("flags over-accrual when used > available on accruing categories", () => {
    const vacations: Vacation[] = [
      v({ id: "v1", start_date: "2026-02-02", end_date: "2026-02-13" }), // 10 business days in early Feb
    ];
    const r = categoryUsage(
      accruingCat,
      baseAllowance,
      vacations,
      new Date("2026-02-15T00:00:00Z"),
      2026,
    );
    // ~12% of year → carryover 2 + 30 * 0.12 ≈ 5.6, used = 10
    expect(r.used_days).toBe(10);
    expect(r.over_accrual_days).toBeGreaterThan(0);
  });

  it("non-accruing never reports over_accrual", () => {
    const vacations: Vacation[] = [
      v({ id: "v1", start_date: "2026-02-02", end_date: "2026-02-13" }),
    ];
    const r = categoryUsage(cat, baseAllowance, vacations, new Date("2026-02-15T00:00:00Z"));
    expect(r.over_accrual_days).toBe(0);
  });

  it("treats null allowance as zero total", () => {
    const r = categoryUsage(cat, null, []);
    expect(r.total_days).toBe(0);
    expect(r.remaining_days).toBe(0);
    expect(r.available_days).toBe(0);
  });
});

describe("vacationsInYear", () => {
  it("filters out cancelled", () => {
    const list = [
      v({ id: "a", start_date: "2026-03-02", end_date: "2026-03-02" }),
      v({ id: "b", start_date: "2026-03-02", end_date: "2026-03-02", cancelled_at: "x" }),
    ];
    const filtered = vacationsInYear(2026, list);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe("a");
  });
  it("includes ranges that overlap year boundary", () => {
    const list = [
      v({ id: "a", start_date: "2025-12-29", end_date: "2026-01-02" }),
      v({ id: "b", start_date: "2027-01-05", end_date: "2027-01-09" }),
    ];
    expect(vacationsInYear(2026, list).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("describeVacation", () => {
  it("formats a single day", () => {
    expect(describeVacation(v({ start_date: "2026-03-02", end_date: "2026-03-02" }))).toMatch(
      /Mar 2/,
    );
  });
  it("formats half day", () => {
    expect(
      describeVacation(
        v({ start_date: "2026-03-02", end_date: "2026-03-02", partial_amount: 0.5 }),
      ),
    ).toMatch(/½/);
  });
  it("formats range", () => {
    const s = describeVacation(v({ start_date: "2026-03-02", end_date: "2026-03-06" }));
    expect(s).toMatch(/Mar 2/);
    expect(s).toMatch(/Mar 6/);
  });
});

describe("roundDays", () => {
  it("rounds to nearest 0.25", () => {
    expect(roundDays(0.1)).toBe(0);
    expect(roundDays(0.13)).toBe(0.25);
    expect(roundDays(0.5 + 0.5 + 0.5)).toBe(1.5);
  });
});
