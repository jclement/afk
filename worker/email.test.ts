/**
 * Email + verification flow tests. Mailgun's send is short-circuited because
 * MAILGUN_API_KEY is unset in the test env (the helper logs and returns
 * `{ skipped: true }`), so we focus on DB state transitions.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, authedFetch, createTestSession, env, unauthedFetch } from "./test-utils.js";

describe("email + verification", () => {
  beforeEach(applyMigrations);

  it("rejects bad email shapes", async () => {
    const { cookie } = await createTestSession();
    const res = await authedFetch(cookie, "/api/v1/me/email", {
      method: "PATCH",
      json: { email: "nope" },
    });
    expect(res.status).toBe(400);
  });

  it("sets a pending email and exposes it in /me", async () => {
    const { cookie } = await createTestSession({ username: "alice" });
    const res = await authedFetch(cookie, "/api/v1/me/email", {
      method: "PATCH",
      json: { email: "Alice@Example.com" },
    });
    expect(res.status).toBe(200);

    const me = await authedFetch(cookie, "/api/v1/auth/me");
    const body = (await me.json()) as { data: { email: string | null; email_verified_at: string | null } };
    expect(body.data.email).toBe("alice@example.com");
    expect(body.data.email_verified_at).toBeNull();
  });

  it("verifies via the public /verify-email/:token route", async () => {
    const { cookie, user } = await createTestSession({ username: "alice" });
    await authedFetch(cookie, "/api/v1/me/email", {
      method: "PATCH",
      json: { email: "alice@example.com" },
    });

    // Pull the token directly out of D1 — the test bypass for "what would
    // have been emailed."
    const row = await env.DB.prepare(
      "SELECT token FROM email_verifications WHERE user_id = ?",
    )
      .bind(user.id)
      .first<{ token: string }>();
    expect(row?.token).toBeTruthy();

    // Verification works without auth (user often clicks the link on a
    // different device).
    const res = await unauthedFetch(`/verify-email/${row!.token}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/email=verified$/);

    const me = await authedFetch(cookie, "/api/v1/auth/me");
    const body = (await me.json()) as { data: { email_verified_at: string | null } };
    expect(body.data.email_verified_at).not.toBeNull();
  });

  it("invalid tokens redirect with email=invalid", async () => {
    const res = await unauthedFetch("/verify-email/totally-bogus-token", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/email=invalid$/);
  });

  it("changing the email re-issues a token and clears verified", async () => {
    const { cookie, user } = await createTestSession({ username: "alice" });
    await authedFetch(cookie, "/api/v1/me/email", {
      method: "PATCH",
      json: { email: "alice@example.com" },
    });
    const first = await env.DB.prepare(
      "SELECT token FROM email_verifications WHERE user_id = ?",
    )
      .bind(user.id)
      .first<{ token: string }>();
    await unauthedFetch(`/verify-email/${first!.token}`, { redirect: "manual" });

    // Change email — should clear verified_at and mint a new token.
    await authedFetch(cookie, "/api/v1/me/email", {
      method: "PATCH",
      json: { email: "alice@new.example.com" },
    });
    const me = await authedFetch(cookie, "/api/v1/auth/me");
    const body = (await me.json()) as { data: { email: string; email_verified_at: string | null } };
    expect(body.data.email).toBe("alice@new.example.com");
    expect(body.data.email_verified_at).toBeNull();

    const next = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_verifications WHERE user_id = ?",
    )
      .bind(user.id)
      .first<{ n: number }>();
    expect(next?.n).toBe(1);
  });

  it("DELETE /me/email clears email and pending tokens", async () => {
    const { cookie, user } = await createTestSession({ username: "alice" });
    await authedFetch(cookie, "/api/v1/me/email", {
      method: "PATCH",
      json: { email: "alice@example.com" },
    });

    const res = await authedFetch(cookie, "/api/v1/me/email", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const me = await authedFetch(cookie, "/api/v1/auth/me");
    const body = (await me.json()) as { data: { email: string | null } };
    expect(body.data.email).toBeNull();

    const pending = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_verifications WHERE user_id = ?",
    )
      .bind(user.id)
      .first<{ n: number }>();
    expect(pending?.n).toBe(0);
  });
});

describe("vacation invite plumbing", () => {
  beforeEach(applyMigrations);

  it("bumps ical_sequence on update / cancel / uncancel", async () => {
    const { cookie } = await createTestSession({ username: "alice" });
    const cat = await authedFetch(cookie, "/api/v1/categories", {
      method: "POST",
      json: { name: "Vacation", accrues: true },
    });
    const cId = ((await cat.json()) as { data: { id: string } }).data.id;
    await authedFetch(cookie, `/api/v1/categories/allowances/2026/${cId}`, {
      method: "PUT",
      json: { days_allotted: 30, days_carryover: 0 },
    });
    const created = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: cId,
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        partial_amount: null,
        public_desc: "",
        internal_desc: "",
      },
    });
    const v = (await created.json()) as { data: { id: string; ical_sequence: number } };
    expect(v.data.ical_sequence).toBe(0);

    const updated = await authedFetch(cookie, `/api/v1/vacations/${v.data.id}`, {
      method: "PATCH",
      json: { public_desc: "Updated" },
    });
    const u = (await updated.json()) as { data: { ical_sequence: number } };
    expect(u.data.ical_sequence).toBe(1);

    const cancelled = await authedFetch(
      cookie,
      `/api/v1/vacations/${v.data.id}/cancel`,
      { method: "POST" },
    );
    const cd = (await cancelled.json()) as { data: { ical_sequence: number } };
    expect(cd.data.ical_sequence).toBe(2);

    const uncancelled = await authedFetch(
      cookie,
      `/api/v1/vacations/${v.data.id}/uncancel`,
      { method: "POST" },
    );
    const un = (await uncancelled.json()) as { data: { ical_sequence: number } };
    expect(un.data.ical_sequence).toBe(3);
  });
});
