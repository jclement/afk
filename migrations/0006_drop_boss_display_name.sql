-- Drop the boss display name column. Was added in 0005 thinking we might
-- want a friendly salutation; turned out not to need it. Boss is identified
-- by email address everywhere — the user's own display_name is what shows
-- up in the manager's calendar event subject (we never address the boss
-- by name in the body).
ALTER TABLE boss_relationships DROP COLUMN boss_display_name;
