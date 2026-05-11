/**
 * Outbound email to the boss/approver.
 *
 * Four templates:
 *   1. consent          — first contact: "{Display name} would like to share
 *                          their vacation calendar with you on AFK."
 *   2. notify-invite    — boss copy of an iCal invite (notify mode only).
 *                          Subject leads with the employee's display_name.
 *   3. approval-request — "{Display name} wants {dates} off — approve or
 *                          reject" with a magic link to the approval page.
 *   4. decision-receipt — back to the user, after the boss approved or
 *                          rejected. Rejection includes the boss's comment.
 *
 * Failures are caught at the call site (waitUntil with .catch). This module
 * just builds + posts. Every email includes a one-click revoke link in the
 * footer so the boss can stop receiving these without needing an account.
 */

import type { Env } from "../types.js";
import type {
  BossRelationship,
  Category,
  User,
  Vacation,
  VacationApproval,
} from "../../shared/types.js";
import { describeVacation, vacationDayCost } from "../../shared/vacation-math.js";
import {
  badge,
  button,
  divider,
  escapeHtml,
  escapeHtmlMultiline,
  lead,
  linkFallback,
  metaTable,
  muted,
  notesBlock,
  paragraph,
  renderEmail,
} from "./email-template.js";
import { buildInviteIcs, inviteSummary } from "./ical-invite.js";
import { sendCalendarInvite, sendPlainEmail, type SendResult } from "./mailgun.js";

/**
 * Send the consent request — the very first email a boss receives when a
 * user adds them. Plain text only (it's a one-click flow, no calendar
 * attachment until they consent).
 */
export async function sendBossConsentEmail(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  boss: BossRelationship;
  consentToken: string;
}): Promise<void> {
  const { env, appOrigin, user, boss, consentToken } = opts;
  const url = `${appOrigin}/boss/consent/${consentToken}`;
  const modeBlurb =
    boss.mode === "notify"
      ? "you'll receive a calendar invite (.ics) for each vacation they take, so their schedule shows up next to yours."
      : "you'll be asked to approve or reject each vacation request via a one-click link. Their bookings won't go live until you decide.";

  const text = [
    `Hi,`,
    "",
    `${user.display_name} (${user.email ?? "no email on file"}) is using AFK — Away From Keyboard, a personal vacation tracker — and would like to share their schedule with you.`,
    "",
    `Mode: ${boss.mode === "notify" ? "Notify" : "Requires approval"}`,
    `What that means: ${modeBlurb}`,
    "",
    "AFK has no account for you. Just click the link below to consent:",
    "",
    url,
    "",
    "If you don't want to receive these, ignore this email — nothing happens until you click.",
    "",
    "— AFK · " + appOrigin,
  ].join("\n");

  const html = renderEmail({
    preheader: `${user.display_name} wants to share their vacation calendar with you.`,
    heading: `${user.display_name} wants to share their vacation calendar with you`,
    accent: "brand",
    blocks: [
      lead(
        `<strong>${escapeHtml(user.display_name)}</strong> (${escapeHtml(user.email ?? "no email on file")}) is using <strong>AFK</strong> — a personal vacation tracker — and would like to share their schedule with you.`,
      ),
      `<div style="margin:0 0 16px 0;">${
        boss.mode === "notify" ? badge("Notify mode", "brand") : badge("Approval mode", "brand")
      }</div>`,
      paragraph(escapeHtml(modeBlurb)),
      paragraph(`AFK has no account for you. Just click below to consent:`),
      button(url, boss.mode === "notify" ? "Accept notifications" : "Become approver"),
      linkFallback(url),
      muted(
        `If you don't want to receive these, ignore this email — nothing happens until you click.`,
      ),
    ],
    footer: `Sent by AFK · <a href="${escapeHtml(appOrigin)}" style="color:inherit;">${escapeHtml(appOrigin)}</a><br>You'll only get further messages from AFK if you click above.`,
  });

  await sendPlainEmail(env, {
    to: boss.boss_email,
    subject: `${user.display_name} wants to share vacation with you on AFK`,
    text,
    html,
    replyTo: user.email ?? undefined,
  });
}

/**
 * Boss copy of a vacation iCal invite (notify mode only). Mirrors what the
 * user sends to themselves, but the subject leads with the user's
 * display_name so the boss can spot whose schedule changed at a glance.
 */
export async function sendBossNotifyInvite(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  boss: BossRelationship;
  vacation: Vacation;
  category: Category | null;
  method: "PUBLISH" | "CANCEL";
  /** Override status. Defaults to CONFIRMED on PUBLISH (boss only sees
   * approved bookings in approval mode; notify mode never has pending). */
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Per-relationship unsubscribe token — embedded in the footer + RFC 8058
   *  List-Unsubscribe header so the manager can opt out in one click. */
  unsubscribeToken: string;
}): Promise<SendResult> {
  const { env, appOrigin, user, boss, vacation, category, method, status, unsubscribeToken } = opts;
  const unsubUrl = `${appOrigin}/boss/unsubscribe/${unsubscribeToken}`;
  const organizerEmail = env.MAILGUN_FROM
    ? extractAddress(env.MAILGUN_FROM)
    : env.MAILGUN_DOMAIN
      ? `afk@${env.MAILGUN_DOMAIN}`
      : "afk@invalid";

  const ics = buildInviteIcs({
    user,
    vacation,
    category,
    organizerEmail,
    method,
    sequence: vacation.ical_sequence,
    appOrigin,
    // The boss never sees the user's internal_desc — that's user-private
    // notes ("kid's birthday party", etc.). Only public_desc + dates.
    includeInternalDesc: false,
    status,
    summaryPrefix: status === "TENTATIVE" ? "Pending" : undefined,
    // It's the user's vacation, not the manager's — show on their calendar
    // but don't block their availability.
    showAsFree: true,
  });

  const summary = inviteSummary(category, vacation);
  const verb = method === "CANCEL" ? "Cancelled" : status === "TENTATIVE" ? "Pending" : "Vacation";
  // display_name leads, NOT email — keeps the subject readable. Email is in
  // the body for context (so the boss can reply / forward).
  const subject = `${user.display_name} — ${verb}: ${summary}`;
  const range = describeVacation(vacation);
  const days = vacationDayCost(vacation);

  const text = [
    `${user.display_name} ${method === "CANCEL" ? "cancelled" : "booked"} time off:`,
    "",
    `When:     ${range}`,
    `Category: ${category?.name ?? "—"}`,
    `Days:     ${days}`,
    `From:     ${user.display_name} <${user.email ?? "—"}>`,
    "",
    method === "CANCEL"
      ? "Your calendar should remove this event automatically."
      : "Your calendar should add (or update) this event automatically.",
    "",
    revokeFooter(appOrigin, unsubUrl),
  ].join("\n");

  const isCancel = method === "CANCEL";
  const isPending = status === "TENTATIVE";
  const heading = isCancel
    ? `${user.display_name} cancelled time off`
    : isPending
      ? `${user.display_name} requested time off`
      : `${user.display_name} booked time off`;
  const status_badge = isCancel
    ? badge("Cancelled", "warning")
    : isPending
      ? badge("Pending your approval", "warning")
      : badge("Confirmed", "success");

  const html = renderEmail({
    preheader: `${user.display_name} — ${verb}: ${summary}`,
    heading,
    accent: isCancel ? "warning" : isPending ? "warning" : "brand",
    blocks: [
      lead(
        isCancel
          ? `Their calendar event has been removed.`
          : isPending
            ? `They've asked for time off; check your inbox for the approval link.`
            : `Their time off has been added to your shared calendar.`,
      ),
      `<div style="margin:0 0 16px 0;">${status_badge}</div>`,
      metaTable([
        ["When", range],
        ["Category", category?.name ?? "—"],
        ["Days", String(days)],
        ["From", `${user.display_name}${user.email ? ` <${user.email}>` : ""}`],
      ]),
      muted(
        isCancel
          ? "Your calendar should remove this event automatically."
          : "Your calendar should add (or update) this event automatically.",
      ),
    ],
    footer: revokeFooterHtml(appOrigin, unsubUrl, user),
  });

  return await sendCalendarInvite(env, {
    to: boss.boss_email,
    replyTo: user.email ?? undefined,
    subject,
    text,
    html,
    ics,
    method,
    listUnsubscribe: unsubUrl,
  });
}

/**
 * Approval request — sent in approval mode when a vacation is created or
 * re-edited. Body summarises the request and includes the magic link to
 * the approve/reject page.
 */
export async function sendBossApprovalRequest(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  boss: BossRelationship;
  vacation: Vacation;
  category: Category | null;
  approval: VacationApproval;
  decisionToken: string;
  /** Pre-decision balance preview — what the boss will see on the page. */
  balance: { used_days: number; total_days: number; remaining_days: number };
  /** Per-relationship unsubscribe token — embedded in the footer + RFC 8058
   *  List-Unsubscribe header so the manager can opt out in one click. */
  unsubscribeToken: string;
}): Promise<SendResult> {
  const {
    env,
    appOrigin,
    user,
    boss,
    vacation,
    category,
    decisionToken,
    balance,
    unsubscribeToken,
  } = opts;
  const url = `${appOrigin}/boss/approve/${decisionToken}`;
  const unsubUrl = `${appOrigin}/boss/unsubscribe/${unsubscribeToken}`;
  const range = describeVacation(vacation);
  const days = vacationDayCost(vacation);

  const text = [
    `Hi,`,
    "",
    `${user.display_name} (${user.email ?? "no email on file"}) is requesting time off.`,
    "",
    `When:        ${range}`,
    `Category:    ${category?.name ?? "—"}`,
    `Days:        ${days}`,
    vacation.public_desc.trim() ? `Description: ${vacation.public_desc.trim()}` : "",
    "",
    `Their ${category?.name ?? "category"} balance after this request:`,
    `  Used / Total: ${fmtDays(balance.used_days)} / ${fmtDays(balance.total_days)}  (remaining ${fmtDays(balance.remaining_days)})`,
    "",
    "Approve or reject (one click each):",
    url,
    "",
    "Reject requires a short reason; approve just confirms.",
    "",
    revokeFooter(appOrigin, unsubUrl),
  ]
    .filter((l) => l !== "")
    .join("\n");

  // Restore deliberate blank lines (filter dropped them above; rebuild with
  // a small marker that allows empty gaps).
  const subject = `${user.display_name} wants ${range} off`;

  const usedFmt = fmtDays(balance.used_days);
  const totalFmt = fmtDays(balance.total_days);
  const remainingFmt = fmtDays(balance.remaining_days);
  const balanceLabel = `${category?.name ?? "Balance"} after this request`;
  const balanceValue = `${usedFmt} / ${totalFmt} used · ${remainingFmt} remaining`;

  const metaRows: Array<[string, string]> = [
    ["When", range],
    ["Category", category?.name ?? "—"],
    ["Days", String(days)],
  ];
  if (vacation.public_desc.trim()) {
    metaRows.push(["Description", vacation.public_desc.trim()]);
  }
  metaRows.push([balanceLabel, balanceValue]);

  const html = renderEmail({
    preheader: `${user.display_name} is requesting ${range} off — approve or reject.`,
    heading: `${user.display_name} wants time off`,
    accent: "brand",
    blocks: [
      lead(
        `<strong>${escapeHtml(user.display_name)}</strong> (${escapeHtml(user.email ?? "no email on file")}) is requesting time off and is waiting on your call.`,
      ),
      metaTable(metaRows),
      button(url, "Review request"),
      linkFallback(url),
      muted(`Reject asks for a short reason; approve just confirms.`),
    ],
    footer: revokeFooterHtml(appOrigin, unsubUrl, user),
  });

  return await sendPlainEmail(env, {
    to: boss.boss_email,
    subject,
    text,
    html,
    replyTo: user.email ?? undefined,
    listUnsubscribe: unsubUrl,
  });
}

/**
 * Decision receipt — back to the USER (the boss made a call). Plain text;
 * the user already has the iCal invite firing separately for the calendar
 * update. Reject includes the boss's comment so the user knows why.
 */
export async function sendDecisionReceiptToUser(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  boss: BossRelationship;
  vacation: Vacation;
  category: Category | null;
  decision: "approved" | "rejected";
  comment: string | null;
}): Promise<void> {
  const { env, appOrigin, user, boss, vacation, category, decision, comment } = opts;
  if (!user.email) return; // user has no email on file — silently skip
  const range = describeVacation(vacation);
  const verb = decision === "approved" ? "approved" : "rejected";
  const text = [
    `Hi ${user.display_name},`,
    "",
    `${boss.boss_email} ${verb} your vacation request:`,
    "",
    `When:     ${range}`,
    `Category: ${category?.name ?? "—"}`,
    "",
    decision === "approved"
      ? "Your calendar should update automatically — the event is now confirmed."
      : `Reason: ${comment ?? "(no comment provided)"}`,
    "",
    decision === "approved"
      ? "Have a good break."
      : "The booking has been cancelled. Edit and resubmit if you'd like to try different dates.",
    "",
    `— AFK · ${appOrigin}`,
  ].join("\n");

  const isApproved = decision === "approved";
  const blocks: string[] = [
    lead(
      isApproved
        ? `Good news — your time off is confirmed.`
        : `Your request was rejected. The booking has been cancelled.`,
    ),
    `<div style="margin:0 0 16px 0;">${
      isApproved ? badge("Approved", "success") : badge("Rejected", "danger")
    }</div>`,
    metaTable([
      ["Decided by", boss.boss_email],
      ["When", range],
      ["Category", category?.name ?? "—"],
    ]),
  ];

  if (!isApproved) {
    blocks.push(divider());
    if (comment?.trim()) {
      // Escaped plain text only — never markdown. The manager is an
      // unauthenticated party and `[label](url)` would let them ship the
      // user a phishing link under arbitrary anchor text.
      blocks.push(notesBlock(escapeHtmlMultiline(comment), "Reason"));
    } else {
      blocks.push(paragraph(`<em style="color:#6b7280;">No reason provided.</em>`));
    }
  }

  blocks.push(
    muted(
      isApproved
        ? "Your calendar should update automatically — the event is now confirmed. Have a good break."
        : "Edit and resubmit if you'd like to try different dates.",
    ),
  );

  const html = renderEmail({
    preheader: isApproved
      ? `Approved: ${inviteSummary(category, vacation)}`
      : `Rejected: ${inviteSummary(category, vacation)}`,
    heading: isApproved ? "Your vacation was approved" : "Your vacation was rejected",
    accent: isApproved ? "success" : "danger",
    blocks,
    footer: `Sent by AFK · <a href="${escapeHtml(appOrigin)}" style="color:inherit;">${escapeHtml(appOrigin)}</a>`,
  });

  await sendPlainEmail(env, {
    to: user.email,
    subject: `${verb === "approved" ? "Approved" : "Rejected"}: ${inviteSummary(category, vacation)}`,
    text,
    html,
  });
}

/**
 * Tell the USER that their manager just clicked the consent link. Fires
 * once, when `acceptBossConsent` flips a relationship from pending →
 * consented (also re-fires when an already-revoked relationship is
 * re-consented, which is the same "you're set up" semantic from the
 * user's POV).
 *
 * No iCal attachment — this is just a state-change ping. The actual
 * vacation invites get sent separately whenever the user books something.
 */
export async function sendConsentAcceptedToUser(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  boss: BossRelationship;
}): Promise<void> {
  const { env, appOrigin, user, boss } = opts;
  if (!user.email) return; // user has no email on file — silently skip
  const modeLine =
    boss.mode === "notify"
      ? "From now on, every vacation you book gets a calendar invite copied to them automatically."
      : "From now on, every vacation you book waits as 'pending' on your calendar until they approve or reject — they'll get a one-click link for each request.";

  const text = [
    `Hi ${user.display_name},`,
    "",
    `${boss.boss_email} accepted your invitation to be your ${boss.mode === "approval" ? "approver" : "notification recipient"} on AFK.`,
    "",
    modeLine,
    "",
    "You can change the mode or remove them anytime from Settings.",
    "",
    `— AFK · ${appOrigin}`,
  ].join("\n");

  const html = renderEmail({
    preheader: `${boss.boss_email} is now connected to your AFK calendar.`,
    heading: "You're connected",
    accent: "success",
    blocks: [
      lead(
        `<strong>${escapeHtml(boss.boss_email)}</strong> accepted your invitation to be your ${boss.mode === "approval" ? "approver" : "notification recipient"} on AFK.`,
      ),
      `<div style="margin:0 0 16px 0;">${
        boss.mode === "notify" ? badge("Notify mode", "brand") : badge("Approval mode", "brand")
      }</div>`,
      paragraph(escapeHtml(modeLine)),
      muted(`You can change the mode or remove them anytime from Settings.`),
    ],
    footer: `Sent by AFK · <a href="${escapeHtml(appOrigin)}" style="color:inherit;">${escapeHtml(appOrigin)}</a>`,
  });

  await sendPlainEmail(env, {
    to: user.email,
    subject: `${boss.boss_email} is now your ${boss.mode === "approval" ? "approver" : "notification recipient"} on AFK`,
    text,
    html,
  });
}

/**
 * Tell the USER that their manager just clicked the unsubscribe link.
 * Fires once, on the first revoke (the store layer's `changed` flag is the
 * gate). Plain copy + the "you can re-add them or pick someone else"
 * pointer back to Settings — we don't want the user to silently start
 * sending unmonitored vacation emails for weeks.
 */
export async function sendConsentRevokedToUser(opts: {
  env: Env;
  appOrigin: string;
  user: User;
  boss: BossRelationship;
}): Promise<void> {
  const { env, appOrigin, user, boss } = opts;
  if (!user.email) return; // user has no email on file — silently skip
  const settingsUrl = `${appOrigin}/settings`;

  const text = [
    `Hi ${user.display_name},`,
    "",
    `${boss.boss_email} clicked the unsubscribe link and is no longer receiving your AFK emails.`,
    "",
    boss.mode === "approval"
      ? "Heads up: you were in approval mode, so any pending vacation requests now have nobody to decide them. Future bookings won't go to anyone until you set up a new approver."
      : "Future vacations you book won't be copied to them. Their already-delivered calendar invites stay on their calendar; AFK won't send any more.",
    "",
    `Add a different person — or re-invite the same one — at ${settingsUrl}.`,
    "",
    `— AFK · ${appOrigin}`,
  ].join("\n");

  const html = renderEmail({
    preheader: `${boss.boss_email} unsubscribed from your AFK notifications.`,
    heading: "Your manager unsubscribed",
    accent: "warning",
    blocks: [
      lead(
        `<strong>${escapeHtml(boss.boss_email)}</strong> clicked the unsubscribe link in one of your AFK emails. They won't receive further notifications.`,
      ),
      `<div style="margin:0 0 16px 0;">${badge("Unsubscribed", "warning")}</div>`,
      paragraph(
        boss.mode === "approval"
          ? `<strong>You were in approval mode</strong> — pending vacation requests now have nobody to decide them. Future bookings won't go to anyone until you set up a new approver.`
          : `Future vacations you book won't be copied to them. Their already-delivered calendar invites stay on their calendar; AFK won't send any more.`,
      ),
      button(settingsUrl, "Manage in Settings"),
      muted(`You can re-invite the same person or pick someone different.`),
    ],
    footer: `Sent by AFK · <a href="${escapeHtml(appOrigin)}" style="color:inherit;">${escapeHtml(appOrigin)}</a>`,
  });

  await sendPlainEmail(env, {
    to: user.email,
    subject: `${boss.boss_email} unsubscribed from your AFK notifications`,
    text,
    html,
  });
}

/**
 * Plain-text footer with the per-relationship unsubscribe URL. Same URL is
 * also emitted as a `List-Unsubscribe` header (RFC 8058) so Gmail/Outlook
 * surface their native one-click unsubscribe button. The visible link is
 * the fallback for clients that don't render List-Unsubscribe.
 */
function revokeFooter(appOrigin: string, unsubscribeUrl: string): string {
  return [
    `— Sent by AFK · ${appOrigin}`,
    `Don't want these? Stop them with one click: ${unsubscribeUrl}`,
  ].join("\n");
}

/**
 * HTML twin of revokeFooter. Includes both the unsubscribe link and a quiet
 * "reply also works" hint so the manager has more than one way out — handy
 * if the link gets mangled in their corporate email gateway.
 */
function revokeFooterHtml(appOrigin: string, unsubscribeUrl: string, user: User): string {
  const safeOrigin = escapeHtml(appOrigin);
  const safeUnsub = escapeHtml(unsubscribeUrl);
  const replyHint = user.email
    ? `Or reply — it goes to <strong>${escapeHtml(user.email)}</strong>.`
    : `Or reply — it goes back to the sender.`;
  return (
    `Sent by AFK · <a href="${safeOrigin}" style="color:inherit;">${safeOrigin}</a>` +
    `<br>Don't want these? <a href="${safeUnsub}" style="color:inherit;text-decoration:underline;">Unsubscribe in one click</a>. ` +
    replyHint
  );
}

function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from;
}

function fmtDays(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}
