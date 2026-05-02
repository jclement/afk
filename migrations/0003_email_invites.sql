-- Email + calendar-invite plumbing.
--
-- Each user can attach a single email address and (after verifying it) will
-- receive iCalendar invites for their vacations: METHOD:REQUEST when a
-- vacation is booked or updated, METHOD:CANCEL when one is cancelled or
-- deleted. The vacation row carries an `ical_sequence` counter that we bump
-- on every change so receiving calendars apply updates in the right order.

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- Pending verifications. A user gets one row per outstanding token; resending
-- replaces the previous row. Verifying clears all pending rows for that user.
CREATE TABLE email_verifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_verifications_user ON email_verifications(user_id);
CREATE INDEX idx_email_verifications_token ON email_verifications(token);

ALTER TABLE vacations ADD COLUMN ical_sequence INTEGER NOT NULL DEFAULT 0;
