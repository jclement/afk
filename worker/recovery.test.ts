/**
 * Recovery codes — generation, status, regeneration, login.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  authedFetch,
  createTestSession,
  env,
  unauthedFetch,
} from "./test-utils.js";
import { hashToken, normaliseRecoveryCode } from "./lib/ids.js";

describe("recovery codes", () => {
  beforeEach(applyMigrations);

  it("requires auth", async () => {
    const res = await unauthedFetch("/api/v1/recovery-codes", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("status starts at zero, generation returns 10 plaintext codes", async () => {
    const { cookie } = await createTestSession();
    const before = await authedFetch(cookie, "/api/v1/recovery-codes");
    const beforeBody = (await before.json()) as {
      data: { total: number; used: number; remaining: number; generated: boolean };
    };
    expect(beforeBody.data).toEqual({ total: 0, used: 0, remaining: 0, generated: false });

    const gen = await authedFetch(cookie, "/api/v1/recovery-codes/regenerate", { method: "POST" });
    expect(gen.status).toBe(200);
    const genBody = (await gen.json()) as { data: { codes: string[] } };
    expect(genBody.data.codes).toHaveLength(10);
    // Format: XXXX-XXXX-XXXX-XXXX with Crockford base32 alphabet (no I/L/O/U).
    for (const c of genBody.data.codes) {
      expect(c).toMatch(
        /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/,
      );
    }
    // No duplicates.
    expect(new Set(genBody.data.codes).size).toBe(10);

    const after = await authedFetch(cookie, "/api/v1/recovery-codes");
    const afterBody = (await after.json()) as { data: { total: number; remaining: number } };
    expect(afterBody.data).toMatchObject({ total: 10, remaining: 10 });
  });

  it("regenerate replaces the old set entirely", async () => {
    const { cookie } = await createTestSession();
    const first = await authedFetch(cookie, "/api/v1/recovery-codes/regenerate", {
      method: "POST",
    });
    const firstCodes = ((await first.json()) as { data: { codes: string[] } }).data.codes;
    const second = await authedFetch(cookie, "/api/v1/recovery-codes/regenerate", {
      method: "POST",
    });
    const secondCodes = ((await second.json()) as { data: { codes: string[] } }).data.codes;
    // No overlap (probabilistically essentially zero anyway).
    expect(firstCodes.some((c) => secondCodes.includes(c))).toBe(false);

    // Old codes won't log the user in any longer.
    const login = await unauthedFetch("/api/v1/auth/login/recovery", {
      method: "POST",
      json: { username: await usernameFor(cookie), code: firstCodes[0] },
    });
    expect(login.status).toBe(401);
  });

  it("login/recovery consumes a code and creates a session", async () => {
    const { cookie } = await createTestSession({ username: "recoveryuser" });
    const gen = await authedFetch(cookie, "/api/v1/recovery-codes/regenerate", { method: "POST" });
    const codes = ((await gen.json()) as { data: { codes: string[] } }).data.codes;

    const res = await unauthedFetch("/api/v1/auth/login/recovery", {
      method: "POST",
      json: { username: "recoveryuser", code: codes[0] },
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/afk_session=/);

    // Same code is now consumed.
    const replay = await unauthedFetch("/api/v1/auth/login/recovery", {
      method: "POST",
      json: { username: "recoveryuser", code: codes[0] },
    });
    expect(replay.status).toBe(401);

    // Status reflects the consumption.
    const status = await authedFetch(cookie, "/api/v1/recovery-codes");
    const sBody = (await status.json()) as {
      data: { total: number; used: number; remaining: number };
    };
    expect(sBody.data).toMatchObject({ total: 10, used: 1, remaining: 9 });
  });

  it("normalises whitespace and dashes when consuming", async () => {
    const { cookie } = await createTestSession({ username: "spacey" });
    const gen = await authedFetch(cookie, "/api/v1/recovery-codes/regenerate", { method: "POST" });
    const code = ((await gen.json()) as { data: { codes: string[] } }).data.codes[0]!;
    // Mangle: lowercase, extra spaces, missing dashes.
    const mangled = code.toLowerCase().replace(/-/g, "  ");
    const res = await unauthedFetch("/api/v1/auth/login/recovery", {
      method: "POST",
      json: { username: "spacey", code: mangled },
    });
    expect(res.status).toBe(200);
  });

  it("rejects unknown username with the same response as a wrong code", async () => {
    const { cookie } = await createTestSession({ username: "real" });
    const gen = await authedFetch(cookie, "/api/v1/recovery-codes/regenerate", { method: "POST" });
    const code = ((await gen.json()) as { data: { codes: string[] } }).data.codes[0]!;

    // Wrong code for a real user.
    const wrong = await unauthedFetch("/api/v1/auth/login/recovery", {
      method: "POST",
      json: { username: "real", code: "BAD-CODE-WRONG-XXXX" },
    });
    // Unknown user.
    const ghost = await unauthedFetch("/api/v1/auth/login/recovery", {
      method: "POST",
      json: { username: "no-such-user", code },
    });
    expect(wrong.status).toBe(401);
    expect(ghost.status).toBe(401);
    const wb = (await wrong.json()) as { error: { message: string } };
    const gb = (await ghost.json()) as { error: { message: string } };
    expect(wb.error.message).toBe(gb.error.message);
  });

  it("stores codes hashed (DB never has the plaintext)", async () => {
    const { cookie, user } = await createTestSession({ username: "hashcheck" });
    const gen = await authedFetch(cookie, "/api/v1/recovery-codes/regenerate", { method: "POST" });
    const codes = ((await gen.json()) as { data: { codes: string[] } }).data.codes;
    const rows = await env.DB.prepare(`SELECT code_hash FROM recovery_codes WHERE user_id = ?`)
      .bind(user.id)
      .all<{ code_hash: string }>();
    const stored = (rows.results ?? []).map((r) => r.code_hash);
    // Plaintext must not appear; hash of normalised plaintext must.
    for (const c of codes) {
      expect(stored).not.toContain(c);
      expect(stored).toContain(await hashToken(normaliseRecoveryCode(c)));
    }
  });
});

async function usernameFor(cookie: string): Promise<string> {
  const me = await authedFetch(cookie, "/api/v1/auth/me");
  return ((await me.json()) as { data: { username: string } }).data.username;
}
