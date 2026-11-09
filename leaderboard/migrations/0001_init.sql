-- One row per anonymous player (per app install), holding their best run.
CREATE TABLE players (
  id          TEXT PRIMARY KEY,      -- random 32-hex id generated on the device
  name        TEXT NOT NULL,         -- server-generated, e.g. "SwiftOtter482"
  best        INTEGER NOT NULL,      -- best score
  wave        INTEGER NOT NULL,      -- wave reached on the best run
  updated_at  INTEGER NOT NULL,      -- ms epoch when best was set (earlier wins ties)
  last_submit INTEGER NOT NULL       -- ms epoch of last accepted submission (rate limit)
);

CREATE INDEX players_best ON players (best DESC, updated_at ASC);
