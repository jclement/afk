/**
 * /me — endpoints for managing the signed-in user's own profile fields.
 * Currently just email + verification.
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok } from "../lib/responses.js";
import {
  clearUserEmail,
  deleteUserAndAllData,
  markWelcomeCompleted,
  reissueEmailToken,
  setUserDisplayName,
  setUserTimezone,
  startEmailChange,
} from "../lib/users.js";
import { AuthError, finishAuthentication } from "../lib/passkeys.js";
import { updateCredentialCounter } from "../lib/store.js";
import { clearSessionCookie } from "../lib/sessions.js";
import { sendPlainEmail } from "../lib/mailgun.js";
import {
  button,
  escapeHtml,
  lead,
  linkFallback,
  muted,
  paragraph,
  renderEmail,
} from "../lib/email-template.js";
import {
  listAllAllowances,
  listAllVacations,
  listCategories,
  listShareTokens,
} from "../lib/store.js";
import { getBoss, listAllApprovalsForUser } from "../lib/boss-store.js";
import { buildJsonExport, buildVacationsCsv, exportFilename } from "../lib/export.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

r.patch("/email", async (c) => {
  const user = authedUser(c);
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return err(c, "VALIDATION_ERROR", "Email is required.");

  let token: string;
  try {
    const t = await startEmailChange(c.env.DB, user.id, email);
    token = t.token;
  } catch (e) {
    return err(c, "VALIDATION_ERROR", (e as Error).message);
  }

  const origin = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    sendVerificationEmail(c.env, origin, email, token).catch((e) =>
      console.error("[me] verification send failed:", (e as Error).message),
    ),
  );
  return ok(c, { email, verified: false });
});

r.post("/email/resend", async (c) => {
  const user = authedUser(c);
  const reissued = await reissueEmailToken(c.env.DB, user.id);
  if (!reissued) {
    return err(c, "VALIDATION_ERROR", "No pending verification — set or change your email first.");
  }
  const origin = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    sendVerificationEmail(c.env, origin, reissued.email, reissued.token).catch((e) =>
      console.error("[me] verification resend failed:", (e as Error).message),
    ),
  );
  return ok(c, { email: reissued.email, verified: false });
});

r.delete("/email", async (c) => {
  const user = authedUser(c);
  await clearUserEmail(c.env.DB, user.id);
  return ok(c, { email: null, verified: false });
});

r.patch("/display-name", async (c) => {
  const user = authedUser(c);
  const body = await c.req
    .json<{ display_name?: string }>()
    .catch(() => ({}) as { display_name?: string });
  try {
    const updated = await setUserDisplayName(c.env.DB, user.id, body.display_name ?? "");
    if (!updated) return err(c, "NOT_FOUND", "User not found.");
    return ok(c, { display_name: updated.display_name });
  } catch (e) {
    return err(c, "VALIDATION_ERROR", (e as Error).message);
  }
});

r.post("/welcome-completed", async (c) => {
  const user = authedUser(c);
  const updated = await markWelcomeCompleted(c.env.DB, user.id);
  if (!updated) return err(c, "NOT_FOUND", "User not found.");
  return ok(c, updated);
});

/**
 * DELETE /api/v1/me/account — irreversibly delete the user's account and
 * every row tied to it.
 *
 * Two confirmations:
 *   1. A fresh passkey assertion (the same WebAuthn dance as login). The
 *      client first calls POST /api/v1/auth/login/start with the user's own
 *      username to mint a flow_id+challenge, runs the ceremony, then ships
 *      `{ flow_id, response, confirm }` here. The credential MUST belong to
 *      the currently-authenticated user — guards against a stolen-cookie
 *      attacker (who has the cookie but no passkey) deleting the account.
 *   2. The literal phrase "DELETE MY ACCOUNT" typed verbatim. Stops "I
 *      didn't mean to click that" mistakes that a passkey tap couldn't
 *      catch.
 *
 * After deletion the session cookie is cleared and the response is 200 with
 * `{ deleted: true }` — the client should redirect to the login screen.
 */
r.delete("/account", async (c) => {
  const user = authedUser(c);
  const body = await c.req
    .json<{ flow_id?: string; response?: unknown; confirm?: string }>()
    .catch(() => ({}) as { flow_id?: string; response?: unknown; confirm?: string });
  if (body.confirm !== "DELETE MY ACCOUNT") {
    return err(c, "VALIDATION_ERROR", "Type DELETE MY ACCOUNT exactly to confirm.");
  }
  if (!body.flow_id || !body.response) {
    return err(c, "VALIDATION_ERROR", "Passkey reauthentication required.");
  }
  // Re-authenticate via WebAuthn. Throws AuthError on bad assertion.
  let result;
  try {
    const url = new URL(c.req.url);
    result = await finishAuthentication(
      c.env.KV,
      c.env.DB,
      { rpID: url.hostname, rpName: c.env.RP_NAME, origin: `${url.protocol}//${url.host}` },
      body.flow_id,
      body.response as never,
    );
  } catch (e) {
    if (e instanceof AuthError) return err(c, e.code, e.message);
    console.error("[me/account] reauth failed", e);
    return err(c, "INTERNAL_ERROR", "Reauthentication failed.");
  }
  // The credential MUST belong to the currently-authenticated user. A
  // sibling user's valid passkey would otherwise let one account delete
  // another via this endpoint.
  if (result.user_id !== user.id) {
    return err(c, "FORBIDDEN", "Passkey does not belong to this account.");
  }
  await updateCredentialCounter(c.env.DB, result.credential_id, result.new_counter);
  await deleteUserAndAllData(c.env.DB, user.id);
  clearSessionCookie(c);
  return ok(c, { deleted: true });
});

r.patch("/timezone", async (c) => {
  const user = authedUser(c);
  const body = await c.req.json<{ timezone?: string }>().catch(() => ({}) as { timezone?: string });
  const timezone = (body.timezone ?? "").trim();
  if (!timezone) return err(c, "VALIDATION_ERROR", "timezone is required.");
  try {
    const updated = await setUserTimezone(c.env.DB, user.id, timezone);
    if (!updated) return err(c, "NOT_FOUND", "User not found.");
    return ok(c, { timezone: updated.timezone });
  } catch (e) {
    return err(c, "VALIDATION_ERROR", (e as Error).message);
  }
});

// ---------------------------------------------------------------------------
// Data export — "give me everything you've got on me." Two formats:
//   - export.json  → full machine-readable dump (every user-owned table)
//   - export.csv   → flat vacations-with-category-info, spreadsheet-friendly
//
// Both endpoints serve only the requesting user's data (scoped via user.id
// in every store call). See worker/lib/export.ts for the schema contract.
// ---------------------------------------------------------------------------
r.get("/export.json", async (c) => {
  const user = authedUser(c);
  const [categories, allowances, vacations, boss, vacationApprovals, shareTokens] =
    await Promise.all([
      listCategories(c.env.DB, user.id),
      listAllAllowances(c.env.DB, user.id),
      listAllVacations(c.env.DB, user.id),
      getBoss(c.env.DB, user.id),
      listAllApprovalsForUser(c.env.DB, user.id),
      listShareTokens(c.env.DB, user.id),
    ]);
  const payload = buildJsonExport({
    user,
    categories,
    allowances,
    vacations,
    boss,
    vacationApprovals,
    shareTokens,
    appVersion: c.env.APP_VERSION ?? "dev",
  });
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(user.username, "json")}"`,
      "Cache-Control": "no-store",
    },
  });
});

r.get("/export.csv", async (c) => {
  const user = authedUser(c);
  const [categories, vacations] = await Promise.all([
    listCategories(c.env.DB, user.id),
    listAllVacations(c.env.DB, user.id),
  ]);
  const csv = buildVacationsCsv({ categories, vacations });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(user.username, "csv")}"`,
      "Cache-Control": "no-store",
    },
  });
});

async function sendVerificationEmail(
  env: HonoVars["Bindings"],
  origin: string,
  email: string,
  token: string,
): Promise<void> {
  const url = `${origin}/verify-email/${token}`;
  const text = [
    "Hi —",
    "",
    "Click the link below to verify this email for AFK so you can start receiving",
    "calendar invites for your vacations:",
    "",
    url,
    "",
    "The link expires in 24 hours. If you didn't request this, ignore the email.",
    "",
    "— AFK",
  ].join("\n");

  const html = renderEmail({
    preheader: "Confirm your email so AFK can send vacation invites to your calendar.",
    heading: "Verify your email",
    accent: "brand",
    blocks: [
      lead(
        `Confirm <strong>${escapeHtml(email)}</strong> so AFK can send vacation invites straight to your calendar.`,
      ),
      button(url, "Verify email"),
      linkFallback(url),
      paragraph(`The link expires in 24 hours.`),
      muted(`If you didn't request this, you can safely ignore this email.`),
    ],
    footer: `Sent by AFK · <a href="${escapeHtml(origin)}" style="color:inherit;">${escapeHtml(origin)}</a>`,
  });

  await sendPlainEmail(env, {
    to: email,
    subject: "Verify your email for AFK",
    text,
    html,
  });
}

export default r;
