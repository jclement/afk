/**
 * Test helpers for worker tests. Provides:
 *   - applyMigrations(): runs the SQL files under migrations/ against the
 *     in-memory D1 (created by miniflare via vitest-pool-workers)
 *   - createTestUser(): inserts a user, opens a session, and returns a
 *     ready-to-use Cookie header string and the user record
 *   - app, env: re-exports of the Hono app and bindings for direct use
 */

import { env as workerEnv } from "cloudflare:test";
// Vite raw-import — works in vitest's worker pool. Typed as a string in
// the ambient module declaration below.
// @ts-expect-error vite raw imports aren't part of the worker tsconfig
import migration0001 from "../migrations/0001_initial.sql?raw";
// @ts-expect-error vite raw imports aren't part of the worker tsconfig
import migration0002 from "../migrations/0002_accrues_drop_weeks.sql?raw";
// @ts-expect-error vite raw imports aren't part of the worker tsconfig
import migration0003 from "../migrations/0003_email_invites.sql?raw";
// @ts-expect-error vite raw imports aren't part of the worker tsconfig
import migration0004 from "../migrations/0004_user_timezone.sql?raw";
// @ts-expect-error vite raw imports aren't part of the worker tsconfig
import migration0005 from "../migrations/0005_boss.sql?raw";
// @ts-expect-error vite raw imports aren't part of the worker tsconfig
import migration0006 from "../migrations/0006_drop_boss_display_name.sql?raw";
// @ts-expect-error vite raw imports aren't part of the worker tsconfig
import migration0007 from "../migrations/0007_share_tokens.sql?raw";
import app from "./index.js";
import type { Env } from "./types.js";
import { createSession } from "./lib/sessions.js";
import { createUser } from "./lib/users.js";
import type { User } from "../shared/types.js";

export const env = workerEnv as unknown as Env;
export { app };

/** Fresh schema in the in-memory D1 instance — call from beforeEach. */
export async function applyMigrations(): Promise<void> {
  const dropTables = [
    "share_tokens",
    "vacation_approvals",
    "boss_relationships",
    "email_verifications",
    "ical_tokens",
    "vacations",
    "allowances",
    "categories",
    "sessions",
    "credentials",
    "users",
  ];
  for (const t of dropTables) {
    await env.DB.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }

  // Strip BOTH leading-line and inline `--` comments before splitting on `;`,
  // collapse whitespace, then run each statement alone. D1's prepare() is
  // strict about a single statement per call.
  for (const sql of [
    migration0001 as string,
    migration0002 as string,
    migration0003 as string,
    migration0004 as string,
    migration0005 as string,
    migration0006 as string,
    migration0007 as string,
  ]) {
    const cleaned = sql
      .split("\n")
      .map((l: string) => l.replace(/--.*$/, ""))
      .join("\n");
    const stmts = cleaned
      .split(";")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    for (const stmt of stmts) {
      await env.DB.prepare(stmt).run();
    }
  }
}

export interface TestSession {
  user: User;
  cookie: string;
}

export async function createTestSession(opts?: {
  username?: string;
  display_name?: string;
}): Promise<TestSession> {
  const user = await createUser(env.DB, {
    username: opts?.username ?? `tester-${Math.random().toString(36).slice(2, 8)}`,
    display_name: opts?.display_name ?? "Test User",
  });
  const session = await createSession(env.DB, user.id, "vitest", "127.0.0.1");
  return {
    user,
    cookie: `afk_session=${session.id}`,
  };
}

export async function authedFetch(
  cookie: string,
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", cookie);
  if (init?.json !== undefined) headers.set("Content-Type", "application/json");
  return await app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    }),
    env,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
  );
}

export async function unauthedFetch(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.json !== undefined) headers.set("Content-Type", "application/json");
  return await app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    }),
    env,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
  );
}
