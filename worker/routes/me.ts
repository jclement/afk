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
  reissueEmailToken,
  setUserTimezone,
  startEmailChange,
} from "../lib/users.js";
import { sendPlainEmail } from "../lib/mailgun.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

r.patch("/email", async (c) => {
  const user = authedUser(c);
  const body = await c.req
    .json<{ email?: string }>()
    .catch(() => ({}) as { email?: string });
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
    return err(
      c,
      "VALIDATION_ERROR",
      "No pending verification — set or change your email first.",
    );
  }
  const origin = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    sendVerificationEmail(c.env, origin, reissued.email, reissued.token).catch(
      (e) =>
        console.error(
          "[me] verification resend failed:",
          (e as Error).message,
        ),
    ),
  );
  return ok(c, { email: reissued.email, verified: false });
});

r.delete("/email", async (c) => {
  const user = authedUser(c);
  await clearUserEmail(c.env.DB, user.id);
  return ok(c, { email: null, verified: false });
});

r.patch("/timezone", async (c) => {
  const user = authedUser(c);
  const body = await c.req
    .json<{ timezone?: string }>()
    .catch(() => ({}) as { timezone?: string });
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

async function sendVerificationEmail(
  env: HonoVars["Bindings"],
  origin: string,
  email: string,
  token: string,
): Promise<void> {
  const url = `${origin}/verify-email/${token}`;
  await sendPlainEmail(env, {
    to: email,
    subject: "Verify your email for AFK",
    text: [
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
    ].join("\n"),
  });
}

export default r;
