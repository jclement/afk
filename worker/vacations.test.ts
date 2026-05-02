import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, authedFetch, createTestSession } from "./test-utils.js";

async function setup() {
  const { cookie } = await createTestSession();
  const cat = await authedFetch(cookie, "/api/v1/categories", {
    method: "POST",
    json: { name: "Vacation", accrues: true },
  });
  const cBody = (await cat.json()) as { data: { id: string } };
  await authedFetch(
    cookie,
    `/api/v1/categories/allowances/2026/${cBody.data.id}`,
    {
      method: "PUT",
      json: { days_allotted: 30, days_carryover: 2 },
    },
  );
  return { cookie, categoryId: cBody.data.id };
}

describe("vacations API", () => {
  beforeEach(applyMigrations);

  it("creates a single full-day entry and reflects it in the summary", async () => {
    const { cookie, categoryId } = await setup();
    const res = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04", // Mon
        end_date: "2026-05-04",
        partial_amount: null,
        public_desc: "Out",
        internal_desc: "",
      },
    });
    expect(res.status).toBe(201);

    const summary = await authedFetch(cookie, "/api/v1/vacations/summary/2026");
    const body = (await summary.json()) as {
      data: { categories: Array<{ used_days: number; remaining_days: number; total_days: number }> };
    };
    expect(body.data.categories[0]!.used_days).toBe(1);
    expect(body.data.categories[0]!.total_days).toBe(32);
    expect(body.data.categories[0]!.remaining_days).toBe(31);
  });

  it("rejects partial-day on a multi-day entry", async () => {
    const { cookie, categoryId } = await setup();
    const res = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        partial_amount: 0.5,
        public_desc: "",
        internal_desc: "",
      },
    });
    expect(res.status).toBe(400);
  });

  it("rejects partial on a weekend", async () => {
    const { cookie, categoryId } = await setup();
    const res = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-09", // Sat
        end_date: "2026-05-09",
        partial_amount: 0.5,
        public_desc: "",
        internal_desc: "",
      },
    });
    expect(res.status).toBe(400);
  });

  it("supports cancel, uncancel, and delete with proper accounting", async () => {
    const { cookie, categoryId } = await setup();
    const create = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        partial_amount: null,
        public_desc: "",
        internal_desc: "",
      },
    });
    const v = (await create.json()) as { data: { id: string } };

    const cancel = await authedFetch(cookie, `/api/v1/vacations/${v.data.id}/cancel`, {
      method: "POST",
    });
    expect(cancel.status).toBe(200);

    let summary = await authedFetch(cookie, "/api/v1/vacations/summary/2026");
    let body = (await summary.json()) as {
      data: { categories: Array<{ used_days: number }> };
    };
    expect(body.data.categories[0]!.used_days).toBe(0);

    // Restore — usage should come back.
    const uncancel = await authedFetch(
      cookie,
      `/api/v1/vacations/${v.data.id}/uncancel`,
      { method: "POST" },
    );
    expect(uncancel.status).toBe(200);
    const restored = (await uncancel.json()) as { data: { cancelled_at: string | null } };
    expect(restored.data.cancelled_at).toBeNull();

    summary = await authedFetch(cookie, "/api/v1/vacations/summary/2026");
    body = (await summary.json()) as {
      data: { categories: Array<{ used_days: number }> };
    };
    expect(body.data.categories[0]!.used_days).toBe(5);

    const del = await authedFetch(cookie, `/api/v1/vacations/${v.data.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
  });

  it("isolates vacations between users (no IDOR)", async () => {
    const userA = await createTestSession({ username: "a" });
    const userB = await createTestSession({ username: "b" });

    const cat = await authedFetch(userA.cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "Vacation" },
    });
    const cId = (await cat.json() as { data: { id: string } }).data.id;
    await authedFetch(userA.cookie, `/api/v1/categories/allowances/2026/${cId}`, {
      method: "PUT",
      json: { days_allotted: 10, days_carryover: 0 },
    });
    const created = await authedFetch(userA.cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: cId,
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: null,
        public_desc: "",
        internal_desc: "",
      },
    });
    const v = (await created.json()) as { data: { id: string } };

    // User B should not be able to see / cancel / delete user A's vacation.
    const stolen = await authedFetch(userB.cookie, `/api/v1/vacations/${v.data.id}`);
    expect(stolen.status).toBe(404);
    const cancelled = await authedFetch(
      userB.cookie,
      `/api/v1/vacations/${v.data.id}/cancel`,
      { method: "POST" },
    );
    expect(cancelled.status).toBe(404);
    const deleted = await authedFetch(userB.cookie, `/api/v1/vacations/${v.data.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(404);
  });
});
