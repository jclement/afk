/**
 * Mailgun HTTP client — small, single-purpose. We post raw RFC822 MIME
 * messages to /messages.mime so we can hand-craft a multipart/alternative
 * body containing a `text/calendar; method=PUBLISH|CANCEL` part. That's what
 * Outlook / Apple Mail / Gmail use to render the "Accept" UI for invites;
 * the regular /messages endpoint can't express the right Content-Type on the
 * calendar part.
 *
 * If `MAILGUN_API_KEY` is empty (local dev, tests, freshly-deployed env
 * before the secret is set) every send becomes a console.warn and returns
 * `{ skipped: true }` so the rest of the request keeps working.
 */

import type { Env } from "../types.js";

export interface SendResult {
  skipped?: boolean;
  id?: string;
}

export async function sendCalendarInvite(
  env: Env,
  opts: {
    to: string;
    subject: string;
    text: string;
    /** Optional HTML alternative — when set, recipient clients render this
     *  instead of the plain text body. */
    html?: string;
    ics: string;
    method: "PUBLISH" | "CANCEL";
    /** Optional Reply-To header. The boss flow sets this to the user's
     *  email so a reply lands on the human, not the no-reply box. */
    replyTo?: string;
    /** Per-recipient one-click unsubscribe URL. Adds `List-Unsubscribe:
     *  <url>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` so
     *  Gmail/Outlook show their native unsubscribe UI (RFC 8058). */
    listUnsubscribe?: string;
  },
): Promise<SendResult> {
  if (!env.MAILGUN_API_KEY) {
    console.warn(
      `[mailgun] skipping send (no MAILGUN_API_KEY) → ${opts.method} to ${opts.to}: ${opts.subject}`,
    );
    return { skipped: true };
  }
  const domain = env.MAILGUN_DOMAIN;
  if (!domain) throw new Error("MAILGUN_DOMAIN not configured.");
  const from = env.MAILGUN_FROM ?? `AFK <afk@${domain}>`;
  const region = (env.MAILGUN_REGION ?? "us").toLowerCase();
  const apiBase = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";

  const mime = buildMime({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    ics: opts.ics,
    method: opts.method,
    replyTo: opts.replyTo,
    listUnsubscribe: opts.listUnsubscribe,
  });

  const form = new FormData();
  form.append("to", opts.to);
  form.append("message", new Blob([mime], { type: "message/rfc822" }), "message.eml");

  const auth = btoa(`api:${env.MAILGUN_API_KEY}`);
  const res = await fetch(`${apiBase}/v3/${domain}/messages.mime`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body: form,
    // Cap the upstream call at 10s. Without this, a stalled Mailgun fetch
    // burns the Worker's wall-time budget waiting for a response that's
    // never coming, and any request piggy-backed via waitUntil dies with it.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mailgun send failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as { id?: string };
  return { id: data.id };
}

/**
 * Send a transactional email — no calendar attachment. Used for the email
 * verification flow and the boss consent / approval / decision messages.
 *
 * Pass `html` to attach an HTML alternative; recipient clients pick HTML
 * when they support it and fall back to `text` otherwise.
 */
export async function sendPlainEmail(
  env: Env,
  opts: {
    to: string;
    subject: string;
    text: string;
    /** Optional HTML alternative — when set, recipients render this body
     *  instead of the plain text. Plain text is still required for clients
     *  that don't render HTML and for spam-filter scoring. */
    html?: string;
    /** Optional Reply-To header. Used by the boss flow so a boss replying
     *  to a notification reaches the user, not the no-reply Mailgun box. */
    replyTo?: string;
    /** Per-recipient one-click unsubscribe URL. Adds RFC 8058 List-Unsubscribe
     *  + List-Unsubscribe-Post headers so Gmail/Outlook surface their native
     *  unsubscribe UI on every boss-bound message. */
    listUnsubscribe?: string;
  },
): Promise<SendResult> {
  if (!env.MAILGUN_API_KEY) {
    console.warn(`[mailgun] skipping send (no MAILGUN_API_KEY) → ${opts.to}: ${opts.subject}`);
    return { skipped: true };
  }
  const domain = env.MAILGUN_DOMAIN;
  if (!domain) throw new Error("MAILGUN_DOMAIN not configured.");
  const from = env.MAILGUN_FROM ?? `AFK <afk@${domain}>`;
  const region = (env.MAILGUN_REGION ?? "us").toLowerCase();
  const apiBase = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";

  const form = new FormData();
  form.append("from", headerValue(from));
  form.append("to", headerValue(opts.to));
  // Sanitize subject — display_name etc. can flow in, and Mailgun may pass
  // CR/LF straight through to the outbound RFC822 message. Mailgun's
  // /messages endpoint handles Unicode subjects on its own, but pre-stripping
  // control chars closes header-injection regardless.
  form.append("subject", headerValue(opts.subject));
  form.append("text", opts.text);
  if (opts.html) {
    form.append("html", opts.html);
  }
  if (opts.replyTo) {
    form.append("h:Reply-To", headerValue(opts.replyTo));
  }
  if (opts.listUnsubscribe) {
    // RFC 2369 + 8058. URL must be wrapped in `<...>`. The Post header is
    // the magic that makes Gmail/Outlook offer the one-click button rather
    // than just hiding the message.
    form.append("h:List-Unsubscribe", `<${headerValue(opts.listUnsubscribe)}>`);
    form.append("h:List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
  }

  const auth = btoa(`api:${env.MAILGUN_API_KEY}`);
  const res = await fetch(`${apiBase}/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mailgun send failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as { id?: string };
  return { id: data.id };
}

function buildMime(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  ics: string;
  method: "PUBLISH" | "CANCEL";
  replyTo?: string;
  listUnsubscribe?: string;
}): string {
  // RFC822 wants CRLF, base64 chunked at 76 chars. We hand-roll it because
  // the Worker runtime has no MIME library and the format is short.
  const boundaryAlt = `alt_${randomBoundary()}`;
  const boundaryMix = `mix_${randomBoundary()}`;
  const icsBase64 = chunkBase64(toBase64(opts.ics));
  const date = new Date().toUTCString();
  const messageId = `<${cryptoUUID()}@afk>`;

  // Strip CR/LF from every header value before interpolation. Without this,
  // a Subject built from user-controlled vacation public_desc could inject
  // arbitrary RFC822 headers (Bcc:, From:, X-Spam-Bypass:, etc.).
  const lines: string[] = [];
  lines.push(`From: ${encodeHeader(headerValue(opts.from))}`);
  lines.push(`To: ${encodeHeader(headerValue(opts.to))}`);
  if (opts.replyTo) lines.push(`Reply-To: ${encodeHeader(headerValue(opts.replyTo))}`);
  if (opts.listUnsubscribe) {
    // Same RFC 2369 + 8058 dance as sendPlainEmail above.
    lines.push(`List-Unsubscribe: <${headerValue(opts.listUnsubscribe)}>`);
    lines.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  }
  lines.push(`Subject: ${encodeHeader(headerValue(opts.subject))}`);
  lines.push(`Date: ${headerValue(date)}`);
  lines.push(`Message-ID: ${headerValue(messageId)}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: multipart/mixed; boundary="${boundaryMix}"`);
  lines.push("");

  // outer multipart/mixed: alternative body + .ics attachment for download
  lines.push(`--${boundaryMix}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`);
  lines.push("");

  // alt: plain text — base64 instead of trying to QP-encode UTF-8 (the
  // previous QP encoder didn't escape 8-bit bytes, which strict MTAs flag
  // as malformed). Base64 is universally accepted and avoids the issue.
  lines.push(`--${boundaryAlt}`);
  lines.push(`Content-Type: text/plain; charset=UTF-8`);
  lines.push(`Content-Transfer-Encoding: base64`);
  lines.push("");
  lines.push(chunkBase64(toBase64(opts.text)));
  lines.push("");

  // alt: text/html when supplied — most clients prefer HTML over plain.
  if (opts.html) {
    lines.push(`--${boundaryAlt}`);
    lines.push(`Content-Type: text/html; charset=UTF-8`);
    lines.push(`Content-Transfer-Encoding: base64`);
    lines.push("");
    lines.push(chunkBase64(toBase64(opts.html)));
    lines.push("");
  }

  // alt: text/calendar with method — what makes Outlook show "Accept"
  lines.push(`--${boundaryAlt}`);
  lines.push(`Content-Type: text/calendar; charset=UTF-8; method=${opts.method}`);
  lines.push(`Content-Transfer-Encoding: base64`);
  lines.push("");
  lines.push(icsBase64);
  lines.push("");
  lines.push(`--${boundaryAlt}--`);
  lines.push("");

  // mixed: attachment copy of the .ics so users on minimal clients can
  // double-click to import. Use the registered IANA type `text/calendar` —
  // `application/ics` lands as a generic file in Outlook desktop and won't
  // trigger the calendar-import handler.
  lines.push(`--${boundaryMix}`);
  lines.push(`Content-Type: text/calendar; charset=UTF-8; name="invite.ics"`);
  lines.push(`Content-Disposition: attachment; filename="invite.ics"`);
  lines.push(`Content-Transfer-Encoding: base64`);
  lines.push("");
  lines.push(icsBase64);
  lines.push("");
  lines.push(`--${boundaryMix}--`);
  lines.push("");

  return lines.join("\r\n");
}

/**
 * Sanitise a value bound for an RFC822 header. CR/LF anywhere in a header
 * value is a header-injection vector; we replace control chars with spaces
 * and cap length to avoid pathological inputs.
 */
function headerValue(s: string): string {
  // Strip CR/LF/TAB/etc. control chars and DEL; cap length.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]+/g, " ").slice(0, 1000);
}

/**
 * RFC 2047 "encoded-word" wrapper for headers. Headers must be ASCII, so a
 * `display_name` like "Jérôme" or "田中" needs to be base64-wrapped. ASCII
 * input is returned unchanged. Outlook desktop is the strictest about this
 * and silently mangles raw-UTF-8 subjects.
 */
function encodeHeader(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  // toBase64 already handles UTF-8 → base64 with the latin-1 bridge.
  return `=?UTF-8?B?${toBase64(s)}?=`;
}

function randomBoundary(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cryptoUUID(): string {
  return crypto.randomUUID();
}

function toBase64(s: string): string {
  // btoa needs latin-1; encode to UTF-8 bytes first.
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function chunkBase64(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 76) out.push(s.slice(i, i + 76));
  return out.join("\r\n");
}
