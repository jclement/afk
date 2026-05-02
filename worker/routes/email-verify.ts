/**
 * Public route for email verification. Hits this when the user clicks the
 * link from the "Verify your email" message; we look up the token, mark
 * the email verified, and redirect them to /settings with a status flag the
 * frontend renders as a banner.
 *
 * Kept separate from /api/v1/me because that subtree is auth-required, and
 * verification has to work even if the user clicks the link on a different
 * device where they aren't signed in.
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { verifyEmailToken } from "../lib/users.js";

const r = new Hono<HonoVars>();

r.get("/:token", async (c) => {
  const token = c.req.param("token");
  const user = await verifyEmailToken(c.env.DB, token);
  const base = new URL(c.req.url).origin;
  if (!user) {
    return c.redirect(`${base}/settings?email=invalid`, 302);
  }
  return c.redirect(`${base}/settings?email=verified`, 302);
});

export default r;
