/**
 * Account deletion — cascade integrity. We can't drive the WebAuthn
 * assertion through Hono in a unit test (the client-side ceremony is what
 * mints the response payload), so the route-level test focuses on the
 * validation gates (typed phrase, missing reauth) and the lib-level test
 * exercises `deleteUserAndAllData` directly to assert the cascade.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, authedFetch, createTestSession, env } from "./test-utils.js";
import { deleteUserAndAllData, startEmailChange } from "./lib/users.js";
import { regenerateRecoveryCodes } from "./lib/recovery.js";
import { createICalToken, createShareToken } from "./lib/store.js";
import { newICalToken, newShareToken } from "./lib/ids.js";

describe("DELETE /api/v1/me/account", () => {
  beforeEach(applyMigrations);

  it("rejects without the typed phrase", async () => {
    const { cookie } = await createTestSession();
    const res = await authedFetch(cookie, "/api/v1/me/account", {
      method: "DELETE",
      json: { confirm: "delete me" }, // wrong case
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/DELETE MY ACCOUNT/);
  });

  it("rejects with the phrase but no passkey reauth payload", async () => {
    const { cookie } = await createTestSession();
    const res = await authedFetch(cookie, "/api/v1/me/account", {
      method: "DELETE",
      json: { confirm: "DELETE MY ACCOUNT" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Passkey/);
  });
});

describe("deleteUserAndAllData cascade", () => {
  beforeEach(applyMigrations);

  it("wipes every user-owned row across every table", async () => {
    const { user, cookie } = await createTestSession({ username: "doomed" });

    // Populate every table that hangs off users(id).
    await startEmailChange(env.DB, user.id, "doomed@example.com");
    await regenerateRecoveryCodes(env.DB, user.id);
    await createICalToken(env.DB, user.id, {
      scope: "private",
      label: "test",
      token: newICalToken(),
    });
    await createShareToken(env.DB, user.id, {
      scope: "current-year",
      label: "test",
      token: newShareToken(),
    });
    const cat = await authedFetch(cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "Vacation", accrues: false },
    });
    const catId = ((await cat.json()) as { data: { id: string } }).data.id;
    await authedFetch(cookie, `/api/v1/categories/allowances/2026/${catId}`, {
      method: "PUT",
      json: { days_allotted: 20, days_carryover: 0 },
    });
    await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: catId,
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        partial_amount: null,
        public_desc: "x",
        internal_desc: "y",
      },
    });

    // Sanity: rows exist BEFORE the delete.
    for (const t of [
      "users",
      "credentials",
      "sessions",
      "categories",
      "allowances",
      "vacations",
      "ical_tokens",
      "share_tokens",
      "email_verifications",
      "recovery_codes",
    ]) {
      const r = await env.DB.prepare(
        t === "users"
          ? `SELECT COUNT(*) AS n FROM users WHERE id = ?`
          : `SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`,
      )
        .bind(user.id)
        .first<{ n: number }>();
      // sessions exists from createTestSession; credentials is empty (no
      // passkey was registered in this synthetic flow) — that's fine.
      if (t === "credentials") continue;
      expect(r?.n ?? 0).toBeGreaterThan(0);
    }

    await deleteUserAndAllData(env.DB, user.id);

    for (const t of [
      "credentials",
      "sessions",
      "categories",
      "allowances",
      "vacations",
      "ical_tokens",
      "share_tokens",
      "email_verifications",
      "recovery_codes",
      "boss_relationships",
    ]) {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`)
        .bind(user.id)
        .first<{ n: number }>();
      expect(r?.n ?? 0).toBe(0);
    }
    const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(user.id).first();
    expect(u).toBeNull();
  });
});
