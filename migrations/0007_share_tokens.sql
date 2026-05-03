-- Read-only dashboard share links.
--
-- A "share token" is a cryptographically random URL the user mints and hands
-- to a manager / spouse / accountability buddy so they can view (but not
-- edit) the dashboard. No account on the recipient side; the URL token IS
-- the auth.
--
-- scope:
--   current-year — only the year the link is opened in (server resolves
--                  via the user's timezone). Defaults to "what's relevant
--                  right now."
--   all-years    — full history, the visitor can year-pick.
--
-- The recipient never sees `internal_desc` (private notes) regardless of
-- scope; the public-API handler strips it before responding. Cancelled
-- vacations are also filtered out — the share link mirrors what the
-- *current* state of things is, not the audit log.

CREATE TABLE share_tokens (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL,
  scope          TEXT NOT NULL CHECK(scope IN ('current-year','all-years')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_viewed_at TEXT
);
CREATE INDEX idx_share_tokens_user ON share_tokens(user_id);
