/**
 * Data-export endpoint tests. The export feature is the user's escape
 * hatch — every user-owned table MUST round-trip through it. If you add a
 * new table or column, add a coverage assertion here so the next reviewer
 * notices when something is missing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, authedFetch, createTestSession, unauthedFetch } from "./test-utils.js";

async function seed(cookie: string) {
  const cat = await authedFetch(cookie, "/api/v1/categories", {
    method: "POST",
    json: { name: "Vacation", accrues: true, color: "#2563eb" },
  });
  const catBody = (await cat.json()) as { data: { id: string } };
  const categoryId = catBody.data.id;

  await authedFetch(cookie, `/api/v1/categories/allowances/2026/${categoryId}`, {
    method: "PUT",
    json: { days_allotted: 20, days_carryover: 3 },
  });

  await authedFetch(cookie, "/api/v1/vacations", {
    method: "POST",
    json: {
      category_id: categoryId,
      start_date: "2026-05-04",
      end_date: "2026-05-08",
      partial_amount: null,
      public_desc: 'Hawaii, "vacation", finally',
      internal_desc: "Line one\nLine two",
    },
  });
  return { categoryId };
}

describe("data export", () => {
  beforeEach(applyMigrations);

  describe("GET /api/v1/me/export.json", () => {
    it("requires authentication", async () => {
      const res = await unauthedFetch("/api/v1/me/export.json");
      expect(res.status).toBe(401);
    });

    it("returns every user-owned table for the requesting user", async () => {
      const { cookie, user } = await createTestSession({ username: "alice" });
      await seed(cookie);

      const res = await authedFetch(cookie, "/api/v1/me/export.json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(res.headers.get("content-disposition")).toMatch(/attachment;.*alice.*\.json/);

      const body = (await res.json()) as Record<string, unknown>;

      // Schema envelope
      expect(body.schema_version).toBe(1);
      expect(body.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect((body.app as { name: string }).name).toBe("AFK");

      // User profile (sans id and credentials)
      const u = body.user as Record<string, unknown>;
      expect(u.username).toBe(user.username);
      expect(u.display_name).toBe(user.display_name);
      expect(u.role).toBeDefined();
      expect(u.timezone).toBeDefined();
      expect("id" in u).toBe(false);

      // Every user-data table is present.
      // ⚠️  ADD A NEW ASSERTION HERE WHEN YOU ADD A NEW TABLE — see CLAUDE.md
      // "Data export contract".
      expect(Array.isArray(body.categories)).toBe(true);
      expect(Array.isArray(body.allowances)).toBe(true);
      expect(Array.isArray(body.vacations)).toBe(true);

      const cats = body.categories as Array<{ name: string }>;
      const allowances = body.allowances as Array<{ year: number; days_allotted: number }>;
      const vacations = body.vacations as Array<{ start_date: string; public_desc: string }>;
      expect(cats[0]!.name).toBe("Vacation");
      expect(allowances[0]!.year).toBe(2026);
      expect(allowances[0]!.days_allotted).toBe(20);
      expect(vacations[0]!.start_date).toBe("2026-05-04");
      // Free-text round-trips intact (commas, quotes, newlines).
      expect(vacations[0]!.public_desc).toBe('Hawaii, "vacation", finally');
    });

    it("does not leak another user's data", async () => {
      const { cookie: aliceCookie } = await createTestSession({ username: "alice" });
      const { cookie: bobCookie } = await createTestSession({ username: "bob" });
      await seed(aliceCookie);

      const res = await authedFetch(bobCookie, "/api/v1/me/export.json");
      const body = (await res.json()) as {
        user: { username: string };
        categories: unknown[];
        vacations: unknown[];
      };
      expect(body.user.username).toBe("bob");
      expect(body.categories).toHaveLength(0);
      expect(body.vacations).toHaveLength(0);
    });
  });

  describe("GET /api/v1/me/export.csv", () => {
    it("requires authentication", async () => {
      const res = await unauthedFetch("/api/v1/me/export.csv");
      expect(res.status).toBe(401);
    });

    it("emits a header row + one data row per vacation with category fields joined", async () => {
      const { cookie } = await createTestSession({ username: "alice" });
      await seed(cookie);
      const res = await authedFetch(cookie, "/api/v1/me/export.csv");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/csv/);
      expect(res.headers.get("content-disposition")).toMatch(/attachment;.*alice.*\.csv/);

      const text = await res.text();
      const lines = text.trim().split("\r\n");
      expect(lines).toHaveLength(2); // header + one row
      expect(lines[0]).toBe(
        "start_date,end_date,days,partial_amount,category_name,category_color,category_accrues,public_desc,internal_desc,cancelled_at,created_at,updated_at,id",
      );
      // Computed days field present (5 business days Mon-Fri).
      expect(lines[1]).toContain("2026-05-04,2026-05-08,5,");
      // Commas + quotes + newlines in user input are properly escaped.
      expect(text).toContain('"Hawaii, ""vacation"", finally"');
      expect(text).toContain('"Line one\nLine two"');
    });

    it("only includes the requesting user's vacations", async () => {
      const { cookie: aliceCookie } = await createTestSession({ username: "alice" });
      const { cookie: bobCookie } = await createTestSession({ username: "bob" });
      await seed(aliceCookie);
      const res = await authedFetch(bobCookie, "/api/v1/me/export.csv");
      const text = await res.text();
      const lines = text.trim().split("\r\n");
      // Header only — no data rows for bob.
      expect(lines).toHaveLength(1);
    });
  });
});
