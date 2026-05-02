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
import ical, { ICalCalendarMethod } from "ical-generator";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok } from "../lib/responses.js";
import {
  createICalToken,
  deleteICalToken,
  findUserByICalToken,
  listAllVacations,
  listCategories,
  listICalTokens,
} from "../lib/store.js";
import { getUser } from "../lib/users.js";
import { newICalToken } from "../lib/ids.js";
import { parseISODate } from "../../shared/vacation-math.js";

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
  const body = await c.req.json<{
    scope?: "private" | "public";
    label?: string;
  }>();
  const scope = body.scope;
  if (scope !== "private" && scope !== "public") {
    return err(c, "VALIDATION_ERROR", "Scope must be 'private' or 'public'.");
  }
  const label = (body.label ?? "").trim().slice(0, 60);
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

  const lookup = await findUserByICalToken(c.env.DB, token);
  if (!lookup) {
    return c.text("Calendar feed not found.", 404);
  }
  const user = await getUser(c.env.DB, lookup.user_id);
  if (!user) {
    return c.text("Calendar feed not found.", 404);
  }
  const cats = await listCategories(c.env.DB, user.id);
  const catsById = new Map(cats.map((cat) => [cat.id, cat]));
  const vacations = await listAllVacations(c.env.DB, user.id);

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
    method: ICalCalendarMethod.PUBLISH,
    prodId: { company: "AFK", product: "afk", language: "EN" },
  });

  for (const v of vacations) {
    if (v.cancelled_at) continue;
    const start = parseISODate(v.start_date);
    // iCal all-day events are end-exclusive — bump end by 1 day.
    const endInclusive = parseISODate(v.end_date);
    const endExclusive = new Date(endInclusive.getTime() + 86_400_000);
    const cat = catsById.get(v.category_id);
    const summary =
      lookup.scope === "private"
        ? `[${cat?.name ?? "AFK"}] ${v.public_desc || "Out of Office"}`
        : v.public_desc || "Out of Office";
    const description =
      lookup.scope === "private"
        ? buildPrivateDescription(v, cat?.name ?? null)
        : v.public_desc || "Out of Office";
    cal.createEvent({
      id: `${v.id}@afk`,
      start,
      end: endExclusive,
      allDay: true,
      summary,
      description,
    });
  }
  const headers = new Headers({
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "private, max-age=120",
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
