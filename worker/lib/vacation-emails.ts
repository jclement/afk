/**
 * Glue between the vacation lifecycle and outgoing calendar invites. Each
 * lifecycle event (create/update/cancel/uncancel/delete) calls into here;
 * the helper checks whether the user has a verified email and, if so, asks
 * Mailgun to send the appropriate METHOD:REQUEST or METHOD:CANCEL email.
 *
 * Sending failures are caught and logged but never propagated — the user's
 * vacation save shouldn't fail because their inbox is on fire.
 */

import type { Env } from "../types.js";
import type { Category, User, Vacation } from "../../shared/types.js";
import { describeVacation, vacationDayCost } from "../../shared/vacation-math.js";
import { buildInviteIcs } from "./ical-invite.js";
import { sendCalendarInvite } from "./mailgun.js";

export type VacationLifecycle =
  | "created"
  | "updated"
  | "cancelled"
  | "uncancelled"
  | "deleted";

export async function sendVacationLifecycleEmail(
  env: Env,
  appOrigin: string,
  user: User,
  vacation: Vacation,
  category: Category | null,
  lifecycle: VacationLifecycle,
): Promise<void> {
  if (!user.email || !user.email_verified_at) return;
  const method: "REQUEST" | "CANCEL" =
    lifecycle === "cancelled" || lifecycle === "deleted" ? "CANCEL" : "REQUEST";

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
  const text = bodyFor(method, vacation, category);

  try {
    await sendCalendarInvite(env, {
      to: user.email,
      subject,
      text,
      ics,
      method,
    });
  } catch (e) {
    console.error("[vacation-emails] send failed:", (e as Error).message);
  }
}

function subjectFor(
  method: "REQUEST" | "CANCEL",
  v: Vacation,
  cat: Category | null,
): string {
  const range = describeVacation(v);
  const tag = cat ? `${cat.name}` : "OOO";
  return method === "CANCEL"
    ? `Cancelled: ${tag} (${range})`
    : `OOO: ${tag} (${range})`;
}

function bodyFor(
  method: "REQUEST" | "CANCEL",
  v: Vacation,
  cat: Category | null,
): string {
  const range = describeVacation(v);
  const days = vacationDayCost(v);
  const lines: string[] = [];
  if (method === "CANCEL") {
    lines.push(`Your AFK entry has been cancelled.`);
  } else {
    lines.push(`Out of office:`);
  }
  lines.push("");
  lines.push(`When:     ${range}`);
  lines.push(`Category: ${cat?.name ?? "—"}`);
  lines.push(`Days:     ${days}`);
  if (v.public_desc) {
    lines.push("");
    lines.push(v.public_desc);
  }
  if (v.internal_desc) {
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

function extractAddress(from: string): string {
  // "AFK <afk@mg.example.com>" → "afk@mg.example.com"
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from;
}
