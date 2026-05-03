/**
 * Boss / approver storage layer.
 *
 * The "boss" is an external email address with no AFK account. Two artefacts:
 *   - boss_relationships: one row per user expressing "this email address is
 *     my boss/approver, in `mode`." Has consent state.
 *   - vacation_approvals: only used in approval mode. One row per
 *     (boss, vacation) tracking pending → approved | rejected.
 *
 * Tokens are 32-byte hex strings (see `newBossToken`). Consent tokens are
 * cleared on accept; decision tokens are cleared after the decision so they
 * can't be replayed.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { newBossToken, newId } from "./ids.js";
import type {
  ApprovalState,
  BossConsentStatus,
  BossMode,
  BossRelationship,
  VacationApproval,
} from "../../shared/types.js";

// 7 days for the boss to consent. Longer than the 24h email-verification
// because the boss is a third party who may not check email daily.
const CONSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 14 days for an approval to live before the user has to resubmit.
const APPROVAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface BossRow {
  id: string;
  user_id: string;
  boss_email: string;
  boss_display_name: string;
  mode: BossMode;
  consent_token: string | null;
  consent_token_expires_at: string | null;
  consented_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function rowToBoss(r: BossRow): BossRelationship {
  return {
    id: r.id,
    user_id: r.user_id,
    boss_email: r.boss_email,
    boss_display_name: r.boss_display_name,
    mode: r.mode,
    consent_status: deriveConsentStatus(r),
    consented_at: r.consented_at,
    revoked_at: r.revoked_at,
    created_at: r.created_at,
  };
}

function deriveConsentStatus(r: {
  consented_at: string | null;
  revoked_at: string | null;
}): BossConsentStatus {
  if (r.revoked_at) return "revoked";
  if (r.consented_at) return "consented";
  return "pending";
}

const SELECT_BOSS = `SELECT id, user_id, boss_email, boss_display_name, mode,
  consent_token, consent_token_expires_at, consented_at, revoked_at, created_at
  FROM boss_relationships`;

/** Get the (single) boss relationship for a user, or null. */
export async function getBoss(db: D1Database, userId: string): Promise<BossRelationship | null> {
  const row = await db
    .prepare(`${SELECT_BOSS} WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<BossRow>();
  return row ? rowToBoss(row) : null;
}

/**
 * Internal: get the raw row (with token fields) for sending emails. Don't
 * expose the token via the user-facing BossRelationship type.
 */
async function getBossRowByUser(db: D1Database, userId: string): Promise<BossRow | null> {
  const row = await db
    .prepare(`${SELECT_BOSS} WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<BossRow>();
  return row ?? null;
}

/**
 * Create or update the user's boss relationship. If the email or mode
 * changed (or there's no row yet), mints a fresh consent token and resets
 * the consent state — the boss has to re-confirm under the new terms.
 *
 * Returns the new relationship plus the consent token so the caller can
 * email it. The token is only returned here, never stored on the
 * BossRelationship surface type.
 */
export async function upsertBoss(
  db: D1Database,
  userId: string,
  input: { boss_email: string; boss_display_name: string; mode: BossMode },
): Promise<{ boss: BossRelationship; consent_token: string | null }> {
  const existing = await getBossRowByUser(db, userId);
  const sameEmail = existing && existing.boss_email === input.boss_email;
  const sameMode = existing && existing.mode === input.mode;

  if (existing && sameEmail && sameMode) {
    // Display-name only change — keep consent.
    if (existing.boss_display_name !== input.boss_display_name) {
      await db
        .prepare(`UPDATE boss_relationships SET boss_display_name = ? WHERE id = ?`)
        .bind(input.boss_display_name, existing.id)
        .run();
      const updated = await getBossRowByUser(db, userId);
      return { boss: rowToBoss(updated!), consent_token: null };
    }
    return { boss: rowToBoss(existing), consent_token: null };
  }

  // Email or mode changed → reset consent and mint a new token.
  const token = newBossToken();
  const expires = new Date(Date.now() + CONSENT_TTL_MS).toISOString();

  if (existing) {
    // Reset any in-flight approval state when the relationship is
    // re-pointed. Two triggers:
    //  - email change: old boss must not be able to use a decision token
    //    that would now ship results to the new boss (auth hijack)
    //  - mode change off "approval": pending vacations are zombies in
    //    notify mode (no boss to ever decide them)
    const emailChanged = existing.boss_email !== input.boss_email;
    const leavingApprovalMode = existing.mode === "approval" && input.mode !== "approval";
    if (emailChanged || leavingApprovalMode) {
      await db.batch([
        db
          .prepare(
            `UPDATE vacation_approvals
                SET decision_token = NULL,
                    decision_token_expires_at = NULL
              WHERE boss_relationship_id = ?`,
          )
          .bind(existing.id),
        db
          .prepare(
            `UPDATE vacations
                SET approval_state = NULL,
                    ical_sequence = ical_sequence + 1,
                    updated_at = datetime('now')
              WHERE user_id = ? AND approval_state = 'pending'`,
          )
          .bind(userId),
      ]);
    }
    await db
      .prepare(
        `UPDATE boss_relationships
            SET boss_email = ?, boss_display_name = ?, mode = ?,
                consent_token = ?, consent_token_expires_at = ?,
                consented_at = NULL, revoked_at = NULL
          WHERE id = ?`,
      )
      .bind(input.boss_email, input.boss_display_name, input.mode, token, expires, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO boss_relationships
           (id, user_id, boss_email, boss_display_name, mode, consent_token, consent_token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(newId(), userId, input.boss_email, input.boss_display_name, input.mode, token, expires)
      .run();
  }

  const after = await getBossRowByUser(db, userId);
  return { boss: rowToBoss(after!), consent_token: token };
}

/**
 * Re-issue a consent token for an existing boss row that hasn't been
 * accepted yet. Returns the new token, or null if the boss is already
 * consented (no need to re-issue).
 */
export async function reissueConsentToken(
  db: D1Database,
  userId: string,
): Promise<{ boss: BossRelationship; consent_token: string } | null> {
  const existing = await getBossRowByUser(db, userId);
  if (!existing) return null;
  if (existing.consented_at && !existing.revoked_at) return null;
  const token = newBossToken();
  const expires = new Date(Date.now() + CONSENT_TTL_MS).toISOString();
  await db
    .prepare(
      `UPDATE boss_relationships
          SET consent_token = ?, consent_token_expires_at = ?,
              consented_at = NULL, revoked_at = NULL
        WHERE id = ?`,
    )
    .bind(token, expires, existing.id)
    .run();
  const after = await getBossRowByUser(db, userId);
  return { boss: rowToBoss(after!), consent_token: token };
}

/**
 * Look up a boss relationship by an active consent token. Returns null on
 * unknown / expired tokens. Does NOT consume the token — the caller (the
 * consent route) decides whether to accept and burn it.
 */
export async function findBossByConsentToken(
  db: D1Database,
  token: string,
): Promise<BossRelationship | null> {
  const row = await db
    .prepare(`${SELECT_BOSS} WHERE consent_token = ?`)
    .bind(token)
    .first<BossRow>();
  if (!row) return null;
  if (
    row.consent_token_expires_at &&
    new Date(row.consent_token_expires_at).getTime() < Date.now()
  ) {
    return null;
  }
  return rowToBoss(row);
}

/** Mark consent and clear the token. Idempotent — re-clicking does nothing. */
export async function acceptBossConsent(
  db: D1Database,
  token: string,
): Promise<BossRelationship | null> {
  const boss = await findBossByConsentToken(db, token);
  if (!boss) return null;
  await db
    .prepare(
      `UPDATE boss_relationships
          SET consented_at = datetime('now'),
              consent_token = NULL,
              consent_token_expires_at = NULL,
              revoked_at = NULL
        WHERE id = ?`,
    )
    .bind(boss.id)
    .run();
  return await getBoss(db, boss.user_id);
}

/**
 * Revoke a relationship. Used by the boss via the unsubscribe footer in
 * every email, and by the user via DELETE. Sets revoked_at; future emails
 * skip this row. The user can re-add (will mint a new token).
 */
export async function revokeBoss(db: D1Database, relationshipId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE boss_relationships
          SET revoked_at = datetime('now'),
              consent_token = NULL,
              consent_token_expires_at = NULL
        WHERE id = ?`,
    )
    .bind(relationshipId)
    .run();
}

/**
 * Hard-delete the relationship + null `approval_state` on any vacation that
 * was pending the (now-deleted) boss's decision. CASCADE cleans up the
 * `vacation_approvals` rows but the denormalised `vacations.approval_state`
 * doesn't have a FK — without this UPDATE those rows would be zombies
 * (TENTATIVE on the user's calendar forever, no boss to resolve them).
 */
export async function deleteBoss(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE vacations
            SET approval_state = NULL,
                ical_sequence = ical_sequence + 1,
                updated_at = datetime('now')
          WHERE user_id = ? AND approval_state = 'pending'`,
      )
      .bind(userId),
    db.prepare(`DELETE FROM boss_relationships WHERE user_id = ?`).bind(userId),
  ]);
}

// ---------------------------------------------------------------------------
// Vacation approvals (approval mode only)
// ---------------------------------------------------------------------------

interface ApprovalRow {
  id: string;
  vacation_id: string;
  boss_relationship_id: string;
  state: ApprovalState;
  decision_token: string | null;
  decision_token_expires_at: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
}

function rowToApproval(r: ApprovalRow): VacationApproval {
  return {
    id: r.id,
    vacation_id: r.vacation_id,
    boss_relationship_id: r.boss_relationship_id,
    state: r.state,
    decided_at: r.decided_at,
    decision_comment: r.decision_comment,
    created_at: r.created_at,
  };
}

const SELECT_APPROVAL = `SELECT id, vacation_id, boss_relationship_id, state,
  decision_token, decision_token_expires_at, decided_at, decision_comment, created_at
  FROM vacation_approvals`;

/**
 * Create (or replace) an approval for a vacation under a given boss
 * relationship. Mints a fresh decision token. If a row already exists for
 * the (vacation, boss) pair (e.g. user re-edited a vacation), we re-set
 * the state to `pending` and refresh the token — past decisions are
 * superseded by the new request.
 */
export async function createOrResetApproval(
  db: D1Database,
  vacationId: string,
  bossRelationshipId: string,
): Promise<{ approval: VacationApproval; decision_token: string }> {
  const token = newBossToken();
  const expires = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  const existing = await db
    .prepare(`SELECT id FROM vacation_approvals WHERE vacation_id = ? AND boss_relationship_id = ?`)
    .bind(vacationId, bossRelationshipId)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        `UPDATE vacation_approvals
            SET state = 'pending',
                decision_token = ?, decision_token_expires_at = ?,
                decided_at = NULL, decision_comment = NULL
          WHERE id = ?`,
      )
      .bind(token, expires, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO vacation_approvals
           (id, vacation_id, boss_relationship_id, state, decision_token, decision_token_expires_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(newId(), vacationId, bossRelationshipId, token, expires)
      .run();
  }
  const row = await db
    .prepare(`${SELECT_APPROVAL} WHERE vacation_id = ? AND boss_relationship_id = ?`)
    .bind(vacationId, bossRelationshipId)
    .first<ApprovalRow>();
  return { approval: rowToApproval(row!), decision_token: token };
}

/**
 * Look up an approval by its decision token, joining the user, vacation, and
 * boss relationship for the rendering page. Returns null on unknown /
 * expired / already-decided tokens (decision_token is cleared on decide).
 */
export async function findApprovalByToken(
  db: D1Database,
  token: string,
): Promise<{
  approval: VacationApproval;
  user_id: string;
  vacation_id: string;
  boss: BossRelationship;
} | null> {
  const row = await db
    .prepare(
      `SELECT a.id AS a_id, a.vacation_id AS a_vacation_id,
              a.boss_relationship_id AS a_brid, a.state AS a_state,
              a.decision_token AS a_token, a.decision_token_expires_at AS a_expires,
              a.decided_at AS a_decided_at, a.decision_comment AS a_comment,
              a.created_at AS a_created_at,
              v.user_id AS v_user_id,
              b.id AS b_id, b.user_id AS b_user_id, b.boss_email AS b_email,
              b.boss_display_name AS b_display, b.mode AS b_mode,
              b.consented_at AS b_consented, b.revoked_at AS b_revoked,
              b.created_at AS b_created
         FROM vacation_approvals a
         JOIN vacations v          ON v.id = a.vacation_id
         JOIN boss_relationships b ON b.id = a.boss_relationship_id
        WHERE a.decision_token = ?`,
    )
    .bind(token)
    .first<{
      a_id: string;
      a_vacation_id: string;
      a_brid: string;
      a_state: ApprovalState;
      a_token: string | null;
      a_expires: string | null;
      a_decided_at: string | null;
      a_comment: string | null;
      a_created_at: string;
      v_user_id: string;
      b_id: string;
      b_user_id: string;
      b_email: string;
      b_display: string;
      b_mode: BossMode;
      b_consented: string | null;
      b_revoked: string | null;
      b_created: string;
    }>();
  if (!row) return null;
  if (row.a_expires && new Date(row.a_expires).getTime() < Date.now()) return null;
  return {
    approval: {
      id: row.a_id,
      vacation_id: row.a_vacation_id,
      boss_relationship_id: row.a_brid,
      state: row.a_state,
      decided_at: row.a_decided_at,
      decision_comment: row.a_comment,
      created_at: row.a_created_at,
    },
    user_id: row.v_user_id,
    vacation_id: row.a_vacation_id,
    boss: {
      id: row.b_id,
      user_id: row.b_user_id,
      boss_email: row.b_email,
      boss_display_name: row.b_display,
      mode: row.b_mode,
      consent_status: deriveConsentStatus({
        consented_at: row.b_consented,
        revoked_at: row.b_revoked,
      }),
      consented_at: row.b_consented,
      revoked_at: row.b_revoked,
      created_at: row.b_created,
    },
  };
}

/**
 * Record the boss's decision and clear the token so it can't be replayed.
 * `comment` is required on reject (enforced by the caller).
 */
/**
 * Record the boss's decision and clear the token. Returns true if the row
 * was actually updated — the `WHERE … AND decision_token IS NOT NULL` guard
 * makes this a one-shot: a second concurrent click in another tab finds
 * the token already cleared and `meta.changes === 0`, so the caller can
 * skip the duplicate fan-out (no double emails, no second sequence bump).
 */
export async function decideApproval(
  db: D1Database,
  approvalId: string,
  decision: "approved" | "rejected",
  comment: string | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE vacation_approvals
          SET state = ?,
              decided_at = datetime('now'),
              decision_comment = ?,
              decision_token = NULL,
              decision_token_expires_at = NULL
        WHERE id = ? AND decision_token IS NOT NULL`,
    )
    .bind(decision, comment, approvalId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Drop expired tokens. Called from the daily cron — same shape as the other
 * `purgeExpired*` helpers, with the same `julianday()` workaround for the
 * ISO-vs-`datetime('now')` lexicographic gotcha.
 */
export async function purgeExpiredBossTokens(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE boss_relationships
          SET consent_token = NULL, consent_token_expires_at = NULL
        WHERE consent_token IS NOT NULL
          AND julianday(consent_token_expires_at) < julianday('now')`,
    )
    .run();
  await db
    .prepare(
      `UPDATE vacation_approvals
          SET decision_token = NULL, decision_token_expires_at = NULL
        WHERE decision_token IS NOT NULL
          AND julianday(decision_token_expires_at) < julianday('now')`,
    )
    .run();
}

/**
 * Null any in-flight decision token tied to a vacation. Called from the
 * user-side cancel handler so a boss who's still holding an unread
 * approval-request email can't approve a vacation the user just cancelled
 * (which would silently un-cancel it via boss-public.ts).
 */
export async function clearPendingDecisionTokens(
  db: D1Database,
  vacationId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE vacation_approvals
          SET decision_token = NULL,
              decision_token_expires_at = NULL
        WHERE vacation_id = ? AND state = 'pending'`,
    )
    .bind(vacationId)
    .run();
}

/** Set the denormalised approval_state on the vacations row. */
export async function setVacationApprovalState(
  db: D1Database,
  userId: string,
  vacationId: string,
  state: ApprovalState | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE vacations
          SET approval_state = ?,
              ical_sequence = ical_sequence + 1,
              updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
    )
    .bind(state, vacationId, userId)
    .run();
}
