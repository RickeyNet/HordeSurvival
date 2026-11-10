-- Best run per player per week, for the weekly board. Weeks start on Monday
-- 00:00 UTC. The display name comes from the players table.
CREATE TABLE weekly (
  week        INTEGER NOT NULL,      -- weeks since Monday 1970-01-05 UTC
  id          TEXT NOT NULL,         -- player id, as in players
  best        INTEGER NOT NULL,      -- best score that week
  wave        INTEGER NOT NULL,      -- wave reached on that run
  updated_at  INTEGER NOT NULL,      -- ms epoch when best was set (earlier wins ties)
  PRIMARY KEY (week, id)
);

CREATE INDEX weekly_best ON weekly (week, best DESC, updated_at ASC);
