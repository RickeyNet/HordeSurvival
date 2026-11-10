// Horde Survival global leaderboard API (Cloudflare Worker + D1).
//
//   POST /scores   { playerId, score, wave, elapsed, name?, daily? }  -> standing
//   POST /name     { playerId, name }                                 -> { name }
//   GET  /rank?player=<id>                                            -> standing
//   GET  /leaderboard?board=all|week|day&player=<id>&limit=20         -> { board, top, me, total, endsAt? }
//
//   standing = { name, all: { best, rank, total }, week: { id, endsAt, best, rank, total }, day: { same as week } }
//
// There are three boards: all-time bests, bests for the current week (weeks
// start Monday 00:00 UTC), and the daily challenge: bests for the current UTC
// day, counting only runs of that day's challenge (the app marks those with
// `daily`, the day number). A challenge run counts for the other two boards
// as well. A scheduled run clears out weeks and days that are over.
//
// There is no admin endpoint. Removing an entry (and banning its player id)
// is done from the command line: see scripts/remove-score.js.
//
// Players are anonymous: the app makes up a random id on first launch and the
// server derives a display name from it. A player can pick another name, but
// only one built from the word lists below, so nothing personal is ever sent
// and there are no user-typed names to moderate. No IP addresses are stored.

const WAVE_LEN = 18; // must match game/core.js
const ID_RE = /^[0-9a-f]{32}$/;
const COOLDOWN_MS = 5000;
const MAX_LIMIT = 100;
const MAX_BODY = 512; // bytes; a real submission is about 100
// Longest run accepted, in seconds. Two hours is wave 400, far past anything
// an honest run reaches, and it caps a forged score at 25 * 7200 + 100 =
// 180,100 (the old 24-hour cap let about 2 million through).
export const MAX_ELAPSED = 7200;

// ---------- Weeks ----------
const WEEK_MS = 7 * 86_400_000;
const WEEK_OFFSET = 4 * 86_400_000; // 1970-01-05 was a Monday
export const weekOf = (ms) => Math.floor((ms - WEEK_OFFSET) / WEEK_MS);
export const weekEnd = (week) => (week + 1) * WEEK_MS + WEEK_OFFSET;

// ---------- Days (the daily challenge) ----------
const DAY_MS = 86_400_000;
export const dayOf = (ms) => Math.floor(ms / DAY_MS); // must match game/core.js
export const dayEnd = (day) => (day + 1) * DAY_MS;
// A challenge run that ends just after midnight still counts for the day it
// was started on. No run is longer than MAX_ELAPSED, so that is the limit.
const DAY_GRACE_MS = MAX_ELAPSED * 1000;
// The day a run submitted as `daily` counts for, or null if that day is over.
function challengeDay(daily, now) {
  const today = dayOf(now);
  if (daily === today) return today;
  return daily === today - 1 && now - today * DAY_MS <= DAY_GRACE_MS ? daily : null;
}

// ---------- Anonymous names ----------
// The app shows the same two lists in its name picker: keep them in step
// with BridgeHordeApp/names.js (a test compares them).
export const ADJECTIVES = [
  "Swift", "Brave", "Silent", "Lucky", "Clever", "Mighty", "Rapid", "Steady",
  "Bold", "Fierce", "Quiet", "Sharp", "Wild", "Calm", "Iron", "Golden",
  "Shadow", "Storm", "Frost", "Ember", "Rusty", "Nimble", "Gritty", "Daring",
];
export const ANIMALS = [
  "Otter", "Falcon", "Badger", "Wolf", "Fox", "Hawk", "Bear", "Lynx",
  "Raven", "Moose", "Bison", "Cobra", "Panda", "Tiger", "Gecko", "Heron",
  "Owl", "Shark", "Yak", "Puma", "Viper", "Mole", "Crane", "Ferret",
];
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
export function nameFor(id) {
  const h = fnv1a(id);
  return ADJECTIVES[h % ADJECTIVES.length] + ANIMALS[(h >>> 8) % ANIMALS.length] + ((h >>> 16) % 1000);
}
// A chosen name must be one the lists can make: adjective, animal, 0-999.
const NAME_RE = /^([A-Z][a-z]+)([A-Z][a-z]+)(0|[1-9]\d{0,2})$/;
export function validName(name) {
  if (typeof name !== "string") return false;
  const m = NAME_RE.exec(name);
  return !!m && ADJECTIVES.includes(m[1]) && ANIMALS.includes(m[2]);
}

// ---------- Plausibility (cheap anti-cheat) ----------
// The fastest possible scoring late in a run is roughly 13 points/second
// (dense spawns plus bosses), so 25/s + a small allowance is generous for
// honest players while rejecting obviously forged scores. Boss scores grow
// with every boss cycle, which pushes the real ceiling towards 25/s near
// MAX_ELAPSED: raise the rate here if MAX_ELAPSED is ever raised.
export function plausible({ score, wave, elapsed }) {
  if (!Number.isInteger(score) || score <= 0) return false;
  if (!Number.isInteger(wave) || wave < 1) return false;
  if (typeof elapsed !== "number" || !(elapsed > 0) || elapsed > MAX_ELAPSED) return false;
  const expectedWave = 1 + Math.floor(elapsed / WAVE_LEN);
  if (Math.abs(wave - expectedWave) > 1) return false;
  return score <= 25 * elapsed + 100;
}

// ---------- Helpers ----------
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// Read a small JSON body: at most MAX_BODY bytes, whatever content-length claims.
async function readJson(request) {
  const tooLarge = { error: json({ error: "too large" }, 413) };
  if (Number(request.headers.get("content-length")) > MAX_BODY) return tooLarge;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return tooLarge;
    return { body: JSON.parse(raw) || {} };
  } catch {
    return { error: json({ error: "bad json" }, 400) };
  }
}

// The boards that start over: one period (a week, a day) of a table that
// holds a row per period and player. `key` is the current period.
const periodBoard = {
  week: (now) => ({ table: "weekly", col: "week", key: weekOf(now), endsAt: weekEnd(weekOf(now)) }),
  day: (now) => ({ table: "daily", col: "day", key: dayOf(now), endsAt: dayEnd(dayOf(now)) }),
};

// Where a best score stands on a board (period = null for the all-time
// board). Standard competition ranking: equal scores share a rank. No score,
// no rank.
async function place(db, period, best) {
  const count = "SELECT COUNT(*) AS total, COALESCE(SUM(best > ?1), 0) AS above FROM ";
  const row = await (period === null
    ? db.prepare(count + "players").bind(best ?? null)
    : db.prepare(count + `${period.table} WHERE ${period.col} = ?2`).bind(best ?? null, period.key)
  ).first();
  return { best: best ?? 0, rank: best == null ? null : row.above + 1, total: row.total };
}

async function standing(db, playerId, now) {
  const week = periodBoard.week(now), day = periodBoard.day(now);
  // Every accepted run makes a players row, so a player with a weekly or
  // daily best always has one to join from.
  const row = await db.prepare(
    `SELECT p.name, p.best, w.best AS week_best, d.best AS day_best FROM players p
     LEFT JOIN weekly w ON w.id = p.id AND w.week = ?2
     LEFT JOIN daily d ON d.id = p.id AND d.day = ?3 WHERE p.id = ?1`
  ).bind(playerId, week.key, day.key).first();
  return {
    name: row ? row.name : nameFor(playerId),
    all: await place(db, null, row?.best),
    week: { id: week.key, endsAt: week.endsAt, ...(await place(db, week, row?.week_best)) },
    day: { id: day.key, endsAt: day.endsAt, ...(await place(db, day, row?.day_best)) },
  };
}

// ---------- Handlers ----------
async function submit(request, env) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const { playerId, score, wave, elapsed, name, daily } = body;
  if (typeof playerId !== "string" || !ID_RE.test(playerId)) return json({ error: "bad player id" }, 400);
  if (name !== undefined && !validName(name)) return json({ error: "bad name" }, 400);
  if (daily !== undefined && !Number.isInteger(daily)) return json({ error: "bad day" }, 400);
  if (!plausible({ score, wave, elapsed })) return json({ error: "rejected" }, 422);

  const now = Date.now();
  const existing = await env.DB.prepare("SELECT best, last_submit FROM players WHERE id = ?").bind(playerId).first();
  if (existing && now - existing.last_submit < COOLDOWN_MS) return json({ error: "too many requests" }, 429);

  // One statement, so two submissions racing each other can neither fail on
  // the insert nor leave the lower score as the best. A banned id inserts
  // nothing, so no row comes back. A chosen name (?6) replaces the stored one.
  const row = await env.DB.prepare(
    `INSERT INTO players (id, name, best, wave, updated_at, last_submit)
     SELECT ?1, ?2, ?3, ?4, ?5, ?5 WHERE NOT EXISTS (SELECT 1 FROM banned WHERE id = ?1)
     ON CONFLICT (id) DO UPDATE SET
       name = COALESCE(?6, name),
       wave = CASE WHEN excluded.best > best THEN excluded.wave ELSE wave END,
       updated_at = CASE WHEN excluded.best > best THEN excluded.updated_at ELSE updated_at END,
       best = MAX(best, excluded.best),
       last_submit = excluded.last_submit
     RETURNING best`
  ).bind(playerId, name ?? nameFor(playerId), score, wave, now, name ?? null).first();
  if (!row) return json({ error: "banned" }, 403);

  // The same run also counts for the week it arrives in.
  await env.DB.prepare(
    `INSERT INTO weekly (week, id, best, wave, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (week, id) DO UPDATE SET
       wave = CASE WHEN excluded.best > best THEN excluded.wave ELSE wave END,
       updated_at = CASE WHEN excluded.best > best THEN excluded.updated_at ELSE updated_at END,
       best = MAX(best, excluded.best)`
  ).bind(weekOf(now), playerId, score, wave, now).run();

  // A daily challenge run also counts for its day. One that arrives after
  // that day's board has closed is still a run like any other, so it keeps
  // its place on the two boards above.
  const day = daily === undefined ? null : challengeDay(daily, now);
  if (day !== null) {
    await env.DB.prepare(
      `INSERT INTO daily (day, id, best, wave, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (day, id) DO UPDATE SET
         wave = CASE WHEN excluded.best > best THEN excluded.wave ELSE wave END,
         updated_at = CASE WHEN excluded.best > best THEN excluded.updated_at ELSE updated_at END,
         best = MAX(best, excluded.best)`
    ).bind(day, playerId, score, wave, now).run();
  }

  return json(await standing(env.DB, playerId, now));
}

// Change the name on an existing entry. A player without one has nothing to
// update: the app sends the chosen name along with their first score instead.
async function rename(request, env) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const { playerId, name } = body;
  if (typeof playerId !== "string" || !ID_RE.test(playerId)) return json({ error: "bad player id" }, 400);
  if (!validName(name)) return json({ error: "bad name" }, 400);
  await env.DB.prepare("UPDATE players SET name = ? WHERE id = ?").bind(name, playerId).run();
  return json({ name });
}

async function rank(url, env) {
  const player = url.searchParams.get("player");
  if (!player || !ID_RE.test(player)) return json({ error: "bad player id" }, 400);
  return json(await standing(env.DB, player, Date.now()));
}

async function leaderboard(url, env) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 20));
  const which = url.searchParams.get("board");
  const period = Object.hasOwn(periodBoard, which) ? periodBoard[which](Date.now()) : null;
  const player = url.searchParams.get("player");
  const id = player && ID_RE.test(player) ? player : null;

  const { results } = await (period === null
    ? env.DB.prepare("SELECT id, name, best, wave FROM players ORDER BY best DESC, updated_at ASC LIMIT ?").bind(limit)
    : env.DB.prepare(
        `SELECT b.id, p.name, b.best, b.wave FROM ${period.table} b JOIN players p ON p.id = b.id
         WHERE b.${period.col} = ? ORDER BY b.best DESC, b.updated_at ASC LIMIT ?`
      ).bind(period.key, limit)
  ).all();

  // Standard competition ranking: equal scores share a rank. The asking
  // player's own row is marked, since names are not unique.
  let prev = null, rank = 0;
  const top = results.map((r, i) => {
    if (r.best !== prev) rank = i + 1;
    prev = r.best;
    const row = { rank, name: r.name, score: r.best, wave: r.wave };
    if (r.id === id) row.you = true;
    return row;
  });

  const mine = !id ? null : await (period === null
    ? env.DB.prepare("SELECT name, best, wave FROM players WHERE id = ?").bind(id)
    : env.DB.prepare(
        `SELECT p.name, b.best, b.wave FROM players p
         LEFT JOIN ${period.table} b ON b.id = p.id AND b.${period.col} = ?2 WHERE p.id = ?1`
      ).bind(id, period.key)
  ).first();
  const placed = await place(env.DB, period, mine?.best);
  const me = id && { name: mine ? mine.name : nameFor(id), score: placed.best, wave: mine?.wave ?? 0, rank: placed.rank };

  const body = { board: period === null ? "all" : which, top, me, total: placed.total };
  if (period !== null) body.endsAt = period.endsAt;
  return json(body);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/scores") return await submit(request, env);
      if (request.method === "POST" && url.pathname === "/name") return await rename(request, env);
      if (request.method === "GET" && url.pathname === "/rank") return await rank(url, env);
      if (request.method === "GET" && url.pathname === "/leaderboard") return await leaderboard(url, env);
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "server error" }, 500);
    }
  },

  // Cron (see wrangler.jsonc): drop weekly and daily rows from weeks and days
  // that are over, keeping the one that just ended.
  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.prepare("DELETE FROM weekly WHERE week < ?").bind(weekOf(now) - 1).run();
    await env.DB.prepare("DELETE FROM daily WHERE day < ?").bind(dayOf(now) - 1).run();
  },
};
