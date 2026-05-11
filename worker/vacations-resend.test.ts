/**
 * Vacation email log + manual resend endpoint tests.
 *
 * Covers:
 *   - Lifecycle sends write log rows (success path, with a Mailgun id).
 *   - GET /:id/email-log returns the log scoped to the requesting user.
 *   - POST /:id/resend to 'self', 'boss', 'both' fires the right number
 *     of sends and records each one as `resend=true`.
 *   - Boss in notify mode resends a PUBLISH iCal; in approval mode +
 *     pending vacation, resends the approval-request magic link.
 *   - 400 when the user has no consented manager but asks to send to boss.
 *   - Failed Mailgun send is captured in the log with an `error` string.
 *   - IDOR — another user can't view or resend on this vacation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMigrations,
  authedFetch,
  createTestSession,
  env,
  unauthedFetch,
} from "./test-utils.js";

interface SentMail {
  to: string;
  subject: string;
  text: string;
}

const sent: SentMail[] = [];
let mailgunStatus = 200;
let mailgunFailureMessage = "";

beforeEach(async () => {
  await applyMigrations();
  sent.length = 0;
  mailgunStatus = 200;
  mailgunFailureMessage = "";
  (env as { MAILGUN_API_KEY?: string }).MAILGUN_API_KEY = "test-key";
  (env as { MAILGUN_DOMAIN?: string }).MAILGUN_DOMAIN = "mg.example.com";

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("mailgun.net")) {
      const fd = init?.body as FormData;
      const to = String(fd.get("to") ?? "");
      let subject: string;
      let text: string;
      if (url.endsWith("/messages.mime")) {
        const blob = fd.get("message") as Blob;
        text = await blob.text();
        subject = /^Subject:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
      } else {
        subject = String(fd.get("subject") ?? "");
        text = String(fd.get("text") ?? "");
      }
      sent.push({ to, subject, text });
      if (mailgunStatus !== 200) {
        return new Response(mailgunFailureMessage, { status: mailgunStatus });
      }
      return new Response(JSON.stringify({ id: `<test-${sent.length}@mg>` }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setupUserAndCategory(opts?: { username?: string }) {
  const { cookie, user } = await createTestSession({
    username: opts?.username ?? "alice",
    display_name: "Alice Example",
  });
  await env.DB.prepare(
    `UPDATE users SET email = ?, email_verified_at = datetime('now') WHERE id = ?`,
  )
    .bind("alice@example.com", user.id)
    .run();
  const cat = await authedFetch(cookie, "/api/v1/categories", {
    method: "POST",
    json: { name: "Vacation", accrues: false },
  });
  const cId = ((await cat.json()) as { data: { id: string } }).data.id;
  await authedFetch(cookie, `/api/v1/categories/allowances/2026/${cId}`, {
    method: "PUT",
    json: { days_allotted: 20, days_carryover: 0 },
  });
  return { cookie, userId: user.id, categoryId: cId };
}

async function createBookedVacation(cookie: string, categoryId: string): Promise<string> {
  const res = await authedFetch(cookie, "/api/v1/vacations", {
    method: "POST",
    json: {
      category_id: categoryId,
      start_date: "2026-05-04",
      end_date: "2026-05-04",
      partial_amount: null,
      public_desc: "OOO",
      internal_desc: "",
    },
  });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

async function consentBoss(cookie: string, userId: string, mode: "notify" | "approval") {
  await authedFetch(cookie, "/api/v1/boss", {
    method: "PUT",
    json: { boss_email: "manager@example.com", mode },
  });
  // The consent token is hashed at rest; scrape from the captured email.
  await new Promise((r) => setTimeout(r, 5));
  let token: string | undefined;
  for (let i = 0; i < 20 && !token; i++) {
    for (const m of sent) {
      const match = /\/boss\/consent\/([0-9a-f]{64})/.exec(m.text);
      if (match) {
        token = match[1];
        break;
      }
    }
    if (!token) await new Promise((r) => setTimeout(r, 5));
  }
  if (!token) throw new Error("consent token not captured in email");
  await unauthedFetch(`/boss/consent/${token}`, { method: "POST" });
  // Drain so subsequent assertions only see resend output.
  void userId;
}

describe("vacation email log", () => {
  it("lifecycle send writes a row tagged resend=0 with a mailgun message id", async () => {
    const { cookie, categoryId } = await setupUserAndCategory();
    const vId = await createBookedVacation(cookie, categoryId);
    // waitUntil in the test harness drops the callback; pump the loop
    // long enough for the in-flight fetch to settle and the log to land.
    await new Promise((r) => setTimeout(r, 20));

    const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/email-log`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const userRow = body.data.find((r) => r.recipient === "self");
    expect(userRow).toBeDefined();
    expect(userRow!.kind).toBe("lifecycle");
    expect(userRow!.method).toBe("PUBLISH");
    expect(userRow!.resend).toBe(false);
    expect(userRow!.mailgun_message_id).toMatch(/^<test-/);
    expect(userRow!.error).toBeNull();
  });

  it("captures Mailgun error in the log when send fails", async () => {
    const { cookie, categoryId } = await setupUserAndCategory();
    mailgunStatus = 500;
    mailgunFailureMessage = "Internal Server Error";
    const vId = await createBookedVacation(cookie, categoryId);
    await new Promise((r) => setTimeout(r, 20));

    const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/email-log`);
    const body = (await res.json()) as { data: Array<{ error: string | null }> };
    const failed = body.data.filter((r) => r.error !== null);
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0]!.error).toMatch(/Mailgun send failed \(500\)/);
  });

  it("IDOR: another user cannot read the log or trigger a resend", async () => {
    const a = await setupUserAndCategory({ username: "alice" });
    const b = await setupUserAndCategory({ username: "bob" });
    const vId = await createBookedVacation(a.cookie, a.categoryId);
    await new Promise((r) => setTimeout(r, 20));

    expect((await authedFetch(b.cookie, `/api/v1/vacations/${vId}/email-log`)).status).toBe(404);
    const resend = await authedFetch(b.cookie, `/api/v1/vacations/${vId}/resend`, {
      method: "POST",
      json: { to: "self" },
    });
    expect(resend.status).toBe(404);
  });
});

describe("POST /vacations/:id/resend", () => {
  it("validates `to` against the allowed enum", async () => {
    const { cookie, categoryId } = await setupUserAndCategory();
    const vId = await createBookedVacation(cookie, categoryId);
    for (const bad of ["", "boss-only", "everyone", undefined]) {
      const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/resend`, {
        method: "POST",
        json: bad === undefined ? {} : { to: bad },
      });
      expect(res.status).toBe(400);
    }
  });

  it("to=self re-sends to the user only and tags the log resend=1", async () => {
    const { cookie, categoryId } = await setupUserAndCategory();
    const vId = await createBookedVacation(cookie, categoryId);
    await new Promise((r) => setTimeout(r, 10));
    sent.length = 0;

    const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/resend`, {
      method: "POST",
      json: { to: "self" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        results: Array<{ recipient: string; error?: string; mailgun_message_id?: string }>;
        log: Array<{ recipient: string; resend: boolean }>;
      };
    };
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]!.recipient).toBe("self");
    expect(body.data.results[0]!.error).toBeUndefined();
    expect(body.data.results[0]!.mailgun_message_id).toMatch(/^<test-/);
    // Captured Mailgun call hit the user, not the manager.
    expect(sent.some((m) => m.to === "alice@example.com")).toBe(true);
    expect(sent.some((m) => m.to === "manager@example.com")).toBe(false);

    // Both rows have datetime('now') second-resolution timestamps and may
    // land in the same second, so the DESC ordering is a tie — instead of
    // relying on `[0]` order, assert that BOTH the lifecycle row and the
    // manual-resend row are present.
    const selfRows = body.data.log.filter((r) => r.recipient === "self");
    expect(selfRows.some((r) => r.resend === true)).toBe(true);
    expect(selfRows.some((r) => r.resend === false)).toBe(true);
  });

  it("to=boss fails with 400 when no consented manager exists", async () => {
    const { cookie, categoryId } = await setupUserAndCategory();
    const vId = await createBookedVacation(cookie, categoryId);
    const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/resend`, {
      method: "POST",
      json: { to: "boss" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/manager/i);
  });

  it("to=boss in notify mode sends a PUBLISH iCal and logs notify_invite", async () => {
    const { cookie, userId, categoryId } = await setupUserAndCategory();
    await consentBoss(cookie, userId, "notify");
    const vId = await createBookedVacation(cookie, categoryId);
    await new Promise((r) => setTimeout(r, 20));
    sent.length = 0;

    const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/resend`, {
      method: "POST",
      json: { to: "boss" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        results: Array<{ recipient: string; kind: string; method: string | null }>;
      };
    };
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]).toMatchObject({
      recipient: "boss",
      kind: "notify_invite",
      method: "PUBLISH",
    });
    expect(sent.some((m) => m.to === "manager@example.com")).toBe(true);
  });

  it("to=both in notify mode fires both sends and logs both as resends", async () => {
    const { cookie, userId, categoryId } = await setupUserAndCategory();
    await consentBoss(cookie, userId, "notify");
    const vId = await createBookedVacation(cookie, categoryId);
    await new Promise((r) => setTimeout(r, 20));
    sent.length = 0;

    const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/resend`, {
      method: "POST",
      json: { to: "both" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { results: Array<{ recipient: string }> };
    };
    expect(body.data.results.map((r) => r.recipient).sort()).toEqual(["boss", "self"]);
    expect(sent.some((m) => m.to === "alice@example.com")).toBe(true);
    expect(sent.some((m) => m.to === "manager@example.com")).toBe(true);
  });

  it("to=boss in approval mode + pending vacation re-mints + resends approval-request", async () => {
    const { cookie, userId, categoryId } = await setupUserAndCategory();
    await consentBoss(cookie, userId, "approval");
    const vId = await createBookedVacation(cookie, categoryId);
    await new Promise((r) => setTimeout(r, 20));

    // Capture the initial decision token from the create-time email.
    const firstApproval = sent.find((m) => /\/boss\/approve\//.test(m.text));
    expect(firstApproval).toBeDefined();
    const firstToken = /\/boss\/approve\/([0-9a-f]{64})/.exec(firstApproval!.text)![1]!;

    sent.length = 0;
    const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/resend`, {
      method: "POST",
      json: { to: "boss" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { results: Array<{ kind: string }> };
    };
    expect(body.data.results[0]!.kind).toBe("approval_request");
    // New magic link was minted and emailed; the old one no longer works.
    const second = sent.find((m) => /\/boss\/approve\//.test(m.text));
    expect(second).toBeDefined();
    const secondToken = /\/boss\/approve\/([0-9a-f]{64})/.exec(second!.text)![1]!;
    expect(secondToken).not.toBe(firstToken);
    // Old link 404s.
    const stale = await unauthedFetch(`/boss/approve/${firstToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "action=approve",
    });
    expect(stale.status).toBe(404);
  });

  it("to=boss after cancel sends a CANCEL iCal to the boss", async () => {
    const { cookie, userId, categoryId } = await setupUserAndCategory();
    await consentBoss(cookie, userId, "notify");
    const vId = await createBookedVacation(cookie, categoryId);
    await authedFetch(cookie, `/api/v1/vacations/${vId}/cancel`, { method: "POST" });
    await new Promise((r) => setTimeout(r, 20));
    sent.length = 0;

    const res = await authedFetch(cookie, `/api/v1/vacations/${vId}/resend`, {
      method: "POST",
      json: { to: "boss" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { results: Array<{ method: string | null }> };
    };
    expect(body.data.results[0]!.method).toBe("CANCEL");
  });
});
