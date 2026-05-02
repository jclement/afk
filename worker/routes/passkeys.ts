/**
 * Passkey management — list, rename, delete.
 *
 * To register an additional passkey for the current account, the client
 * uses /api/v1/auth/register/start with the existing username and a fresh
 * nickname. The "you cannot delete your last passkey" rule lives here.
 */

import { Hono } from "hono";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err, ok } from "../lib/responses.js";
import {
  deletePasskey,
  listPasskeys,
  renamePasskey,
} from "../lib/store.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

r.get("/", async (c) => {
  const user = authedUser(c);
  return ok(c, await listPasskeys(c.env.DB, user.id));
});

r.patch("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const body = await c.req.json<{ nickname?: string }>();
  const nickname = (body.nickname ?? "").trim();
  if (!nickname || nickname.length > 60) {
    return err(c, "VALIDATION_ERROR", "Nickname is required (max 60 chars).");
  }
  const ok2 = await renamePasskey(c.env.DB, user.id, id, nickname);
  if (!ok2) return err(c, "NOT_FOUND", "Passkey not found.");
  return ok(c, { renamed: true });
});

r.delete("/:id", async (c) => {
  const user = authedUser(c);
  const id = c.req.param("id");
  const remaining = await listPasskeys(c.env.DB, user.id);
  if (remaining.length <= 1) {
    return err(
      c,
      "CONFLICT",
      "Refusing to delete your last passkey — register another one first.",
    );
  }
  const ok2 = await deletePasskey(c.env.DB, user.id, id);
  if (!ok2) return err(c, "NOT_FOUND", "Passkey not found.");
  return ok(c, { deleted: true });
});

export default r;
