import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, createTestSession, unauthedFetch } from "./test-utils.js";

describe("auth status + me", () => {
  beforeEach(applyMigrations);

  it("reports has_users=false on a fresh DB", async () => {
    const res = await unauthedFetch("/api/v1/auth/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { has_users: boolean } };
    expect(body.data.has_users).toBe(false);
  });

  it("/me returns 401 without a session", async () => {
    const res = await unauthedFetch("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("/me returns the user with a valid session cookie", async () => {
    const { user, cookie } = await createTestSession({ username: "jeff", display_name: "Jeff" });
    const res = await unauthedFetch("/api/v1/auth/me", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; username: string } };
    expect(body.data.id).toBe(user.id);
    expect(body.data.username).toBe("jeff");
  });

  it("logout clears the session cookie", async () => {
    const { cookie } = await createTestSession();
    const res = await unauthedFetch("/api/v1/auth/logout", {
      method: "POST",
      // Origin matches the test base URL so the same-origin guard passes.
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/afk_session=/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=/i);
  });

  it("logout rejects cross-origin POST", async () => {
    const { cookie } = await createTestSession();
    const res = await unauthedFetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://attacker.example.com" },
    });
    expect(res.status).toBe(403);
  });
});
