-- How many players hold each best score, per board, so a view can work out a
-- rank and the size of a board without reading one row per player.
--
-- Each board is counted at two levels: level 0 has a row per exact score,
-- level 1 a row per block of 256 scores (bucket = score >> 8). A rank is the
-- sum of the level 1 rows above the player's block plus the level 0 rows
-- above the player's score inside that block. The top score the Worker lets
-- through is 180,100, so that is at most 704 + 255 rows however many players
-- there are.
--
-- The triggers below keep the counts in step with every change to the three
-- score tables, whoever makes it: the Worker, the scheduled clean-up or
-- scripts/remove-score.js. Rows that have dropped to 0 are left in place:
-- their number has the same upper limit.
CREATE TABLE score_counts (
  board   TEXT NOT NULL,             -- 'all', 'week' or 'day'
  period  INTEGER NOT NULL,          -- the week or day; 0 for 'all'
  level   INTEGER NOT NULL,          -- 0: exact score, 1: block of 256 scores
  bucket  INTEGER NOT NULL,          -- the score (level 0) or score >> 8 (level 1)
  n       INTEGER NOT NULL,          -- players whose best is in this bucket
  PRIMARY KEY (board, period, level, bucket)
) WITHOUT ROWID;

-- Count what is already there.
INSERT INTO score_counts (board, period, level, bucket, n)
  SELECT 'all', 0, 0, best, COUNT(*) FROM players GROUP BY 1, 2, 3, 4;
INSERT INTO score_counts (board, period, level, bucket, n)
  SELECT 'all', 0, 1, best >> 8, COUNT(*) FROM players GROUP BY 1, 2, 3, 4;
INSERT INTO score_counts (board, period, level, bucket, n)
  SELECT 'week', week, 0, best, COUNT(*) FROM weekly GROUP BY 1, 2, 3, 4;
INSERT INTO score_counts (board, period, level, bucket, n)
  SELECT 'week', week, 1, best >> 8, COUNT(*) FROM weekly GROUP BY 1, 2, 3, 4;
INSERT INTO score_counts (board, period, level, bucket, n)
  SELECT 'day', day, 0, best, COUNT(*) FROM daily GROUP BY 1, 2, 3, 4;
INSERT INTO score_counts (board, period, level, bucket, n)
  SELECT 'day', day, 1, best >> 8, COUNT(*) FROM daily GROUP BY 1, 2, 3, 4;

-- players
CREATE TRIGGER players_count_insert AFTER INSERT ON players BEGIN
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('all', 0, 0, NEW.best, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('all', 0, 1, NEW.best >> 8, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER players_count_update AFTER UPDATE OF best ON players WHEN NEW.best <> OLD.best BEGIN
  UPDATE score_counts SET n = n - 1
    WHERE board = 'all' AND period = 0 AND level = 0 AND bucket = OLD.best;
  UPDATE score_counts SET n = n - 1
    WHERE board = 'all' AND period = 0 AND level = 1 AND bucket = OLD.best >> 8;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('all', 0, 0, NEW.best, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('all', 0, 1, NEW.best >> 8, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER players_count_delete AFTER DELETE ON players BEGIN
  UPDATE score_counts SET n = n - 1
    WHERE board = 'all' AND period = 0 AND level = 0 AND bucket = OLD.best;
  UPDATE score_counts SET n = n - 1
    WHERE board = 'all' AND period = 0 AND level = 1 AND bucket = OLD.best >> 8;
END;

-- weekly
CREATE TRIGGER weekly_count_insert AFTER INSERT ON weekly BEGIN
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('week', NEW.week, 0, NEW.best, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('week', NEW.week, 1, NEW.best >> 8, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER weekly_count_update AFTER UPDATE OF best ON weekly WHEN NEW.best <> OLD.best BEGIN
  UPDATE score_counts SET n = n - 1
    WHERE board = 'week' AND period = OLD.week AND level = 0 AND bucket = OLD.best;
  UPDATE score_counts SET n = n - 1
    WHERE board = 'week' AND period = OLD.week AND level = 1 AND bucket = OLD.best >> 8;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('week', NEW.week, 0, NEW.best, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('week', NEW.week, 1, NEW.best >> 8, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER weekly_count_delete AFTER DELETE ON weekly BEGIN
  UPDATE score_counts SET n = n - 1
    WHERE board = 'week' AND period = OLD.week AND level = 0 AND bucket = OLD.best;
  UPDATE score_counts SET n = n - 1
    WHERE board = 'week' AND period = OLD.week AND level = 1 AND bucket = OLD.best >> 8;
END;

-- daily
CREATE TRIGGER daily_count_insert AFTER INSERT ON daily BEGIN
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('day', NEW.day, 0, NEW.best, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('day', NEW.day, 1, NEW.best >> 8, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER daily_count_update AFTER UPDATE OF best ON daily WHEN NEW.best <> OLD.best BEGIN
  UPDATE score_counts SET n = n - 1
    WHERE board = 'day' AND period = OLD.day AND level = 0 AND bucket = OLD.best;
  UPDATE score_counts SET n = n - 1
    WHERE board = 'day' AND period = OLD.day AND level = 1 AND bucket = OLD.best >> 8;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('day', NEW.day, 0, NEW.best, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
  INSERT INTO score_counts (board, period, level, bucket, n) VALUES ('day', NEW.day, 1, NEW.best >> 8, 1)
    ON CONFLICT (board, period, level, bucket) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER daily_count_delete AFTER DELETE ON daily BEGIN
  UPDATE score_counts SET n = n - 1
    WHERE board = 'day' AND period = OLD.day AND level = 0 AND bucket = OLD.best;
  UPDATE score_counts SET n = n - 1
    WHERE board = 'day' AND period = OLD.day AND level = 1 AND bucket = OLD.best >> 8;
END;
