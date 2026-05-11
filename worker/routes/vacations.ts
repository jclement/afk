/**
 * Vacation entry routes. Provides list-by-year, create, update, cancel,
 * and the year summary used by the dashboard.
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok, readJson } from "../lib/responses.js";
import {
  cancelVacation,
  createVacation,
  deleteVacation,
  getVacation,
  listAllowances,
  listCategories,
  listVacationsInYear,
  uncancelVacation,
  updateVacation,
  upsertAllowance,
} from "../lib/store.js";
import {
  categoryUsage,
  validateVacationShape,
  vacationsInYear,
} from "../../shared/vacation-math.js";
import {
  clearPendingDecisionTokens,
  createOrResetApproval,
  getBoss,
  getBossUnsubscribeToken,
  setVacationApprovalState,
} from "../lib/boss-store.js";
import {
  dispatchBossApprovalRequest,
  dispatchBossNotify,
  dispatchUserLifecycle,
} from "../lib/email-dispatch.js";
import { listVacationEmailLog } from "../lib/email-log.js";
import type { Allowance, BossRelationship, Category } from "../../shared/types.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

/**
 * Sanitise free-text fields that flow into iCal SUMMARY/DESCRIPTION and
 * email Subject/body. Strip control characters (CR/LF/TAB/etc.) so a user
 * can't smuggle line breaks into RFC822 headers or break iCal parsing.
 */
function sanitiseText(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/g, "").slice(0, max);
}

// ---------------------------------------------------------------------------
// Year summary — categories with used/remaining + the vacation list.
// ---------------------------------------------------------------------------
r.get("/summary/:year{[0-9]+}", async (c) => {
  const user = authedUser(c);
  const year = Number(c.req.param("year"));
  const cats = await listCategories(c.env.DB, user.id);
  const allowances = await listAllowances(c.env.DB, user.id, year);
  const vacations = await listVacationsInYear(c.env.DB, user.id, year);

  // Auto-create empty allowances so the UI always has something to render.
  const byCategory = new Map<string, Allowance>();
  for (const a of allowances) byCategory.set(a.category_id, a);
  for (const cat of cats) {
    if (!byCategory.has(cat.id) && !cat.archived) {
      const created = await upsertAllowance(c.env.DB, user.id, {
        category_id: cat.id,
        year,
        days_allotted: 0,
        days_carryover: 0,
      });
      byCategory.set(cat.id, created);
    }
  }

  const visible = vacationsInYear(year, vacations);
  const asOf = new Date();
  const summaries = cats.map((cat) => {
    const allowance = byCategory.get(cat.id)!;
    const usage = categoryUsage(
      cat,
      allowance,
      visible.filter((v) => v.category_id === cat.id),
      asOf,
      year,
      user.timezone,
    );
    return { category: cat, allowance, ...usage };
  });

  // Attach category to each vacation for convenience.
  const catsById = new Map(cats.map((c2) => [c2.id, c2]));
  return ok(c, {
    year,
    categories: summaries,
    vacations: vacations.map((v) => ({
      ...v,
      cancelled_at: v.cancelled_at ?? null,
      category: catsById.get(v.category_id) ?? null,
    })),
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
r.get("/", async (c) => {
  const user = authedUser(c);
  const yearParam = c.req.query("year");
  if (!yearParam) {
    return err(c, "VALIDATION_ERROR", "year query parameter is required.");
  }
  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return err(c, "VALIDATION_ERROR", "year must be a sane integer.");
  }
  const rows = await listVacationsInYear(c.env.DB, user.id, year);
  return ok(c, rows);
});

r.post("/", async (c) => {
  const user = authedUser(c);
  const body = await readJson<{
    category_id?: string;
    start_date?: string;
    end_date?: string;
    partial_amount?: number | null;
    public_desc?: string;
    internal_desc?: string;
  }>(c);
  const category_id = body.category_id ?? "";
  const start_date = body.start_date ?? "";
  const end_date = body.end_date ?? "";
  const partial_amount =
    body.partial_amount === null || body.partial_amount === undefined
      ? null
      : Number(body.partial_amount);
  if (!category_id) {
    return err(c, "VALIDATION_ERROR", "category_id is required.");
  }
  const shapeErr = validateVacationShape({
    start_date,
    end_date,
    partial_amount,
  });
  if (shapeErr) return err(c, "VALIDATION_ERROR", shapeErr);
  const public_desc = sanitiseText(body.public_desc ?? "", 200);
  const internal_desc = sanitiseText(body.internal_desc ?? "", 2000);
  try {
    let created = await createVacation(c.env.DB, user.id, {
      category_id,
      start_date,
      end_date,
      partial_amount,
      public_desc,
      internal_desc,
    });

    // Boss / approval gate. If the user has a consented boss in approval
    // mode, mark the vacation as pending up-front so the user's own iCal
    // invite (sent below via mailVacation) goes out as TENTATIVE — not
    // CONFIRMED, then immediately corrected.
    const boss = await getBoss(c.env.DB, user.id);
    const bossActive = boss && boss.consent_status === "consented";
    if (bossActive && boss.mode === "approval") {
      await setVacationApprovalState(c.env.DB, user.id, created.id, "pending");
      const fresh = await getVacation(c.env.DB, user.id, created.id);
      if (fresh) created = fresh;
    }

    c.executionCtx.waitUntil(
      mailVacation(c.env, new URL(c.req.url).origin, user, created, "created", boss),
    );
    return ok(c, created, 201);
  } catch (e) {
    return err(c, "VALIDATION_ERROR", (e as Error).message);
  }
});

r.get("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const v = await getVacation(c.env.DB, user.id, id);
  if (!v) return err(c, "NOT_FOUND", "Vacation not found.");
  return ok(c, v);
});

r.patch("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const existing = await getVacation(c.env.DB, user.id, id);
  if (!existing) return err(c, "NOT_FOUND", "Vacation not found.");

  const body = await readJson<{
    category_id?: string;
    start_date?: string;
    end_date?: string;
    partial_amount?: number | null;
    public_desc?: string;
    internal_desc?: string;
  }>(c);
  const merged = {
    start_date: body.start_date ?? existing.start_date,
    end_date: body.end_date ?? existing.end_date,
    partial_amount:
      body.partial_amount === undefined
        ? existing.partial_amount
        : body.partial_amount === null
          ? null
          : Number(body.partial_amount),
  };
  const shapeErr = validateVacationShape(merged);
  if (shapeErr) return err(c, "VALIDATION_ERROR", shapeErr);

  try {
    const updated = await updateVacation(c.env.DB, user.id, id, {
      ...(body.category_id ? { category_id: body.category_id } : {}),
      ...merged,
      ...(body.public_desc !== undefined
        ? { public_desc: sanitiseText(body.public_desc, 200) }
        : {}),
      ...(body.internal_desc !== undefined
        ? { internal_desc: sanitiseText(body.internal_desc, 2000) }
        : {}),
    });
    if (updated) {
      const boss = await getBoss(c.env.DB, user.id);
      let toMail = updated;
      let priorApprovedVacation: typeof updated | null = null;
      if (boss?.consent_status === "consented" && boss.mode === "approval") {
        // Capture the prior state BEFORE we mutate so we can send a "this
        // event is being re-evaluated" CANCEL/TENTATIVE to the boss when
        // the user edits a previously-approved booking. Otherwise the
        // boss's calendar keeps the stale CONFIRMED event for the OLD
        // dates until the new request is approved.
        if (existing.approval_state === "approved") {
          priorApprovedVacation = existing;
        }
        // Edit of a rejected vacation revives it as pending. The reject
        // path set cancelled_at; clear it so the row is coherent (state
        // and cancelled_at agree). uncancelVacation handles the SQL +
        // sequence bump.
        if (updated.cancelled_at && updated.approval_state === "rejected") {
          const uncan = await uncancelVacation(c.env.DB, user.id, updated.id);
          if (uncan) toMail = uncan.vacation;
        }
        // Re-arm approval. createOrResetApproval (called via mailVacation)
        // will mint a fresh decision token + invalidate any old one.
        if (toMail.approval_state !== "pending") {
          await setVacationApprovalState(c.env.DB, user.id, toMail.id, "pending");
          const fresh = await getVacation(c.env.DB, user.id, toMail.id);
          if (fresh) toMail = fresh;
        }
      }
      c.executionCtx.waitUntil(
        (async () => {
          // Send the boss a TENTATIVE update for the OLD dates first if we
          // bumped an approved booking back to pending — same UID + bumped
          // sequence overwrites the prior CONFIRMED event in their calendar.
          if (priorApprovedVacation && boss) {
            const allCats = await listCategories(c.env.DB, user.id);
            const cat = allCats.find((cc) => cc.id === priorApprovedVacation.category_id) ?? null;
            const unsubscribeToken = await getBossUnsubscribeToken(c.env.DB, user.id);
            if (unsubscribeToken) {
              await dispatchBossNotify({
                env: c.env,
                appOrigin: new URL(c.req.url).origin,
                user,
                boss,
                vacation: { ...priorApprovedVacation, ical_sequence: toMail.ical_sequence },
                category: cat,
                method: "PUBLISH",
                status: "TENTATIVE",
                unsubscribeToken,
              });
            }
          }
          await mailVacation(c.env, new URL(c.req.url).origin, user, toMail, "updated", boss);
        })(),
      );
    }
    return ok(c, updated);
  } catch (e) {
    return err(c, "VALIDATION_ERROR", (e as Error).message);
  }
});

r.post("/:id/cancel", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  // Capture state before we mutate so we know whether to fire emails / kill
  // pending boss tokens.
  const before = await getVacation(c.env.DB, user.id, id);
  const result = await cancelVacation(c.env.DB, user.id, id);
  if (!result) return err(c, "NOT_FOUND", "Vacation not found.");

  // Boss-side defence: a pending approval request the boss hasn't decided
  // yet must be invalidated when the user self-cancels. Otherwise the boss
  // could click "approve" on a vacation the user already withdrew, which
  // boss-public's "approved + cancelled_at = uncancel" branch would
  // silently undo. Null the decision token so the boss's link 404s.
  if (before?.approval_state === "pending") {
    await clearPendingDecisionTokens(c.env.DB, id);
    await setVacationApprovalState(c.env.DB, user.id, id, null);
  }

  // Only fire the CANCEL email when state actually changed — a double-click
  // shouldn't spam the user's calendar with duplicate cancellations.
  if (result.changed) {
    const boss = await getBoss(c.env.DB, user.id);
    c.executionCtx.waitUntil(
      mailVacation(c.env, new URL(c.req.url).origin, user, result.vacation, "cancelled", boss),
    );
  }
  return ok(c, result.vacation);
});

r.post("/:id/uncancel", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const before = await getVacation(c.env.DB, user.id, id);
  const result = await uncancelVacation(c.env.DB, user.id, id);
  if (!result) return err(c, "NOT_FOUND", "Vacation not found.");
  if (result.changed) {
    const boss = await getBoss(c.env.DB, user.id);
    let toMail = result.vacation;
    // Uncancelling a rejected vacation revives it. The user's intent is
    // "this should be live" — but if the boss is in approval mode, it has
    // to be re-evaluated. Drop it back to pending and re-arm. If we left
    // approval_state='rejected' the iCal feed would render the just-
    // uncancelled vacation as CANCELLED again — silent disappearance.
    if (before?.approval_state === "rejected") {
      const newState =
        boss?.consent_status === "consented" && boss.mode === "approval" ? "pending" : null;
      await setVacationApprovalState(c.env.DB, user.id, id, newState);
      const fresh = await getVacation(c.env.DB, user.id, id);
      if (fresh) toMail = fresh;
    }
    c.executionCtx.waitUntil(
      mailVacation(c.env, new URL(c.req.url).origin, user, toMail, "uncancelled", boss),
    );
  }
  return ok(c, result.vacation);
});

r.delete("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  // Capture the row before deleting so we can email a CANCEL with the right
  // UID + sequence. If it was already cancelled, the receiving calendar has
  // already removed the event, so we skip the email.
  const existing = await getVacation(c.env.DB, user.id, id);
  const ok2 = await deleteVacation(c.env.DB, user.id, id);
  if (!ok2) return err(c, "NOT_FOUND", "Vacation not found.");
  if (existing && !existing.cancelled_at) {
    // RFC 5546 requires SEQUENCE on a CANCEL to be ≥ the last published one
    // (most clients want strictly greater, or they'll silently ignore the
    // cancellation). The deleteVacation path doesn't bump the row's sequence
    // because the row is gone; bump it in-memory for the outbound email.
    const boss = await getBoss(c.env.DB, user.id);
    c.executionCtx.waitUntil(
      mailVacation(
        c.env,
        new URL(c.req.url).origin,
        user,
        { ...existing, ical_sequence: existing.ical_sequence + 1 },
        "deleted",
        boss,
      ),
    );
  }
  return ok(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// Email log — read + manual resend.
//
// The lifecycle path (create/update/cancel/...) fires emails via waitUntil
// with errors-only logging to stdout. Historically that meant "did the
// manager actually get the invite?" had no answer. These two endpoints
// close that gap:
//
//   GET  /:id/email-log → every send attempt for this vacation, success
//                         or failure. Used by the UI to show "last sent"
//                         status next to the resend button.
//   POST /:id/resend    → manually re-send the invite to me, the manager,
//                         or both. Performed inline (not via waitUntil) so
//                         the response can carry the per-recipient result;
//                         this is the user-pulled support escape hatch
//                         after a notify-mode boss email goes missing.
// ---------------------------------------------------------------------------

r.get("/:id/email-log", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  // The vacation must belong to the user — otherwise return 404 same as
  // every other read so we don't leak existence to other tenants.
  const existing = await getVacation(c.env.DB, user.id, id);
  if (!existing) return err(c, "NOT_FOUND", "Vacation not found.");
  const log = await listVacationEmailLog(c.env.DB, user.id, id);
  return ok(c, log);
});

r.post("/:id/resend", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const existing = await getVacation(c.env.DB, user.id, id);
  if (!existing) return err(c, "NOT_FOUND", "Vacation not found.");

  const body = await readJson<{ to?: "self" | "boss" | "both" }>(c);
  const to = body.to;
  if (to !== "self" && to !== "boss" && to !== "both") {
    return err(c, "VALIDATION_ERROR", "to must be 'self', 'boss', or 'both'.");
  }
  const wantSelf = to === "self" || to === "both";
  const wantBoss = to === "boss" || to === "both";

  const boss = wantBoss ? await getBoss(c.env.DB, user.id) : null;
  if (wantBoss && (!boss || boss.consent_status !== "consented")) {
    // Surface the specific reason so the UI can render an actionable hint
    // ("your manager hasn't confirmed yet" / "they unsubscribed").
    const reason = !boss
      ? "You don't have a manager configured."
      : boss.consent_status === "pending"
        ? "Your manager hasn't accepted the consent email yet."
        : "Your manager unsubscribed — add a new manager from Settings.";
    return err(c, "VALIDATION_ERROR", reason);
  }

  const cats = await listCategories(c.env.DB, user.id);
  const category: Category | null = cats.find((cc) => cc.id === existing.category_id) ?? null;
  const appOrigin = new URL(c.req.url).origin;
  // Cancelled rows → CANCEL on every kind; live rows → PUBLISH. The
  // lifecycle name we pick is just so dispatchUserLifecycle picks the
  // right METHOD — "cancelled" maps to CANCEL, "updated" to PUBLISH.
  const lifecycle = existing.cancelled_at ? "cancelled" : "updated";
  const results: import("../lib/email-dispatch.js").DispatchResult[] = [];

  if (wantSelf) {
    results.push(
      await dispatchUserLifecycle({
        env: c.env,
        appOrigin,
        user,
        vacation: existing,
        category,
        lifecycle,
        resend: true,
      }),
    );
  }

  if (wantBoss && boss) {
    // Already validated consent above. unsubscribe_token is required for
    // every boss-bound email (footer + RFC 8058 header). Pre-0008 rows
    // could be missing it; treat that as an internal error rather than
    // sending an email with a broken unsubscribe link.
    const unsubscribeToken = await getBossUnsubscribeToken(c.env.DB, user.id);
    if (!unsubscribeToken) {
      return err(c, "INTERNAL_ERROR", "Missing unsubscribe token — contact support.");
    }

    if (boss.mode === "notify") {
      results.push(
        await dispatchBossNotify({
          env: c.env,
          appOrigin,
          user,
          boss,
          vacation: existing,
          category,
          method: existing.cancelled_at ? "CANCEL" : "PUBLISH",
          unsubscribeToken,
          resend: true,
        }),
      );
    } else {
      // Approval mode. If the vacation is currently pending the manager's
      // decision, re-mint a fresh decision token and re-send the approval-
      // request email (the old token is invalidated by createOrResetApproval).
      // Otherwise — already-approved or cancelled — fall back to a plain
      // iCal copy so they get the calendar event back on their schedule.
      if (existing.approval_state === "pending") {
        const { approval, decision_token } = await createOrResetApproval(
          c.env.DB,
          existing.id,
          boss.id,
        );
        const balance = await computeApprovalBalance(c.env, user, existing, category);
        results.push(
          await dispatchBossApprovalRequest({
            env: c.env,
            appOrigin,
            user,
            boss,
            vacation: existing,
            category,
            approval,
            decisionToken: decision_token,
            balance,
            unsubscribeToken,
            resend: true,
          }),
        );
      } else {
        results.push(
          await dispatchBossNotify({
            env: c.env,
            appOrigin,
            user,
            boss,
            vacation: existing,
            category,
            method: existing.cancelled_at ? "CANCEL" : "PUBLISH",
            unsubscribeToken,
            resend: true,
          }),
        );
      }
    }
  }

  const log = await listVacationEmailLog(c.env.DB, user.id, id);
  return ok(c, { results, log });
});

/**
 * Look up the vacation's category and fan out to the email helper. Pulled
 * up here so each route handler is a one-liner.
 *
 * Boss fan-out:
 *   - notify mode  → boss gets a copy of every iCal invite (PUBLISH/CANCEL).
 *   - approval mode + pending → boss gets the approval-request email with
 *     the magic link (NOT a calendar invite — they decide first).
 *   - approval mode + already-decided → no extra email; the approval-decide
 *     route handles the post-decision boss copy.
 *
 * Every send (success or failure) is logged via the dispatcher helpers, so
 * a Mailgun blip on the boss email no longer disappears into stdout — it
 * shows up on the vacation's email-log endpoint and powers the resend UI.
 */
async function mailVacation(
  env: import("../types.js").Env,
  appOrigin: string,
  user: import("../../shared/types.js").User,
  vacation: import("../../shared/types.js").Vacation,
  lifecycle: "created" | "updated" | "cancelled" | "uncancelled" | "deleted",
  boss: BossRelationship | null,
): Promise<void> {
  const cats = await listCategories(env.DB, user.id);
  const category: Category | null = cats.find((c) => c.id === vacation.category_id) ?? null;

  // 1. User-side iCal — uses TENTATIVE for pending automatically. Dispatcher
  // handles the email/verified gate and logs success or failure.
  await dispatchUserLifecycle({ env, appOrigin, user, vacation, category, lifecycle });

  if (!boss || boss.consent_status !== "consented") return;

  // Every boss-bound email carries the manager's per-relationship
  // unsubscribe URL (footer + RFC 8058 List-Unsubscribe header). Fetched
  // once here and passed to whichever dispatcher fires below.
  const unsubscribeToken = await getBossUnsubscribeToken(env.DB, user.id);
  if (!unsubscribeToken) {
    // Defence-in-depth — pre-0008 rows that somehow missed the backfill.
    // Skip rather than send a malformed unsubscribe URL.
    console.error("[boss] missing unsubscribe_token for user", user.id);
    return;
  }

  const method: "PUBLISH" | "CANCEL" =
    lifecycle === "cancelled" || lifecycle === "deleted" ? "CANCEL" : "PUBLISH";

  // 2. Notify mode — straight iCal copy. CANCELs always go through; for
  // PUBLISH we only send if the vacation is currently confirmed (no point
  // mirroring a pending one to the boss in notify mode — but pending only
  // exists in approval mode, so this is more a guardrail).
  if (boss.mode === "notify") {
    await dispatchBossNotify({
      env,
      appOrigin,
      user,
      boss,
      vacation,
      category,
      method,
      unsubscribeToken,
    });
    return;
  }

  // 3. Approval mode. Only fire the approval-request email when the
  // vacation just entered (or re-entered) the pending state. Cancel/delete
  // also notify the boss so any prior calendar invite they had goes away.
  if (boss.mode === "approval") {
    if (lifecycle === "cancelled" || lifecycle === "deleted") {
      // Boss only ever sees the calendar event if they previously approved
      // it. Send a CANCEL — calendar clients no-op on UIDs they've never
      // seen, so this is safe even if they never had it.
      await dispatchBossNotify({
        env,
        appOrigin,
        user,
        boss,
        vacation,
        category,
        method: "CANCEL",
        unsubscribeToken,
      });
      return;
    }
    if (vacation.approval_state !== "pending") return;

    // Mint (or reset) an approval row + token, compute the balance preview,
    // and send the request. The mint itself can throw (D1 hiccup) — if it
    // does, log it as a boss approval_request failure so support has a
    // breadcrumb, then return.
    try {
      const { approval, decision_token } = await createOrResetApproval(
        env.DB,
        vacation.id,
        boss.id,
      );
      const balance = await computeApprovalBalance(env, user, vacation, category);
      await dispatchBossApprovalRequest({
        env,
        appOrigin,
        user,
        boss,
        vacation,
        category,
        approval,
        decisionToken: decision_token,
        balance,
        unsubscribeToken,
      });
    } catch (e) {
      console.error("[boss] approval mint failed:", (e as Error).message);
    }
  }
}

/**
 * Compute the post-decision balance preview the boss sees on the approval
 * page. Lifted out of mailVacation so the resend endpoint can reuse it.
 */
async function computeApprovalBalance(
  env: import("../types.js").Env,
  user: import("../../shared/types.js").User,
  vacation: import("../../shared/types.js").Vacation,
  category: Category | null,
): Promise<{ used_days: number; total_days: number; remaining_days: number }> {
  const year = Number(vacation.start_date.slice(0, 4));
  const [allowances, vacations] = await Promise.all([
    listAllowances(env.DB, user.id, year),
    listVacationsInYear(env.DB, user.id, year),
  ]);
  const allowance = category ? allowances.find((a) => a.category_id === category.id) : null;
  const filtered = vacationsInYear(year, vacations).filter(
    (v) => category && v.category_id === category.id,
  );
  const usage = category
    ? categoryUsage(category, allowance ?? null, filtered, new Date(), year, user.timezone)
    : { used_days: 0, total_days: 0, remaining_days: 0 };
  return {
    used_days: usage.used_days,
    total_days: usage.total_days,
    remaining_days: usage.remaining_days,
  };
}

export default r;
