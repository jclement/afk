import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, authedFetch, createTestSession } from "./test-utils.js";

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("categories API", () => {
  beforeEach(applyMigrations);

  it("rejects unauthenticated requests", async () => {
    const res = await authedFetch("", "/api/v1/categories");
    expect(res.status).toBe(401);
  });

  it("creates, lists, updates, and deletes a category", async () => {
    const { cookie } = await createTestSession();

    const created = await authedFetch(cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "Vacation", accrues: true },
    });
    expect(created.status).toBe(201);
    const c1 = await readJson<{ data: { id: string; color: string } }>(created);
    expect(c1.data.color).toMatch(/^#[0-9a-f]{6}$/);

    const listed = await authedFetch(cookie, "/api/v1/categories");
    const list = await readJson<{ data: Array<{ id: string }> }>(listed);
    expect(list.data).toHaveLength(1);

    const renamed = await authedFetch(cookie, `/api/v1/categories/${c1.data.id}`, {
      method: "PATCH",
      json: { name: "Holiday" },
    });
    expect(renamed.status).toBe(200);

    const second = await authedFetch(cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "Holiday" },
    });
    expect(second.status).toBe(409);

    const removed = await authedFetch(cookie, `/api/v1/categories/${c1.data.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
  });

  it("rejects bad colors and missing names", async () => {
    const { cookie } = await createTestSession();
    let res = await authedFetch(cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "" },
    });
    expect(res.status).toBe(400);
    res = await authedFetch(cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "X", color: "red" },
    });
    expect(res.status).toBe(400);
  });

  it("upserts allowance for a year and refuses out-of-range values", async () => {
    const { cookie } = await createTestSession();
    const cat = await authedFetch(cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "Vacation", accrues: true },
    });
    const c = await readJson<{ data: { id: string } }>(cat);

    let res = await authedFetch(cookie, `/api/v1/categories/allowances/2026/${c.data.id}`, {
      method: "PUT",
      json: { days_allotted: 30, days_carryover: 2 },
    });
    expect(res.status).toBe(200);

    res = await authedFetch(cookie, `/api/v1/categories/allowances/2026/${c.data.id}`, {
      method: "PUT",
      json: { days_allotted: 1000, days_carryover: 0 },
    });
    expect(res.status).toBe(400);
  });
});
