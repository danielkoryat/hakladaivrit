-- Activity log for the admin page: what each visitor did, day by day.
-- A visitor is one browser, identified by a random id in the "vid" cookie. When a visitor signs
-- in, user_id links the browser (and everything it did before) to the account.
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  referrer TEXT,                -- where the first visit came from
  country TEXT, city TEXT,      -- latest, from Cloudflare
  device TEXT, browser TEXT, os TEXT, lang TEXT
);
CREATE INDEX IF NOT EXISTS visitors_user ON visitors(user_id);

-- One row per action: page view, start / finish / abandon of a session, sign-in, share…
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- signed in at the time
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  path TEXT,
  data TEXT                     -- JSON details (speed, accuracy, score…)
);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE INDEX IF NOT EXISTS events_visitor_at ON events(visitor_id, at);
CREATE INDEX IF NOT EXISTS events_user_at ON events(user_id, at);
