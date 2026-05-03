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
  /**
   * Per-event lifecycle status. Defaults to CONFIRMED on PUBLISH and
   * CANCELLED on CANCEL. Pass `"TENTATIVE"` for vacations awaiting boss
   * approval — calendar clients render those visually distinct (Apple
   * shows them with a hatched fill, Google/Outlook with grey).
   */
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
  /**
   * Optional `[Pending]` / `[Approved]` / `[Rejected]` prefix on the
   * SUMMARY line so even calendars that ignore STATUS make the state
   * visible. Pass `"PENDING"` for tentative bookings; the helper appends
   * the right prefix and leaves CONFIRMED/CANCELLED untouched.
   */
  summaryPrefix?: string;
  /**
   * When false, the user's `internal_desc` is omitted from DESCRIPTION /
   * X-ALT-DESC. The boss should never see internal notes — by spec the
   * "internal" name implies user-only — so any boss-bound invite passes
   * `false`. Defaults true (user's own self-invite includes everything).
   */
  includeInternalDesc?: boolean;
  /**
   * Force `TRANSP:TRANSPARENT` and FREE busy-status regardless of `status`.
   * Used for boss-bound invites: it's the *user's* time off, not the
   * manager's, so the event should appear on the manager's calendar but
   * not block their availability. Defaults false (status-derived).
   */
  showAsFree?: boolean;
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
  const status: "CONFIRMED" | "CANCELLED" | "TENTATIVE" =
    opts.status ?? (method === "CANCEL" ? "CANCELLED" : "CONFIRMED");
  const uid = `${vacation.id}@afk`;
  const baseSummary = inviteSummary(category, vacation);
  const summary = opts.summaryPrefix ? `[${opts.summaryPrefix}] ${baseSummary}` : baseSummary;
  const dtstamp = utcStamp(new Date());
  const dtstart = vacation.start_date.replaceAll("-", "");
  const dtend = formatExclusiveEnd(vacation.end_date);

  const headerLines = [describeVacation(vacation), `${vacationDayCost(vacation)} day(s) booked.`];
  // Redact internal_desc when this invite is bound for the boss (or any
  // other third party). Default is "include" because the most common caller
  // is the user's own self-invite. Boss code paths must pass false.
  const notes = opts.includeInternalDesc === false ? "" : (vacation.internal_desc?.trim() ?? "");
  const footer = `Booked via AFK · ${opts.appOrigin}`;

  // Plain-text DESCRIPTION (what calendars without HTML support display).
  const plainParts = [...headerLines];
  if (notes) plainParts.push("", notes);
  plainParts.push("", footer);
  const description = plainParts.join("\n");

  // HTML alternative for clients that honour X-ALT-DESC (Outlook does).
  const headerHtml = headerLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  const notesHtml = notes ? renderMarkdown(notes) : "";
  const footerHtml = `<div style="color:#9ca3af;margin-top:12px">${escapeHtml(footer)}</div>`;
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">` +
    headerHtml +
    (notesHtml
      ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0"/>${notesHtml}`
      : "") +
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
  lines.push(`X-ALT-DESC;FMTTYPE=text/html:${escapeText(html)}`);
  // TRANSP=TRANSPARENT for tentative/cancelled so they don't block the slot
  // on the receiver's calendar; OPAQUE for confirmed bookings = "I'm out."
  // showAsFree wins outright — used for boss-bound invites where the event
  // should be visible but not block the manager's slot.
  const transp = opts.showAsFree || status !== "CONFIRMED" ? "TRANSPARENT" : "OPAQUE";
  const busy = opts.showAsFree
    ? "FREE"
    : status === "CONFIRMED"
      ? "OOF"
      : status === "TENTATIVE"
        ? "TENTATIVE"
        : "FREE";
  lines.push(`TRANSP:${transp}`);
  lines.push(`X-MICROSOFT-CDO-BUSYSTATUS:${busy}`);
  lines.push(`X-MICROSOFT-CDO-INTENDEDSTATUS:${busy}`);
  lines.push(`SEQUENCE:${sequence}`);
  lines.push(`STATUS:${status}`);
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
  // Per RFC 5545 §3.3.11. Order matters: backslash first so we don't
  // double-escape what we just inserted. CR is normalised to LF first so a
  // bare CR can't survive into the output and prematurely terminate a line.
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

function foldLines(lines: string[]): string[] {
  // RFC 5545 §3.1: lines must be ≤75 octets (NOT chars) of UTF-8. Splitting
  // by character index can land mid-codepoint and corrupt multibyte sequences
  // (emoji, accented letters). Encode → fold byte-wise on codepoint
  // boundaries → decode.
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8");
  const out: string[] = [];
  for (const line of lines) {
    const bytes = enc.encode(line);
    if (bytes.length <= 75) {
      out.push(line);
      continue;
    }
    let cursor = 0;
    let first = true;
    while (cursor < bytes.length) {
      const limit = first ? 75 : 74;
      let end = Math.min(cursor + limit, bytes.length);
      // Walk back to a codepoint boundary: a UTF-8 continuation byte is
      // 10xxxxxx (0x80–0xBF). Don't split a multi-byte sequence.
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
      const chunk = dec.decode(bytes.subarray(cursor, end));
      out.push(first ? chunk : " " + chunk);
      cursor = end;
      first = false;
    }
  }
  return out;
}
