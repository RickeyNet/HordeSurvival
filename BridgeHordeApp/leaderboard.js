// Global leaderboard client. Talks to the Cloudflare Worker in ../leaderboard.
// Players are anonymous: a random id is made on first launch and kept on the
// device; the server turns it into a display name like "SwiftOtter482".
import AsyncStorage from "@react-native-async-storage/async-storage";

// Set this to the URL printed by `npm run deploy` in ../leaderboard,
// e.g. "https://horde-leaderboard.<your-subdomain>.workers.dev".
// Empty = leaderboard disabled (the screen says it's not set up).
export const LEADERBOARD_URL = "";

const KEY_ID = "hordePlayerId";
const KEY_PENDING = "hordePendingScore"; // best run not yet accepted by the server
const KEY_SUBMITTED = "hordeSubmittedBest"; // best score the server has accepted

export const enabled = () => LEADERBOARD_URL !== "";

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

// Try to send the stored pending run. Network errors and 429/5xx keep it for
// a later retry; any other rejection drops it so it can't block future runs.
let sending = false;
export async function flushPending() {
  if (!enabled() || sending) return;
  sending = true;
  try {
    const raw = await AsyncStorage.getItem(KEY_PENDING);
    if (!raw) return;
    const run = JSON.parse(raw);
    const playerId = await getPlayerId();
    let res;
    try {
      res = await request("/scores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, ...run }),
      });
    } catch {
      return; // offline: keep it
    }
    if (res.status === 429 || res.status >= 500) return;
    await AsyncStorage.removeItem(KEY_PENDING);
    if (res.status === 200) await AsyncStorage.setItem(KEY_SUBMITTED, String(res.body.best));
  } catch {
  } finally {
    sending = false;
  }
}

// Called at game over. Only runs that beat what the server already has are
// queued, so most games send nothing.
export async function recordRun(score, wave, elapsed) {
  if (!enabled() || score <= 0) return;
  try {
    const submitted = Number(await AsyncStorage.getItem(KEY_SUBMITTED)) || 0;
    if (score <= submitted) return;
    const raw = await AsyncStorage.getItem(KEY_PENDING);
    const pending = raw ? JSON.parse(raw) : null;
    if (!pending || score > pending.score) {
      await AsyncStorage.setItem(KEY_PENDING, JSON.stringify({ score, wave, elapsed: Math.round(elapsed * 10) / 10 }));
    }
  } catch {}
  await flushPending();
}

// -> { top: [{rank, name, score, wave}], me: {name, score, rank}|null, total }
export async function fetchBoard(limit = 15) {
  await flushPending();
  const playerId = await getPlayerId();
  const res = await request("/leaderboard?limit=" + limit + "&player=" + playerId);
  if (res.status !== 200) throw new Error("leaderboard " + res.status);
  return res.body;
}
