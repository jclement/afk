/**
 * Tiny fetch helper. Throws an Error with .code/.status for non-2xx
 * responses so React Query can surface them. Uses session cookies for
 * auth (`credentials: "include"`).
 */

import type { ApiData, ApiError } from "@shared/types";

export class APIError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // non-JSON response (PDFs etc.) — let the caller handle via fetch directly
    }
  }
  if (!res.ok) {
    const e = parsed as ApiError | null;
    throw new APIError(
      res.status,
      e?.error?.code ?? "INTERNAL_ERROR",
      e?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return ((parsed as ApiData<T> | null)?.data ?? (parsed as T));
}

export const API_BASE = "/api/v1";
