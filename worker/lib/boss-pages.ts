/**
 * Server-rendered HTML pages the boss lands on from email links. No SPA, no
 * accounts — the URL token IS the auth. Both pages POST back to themselves
 * to take the action so a malicious cross-site GET can't burn a token.
 *
 * Style is the same minimalist no-deps approach as `print-template.ts`:
 * inline `<style>`, system fonts, no JavaScript on the consent page; the
 * approval page uses one tiny inline script to require a comment when
 * Reject is selected.
 */

import type { BossRelationship, Category, User, Vacation } from "../../shared/types.js";
import { describeVacation, vacationDayCost } from "../../shared/vacation-math.js";

export function renderConsentPage(opts: {
  user: User;
  boss: BossRelationship;
  appOrigin: string;
  formAction: string; // POSTs back here to accept
  /** When set, render a confirmation card instead of the consent form. */
  confirmation?: "accepted" | "expired" | "unknown";
}): string {
  const { user, boss, appOrigin, formAction, confirmation } = opts;
  const modeBlurb =
    boss.mode === "notify"
      ? "You'll get a calendar invite (.ics file) for each vacation they take. AFK won't ask you to do anything."
      : "You'll be asked to approve or reject each vacation request via a one-click link. Their bookings won't go live until you decide.";

  const card = confirmation
    ? confirmationCard(confirmation, user)
    : `
      <h1>${escapeHtml(user.display_name)} wants to share their vacation calendar with you</h1>
      <p class="lead">${escapeHtml(user.display_name)}${user.email ? ` (${escapeHtml(user.email)})` : ""} is using <strong>AFK — Away From Keyboard</strong>, a personal vacation tracker, and would like to add you as their ${boss.mode === "approval" ? "approver" : "notification recipient"}.</p>

      <div class="callout">
        <div class="callout-label">Mode: ${escapeHtml(boss.mode === "notify" ? "Notify" : "Requires approval")}</div>
        <p>${escapeHtml(modeBlurb)}</p>
      </div>

      <p>This is opt-in. AFK doesn't create an account for you — it'll just send you email at <code>${escapeHtml(boss.boss_email)}</code>.</p>

      <form method="POST" action="${escapeHtml(formAction)}">
        <button type="submit" class="primary">I consent — start sending</button>
      </form>

      <p class="quiet">Don't recognise the sender? Just close this tab. Nothing happens until you click.</p>
    `;

  return shell({
    title: "Consent — AFK",
    body: card,
    appOrigin,
  });
}

export function renderApprovalPage(opts: {
  user: User;
  boss: BossRelationship;
  vacation: Vacation;
  category: Category | null;
  appOrigin: string;
  formAction: string;
  /** Pre-decision balance for the category. */
  balance: { used_days: number; total_days: number; remaining_days: number };
  /** When set, render a confirmation card instead of the form. */
  confirmation?: "approved" | "rejected" | "expired" | "unknown" | "missing-comment";
  /** On error, repopulate the comment textarea. */
  priorComment?: string;
}): string {
  const {
    user,
    boss,
    vacation,
    category,
    appOrigin,
    formAction,
    balance,
    confirmation,
    priorComment,
  } = opts;

  if (
    confirmation === "approved" ||
    confirmation === "rejected" ||
    confirmation === "expired" ||
    confirmation === "unknown"
  ) {
    return shell({
      title: `${confirmation[0]!.toUpperCase()}${confirmation.slice(1)} — AFK`,
      body: confirmationCard(
        confirmation === "approved" || confirmation === "rejected"
          ? confirmation
          : confirmation === "expired"
            ? "expired"
            : "unknown",
        user,
      ),
      appOrigin,
    });
  }

  const range = describeVacation(vacation);
  const days = vacationDayCost(vacation);
  const errorBanner =
    confirmation === "missing-comment"
      ? `<div class="error" role="alert">A short comment is required when rejecting — let ${escapeHtml(user.display_name)} know why.</div>`
      : "";

  const body = `
    <h1>${escapeHtml(user.display_name)} wants ${escapeHtml(range)} off</h1>
    <p class="quiet">Approving as <strong>${escapeHtml(boss.boss_display_name)}</strong> — ${escapeHtml(boss.boss_email)}</p>

    <table class="meta">
      <tr><th scope="row">When</th><td>${escapeHtml(range)}</td></tr>
      <tr><th scope="row">Category</th><td>${category ? `<span class="pill" style="background:${escapeHtml(category.color)}">${escapeHtml(category.name)}</span>` : "—"}</td></tr>
      <tr><th scope="row">Days</th><td>${escapeHtml(String(days))}</td></tr>
      ${vacation.public_desc.trim() ? `<tr><th scope="row">Description</th><td>${escapeHtml(vacation.public_desc.trim())}</td></tr>` : ""}
    </table>

    <h2>Their ${escapeHtml(category?.name ?? "category")} balance after this request</h2>
    <table class="balance">
      <thead><tr><th scope="col">Used</th><th scope="col">Total</th><th scope="col">Remaining</th></tr></thead>
      <tbody><tr>
        <td>${fmtDays(balance.used_days)}</td>
        <td>${fmtDays(balance.total_days)}</td>
        <td>${fmtDays(balance.remaining_days)}</td>
      </tr></tbody>
    </table>

    ${errorBanner}

    <form method="POST" action="${escapeHtml(formAction)}" id="decide-form">
      <label for="comment">Comment (optional for approve, required for reject)</label>
      <textarea id="comment" name="comment" rows="3" maxlength="500" placeholder="e.g. 'Make sure to hand off the project'.">${escapeHtml(priorComment ?? "")}</textarea>

      <div class="actions">
        <button type="submit" name="action" value="approve" class="primary">Approve</button>
        <button type="submit" name="action" value="reject" class="danger">Reject</button>
      </div>
    </form>

    <script src="/boss-approve.js"></script>
  `;

  return shell({
    title: `${user.display_name}'s vacation request — AFK`,
    body,
    appOrigin,
  });
}

function confirmationCard(
  kind: "accepted" | "approved" | "rejected" | "expired" | "unknown",
  user: User,
): string {
  const blurb: Record<
    typeof kind,
    { title: string; body: string; tone: "good" | "neutral" | "bad" }
  > = {
    accepted: {
      title: "You're in.",
      body: `Future vacation updates from ${escapeHtml(user.display_name)} will land in your inbox. To opt out later, just reply to any email and ask them to remove you.`,
      tone: "good",
    },
    approved: {
      title: "Approved.",
      body: `${escapeHtml(user.display_name)} has been notified and the calendar invite is on its way to you both.`,
      tone: "good",
    },
    rejected: {
      title: "Rejected.",
      body: `${escapeHtml(user.display_name)} has been notified along with your comment. Their booking is cancelled.`,
      tone: "neutral",
    },
    expired: {
      title: "This link has expired.",
      body: `${escapeHtml(user.display_name)} can resubmit if it's still relevant.`,
      tone: "bad",
    },
    unknown: {
      title: "This link isn't valid.",
      body: "It may have already been used, expired, or been mistyped.",
      tone: "bad",
    },
  };
  const it = blurb[kind];
  return `
    <div class="result result-${it.tone}">
      <h1>${it.title}</h1>
      <p>${it.body}</p>
    </div>
  `;
}

interface ShellOpts {
  title: string;
  body: string;
  appOrigin: string;
}

/** Cache-Control headers all boss pages should send. PII + per-token; never
 * cache. Use this when constructing the Response in the route handler. */
export const BOSS_PAGE_HEADERS: HeadersInit = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  // Belt-and-suspenders alongside the meta tag.
  "Referrer-Policy": "no-referrer",
};

function shell({ title, body, appOrigin }: ShellOpts): string {
  // Self-contained CSS — no external assets so the page renders fast and
  // works even if the boss is on a corporate VPN that blocks third-party
  // CDNs. Light theme only — emails-and-corporate-portal vibe.
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f9fafb; color: #111827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Liberation Sans", sans-serif; line-height: 1.5; }
    .container { max-width: 640px; margin: 0 auto; padding: 32px 20px 64px; }
    .brand { font-size: 14px; color: #6b7280; letter-spacing: 0.04em; margin-bottom: 16px; }
    .brand strong { color: #111827; font-weight: 700; letter-spacing: -0.01em; }
    .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px 28px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    h1 { font-size: 20px; margin: 0 0 12px 0; letter-spacing: -0.01em; }
    h2 { font-size: 14px; margin: 24px 0 8px 0; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
    .lead { color: #374151; margin: 0 0 20px 0; }
    p { margin: 0 0 12px 0; }
    .quiet { color: #6b7280; font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", monospace; background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
    .callout { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px; margin: 16px 0; }
    .callout-label { font-size: 12px; font-weight: 600; color: #1d4ed8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .callout p { margin: 0; color: #1e3a8a; font-size: 14px; }
    table.meta { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    table.meta th { text-align: left; color: #6b7280; font-weight: 500; padding: 6px 12px 6px 0; vertical-align: top; width: 110px; font-weight: 500; }
    table.meta td { padding: 6px 0; color: #111827; }
    table.balance { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px; }
    table.balance th { text-align: left; padding: 6px 12px 6px 0; color: #6b7280; font-weight: 500; }
    table.balance td { padding: 6px 12px 6px 0; font-variant-numeric: tabular-nums; font-weight: 600; }
    .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; color: white; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
    label { display: block; font-size: 13px; color: #374151; font-weight: 500; margin: 16px 0 6px 0; }
    textarea { width: 100%; min-height: 80px; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; font-family: inherit; font-size: 14px; resize: vertical; }
    textarea:focus { outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }
    .actions { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    button { font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; min-height: 44px; min-width: 120px; }
    /* Use the darker green so white-on-green clears WCAG AA (4.5:1). The
       lighter #16a34a was failing at 2.81:1. */
    button.primary { background: #15803d; color: white; }
    button.primary:hover { background: #166534; }
    button.danger { background: white; color: #b91c1c; border-color: #fecaca; }
    button.danger:hover { background: #fee2e2; }
    button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 10px 14px; border-radius: 6px; margin: 12px 0; font-size: 14px; }
    .result { padding: 24px; border-radius: 12px; margin-top: 4px; }
    .result h1 { margin: 0 0 8px 0; }
    .result p { margin: 0; color: #374151; font-size: 14px; }
    .result-good { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .result-good h1 { color: #15803d; }
    .result-bad { background: #fef2f2; border: 1px solid #fecaca; }
    .result-bad h1 { color: #b91c1c; }
    .result-neutral { background: #f9fafb; border: 1px solid #e5e7eb; }
    .footer { margin-top: 24px; text-align: center; font-size: 12px; color: #9ca3af; }
    .footer a { color: #6b7280; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head><body>
  <div class="container">
    <div class="brand"><strong>AFK</strong> · Away From Keyboard</div>
    <div class="card">${body}</div>
    <div class="footer">${escapeHtml(appOrigin)}</div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtDays(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}
