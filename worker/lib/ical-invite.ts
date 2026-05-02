/**
 * Build a single-event iCalendar VCALENDAR string with METHOD:REQUEST or
 * METHOD:CANCEL, suitable for emailing as a meeting invite. Uses a stable
 * UID per vacation (`<vacation_id>@afk`) so receiving calendars treat
 * subsequent updates and cancellations as the same event.
 *
 * Vacations are represented as all-day events. iCalendar all-day events use
 * VALUE=DATE on DTSTART/DTEND, with DTEND being **exclusive** (the day
 * after the last vacation day). Partial-day entries are represented as a
 * single all-day event annotated in DESCRIPTION.
 */

import type { Category, User, Vacation } from "../../shared/types.js";
import { describeVacation, parseISODate, vacationDayCost } from "../../shared/vacation-math.js";

export interface InviteOpts {
  user: User;
  vacation: Vacation;
  category: Category | null;
  organizerEmail: string;
  method: "REQUEST" | "CANCEL";
  /** Bumped on every change. Receiving calendars use this for ordering. */
  sequence: number;
  /** Human-readable origin domain for PRODID + DESCRIPTION footer. */
  appOrigin: string;
}

export function buildInviteIcs(opts: InviteOpts): string {
  const { user, vacation, category, organizerEmail, method, sequence } = opts;
  const uid = `${vacation.id}@afk`;
  const summary = category ? `OOO — ${category.name}` : "OOO";
  const dtstamp = utcStamp(new Date());
  const dtstart = vacation.start_date.replaceAll("-", "");
  const dtend = formatExclusiveEnd(vacation.end_date);
  const descLines = [
    describeVacation(vacation),
    `${vacationDayCost(vacation)} day(s) booked.`,
  ];
  if (vacation.public_desc) descLines.push("", vacation.public_desc);
  if (vacation.internal_desc) descLines.push("", vacation.internal_desc);
  descLines.push("", `Booked via AFK · ${opts.appOrigin}`);
  const description = descLines.join("\\n");

  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push(`PRODID:-//AFK//${opts.appOrigin}//EN`);
  lines.push(`METHOD:${method}`);
  lines.push("CALSCALE:GREGORIAN");
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${escapeText(uid)}`);
  lines.push(`DTSTAMP:${dtstamp}`);
  lines.push(`DTSTART;VALUE=DATE:${dtstart}`);
  lines.push(`DTEND;VALUE=DATE:${dtend}`);
  lines.push(`SUMMARY:${escapeText(summary)}`);
  lines.push(`DESCRIPTION:${escapeText(description)}`);
  lines.push("TRANSP:OPAQUE");
  lines.push("X-MICROSOFT-CDO-BUSYSTATUS:OOF");
  lines.push("X-MICROSOFT-CDO-INTENDEDSTATUS:OOF");
  lines.push(`SEQUENCE:${sequence}`);
  lines.push(`STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`);
  lines.push(`ORGANIZER;CN=AFK:mailto:${organizerEmail}`);
  // Mark the user as attendee so the event lands in their calendar even if
  // their client treats organizer as "someone else's event".
  const attendeeName = escapeText(user.display_name);
  // user.email is what we send to; the route enforces that it's the verified
  // one before calling here.
  if (user.email) {
    lines.push(
      `ATTENDEE;CN=${attendeeName};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${user.email}`,
    );
  }
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");
  // RFC 5545 mandates CRLF line breaks and ≤75-octet lines; we keep lines
  // short enough by construction (the long DESCRIPTION is a single line; most
  // clients accept un-folded long lines, but folding is cheap insurance).
  return foldLines(lines).join("\r\n");
}

function utcStamp(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

function formatExclusiveEnd(endDate: string): string {
  const d = parseISODate(endDate);
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

function escapeText(s: string): string {
  // Per RFC 5545 §3.3.11.
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

function foldLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= 75) {
      out.push(line);
      continue;
    }
    out.push(line.slice(0, 75));
    let i = 75;
    while (i < line.length) {
      out.push(" " + line.slice(i, i + 74));
      i += 74;
    }
  }
  return out;
}
