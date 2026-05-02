/**
 * Build a single-event iCalendar VCALENDAR string with METHOD:PUBLISH or
 * METHOD:CANCEL, suitable for emailing as a calendar event. Uses a stable
 * UID per vacation (`<vacation_id>@afk`) so receiving calendars treat
 * subsequent updates and cancellations as the same event.
 *
 * We deliberately use PUBLISH (not REQUEST) so the receiving calendar
 * doesn't send an RSVP reply back to the organizer — afk@mg.onewheelgeek.net
 * isn't a real mailbox and rejects inbound mail. PUBLISH says "add this to
 * your calendar," not "RSVP to me."
 *
 * Vacations are represented as all-day events. iCalendar all-day events use
 * VALUE=DATE on DTSTART/DTEND, with DTEND being **exclusive** (the day
 * after the last vacation day). Partial-day entries are represented as a
 * single all-day event annotated in DESCRIPTION.
 */

import type { Category, User, Vacation } from "../../shared/types.js";
import { describeVacation, parseISODate, vacationDayCost } from "../../shared/vacation-math.js";
import { renderMarkdown } from "./markdown.js";

export interface InviteOpts {
  user: User;
  vacation: Vacation;
  category: Category | null;
  organizerEmail: string;
  method: "PUBLISH" | "CANCEL";
  /** Bumped on every change. Receiving calendars use this for ordering. */
  sequence: number;
  /** Human-readable origin domain for PRODID + DESCRIPTION footer. */
  appOrigin: string;
}

/**
 * Build the event SUMMARY shown as the calendar entry's title and the email
 * subject line. Format: `{Category} — {public_desc}`. Falls back to just
 * the category, or "OOO" if there's no category.
 */
export function inviteSummary(
  category: Category | null,
  vacation: Pick<Vacation, "public_desc">,
): string {
  const cat = category?.name?.trim();
  const pub = vacation.public_desc?.trim();
  if (cat && pub) return `${cat} — ${pub}`;
  if (cat) return cat;
  if (pub) return pub;
  return "OOO";
}

export function buildInviteIcs(opts: InviteOpts): string {
  const { vacation, category, organizerEmail, method, sequence } = opts;
  const uid = `${vacation.id}@afk`;
  const summary = inviteSummary(category, vacation);
  const dtstamp = utcStamp(new Date());
  const dtstart = vacation.start_date.replaceAll("-", "");
  const dtend = formatExclusiveEnd(vacation.end_date);

  const headerLines = [
    describeVacation(vacation),
    `${vacationDayCost(vacation)} day(s) booked.`,
  ];
  const notes = vacation.internal_desc?.trim() ?? "";
  const footer = `Booked via AFK · ${opts.appOrigin}`;

  // Plain-text DESCRIPTION (what calendars without HTML support display).
  const plainParts = [...headerLines];
  if (notes) plainParts.push("", notes);
  plainParts.push("", footer);
  const description = plainParts.join("\n");

  // HTML alternative for clients that honour X-ALT-DESC (Outlook does).
  const headerHtml = headerLines
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");
  const notesHtml = notes ? renderMarkdown(notes) : "";
  const footerHtml = `<div style="color:#9ca3af;margin-top:12px">${escapeHtml(footer)}</div>`;
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">` +
    headerHtml +
    (notesHtml ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0"/>${notesHtml}` : "") +
    footerHtml +
    `</div>`;

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
  // X-ALT-DESC is Outlook's hook for HTML-rendered descriptions. Other
  // clients ignore it harmlessly.
  lines.push(
    `X-ALT-DESC;FMTTYPE=text/html:${escapeText(html)}`,
  );
  lines.push("TRANSP:OPAQUE");
  lines.push("X-MICROSOFT-CDO-BUSYSTATUS:OOF");
  lines.push("X-MICROSOFT-CDO-INTENDEDSTATUS:OOF");
  lines.push(`SEQUENCE:${sequence}`);
  lines.push(`STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`);
  // ORGANIZER on a PUBLISH event is informational — receiving calendars use
  // it as the "from" name on the event card but don't send replies. We keep
  // SENT-BY on the address so any calendar that *does* try to reach out
  // doesn't loop back into the apex domain.
  lines.push(`ORGANIZER;CN=AFK:mailto:${organizerEmail}`);
  // Intentionally no ATTENDEE — that's what makes some clients send a REPLY
  // back to the organizer on accept/decline. PUBLISH semantically doesn't
  // need attendees.
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");
  // RFC 5545 mandates CRLF line breaks and ≤75-octet lines; we keep lines
  // short enough by construction (the long DESCRIPTION is a single line; most
  // clients accept un-folded long lines, but folding is cheap insurance).
  return foldLines(lines).join("\r\n");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
