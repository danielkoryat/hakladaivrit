-- Game progress (XP, streak days, badges) and leaderboard settings, one row per user.
CREATE TABLE IF NOT EXISTS user_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',        -- JSON: { xp, days, badges, best, texts, chars, bestStreak }
  xp INTEGER NOT NULL DEFAULT 0,          -- copy of data.xp for the XP leaderboard
  nickname TEXT,                          -- name shown on the leaderboard (default: first name + initial)
  show_on_board INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_state_xp ON user_state(xp);

-- Balloon game rounds, for the game leaderboard.
CREATE TABLE IF NOT EXISTS game_scores (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  score INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS game_scores_at ON game_scores(at);

-- Leaderboard of typing tests.
CREATE INDEX IF NOT EXISTS results_kind_at ON results(kind, at);
