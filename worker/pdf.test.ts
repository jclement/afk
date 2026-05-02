/**
 * PDF route tests — we don't have a Browser Rendering binding in tests,
 * so we hit the `?html=1` fallback to verify the print template renders
 * the expected content without crashing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, authedFetch, createTestSession } from "./test-utils.js";

describe("PDF / print template", () => {
  beforeEach(applyMigrations);

  it("returns a 503 explaining the missing browser binding by default", async () => {
    const { cookie } = await createTestSession();
    const res = await authedFetch(cookie, "/api/v1/pdf/2026");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("html=1 fallback renders the year summary", async () => {
    const { cookie, user } = await createTestSession({ username: "jeff" });

    const cat = await authedFetch(cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "Vacation", unit: "weeks" },
    });
    const cId = ((await cat.json()) as { data: { id: string } }).data.id;
    await authedFetch(cookie, `/api/v1/categories/allowances/2026/${cId}`, {
      method: "PUT",
      json: { days_allotted: 25, days_carryover: 0 },
    });
    await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: cId,
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        partial_amount: null,
        public_desc: "Cabin",
        internal_desc: "",
      },
    });

    const res = await authedFetch(cookie, "/api/v1/pdf/2026?html=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("AFK — 2026");
    expect(html).toContain("Vacation");
    expect(html).toContain("Cabin");
    // sanity: user.display_name should be on the cover
    expect(html).toContain(user.display_name);
  });
});
