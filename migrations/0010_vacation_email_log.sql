-- Per-vacation email delivery log.
--
-- Each row records ONE attempt to send a vacation-related email — the
-- automatic lifecycle sends (create / update / cancel / uncancel / delete)
-- AND the manual /resend endpoint both write here. Lets the UI answer
-- "did the boss actually get it?" and lets a future support flow tell the
-- user when Mailgun bounced.
--
-- We DON'T store the rendered body — too much data, and the body is
-- reproducible from the vacation row + the lifecycle. We DO store the
-- Mailgun message id (when one was returned) so a support ticket can
-- correlate against Mailgun's logs.
--
-- Cascades: a deleted vacation drops its log entries (no point keeping
-- send records for rows the user already removed); deleting the user
-- cascades through `vacations` and gets us here too.
CREATE TABLE vacation_email_log (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vacation_id          TEXT NOT NULL REFERENCES vacations(id) ON DELETE CASCADE,
  -- Who we tried to send to. Logical recipient, not the literal address —
  -- 'self' means the user's own inbox; 'boss' means the consented manager.
  recipient            TEXT NOT NULL CHECK (recipient IN ('self', 'boss')),
  -- What kind of message this was. 'lifecycle' is the user-side iCal
  -- (PUBLISH/CANCEL) that goes to the user. 'notify_invite' is the boss-
  -- side iCal in notify mode (also covers the approval-mode CANCEL fan-out
  -- to a boss who already approved). 'approval_request' is the magic-link
  -- email that goes to the boss in approval mode when a vacation enters
  -- pending. Keeping the kinds distinct so the support view can read
  -- meaningfully and the future "last sent {kind}" UI doesn't have to
  -- guess.
  kind                 TEXT NOT NULL CHECK (kind IN ('lifecycle', 'notify_invite', 'approval_request')),
  -- iCalendar METHOD for the calendar-bearing kinds (lifecycle,
  -- notify_invite). NULL for approval_request (no .ics attachment).
  method               TEXT CHECK (method IN ('PUBLISH', 'CANCEL')),
  -- Was this triggered by the user clicking "Resend" (TRUE) or by the
  -- automatic lifecycle path (FALSE). Drives a "manually resent" badge.
  resend               INTEGER NOT NULL DEFAULT 0,
  -- Mailgun's message id when it returned 2xx. NULL on skip (no API key
  -- configured — local dev / pre-deploy) or on error. Format is opaque
  -- to us; we just store the string.
  mailgun_message_id   TEXT,
  -- Captured error message when the send threw. NULL on success. We don't
  -- store a stack trace — just the human-readable bit. Capped at 500 chars
  -- by the writer to keep this from growing unboundedly on a bad day.
  error                TEXT,
  sent_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vacation_email_log_vacation ON vacation_email_log(vacation_id, sent_at DESC);
CREATE INDEX idx_vacation_email_log_user ON vacation_email_log(user_id, sent_at DESC);
