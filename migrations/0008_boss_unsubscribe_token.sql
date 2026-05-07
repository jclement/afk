-- Per-relationship unsubscribe token for one-click manager opt-out (RFC 8058
-- List-Unsubscribe-Post). Long-lived: the manager should be able to revoke
-- at any time from any past email. Rotated when the relationship is
-- re-pointed (email or mode change) so a previously-known address can't
-- revoke a newly-pointed relationship.
--
-- 64-char hex (32 bytes) — same shape as the consent / decision tokens, so
-- the format-gate regex is shared.

ALTER TABLE boss_relationships ADD COLUMN unsubscribe_token TEXT;

-- Backfill any pre-existing rows. SQLite's randomblob+hex gives us 64-char
-- hex without leaving the database. New rows get their token from the
-- application layer (see upsertBoss) so this is one-shot.
UPDATE boss_relationships
   SET unsubscribe_token = lower(hex(randomblob(32)))
 WHERE unsubscribe_token IS NULL;

-- Partial unique index — same pattern as the consent token. Lets us look up
-- a relationship by token in one query without indexing the (eventually)
-- nullable column.
CREATE UNIQUE INDEX idx_boss_unsubscribe_token
  ON boss_relationships(unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;
