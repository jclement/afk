/**
 * Heavy unit tests for vacation math. This file is the safety net for the
 * accounting logic — every branch in vacation-math.ts is covered.
 */

import { describe, it, expect } from "vitest";
import {
  businessDaysBetween,
  categoryUnitToDays,
  categoryUsage,
  daysToCategoryUnit,
  describeVacation,
  formatISODate,
  isBusinessDay,
  parseISODate,
  roundDays,
  vacationDayCost,
  vacationsInYear,
  validateVacationShape,
} from "./vacation-math";
import type { Allowance, Category, Vacation } from "./types";

const cat: Category = {
  id: "cat1",
  user_id: "u",
  name: "Vacation",
  unit: "days",
  color: "#000",
  sort_order: 0,
  archived: false,
  created_at: "2026-01-01",
};

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
      vacationDayCost(
        v({ start_date: "2026-05-04", end_date: "2026-05-04", partial_amount: 0.5 }),
      ),
    ).toBe(0.5);
  });
  it("partial on a weekend counts 0", () => {
    expect(
      vacationDayCost(
        v({ start_date: "2026-05-09", end_date: "2026-05-09", partial_amount: 0.5 }),
      ),
    ).toBe(0);
  });
  it("cancelled entry is 0", () => {
    expect(
      vacationDayCost(
        v({ start_date: "2026-05-04", end_date: "2026-05-08", cancelled_at: "x" }),
      ),
    ).toBe(0);
  });
});

describe("validateVacationShape", () => {
  it("rejects end-before-start", () => {
    expect(
      validateVacationShape({ start_date: "2026-05-04", end_date: "2026-05-03", partial_amount: null }),
    ).toMatch(/before/);
  });
  it("rejects partial on multi-day", () => {
    expect(
      validateVacationShape({ start_date: "2026-05-04", end_date: "2026-05-05", partial_amount: 0.5 }),
    ).toMatch(/same day/);
  });
  it("rejects partial out of range", () => {
    expect(
      validateVacationShape({ start_date: "2026-05-04", end_date: "2026-05-04", partial_amount: 0 }),
    ).toMatch(/between/);
    expect(
      validateVacationShape({ start_date: "2026-05-04", end_date: "2026-05-04", partial_amount: 1.5 }),
    ).toMatch(/between/);
  });
  it("rejects partial on weekend", () => {
    expect(
      validateVacationShape({ start_date: "2026-05-09", end_date: "2026-05-09", partial_amount: 0.5 }),
    ).toMatch(/business day/);
  });
  it("rejects range with no business days", () => {
    expect(
      validateVacationShape({ start_date: "2026-05-09", end_date: "2026-05-10", partial_amount: null }),
    ).toMatch(/no business days/);
  });
  it("accepts a normal week-long vacation", () => {
    expect(
      validateVacationShape({ start_date: "2026-05-04", end_date: "2026-05-08", partial_amount: null }),
    ).toBe(null);
  });
  it("accepts a half-day", () => {
    expect(
      validateVacationShape({ start_date: "2026-05-04", end_date: "2026-05-04", partial_amount: 0.5 }),
    ).toBe(null);
  });
});

describe("daysToCategoryUnit / categoryUnitToDays", () => {
  it("days unit is identity", () => {
    expect(daysToCategoryUnit(5, "days")).toBe(5);
    expect(categoryUnitToDays(5, "days")).toBe(5);
  });
  it("weeks divides by 5", () => {
    expect(daysToCategoryUnit(10, "weeks")).toBe(2);
    expect(categoryUnitToDays(2, "weeks")).toBe(10);
  });
});

describe("categoryUsage", () => {
  it("computes used / remaining / total", () => {
    const allowance: Allowance = {
      id: "a",
      user_id: "u",
      category_id: "cat1",
      year: 2026,
      days_allotted: 30, // 6 weeks
      days_carryover: 2,
      notes: null,
    };
    const vacations: Vacation[] = [
      v({ id: "v1", start_date: "2026-05-04", end_date: "2026-05-08" }), // 5 days
      v({
        id: "v2",
        start_date: "2026-05-11",
        end_date: "2026-05-11",
        partial_amount: 0.5,
      }), // 0.5 days
    ];
    const r = categoryUsage(cat, allowance, vacations);
    expect(r.used_days).toBe(5.5);
    expect(r.total_days).toBe(32);
    expect(r.remaining_days).toBe(26.5);
  });
  it("treats null allowance as zero total", () => {
    const r = categoryUsage(cat, null, []);
    expect(r.total_days).toBe(0);
    expect(r.remaining_days).toBe(0);
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
