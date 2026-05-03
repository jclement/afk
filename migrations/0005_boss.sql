-- Boss / approver relationships.
--
-- A boss has no AFK account. The trust anchor is their email address; consent
-- is proven by clicking the link we send them. Each (user, boss_email) pair
-- is its own consent — bosses don't carry consent across users.
--
-- Two modes (the user picks, per relationship):
--   notify    — the boss gets a copy of every vacation iCal invite as soon
--               as the user creates/updates one. No approval gate.
--   approval  — the user's vacation goes in as `pending`. The boss gets an
--               approval-request email with a magic link to a one-page
--               approve/reject form. Calendar invites only fire on approval.

CREATE TABLE boss_relationships (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  boss_email               TEXT NOT NULL,
  boss_display_name        TEXT NOT NULL,
  mode                     TEXT NOT NULL CHECK(mode IN ('notify','approval')),
  -- Consent token: minted on insert/email-change, cleared (set NULL) once
  -- the boss accepts. Re-minted by /resend-consent.
  consent_token            TEXT,
  consent_token_expires_at TEXT,
  consented_at             TEXT,
  -- Set when the boss uses the unsubscribe footer in any email. Future
  -- emails skip a relationship with revoked_at IS NOT NULL.
  revoked_at               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, boss_email)
);
CREATE INDEX idx_boss_relationships_user ON boss_relationships(user_id);
-- Partial unique index: lets us look up a relationship by an active consent
-- token in one query, without indexing the (eventually) thousands of NULLs.
CREATE UNIQUE INDEX idx_boss_consent_token
  ON boss_relationships(consent_token)
  WHERE consent_token IS NOT NULL;


-- Per (boss, vacation) approval request. Only created when the boss is in
-- approval mode AND the user books/edits a vacation. The decision_token is
-- the magic link the boss clicks; cleared after the decision so it can't be
-- replayed.
CREATE TABLE vacation_approvals (
  id                        TEXT PRIMARY KEY,
  vacation_id               TEXT NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
  boss_relationship_id      TEXT NOT NULL REFERENCES boss_relationships(id) ON DELETE CASCADE,
  state                     TEXT NOT NULL CHECK(state IN ('pending','approved','rejected')),
  decision_token            TEXT,
  decision_token_expires_at TEXT,
  decided_at                TEXT,
  decision_comment          TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vacation_id, boss_relationship_id)
);
CREATE INDEX idx_vacation_approvals_vacation ON vacation_approvals(vacation_id);
CREATE UNIQUE INDEX idx_vacation_approval_token
  ON vacation_approvals(decision_token)
  WHERE decision_token IS NOT NULL;


-- Denormalised onto vacations so the dashboard's year-summary stays a single
-- read. NULL = no approval needed (user has no boss in approval mode at the
-- moment the vacation was booked). Otherwise mirrors vacation_approvals.state.
ALTER TABLE vacations ADD COLUMN approval_state TEXT;
