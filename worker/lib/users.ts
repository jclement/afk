/**
 * User CRUD + email/verification plumbing.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { newId } from "./ids.js";
import type { User } from "../../shared/types.js";

export const DEV_USER_ID = "00000000-0000-0000-0000-000000000000";

const SELECT_USER =
  "SELECT id, username, display_name, role, email, email_verified_at FROM users";

export async function getUser(
  db: D1Database,
  id: string,
): Promise<User | null> {
  return await db
    .prepare(`${SELECT_USER} WHERE id = ?`)
    .bind(id)
    .first<User>();
}

export async function getUserByUsername(
  db: D1Database,
  username: string,
): Promise<User | null> {
  return await db
    .prepare(`${SELECT_USER} WHERE username = ?`)
    .bind(username)
    .first<User>();
}

export async function userCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM users`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createUser(
  db: D1Database,
  input: { username: string; display_name: string; role?: "user" | "admin" },
): Promise<User> {
  const id = newId();
  const role = input.role ?? "user";
  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)`,
    )
    .bind(id, input.username, input.display_name, role)
    .run();
  return {
    id,
    username: input.username,
    display_name: input.display_name,
    role,
    email: null,
    email_verified_at: null,
  };
}

/** Upsert the developer user used by SUPPRESS_AUTH. */
export async function ensureDevUser(db: D1Database): Promise<User> {
  const existing = await getUser(db, DEV_USER_ID);
  if (existing) return existing;
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, display_name, role)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(DEV_USER_ID, "developer", "Developer", "admin")
    .run();
  return {
    id: DEV_USER_ID,
    username: "developer",
    display_name: "Developer",
    role: "admin",
    email: null,
    email_verified_at: null,
  };
}

// ---------------------------------------------------------------------------
// Email + verification
// ---------------------------------------------------------------------------

/**
 * Set or change the user's pending email and mint a verification token.
 * The email isn't trusted until the user clicks the link and we record the
 * verified_at timestamp. Replacing an already-verified email clears the
 * verified_at so we don't keep emailing the old address.
 */
export async function startEmailChange(
  db: D1Database,
  userId: string,
  email: string,
): Promise<{ token: string; expires_at: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid email address.");
  }
  await db
    .prepare(
      `UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?`,
    )
    .bind(normalized, userId)
    .run();

  // Replace any prior outstanding tokens for this user — only one live at a time.
  await db
    .prepare(`DELETE FROM email_verifications WHERE user_id = ?`)
    .bind(userId)
    .run();

  const token = randomToken(32);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO email_verifications (id, user_id, email, token, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), userId, normalized, token, expires)
    .run();
  return { token, expires_at: expires };
}

/**
 * Look up a verification token. Returns null if expired, missing, or for a
 * user whose current email doesn't match the token's email (defense against
 * a stale token re-verifying a since-changed address).
 */
export async function verifyEmailToken(
  db: D1Database,
  token: string,
): Promise<User | null> {
  const row = await db
    .prepare(
      `SELECT user_id, email, expires_at FROM email_verifications WHERE token = ?`,
    )
    .bind(token)
    .first<{ user_id: string; email: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db
      .prepare(`DELETE FROM email_verifications WHERE token = ?`)
      .bind(token)
      .run();
    return null;
  }
  const user = await getUser(db, row.user_id);
  if (!user || user.email !== row.email) {
    // Stale: user changed their email between issue and click. Drop the row
    // and refuse — they'll need to re-request.
    await db
      .prepare(`DELETE FROM email_verifications WHERE token = ?`)
      .bind(token)
      .run();
    return null;
  }
  await db
    .prepare(
      `UPDATE users SET email_verified_at = datetime('now') WHERE id = ?`,
    )
    .bind(user.id)
    .run();
  await db
    .prepare(`DELETE FROM email_verifications WHERE user_id = ?`)
    .bind(user.id)
    .run();
  return await getUser(db, user.id);
}

/**
 * Mint a fresh verification token for the user's *current* email — used by
 * the "Resend verification" button. Returns null if no email is set.
 */
export async function reissueEmailToken(
  db: D1Database,
  userId: string,
): Promise<{ token: string; email: string; expires_at: string } | null> {
  const user = await getUser(db, userId);
  if (!user?.email || user.email_verified_at) return null;
  await db
    .prepare(`DELETE FROM email_verifications WHERE user_id = ?`)
    .bind(userId)
    .run();
  const token = randomToken(32);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO email_verifications (id, user_id, email, token, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId(), userId, user.email, token, expires)
    .run();
  return { token, email: user.email, expires_at: expires };
}

export async function clearUserEmail(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET email = NULL, email_verified_at = NULL WHERE id = ?`,
    )
    .bind(userId)
    .run();
  await db
    .prepare(`DELETE FROM email_verifications WHERE user_id = ?`)
    .bind(userId)
    .run();
}

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
