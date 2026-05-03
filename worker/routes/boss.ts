/**
 * Boss / approver management — the user-facing API. The boss is opt-in;
 * everything here requires auth and only ever touches the requesting user's
 * single boss row (one boss per user).
 *
 *   GET    /api/v1/boss                  — current boss + consent state
 *   PUT    /api/v1/boss                  — set / replace boss + send consent
 *   POST   /api/v1/boss/resend-consent   — re-issue + re-send the link
 *   DELETE /api/v1/boss                  — remove the relationship entirely
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok, readJson } from "../lib/responses.js";
import { deleteBoss, getBoss, reissueConsentToken, upsertBoss } from "../lib/boss-store.js";
import { sendBossConsentEmail } from "../lib/boss-emails.js";
import type { BossMode } from "../../shared/types.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

function validEmail(s: string): boolean {
  // Same shape used elsewhere — letters/digits/etc. + @ + domain. Mailgun
  // is the real validator at send time.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

r.get("/", async (c) => {
  const user = authedUser(c);
  const boss = await getBoss(c.env.DB, user.id);
  return ok(c, boss);
});

/**
 * Idempotent set/replace. If the email or mode changed, consent is reset
 * and a fresh link goes out. If nothing meaningful changed (only display
 * name), the consent state is preserved.
 */
r.put("/", async (c) => {
  const user = authedUser(c);
  const body = await readJson<{
    boss_email?: string;
    mode?: BossMode;
  }>(c);
  const email = (body.boss_email ?? "").trim().toLowerCase();
  const mode = body.mode;
  if (!validEmail(email)) {
    return err(c, "VALIDATION_ERROR", "Boss email looks invalid.");
  }
  if (mode !== "notify" && mode !== "approval") {
    return err(c, "VALIDATION_ERROR", "Mode must be 'notify' or 'approval'.");
  }
  if (!user.email || !user.email_verified_at) {
    // Without a verified user email there's no return address — and the
    // boss flow leans on email throughout. Surface the requirement clearly
    // rather than silently no-op the consent send.
    return err(
      c,
      "VALIDATION_ERROR",
      "Verify your own email before adding a boss — they'll be replying to you, not us.",
    );
  }
  if (email === user.email.toLowerCase()) {
    // Self-as-boss would let the user approve their own time off (in approval
    // mode) and creates from/to-the-same-address loops in notify mode. Block
    // it cleanly rather than try to handle a degenerate case.
    return err(
      c,
      "VALIDATION_ERROR",
      "That's your own email — pick someone else as your approver.",
    );
  }
  const result = await upsertBoss(c.env.DB, user.id, {
    boss_email: email,
    mode,
  });

  // Only fire the consent email when we actually minted a token (i.e. the
  // email or mode changed, or this is a brand-new boss row). Display-name
  // edits keep the existing consent state and shouldn't spam.
  if (result.consent_token) {
    const origin = new URL(c.req.url).origin;
    c.executionCtx.waitUntil(
      sendBossConsentEmail({
        env: c.env,
        appOrigin: origin,
        user,
        boss: result.boss,
        consentToken: result.consent_token,
      }).catch((e) => console.error("[boss] consent send failed", e)),
    );
  }
  return ok(c, result.boss);
});

r.post("/resend-consent", async (c) => {
  const user = authedUser(c);
  const reissued = await reissueConsentToken(c.env.DB, user.id);
  if (!reissued) {
    return err(
      c,
      "VALIDATION_ERROR",
      "Nothing to resend — your boss has either already consented or you haven't added one.",
    );
  }
  const origin = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    sendBossConsentEmail({
      env: c.env,
      appOrigin: origin,
      user,
      boss: reissued.boss,
      consentToken: reissued.consent_token,
    }).catch((e) => console.error("[boss] consent resend failed", e)),
  );
  return ok(c, reissued.boss);
});

r.delete("/", async (c) => {
  const user = authedUser(c);
  await deleteBoss(c.env.DB, user.id);
  return ok(c, { deleted: true });
});

export default r;
