import { describe, expect, it } from "vitest";
import { CATEGORY_PALETTE, nextCategoryColor } from "./colors";

describe("nextCategoryColor", () => {
  it("returns the first palette color when none used", () => {
    expect(nextCategoryColor("Vacation", [])).toBe(CATEGORY_PALETTE[0]);
  });
  it("skips already-used colors", () => {
    const used = [CATEGORY_PALETTE[0], CATEGORY_PALETTE[1]] as string[];
    expect(nextCategoryColor("Flex", used)).toBe(CATEGORY_PALETTE[2]);
  });
  it("falls back to deterministic hash when palette exhausted", () => {
    const used = [...CATEGORY_PALETTE];
    const a = nextCategoryColor("Sick", used);
    const b = nextCategoryColor("Sick", used);
    expect(a).toBe(b);
    expect(used).toContain(a);
  });
});
