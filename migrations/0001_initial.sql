-- AFK initial schema.
--
-- Stores users, WebAuthn credentials, sessions, vacation categories,
-- per-year allowances, vacation entries and per-feed iCal tokens.
--
-- Date columns are ISO 8601 TEXT. Booleans are INTEGER (0/1).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE credentials (
  id              TEXT PRIMARY KEY,           -- credential id (base64url)
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key      TEXT NOT NULL,              -- base64url-encoded COSE key
  counter         INTEGER NOT NULL DEFAULT 0,
  transports      TEXT,                       -- JSON array
  device_type     TEXT,                       -- 'singleDevice' | 'multiDevice'
  backed_up       INTEGER NOT NULL DEFAULT 0,
  nickname        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at    TEXT
);
CREATE INDEX idx_credentials_user ON credentials(user_id);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,              -- session token (random hex)
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent   TEXT,
  ip_address   TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Vacation categories — per-user, e.g. "Vacation" (weeks), "Flex" (days).
CREATE TABLE categories (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  unit           TEXT NOT NULL DEFAULT 'days', -- 'days' | 'weeks'
  color          TEXT NOT NULL,                -- hex like '#2563eb'
  sort_order     INTEGER NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);
CREATE INDEX idx_categories_user ON categories(user_id);

-- Allowance for a (category, year). Stored in days for accounting purposes
-- regardless of category unit; the UI converts to weeks for display when
-- the category unit is 'weeks'. Carryover is also days.
CREATE TABLE allowances (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id    TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  year           INTEGER NOT NULL,
  days_allotted  REAL NOT NULL DEFAULT 0,
  days_carryover REAL NOT NULL DEFAULT 0,
  notes          TEXT,
  UNIQUE (category_id, year)
);
CREATE INDEX idx_allowances_user_year ON allowances(user_id, year);

-- Vacation entries. Either a multi-day full-day block (start..end inclusive,
-- partial_amount NULL), a full single day (start=end, partial_amount NULL),
-- or a partial single day (start=end, partial_amount in (0,1]).
CREATE TABLE vacations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id     TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  start_date      TEXT NOT NULL,                -- ISO date 'YYYY-MM-DD'
  end_date        TEXT NOT NULL,                -- ISO date 'YYYY-MM-DD'
  partial_amount  REAL,                         -- NULL or fraction of a day
  public_desc     TEXT NOT NULL DEFAULT '',
  internal_desc   TEXT NOT NULL DEFAULT '',
  cancelled_at    TEXT,                         -- soft-delete (also nukes from feeds)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vacations_user ON vacations(user_id);
CREATE INDEX idx_vacations_dates ON vacations(user_id, start_date, end_date);

-- iCal feed tokens. Each user has up to two tokens — a 'private' token (full
-- details, internal description) and a 'public' token (only public_desc).
-- Tokens are random hex; revoking just deletes the row and rotates.
CREATE TABLE ical_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  scope       TEXT NOT NULL,                  -- 'private' | 'public'
  label       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  UNIQUE (user_id, scope, label)
);
CREATE INDEX idx_ical_tokens_token ON ical_tokens(token);
