-- Drop the per-category "unit" (days/weeks) display preference. Everything
-- is denominated in days now. Existing days_allotted / days_carryover values
-- are already in days, so no data conversion is needed.
ALTER TABLE categories DROP COLUMN unit;

-- Categories that accrue spread their allotment across the calendar year:
-- on March 31, an accruing 20-day allowance has 5 days "available". Carryover
-- is always available up front; only days_allotted accrues.
ALTER TABLE categories ADD COLUMN accrues INTEGER NOT NULL DEFAULT 0;
