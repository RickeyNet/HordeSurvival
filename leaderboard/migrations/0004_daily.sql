-- Best daily challenge run per player per day, for the daily board. Days are
-- UTC days. Only runs of that day's challenge are counted here. The display
-- name comes from the players table.
CREATE TABLE daily (
  day         INTEGER NOT NULL,      -- days since 1970-01-01 UTC
  id          TEXT NOT NULL,         -- player id, as in players
  best        INTEGER NOT NULL,      -- best challenge score that day
  wave        INTEGER NOT NULL,      -- wave reached on that run
  updated_at  INTEGER NOT NULL,      -- ms epoch when best was set (earlier wins ties)
  PRIMARY KEY (day, id)
);

CREATE INDEX daily_best ON daily (day, best DESC, updated_at ASC);
