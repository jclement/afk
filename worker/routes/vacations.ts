/**
 * Vacation entry routes. Provides list-by-year, create, update, cancel,
 * and the year summary used by the dashboard.
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok } from "../lib/responses.js";
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
import type { Allowance } from "../../shared/types.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

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
  const body = await c.req.json<{
    category_id?: string;
    start_date?: string;
    end_date?: string;
    partial_amount?: number | null;
    public_desc?: string;
    internal_desc?: string;
  }>();
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
  const public_desc = (body.public_desc ?? "").slice(0, 200);
  const internal_desc = (body.internal_desc ?? "").slice(0, 1000);
  try {
    const created = await createVacation(c.env.DB, user.id, {
      category_id,
      start_date,
      end_date,
      partial_amount,
      public_desc,
      internal_desc,
    });
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

  const body = await c.req.json<{
    category_id?: string;
    start_date?: string;
    end_date?: string;
    partial_amount?: number | null;
    public_desc?: string;
    internal_desc?: string;
  }>();
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
        ? { public_desc: body.public_desc.slice(0, 200) }
        : {}),
      ...(body.internal_desc !== undefined
        ? { internal_desc: body.internal_desc.slice(0, 1000) }
        : {}),
    });
    return ok(c, updated);
  } catch (e) {
    return err(c, "VALIDATION_ERROR", (e as Error).message);
  }
});

r.post("/:id/cancel", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const updated = await cancelVacation(c.env.DB, user.id, id);
  if (!updated) return err(c, "NOT_FOUND", "Vacation not found.");
  return ok(c, updated);
});

r.post("/:id/uncancel", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const updated = await uncancelVacation(c.env.DB, user.id, id);
  if (!updated) return err(c, "NOT_FOUND", "Vacation not found.");
  return ok(c, updated);
});

r.delete("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const ok2 = await deleteVacation(c.env.DB, user.id, id);
  if (!ok2) return err(c, "NOT_FOUND", "Vacation not found.");
  return ok(c, { deleted: true });
});

export default r;
