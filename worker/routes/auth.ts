/**
 * Auth routes — passkey registration, authentication, logout, and the
 * "is anyone registered yet?" status endpoint that drives the first-time
 * setup flow.
 *
 * Anti-foot-guns:
 *   - Registration is open ONLY when no users exist (first-run setup) OR
 *     when the requester is already authenticated as an admin (adding a
 *     passkey for themselves). This is "personal" software — we don't want
 *     a stranger creating a second account on Jeff's deployment.
 *   - Login challenges are scoped to a `flow_id` that the server issues
 *     and the client returns. We never trust the client's challenge.
 *   - Sessions are server-side rows; the cookie just carries the token.
 */

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { HonoVars } from "../types.js";
import { isAuthSuppressed, requireAuth } from "../lib/auth.js";
import { err, ok } from "../lib/responses.js";
import {
  createUser,
  ensureDevUser,
  getUser,
  getUserByUsername,
  userCount,
} from "../lib/users.js";
import {
  AuthError,
  finishAuthentication,
  finishRegistration,
  startAuthentication,
  startRegistration,
} from "../lib/passkeys.js";
import {
  insertCredential,
  listAllCredentialsForUsername,
  listCredentialIds,
  seedDefaultCategories,
  updateCredentialCounter,
} from "../lib/store.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  getSession,
  setSessionCookie,
} from "../lib/sessions.js";
import type { User } from "../../shared/types.js";

/**
 * Soft session lookup — returns the authenticated user if the request has a
 * valid session cookie, or null otherwise. Used by routes that allow both
 * authenticated and unauthenticated callers (e.g. /register/start lets you
 * create a brand-new account or, if signed in, add a passkey to your own).
 */
async function currentUserFromCookie(
  c: Context<HonoVars>,
): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const session = await getSession(c.env.DB, token);
  if (!session) return null;
  return await getUser(c.env.DB, session.user_id);
}

const auth = new Hono<HonoVars>();

// Derive RP from the inbound request so the same Worker serves the production
// custom domain and the *.workers.dev URL without per-host config. WebAuthn
// requires the RP ID to match the page's effective domain; using env.RP_ID
// breaks any host that isn't the configured one.
function rpFromContext(c: { req: { url: string }; env: HonoVars["Bindings"] }): {
  rpID: string;
  rpName: string;
  origin: string;
} {
  const url = new URL(c.req.url);
  return {
    rpID: url.hostname,
    rpName: c.env.RP_NAME,
    origin: `${url.protocol}//${url.host}`,
  };
}

function isLocalhost(c: { req: { url: string } }): boolean {
  return new URL(c.req.url).hostname === "localhost";
}

// ---------------------------------------------------------------------------
// Status endpoint — used by the login screen to decide whether to show the
// "Set up your account" first-run flow or the normal login form.
// ---------------------------------------------------------------------------
auth.get("/status", async (c) => {
  const n = await userCount(c.env.DB);
  return ok(c, {
    has_users: n > 0,
    auth_suppressed: isAuthSuppressed(c.env),
  });
});

// ---------------------------------------------------------------------------
// Whoami — returns the authenticated user, or 401 if not logged in.
// ---------------------------------------------------------------------------
auth.get("/me", requireAuth, async (c) => {
  return ok(c, c.get("auth").user);
});

// ---------------------------------------------------------------------------
// Registration — first-run setup OR an authenticated admin adding another
// passkey for themselves.
// ---------------------------------------------------------------------------
auth.post("/register/start", async (c) => {
  if (isAuthSuppressed(c.env)) {
    return err(c, "FORBIDDEN", "Registration disabled while SUPPRESS_AUTH is on.");
  }

  const body = (await c.req
    .json<{ username?: string; display_name?: string }>()
    .catch(() => ({}) as { username?: string; display_name?: string })) ?? {};
  const username = (body.username ?? "").trim().toLowerCase();
  const displayName = (body.display_name ?? "").trim();
  if (!username || username.length > 64 || !/^[a-z0-9._-]+$/.test(username)) {
    return err(
      c,
      "VALIDATION_ERROR",
      "Username must be 1-64 chars of [a-z0-9._-].",
    );
  }
  if (!displayName || displayName.length > 100) {
    return err(c, "VALIDATION_ERROR", "Display name is required (max 100 chars).");
  }

  const existing = await getUserByUsername(c.env.DB, username);
  // Open multi-user signup. Two cases:
  //   - new username → create the user during /finish (first one becomes admin)
  //   - existing username → only allowed if the requester is already signed
  //     in as that user (i.e., adding another passkey to their own account).
  //     This route doesn't run requireAuth, so we have to look up the session
  //     ourselves. Without this guard, anyone who knew a username could attach
  //     a new passkey to that account and impersonate them.
  if (existing) {
    const requester = await currentUserFromCookie(c);
    if (!requester || requester.id !== existing.id) {
      return err(
        c,
        "CONFLICT",
        "That username is taken. Pick another.",
      );
    }
  }

  const excludeIds = existing
    ? await listCredentialIds(c.env.DB, existing.id)
    : [];

  try {
    const result = await startRegistration(
      c.env.KV,
      rpFromContext(c),
      username,
      displayName,
      excludeIds,
    );
    return ok(c, result);
  } catch (e) {
    return err(c, "INTERNAL_ERROR", (e as Error).message);
  }
});

auth.post("/register/finish", async (c) => {
  const body = await c.req.json<{
    flow_id?: string;
    response?: unknown;
    nickname?: string;
  }>();
  if (!body.flow_id || !body.response) {
    return err(c, "VALIDATION_ERROR", "Missing flow_id or response.");
  }
  try {
    const result = await finishRegistration(
      c.env.KV,
      rpFromContext(c),
      body.flow_id,
      // Cast: the type is guaranteed by the WebAuthn API on the client.
      body.response as never,
    );

    // Either reuse existing user (additional passkey) or create a new one.
    let user = await getUserByUsername(c.env.DB, result.username);
    let isNewUser = false;
    if (!user) {
      const total = await userCount(c.env.DB);
      const role: "user" | "admin" = total === 0 ? "admin" : "user";
      user = await createUser(c.env.DB, {
        username: result.username,
        display_name: result.display_name,
        role,
      });
      isNewUser = true;
    }

    await insertCredential(c.env.DB, {
      id: result.credential.id,
      user_id: user.id,
      public_key: result.credential.publicKey,
      counter: result.credential.counter,
      transports: result.credential.transports,
      device_type: result.credential.deviceType,
      backed_up: result.credential.backedUp,
      nickname: body.nickname?.trim() || "Default passkey",
    });

    if (isNewUser) {
      await seedDefaultCategories(c.env.DB, user.id);
    }

    const session = await createSession(
      c.env.DB,
      user.id,
      c.req.header("user-agent") ?? null,
      c.req.header("cf-connecting-ip") ?? null,
    );
    setSessionCookie(c, session.id, isLocalhost(c));
    return ok(c, { user });
  } catch (e) {
    if (e instanceof AuthError) {
      return err(c, e.code, e.message);
    }
    console.error("register/finish failed", e);
    return err(c, "INTERNAL_ERROR", "Could not finish registration.");
  }
});

// ---------------------------------------------------------------------------
// Login — username is optional (passkeys can do usernameless login), but
// providing one lets us narrow `allowCredentials`.
// ---------------------------------------------------------------------------
auth.post("/login/start", async (c) => {
  if (isAuthSuppressed(c.env)) {
    // Pretend everything's fine — the client should poll /me which will
    // succeed thanks to suppress-auth.
    await ensureDevUser(c.env.DB);
    return ok(c, { suppressed: true });
  }

  const body = await c.req
    .json<{ username?: string }>()
    .catch(() => ({}) as { username?: string });
  const username = body.username?.trim().toLowerCase() || null;
  const allowed = username
    ? await listAllCredentialsForUsername(c.env.DB, username)
    : [];
  try {
    const result = await startAuthentication(
      c.env.KV,
      rpFromContext(c),
      username,
      allowed.map((a) => ({
        id: a.id,
        transports: (a.transports as never) ?? null,
      })),
    );
    return ok(c, result);
  } catch (e) {
    return err(c, "INTERNAL_ERROR", (e as Error).message);
  }
});

auth.post("/login/finish", async (c) => {
  if (isAuthSuppressed(c.env)) {
    const dev = await ensureDevUser(c.env.DB);
    return ok(c, { user: dev });
  }
  const body = await c.req.json<{ flow_id?: string; response?: unknown }>();
  if (!body.flow_id || !body.response) {
    return err(c, "VALIDATION_ERROR", "Missing flow_id or response.");
  }
  try {
    const result = await finishAuthentication(
      c.env.KV,
      c.env.DB,
      rpFromContext(c),
      body.flow_id,
      body.response as never,
    );
    await updateCredentialCounter(c.env.DB, result.credential_id, result.new_counter);
    const user = await getUser(c.env.DB, result.user_id);
    if (!user) return err(c, "UNAUTHORIZED", "User no longer exists.");
    const session = await createSession(
      c.env.DB,
      user.id,
      c.req.header("user-agent") ?? null,
      c.req.header("cf-connecting-ip") ?? null,
    );
    setSessionCookie(c, session.id, isLocalhost(c));
    return ok(c, { user });
  } catch (e) {
    if (e instanceof AuthError) {
      return err(c, e.code, e.message);
    }
    console.error("login/finish failed", e);
    return err(c, "INTERNAL_ERROR", "Could not finish login.");
  }
});

auth.post("/logout", async (c) => {
  const a = c.get("auth");
  if (a?.session_id) {
    await destroySession(c.env.DB, a.session_id);
  }
  clearSessionCookie(c);
  return ok(c, { ok: true });
});

export default auth;
