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

import type { HonoVars } from "./types.js";
import { err, ok } from "./lib/responses.js";

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
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
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
} satisfies ExportedHandler<HonoVars["Bindings"]>;
