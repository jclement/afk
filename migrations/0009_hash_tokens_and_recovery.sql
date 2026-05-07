-- Hash bearer tokens at rest + add recovery codes.
--
-- Security upgrade: every long-lived bearer token (session cookie, iCal feed
-- token, share dashboard token, email-verification token, boss consent /
-- decision / unsubscribe token, recovery code) is now stored as a SHA-256
-- hash. The plaintext exists only in the cookie / URL / email at the moment
-- of delivery; D1 never sees it.
--
-- We can't retroactively hash existing rows because we don't have the
-- plaintext to hash. Existing tokens are therefore invalidated:
--   - sessions: every user is logged out and must re-authenticate.
--   - email_verifications, boss consent/decision tokens: short-lived; users
--     re-request via the normal "Resend" flows.
--   - ical_tokens, share_tokens: long-lived. Users will need to recreate
--     these and update any calendar / shared link consumers.
--   - boss_relationships.unsubscribe_token: rotated lazily — the next email
--     send for that relationship rotates and re-mints. Until then,
--     unsubscribe links from previously-sent emails stop working; managers
--     can still revoke from a fresh email or by replying.
--
-- The column NAMES don't change — the values stored in those columns are
-- now hashes (64-char hex SHA-256) instead of plaintext.

DELETE FROM sessions;
DELETE FROM email_verifications;
DELETE FROM ical_tokens;
DELETE FROM share_tokens;

-- Consent + decision tokens are short-lived and single-use; users re-issue
-- naturally. Unsubscribe tokens stay plaintext (see boss-store.ts for the
-- rationale — they must work from any prior email and we can't rotate
-- without breaking old links).
UPDATE boss_relationships
   SET consent_token = NULL,
       consent_token_expires_at = NULL;

UPDATE vacation_approvals
   SET decision_token = NULL,
       decision_token_expires_at = NULL;

-- Recovery codes — 10 one-time codes per user, alternative to passkey login
-- if every passkey is lost. Stored as SHA-256 hash; plaintext is shown to
-- the user once at generation time. `used_at` marks consumption — codes are
-- never deleted on use so the user can see how many remain unused without
-- reissuing the whole batch.
--
-- Regenerating wipes all old codes and inserts a fresh 10. Account deletion
-- cascades.
CREATE TABLE recovery_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  used_at     TEXT
);
CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id);

-- First-run wizard tracking. NULL means the user hasn't completed the wizard
-- yet — they'll see it on their next login. Existing users get NULL too, so
-- they get a re-introduction tour the next time they sign in (and a chance
-- to generate recovery codes, which didn't exist before this migration).
ALTER TABLE users ADD COLUMN welcome_completed_at TEXT;
