import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, authedFetch, createTestSession, unauthedFetch } from "./test-utils.js";

async function setup() {
  const { cookie, user } = await createTestSession({ username: "jeff", display_name: "Jeff" });
  const cat = await authedFetch(cookie, "/api/v1/categories", {
    method: "POST",
    json: { name: "Vacation", accrues: true },
  });
  const cBody = (await cat.json()) as { data: { id: string } };
  await authedFetch(cookie, `/api/v1/categories/allowances/2026/${cBody.data.id}`, {
    method: "PUT",
    json: { days_allotted: 30, days_carryover: 0 },
  });
  await authedFetch(cookie, "/api/v1/vacations", {
    method: "POST",
    json: {
      category_id: cBody.data.id,
      start_date: "2026-05-04",
      end_date: "2026-05-08",
      partial_amount: null,
      public_desc: "Beach",
      internal_desc: "Booked the cabin.",
    },
  });
  return { cookie, user };
}

describe("iCal feeds", () => {
  beforeEach(applyMigrations);

  it("creates and serves a public feed (no internal_desc leak)", async () => {
    const { cookie } = await setup();
    const created = await authedFetch(cookie, "/api/v1/ical-tokens", {
      method: "POST",
      json: { scope: "public", label: "manager" },
    });
    expect(created.status).toBe(201);
    const tBody = (await created.json()) as { data: { feed_url: string } };
    const url = new URL(tBody.data.feed_url);

    const res = await unauthedFetch(url.pathname);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("Beach");
    // public feed must NOT include the internal description
    expect(text).not.toContain("Booked the cabin");
  });

  it("private feed includes internal_desc and category", async () => {
    const { cookie } = await setup();
    const created = await authedFetch(cookie, "/api/v1/ical-tokens", {
      method: "POST",
      json: { scope: "private", label: "me" },
    });
    const tBody = (await created.json()) as { data: { feed_url: string } };
    const url = new URL(tBody.data.feed_url);
    const res = await unauthedFetch(url.pathname);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Booked the cabin");
    expect(text).toContain("[Vacation]");
  });

  it("returns 404 for an unknown token", async () => {
    const res = await unauthedFetch("/ical/nope.ics");
    expect(res.status).toBe(404);
  });

  it("revoking a token makes the feed disappear", async () => {
    const { cookie } = await setup();
    const created = await authedFetch(cookie, "/api/v1/ical-tokens", {
      method: "POST",
      json: { scope: "public", label: "tmp" },
    });
    const tBody = (await created.json()) as { data: { id: string; feed_url: string } };
    const path = new URL(tBody.data.feed_url).pathname;

    const ok = await unauthedFetch(path);
    expect(ok.status).toBe(200);

    const del = await authedFetch(cookie, `/api/v1/ical-tokens/${tBody.data.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);

    const gone = await unauthedFetch(path);
    expect(gone.status).toBe(404);
  });
});
