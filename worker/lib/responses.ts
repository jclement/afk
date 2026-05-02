/**
 * Standard JSON response helpers. Every API response uses one of these so
 * the envelope shape stays consistent: `{ data: ... }` or `{ error: { ... } }`.
 */

import type { Context } from "hono";

export function ok<T>(c: Context, data: T, status: 200 | 201 = 200) {
  return c.json({ data }, status);
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

const STATUS_BY_CODE: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function err(c: Context, code: ErrorCode, message: string) {
  return c.json({ error: { message, code } }, STATUS_BY_CODE[code]);
}

/**
 * Parse a JSON request body, returning `{}` on any parse error rather than
 * letting the SyntaxError bubble up as a generic 500. Use this for any
 * route that reads `c.req.json()` — a malformed body should be a 400 from
 * the route's own validation, not a confusing internal error.
 */
export async function readJson<T>(c: Context): Promise<Partial<T>> {
  try {
    return ((await c.req.json<T>()) ?? {}) as Partial<T>;
  } catch {
    return {} as Partial<T>;
  }
}
