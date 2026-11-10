// Global leaderboard client. Talks to the Cloudflare Worker in ../leaderboard.
// Players are anonymous: a random id is made on first launch and kept on the
// device; the server turns it into a display name like "SwiftOtter482". The
// player can swap that for another name built from the same word lists
// (names.js). There is an all-time board, one for the current week, and one
// for the day's challenge (daily challenge runs only).
import AsyncStorage from "@react-native-async-storage/async-storage";

// Set this to the URL printed by `npm run deploy` in ../leaderboard,
// e.g. "https://horde-leaderboard.<your-subdomain>.workers.dev".
// Empty = leaderboard disabled (the screen says it's not set up).
export const LEADERBOARD_URL = "";

const KEY_ID = "hordePlayerId";
const KEY_PENDING = "hordePendingScore"; // best run not yet accepted by the server
const KEY_SUBMITTED = "hordeSubmittedBest"; // best score the server has accepted
const KEY_WEEK = "hordeSubmittedWeek"; // { week, best }: the same, for that week's board
const KEY_PENDING_DAILY = "hordePendingDaily"; // best daily challenge run not yet accepted
const KEY_DAY = "hordeSubmittedDay"; // { day, best }: the same, for that day's challenge board
const KEY_NAME = "hordeName"; // name the player picked, if any
const KEY_NAME_SENT = "hordeNameSent"; // the picked name the server last took

export const enabled = () => LEADERBOARD_URL !== "";

// Week number as the server counts it: weeks start Monday 00:00 UTC.
const weekNow = () => Math.floor((Date.now() - 4 * 86400000) / (7 * 86400000));

const readJson = async (key) => JSON.parse((await AsyncStorage.getItem(key)) || "null");

let idPromise = null;
export function getPlayerId() {
  if (!idPromise) {
    idPromise = AsyncStorage.getItem(KEY_ID).then(async (id) => {
      if (id && /^[0-9a-f]{32}$/.test(id)) return id;
      let fresh = "";
      for (let i = 0; i < 32; i++) fresh += Math.floor(Math.random() * 16).toString(16);
      await AsyncStorage.setItem(KEY_ID, fresh);
      return fresh;
    });
  }
  return idPromise;
}

async function request(path, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(LEADERBOARD_URL + path, { ...options, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
const post = (path, body) =>
  request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Send whatever is waiting: a stored pending run, or failing that a picked
// name the server hasn't taken yet (a run carries the name along with it).
// A daily challenge run goes first, since its board closes at the end of the
// day; the server counts it for the other boards too, so a pending run that
// scored no higher needs no request of its own. One run is sent per call
// (the server refuses a second one within a few seconds).
// Network errors and 429/5xx keep the run for a later retry; any other
// rejection drops it so it can't block future runs.
// -> the player's standing if a run was accepted, else null.
let sending = false;
export async function flushPending() {
  if (!enabled() || sending) return null;
  sending = true;
  try {
    const playerId = await getPlayerId();
    const name = await AsyncStorage.getItem(KEY_NAME);
    const run = await readJson(KEY_PENDING);
    const dailyRun = await readJson(KEY_PENDING_DAILY);
    const sent = dailyRun || run;
    if (!sent) {
      if (name && name !== (await AsyncStorage.getItem(KEY_NAME_SENT))) {
        const res = await post("/name", { playerId, name });
        if (res.status === 200) await AsyncStorage.setItem(KEY_NAME_SENT, name);
      }
      return null;
    }
    const res = await post("/scores", { playerId, ...sent, ...(name ? { name } : {}) });
    if (res.status === 429 || res.status >= 500) return null;
    await AsyncStorage.removeItem(dailyRun ? KEY_PENDING_DAILY : KEY_PENDING);
    if (res.status !== 200) return null;
    if (dailyRun && run && run.score <= dailyRun.score) await AsyncStorage.removeItem(KEY_PENDING);
    const { all, week, day } = res.body;
    await AsyncStorage.setItem(KEY_SUBMITTED, String(all.best));
    await AsyncStorage.setItem(KEY_WEEK, JSON.stringify({ week: week.id, best: week.best }));
    if (day) await AsyncStorage.setItem(KEY_DAY, JSON.stringify({ day: day.id, best: day.best }));
    if (name) await AsyncStorage.setItem(KEY_NAME_SENT, name);
    return res.body;
  } catch {
    return null; // offline: keep it
  } finally {
    sending = false;
  }
}

// Called at game over. daily: the day number of a daily challenge run (see
// dayOf in game/core.js), null for any other run. Only runs that beat what
// the server already has, all time, for this week or for that day's
// challenge, are queued, so many games send nothing.
// -> the player's standing { name, all: { best, rank, total }, week: { ... }, day: { ... } }
//    for the game-over screen, or null if it couldn't be fetched.
export async function recordRun(score, wave, elapsed, daily = null) {
  if (!enabled()) return null;
  try {
    const run = { score, wave, elapsed: Math.round(elapsed * 10) / 10 };
    const allBest = Number(await AsyncStorage.getItem(KEY_SUBMITTED)) || 0;
    const sent = await readJson(KEY_WEEK);
    const weekBest = sent && sent.week === weekNow() ? sent.best : 0;
    if (score > 0 && (score > allBest || score > weekBest)) {
      const pending = await readJson(KEY_PENDING);
      if (!pending || score > pending.score) await AsyncStorage.setItem(KEY_PENDING, JSON.stringify(run));
    }
    if (score > 0 && daily !== null) {
      const sentDay = await readJson(KEY_DAY);
      const dayBest = sentDay && sentDay.day === daily ? sentDay.best : 0;
      const pending = await readJson(KEY_PENDING_DAILY);
      // a run waiting from an earlier day gives way: its board is closed by now
      if (score > dayBest && (!pending || pending.daily !== daily || score > pending.score)) {
        await AsyncStorage.setItem(KEY_PENDING_DAILY, JSON.stringify({ ...run, daily }));
      }
    }
  } catch {}
  const standing = await flushPending();
  if (standing) return standing;
  try {
    const res = await request("/rank?player=" + (await getPlayerId()));
    return res.status === 200 ? res.body : null;
  } catch {
    return null;
  }
}

// The name the player picked, or null while they still have the generated one.
export const getName = () => AsyncStorage.getItem(KEY_NAME).catch(() => null);

// Keep a picked name (see names.js) and pass it on to the server. If that
// fails now, it is sent again with the next flush.
export async function setName(name) {
  try {
    await AsyncStorage.setItem(KEY_NAME, name);
  } catch {}
  await flushPending();
}

// board: "all", "week" or "day" (today's daily challenge)
// -> { top: [{rank, name, score, wave, you?}], me: {name, score, wave, rank}|null, total, endsAt? }
export async function fetchBoard(board = "all", limit = 15) {
  await flushPending();
  const playerId = await getPlayerId();
  const res = await request("/leaderboard?board=" + board + "&limit=" + limit + "&player=" + playerId);
  if (res.status !== 200) throw new Error("leaderboard " + res.status);
  // A player with no score yet has no entry for the server to keep a name on.
  const name = await getName();
  if (name && res.body.me) res.body.me.name = name;
  return res.body;
}
