/**
 * AFK worker entry point.
 *
 * Hono app mounted at the worker root. Responsibilities:
 *   - /api/v1/*      — REST API (auth, categories, vacations, passkeys, ical, pdf)
 *   - /ical/:token   — public-facing iCal feeds (token-authenticated)
 *   - /api/v1/health — unauthenticated health probe
 *
 * The Cloudflare Vite plugin handles the React SPA in dev. In production,
 * the static assets are served by the [assets] binding and any non-API
 * URL falls through to the SPA via `not_found_handling = "single-page-application"`.
 */

import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";

import type { HonoVars } from "./types.js";
import { err, ok } from "./lib/responses.js";
import { purgeExpiredSessions } from "./lib/sessions.js";
import { purgeExpiredEmailVerifications } from "./lib/users.js";
import { purgeExpiredBossTokens } from "./lib/boss-store.js";

import authRoutes from "./routes/auth.js";
import categoryRoutes from "./routes/categories.js";
import vacationRoutes from "./routes/vacations.js";
import passkeyRoutes from "./routes/passkeys.js";
import meRoutes from "./routes/me.js";
import emailVerifyRoutes from "./routes/email-verify.js";
import { feedApi, tokensApi } from "./routes/ical.js";
import pdfRoutes from "./routes/pdf.js";
import bossRoutes from "./routes/boss.js";
import bossPublicRoutes from "./routes/boss-public.js";
import { sharePublicApi, shareTokensApi } from "./routes/share.js";
import recoveryRoutes from "./routes/recovery.js";

const app = new Hono<HonoVars>();

// Request logger — but redact paths that carry secrets in the URL. The
// hono `logger()` middleware emits the raw path, which would leak boss
// consent/decision tokens and email-verification tokens into wrangler tail
// (and from there to anyone with logs access). We swap the path with a
// redacted form for the duration of the log call only.
app.use(
  "*",
  logger((message: string, ...rest: unknown[]) => {
    const redacted = message
      .replace(/\/boss\/(consent|approve|unsubscribe)\/[0-9a-f]+/g, "/boss/$1/<redacted>")
      .replace(/\/verify-email\/[0-9a-f]+/g, "/verify-email/<redacted>")
      .replace(/\/ical\/[0-9a-f]+/g, "/ical/<redacted>")
      .replace(/\/api\/v1\/share\/[0-9a-f]+/g, "/api/v1/share/<redacted>")
      .replace(/\/share\/[0-9a-f]+/g, "/share/<redacted>");
    console.log(redacted, ...rest);
  }),
);
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    permissionsPolicy: {
      // Disable browser features the app has no use for. Locks down the page
      // so a future XSS or compromised dependency can't, e.g., grab the camera.
      accelerometer: [],
      camera: [],
      geolocation: [],
      gyroscope: [],
      magnetometer: [],
      microphone: [],
      midi: [],
      payment: [],
      usb: [],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
  }),
);

// Catch-all error handler so a thrown error doesn't leak a stack to the client.
app.onError((e, c) => {
  console.error("[unhandled]", e);
  return err(c, "INTERNAL_ERROR", "Server error.");
});

// Reject any request body larger than 64 KiB. The largest legitimate body is
// a WebAuthn assertion plus a vacation entry — both well under 8 KiB. Without
// this, an attacker could ship a multi-MB JSON to consume CPU.
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => err(c, "VALIDATION_ERROR", "Request body too large."),
  }),
);

// Health (no auth)
app.get("/api/v1/health", async (c) => {
  return ok(c, {
    status: "ok",
    version: c.env.APP_VERSION ?? "dev",
  });
});

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/categories", categoryRoutes);
app.route("/api/v1/vacations", vacationRoutes);
app.route("/api/v1/passkeys", passkeyRoutes);
app.route("/api/v1/me", meRoutes);
app.route("/api/v1/ical-tokens", tokensApi);
app.route("/api/v1/pdf", pdfRoutes);
app.route("/api/v1/boss", bossRoutes);
app.route("/api/v1/share-tokens", shareTokensApi);
app.route("/api/v1/share", sharePublicApi);
app.route("/api/v1/recovery-codes", recoveryRoutes);
app.route("/ical", feedApi);
app.route("/verify-email", emailVerifyRoutes);
// Public boss flow (consent + approve). HTML pages, no auth — magic link
// in the URL is the auth. Mounted outside /api/v1 because the boss has no
// AFK account; they're reaching us straight from their inbox.
app.route("/boss", bossPublicRoutes);

// API 404 fallback (the SPA handles non-/api 404s).
app.all("/api/*", (c) => err(c, "NOT_FOUND", "API route not found."));

export default {
  fetch: app.fetch,
  // Daily housekeeping — drop expired sessions and email-verification tokens
  // so D1 doesn't accumulate dead rows forever. Wired up via [triggers] in
  // wrangler.toml.
  //
  // Each task is wrapped so a single failure doesn't take down the others,
  // and start/end log lines leave breadcrumbs in `wrangler tail`. Without
  // these, a silently-broken cron leaves no trace until the symptom (D1
  // bloat, lingering invitations) shows up weeks later.
  async scheduled(_event, env, ctx) {
    const run = async (name: string, fn: () => Promise<unknown>) => {
      const t0 = Date.now();
      try {
        await fn();
        console.log(`[cron] ${name} ok in ${Date.now() - t0}ms`);
      } catch (e) {
        console.error(`[cron] ${name} failed in ${Date.now() - t0}ms`, e);
      }
    };
    ctx.waitUntil(
      Promise.allSettled([
        run("purgeExpiredSessions", () => purgeExpiredSessions(env.DB)),
        run("purgeExpiredEmailVerifications", () => purgeExpiredEmailVerifications(env.DB)),
        run("purgeExpiredBossTokens", () => purgeExpiredBossTokens(env.DB)),
      ]).then(() => undefined),
    );
  },
} satisfies ExportedHandler<HonoVars["Bindings"]>;
