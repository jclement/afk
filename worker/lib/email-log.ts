/**
 * Vacation email delivery log — write + read.
 *
 * One row per attempted send (success OR failure). Writers are the
 * lifecycle path (createVacation/update/cancel/...) and the manual
 * /resend endpoint. Readers are the GET /vacations/:id/email-log endpoint,
 * the JSON data export, and the support flow.
 *
 * Writes are wrapped in their own try/catch so a logging failure can never
 * take down the email send itself — if D1 has a hiccup we'd rather have
 * the email go out and lose the audit row than the inverse.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { newId } from "./ids.js";
import type { VacationEmailLog } from "../../shared/types.js";

type Kind = VacationEmailLog["kind"];
type Recipient = VacationEmailLog["recipient"];
type Method = VacationEmailLog["method"];

interface LogRow {
  id: string;
  vacation_id: string;
  recipient: Recipient;
  kind: Kind;
  method: Method;
  resend: number;
  mailgun_message_id: string | null;
  error: string | null;
  sent_at: string;
}

function rowToLog(r: LogRow): VacationEmailLog {
  return {
    id: r.id,
    vacation_id: r.vacation_id,
    recipient: r.recipient,
    kind: r.kind,
    method: r.method,
    resend: !!r.resend,
    mailgun_message_id: r.mailgun_message_id,
    error: r.error,
    sent_at: r.sent_at,
  };
}

/**
 * Record a single send attempt. Errors during the INSERT are swallowed
 * with a console.error — the audit trail is best-effort and must not
 * trip the surrounding email path.
 */
export async function recordVacationEmail(
  db: D1Database,
  input: {
    user_id: string;
    vacation_id: string;
    recipient: Recipient;
    kind: Kind;
    method?: Method;
    resend?: boolean;
    mailgun_message_id?: string | null;
    error?: string | null;
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO vacation_email_log
           (id, user_id, vacation_id, recipient, kind, method, resend,
            mailgun_message_id, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId(),
        input.user_id,
        input.vacation_id,
        input.recipient,
        input.kind,
        input.method ?? null,
        input.resend ? 1 : 0,
        input.mailgun_message_id ?? null,
        input.error ? input.error.slice(0, 500) : null,
      )
      .run();
  } catch (e) {
    console.error("[email-log] insert failed:", (e as Error).message);
  }
}

/** All log rows for one vacation, newest first. */
export async function listVacationEmailLog(
  db: D1Database,
  userId: string,
  vacationId: string,
): Promise<VacationEmailLog[]> {
  const { results } = await db
    .prepare(
      `SELECT id, vacation_id, recipient, kind, method, resend,
              mailgun_message_id, error, sent_at
         FROM vacation_email_log
        WHERE user_id = ? AND vacation_id = ?
        ORDER BY sent_at DESC`,
    )
    .bind(userId, vacationId)
    .all<LogRow>();
  return (results ?? []).map(rowToLog);
}

/** All log rows for a user across every vacation — for the JSON export. */
export async function listAllVacationEmailLog(
  db: D1Database,
  userId: string,
): Promise<VacationEmailLog[]> {
  const { results } = await db
    .prepare(
      `SELECT id, vacation_id, recipient, kind, method, resend,
              mailgun_message_id, error, sent_at
         FROM vacation_email_log
        WHERE user_id = ?
        ORDER BY sent_at ASC`,
    )
    .bind(userId)
    .all<LogRow>();
  return (results ?? []).map(rowToLog);
}
