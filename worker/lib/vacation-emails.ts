/**
 * Glue between the vacation lifecycle and outgoing calendar invites. Each
 * lifecycle event (create/update/cancel/uncancel/delete) calls into here;
 * the helper checks whether the user has a verified email and, if so, asks
 * Mailgun to send the appropriate METHOD:PUBLISH or METHOD:CANCEL email.
 *
 * Sending failures are caught and logged but never propagated — the user's
 * vacation save shouldn't fail because their inbox is on fire.
 *
 * Subject + event title are `{Category} — {public_desc}`. Body is the
 * personal notes (internal_desc) rendered as markdown in the HTML
 * alternative; plain-text alternative carries the raw markdown so it still
 * looks reasonable on bare clients.
 */

import type { Env } from "../types.js";
import type { Category, User, Vacation } from "../../shared/types.js";
import { describeVacation, vacationDayCost } from "../../shared/vacation-math.js";
import {
  badge,
  divider,
  lead,
  metaTable,
  muted,
  notesBlock,
  renderEmail,
} from "./email-template.js";
import { buildInviteIcs, inviteSummary } from "./ical-invite.js";
import { renderMarkdown } from "./markdown.js";
import { sendCalendarInvite } from "./mailgun.js";

export type VacationLifecycle = "created" | "updated" | "cancelled" | "uncancelled" | "deleted";

export async function sendVacationLifecycleEmail(
  env: Env,
  appOrigin: string,
  user: User,
  vacation: Vacation,
  category: Category | null,
  lifecycle: VacationLifecycle,
): Promise<void> {
  if (!user.email || !user.email_verified_at) return;
  const method: "PUBLISH" | "CANCEL" =
    lifecycle === "cancelled" || lifecycle === "deleted" ? "CANCEL" : "PUBLISH";

  const organizerEmail = env.MAILGUN_FROM
    ? extractAddress(env.MAILGUN_FROM)
    : env.MAILGUN_DOMAIN
      ? `afk@${env.MAILGUN_DOMAIN}`
      : "afk@invalid";

  // Approval-mode lifecycle: TENTATIVE while awaiting boss decision so the
  // user's calendar visually flags the booking as not-yet-approved.
  const status: "CONFIRMED" | "CANCELLED" | "TENTATIVE" =
    method === "CANCEL"
      ? "CANCELLED"
      : vacation.approval_state === "pending"
        ? "TENTATIVE"
        : "CONFIRMED";
  const ics = buildInviteIcs({
    user,
    vacation,
    category,
    organizerEmail,
    method,
    sequence: vacation.ical_sequence,
    appOrigin,
    status,
    summaryPrefix: status === "TENTATIVE" ? "Pending" : undefined,
  });

  const subject = subjectFor(method, vacation, category);
  const text = plainBodyFor(method, vacation, category);
  const html = htmlBodyFor(method, vacation, category, status);

  try {
    await sendCalendarInvite(env, {
      to: user.email,
      subject,
      text,
      html,
      ics,
      method,
    });
  } catch (e) {
    console.error("[vacation-emails] send failed:", (e as Error).message);
  }
}

function subjectFor(method: "PUBLISH" | "CANCEL", v: Vacation, cat: Category | null): string {
  const summary = inviteSummary(cat, v);
  if (method === "CANCEL") return `Cancelled: ${summary}`;
  if (v.approval_state === "pending") return `Pending: ${summary}`;
  return summary;
}

function plainBodyFor(method: "PUBLISH" | "CANCEL", v: Vacation, cat: Category | null): string {
  const range = describeVacation(v);
  const days = vacationDayCost(v);
  const lines: string[] = [];
  lines.push(method === "CANCEL" ? "Cancelled." : "Out of office.");
  lines.push("");
  lines.push(`When:     ${range}`);
  lines.push(`Category: ${cat?.name ?? "—"}`);
  lines.push(`Days:     ${days}`);
  if (v.internal_desc?.trim()) {
    lines.push("");
    lines.push(v.internal_desc);
  }
  lines.push("");
  lines.push(
    method === "CANCEL"
      ? "Your calendar should remove this event automatically."
      : "Your calendar should add (or update) this event automatically.",
  );
  return lines.join("\n");
}

function htmlBodyFor(
  method: "PUBLISH" | "CANCEL",
  v: Vacation,
  cat: Category | null,
  status: "CONFIRMED" | "CANCELLED" | "TENTATIVE",
): string {
  const range = describeVacation(v);
  const days = vacationDayCost(v);
  const isCancel = method === "CANCEL";
  const isPending = status === "TENTATIVE";

  const heading = isCancel
    ? "Vacation cancelled"
    : isPending
      ? "Pending approval"
      : "Out of office";
  const accent = isCancel ? "warning" : isPending ? "warning" : "brand";
  const status_badge = isCancel
    ? badge("Cancelled", "warning")
    : isPending
      ? badge("Pending boss approval", "warning")
      : badge("Confirmed", "success");

  const blocks: string[] = [
    lead(
      isCancel
        ? `This event has been removed from your calendar.`
        : isPending
          ? `Awaiting your boss's decision before this is confirmed on your calendar.`
          : `Your time off is confirmed and on your calendar.`,
    ),
    `<div style="margin:0 0 16px 0;">${status_badge}</div>`,
    metaTable([
      ["When", range],
      ["Category", cat?.name ?? "—"],
      ["Days", String(days)],
    ]),
  ];

  if (v.internal_desc?.trim()) {
    blocks.push(divider());
    blocks.push(notesBlock(renderMarkdown(v.internal_desc), "Notes"));
  }

  blocks.push(
    muted(
      isCancel
        ? "Your calendar should remove this event automatically."
        : "Your calendar should add (or update) this event automatically.",
    ),
  );

  return renderEmail({
    preheader: `${heading} — ${range}`,
    heading,
    accent,
    blocks,
    footer: "Sent by AFK · your personal vacation tracker.",
  });
}

function extractAddress(from: string): string {
  // "AFK <afk@mg.example.com>" → "afk@mg.example.com"
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from;
}
