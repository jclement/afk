/**
 * Recovery codes — 10 one-time codes per user, the fallback path if every
 * passkey is lost. Codes are SHA-256 hashed at rest; the plaintext is shown
 * to the user once at generation time.
 *
 * Format: `XXXX-XXXX-XXXX-XXXX` Crockford-base32 (no I/L/O/U). 80 bits per
 * code. Lookup normalises whitespace and dashes so users can paste freely.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { hashToken, newId, newRecoveryCode, normaliseRecoveryCode } from "./ids.js";

const CODES_PER_BATCH = 10;

/**
 * Wipe any prior codes and mint a fresh batch of `CODES_PER_BATCH`. Returns
 * the plaintext list for the caller to display once. Used by the initial
 * "Generate recovery codes" action and by "Regenerate" later.
 */
export async function regenerateRecoveryCodes(db: D1Database, userId: string): Promise<string[]> {
  await db.prepare(`DELETE FROM recovery_codes WHERE user_id = ?`).bind(userId).run();

  const plaintexts: string[] = [];
  const stmts = [];
  for (let i = 0; i < CODES_PER_BATCH; i++) {
    const code = newRecoveryCode();
    plaintexts.push(code);
    const hash = await hashToken(normaliseRecoveryCode(code));
    stmts.push(
      db
        .prepare(`INSERT INTO recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)`)
        .bind(newId(), userId, hash),
    );
  }
  await db.batch(stmts);
  return plaintexts;
}

export interface RecoveryCodesStatus {
  total: number;
  used: number;
  remaining: number;
  /** Has the user ever generated codes? Drives the wizard's "save them" UX. */
  generated: boolean;
}

/** Counts only — never returns plaintext or hashes. */
export async function getRecoveryCodesStatus(
  db: D1Database,
  userId: string,
): Promise<RecoveryCodesStatus> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS used
         FROM recovery_codes WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ total: number; used: number | null }>();
  const total = row?.total ?? 0;
  const used = row?.used ?? 0;
  return { total, used, remaining: total - used, generated: total > 0 };
}

/**
 * Verify-and-consume a recovery code for `userId`. Returns true if a matching
 * unused code existed and was just marked used; false otherwise. The
 * `WHERE … AND used_at IS NULL` guard makes consumption atomic — concurrent
 * uses of the same code can't double-spend.
 */
export async function consumeRecoveryCode(
  db: D1Database,
  userId: string,
  rawCode: string,
): Promise<boolean> {
  const normalised = normaliseRecoveryCode(rawCode);
  if (!normalised) return false;
  const hash = await hashToken(normalised);
  const res = await db
    .prepare(
      `UPDATE recovery_codes
          SET used_at = datetime('now')
        WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    )
    .bind(userId, hash)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
