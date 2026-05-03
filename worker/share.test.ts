/**
 * Read-only share-link tests. Covers the full lifecycle:
 *   - CRUD: list, mint, revoke, validation
 *   - Public dashboard: returns owner + categories + vacations
 *   - PII: internal_desc / cancelled / approval-rejected rows are stripped
 *   - Scope: current-year ignores ?year hint, all-years honours it
 *   - Auth boundary: another user can't manage your tokens; bogus / revoked
 *     tokens 404 from the public endpoint
 *   - Export contract: share_tokens metadata is in the JSON dump but the
 *     credential `token` value is not
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  authedFetch,
  createTestSession,
  env,
  unauthedFetch,
} from "./test-utils.js";

async function seedDashboard(cookie: string, year = 2026) {
  const cat = await authedFetch(cookie, "/api/v1/categories", {
    method: "POST",
    json: { name: "Vacation", accrues: false, color: "#2563eb" },
  });
  const catBody = (await cat.json()) as { data: { id: string } };
  await authedFetch(cookie, `/api/v1/categories/allowances/${year}/${catBody.data.id}`, {
    method: "PUT",
    json: { days_allotted: 20, days_carryover: 0 },
  });
  const v = await authedFetch(cookie, "/api/v1/vacations", {
    method: "POST",
    json: {
      category_id: catBody.data.id,
      start_date: `${year}-05-04`,
      end_date: `${year}-05-08`,
      partial_amount: null,
      public_desc: "Beach",
      internal_desc: "Birthday party for the kid — secret",
    },
  });
  const vBody = (await v.json()) as { data: { id: string } };
  return { categoryId: catBody.data.id, vacationId: vBody.data.id };
}

describe("share-token CRUD", () => {
  beforeEach(applyMigrations);

  it("requires auth on the management endpoints", async () => {
    expect((await unauthedFetch("/api/v1/share-tokens")).status).toBe(401);
    expect(
      (
        await unauthedFetch("/api/v1/share-tokens", {
          method: "POST",
          json: { scope: "current-year", label: "x" },
        })
      ).status,
    ).toBe(401);
  });

  it("rejects an invalid scope", async () => {
    const { cookie } = await createTestSession();
    const res = await authedFetch(cookie, "/api/v1/share-tokens", {
      method: "POST",
      json: { scope: "decade", label: "Bob" },
    });
    expect(res.status).toBe(400);
  });

  it("mints, lists, and revokes a share token", async () => {
    const { cookie } = await createTestSession();
    const created = await authedFetch(cookie, "/api/v1/share-tokens", {
      method: "POST",
      json: { scope: "all-years", label: "for spouse" },
    });
    expect(created.status).toBe(201);
    const cBody = (await created.json()) as {
      data: { id: string; share_url: string; scope: string; label: string };
    };
    expect(cBody.data.scope).toBe("all-years");
    expect(cBody.data.label).toBe("for spouse");
    expect(cBody.data.share_url).toMatch(/\/share\/[0-9a-f]{48}$/);

    const list = await authedFetch(cookie, "/api/v1/share-tokens");
    const lBody = (await list.json()) as { data: Array<{ id: string }> };
    expect(lBody.data.map((t) => t.id)).toContain(cBody.data.id);

    const del = await authedFetch(cookie, `/api/v1/share-tokens/${cBody.data.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);

    const after = await authedFetch(cookie, "/api/v1/share-tokens");
    const aBody = (await after.json()) as { data: unknown[] };
    expect(aBody.data).toHaveLength(0);
  });

  it("isolates tokens between users (no IDOR on revoke)", async () => {
    const { cookie: aliceCookie } = await createTestSession({ username: "alice" });
    const { cookie: bobCookie } = await createTestSession({ username: "bob" });
    const created = await authedFetch(aliceCookie, "/api/v1/share-tokens", {
      method: "POST",
      json: { scope: "current-year", label: "alice link" },
    });
    const cBody = (await created.json()) as { data: { id: string } };
    // Bob can't delete Alice's token.
    const del = await authedFetch(bobCookie, `/api/v1/share-tokens/${cBody.data.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(404);
    // Alice's token is still there.
    const list = await authedFetch(aliceCookie, "/api/v1/share-tokens");
    const lBody = (await list.json()) as { data: unknown[] };
    expect(lBody.data).toHaveLength(1);
  });
});

describe("share public dashboard", () => {
  beforeEach(applyMigrations);

  async function mintShare(cookie: string, scope: "current-year" | "all-years") {
    const created = await authedFetch(cookie, "/api/v1/share-tokens", {
      method: "POST",
      json: { scope, label: "test" },
    });
    const cBody = (await created.json()) as { data: { id: string; share_url: string } };
    return new URL(cBody.data.share_url).pathname.replace(/^\/share\//, "");
  }

  it("returns 404 for malformed and unknown tokens (constant-time)", async () => {
    const r1 = await unauthedFetch("/api/v1/share/not-a-token/dashboard");
    expect(r1.status).toBe(404);
    const r2 = await unauthedFetch("/api/v1/share/" + "a".repeat(48) + "/dashboard");
    expect(r2.status).toBe(404);
  });

  it("returns owner display_name + categories + non-cancelled vacations, NEVER internal_desc", async () => {
    const { cookie } = await createTestSession({
      username: "alice",
      display_name: "Alice Example",
    });
    const { vacationId } = await seedDashboard(cookie);

    // Cancel one vacation so we can verify it's filtered out.
    const cats = (await (await authedFetch(cookie, "/api/v1/categories")).json()) as {
      data: Array<{ id: string }>;
    };
    await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: cats.data[0]!.id,
        start_date: "2026-06-01",
        end_date: "2026-06-01",
        partial_amount: null,
        public_desc: "ToCancel",
        internal_desc: "",
      },
    });
    // Cancel the second one we just made (the most recent). Need its id:
    const allV = (await (
      await authedFetch(cookie, "/api/v1/vacations/summary/2026")
    ).json()) as { data: { vacations: Array<{ id: string; public_desc: string }> } };
    const toCancel = allV.data.vacations.find((v) => v.public_desc === "ToCancel")!;
    await authedFetch(cookie, `/api/v1/vacations/${toCancel.id}/cancel`, { method: "POST" });

    const token = await mintShare(cookie, "all-years");
    const res = await unauthedFetch(`/api/v1/share/${token}/dashboard?year=2026`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        owner: { display_name: string };
        scope: string;
        year: number;
        available_years: number[];
        categories: Array<{ category: { name: string } }>;
        vacations: Array<{ id: string; public_desc: string }>;
      };
    };
    expect(body.data.owner.display_name).toBe("Alice Example");
    expect(body.data.scope).toBe("all-years");
    expect(body.data.year).toBe(2026);
    expect(body.data.available_years).toContain(2026);
    expect(body.data.categories[0]!.category.name).toBe("Vacation");
    // Active vacation visible; cancelled one filtered out.
    const ids = body.data.vacations.map((v) => v.id);
    expect(ids).toContain(vacationId);
    expect(ids).not.toContain(toCancel.id);
    // Belt-and-suspenders: serialised payload must not contain the secret
    // notes string anywhere.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("Birthday party for the kid");
    expect(raw).not.toContain("internal_desc");
  });

  it("current-year scope ignores ?year query and resolves to owner's now", async () => {
    const { cookie } = await createTestSession({ username: "carol" });
    await seedDashboard(cookie, 2026);
    const token = await mintShare(cookie, "current-year");
    // Try to coerce a different year via query — server must ignore it.
    const res = await unauthedFetch(`/api/v1/share/${token}/dashboard?year=2099`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { year: number; available_years: number[] } };
    expect(body.data.year).not.toBe(2099);
    // available_years is empty in current-year scope.
    expect(body.data.available_years).toEqual([]);
  });

  it("revoking a token makes the public endpoint 404", async () => {
    const { cookie } = await createTestSession({ username: "dave" });
    await seedDashboard(cookie);
    const token = await mintShare(cookie, "current-year");
    const ok = await unauthedFetch(`/api/v1/share/${token}/dashboard`);
    expect(ok.status).toBe(200);

    // Revoke
    const list = await authedFetch(cookie, "/api/v1/share-tokens");
    const tokenRow = (await list.json()) as { data: Array<{ id: string }> };
    await authedFetch(cookie, `/api/v1/share-tokens/${tokenRow.data[0]!.id}`, {
      method: "DELETE",
    });

    const gone = await unauthedFetch(`/api/v1/share/${token}/dashboard`);
    expect(gone.status).toBe(404);
  });

  it("stamps last_viewed_at when the public endpoint is hit", async () => {
    const { cookie, user } = await createTestSession({ username: "eve" });
    await seedDashboard(cookie);
    const token = await mintShare(cookie, "current-year");
    const before = await env.DB.prepare(
      `SELECT last_viewed_at FROM share_tokens WHERE user_id = ? LIMIT 1`,
    )
      .bind(user.id)
      .first<{ last_viewed_at: string | null }>();
    expect(before?.last_viewed_at).toBeNull();

    const res = await unauthedFetch(`/api/v1/share/${token}/dashboard`);
    expect(res.status).toBe(200);
    // waitUntil is best-effort — give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    const after = await env.DB.prepare(
      `SELECT last_viewed_at FROM share_tokens WHERE user_id = ? LIMIT 1`,
    )
      .bind(user.id)
      .first<{ last_viewed_at: string | null }>();
    expect(after?.last_viewed_at).not.toBeNull();
  });
});

describe("share-tokens in JSON export", () => {
  beforeEach(applyMigrations);

  it("includes share-token metadata but never the secret token value", async () => {
    const { cookie } = await createTestSession({ username: "alice" });
    await authedFetch(cookie, "/api/v1/share-tokens", {
      method: "POST",
      json: { scope: "all-years", label: "for spouse" },
    });
    const res = await authedFetch(cookie, "/api/v1/me/export.json");
    const body = (await res.json()) as {
      share_tokens: Array<{
        id: string;
        scope: string;
        label: string;
        token?: unknown;
        share_url?: unknown;
      }>;
    };
    expect(body.share_tokens).toHaveLength(1);
    expect(body.share_tokens[0]!.scope).toBe("all-years");
    expect(body.share_tokens[0]!.label).toBe("for spouse");
    // Belt-and-suspenders: neither the credential value nor the resolvable
    // URL should appear anywhere in the dump.
    expect(body.share_tokens[0]!.token).toBeUndefined();
    expect(body.share_tokens[0]!.share_url).toBeUndefined();
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/[0-9a-f]{48}/);
  });
});
