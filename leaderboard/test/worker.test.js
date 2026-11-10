// Tests for the leaderboard Worker. Run with `npm test` (Node 22.13 or newer).
// No install needed: the Worker runs against a small stand-in for D1 backed by
// Node's built-in SQLite, with the real migrations applied, so the SQL itself
// is under test.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { plausible, nameFor, validName, weekOf, weekEnd, dayOf, dayEnd, ADJECTIVES, ANIMALS, MAX_ELAPSED } from "../src/index.js";
import * as appNames from "../../BridgeHordeApp/names.js";
import * as core from "../../BridgeHordeApp/game/core.js";

// ---------- D1 stand-in ----------
const MIGRATIONS = new URL("../migrations/", import.meta.url);

function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  const statement = (text, args) => ({
    bind: (...next) => statement(text, next),
    first: async () => sqlite.prepare(text).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(text).all(...args) }),
    run: async () => void sqlite.prepare(text).run(...args),
  });
  return { prepare: (text) => statement(text, []), sqlite };
}

// ---------- Helpers ----------
const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);
const ID_C = "c".repeat(32);
const RUN = { score: 500, wave: 6, elapsed: 100 }; // wave 6 runs from 90s to 108s

let env;
let now;
beforeEach(() => {
  env = { DB: makeDb() };
  now = 1_800_000_000_000;
  mock.method(Date, "now", () => now);
});
afterEach(() => mock.restoreAll());

async function call(method, path, body) {
  const init = { method };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request("https://board.test" + path, init), env);
  return { status: res.status, body: await res.json() };
}
const submit = (playerId, run = RUN) => call("POST", "/scores", { playerId, ...run });
// Submit as a later request, past the per-player cooldown.
const submitLater = (playerId, run) => {
  now += 60_000;
  return submit(playerId, run);
};
const board = (query = "") => call("GET", "/leaderboard" + query);
const WEEK_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;
// A daily challenge run, marked with the day it was played on (today unless given).
const submitDaily = (playerId, run = RUN, daily = dayOf(now)) => submit(playerId, { ...run, daily });

// ---------- plausible ----------
test("plausible accepts honest runs", () => {
  assert.equal(plausible({ score: 1, wave: 1, elapsed: 3.5 }), true);
  assert.equal(plausible(RUN), true);
  assert.equal(plausible({ score: 9000, wave: 51, elapsed: 900 }), true); // 15 minutes at 10/s
});

test("plausible allows the wave to be one off either way", () => {
  // 100s is wave 6
  for (const wave of [5, 6, 7]) assert.equal(plausible({ ...RUN, wave }), true, "wave " + wave);
  for (const wave of [4, 8]) assert.equal(plausible({ ...RUN, wave }), false, "wave " + wave);
});

test("plausible rejects scores faster than 25 per second plus 100", () => {
  assert.equal(plausible({ score: 2600, wave: 6, elapsed: 100 }), true);
  assert.equal(plausible({ score: 2601, wave: 6, elapsed: 100 }), false);
});

test("plausible caps run length at MAX_ELAPSED", () => {
  const wave = 1 + Math.floor(MAX_ELAPSED / 18);
  assert.equal(plausible({ score: 1000, wave, elapsed: MAX_ELAPSED }), true);
  assert.equal(plausible({ score: 1000, wave, elapsed: MAX_ELAPSED + 0.1 }), false);
  // The highest score that can get through at all.
  assert.equal(plausible({ score: 180_100, wave, elapsed: MAX_ELAPSED }), true);
  assert.equal(plausible({ score: 180_101, wave, elapsed: MAX_ELAPSED }), false);
  // What the old 24-hour cap allowed.
  assert.equal(plausible({ score: 2_000_000, wave: 4801, elapsed: 86_400 }), false);
});

test("plausible rejects malformed values", () => {
  const bad = [
    { score: 0 }, { score: -5 }, { score: 10.5 }, { score: "500" }, { score: NaN }, { score: Infinity },
    { wave: 0 }, { wave: 6.5 }, { wave: "6" }, { wave: null },
    { elapsed: 0 }, { elapsed: -100 }, { elapsed: "100" }, { elapsed: NaN }, { elapsed: Infinity },
  ];
  for (const change of bad) assert.equal(plausible({ ...RUN, ...change }), false, JSON.stringify(change));
  assert.equal(plausible({}), false);
});

// ---------- names ----------
test("nameFor is stable and looks like AdjectiveAnimal123", () => {
  assert.equal(nameFor(ID_A), nameFor(ID_A));
  for (const id of [ID_A, ID_B, ID_C]) assert.match(nameFor(id), /^[A-Z][a-z]+[A-Z][a-z]+\d{1,3}$/);
});

// ---------- submit ----------
test("first submission stores the run and returns the player's standing", async () => {
  const res = await submit(ID_A);
  assert.equal(res.status, 200);
  const week = weekOf(now), day = dayOf(now);
  assert.deepEqual(res.body, {
    name: nameFor(ID_A),
    all: { best: 500, rank: 1, total: 1 },
    week: { id: week, endsAt: weekEnd(week), best: 500, rank: 1, total: 1 },
    day: { id: day, endsAt: dayEnd(day), best: 0, rank: null, total: 0 }, // not a challenge run
  });
  assert.deepEqual((await board()).body.top, [{ rank: 1, name: nameFor(ID_A), score: 500, wave: 6 }]);
});

test("a lower score keeps the old best and its wave", async () => {
  await submit(ID_A);
  const res = await submitLater(ID_A, { score: 200, wave: 3, elapsed: 40 });
  assert.equal(res.status, 200);
  assert.equal(res.body.all.best, 500);
  assert.deepEqual((await board()).body.top, [{ rank: 1, name: nameFor(ID_A), score: 500, wave: 6 }]);
});

test("a higher score replaces the best and its wave", async () => {
  await submit(ID_A);
  const res = await submitLater(ID_A, { score: 900, wave: 9, elapsed: 150 });
  assert.equal(res.body.all.best, 900);
  const { top, total } = (await board()).body;
  assert.deepEqual(top, [{ rank: 1, name: nameFor(ID_A), score: 900, wave: 9 }]);
  assert.equal(total, 1);
});

test("submissions inside the cooldown get 429, lower ones included", async () => {
  await submit(ID_A);
  now += 4999;
  assert.equal((await submit(ID_A, { score: 900, wave: 9, elapsed: 150 })).status, 429);
  now += 1;
  assert.equal((await submit(ID_A, { score: 900, wave: 9, elapsed: 150 })).status, 200);
  // The cooldown is per player.
  assert.equal((await submit(ID_B)).status, 200);
});

test("bad requests are refused and store nothing", async () => {
  assert.equal((await submit("not-an-id")).status, 400);
  assert.equal((await submit(ID_A.toUpperCase())).status, 400);
  assert.equal((await call("POST", "/scores", { ...RUN })).status, 400);
  assert.equal((await call("POST", "/scores", "{not json")).status, 400);
  assert.equal((await call("POST", "/scores", "null")).status, 400);
  assert.equal((await submit(ID_A, { score: 999_999, wave: 6, elapsed: 100 })).status, 422);
  assert.equal((await submit(ID_A, { score: 2_000_000, wave: 4801, elapsed: 86_400 })).status, 422);
  assert.equal((await call("POST", "/scores", { playerId: ID_A, ...RUN, pad: "x".repeat(600) })).status, 413);
  assert.equal((await board()).body.total, 0);
});

// ---------- bans ----------
test("a banned player id cannot post, and stays off the board", async () => {
  await submit(ID_A);
  await submit(ID_B, { score: 300, wave: 6, elapsed: 100 });
  // What scripts/remove-score.js --ban runs.
  env.DB.sqlite.exec(
    `INSERT OR IGNORE INTO banned (id, banned_at) VALUES ('${ID_A}', ${now});
     DELETE FROM players WHERE id = '${ID_A}'; DELETE FROM weekly WHERE id = '${ID_A}';
     DELETE FROM daily WHERE id = '${ID_A}'`
  );

  const res = await submitLater(ID_A, { score: 900, wave: 9, elapsed: 150 });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "banned" });

  const { top, total, me } = (await board("?player=" + ID_A)).body;
  assert.deepEqual(top, [{ rank: 1, name: nameFor(ID_B), score: 300, wave: 6 }]);
  assert.equal(total, 1);
  assert.equal(me.rank, null);
  assert.equal((await board("?board=week")).body.total, 1);
});

test("a ban does not affect other players", async () => {
  env.DB.sqlite.exec(`INSERT INTO banned (id, banned_at) VALUES ('${ID_A}', ${now})`);
  assert.equal((await submit(ID_B)).status, 200);
});

test("an entry removed without a ban can be posted again", async () => {
  await submit(ID_A);
  env.DB.sqlite.exec(`DELETE FROM players WHERE id = '${ID_A}'`);
  assert.equal((await submitLater(ID_A)).status, 200);
  assert.equal((await board()).body.total, 1);
});

// ---------- ranking ----------
test("the board is ordered by score, ties share a rank and the earlier one comes first", async () => {
  await submit(ID_A, { score: 300, wave: 6, elapsed: 100 });
  now += 1000;
  await submit(ID_B, { score: 800, wave: 6, elapsed: 100 });
  now += 1000;
  await submit(ID_C, { score: 300, wave: 6, elapsed: 100 });

  const { top, total } = (await board()).body;
  assert.equal(total, 3);
  assert.deepEqual(top.map((r) => [r.rank, r.name]), [
    [1, nameFor(ID_B)],
    [2, nameFor(ID_A)],
    [2, nameFor(ID_C)],
  ]);
});

test("submit returns the rank of the player's best", async () => {
  await submit(ID_A, { score: 800, wave: 6, elapsed: 100 });
  assert.equal((await submit(ID_B, { score: 300, wave: 6, elapsed: 100 })).body.all.rank, 2);
  const tied = (await submit(ID_C, { score: 300, wave: 6, elapsed: 100 })).body.all;
  assert.deepEqual(tied, { best: 300, rank: 2, total: 3 });
  assert.equal((await submitLater(ID_C, { score: 900, wave: 6, elapsed: 100 })).body.all.rank, 1);
});

test("me holds the asking player's own entry, also below the visible rows", async () => {
  await submit(ID_A, { score: 800, wave: 6, elapsed: 100 });
  await submit(ID_B, { score: 300, wave: 5, elapsed: 100 });

  const res = await board("?limit=1&player=" + ID_B);
  assert.equal(res.body.top.length, 1);
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.me, { name: nameFor(ID_B), score: 300, wave: 5, rank: 2 });
});

test("me is an empty entry for a player with no score, and null without a valid id", async () => {
  assert.deepEqual((await board("?player=" + ID_A)).body.me, { name: nameFor(ID_A), score: 0, wave: 0, rank: null });
  assert.equal((await board()).body.me, null);
  assert.equal((await board("?player=nope")).body.me, null);
});

test("limit defaults to 20 and is clamped to 1..100", async () => {
  const insert = env.DB.sqlite.prepare(
    "INSERT INTO players (id, name, best, wave, updated_at, last_submit) VALUES (?, ?, ?, 1, 0, 0)"
  );
  for (let i = 0; i < 120; i++) insert.run(i.toString(16).padStart(32, "0"), "P" + i, 1000 - i);

  const rows = async (query) => (await board(query)).body.top.length;
  assert.equal(await rows(""), 20);
  assert.equal(await rows("?limit=5"), 5);
  assert.equal(await rows("?limit=0"), 20);
  assert.equal(await rows("?limit=-3"), 1);
  assert.equal(await rows("?limit=abc"), 20);
  assert.equal(await rows("?limit=5000"), 100);
});

test("the asking player's row is marked, on every board", async () => {
  await submitDaily(ID_A, { score: 800, wave: 6, elapsed: 100 });
  await submitDaily(ID_B, { score: 300, wave: 6, elapsed: 100 });
  for (const which of ["all", "week", "day"]) {
    const { top } = (await board("?board=" + which + "&player=" + ID_B)).body;
    assert.deepEqual(top.map((r) => r.you), [undefined, true], which);
  }
});

// ---------- weekly board ----------
test("weeks start on Monday 00:00 UTC", () => {
  const monday = Date.UTC(2026, 10, 9); // Monday 9 November 2026
  assert.equal(weekOf(monday - 1) + 1, weekOf(monday));
  assert.equal(weekOf(monday + WEEK_MS - 1), weekOf(monday));
  assert.equal(weekEnd(weekOf(monday)), monday + WEEK_MS);
});

test("the weekly board holds this week's bests and starts empty the next week", async () => {
  await submit(ID_A, { score: 800, wave: 6, elapsed: 100 });
  await submit(ID_B, { score: 300, wave: 6, elapsed: 100 });
  let res = await board("?board=week&player=" + ID_B);
  assert.equal(res.body.board, "week");
  assert.equal(res.body.endsAt, weekEnd(weekOf(now)));
  assert.deepEqual(res.body.top.map((r) => [r.rank, r.name, r.score]), [
    [1, nameFor(ID_A), 800],
    [2, nameFor(ID_B), 300],
  ]);
  assert.deepEqual(res.body.me, { name: nameFor(ID_B), score: 300, wave: 6, rank: 2 });

  now += WEEK_MS;
  res = await board("?board=week&player=" + ID_B);
  assert.deepEqual(res.body.top, []);
  assert.equal(res.body.total, 0);
  assert.deepEqual(res.body.me, { name: nameFor(ID_B), score: 0, wave: 0, rank: null });
  // The all-time board is untouched.
  res = await board("?player=" + ID_B);
  assert.equal(res.body.board, "all");
  assert.equal(res.body.endsAt, undefined);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.me.rank, 2);
});

test("a run below the all-time best can still be the best of a new week", async () => {
  await submit(ID_A, { score: 800, wave: 6, elapsed: 100 });
  await submit(ID_B, { score: 600, wave: 6, elapsed: 100 });
  now += WEEK_MS;
  const res = await submit(ID_B, { score: 200, wave: 3, elapsed: 40 });
  assert.deepEqual(res.body.all, { best: 600, rank: 2, total: 2 });
  assert.deepEqual({ ...res.body.week, id: 0, endsAt: 0 }, { id: 0, endsAt: 0, best: 200, rank: 1, total: 1 });
  // Within the week, only a higher score replaces it.
  await submitLater(ID_B, { score: 100, wave: 3, elapsed: 40 });
  const better = await submitLater(ID_B, { score: 400, wave: 5, elapsed: 80 });
  assert.equal(better.body.week.best, 400);
  assert.deepEqual((await board("?board=week")).body.top, [{ rank: 1, name: nameFor(ID_B), score: 400, wave: 5 }]);
});

test("rank returns the standing without a submission", async () => {
  await submit(ID_A, { score: 800, wave: 6, elapsed: 100 });
  await submit(ID_B, { score: 300, wave: 6, elapsed: 100 });
  now += WEEK_MS;
  await submit(ID_C, { score: 100, wave: 3, elapsed: 40 });

  const week = weekOf(now), day = dayOf(now);
  assert.deepEqual((await call("GET", "/rank?player=" + ID_B)).body, {
    name: nameFor(ID_B),
    all: { best: 300, rank: 2, total: 3 },
    week: { id: week, endsAt: weekEnd(week), best: 0, rank: null, total: 1 },
    day: { id: day, endsAt: dayEnd(day), best: 0, rank: null, total: 0 },
  });
  // A player the server has never seen.
  const fresh = (await call("GET", "/rank?player=" + "d".repeat(32))).body;
  assert.deepEqual(fresh.all, { best: 0, rank: null, total: 3 });
  assert.equal(fresh.week.rank, null);
  assert.equal((await call("GET", "/rank")).status, 400);
  assert.equal((await call("GET", "/rank?player=nope")).status, 400);
});

test("the scheduled run drops finished weeks but keeps the last one", async () => {
  await submit(ID_A);
  now += WEEK_MS;
  await submit(ID_B);
  const weeks = () => env.DB.sqlite.prepare("SELECT week FROM weekly ORDER BY week").all().map((r) => r.week);

  await worker.scheduled({}, env);
  assert.equal(weeks().length, 2);
  now += WEEK_MS;
  await worker.scheduled({}, env);
  assert.deepEqual(weeks(), [weekOf(now) - 1]);
  assert.equal((await board()).body.total, 2); // all-time entries stay
});

// ---------- daily challenge board ----------
test("days are UTC days, counted the same way as in the game", () => {
  const midnight = Date.UTC(2026, 10, 9);
  assert.equal(dayOf(midnight - 1) + 1, dayOf(midnight));
  assert.equal(dayOf(midnight + DAY_MS - 1), dayOf(midnight));
  assert.equal(dayEnd(dayOf(midnight)), midnight + DAY_MS);
  for (const ms of [0, midnight - 1, midnight, now]) assert.equal(dayOf(ms), core.dayOf(ms));
});

test("only challenge runs are on the daily board; they count for the other boards too", async () => {
  await submit(ID_A, { score: 800, wave: 6, elapsed: 100 }); // an ordinary run
  const res = await submitDaily(ID_B, { score: 300, wave: 5, elapsed: 80 });
  assert.equal(res.status, 200);
  const day = dayOf(now);
  assert.deepEqual(res.body.day, { id: day, endsAt: dayEnd(day), best: 300, rank: 1, total: 1 });
  assert.deepEqual(res.body.all, { best: 300, rank: 2, total: 2 });
  assert.equal(res.body.week.best, 300);

  const today = (await board("?board=day&player=" + ID_B)).body;
  assert.equal(today.board, "day");
  assert.equal(today.endsAt, dayEnd(day));
  assert.equal(today.total, 1);
  assert.deepEqual(today.top, [{ rank: 1, name: nameFor(ID_B), score: 300, wave: 5, you: true }]);
  assert.deepEqual(today.me, { name: nameFor(ID_B), score: 300, wave: 5, rank: 1 });
  // A has an all-time entry but no challenge run today.
  assert.deepEqual((await board("?board=day&player=" + ID_A)).body.me, { name: nameFor(ID_A), score: 0, wave: 0, rank: null });
});

test("the daily board keeps each player's best challenge run of the day", async () => {
  await submitDaily(ID_A, { score: 300, wave: 5, elapsed: 80 });
  await submitDaily(ID_B, { score: 400, wave: 6, elapsed: 100 });
  now += 60_000;
  assert.equal((await submitDaily(ID_A, { score: 200, wave: 3, elapsed: 40 })).body.day.best, 300);
  // A better ordinary run moves the all-time best, not the challenge one.
  now += 60_000;
  const plain = (await submit(ID_A, { score: 900, wave: 9, elapsed: 150 })).body;
  assert.equal(plain.all.best, 900);
  assert.deepEqual({ best: plain.day.best, rank: plain.day.rank }, { best: 300, rank: 2 });
  now += 60_000;
  const better = (await submitDaily(ID_A, { score: 500, wave: 6, elapsed: 100 })).body;
  assert.deepEqual({ best: better.day.best, rank: better.day.rank, total: better.day.total }, { best: 500, rank: 1, total: 2 });
  assert.deepEqual((await board("?board=day")).body.top.map((r) => [r.rank, r.name, r.score, r.wave]), [
    [1, nameFor(ID_A), 500, 6],
    [2, nameFor(ID_B), 400, 6],
  ]);
});

test("the daily board starts empty the next day", async () => {
  await submitDaily(ID_A);
  now += DAY_MS;
  const res = (await board("?board=day&player=" + ID_A)).body;
  assert.deepEqual(res.top, []);
  assert.equal(res.total, 0);
  assert.equal(res.me.rank, null);
  assert.equal((await call("GET", "/rank?player=" + ID_A)).body.day.rank, null);
  assert.equal((await board()).body.total, 1); // the all-time entry stays
});

test("a challenge run that ends just after midnight counts for the day it was started", async () => {
  const midnight = dayEnd(dayOf(now));
  const yesterday = dayOf(now);
  const days = () => env.DB.sqlite.prepare("SELECT day, best FROM daily ORDER BY day").all().map((r) => [r.day, r.best]);

  now = midnight + MAX_ELAPSED * 1000; // the longest run there is, started at 23:59
  const late = await submitDaily(ID_A, RUN, yesterday);
  assert.equal(late.status, 200);
  assert.deepEqual(days(), [[yesterday, 500]]);
  assert.equal(late.body.day.id, yesterday + 1); // the standing is about today, where it has no run
  assert.equal(late.body.day.rank, null);

  // Past that, the old day is closed: the run still counts everywhere else.
  now += 1;
  const closed = await submitDaily(ID_B, RUN, yesterday);
  assert.equal(closed.status, 200);
  assert.equal(closed.body.all.best, 500);
  assert.equal(closed.body.week.best, 500);
  assert.deepEqual(days(), [[yesterday, 500]]);
});

test("a challenge run cannot be posted to another day, and the day must be a number", async () => {
  const today = dayOf(now);
  for (const day of [today + 1, today - 2, 0, -1]) {
    const res = await submitDaily(ID_A, RUN, day);
    assert.equal(res.status, 200, "day " + day);
    assert.equal(res.body.day.rank, null, "day " + day);
    now += 60_000;
  }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM daily").get().n, 0);
  for (const day of ["today", 1.5, null, true, [today]]) {
    assert.equal((await submitDaily(ID_B, RUN, day)).status, 400, JSON.stringify(day));
  }
  assert.equal((await board()).body.total, 1); // only A's runs got in
});

test("a banned player stays off the daily board", async () => {
  env.DB.sqlite.exec(`INSERT INTO banned (id, banned_at) VALUES ('${ID_A}', ${now})`);
  assert.equal((await submitDaily(ID_A)).status, 403);
  assert.equal((await board("?board=day")).body.total, 0);
});

test("the scheduled run drops finished days but keeps the last one", async () => {
  await submitDaily(ID_A);
  now += DAY_MS;
  await submitDaily(ID_B);
  const days = () => env.DB.sqlite.prepare("SELECT day FROM daily ORDER BY day").all().map((r) => r.day);

  await worker.scheduled({}, env);
  assert.equal(days().length, 2);
  now += DAY_MS;
  await worker.scheduled({}, env);
  assert.deepEqual(days(), [dayOf(now) - 1]);
});

// ---------- chosen names ----------
test("validName only accepts names the word lists can make", () => {
  for (const name of ["SwiftOtter482", "IronYak0", "DaringFerret999", nameFor(ID_A)]) {
    assert.equal(validName(name), true, name);
  }
  const bad = [
    "SwiftOtter", "SwiftOtter1000", "SwiftOtter007", "swiftOtter1", "SwiftOTTER1", "Swift Otter1",
    "RudeOtter1", "SwiftWord1", "Otter1", "SwiftSwiftOtter1", "SwiftOtter1 ", "", null, 7, ["SwiftOtter1"],
  ];
  for (const name of bad) assert.equal(validName(name), false, JSON.stringify(name));
});

test("the app's name picker offers exactly the server's word lists", () => {
  assert.deepEqual(appNames.ADJECTIVES, ADJECTIVES);
  assert.deepEqual(appNames.ANIMALS, ANIMALS);
  assert.equal(validName(appNames.makeName({ a: 0, b: 0, n: appNames.NUMBERS - 1 })), true);
  assert.deepEqual(appNames.parseName("IronYak7"), { a: ADJECTIVES.indexOf("Iron"), b: ANIMALS.indexOf("Yak"), n: 7 });
  assert.equal(appNames.parseName("SwiftOtter007"), null);
});

test("a name sent with a score is stored, and kept by later submissions without one", async () => {
  const res = await submit(ID_A, { ...RUN, name: "IronYak7" });
  assert.equal(res.body.name, "IronYak7");
  await submitLater(ID_A, { score: 900, wave: 9, elapsed: 150 });
  assert.equal((await board()).body.top[0].name, "IronYak7");
  // Sending another one replaces it, also when the score is no better.
  await submitLater(ID_A, { ...RUN, name: "CalmOwl12" });
  assert.deepEqual((await board("?board=week&player=" + ID_A)).body.top, [
    { rank: 1, name: "CalmOwl12", score: 900, wave: 9, you: true },
  ]);
});

test("a name that the lists cannot make is refused", async () => {
  assert.equal((await submit(ID_A, { ...RUN, name: "RudeWord1" })).status, 400);
  assert.equal((await submit(ID_A, { ...RUN, name: null })).status, 400);
  assert.equal((await board()).body.total, 0);
  await submit(ID_A);
  const res = await call("POST", "/name", { playerId: ID_A, name: "<b>hi</b>" });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "bad name" });
  assert.equal((await call("POST", "/name", { playerId: "nope", name: "IronYak7" })).status, 400);
  assert.equal((await call("POST", "/name", { playerId: ID_A, name: "IronYak7", pad: "x".repeat(600) })).status, 413);
  assert.equal((await board()).body.top[0].name, nameFor(ID_A));
});

test("renaming changes the entry on both boards and in the standing", async () => {
  await submit(ID_A);
  const res = await call("POST", "/name", { playerId: ID_A, name: "IronYak7" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { name: "IronYak7" });
  assert.equal((await board()).body.top[0].name, "IronYak7");
  assert.equal((await board("?board=week")).body.top[0].name, "IronYak7");
  assert.equal((await board("?player=" + ID_A)).body.me.name, "IronYak7");
  assert.equal((await call("GET", "/rank?player=" + ID_A)).body.name, "IronYak7");
});

test("renaming a player with no entry stores nothing", async () => {
  assert.equal((await call("POST", "/name", { playerId: ID_A, name: "IronYak7" })).status, 200);
  assert.equal((await board()).body.total, 0);
  // Banned ids have no entry either, so they cannot get a name onto the board.
  env.DB.sqlite.exec(`INSERT INTO banned (id, banned_at) VALUES ('${ID_B}', ${now})`);
  assert.equal((await submit(ID_B, { ...RUN, name: "IronYak7" })).status, 403);
  assert.equal((await board("?board=week")).body.total, 0);
});

// ---------- routing ----------
test("unknown paths and methods get 404", async () => {
  assert.equal((await call("GET", "/")).status, 404);
  assert.equal((await call("GET", "/scores")).status, 404);
  assert.equal((await call("POST", "/leaderboard", {})).status, 404);
  assert.equal((await call("DELETE", "/scores")).status, 404);
});

test("a database failure gets 500 without details", async () => {
  mock.method(console, "error", () => {});
  env.DB.sqlite.exec("DROP TABLE players");
  const res = await board();
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "server error" });
});
