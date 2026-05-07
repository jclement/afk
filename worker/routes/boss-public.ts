/**
 * Public, token-authed routes for the boss/approver flow. Mounted outside
 * the /api/v1 prefix because these are user-facing HTML pages, not JSON
 * APIs — the boss has no AFK account, just an email and a magic link.
 *
 *   GET  /boss/consent/:token     — render the consent landing page
 *   POST /boss/consent/:token     — accept the consent
 *   GET  /boss/approve/:token     — render the approval form
 *   POST /boss/approve/:token     — approve or reject
 *
 * Tokens are 64-char hex (matches `newBossToken`). Format-gated before any
 * DB lookup so bogus probes get a constant-time 404.
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import {
  acceptBossConsent,
  decideApproval,
  findApprovalByToken,
  findBossByConsentToken,
  findBossByUnsubscribeToken,
  getBossUnsubscribeToken,
  revokeBoss,
  setVacationApprovalState,
} from "../lib/boss-store.js";
import {
  getCategory,
  getVacation,
  listAllowances,
  listVacationsInYear,
  uncancelVacation,
  cancelVacation,
} from "../lib/store.js";
import { getUser } from "../lib/users.js";
import {
  BOSS_PAGE_HEADERS,
  renderApprovalPage,
  renderConsentPage,
  renderUnsubscribePage,
} from "../lib/boss-pages.js";
import {
  sendBossNotifyInvite,
  sendConsentAcceptedToUser,
  sendConsentRevokedToUser,
  sendDecisionReceiptToUser,
} from "../lib/boss-emails.js";
import { sendVacationLifecycleEmail } from "../lib/vacation-emails.js";
import {
  categoryUsage,
  vacationDayCostInYear,
  vacationsInYear,
} from "../../shared/vacation-math.js";

const r = new Hono<HonoVars>();

const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Wrap a rendered HTML body in a Response with the boss-page headers
 * (no-store + Referrer-Policy: no-referrer). All boss-public handlers
 * use this so we can't accidentally drop the cache headers. */
function bossHtml(html: string, status: number = 200): Response {
  return new Response(html, { headers: BOSS_PAGE_HEADERS, status });
}

/**
 * CSRF guard for boss POST endpoints. The token in the URL is the auth, but
 * the URL leaks in many ways (link-preview bots, corporate URL-rewriters,
 * server logs at the boss's mail gateway, accidental forwards). Without
 * Origin-pinning, a manager who clicks an attacker's page could POST a
 * cross-site form whose action is `/boss/approve/<leaked-token>`.
 *
 * Behaviour: when the Origin header is present, it must match the request
 * origin. When absent, allow — Outlook desktop / corporate gateways and
 * RFC 8058 one-click unsubscribe POSTs sometimes send no Origin.
 */
function checkOrigin(c: import("hono").Context<HonoVars>): boolean {
  const sent = c.req.header("origin");
  if (!sent) return true;
  return sent === new URL(c.req.url).origin;
}

// ---------------------------------------------------------------------------
// Consent flow
// ---------------------------------------------------------------------------

r.get("/consent/:token", async (c) => {
  const token = c.req.param("token");
  const origin = new URL(c.req.url).origin;
  if (!TOKEN_RE.test(token)) return notFoundConsent(c, origin);
  const boss = await findBossByConsentToken(c.env.DB, token);
  if (!boss) return notFoundConsent(c, origin);
  const user = await getUser(c.env.DB, boss.user_id);
  if (!user) return notFoundConsent(c, origin);
  return bossHtml(
    renderConsentPage({
      user,
      boss,
      appOrigin: origin,
      formAction: `/boss/consent/${token}`,
    }),
  );
});

r.post("/consent/:token", async (c) => {
  const token = c.req.param("token");
  const origin = new URL(c.req.url).origin;
  if (!checkOrigin(c)) return new Response("Forbidden", { status: 403 });
  if (!TOKEN_RE.test(token)) return notFoundConsent(c, origin);
  const boss = await acceptBossConsent(c.env.DB, token);
  if (!boss) return notFoundConsent(c, origin);
  const user = await getUser(c.env.DB, boss.user_id);
  if (!user) return notFoundConsent(c, origin);

  // Tell the user their manager just consented. acceptBossConsent only
  // returns a non-null boss on the first successful click (the token is
  // cleared in the same UPDATE), so a refresh / second tab can't double-fire.
  c.executionCtx.waitUntil(
    sendConsentAcceptedToUser({
      env: c.env,
      appOrigin: origin,
      user,
      boss,
    }).catch((e) => console.error("[boss] consent-accepted notify failed", e)),
  );

  return bossHtml(
    renderConsentPage({
      user,
      boss,
      appOrigin: origin,
      formAction: `/boss/consent/${token}`,
      confirmation: "accepted",
    }),
  );
});

// ---------------------------------------------------------------------------
// Unsubscribe flow (one-click + RFC 8058 List-Unsubscribe-Post)
// ---------------------------------------------------------------------------
//
// GET  /boss/unsubscribe/:token — show a confirmation form (humans clicking
//      the footer link). GET intentionally doesn't mutate so a link
//      preview / prefetch can't burn the token.
// POST /boss/unsubscribe/:token — actually revoke. Same endpoint serves
//      both the form's POST and Gmail/Outlook's RFC 8058 one-click POST
//      (`List-Unsubscribe=One-Click` body); we don't care which form
//      arrives, only that it's a POST.

r.get("/unsubscribe/:token", async (c) => {
  const token = c.req.param("token");
  const origin = new URL(c.req.url).origin;
  if (!TOKEN_RE.test(token)) return notFoundUnsubscribe(c, origin);
  const boss = await findBossByUnsubscribeToken(c.env.DB, token);
  if (!boss) return notFoundUnsubscribe(c, origin);
  const user = await getUser(c.env.DB, boss.user_id);
  if (!user) return notFoundUnsubscribe(c, origin);
  return bossHtml(
    renderUnsubscribePage({
      user,
      boss,
      appOrigin: origin,
      formAction: `/boss/unsubscribe/${token}`,
      // If they're already revoked, surface that instead of the form so a
      // second click from an old email doesn't pretend to do work.
      confirmation: boss.consent_status === "revoked" ? "already-revoked" : undefined,
    }),
  );
});

r.post("/unsubscribe/:token", async (c) => {
  const token = c.req.param("token");
  const origin = new URL(c.req.url).origin;
  if (!checkOrigin(c)) return new Response("Forbidden", { status: 403 });
  if (!TOKEN_RE.test(token)) return notFoundUnsubscribe(c, origin);
  const boss = await findBossByUnsubscribeToken(c.env.DB, token);
  if (!boss) return notFoundUnsubscribe(c, origin);
  const user = await getUser(c.env.DB, boss.user_id);
  if (!user) return notFoundUnsubscribe(c, origin);

  const result = await revokeBoss(c.env.DB, boss.id);

  // Notify the USER once — only on the first revoke (changed === true).
  // A second click from another email tab is a no-op: the row is already
  // revoked and we don't want to spam the user with duplicate "your
  // manager unsubscribed" notifications.
  if (result.changed) {
    c.executionCtx.waitUntil(
      sendConsentRevokedToUser({
        env: c.env,
        appOrigin: origin,
        user,
        boss: { ...boss, consent_status: "revoked", revoked_at: new Date().toISOString() },
      }).catch((e) => console.error("[boss] revoke-notify failed", e)),
    );
  }

  return bossHtml(
    renderUnsubscribePage({
      user,
      boss: { ...boss, consent_status: "revoked", revoked_at: new Date().toISOString() },
      appOrigin: origin,
      formAction: `/boss/unsubscribe/${token}`,
      confirmation: result.changed ? "revoked" : "already-revoked",
    }),
  );
});

// ---------------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------------

r.get("/approve/:token", async (c) => {
  const token = c.req.param("token");
  const origin = new URL(c.req.url).origin;
  if (!TOKEN_RE.test(token)) return notFoundApprove(c, origin);
  const ctx = await loadApprovalContext(c.env.DB, token);
  if (!ctx) return notFoundApprove(c, origin);
  return bossHtml(
    renderApprovalPage({
      ...ctx,
      appOrigin: origin,
      formAction: `/boss/approve/${token}`,
    }),
  );
});

r.post("/approve/:token", async (c) => {
  const token = c.req.param("token");
  const origin = new URL(c.req.url).origin;
  if (!checkOrigin(c)) return new Response("Forbidden", { status: 403 });
  if (!TOKEN_RE.test(token)) return notFoundApprove(c, origin);
  const ctx = await loadApprovalContext(c.env.DB, token);
  if (!ctx) return notFoundApprove(c, origin);

  // Hono parses application/x-www-form-urlencoded for us.
  const form = await c.req.parseBody();
  const action = String(form.action ?? "");

  const comment = String(form.comment ?? "")
    // Strip control chars but preserve newlines/tabs so a multi-line reason
    // round-trips into the email back to the user.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/g, "")
    .slice(0, 500)
    .trim();

  if (action !== "approve" && action !== "reject") {
    return bossHtml(
      renderApprovalPage({
        ...ctx,
        appOrigin: origin,
        formAction: `/boss/approve/${token}`,
        confirmation: "unknown",
      }),
    );
  }
  if (action === "reject" && !comment) {
    // Re-render the form with the error banner + the (empty) comment.
    return bossHtml(
      renderApprovalPage({
        ...ctx,
        appOrigin: origin,
        formAction: `/boss/approve/${token}`,
        confirmation: "missing-comment",
        priorComment: comment,
      }),
    );
  }

  // Persist the decision and burn the token in one shot. The DB-side guard
  // makes this race-safe: a concurrent second click in another tab returns
  // `false` (token already cleared) and we render the same confirmation
  // page without firing duplicate emails / iCal updates.
  const decision = action === "approve" ? "approved" : "rejected";
  const persisted = await decideApproval(c.env.DB, ctx.approval.id, decision, comment || null);
  if (!persisted) {
    return bossHtml(
      renderApprovalPage({
        ...ctx,
        appOrigin: origin,
        formAction: `/boss/approve/${token}`,
        confirmation: decision,
      }),
    );
  }

  // Mirror the state onto vacations.approval_state so the dashboard query
  // and the iCal feed render the right STATUS without a join.
  await setVacationApprovalState(c.env.DB, ctx.user.id, ctx.vacation.id, decision);

  // For rejection, also set cancelled_at so the user's calendar removes the
  // event entirely. Approved bookings stay alive and flip TENTATIVE → CONFIRMED
  // on the next iCal send.
  let updatedVacation = ctx.vacation;
  if (decision === "rejected" && !ctx.vacation.cancelled_at) {
    const result = await cancelVacation(c.env.DB, ctx.user.id, ctx.vacation.id);
    if (result) updatedVacation = result.vacation;
  } else if (decision === "approved" && ctx.vacation.cancelled_at) {
    // The user might have edited a previously-rejected vacation that we
    // soft-cancelled. Approving brings it back.
    const result = await uncancelVacation(c.env.DB, ctx.user.id, ctx.vacation.id);
    if (result) updatedVacation = result.vacation;
  } else {
    // Re-read for the bumped sequence.
    const fresh = await getVacation(c.env.DB, ctx.user.id, ctx.vacation.id);
    if (fresh) updatedVacation = fresh;
  }
  // Sync approval_state again in case (un)cancel reset it.
  if (updatedVacation.approval_state !== decision) {
    await setVacationApprovalState(c.env.DB, ctx.user.id, ctx.vacation.id, decision);
    const fresh2 = await getVacation(c.env.DB, ctx.user.id, ctx.vacation.id);
    if (fresh2) updatedVacation = fresh2;
  }

  // Fan out follow-up emails:
  //   1. user gets a decision receipt (approved/rejected with comment)
  //   2. user gets a fresh iCal invite reflecting the new STATUS
  //   3. boss gets a CONFIRMED iCal copy on approve, or a CANCEL on reject
  c.executionCtx.waitUntil(
    Promise.all([
      sendDecisionReceiptToUser({
        env: c.env,
        appOrigin: origin,
        user: ctx.user,
        boss: ctx.boss,
        vacation: updatedVacation,
        category: ctx.category,
        decision,
        comment: comment || null,
      }).catch((e) => console.error("[boss] decision receipt failed", e)),

      sendVacationLifecycleEmail(
        c.env,
        origin,
        ctx.user,
        updatedVacation,
        ctx.category,
        decision === "approved" ? "updated" : "cancelled",
      ).catch((e) => console.error("[boss] user-side iCal send failed", e)),

      (async () => {
        // Skip the boss-side iCal fan-out if the relationship was revoked
        // between the GET (showing the form) and the POST. The
        // findApprovalByToken filter blocks this from reaching here in
        // practice, but defence-in-depth: never send to a revoked address.
        if (ctx.boss.consent_status !== "consented") return;
        // Re-read the unsubscribe token from the relationship so the boss
        // copy carries the same one-click footer/header as every other
        // boss-bound message.
        const unsubscribeToken = await getBossUnsubscribeToken(c.env.DB, ctx.user.id);
        if (!unsubscribeToken) return;
        await sendBossNotifyInvite({
          env: c.env,
          appOrigin: origin,
          user: ctx.user,
          boss: ctx.boss,
          vacation: updatedVacation,
          category: ctx.category,
          method: decision === "approved" ? "PUBLISH" : "CANCEL",
          unsubscribeToken,
        });
      })().catch((e) => console.error("[boss] boss-side iCal send failed", e)),
    ]).then(() => undefined),
  );

  return bossHtml(
    renderApprovalPage({
      ...ctx,
      appOrigin: origin,
      formAction: `/boss/approve/${token}`,
      confirmation: decision,
    }),
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ApprovalContext {
  approval: import("../../shared/types.js").VacationApproval;
  boss: import("../../shared/types.js").BossRelationship;
  user: import("../../shared/types.js").User;
  vacation: import("../../shared/types.js").Vacation;
  category: import("../../shared/types.js").Category | null;
  balance: { used_days: number; total_days: number; remaining_days: number };
}

async function loadApprovalContext(
  db: import("@cloudflare/workers-types").D1Database,
  token: string,
): Promise<ApprovalContext | null> {
  const found = await findApprovalByToken(db, token);
  if (!found) return null;
  const user = await getUser(db, found.user_id);
  if (!user) return null;
  const vacation = await getVacation(db, user.id, found.vacation_id);
  if (!vacation) return null;
  const category = await getCategory(db, user.id, vacation.category_id);

  // Balance preview: what does the user's category look like FOR THE YEAR
  // OF THIS VACATION, including this pending request? Same math the
  // dashboard uses, so the boss sees what the employee sees.
  const year = Number(vacation.start_date.slice(0, 4));
  const [allowances, vacations] = await Promise.all([
    listAllowances(db, user.id, year),
    listVacationsInYear(db, user.id, year),
  ]);
  const allowance = category ? allowances.find((a) => a.category_id === category.id) : null;
  const filtered = vacationsInYear(year, vacations).filter(
    (v) => category && v.category_id === category.id,
  );
  const usage = category
    ? categoryUsage(category, allowance ?? null, filtered, new Date(), year, user.timezone)
    : { used_days: vacationDayCostInYear(vacation, year), total_days: 0, remaining_days: 0 };

  return {
    approval: found.approval,
    boss: found.boss,
    user,
    vacation,
    category,
    balance: {
      used_days: usage.used_days,
      total_days: usage.total_days,
      remaining_days: usage.remaining_days,
    },
  };
}

function notFoundConsent(_c: import("hono").Context<HonoVars>, appOrigin: string) {
  return bossHtml(
    renderConsentPage({
      user: emptyUser(),
      boss: emptyBoss(),
      appOrigin,
      formAction: "#",
      confirmation: "expired",
    }),
    404,
  );
}

function notFoundUnsubscribe(_c: import("hono").Context<HonoVars>, appOrigin: string) {
  return bossHtml(
    renderUnsubscribePage({
      user: emptyUser(),
      boss: emptyBoss(),
      appOrigin,
      formAction: "#",
      confirmation: "unknown",
    }),
    404,
  );
}

function notFoundApprove(_c: import("hono").Context<HonoVars>, appOrigin: string) {
  return bossHtml(
    renderApprovalPage({
      user: emptyUser(),
      boss: emptyBoss(),
      vacation: emptyVacation(),
      category: null,
      appOrigin,
      formAction: "#",
      balance: { used_days: 0, total_days: 0, remaining_days: 0 },
      confirmation: "expired",
    }),
    404,
  );
}

// Placeholder objects for the "this link is dead" rendering path. The page
// only uses `display_name` from these (in the error blurb) so the rest can
// be empty strings.
function emptyUser(): import("../../shared/types.js").User {
  return {
    id: "",
    username: "",
    display_name: "the sender",
    role: "user",
    email: null,
    email_verified_at: null,
    timezone: "UTC",
    created_at: "",
    last_login_at: null,
    welcome_completed_at: null,
  };
}
function emptyBoss(): import("../../shared/types.js").BossRelationship {
  return {
    id: "",
    user_id: "",
    boss_email: "",
    mode: "notify",
    consent_status: "pending",
    consented_at: null,
    revoked_at: null,
    created_at: "",
  };
}
function emptyVacation(): import("../../shared/types.js").Vacation {
  return {
    id: "",
    user_id: "",
    category_id: "",
    start_date: "1970-01-01",
    end_date: "1970-01-01",
    partial_amount: null,
    public_desc: "",
    internal_desc: "",
    cancelled_at: null,
    ical_sequence: 0,
    approval_state: null,
    created_at: "",
    updated_at: "",
  };
}

export default r;
