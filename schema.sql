PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stan',
  provider_order_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_order_id)
);

CREATE INDEX IF NOT EXISTS idx_purchases_email_status_created
  ON purchases(email, status, created_at DESC);

CREATE TABLE IF NOT EXISTS practices (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  questions_asked INTEGER NOT NULL DEFAULT 0 CHECK (questions_asked BETWEEN 0 AND 13),
  result_json TEXT,
  processing_token TEXT,
  processing_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_practices_email_status_updated
  ON practices(email, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (practice_id) REFERENCES practices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_practice ON sessions(practice_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  practice_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (practice_id) REFERENCES practices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_practice_id
  ON messages(practice_id, id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
