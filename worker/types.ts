/**
 * Worker bindings & runtime types.
 *
 * Bindings are declared in wrangler.toml. The Cloudflare Vite plugin makes
 * them available as `env.<name>` inside Hono handlers via `c.env`.
 */

import type { D1Database, KVNamespace, Fetcher } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  // BROWSER is the Browser Rendering binding. Marked optional because the
  // local dev plugin doesn't always provide it; PDF endpoints check at
  // runtime and return a friendly 503 when unavailable.
  BROWSER?: BrowserBinding;
  RP_ID: string;
  RP_NAME: string;
  APP_ORIGIN: string;
  APP_VERSION?: string;
  SESSION_SECRET?: string;
  SUPPRESS_AUTH?: string;
}

// Cloudflare's Browser binding has a narrower type in the public types
// package; @cloudflare/puppeteer accepts an "any-ish" object. We declare
// just what we use.
export interface BrowserBinding {
  // Marker; @cloudflare/puppeteer.launch(env.BROWSER) accepts this.
  readonly fetcher: unknown;
}

export interface AuthContext {
  user: {
    id: string;
    username: string;
    display_name: string;
    role: "user" | "admin";
  };
  session_id: string | null; // null when SUPPRESS_AUTH is forging a dev user
}

// Hono context variables we set in middleware. Keys must match `c.set(...)`
// names. Hono picks these up automatically via the generic on `new Hono`.
export interface HonoVars {
  Variables: {
    auth: AuthContext;
  };
  Bindings: Env;
}
