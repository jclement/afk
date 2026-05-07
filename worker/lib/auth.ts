/**
 * Auth middleware.
 *
 *   1. If SUPPRESS_AUTH is "true" AND the request is from a dev environment
 *      (APP_VERSION === "dev" or the request is hitting localhost / 127.x /
 *      ::1), forge an admin developer user and let the request through.
 *      Logs a warning every request so it's impossible to forget. A
 *      production deploy that accidentally set SUPPRESS_AUTH=true would NOT
 *      open the gate — defence-in-depth against config slip-ups.
 *   2. Otherwise, look for a session cookie, validate it, and stamp the
 *      authenticated user on the Hono context as `c.get("auth")`.
 *   3. No session, no party — 401.
 */

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { HonoVars } from "../types.js";
import { SESSION_COOKIE, getSession, touchSession } from "./sessions.js";
import { ensureDevUser, getUser } from "./users.js";
import { err } from "./responses.js";

/**
 * SUPPRESS_AUTH is honoured only on dev builds or local-host requests. The
 * env var alone is not enough — a prod deploy that accidentally sets it
 * (e.g. wrangler secret slip-up) MUST NOT auto-admin every request, and
 * MUST NOT lock out real users from login/register either.
 */
export function isAuthSuppressed(c: Context<HonoVars>): boolean {
  if (c.env.SUPPRESS_AUTH !== "true") return false;
  if (c.env.APP_VERSION === "dev") return true;
  try {
    const host = new URL(c.req.url).hostname;
    return (
      host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/** Apply to all `/api/*` routes that require an authenticated user. */
export const requireAuth: MiddlewareHandler<HonoVars> = async (c, next) => {
  if (isAuthSuppressed(c)) {
    console.warn("⚠ SUPPRESS_AUTH=true — authentication disabled, auto-login as developer");
    const user = await ensureDevUser(c.env.DB);
    c.set("auth", { user, session_id: null });
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return err(c, "UNAUTHORIZED", "Authentication required.");
  }
  const session = await getSession(c.env.DB, token);
  if (!session) {
    return err(c, "UNAUTHORIZED", "Session expired.");
  }
  const user = await getUser(c.env.DB, session.user_id);
  if (!user) {
    return err(c, "UNAUTHORIZED", "User not found.");
  }
  c.set("auth", { user, session_id: session.id });
  // Don't await — last_seen tracking is not request-critical.
  c.executionCtx.waitUntil(touchSession(c.env.DB, session.id));
  return next();
};

/** Helpers for handlers that already pass through requireAuth. */
export function authedUser(c: Context<HonoVars>) {
  const a = c.get("auth");
  return a.user;
}
