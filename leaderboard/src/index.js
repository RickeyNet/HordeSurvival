// Horde Survival global leaderboard API (Cloudflare Worker + D1).
//
//   POST /scores        { playerId, score, wave, elapsed }  -> { name, best, rank }
//   GET  /leaderboard?player=<id>&limit=20                  -> { top, me, total }
//
// Players are anonymous: the app makes up a random id on first launch and the
// server derives a display name from it, so nothing personal is ever sent and
// there are no user-typed names to moderate. No IP addresses are stored.

const WAVE_LEN = 18; // must match game/core.js
const ID_RE = /^[0-9a-f]{32}$/;
const COOLDOWN_MS = 5000;
const MAX_LIMIT = 100;

// ---------- Anonymous names ----------
const ADJECTIVES = [
  "Swift", "Brave", "Silent", "Lucky", "Clever", "Mighty", "Rapid", "Steady",
  "Bold", "Fierce", "Quiet", "Sharp", "Wild", "Calm", "Iron", "Golden",
  "Shadow", "Storm", "Frost", "Ember", "Rusty", "Nimble", "Gritty", "Daring",
];
const ANIMALS = [
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

// ---------- Plausibility (cheap anti-cheat) ----------
// The fastest possible scoring late in a run is roughly 13 points/second
// (dense spawns plus bosses), so 25/s + a small allowance is generous for
// honest players while rejecting obviously forged scores.
export function plausible({ score, wave, elapsed }) {
  if (!Number.isInteger(score) || score <= 0 || score > 10_000_000) return false;
  if (!Number.isInteger(wave) || wave < 1) return false;
  if (typeof elapsed !== "number" || !(elapsed > 0) || elapsed > 86_400) return false;
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

async function rankOf(db, best) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM players WHERE best > ?").bind(best).first();
  return row.n + 1;
}

// ---------- Handlers ----------
async function submit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { playerId, score, wave, elapsed } = body || {};
  if (typeof playerId !== "string" || !ID_RE.test(playerId)) return json({ error: "bad player id" }, 400);
  if (!plausible({ score, wave, elapsed })) return json({ error: "rejected" }, 422);

  const now = Date.now();
  const existing = await env.DB.prepare("SELECT best, last_submit FROM players WHERE id = ?").bind(playerId).first();
  if (existing && now - existing.last_submit < COOLDOWN_MS) return json({ error: "too many requests" }, 429);

  const name = nameFor(playerId);
  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO players (id, name, best, wave, updated_at, last_submit) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(playerId, name, score, wave, now, now).run();
  } else if (score > existing.best) {
    await env.DB.prepare("UPDATE players SET best = ?, wave = ?, updated_at = ?, last_submit = ? WHERE id = ?")
      .bind(score, wave, now, now, playerId).run();
  } else {
    await env.DB.prepare("UPDATE players SET last_submit = ? WHERE id = ?").bind(now, playerId).run();
  }
  const best = Math.max(score, existing ? existing.best : 0);
  return json({ name, best, rank: await rankOf(env.DB, best) });
}

async function leaderboard(url, env) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 20));
  const { results } = await env.DB.prepare(
    "SELECT name, best, wave FROM players ORDER BY best DESC, updated_at ASC LIMIT ?"
  ).bind(limit).all();

  // Standard competition ranking: equal scores share a rank.
  let prev = null, rank = 0;
  const top = results.map((r, i) => {
    if (r.best !== prev) rank = i + 1;
    prev = r.best;
    return { rank, name: r.name, score: r.best, wave: r.wave };
  });

  const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM players").first()).n;

  let me = null;
  const player = url.searchParams.get("player");
  if (player && ID_RE.test(player)) {
    const row = await env.DB.prepare("SELECT best, wave FROM players WHERE id = ?").bind(player).first();
    me = row
      ? { name: nameFor(player), score: row.best, wave: row.wave, rank: await rankOf(env.DB, row.best) }
      : { name: nameFor(player), score: 0, wave: 0, rank: null };
  }
  return json({ top, me, total });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/scores") return await submit(request, env);
      if (request.method === "GET" && url.pathname === "/leaderboard") return await leaderboard(url, env);
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "server error" }, 500);
    }
  },
};
