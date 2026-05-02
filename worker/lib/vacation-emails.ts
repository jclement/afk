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

  const ics = buildInviteIcs({
    user,
    vacation,
    category,
    organizerEmail,
    method,
    sequence: vacation.ical_sequence,
    appOrigin,
  });

  const subject = subjectFor(method, vacation, category);
  const text = plainBodyFor(method, vacation, category);
  const html = htmlBodyFor(method, vacation, category);

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
  return method === "CANCEL" ? `Cancelled: ${summary}` : summary;
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

function htmlBodyFor(method: "PUBLISH" | "CANCEL", v: Vacation, cat: Category | null): string {
  const range = describeVacation(v);
  const days = vacationDayCost(v);
  const lead =
    method === "CANCEL"
      ? `<p style="color:#b45309;font-weight:600;margin:0 0 12px 0">Cancelled.</p>`
      : `<p style="margin:0 0 12px 0">Out of office.</p>`;
  const tableRow = (k: string, v: string) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>` +
    `<td style="padding:2px 0;color:#111827">${escapeHtml(v)}</td></tr>`;
  const meta =
    `<table style="border-collapse:collapse;font-size:14px;margin:0 0 16px 0">` +
    tableRow("When", range) +
    tableRow("Category", cat?.name ?? "—") +
    tableRow("Days", String(days)) +
    `</table>`;
  const notesHtml = v.internal_desc?.trim()
    ? `<div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:8px;font-size:14px;line-height:1.55;color:#1f2937">${renderMarkdown(v.internal_desc)}</div>`
    : "";
  const tail = `<p style="color:#9ca3af;font-size:12px;margin-top:16px">${
    method === "CANCEL"
      ? "Your calendar should remove this event automatically."
      : "Your calendar should add (or update) this event automatically."
  }</p>`;
  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;font-size:14px;line-height:1.45">` +
    lead +
    meta +
    notesHtml +
    tail +
    `</div>`
  );
}

function extractAddress(from: string): string {
  // "AFK <afk@mg.example.com>" → "afk@mg.example.com"
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
