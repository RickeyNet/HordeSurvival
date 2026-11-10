// Tests for the leaderboard Worker. Run with `npm test` (Node 22.13 or newer).
// No install needed: the Worker runs against a small stand-in for D1 backed by
// Node's built-in SQLite, with the real migrations applied, so the SQL itself
// is under test.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { plausible, nameFor, MAX_ELAPSED } from "../src/index.js";

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
test("first submission stores the run and returns name, best and rank", async () => {
  const res = await submit(ID_A);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { name: nameFor(ID_A), best: 500, rank: 1 });
  assert.deepEqual((await board()).body.top, [{ rank: 1, name: nameFor(ID_A), score: 500, wave: 6 }]);
});

test("a lower score keeps the old best and its wave", async () => {
  await submit(ID_A);
  const res = await submitLater(ID_A, { score: 200, wave: 3, elapsed: 40 });
  assert.equal(res.status, 200);
  assert.equal(res.body.best, 500);
  assert.deepEqual((await board()).body.top, [{ rank: 1, name: nameFor(ID_A), score: 500, wave: 6 }]);
});

test("a higher score replaces the best and its wave", async () => {
  await submit(ID_A);
  const res = await submitLater(ID_A, { score: 900, wave: 9, elapsed: 150 });
  assert.equal(res.body.best, 900);
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
    `INSERT OR IGNORE INTO banned (id, banned_at) VALUES ('${ID_A}', ${now}); DELETE FROM players WHERE id = '${ID_A}'`
  );

  const res = await submitLater(ID_A, { score: 900, wave: 9, elapsed: 150 });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "banned" });

  const { top, total, me } = (await board("?player=" + ID_A)).body;
  assert.deepEqual(top, [{ rank: 1, name: nameFor(ID_B), score: 300, wave: 6 }]);
  assert.equal(total, 1);
  assert.equal(me.rank, null);
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
  assert.equal((await submit(ID_B, { score: 300, wave: 6, elapsed: 100 })).body.rank, 2);
  assert.equal((await submit(ID_C, { score: 300, wave: 6, elapsed: 100 })).body.rank, 2);
  assert.equal((await submitLater(ID_C, { score: 900, wave: 6, elapsed: 100 })).body.rank, 1);
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
