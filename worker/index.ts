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

import authRoutes from "./routes/auth.js";
import categoryRoutes from "./routes/categories.js";
import vacationRoutes from "./routes/vacations.js";
import passkeyRoutes from "./routes/passkeys.js";
import meRoutes from "./routes/me.js";
import emailVerifyRoutes from "./routes/email-verify.js";
import { feedApi, tokensApi } from "./routes/ical.js";
import pdfRoutes from "./routes/pdf.js";

const app = new Hono<HonoVars>();

app.use("*", logger());
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
app.route("/ical", feedApi);
app.route("/verify-email", emailVerifyRoutes);

// API 404 fallback (the SPA handles non-/api 404s).
app.all("/api/*", (c) => err(c, "NOT_FOUND", "API route not found."));

export default {
  fetch: app.fetch,
  // Daily housekeeping — drop expired sessions and email-verification tokens
  // so D1 doesn't accumulate dead rows forever. Wired up via [triggers] in
  // wrangler.toml.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      Promise.all([purgeExpiredSessions(env.DB), purgeExpiredEmailVerifications(env.DB)]).then(
        () => undefined,
      ),
    );
  },
} satisfies ExportedHandler<HonoVars["Bindings"]>;
