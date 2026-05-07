/**
 * Session management — create, look up, refresh, and destroy server-side
 * sessions stored in D1. Cookies carry the random plaintext token; the DB
 * row's `id` is the SHA-256 hash of that token. A read-only DB leak therefore
 * yields no usable cookie value — the attacker would have to pre-image SHA-256
 * to forge a session.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { hashToken, newSessionToken } from "./ids.js";

export const SESSION_COOKIE = "afk_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
}

export interface SessionWithToken extends SessionRecord {
  /** Plaintext token to stash in the cookie. Never stored anywhere else. */
  token: string;
}

/**
 * Create a session row and return both the SessionRecord (with the hashed id)
 * and the plaintext token to put in the cookie. The plaintext is never
 * persisted — once the function returns, only the caller's cookie has it.
 */
export async function createSession(
  db: D1Database,
  userId: string,
  ua: string | null,
  ip: string | null,
): Promise<SessionWithToken> {
  const token = newSessionToken();
  const id = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, expiresAt, ua, ip)
    .run();
  // Stamp last_login_at on the user.
  await db
    .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(userId)
    .run();
  return {
    id,
    user_id: userId,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    token,
  };
}

export async function getSession(db: D1Database, token: string): Promise<SessionRecord | null> {
  const id = await hashToken(token);
  const row = await db
    .prepare(
      `SELECT id, user_id, expires_at, created_at, last_seen_at
       FROM sessions WHERE id = ?`,
    )
    .bind(id)
    .first<SessionRecord>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    return null;
  }
  return row;
}

/**
 * Update last_seen_at on the session whose row id is `id`. The id is the
 * SHA-256 hash of the cookie token; callers that already resolved the
 * session (via getSession) pass `session.id` directly. Callers holding only
 * the cookie token should hash first.
 */
export async function touchSessionById(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();
}

/** Destroy by cookie token (hashes internally). */
export async function destroySession(db: D1Database, token: string): Promise<void> {
  const id = await hashToken(token);
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
}

/** Destroy by session id (already-hashed). Used after we've resolved a session. */
export async function destroySessionById(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
}

/** Destroy every session for a user. Used by account deletion. */
export async function destroyAllSessionsForUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}

/** Drop expired sessions. Intended to be called from a scheduled handler or login. */
export async function purgeExpiredSessions(db: D1Database): Promise<void> {
  // expires_at is stored as a JS ISO string (e.g. "2026-06-01T12:00:00.000Z")
  // while datetime('now') returns "2026-05-02 12:00:00" — comparing those as
  // TEXT is lexicographic and broken (the 'T' in ISO sorts greater than the
  // space in datetime, so the ISO value is ALWAYS "greater"). julianday()
  // parses both formats into a real number so the comparison actually works.
  await db.prepare(`DELETE FROM sessions WHERE julianday(expires_at) < julianday('now')`).run();
}

export function setSessionCookie(c: Context, token: string, isLocalhost: boolean) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: !isLocalhost,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
