-- Per-user IANA timezone. Drives "what year is it?" / "today's date" /
-- accrual fraction calculations so the dashboard doesn't roll over to next
-- year at 4 pm Pacific just because UTC has.
--
-- Defaults to UTC on existing rows; new accounts ship with whatever the
-- browser reports at signup (Intl.DateTimeFormat().resolvedOptions().timeZone).
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
