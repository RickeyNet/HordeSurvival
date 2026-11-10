-- A daily cap on the new player ids one network address can add (see
-- "Limits per address" in src/index.js). The address itself is never stored.
--
-- ip_salt holds the random key of the day. ip_counts holds, per day, how many
-- new ids came from each bucket: 20 bits of HMAC(key of the day, address).
-- Thousands of addresses share a bucket, so a bucket cannot be turned back
-- into one address even with the key. Both tables only ever hold the current
-- day: the first submission of a day and the scheduled run delete the rest.
CREATE TABLE ip_salt (
  day   INTEGER PRIMARY KEY,         -- UTC day number
  salt  TEXT NOT NULL                -- 64 random hex characters
);

CREATE TABLE ip_counts (
  day     INTEGER NOT NULL,          -- UTC day number
  bucket  INTEGER NOT NULL,          -- 0 .. 2^20 - 1
  n       INTEGER NOT NULL,          -- new player ids from this bucket on this day
  PRIMARY KEY (day, bucket)
) WITHOUT ROWID;
