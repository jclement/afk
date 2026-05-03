/**
 * iCal feed routes.
 *
 *   GET  /api/v1/ical-tokens          — list tokens (with feed_url)
 *   POST /api/v1/ical-tokens          — mint a token (scope: private | public)
 *   DELETE /api/v1/ical-tokens/:id    — revoke a token
 *   GET  /ical/:token.ics             — public-facing feed (no auth, token IS the auth)
 *
 * Two scopes:
 *   - private: full event details, including internal_desc
 *   - public:  only public_desc (suitable for sharing with manager / team)
 */

import { Hono } from "hono";
import ical, {
  ICalCalendarMethod,
  ICalEventBusyStatus,
  ICalEventStatus,
  ICalEventTransparency,
} from "ical-generator";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok, readJson } from "../lib/responses.js";
import {
  createICalToken,
  deleteICalToken,
  findUserByICalToken,
  listAllVacations,
  listCategories,
  listICalTokens,
  touchICalTokenLastUsed,
} from "../lib/store.js";
import { getUser } from "../lib/users.js";
import { newICalToken } from "../lib/ids.js";
import { parseISODate } from "../../shared/vacation-math.js";

/** Token format gate: 24-byte hex (48 chars). Reject before hitting D1 to
 * avoid burning reads on bogus probes and to give a constant-time response
 * for malformed input. Mirror the format `newICalToken()` produces. */
const ICAL_TOKEN_RE = /^[0-9a-f]{48}$/;

// ---------------------------------------------------------------------------
// Authenticated management
// ---------------------------------------------------------------------------
export const tokensApi = new Hono<HonoVars>();
tokensApi.use("*", requireAuth);

tokensApi.get("/", async (c) => {
  const user = authedUser(c);
  return ok(c, await listICalTokens(c.env.DB, user.id, c.env.APP_ORIGIN));
});

tokensApi.post("/", async (c) => {
  const user = authedUser(c);
  const body = await readJson<{ scope?: "private" | "public"; label?: string }>(c);
  const scope = body.scope;
  if (scope !== "private" && scope !== "public") {
    return err(c, "VALIDATION_ERROR", "Scope must be 'private' or 'public'.");
  }

  const label = (body.label ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .trim()
    .slice(0, 60);
  const token = newICalToken();
  try {
    await createICalToken(c.env.DB, user.id, { scope, label, token });
  } catch (e) {
    if ((e as Error).message.includes("UNIQUE")) {
      return err(c, "CONFLICT", "Token clash; please retry.");
    }
    throw e;
  }
  const all = await listICalTokens(c.env.DB, user.id, c.env.APP_ORIGIN);
  const created = all.find((t) => t.scope === scope && t.label === label);
  return ok(c, created, 201);
});

tokensApi.delete("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const ok2 = await deleteICalToken(c.env.DB, user.id, id);
  if (!ok2) return err(c, "NOT_FOUND", "Token not found.");
  return ok(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// Public feed (token-authenticated). Mounted outside the /api/v1 prefix.
// ---------------------------------------------------------------------------
export const feedApi = new Hono<HonoVars>();

feedApi.get("/:token", async (c) => {
  // Strip a possible ".ics" suffix to be calendar-app friendly.
  const raw = c.req.param("token");
  const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;

  // Format-gate before the DB lookup. Bogus probes (empty, wrong length,
  // non-hex) get a constant-time 404 with no D1 cost.
  if (!ICAL_TOKEN_RE.test(token)) {
    return c.text("Calendar feed not found.", 404);
  }

  const lookup = await findUserByICalToken(c.env.DB, token);
  if (!lookup) {
    return c.text("Calendar feed not found.", 404);
  }
  // Stamp last_used_at out-of-band — calendar clients poll every 15 min and
  // a transient D1 write failure shouldn't 500 the feed they already
  // successfully read.
  c.executionCtx.waitUntil(
    touchICalTokenLastUsed(c.env.DB, lookup.token_id).catch((e) =>
      console.error("[ical] touch last_used failed", e),
    ),
  );

  const user = await getUser(c.env.DB, lookup.user_id);
  if (!user) {
    return c.text("Calendar feed not found.", 404);
  }
  const cats = await listCategories(c.env.DB, user.id);
  const catsById = new Map(cats.map((cat) => [cat.id, cat]));
  const vacations = await listAllVacations(c.env.DB, user.id);

  const origin = new URL(c.req.url).hostname;
  const cal = ical({
    name:
      lookup.scope === "private"
        ? `${user.display_name} — AFK (private)`
        : `${user.display_name} — Out of Office`,
    description:
      lookup.scope === "private"
        ? "Personal vacation feed (full detail)."
        : "Public vacation feed for sharing with team and manager.",
    timezone: "UTC",
    // Hint to clients to poll every 15 minutes. Without this, Apple Calendar
    // defaults to weekly refresh — bookings would take a week to appear on
    // a colleague's calendar.
    ttl: 900,
    method: ICalCalendarMethod.PUBLISH,
    prodId: { company: origin, product: "afk-vacation-tracker", language: "EN" },
  });

  for (const v of vacations) {
    // Approval mode lifecycle:
    //   approval_state = null      → no boss / notify mode → treat as confirmed
    //   approval_state = 'pending' → TENTATIVE on the user's private feed,
    //                                hidden from the public feed (no point
    //                                broadcasting an unconfirmed booking to
    //                                the team)
    //   approval_state = 'approved' → confirmed
    //   approval_state = 'rejected' → treat as cancelled
    const isPending = v.approval_state === "pending";
    const isRejected = v.approval_state === "rejected";
    const isCancelled = !!v.cancelled_at || isRejected;
    if (lookup.scope === "public" && (isPending || isRejected)) continue;

    const start = parseISODate(v.start_date);
    // iCal all-day events are end-exclusive — bump end by 1 day.
    const endInclusive = parseISODate(v.end_date);
    const endExclusive = new Date(endInclusive.getTime() + 86_400_000);
    const cat = catsById.get(v.category_id);
    const baseSummary =
      lookup.scope === "private"
        ? `[${cat?.name ?? "AFK"}] ${v.public_desc || "Out of Office"}`
        : v.public_desc || "Out of Office";
    const summary = isPending ? `[Pending] ${baseSummary}` : baseSummary;
    const description =
      lookup.scope === "private"
        ? buildPrivateDescription(v, cat?.name ?? null)
        : v.public_desc || "Out of Office";
    cal.createEvent({
      id: `${v.id}@afk`,
      sequence: v.ical_sequence,
      start,
      end: endExclusive,
      allDay: true,
      summary,
      description,
      status: isCancelled
        ? ICalEventStatus.CANCELLED
        : isPending
          ? ICalEventStatus.TENTATIVE
          : ICalEventStatus.CONFIRMED,
      busystatus: isCancelled
        ? ICalEventBusyStatus.FREE
        : isPending
          ? ICalEventBusyStatus.TENTATIVE
          : ICalEventBusyStatus.OOF,
      transparency:
        isCancelled || isPending ? ICalEventTransparency.TRANSPARENT : ICalEventTransparency.OPAQUE,
    });
  }
  const headers = new Headers({
    "Content-Type": "text/calendar; charset=utf-8",
    // 15 min matches the TTL hint above. Calendar clients poll on their own
    // schedule; this just protects against accidental tight polling.
    "Cache-Control": "private, max-age=900",
    "Content-Disposition": `attachment; filename="afk-${lookup.scope}.ics"`,
  });
  return new Response(cal.toString(), { headers });
});

function buildPrivateDescription(
  v: { internal_desc: string; public_desc: string; partial_amount: number | null },
  categoryName: string | null,
): string {
  const lines: string[] = [];
  if (categoryName) lines.push(`Category: ${categoryName}`);
  if (v.partial_amount != null) lines.push(`Partial day: ${v.partial_amount}`);
  if (v.public_desc) lines.push(`Public: ${v.public_desc}`);
  if (v.internal_desc) lines.push(`Notes: ${v.internal_desc}`);
  return lines.join("\n");
}
