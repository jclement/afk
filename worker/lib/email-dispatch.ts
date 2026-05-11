/**
 * Vacation email send + log, in one place.
 *
 * Every vacation-related send goes through one of these three helpers so
 * the delivery-log write is unmissable. Previously the send sites in
 * vacations.ts wrapped sendBossNotifyInvite/sendVacationLifecycleEmail in
 * their own try/catch with `console.error` — failures were lost as soon
 * as the Worker log rotated. Now the same try/catch records a row in
 * `vacation_email_log` so the user (and any future support flow) can ask
 * "did the boss actually get it?" months after the fact.
 *
 * Each helper:
 *   1. Attempts the send via the relevant boss-emails / vacation-emails
 *      function (which propagate Mailgun errors).
 *   2. Records a log row — `mailgun_message_id` on success, `error` on
 *      failure — and never lets the log write itself bubble up.
 *   3. Swallows the send error (returns a structured result with `error`)
 *      so the caller can fan out the remaining sends in a lifecycle batch
 *      without aborting on the first failure.
 *
 * The `resend` flag distinguishes manual /resend invocations from
 * automatic lifecycle sends so the UI can show a "manually resent" badge.
 */

import type { Env } from "../types.js";
import type {
  BossRelationship,
  Category,
  User,
  Vacation,
  VacationApproval,
  VacationEmailLog,
} from "../../shared/types.js";
import { sendBossApprovalRequest, sendBossNotifyInvite } from "./boss-emails.js";
import { recordVacationEmail } from "./email-log.js";
import { sendVacationLifecycleEmail, type VacationLifecycle } from "./vacation-emails.js";

export interface DispatchResult {
  /** `true` if the send was skipped (e.g. user has no verified email). */
  skipped?: boolean;
  /** Reason when skipped — surfaced to the caller for the response body. */
  skip_reason?: "no_user_email";
  /** Mailgun message id on a successful 2xx send. */
  mailgun_message_id?: string;
  /** Human-readable error when the send threw. */
  error?: string;
  /** Recipient + kind + method actually used — convenient for the resend
   *  endpoint response and any UI summary. */
  recipient: VacationEmailLog["recipient"];
  kind: VacationEmailLog["kind"];
  method: VacationEmailLog["method"];
}

/** Send the user-side iCal lifecycle email and log the result. */
export async function dispatchUserLifecycle(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  vacation: Vacation;
  category: Category | null;
  lifecycle: VacationLifecycle;
  resend?: boolean;
}): Promise<DispatchResult> {
  const { env, appOrigin, user, vacation, category, lifecycle, resend } = opts;
  // The same gate as inside sendVacationLifecycleEmail — but called here
  // too so we can record the skip and report it back to the caller without
  // a phantom log row.
  if (!user.email || !user.email_verified_at) {
    return {
      skipped: true,
      skip_reason: "no_user_email",
      recipient: "self",
      kind: "lifecycle",
      method: lifecycle === "cancelled" || lifecycle === "deleted" ? "CANCEL" : "PUBLISH",
    };
  }
  const method: "PUBLISH" | "CANCEL" =
    lifecycle === "cancelled" || lifecycle === "deleted" ? "CANCEL" : "PUBLISH";
  try {
    const res = await sendVacationLifecycleEmail(
      env,
      appOrigin,
      user,
      vacation,
      category,
      lifecycle,
    );
    const messageId = "id" in res ? (res.id ?? null) : null;
    await recordVacationEmail(env.DB, {
      user_id: user.id,
      vacation_id: vacation.id,
      recipient: "self",
      kind: "lifecycle",
      method,
      resend: resend ?? false,
      mailgun_message_id: messageId,
    });
    return {
      mailgun_message_id: messageId ?? undefined,
      recipient: "self",
      kind: "lifecycle",
      method,
    };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[email-dispatch] user lifecycle failed:", msg);
    await recordVacationEmail(env.DB, {
      user_id: user.id,
      vacation_id: vacation.id,
      recipient: "self",
      kind: "lifecycle",
      method,
      resend: resend ?? false,
      error: msg,
    });
    return { error: msg, recipient: "self", kind: "lifecycle", method };
  }
}

/** Send the boss-side iCal notify invite (PUBLISH/CANCEL) and log it. */
export async function dispatchBossNotify(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  boss: BossRelationship;
  vacation: Vacation;
  category: Category | null;
  method: "PUBLISH" | "CANCEL";
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  unsubscribeToken: string;
  resend?: boolean;
}): Promise<DispatchResult> {
  const {
    env,
    appOrigin,
    user,
    boss,
    vacation,
    category,
    method,
    status,
    unsubscribeToken,
    resend,
  } = opts;
  try {
    const res = await sendBossNotifyInvite({
      env,
      appOrigin,
      user,
      boss,
      vacation,
      category,
      method,
      status,
      unsubscribeToken,
    });
    const messageId = res.id ?? null;
    await recordVacationEmail(env.DB, {
      user_id: user.id,
      vacation_id: vacation.id,
      recipient: "boss",
      kind: "notify_invite",
      method,
      resend: resend ?? false,
      mailgun_message_id: messageId,
    });
    return {
      mailgun_message_id: messageId ?? undefined,
      recipient: "boss",
      kind: "notify_invite",
      method,
    };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[email-dispatch] boss notify failed:", msg);
    await recordVacationEmail(env.DB, {
      user_id: user.id,
      vacation_id: vacation.id,
      recipient: "boss",
      kind: "notify_invite",
      method,
      resend: resend ?? false,
      error: msg,
    });
    return { error: msg, recipient: "boss", kind: "notify_invite", method };
  }
}

/** Send the boss-side approval-request email and log it. */
export async function dispatchBossApprovalRequest(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  boss: BossRelationship;
  vacation: Vacation;
  category: Category | null;
  approval: VacationApproval;
  decisionToken: string;
  balance: { used_days: number; total_days: number; remaining_days: number };
  unsubscribeToken: string;
  resend?: boolean;
}): Promise<DispatchResult> {
  const { env, user, vacation, resend } = opts;
  try {
    const res = await sendBossApprovalRequest({
      env: opts.env,
      appOrigin: opts.appOrigin,
      user,
      boss: opts.boss,
      vacation,
      category: opts.category,
      approval: opts.approval,
      decisionToken: opts.decisionToken,
      balance: opts.balance,
      unsubscribeToken: opts.unsubscribeToken,
    });
    const messageId = res.id ?? null;
    await recordVacationEmail(env.DB, {
      user_id: user.id,
      vacation_id: vacation.id,
      recipient: "boss",
      kind: "approval_request",
      // No iCal attachment on this kind.
      method: null,
      resend: resend ?? false,
      mailgun_message_id: messageId,
    });
    return {
      mailgun_message_id: messageId ?? undefined,
      recipient: "boss",
      kind: "approval_request",
      method: null,
    };
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[email-dispatch] boss approval-request failed:", msg);
    await recordVacationEmail(env.DB, {
      user_id: user.id,
      vacation_id: vacation.id,
      recipient: "boss",
      kind: "approval_request",
      method: null,
      resend: resend ?? false,
      error: msg,
    });
    return { error: msg, recipient: "boss", kind: "approval_request", method: null };
  }
}
