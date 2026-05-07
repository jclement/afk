/**
 * Auth routes — passkey registration, authentication, logout, and the
 * "is anyone registered yet?" status endpoint that drives the first-time
 * setup flow.
 *
 * Anti-foot-guns:
 *   - Registration is OPEN to any visitor who picks an unused username.
 *     The first user is auto-promoted to admin; subsequent users are role
 *     "user". The only auth-gated branch is "username already exists" —
 *     in that case the requester must already be signed in as that user
 *     (i.e., adding another passkey to their own account). Without this
 *     check, anyone who knew a username could attach a passkey to it and
 *     impersonate the owner.
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
import { createUser, ensureDevUser, getUser, getUserByUsername, userCount } from "../lib/users.js";
import { consumeRecoveryCode } from "../lib/recovery.js";
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
async function currentUserFromCookie(c: Context<HonoVars>): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const session = await getSession(c.env.DB, token);
  if (!session) return null;
  return await getUser(c.env.DB, session.user_id);
}

/**
 * Centralised registration gate. Returns an error response if the caller is
 * not allowed to register (or attach a passkey to) the resolved user; null
 * if the request is allowed.
 *
 * Open multi-user signup: anyone can pick an unused username. The gate
 * exists only to protect the *existing-user* branch — when a username is
 * already taken, the requester MUST already be authenticated as that user.
 * Without this, anyone who knew a username could attach a new passkey to
 * that account and impersonate them.
 *
 * Called from BOTH /register/start AND /register/finish so the check can't
 * be bypassed by skipping straight to /finish with a captured flow_id.
 */
async function assertRegistrationAllowed(
  c: Context<HonoVars>,
  existing: User | null,
  requester: User | null,
): Promise<Response | null> {
  if (!existing) return null;
  if (!requester || requester.id !== existing.id) {
    return err(c, "CONFLICT", "That username is taken. Pick another.");
  }
  return null;
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
    auth_suppressed: isAuthSuppressed(c),
  });
});

// ---------------------------------------------------------------------------
// Whoami — returns the authenticated user, or 401 if not logged in.
// ---------------------------------------------------------------------------
auth.get("/me", requireAuth, async (c) => {
  return ok(c, c.get("auth").user);
});

// ---------------------------------------------------------------------------
// Registration — open signup. Anyone can pick an unused username. Existing
// users may add additional passkeys to their own account (the only branch
// the gate restricts). The first user to register is auto-promoted to admin.
// ---------------------------------------------------------------------------
auth.post("/register/start", async (c) => {
  if (isAuthSuppressed(c)) {
    return err(c, "FORBIDDEN", "Registration disabled while SUPPRESS_AUTH is on.");
  }

  const body =
    (await c.req
      .json<{ username?: string; display_name?: string }>()
      .catch(() => ({}) as { username?: string; display_name?: string })) ?? {};
  const username = (body.username ?? "").trim().toLowerCase();
  // Strip control chars from display_name — same defense-in-depth as
  // category names. The field flows into iCal calendar names, PDF
  // headers, and email Subject lines; CR/LF in there breaks formatting.
  // eslint-disable-next-line no-control-regex
  const displayName = (body.display_name ?? "").replace(/[\x00-\x1F\x7F]+/g, " ").trim();
  if (!username || username.length > 64 || !/^[a-z0-9._-]+$/.test(username)) {
    return err(c, "VALIDATION_ERROR", "Username must be 1-64 chars of [a-z0-9._-].");
  }
  if (!displayName || displayName.length > 100) {
    return err(c, "VALIDATION_ERROR", "Display name is required (max 100 chars).");
  }

  const existing = await getUserByUsername(c.env.DB, username);
  const requester = await currentUserFromCookie(c);
  const isSelfAddingPasskey = existing && requester && requester.id === existing.id;

  // Username-enumeration flattening (H3): we DON'T short-circuit when the
  // username is taken by someone other than the requester. Returning CONFLICT
  // here would let an attacker probe usernames cheaply (one HTTP call each).
  // Instead, we always continue into the WebAuthn ceremony with empty
  // excludeIds, and assertRegistrationAllowed runs at /finish — so each probe
  // costs the attacker a full WebAuthn ceremony with their own authenticator.
  // The legitimate "I'm authenticated as this user, adding a passkey" flow
  // still gets real excludeIds so their authenticator can refuse duplicates.
  const excludeIds = isSelfAddingPasskey ? await listCredentialIds(c.env.DB, existing.id) : [];

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
    // Don't leak the raw error message to the client — could surface
    // internal details (KV keys, env names) on a future code change. Log
    // for ops visibility, return a generic message to the user.
    console.error("register/start failed", e);
    return err(c, "INTERNAL_ERROR", "Could not start registration.");
  }
});

auth.post("/register/finish", async (c) => {
  const body = await c.req.json<{
    flow_id?: string;
    response?: unknown;
    nickname?: string;
    timezone?: string;
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

    // Re-run the registration gate at finish time. /start could have been
    // exempted (no users existed yet), but if someone else raced their own
    // first-user setup in between, this finish must not silently demote them
    // or attach a passkey to a user it shouldn't.
    const existing = await getUserByUsername(c.env.DB, result.username);
    const requester = await currentUserFromCookie(c);
    const guard = await assertRegistrationAllowed(c, existing, requester);
    if (guard) return guard;

    // Either reuse existing user (additional passkey) or create a new one.
    let user = existing;
    let isNewUser = false;
    if (!user) {
      const total = await userCount(c.env.DB);
      const role: "user" | "admin" = total === 0 ? "admin" : "user";
      user = await createUser(c.env.DB, {
        username: result.username,
        display_name: result.display_name,
        timezone: body.timezone,
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
      nickname: (body.nickname?.trim() || "Default passkey").slice(0, 60),
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
    setSessionCookie(c, session.token, isLocalhost(c));
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
  if (isAuthSuppressed(c)) {
    // Pretend everything's fine — the client should poll /me which will
    // succeed thanks to suppress-auth.
    await ensureDevUser(c.env.DB);
    return ok(c, { suppressed: true });
  }

  const body = await c.req.json<{ username?: string }>().catch(() => ({}) as { username?: string });
  const username = body.username?.trim().toLowerCase() || null;
  let allowed = username ? await listAllCredentialsForUsername(c.env.DB, username) : [];
  // Username-enumeration flattening (H3): when the username is provided but
  // unknown (or known with zero credentials), we still ship a synthetic
  // credential id so the response shape doesn't differ from a known user's.
  // The synthetic id won't verify at /login/finish because no credentials row
  // exists for it — the failure is indistinguishable from a wrong-passkey
  // failure for a real user.
  if (username && allowed.length === 0) {
    const fake = new Uint8Array(64);
    crypto.getRandomValues(fake);
    const b64 = btoa(String.fromCharCode(...fake))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    allowed = [{ id: b64, transports: null }];
  }
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
    // Generic to client, full to logs. Mirrors register/start.
    console.error("login/start failed", e);
    return err(c, "INTERNAL_ERROR", "Could not start authentication.");
  }
});

auth.post("/login/finish", async (c) => {
  if (isAuthSuppressed(c)) {
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
    setSessionCookie(c, session.token, isLocalhost(c));
    return ok(c, { user });
  } catch (e) {
    if (e instanceof AuthError) {
      return err(c, e.code, e.message);
    }
    console.error("login/finish failed", e);
    return err(c, "INTERNAL_ERROR", "Could not finish login.");
  }
});

/**
 * Recovery-code login — fallback when every passkey is lost. The code is
 * single-use; on success a session is created and the user lands on the
 * dashboard. The UI nudges them to register a new passkey immediately so
 * they're back to passkey-primary.
 *
 * Tradeoffs: typeable codes are phishable in a way passkeys aren't. The
 * mitigations are (a) one-time use, (b) 80-bit entropy per code, (c) only
 * 10 per user — total search space against any one user is 10 * 2^80.
 */
auth.post("/login/recovery", async (c) => {
  if (isAuthSuppressed(c)) {
    const dev = await ensureDevUser(c.env.DB);
    return ok(c, { user: dev });
  }
  const body = await c.req
    .json<{ username?: string; code?: string }>()
    .catch(() => ({}) as { username?: string; code?: string });
  const username = (body.username ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  if (!username || !code) {
    return err(c, "VALIDATION_ERROR", "Username and recovery code are required.");
  }
  const user = await getUserByUsername(c.env.DB, username);
  // Same generic error for "no such user" and "wrong code" so an attacker
  // can't tell the two apart by response — username enumeration would
  // otherwise reappear via this endpoint.
  if (!user) {
    return err(c, "UNAUTHORIZED", "Invalid recovery code.");
  }
  const consumed = await consumeRecoveryCode(c.env.DB, user.id, code);
  if (!consumed) {
    return err(c, "UNAUTHORIZED", "Invalid recovery code.");
  }
  const session = await createSession(
    c.env.DB,
    user.id,
    c.req.header("user-agent") ?? null,
    c.req.header("cf-connecting-ip") ?? null,
  );
  setSessionCookie(c, session.token, isLocalhost(c));
  return ok(c, { user });
});

auth.post("/logout", async (c) => {
  // Origin-pin (H4): logout is unauthenticated by design (so a stale cookie
  // can be cleared without 401), but a cross-site form auto-submit could
  // otherwise force-logout any victim with the right cookie path/SameSite
  // combo. SameSite=Lax allows top-level POST navigations, and that's enough
  // to trigger this. Reject any logout whose Origin doesn't match the request
  // host. The SPA's own fetch() always sets Origin correctly.
  const sentOrigin = c.req.header("origin");
  const requestOrigin = new URL(c.req.url).origin;
  if (!sentOrigin || sentOrigin !== requestOrigin) {
    return err(c, "FORBIDDEN", "Cross-origin logout rejected.");
  }
  // Don't gate on requireAuth — logout should be a no-op-friendly endpoint
  // even with an expired/invalid cookie. But we MUST destroy the server-side
  // session row, otherwise a leaked cookie remains valid for its 30-day TTL.
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await destroySession(c.env.DB, token);
  }
  clearSessionCookie(c);
  return ok(c, { ok: true });
});

export default auth;
