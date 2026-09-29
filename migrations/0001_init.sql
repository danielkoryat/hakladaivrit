-- Accounts are created by "Sign in with Google".
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  google_sub TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,           -- SHA-256 of the cookie value
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT,
  label TEXT,
  wpm REAL, acc REAL, cpm REAL, secs REAL,
  errors INTEGER, chars INTEGER,
  lesson_id INTEGER, stars INTEGER
);
CREATE INDEX IF NOT EXISTS results_user_at ON results(user_id, at);
CREATE INDEX IF NOT EXISTS results_at ON results(at);

CREATE TABLE IF NOT EXISTS key_stats (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ch TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  time_ms INTEGER NOT NULL DEFAULT 0,
  timed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, ch)
);

CREATE TABLE IF NOT EXISTS word_errors (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, word)
);

CREATE TABLE IF NOT EXISTS lessons (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  wpm INTEGER NOT NULL,
  acc INTEGER NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS pbs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  wpm INTEGER NOT NULL,
  PRIMARY KEY (user_id, mode)
);
