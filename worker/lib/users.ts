/**
 * User CRUD — small enough to stay out of a dedicated repository file.
 * Only one human ever uses this app, but the model still has accounts so
 * passkey auth has something to attach to and the developer dev-bypass
 * user is consistent.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { newId } from "./ids.js";
import type { User } from "../../shared/types.js";

export const DEV_USER_ID = "00000000-0000-0000-0000-000000000000";

export async function getUser(
  db: D1Database,
  id: string,
): Promise<User | null> {
  return await db
    .prepare(
      `SELECT id, username, display_name, role FROM users WHERE id = ?`,
    )
    .bind(id)
    .first<User>();
}

export async function getUserByUsername(
  db: D1Database,
  username: string,
): Promise<User | null> {
  return await db
    .prepare(
      `SELECT id, username, display_name, role FROM users WHERE username = ?`,
    )
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
  };
}
