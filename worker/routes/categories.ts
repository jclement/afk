/**
 * Category + allowance routes. Year-scoped allowances live under a category.
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok } from "../lib/responses.js";
import {
  createCategory,
  deleteCategory,
  listAllowances,
  listCategories,
  updateCategory,
  upsertAllowance,
} from "../lib/store.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

r.get("/", async (c) => {
  const user = authedUser(c);
  const cats = await listCategories(c.env.DB, user.id);
  return ok(c, cats);
});

r.post("/", async (c) => {
  const user = authedUser(c);
  const body = await c.req.json<{
    name?: string;
    accrues?: boolean;
    color?: string;
  }>();
  const name = sanitiseCategoryName(body.name ?? "");
  if (!name || name.length > 60) {
    return err(c, "VALIDATION_ERROR", "Name is required (max 60 chars).");
  }
  if (body.color && !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
    return err(c, "VALIDATION_ERROR", "Color must be hex like #2563eb.");
  }
  try {
    const created = await createCategory(c.env.DB, user.id, {
      name,
      accrues: !!body.accrues,
      color: body.color,
    });
    return ok(c, created, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("UNIQUE")) {
      return err(c, "CONFLICT", "A category with that name already exists.");
    }
    throw e;
  }
});

r.patch("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    accrues?: boolean;
    color?: string;
    archived?: boolean;
    sort_order?: number;
  }>();
  if (body.color && !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
    return err(c, "VALIDATION_ERROR", "Color must be hex like #2563eb.");
  }
  if (body.name !== undefined) {
    const sanitised = sanitiseCategoryName(body.name);
    if (!sanitised || sanitised.length > 60) {
      return err(c, "VALIDATION_ERROR", "Name is required (max 60 chars).");
    }
    body.name = sanitised;
  }
  if (body.sort_order !== undefined) {
    if (!Number.isInteger(body.sort_order) || body.sort_order < 0 || body.sort_order > 10000) {
      return err(c, "VALIDATION_ERROR", "sort_order must be a non-negative integer.");
    }
  }
  const updated = await updateCategory(c.env.DB, user.id, id, body);
  if (!updated) return err(c, "NOT_FOUND", "Category not found.");
  return ok(c, updated);
});

/**
 * Trim and strip control characters from a category name. The name flows
 * into iCal SUMMARY, email Subject, and the PDF header — control chars
 * (CR/LF/etc.) would corrupt iCal parsing or inject email headers.
 */
function sanitiseCategoryName(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]+/g, " ").trim();
}

r.delete("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const result = await deleteCategory(c.env.DB, user.id, id);
  if (!result.deleted) {
    return err(c, "CONFLICT", result.reason ?? "Cannot delete category.");
  }
  return ok(c, { deleted: true });
});

// Allowances are listed nested under a year, but mutations are by category.

r.get("/allowances/:year{[0-9]+}", async (c) => {
  const user = authedUser(c);
  const year = Number(c.req.param("year"));
  const rows = await listAllowances(c.env.DB, user.id, year);
  return ok(c, rows);
});

r.put("/allowances/:year{[0-9]+}/:categoryId", async (c) => {
  const user = authedUser(c);
  const year = Number(c.req.param("year"));
  const categoryId = c.req.param("categoryId");
  const body = await c.req.json<{
    days_allotted?: number;
    days_carryover?: number;
    notes?: string | null;
  }>();
  const days_allotted = Number(body.days_allotted ?? 0);
  const days_carryover = Number(body.days_carryover ?? 0);
  if (
    !isFinite(days_allotted) ||
    !isFinite(days_carryover) ||
    days_allotted < 0 ||
    days_allotted > 366 ||
    days_carryover < 0 ||
    days_carryover > 366
  ) {
    return err(c, "VALIDATION_ERROR", "days_allotted and days_carryover must be 0..366.");
  }
  try {
    const allowance = await upsertAllowance(c.env.DB, user.id, {
      category_id: categoryId,
      year,
      days_allotted,
      days_carryover,
      notes: body.notes ?? null,
    });
    return ok(c, allowance);
  } catch (e) {
    return err(c, "VALIDATION_ERROR", (e as Error).message);
  }
});

export default r;
