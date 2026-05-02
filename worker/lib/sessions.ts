/**
 * Session management — create, look up, refresh, and destroy server-side
 * sessions stored in D1. Cookies carry only the session token; everything
 * else (user_id, expiry, last_seen) lives in the database so we can revoke
 * a session instantly without waiting for the cookie to expire.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { newSessionToken } from "./ids.js";

export const SESSION_COOKIE = "afk_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
}

/** Create a session row and return the token (also the row id). */
export async function createSession(
  db: D1Database,
  userId: string,
  ua: string | null,
  ip: string | null,
): Promise<SessionRecord> {
  const id = newSessionToken();
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
  };
}

export async function getSession(
  db: D1Database,
  token: string,
): Promise<SessionRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, expires_at, created_at, last_seen_at
       FROM sessions WHERE id = ?`,
    )
    .bind(token)
    .first<SessionRecord>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run();
    return null;
  }
  return row;
}

/** Update last_seen_at; non-blocking from the caller's perspective. */
export async function touchSession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`)
    .bind(token)
    .run();
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run();
}

/** Drop expired sessions. Intended to be called from a scheduled handler or login. */
export async function purgeExpiredSessions(db: D1Database): Promise<void> {
  await db
    .prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`)
    .run();
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
