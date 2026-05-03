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
import { sendVacationLifecycleEmail } from "../lib/vacation-emails.js";
import { createOrResetApproval, getBoss, setVacationApprovalState } from "../lib/boss-store.js";
import { sendBossApprovalRequest, sendBossNotifyInvite } from "../lib/boss-emails.js";
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
      // If the vacation was previously approved/rejected and the dates or
      // category were edited, treat it as a new request and re-trigger the
      // boss approval flow. Notify-mode bosses just see the new iCal.
      const boss = await getBoss(c.env.DB, user.id);
      let toMail = updated;
      if (
        boss?.consent_status === "consented" &&
        boss.mode === "approval" &&
        updated.approval_state !== "pending"
      ) {
        await setVacationApprovalState(c.env.DB, user.id, updated.id, "pending");
        const fresh = await getVacation(c.env.DB, user.id, updated.id);
        if (fresh) toMail = fresh;
      }
      c.executionCtx.waitUntil(
        mailVacation(c.env, new URL(c.req.url).origin, user, toMail, "updated", boss),
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
  const result = await cancelVacation(c.env.DB, user.id, id);
  if (!result) return err(c, "NOT_FOUND", "Vacation not found.");
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
  const result = await uncancelVacation(c.env.DB, user.id, id);
  if (!result) return err(c, "NOT_FOUND", "Vacation not found.");
  if (result.changed) {
    const boss = await getBoss(c.env.DB, user.id);
    c.executionCtx.waitUntil(
      mailVacation(c.env, new URL(c.req.url).origin, user, result.vacation, "uncancelled", boss),
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
 * Failures in boss-side sends are caught individually so a Mailgun blip on
 * the boss email doesn't take down the user's own iCal.
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

  // 1. User-side iCal — uses TENTATIVE for pending automatically.
  if (user.email && user.email_verified_at) {
    try {
      await sendVacationLifecycleEmail(env, appOrigin, user, vacation, category, lifecycle);
    } catch (e) {
      console.error("[vacation-emails] user-side send failed:", (e as Error).message);
    }
  }

  if (!boss || boss.consent_status !== "consented") return;

  const method: "PUBLISH" | "CANCEL" =
    lifecycle === "cancelled" || lifecycle === "deleted" ? "CANCEL" : "PUBLISH";

  // 2. Notify mode — straight iCal copy. CANCELs always go through; for
  // PUBLISH we only send if the vacation is currently confirmed (no point
  // mirroring a pending one to the boss in notify mode — but pending only
  // exists in approval mode, so this is more a guardrail).
  if (boss.mode === "notify") {
    try {
      await sendBossNotifyInvite({
        env,
        appOrigin,
        user,
        boss,
        vacation,
        category,
        method,
      });
    } catch (e) {
      console.error("[boss] notify invite failed:", (e as Error).message);
    }
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
      try {
        await sendBossNotifyInvite({
          env,
          appOrigin,
          user,
          boss,
          vacation,
          category,
          method: "CANCEL",
        });
      } catch (e) {
        console.error("[boss] approval-mode cancel failed:", (e as Error).message);
      }
      return;
    }
    if (vacation.approval_state !== "pending") return;

    // Mint (or reset) an approval row + token, compute the balance preview,
    // and send the request.
    try {
      const { approval, decision_token } = await createOrResetApproval(
        env.DB,
        vacation.id,
        boss.id,
      );
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
      await sendBossApprovalRequest({
        env,
        appOrigin,
        user,
        boss,
        vacation,
        category,
        approval,
        decisionToken: decision_token,
        balance: {
          used_days: usage.used_days,
          total_days: usage.total_days,
          remaining_days: usage.remaining_days,
        },
      });
    } catch (e) {
      console.error("[boss] approval request failed:", (e as Error).message);
    }
  }
}

export default r;
