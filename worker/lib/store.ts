/**
 * Repository layer over D1 for AFK domain objects (categories, allowances,
 * vacations, ical tokens, passkey credentials). One file because the schema
 * is small and lives mostly in the user's head.
 *
 * All queries use parameterised statements via D1's `.bind()` API. NEVER
 * interpolate user input into SQL strings.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { newId } from "./ids.js";
import { CATEGORY_PALETTE, nextCategoryColor } from "../../shared/colors.js";
import type { Allowance, Category, ICalToken, PasskeyMeta, Vacation } from "../../shared/types.js";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

type CategoryRow = Omit<Category, "archived" | "accrues"> & {
  archived: number;
  accrues: number;
};

function rowToCategory(r: CategoryRow): Category {
  return { ...r, archived: !!r.archived, accrues: !!r.accrues };
}

export async function listCategories(db: D1Database, userId: string): Promise<Category[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, accrues, color, sort_order, archived, created_at
       FROM categories WHERE user_id = ?
       ORDER BY archived ASC, sort_order ASC, name ASC`,
    )
    .bind(userId)
    .all<CategoryRow>();
  return (results ?? []).map(rowToCategory);
}

export async function createCategory(
  db: D1Database,
  userId: string,
  input: {
    name: string;
    accrues?: boolean;
    color?: string;
    sort_order?: number;
  },
): Promise<Category> {
  const id = newId();
  const existing = await listCategories(db, userId);
  const color =
    input.color ??
    nextCategoryColor(
      input.name,
      existing.map((c) => c.color),
    );
  const sortOrder =
    input.sort_order ??
    (existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.sort_order)) + 1);
  const accrues = input.accrues ? 1 : 0;
  await db
    .prepare(
      `INSERT INTO categories (id, user_id, name, accrues, color, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, input.name, accrues, color, sortOrder)
    .run();
  return {
    id,
    user_id: userId,
    name: input.name,
    accrues: !!accrues,
    color,
    sort_order: sortOrder,
    archived: false,
    created_at: new Date().toISOString(),
  };
}

export async function updateCategory(
  db: D1Database,
  userId: string,
  id: string,
  patch: Partial<Pick<Category, "name" | "accrues" | "color" | "archived" | "sort_order">>,
): Promise<Category | null> {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.accrues !== undefined) {
    fields.push("accrues = ?");
    vals.push(patch.accrues ? 1 : 0);
  }
  if (patch.color !== undefined) {
    fields.push("color = ?");
    vals.push(patch.color);
  }
  if (patch.archived !== undefined) {
    fields.push("archived = ?");
    vals.push(patch.archived ? 1 : 0);
  }
  if (patch.sort_order !== undefined) {
    fields.push("sort_order = ?");
    vals.push(patch.sort_order);
  }
  if (fields.length === 0) {
    const existing = await listCategories(db, userId);
    return existing.find((c) => c.id === id) ?? null;
  }
  vals.push(id, userId);
  const sql = `UPDATE categories SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`;
  await db
    .prepare(sql)
    .bind(...vals)
    .run();
  const row = await db
    .prepare(
      `SELECT id, user_id, name, accrues, color, sort_order, archived, created_at
       FROM categories WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<CategoryRow>();
  if (!row) return null;
  return rowToCategory(row);
}

export async function deleteCategory(
  db: D1Database,
  userId: string,
  id: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const usage = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM vacations WHERE category_id = ? AND user_id = ? AND cancelled_at IS NULL`,
    )
    .bind(id, userId)
    .first<{ n: number }>();
  if ((usage?.n ?? 0) > 0) {
    return {
      deleted: false,
      reason:
        "Category has active vacation entries. Archive it instead, or cancel its entries first.",
    };
  }
  // The schema FK on vacations.category_id is ON DELETE RESTRICT, so any
  // remaining cancelled-but-not-deleted rows would block the DELETE below
  // and throw a 500. Cancelled vacations are invisible to the user anyway —
  // hard-delete them in the same batch as the category.
  await db.batch([
    db
      .prepare(
        `DELETE FROM vacations WHERE category_id = ? AND user_id = ? AND cancelled_at IS NOT NULL`,
      )
      .bind(id, userId),
    db.prepare(`DELETE FROM allowances WHERE category_id = ? AND user_id = ?`).bind(id, userId),
    db.prepare(`DELETE FROM categories WHERE id = ? AND user_id = ?`).bind(id, userId),
  ]);
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Allowances
// ---------------------------------------------------------------------------

export async function listAllowances(
  db: D1Database,
  userId: string,
  year: number,
): Promise<Allowance[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, category_id, year, days_allotted, days_carryover, notes
       FROM allowances WHERE user_id = ? AND year = ?`,
    )
    .bind(userId, year)
    .all<Allowance>();
  return results ?? [];
}

/**
 * All allowances for a user across every year. Used by the data-export
 * endpoint — there's no per-year filter because the export is a full dump.
 */
export async function listAllAllowances(db: D1Database, userId: string): Promise<Allowance[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, category_id, year, days_allotted, days_carryover, notes
       FROM allowances WHERE user_id = ? ORDER BY year, category_id`,
    )
    .bind(userId)
    .all<Allowance>();
  return results ?? [];
}

export async function upsertAllowance(
  db: D1Database,
  userId: string,
  input: {
    category_id: string;
    year: number;
    days_allotted: number;
    days_carryover: number;
    notes?: string | null;
  },
): Promise<Allowance> {
  // Verify the category belongs to the user.
  const owns = await db
    .prepare(`SELECT id FROM categories WHERE id = ? AND user_id = ?`)
    .bind(input.category_id, userId)
    .first<{ id: string }>();
  if (!owns) throw new Error("Category not found.");

  const existing = await db
    .prepare(`SELECT id FROM allowances WHERE category_id = ? AND year = ?`)
    .bind(input.category_id, input.year)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE allowances SET days_allotted = ?, days_carryover = ?, notes = ? WHERE id = ?`,
      )
      .bind(input.days_allotted, input.days_carryover, input.notes ?? null, existing.id)
      .run();
    return {
      id: existing.id,
      user_id: userId,
      category_id: input.category_id,
      year: input.year,
      days_allotted: input.days_allotted,
      days_carryover: input.days_carryover,
      notes: input.notes ?? null,
    };
  }

  const id = newId();
  await db
    .prepare(
      `INSERT INTO allowances (id, user_id, category_id, year, days_allotted, days_carryover, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      input.category_id,
      input.year,
      input.days_allotted,
      input.days_carryover,
      input.notes ?? null,
    )
    .run();
  return {
    id,
    user_id: userId,
    category_id: input.category_id,
    year: input.year,
    days_allotted: input.days_allotted,
    days_carryover: input.days_carryover,
    notes: input.notes ?? null,
  };
}

// ---------------------------------------------------------------------------
// Vacations
// ---------------------------------------------------------------------------

export async function listVacationsInYear(
  db: D1Database,
  userId: string,
  year: number,
): Promise<Vacation[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, category_id, start_date, end_date, partial_amount,
              public_desc, internal_desc, cancelled_at, ical_sequence,
              created_at, updated_at
       FROM vacations
       WHERE user_id = ?
         AND start_date <= ?
         AND end_date >= ?
       ORDER BY start_date DESC, created_at DESC`,
    )
    .bind(userId, `${year}-12-31`, `${year}-01-01`)
    .all<Vacation>();
  return results ?? [];
}

export async function listAllVacations(db: D1Database, userId: string): Promise<Vacation[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, category_id, start_date, end_date, partial_amount,
              public_desc, internal_desc, cancelled_at, ical_sequence,
              created_at, updated_at
       FROM vacations
       WHERE user_id = ?
       ORDER BY start_date DESC, created_at DESC`,
    )
    .bind(userId)
    .all<Vacation>();
  return results ?? [];
}

export async function getVacation(
  db: D1Database,
  userId: string,
  id: string,
): Promise<Vacation | null> {
  return await db
    .prepare(
      `SELECT id, user_id, category_id, start_date, end_date, partial_amount,
              public_desc, internal_desc, cancelled_at, ical_sequence,
              created_at, updated_at
       FROM vacations WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<Vacation>();
}

export async function createVacation(
  db: D1Database,
  userId: string,
  input: {
    category_id: string;
    start_date: string;
    end_date: string;
    partial_amount: number | null;
    public_desc: string;
    internal_desc: string;
  },
): Promise<Vacation> {
  const owns = await db
    .prepare(`SELECT id FROM categories WHERE id = ? AND user_id = ?`)
    .bind(input.category_id, userId)
    .first<{ id: string }>();
  if (!owns) throw new Error("Category not found.");

  const id = newId();
  await db
    .prepare(
      `INSERT INTO vacations
       (id, user_id, category_id, start_date, end_date, partial_amount, public_desc, internal_desc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      input.category_id,
      input.start_date,
      input.end_date,
      input.partial_amount,
      input.public_desc,
      input.internal_desc,
    )
    .run();
  const row = await getVacation(db, userId, id);
  return row!;
}

export async function updateVacation(
  db: D1Database,
  userId: string,
  id: string,
  patch: Partial<{
    category_id: string;
    start_date: string;
    end_date: string;
    partial_amount: number | null;
    public_desc: string;
    internal_desc: string;
    cancelled_at: string | null;
  }>,
): Promise<Vacation | null> {
  const existing = await getVacation(db, userId, id);
  if (!existing) return null;
  if (patch.category_id) {
    const owns = await db
      .prepare(`SELECT id FROM categories WHERE id = ? AND user_id = ?`)
      .bind(patch.category_id, userId)
      .first<{ id: string }>();
    if (!owns) throw new Error("Category not found.");
  }
  // Allowlist: never interpolate object keys into SQL without one. Today's
  // callers all pass typed keys, but a future caller spreading user input
  // would otherwise be a SQLi vector.
  const ALLOWED_KEYS = new Set([
    "category_id",
    "start_date",
    "end_date",
    "partial_amount",
    "public_desc",
    "internal_desc",
    "cancelled_at",
  ]);
  const fields: string[] = ["updated_at = datetime('now')", "ical_sequence = ical_sequence + 1"];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    fields.push(`${k} = ?`);
    vals.push(v as never);
  }
  vals.push(id, userId);
  await db
    .prepare(`UPDATE vacations SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`)
    .bind(...vals)
    .run();
  return await getVacation(db, userId, id);
}

export async function cancelVacation(
  db: D1Database,
  userId: string,
  id: string,
): Promise<Vacation | null> {
  const existing = await getVacation(db, userId, id);
  if (!existing) return null;
  await db
    .prepare(
      `UPDATE vacations
         SET cancelled_at = datetime('now'),
             updated_at = datetime('now'),
             ical_sequence = ical_sequence + 1
       WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .run();
  return await getVacation(db, userId, id);
}

export async function uncancelVacation(
  db: D1Database,
  userId: string,
  id: string,
): Promise<Vacation | null> {
  const existing = await getVacation(db, userId, id);
  if (!existing) return null;
  await db
    .prepare(
      `UPDATE vacations
         SET cancelled_at = NULL,
             updated_at = datetime('now'),
             ical_sequence = ical_sequence + 1
       WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .run();
  return await getVacation(db, userId, id);
}

export async function deleteVacation(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM vacations WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// iCal tokens
// ---------------------------------------------------------------------------

export async function listICalTokens(
  db: D1Database,
  userId: string,
  origin: string,
): Promise<ICalToken[]> {
  const { results } = await db
    .prepare(
      `SELECT id, scope, label, created_at, last_used_at, token
       FROM ical_tokens WHERE user_id = ? ORDER BY scope ASC, created_at ASC`,
    )
    .bind(userId)
    .all<{
      id: string;
      scope: "private" | "public";
      label: string;
      created_at: string;
      last_used_at: string | null;
      token: string;
    }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    scope: r.scope,
    label: r.label,
    created_at: r.created_at,
    last_used_at: r.last_used_at,
    feed_url: `${origin}/ical/${r.token}.ics`,
  }));
}

export async function createICalToken(
  db: D1Database,
  userId: string,
  input: { scope: "private" | "public"; label: string; token: string },
): Promise<{ id: string; token: string }> {
  const id = newId();
  await db
    .prepare(`INSERT INTO ical_tokens (id, user_id, token, scope, label) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, userId, input.token, input.scope, input.label)
    .run();
  return { id, token: input.token };
}

export async function deleteICalToken(
  db: D1Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM ical_tokens WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function findUserByICalToken(
  db: D1Database,
  token: string,
): Promise<{ user_id: string; scope: "private" | "public" } | null> {
  const row = await db
    .prepare(`SELECT user_id, scope FROM ical_tokens WHERE token = ?`)
    .bind(token)
    .first<{ user_id: string; scope: "private" | "public" }>();
  if (!row) return null;
  // Update last_used asynchronously — not awaited by the caller via wait_until.
  await db
    .prepare(`UPDATE ical_tokens SET last_used_at = datetime('now') WHERE token = ?`)
    .bind(token)
    .run();
  return row;
}

// ---------------------------------------------------------------------------
// Passkey credentials
// ---------------------------------------------------------------------------

export async function listPasskeys(db: D1Database, userId: string): Promise<PasskeyMeta[]> {
  const { results } = await db
    .prepare(
      `SELECT id, nickname, device_type, backed_up, created_at, last_used_at
       FROM credentials WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .bind(userId)
    .all<{
      id: string;
      nickname: string | null;
      device_type: string | null;
      backed_up: number;
      created_at: string;
      last_used_at: string | null;
    }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    nickname: r.nickname,
    device_type: r.device_type,
    backed_up: !!r.backed_up,
    created_at: r.created_at,
    last_used_at: r.last_used_at,
  }));
}

export async function listCredentialIds(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT id FROM credentials WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}

export async function listAllCredentialsForUsername(
  db: D1Database,
  username: string,
): Promise<Array<{ id: string; transports: string[] | null }>> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS id, c.transports AS transports
       FROM credentials c JOIN users u ON c.user_id = u.id
       WHERE u.username = ?`,
    )
    .bind(username)
    .all<{ id: string; transports: string | null }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    transports: r.transports ? JSON.parse(r.transports) : null,
  }));
}

export async function insertCredential(
  db: D1Database,
  input: {
    id: string;
    user_id: string;
    public_key: string;
    counter: number;
    transports: string[] | null;
    device_type: string | null;
    backed_up: boolean;
    nickname: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, nickname)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.user_id,
      input.public_key,
      input.counter,
      input.transports ? JSON.stringify(input.transports) : null,
      input.device_type,
      input.backed_up ? 1 : 0,
      input.nickname,
    )
    .run();
}

export async function updateCredentialCounter(
  db: D1Database,
  id: string,
  counter: number,
): Promise<void> {
  await db
    .prepare(`UPDATE credentials SET counter = ?, last_used_at = datetime('now') WHERE id = ?`)
    .bind(counter, id)
    .run();
}

export async function renamePasskey(
  db: D1Database,
  userId: string,
  id: string,
  nickname: string,
): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE credentials SET nickname = ? WHERE id = ? AND user_id = ?`)
    .bind(nickname, id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function deletePasskey(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM credentials WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Used during onboarding so the first user gets sensible defaults. */
export async function seedDefaultCategories(db: D1Database, userId: string): Promise<void> {
  await createCategory(db, userId, {
    name: "Vacation",
    accrues: true,
    color: CATEGORY_PALETTE[0]!,
    sort_order: 0,
  });
  await createCategory(db, userId, {
    name: "Flex",
    accrues: false,
    color: CATEGORY_PALETTE[1]!,
    sort_order: 1,
  });
}
