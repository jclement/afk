/**
 * Recovery code management — generate / regenerate / status. The
 * recovery-code login path lives in routes/auth.ts (it's a login-time flow,
 * not a logged-in management one).
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { ok } from "../lib/responses.js";
import { getRecoveryCodesStatus, regenerateRecoveryCodes } from "../lib/recovery.js";

const r = new Hono<HonoVars>();
r.use("*", requireAuth);

r.get("/", async (c) => {
  const user = authedUser(c);
  return ok(c, await getRecoveryCodesStatus(c.env.DB, user.id));
});

/**
 * Generate (or regenerate) the user's recovery codes. Returns the plaintext
 * codes ONCE — they're hashed before storage and unrecoverable afterwards.
 * Regeneration invalidates every previously-issued code.
 */
r.post("/regenerate", async (c) => {
  const user = authedUser(c);
  const codes = await regenerateRecoveryCodes(c.env.DB, user.id);
  return ok(c, { codes });
});

export default r;
