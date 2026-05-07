/**
 * Read-only dashboard share links.
 *
 *   Authenticated (owner manages their own links):
 *     GET    /api/v1/share-tokens          — list
 *     POST   /api/v1/share-tokens          — mint
 *     DELETE /api/v1/share-tokens/:id      — revoke
 *
 *   Public (the recipient — no auth, token IS the auth):
 *     GET    /api/v1/share/:token/dashboard?year=YYYY
 *       → { owner, scope, year, available_years, categories, vacations }
 *
 * Two scopes:
 *   - current-year — ignores any ?year query, always resolves to "now" in
 *                    the owner's timezone. The visitor can't pivot to a
 *                    different year — the link is locked to today.
 *   - all-years    — visitor can pass ?year=YYYY; if absent, defaults to
 *                    current year. `available_years` populated for the
 *                    visitor-side year picker.
 *
 * The recipient never sees `internal_desc`, `cancelled_at` (cancelled rows
 * are filtered out), boss/email PII, or any token. Just the dashboard view.
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok, readJson } from "../lib/responses.js";
import {
  createShareToken,
  deleteShareToken,
  findUserByShareToken,
  listAllowances,
  listCategories,
  listShareTokens,
  listVacationYears,
  listVacationsInYear,
  touchShareTokenLastViewed,
  upsertAllowance,
} from "../lib/store.js";
import { getUser } from "../lib/users.js";
import { newShareToken } from "../lib/ids.js";
import {
  categoryUsage,
  currentYearInTimezone,
  vacationsInYear,
} from "../../shared/vacation-math.js";
import type {
  Allowance,
  PublicCategorySummary,
  ShareScope,
  SharePublicPayload,
} from "../../shared/types.js";

/** Same format as `newShareToken` — 24-byte hex. Mirrors the iCal regex. */
const SHARE_TOKEN_RE = /^[0-9a-f]{48}$/;

// ---------------------------------------------------------------------------
// Authenticated management
// ---------------------------------------------------------------------------
export const shareTokensApi = new Hono<HonoVars>();
shareTokensApi.use("*", requireAuth);

/**
 * Origin to embed in `share_url`. Derived from the request URL so it works
 * across the dev server, *.workers.dev, and the prod custom domain without
 * needing APP_ORIGIN set as a worker var. wrangler.toml's header comment
 * already promises "APP_ORIGIN is derived from the request URL at runtime";
 * this is that derivation.
 */
function originOf(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

shareTokensApi.get("/", async (c) => {
  const user = authedUser(c);
  return ok(c, await listShareTokens(c.env.DB, user.id, originOf(c)));
});

shareTokensApi.post("/", async (c) => {
  const user = authedUser(c);
  const body = await readJson<{ scope?: ShareScope; label?: string }>(c);
  const scope = body.scope;
  if (scope !== "current-year" && scope !== "all-years") {
    return err(c, "VALIDATION_ERROR", "Scope must be 'current-year' or 'all-years'.");
  }
  const label = (body.label ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .trim()
    .slice(0, 60);
  const token = newShareToken();
  try {
    await createShareToken(c.env.DB, user.id, { scope, label, token });
  } catch (e) {
    if ((e as Error).message.includes("UNIQUE")) {
      return err(c, "CONFLICT", "Token clash; please retry.");
    }
    throw e;
  }
  const all = await listShareTokens(c.env.DB, user.id, originOf(c));
  // Find the freshly-minted row by its share_url suffix — labels can repeat
  // and the same scope can be minted multiple times.
  const created = all.find((t) => t.share_url.endsWith(`/${token}`));
  return ok(c, created, 201);
});

shareTokensApi.delete("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const ok2 = await deleteShareToken(c.env.DB, user.id, id);
  if (!ok2) return err(c, "NOT_FOUND", "Share link not found.");
  return ok(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// Public dashboard payload (token-authenticated)
// ---------------------------------------------------------------------------
export const sharePublicApi = new Hono<HonoVars>();

sharePublicApi.get("/:token/dashboard", async (c) => {
  const token = c.req.param("token");
  // Format-gate before D1 — bogus probes get a constant-time 404 with no
  // database cost.
  if (!SHARE_TOKEN_RE.test(token)) {
    return err(c, "NOT_FOUND", "Share link not found.");
  }

  const lookup = await findUserByShareToken(c.env.DB, token);
  if (!lookup) return err(c, "NOT_FOUND", "Share link not found.");

  const user = await getUser(c.env.DB, lookup.user_id);
  if (!user) return err(c, "NOT_FOUND", "Share link not found.");

  // Stamp last_viewed_at out-of-band — a transient D1 write failure
  // mustn't 500 a page the visitor already saw.
  c.executionCtx.waitUntil(
    touchShareTokenLastViewed(c.env.DB, lookup.token_id).catch((e) =>
      console.error("[share] touch last_viewed failed", e),
    ),
  );

  // Resolve the year:
  //   current-year scope → owner's timezone "now," ignore visitor input
  //   all-years scope    → ?year=YYYY if sane, otherwise owner's current year
  const tzNow = currentYearInTimezone(user.timezone);
  let year = tzNow;
  if (lookup.scope === "all-years") {
    const raw = c.req.query("year");
    if (raw) {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1970 && n <= 9999) year = n;
    }
  }

  const cats = await listCategories(c.env.DB, user.id);
  const allowances = await listAllowances(c.env.DB, user.id, year);
  const vacations = await listVacationsInYear(c.env.DB, user.id, year);

  // Mirror the dashboard-summary handler: auto-create empty allowances so
  // the widgets always render. Don't flap if D1 is read-only — fall back to
  // an in-memory zero allowance instead of throwing.
  const byCategory = new Map<string, Allowance>();
  for (const a of allowances) byCategory.set(a.category_id, a);
  for (const cat of cats) {
    if (!byCategory.has(cat.id) && !cat.archived) {
      try {
        const created = await upsertAllowance(c.env.DB, user.id, {
          category_id: cat.id,
          year,
          days_allotted: 0,
          days_carryover: 0,
        });
        byCategory.set(cat.id, created);
      } catch {
        byCategory.set(cat.id, {
          id: "",
          user_id: user.id,
          category_id: cat.id,
          year,
          days_allotted: 0,
          days_carryover: 0,
          notes: null,
        });
      }
    }
  }

  const visible = vacationsInYear(year, vacations);
  const asOf = new Date();
  const summaries: PublicCategorySummary[] = cats
    .filter((c2) => !c2.archived || visible.some((v) => v.category_id === c2.id))
    .map((cat) => {
      const allowance = byCategory.get(cat.id)!;
      const usage = categoryUsage(
        cat,
        allowance,
        visible.filter((v) => v.category_id === cat.id),
        asOf,
        year,
        user.timezone,
      );
      // Strip private allowance fields: `notes` is the owner's accounting
      // free-text (e.g. "re-negotiated PTO with HR Q3"), and `id`/`user_id`
      // are internal. The recipient only needs the numeric inputs.
      return {
        category: cat,
        allowance: {
          category_id: allowance.category_id,
          year: allowance.year,
          days_allotted: allowance.days_allotted,
          days_carryover: allowance.days_carryover,
        },
        ...usage,
      };
    });

  // For the all-years picker, include every year that has activity even if
  // the visitor is currently looking at a different year.
  let availableYears: number[] = [];
  if (lookup.scope === "all-years") {
    availableYears = await listVacationYears(c.env.DB, user.id);
    if (availableYears.length === 0) availableYears = [year];
  }

  // Strip sensitive / cancelled rows. Pending/rejected rows are kept (with
  // approval_state surfaced) so the recipient sees what's tentative on the
  // calendar — same as the owner's dashboard.
  const catsById = new Map(cats.map((c2) => [c2.id, c2]));
  const sanitisedVacations: SharePublicPayload["vacations"] = vacations
    .filter((v) => !v.cancelled_at)
    .map((v) => ({
      id: v.id,
      category_id: v.category_id,
      start_date: v.start_date,
      end_date: v.end_date,
      partial_amount: v.partial_amount,
      public_desc: v.public_desc,
      cancelled_at: null,
      approval_state: v.approval_state,
      created_at: v.created_at,
      updated_at: v.updated_at,
      category: catsById.get(v.category_id) ?? null,
    }));

  const payload: SharePublicPayload = {
    owner: { display_name: user.display_name, timezone: user.timezone },
    scope: lookup.scope,
    year,
    available_years: availableYears,
    categories: summaries,
    vacations: sanitisedVacations,
  };
  // Pages behind a per-token URL are PII-by-token. Don't let intermediaries
  // (or the Cloudflare cache) hold onto them.
  c.header("Cache-Control", "private, no-store");
  return ok(c, payload);
});
