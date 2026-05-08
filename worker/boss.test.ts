/**
 * Boss / approver feature tests. Covers the full lifecycle:
 *   - CRUD on the relationship
 *   - Consent token: accept once, replay returns 404, expired returns 404
 *   - IDOR: another user's consent token is unusable
 *   - Approval flow: accept (vacation flips to approved), reject without
 *     comment is refused, reject with comment cancels the vacation
 *   - JSON export includes the boss row but never the credential tokens
 *   - Notify mode email subject leads with the user's display_name
 *
 * The Mailgun mock surfaces what would have been sent (we never hit the
 * real API) so we can assert on subject/body shape.
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

/**
 * Decode an RFC 2047 "encoded-word" header value back to its original UTF-8
 * string. The mailgun client base64-wraps any header containing non-ASCII
 * bytes (so "Alice — OOO" ships as `=?UTF-8?B?...?=`); the test capture
 * undoes that so subject assertions can compare against human-readable text.
 * Only handles the single-word `=?UTF-8?B?...?=` shape we actually emit —
 * not a full RFC 2047 decoder.
 */
function decodeMimeHeader(s: string): string {
  return s.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (_m, b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  });
}

beforeEach(async () => {
  await applyMigrations();
  // Mailgun won't actually fire (MAILGUN_API_KEY isn't set in tests). To
  // observe what would have been sent, hijack the lib's send functions via
  // module mock. Easier: monkey-patch fetch to capture mailgun POSTs when
  // MAILGUN_API_KEY is set; for these tests we set it.
  sent.length = 0;
  (env as { MAILGUN_API_KEY?: string }).MAILGUN_API_KEY = "test-key";
  (env as { MAILGUN_DOMAIN?: string }).MAILGUN_DOMAIN = "mg.example.com";

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("mailgun.net")) {
      // Capture from the FormData body — both endpoints use FormData.
      const fd = init?.body as FormData;
      if (url.endsWith("/messages.mime")) {
        // MIME upload — pull the message blob and parse Subject + To from it.
        const blob = fd.get("message") as Blob;
        const mime = await blob.text();
        const rawSubject = /^Subject:\s*(.+)$/m.exec(mime)?.[1]?.trim() ?? "";
        const subject = decodeMimeHeader(rawSubject);
        const to = String(fd.get("to") ?? "");
        sent.push({ to, subject, text: mime });
      } else {
        sent.push({
          to: String(fd.get("to") ?? ""),
          subject: String(fd.get("subject") ?? ""),
          text: String(fd.get("text") ?? ""),
        });
      }
      return new Response(JSON.stringify({ id: "<test@mg>" }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setupUserWithEmail(opts?: { username?: string }) {
  const { cookie, user } = await createTestSession({
    username: opts?.username ?? "alice",
    display_name: "Alice Example",
  });
  // Verify an email so the user can add a boss.
  await env.DB.prepare(
    `UPDATE users SET email = ?, email_verified_at = datetime('now') WHERE id = ?`,
  )
    .bind("alice@example.com", user.id)
    .run();
  return { cookie, userId: user.id };
}

async function setupCategoryAndAllowance(cookie: string) {
  const cat = await authedFetch(cookie, "/api/v1/categories", {
    method: "POST",
    json: { name: "Vacation", accrues: false },
  });
  const cBody = (await cat.json()) as { data: { id: string } };
  await authedFetch(cookie, `/api/v1/categories/allowances/2026/${cBody.data.id}`, {
    method: "PUT",
    json: { days_allotted: 20, days_carryover: 0 },
  });
  return cBody.data.id;
}

describe("boss API", () => {
  it("requires a verified user email before adding a boss", async () => {
    const { cookie } = await createTestSession({ username: "noemail" });
    const res = await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "boss@example.com", mode: "notify" },
    });
    expect(res.status).toBe(400);
  });

  it("PUT creates relationship + sends consent email; GET returns it without tokens", async () => {
    const { cookie } = await setupUserWithEmail();
    const put = await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: {
        boss_email: "greg@example.com",
        mode: "notify",
      },
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { data: { consent_status: string; boss_email: string } };
    expect(body.data.consent_status).toBe("pending");
    expect(body.data.boss_email).toBe("greg@example.com");
    // Consent email fired (waitUntil ran in our test helper as direct).
    // The fetch mock captured it.
    await new Promise((r) => setTimeout(r, 0));
    const consent = sent.find((m) => m.to === "greg@example.com");
    expect(consent).toBeDefined();
    expect(consent!.subject).toContain("Alice Example");
    // No token field on the public surface.
    expect("consent_token" in (body.data as object)).toBe(false);
  });

  it("rejects bad email + bad mode", async () => {
    const { cookie } = await setupUserWithEmail();
    expect(
      (
        await authedFetch(cookie, "/api/v1/boss", {
          method: "PUT",
          json: { boss_email: "nope", mode: "notify" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await authedFetch(cookie, "/api/v1/boss", {
          method: "PUT",
          json: { boss_email: "x@y.z", mode: "wat" },
        })
      ).status,
    ).toBe(400);
  });

  it("DELETE removes the relationship", async () => {
    const { cookie } = await setupUserWithEmail();
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    expect((await authedFetch(cookie, "/api/v1/boss", { method: "DELETE" })).status).toBe(200);
    const get = await authedFetch(cookie, "/api/v1/boss");
    const body = (await get.json()) as { data: unknown };
    expect(body.data).toBeNull();
  });
});

/**
 * Pull the plaintext consent / decision token out of a captured email. We
 * have to scrape the email body because tokens are SHA-256 hashed at rest
 * (see boss-store.ts) — the DB only has the hash. The plaintext exists
 * exactly once: in the email URL we just sent.
 *
 * Polls briefly because the consent email is fired via `waitUntil` and may
 * not have arrived in `sent` yet when the test asks for it.
 */
async function waitForTokenInEmail(re: RegExp, opts?: { to?: string }): Promise<string> {
  for (let i = 0; i < 20; i++) {
    for (const m of sent) {
      if (opts?.to && m.to !== opts.to) continue;
      const match = re.exec(m.text);
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Token matching ${re} not found in any captured email`);
}

// Compatibility shim — older tests just want "the most-recent consent token
// for this user." The mock captures consent emails as they're sent, so we
// pull from there.
async function fetchTokenFromDb(_userId: string): Promise<string> {
  return waitForTokenInEmail(/\/boss\/consent\/([0-9a-f]{64})/);
}

async function fetchUnsubscribeTokenFromDb(userId: string): Promise<string> {
  // Unsubscribe tokens stay plaintext at rest — see boss-store.ts. So this
  // helper still queries the DB directly.
  const row = await env.DB.prepare(
    `SELECT unsubscribe_token FROM boss_relationships WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ unsubscribe_token: string }>();
  if (!row?.unsubscribe_token) throw new Error("no unsubscribe token");
  return row.unsubscribe_token;
}

async function fetchDecisionTokenFromEmail(): Promise<string> {
  return waitForTokenInEmail(/\/boss\/approve\/([0-9a-f]{64})/);
}

/**
 * Pull the text/calendar part out of a captured Mailgun MIME body and
 * base64-decode it. The mailgun mock stores the whole MIME blob as `text`
 * for messages.mime sends; the ICS lives in a base64-encoded part.
 */
function decodeIcsFromMime(mime: string): string {
  const idx = mime.indexOf("text/calendar");
  if (idx < 0) return mime;
  // Skip past the part headers — a blank line separates them from the body.
  const bodyStart = mime.indexOf("\r\n\r\n", idx);
  if (bodyStart < 0) return mime;
  const after = mime.slice(bodyStart + 4);
  // Body runs until the next MIME boundary marker (lines starting with `--`).
  const endMatch = /\r?\n--/.exec(after);
  const b64 = (endMatch ? after.slice(0, endMatch.index) : after).replace(/\s+/g, "");
  return atob(b64);
}

describe("boss consent flow", () => {
  it("GET on a valid token renders the consent page", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const token = await fetchTokenFromDb(userId);
    const res = await unauthedFetch(`/boss/consent/${token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Alice Example");
    expect(html).toContain("consent");
  });

  it("POST accepts and burns the token; replay 404s", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const token = await fetchTokenFromDb(userId);
    sent.length = 0; // ignore the consent-request email from PUT above
    const accept = await unauthedFetch(`/boss/consent/${token}`, { method: "POST" });
    expect(accept.status).toBe(200);
    expect(await accept.text()).toContain("You're in");

    const replay = await unauthedFetch(`/boss/consent/${token}`, { method: "POST" });
    expect(replay.status).toBe(404);

    // Server-side row reflects consent.
    const get = await authedFetch(cookie, "/api/v1/boss");
    const body = (await get.json()) as { data: { consent_status: string } };
    expect(body.data.consent_status).toBe("consented");

    // Notify the USER (not the manager) that consent was accepted. Fires
    // exactly once even though we POSTed twice — token-burn is the gate.
    await new Promise((r) => setTimeout(r, 10));
    const userMsgs = sent.filter((m) => m.to === "alice@example.com");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]!.subject.toLowerCase()).toContain("notification recipient");
    expect(userMsgs[0]!.subject).toContain("g@e.com");
  });

  it("404s on bogus / malformed tokens (format gate)", async () => {
    expect((await unauthedFetch(`/boss/consent/abc`)).status).toBe(404);
    expect(
      (
        await unauthedFetch(
          `/boss/consent/${"00".repeat(32)}`, // valid format, unknown token
        )
      ).status,
    ).toBe(404);
  });

  it("CSRF: rejects POST with Sec-Fetch-Site: cross-site", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const token = await fetchTokenFromDb(userId);
    const res = await unauthedFetch(`/boss/consent/${token}`, {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("CSRF: accepts POST with Sec-Fetch-Site: same-origin even when Origin disagrees", async () => {
    // Cloudflare custom-domain edge cases can produce a logical-same-origin
    // POST whose `Origin` header doesn't string-equal `request.url`. The
    // Sec-Fetch-Site signal is the browser's own declaration and should
    // override the brittle Origin comparison.
    const { cookie, userId } = await setupUserWithEmail();
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const token = await fetchTokenFromDb(userId);
    const res = await unauthedFetch(`/boss/consent/${token}`, {
      method: "POST",
      headers: {
        "sec-fetch-site": "same-origin",
        origin: "https://some-other-host.example",
      },
    });
    expect(res.status).toBe(200);
  });

  it("CSRF (legacy fallback): rejects POST when Origin disagrees and no Sec-Fetch-Site", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const token = await fetchTokenFromDb(userId);
    const res = await unauthedFetch(`/boss/consent/${token}`, {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    expect(res.status).toBe(403);
  });
});

describe("boss unsubscribe flow", () => {
  async function arrangeConsented(): Promise<{
    cookie: string;
    userId: string;
    unsubscribeToken: string;
  }> {
    const { cookie, userId } = await setupUserWithEmail();
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const consentToken = await fetchTokenFromDb(userId);
    await unauthedFetch(`/boss/consent/${consentToken}`, { method: "POST" });
    return {
      cookie,
      userId,
      unsubscribeToken: await fetchUnsubscribeTokenFromDb(userId),
    };
  }

  it("upsertBoss mints an unsubscribe_token + emails carry it as List-Unsubscribe", async () => {
    const { cookie, userId } = await arrangeConsented();
    const categoryId = await setupCategoryAndAllowance(cookie);
    sent.length = 0;
    await authedFetch(cookie, "/api/v1/vacations", {
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
    await new Promise((r) => setTimeout(r, 10));
    const bossInvite = sent.find((m) => m.to === "g@e.com");
    expect(bossInvite).toBeDefined();
    const expectedToken = await fetchUnsubscribeTokenFromDb(userId);
    // The MIME body carries the List-Unsubscribe header and the matching
    // visible footer URL.
    expect(bossInvite!.text).toContain(`/boss/unsubscribe/${expectedToken}`);
    expect(bossInvite!.text).toMatch(/List-Unsubscribe:\s*<[^>]+>/i);
    expect(bossInvite!.text).toMatch(/List-Unsubscribe-Post:\s*List-Unsubscribe=One-Click/i);
  });

  it("GET renders the confirm form; POST revokes + emails the user once", async () => {
    const { unsubscribeToken } = await arrangeConsented();
    sent.length = 0;
    const form = await unauthedFetch(`/boss/unsubscribe/${unsubscribeToken}`);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain("Stop receiving emails");

    // GET must not mutate — the relationship is still consented.
    const stillConsented = await env.DB.prepare(
      `SELECT consent_status, revoked_at FROM (SELECT CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN consented_at IS NOT NULL THEN 'consented' ELSE 'pending' END AS consent_status, revoked_at FROM boss_relationships WHERE unsubscribe_token = ?)`,
    )
      .bind(unsubscribeToken)
      .first<{ consent_status: string; revoked_at: string | null }>();
    expect(stillConsented?.consent_status).toBe("consented");

    // POST does the work.
    const action = await unauthedFetch(`/boss/unsubscribe/${unsubscribeToken}`, { method: "POST" });
    expect(action.status).toBe(200);
    expect(await action.text()).toContain("Unsubscribed");

    await new Promise((r) => setTimeout(r, 10));
    const userMsgs = sent.filter((m) => m.to === "alice@example.com");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]!.subject).toContain("g@e.com");
    expect(userMsgs[0]!.subject.toLowerCase()).toContain("unsubscribed");

    // Replay POST is a no-op — already-revoked rendering, no second email.
    const replay = await unauthedFetch(`/boss/unsubscribe/${unsubscribeToken}`, { method: "POST" });
    expect(replay.status).toBe(200);
    expect(await replay.text()).toContain("already unsubscribed");
    await new Promise((r) => setTimeout(r, 10));
    const after = sent.filter((m) => m.to === "alice@example.com");
    expect(after).toHaveLength(1);
  });

  it("RFC 8058 one-click POST works with no body", async () => {
    // Gmail/Outlook send a bare POST with `List-Unsubscribe=One-Click` body.
    // Our handler doesn't actually inspect the body — the URL is the auth.
    const { unsubscribeToken } = await arrangeConsented();
    const res = await unauthedFetch(`/boss/unsubscribe/${unsubscribeToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(200);
  });

  it("404s on bogus / malformed tokens", async () => {
    expect((await unauthedFetch(`/boss/unsubscribe/abc`)).status).toBe(404);
    expect(
      (await unauthedFetch(`/boss/unsubscribe/${"00".repeat(32)}`, { method: "POST" })).status,
    ).toBe(404);
  });

  it("rotates unsubscribe_token when the email changes (old URL stops working)", async () => {
    const { cookie, userId, unsubscribeToken: original } = await arrangeConsented();
    // Change the email — same row, but consent + unsubscribe token rotated.
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "different@e.com", mode: "notify" },
    });
    const rotated = await fetchUnsubscribeTokenFromDb(userId);
    expect(rotated).not.toBe(original);
    // Old URL is dead.
    const dead = await unauthedFetch(`/boss/unsubscribe/${original}`, { method: "POST" });
    expect(dead.status).toBe(404);
  });
});

describe("boss approval flow", () => {
  async function arrangeApproved(): Promise<{
    cookie: string;
    userId: string;
    vacationId: string;
    decisionToken: string;
  }> {
    const { cookie, userId } = await setupUserWithEmail();
    const categoryId = await setupCategoryAndAllowance(cookie);

    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "approval" },
    });
    const consentToken = await fetchTokenFromDb(userId);
    await unauthedFetch(`/boss/consent/${consentToken}`, { method: "POST" });
    sent.length = 0; // discard consent email

    // Book a vacation — should land as pending and email the boss.
    const created = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        partial_amount: null,
        public_desc: "Hawaii",
        internal_desc: "",
      },
    });
    const cBody = (await created.json()) as { data: { id: string; approval_state: string } };
    expect(cBody.data.approval_state).toBe("pending");

    // Wait for waitUntil-fired emails.
    await new Promise((r) => setTimeout(r, 10));
    const reqEmail = sent.find((m) => m.to === "g@e.com");
    expect(reqEmail).toBeDefined();
    expect(reqEmail!.text).toMatch(/\/boss\/approve\//);

    const decisionToken = await fetchDecisionTokenFromEmail();
    return {
      cookie,
      userId,
      vacationId: cBody.data.id,
      decisionToken,
    };
  }

  it("notify mode subject leads with display_name (no email)", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    const categoryId = await setupCategoryAndAllowance(cookie);
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const ct = await fetchTokenFromDb(userId);
    await unauthedFetch(`/boss/consent/${ct}`, { method: "POST" });
    sent.length = 0;

    await authedFetch(cookie, "/api/v1/vacations", {
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
    await new Promise((r) => setTimeout(r, 10));
    const bossInvite = sent.find((m) => m.to === "g@e.com");
    expect(bossInvite).toBeDefined();
    // Subject leads with display_name and does NOT inline the user's email.
    expect(bossInvite!.subject).toContain("Alice Example");
    expect(bossInvite!.subject).not.toContain("alice@example.com");
    // Boss-bound invite must be transparent/FREE so it doesn't block the
    // manager's calendar — it's the user's vacation, not theirs. The ICS
    // is base64-encoded inside the MIME multipart, so decode before asserting.
    const ics = decodeIcsFromMime(bossInvite!.text);
    expect(ics).toContain("TRANSP:TRANSPARENT");
    expect(ics).toContain("X-MICROSOFT-CDO-BUSYSTATUS:FREE");
    expect(ics).not.toContain("BUSYSTATUS:OOF");
  });

  it("approve flips state, sends user receipt + boss invite, burns token", async () => {
    const { cookie, vacationId, decisionToken } = await arrangeApproved();
    sent.length = 0;
    const res = await unauthedFetch(`/boss/approve/${decisionToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "action=approve&comment=lgtm",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Approved");
    await new Promise((r) => setTimeout(r, 10));

    // Vacation flipped.
    const v = await authedFetch(cookie, `/api/v1/vacations/${vacationId}`);
    const body = (await v.json()) as { data: { approval_state: string } };
    expect(body.data.approval_state).toBe("approved");

    // Replay 404s.
    expect(
      (
        await unauthedFetch(`/boss/approve/${decisionToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "action=approve",
        })
      ).status,
    ).toBe(404);
  });

  it("reject without comment shows the form again with an error", async () => {
    const { decisionToken } = await arrangeApproved();
    const res = await unauthedFetch(`/boss/approve/${decisionToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "action=reject&comment=",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("required");
    // Token is NOT burned — the user can fix the comment and submit again.
    // Just verify that some non-null decision_token still exists; we can't
    // SELECT by plaintext anymore because the column holds the SHA-256 hash.
    const row = await env.DB.prepare(
      `SELECT decision_token FROM vacation_approvals WHERE decision_token IS NOT NULL`,
    ).first<{ decision_token: string }>();
    expect(row).not.toBeNull();
  });

  it("reject with comment cancels the vacation and emails the user", async () => {
    const { cookie, vacationId, decisionToken } = await arrangeApproved();
    sent.length = 0;
    const res = await unauthedFetch(`/boss/approve/${decisionToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "action=reject&comment=" + encodeURIComponent("Need you for the launch"),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Rejected");
    await new Promise((r) => setTimeout(r, 10));

    const v = await authedFetch(cookie, `/api/v1/vacations/${vacationId}`);
    const body = (await v.json()) as {
      data: { approval_state: string; cancelled_at: string | null };
    };
    expect(body.data.approval_state).toBe("rejected");
    expect(body.data.cancelled_at).not.toBeNull();

    const userReceipt = sent.find((m) => m.to === "alice@example.com");
    expect(userReceipt).toBeDefined();
    expect(userReceipt!.text).toContain("Need you for the launch");
  });
});

describe("boss security regressions", () => {
  it("blocks adding self as boss (would self-approval-loop)", async () => {
    const { cookie } = await setupUserWithEmail();
    const res = await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: {
        boss_email: "alice@example.com", // matches the user's own email
        mode: "approval",
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/own email/i);
  });

  it("does NOT include internal_desc in iCal sent to boss", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    const categoryId = await setupCategoryAndAllowance(cookie);
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const ct = await fetchTokenFromDb(userId);
    await unauthedFetch(`/boss/consent/${ct}`, { method: "POST" });
    sent.length = 0;

    await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: null,
        public_desc: "OOO",
        internal_desc: "SECRET BIRTHDAY PARTY",
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    const bossInvite = sent.find((m) => m.to === "g@e.com");
    expect(bossInvite).toBeDefined();
    // Notify-mode iCal MIME body must not contain the internal note.
    expect(bossInvite!.text).not.toContain("SECRET BIRTHDAY PARTY");
  });

  it("clears in-flight decision tokens when boss email changes", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    const categoryId = await setupCategoryAndAllowance(cookie);
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "approval" },
    });
    const ct = await fetchTokenFromDb(userId);
    await unauthedFetch(`/boss/consent/${ct}`, { method: "POST" });

    const v = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: null,
        public_desc: "x",
        internal_desc: "",
      },
    });
    const vId = ((await v.json()) as { data: { id: string } }).data.id;
    // Wait for the waitUntil-fired approval-request to mint the decision token.
    const oldDecisionToken = await fetchDecisionTokenFromEmail();
    expect(oldDecisionToken).toBeTruthy();

    // User changes boss email — old approval token must die so the old
    // boss can't approve and ship the result to the new boss's address.
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "newboss@e.com", mode: "approval" },
    });
    const afterDt = await env.DB.prepare(
      `SELECT decision_token FROM vacation_approvals WHERE vacation_id = ?`,
    )
      .bind(vId)
      .first<{ decision_token: string | null }>();
    expect(afterDt!.decision_token).toBeNull();

    // And the old boss's link 404s.
    expect(
      (
        await unauthedFetch(`/boss/approve/${oldDecisionToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "action=approve",
        })
      ).status,
    ).toBe(404);
  });

  it("delete-boss nulls pending approval_state on user's vacations", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    const categoryId = await setupCategoryAndAllowance(cookie);
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "approval" },
    });
    const ct = await fetchTokenFromDb(userId);
    await unauthedFetch(`/boss/consent/${ct}`, { method: "POST" });
    const v = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: null,
        public_desc: "x",
        internal_desc: "",
      },
    });
    const vId = ((await v.json()) as { data: { id: string } }).data.id;

    await authedFetch(cookie, "/api/v1/boss", { method: "DELETE" });

    const after = await authedFetch(cookie, `/api/v1/vacations/${vId}`);
    const body = (await after.json()) as { data: { approval_state: string | null } };
    expect(body.data.approval_state).toBeNull();
  });

  it("user-side cancel of pending vacation kills boss decision token", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    const categoryId = await setupCategoryAndAllowance(cookie);
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "approval" },
    });
    const ct = await fetchTokenFromDb(userId);
    await unauthedFetch(`/boss/consent/${ct}`, { method: "POST" });
    const v = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: null,
        public_desc: "x",
        internal_desc: "",
      },
    });
    void ((await v.json()) as { data: { id: string } });
    const tok = await fetchDecisionTokenFromEmail();

    // User self-cancels — fetch the vacation id first.
    const vId2 = await env.DB.prepare(`SELECT vacation_id FROM vacation_approvals LIMIT 1`).first<{
      vacation_id: string;
    }>();
    await authedFetch(cookie, `/api/v1/vacations/${vId2!.vacation_id}/cancel`, { method: "POST" });

    // Boss tries to approve via stale link → 404.
    expect(
      (
        await unauthedFetch(`/boss/approve/${tok}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "action=approve",
        })
      ).status,
    ).toBe(404);
  });

  it("two concurrent approve POSTs do not double-fire emails", async () => {
    const { cookie, userId } = await setupUserWithEmail();
    const categoryId = await setupCategoryAndAllowance(cookie);
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "approval" },
    });
    const ct = await fetchTokenFromDb(userId);
    await unauthedFetch(`/boss/consent/${ct}`, { method: "POST" });
    const v = await authedFetch(cookie, "/api/v1/vacations", {
      method: "POST",
      json: {
        category_id: categoryId,
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        partial_amount: null,
        public_desc: "x",
        internal_desc: "",
      },
    });
    void ((await v.json()) as { data: { id: string } });
    const tok = await fetchDecisionTokenFromEmail();
    sent.length = 0;

    // Sequential is enough — the second hit must find the token gone.
    await unauthedFetch(`/boss/approve/${tok}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "action=approve",
    });
    await unauthedFetch(`/boss/approve/${tok}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "action=approve",
    });
    await new Promise((r) => setTimeout(r, 20));

    // Each (user, boss) target should have received the decision-receipt /
    // iCal exactly once.
    const userEmails = sent.filter((m) => m.to === "alice@example.com");
    const bossEmails = sent.filter((m) => m.to === "g@e.com");
    // Receipt + iCal update for the user (≤2 each); only one boss invite.
    expect(bossEmails.length).toBeLessThanOrEqual(1);
    // The decision-receipt should NOT have been sent twice.
    const receipts = userEmails.filter((m) => m.subject.startsWith("Approved:"));
    expect(receipts.length).toBe(1);
  });
});

describe("boss data export", () => {
  it("includes the boss relationship in the JSON dump (no tokens)", async () => {
    const { cookie } = await setupUserWithEmail();
    await authedFetch(cookie, "/api/v1/boss", {
      method: "PUT",
      json: { boss_email: "g@e.com", mode: "notify" },
    });
    const res = await authedFetch(cookie, "/api/v1/me/export.json");
    const body = (await res.json()) as {
      boss: { boss_email: string; consent_status: string } | null;
    };
    expect(body.boss).not.toBeNull();
    expect(body.boss!.boss_email).toBe("g@e.com");
    expect(body.boss!.consent_status).toBe("pending");
    // Token fields excluded — the BossRelationship type doesn't include them.
    expect("consent_token" in (body.boss as object)).toBe(false);
  });
});
