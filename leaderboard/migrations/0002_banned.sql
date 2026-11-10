-- Player ids that may no longer post scores (forged entries that were removed).
-- Only the random id is kept, the same one the players table would hold.
CREATE TABLE banned (
  id         TEXT PRIMARY KEY,       -- random 32-hex player id
  banned_at  INTEGER NOT NULL        -- ms epoch
);
