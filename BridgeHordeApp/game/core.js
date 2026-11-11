// Bridge Horde - shared game logic.
// This file is pure JavaScript with no rendering or platform code, so the
// exact same logic runs in the browser dev page (web/dev.html) and in the
// React Native app (App.jsx). Tune gameplay here.

// ---------- World constants ----------
export const W = 400;
export const H = 720;
export const RAIL = 34;
export const ROAD_L = RAIL;
export const ROAD_R = W - RAIL;
export const ROAD_MID = W / 2;
export const PLAYER_Y = H - 130;
export const MAX_TROOPS = 30;
export const GATE_H = 52;
export const GATE_SPEED = 58;
export const WAVE_LEN = 18; // seconds per wave
// The horde's speed, numbers and the wave part of its health all level off
// around wave 12. Past that a run keeps getting harder for a while, but only
// in ways the player can answer with aim and movement: the horde comes
// faster, and spitters gather and fire more often. Health is left alone (more
// of it is a wall no steering gets past), and each of these stops at a cap,
// so no wave is ever beyond a squad that aims and dodges well.
export const LATE_WAVE = 12; // last wave before the late ramp
export const LATE_SPEED = 0.75; // extra zombie speed per wave past it...
export const LATE_SPEED_MAX = 20; // ...up to this much
export const LATE_SPIT = 0.02; // share of SPIT_EVERY a spitter drops per wave past it...
export const LATE_SPIT_MAX = 0.25; // ...up to this much
export const LATE_SPITTER_WAVE = 8; // waves past it until one more spitter may be on the road
export const BOSS_TIER_MAX = 12; // bosses stop getting tougher after this many
const lateWaves = (g) => Math.max(0, g.wave - LATE_WAVE);

// ---------- Enemy catalog ----------
// hpMul scales off the adaptive hp base; spdMul off the wave-scaled speed.
// troopCost = soldiers lost if it reaches your line.
// bomber: bursts when shot, hurting the zombies around it, and blows a chunk
// out of the first wall it reaches. weaver: sways across the road as it
// comes. spitter: stops short of the squad and lobs acid at it. yeti: the
// boss of the Frozen Pass; hurls ice that jams the squad's guns for a moment.
export const KIND_STATS = {
  walker:   { size: 13, hpMul: 0.75, spdMul: 1.0,  troopCost: 1, score: 1 },
  runner:   { size: 11, hpMul: 0.4,  spdMul: 1.8,  troopCost: 1, score: 2 },
  tank:     { size: 18, hpMul: 2.6,  spdMul: 0.55, troopCost: 2, score: 4 },
  bomber:   { size: 14, hpMul: 0.6,  spdMul: 1.25, troopCost: 2, score: 3 },
  weaver:   { size: 11, hpMul: 0.55, spdMul: 1.3,  troopCost: 1, score: 3 },
  spitter:  { size: 15, hpMul: 1.3,  spdMul: 0.8,  troopCost: 1, score: 5 },
  brute:    { size: 30, hpMul: 9,    spdMul: 0.4,  troopCost: 3, score: 25, boss: true },
  summoner: { size: 26, hpMul: 7,    spdMul: 0.34, troopCost: 3, score: 30, boss: true },
  colossus: { size: 38, hpMul: 14,   spdMul: 0.26, troopCost: 5, score: 50, boss: true },
  yeti:     { size: 32, hpMul: 9.5,  spdMul: 0.38, troopCost: 3, score: 30, boss: true },
};
export const BOMB_RADIUS = 55; // reach of a bomber's blast
export const BOMB_WALL = 0.4; // share of a wall's full hit points a bomber takes off
export const WEAVE = 55; // how far a weaver sways to either side
export const SPIT_HOLD = PLAYER_Y - 250; // where a spitter stops
export const SPIT_EVERY = 3.2; // seconds between a spitter's shots
export const SPIT_SPEED = 230;
export const MAX_SPITTERS = 3; // on the road at once
export const ICE_EVERY = 4; // seconds between a yeti's throws
export const CHILL_TIME = 1.8; // how long a hit by its ice keeps the squad from firing

// ---------- Environments ----------
// Where a run takes place. The renderers draw each one differently; hpMul and
// spdMul scale every zombie spawned there, and bosses lists the ones that
// arrive, in order, over and over. An ordinary run uses the one picked on the
// menu (g.envPick); a daily challenge takes its own from the day.
export const ENVS = {
  bridge: { label: "SUNSET BRIDGE", desc: "The classic", hpMul: 1, spdMul: 1, bosses: ["brute", "summoner", "colossus"] },
  pass: { label: "FROZEN PASS", desc: "Slower horde, thicker hides", hpMul: 1.25, spdMul: 0.85, bosses: ["yeti", "summoner", "colossus"] },
};
export const ENV_KEYS = Object.keys(ENVS);
// The next environment on the menu, for the following ordinary run.
export function cycleEnv(g) {
  g.envPick = ENV_KEYS[(ENV_KEYS.indexOf(g.envPick) + 1) % ENV_KEYS.length];
}
// The environment to draw: the picked one on the bare menu, else the run's.
export function sceneEnv(g) {
  const key = g.state === "menu" && !g.inRun ? g.envPick : g.env;
  return ENVS[key] ? key : "bridge";
}

// ---------- Power-ups ----------
// Crates that come down the road; steer the squad into one to take it.
// time = how long the effect lasts (for the airstrike: how long until it lands).
export const POWERUPS = {
  freeze: { label: "FREEZE", color: "#7fd4ff", time: 4 },
  airstrike: { label: "AIRSTRIKE", color: "#ff7a3c", time: 0.7 },
  rapid: { label: "RAPID FIRE", color: "#ffe14d", time: 6 },
};
const POWERUP_KEYS = Object.keys(POWERUPS);
export const DROP_SPEED = 95;
export const STRIKE_BOSS = 0.35; // share of a boss's full health an airstrike takes off

// ---------- Weapon catalog ----------
// rateMul/dmgMul multiply the squad's base stats; pellets = shots per soldier
// per volley (spread), pierce = extra zombies a bullet passes through,
// aoe = explosion radius on impact.
export const WEAPONS = {
  rifle:   { label: "RIFLE",   color: "#ffd870", rateMul: 1,    dmgMul: 1,    pellets: 1 },
  shotgun: { label: "SHOTGUN", color: "#ff9d3c", rateMul: 0.75, dmgMul: 0.55, pellets: 3 },
  smg:     { label: "SMG",     color: "#fff3a0", rateMul: 1.9,  dmgMul: 0.55, pellets: 1 },
  sniper:  { label: "SNIPER",  color: "#6fe3ff", rateMul: 0.45, dmgMul: 4,    pellets: 1, pierce: 3 },
  rocket:  { label: "ROCKET",  color: "#ff5a4d", rateMul: 0.4,  dmgMul: 2.2,  pellets: 1, aoe: 60 },
};

// ---------- Game state ----------
function freshEvents() {
  return {
    shot: false, kill: false, bigKill: false, gate: null, troopLost: false,
    waveStart: false, bossSpawn: false, bossDown: false, summon: false,
    pickup: null, boom: false, wallBuilt: false, wallDown: false,
    spit: false, power: null, // power: key of the POWERUPS crate just taken
    chilled: false, // a yeti's ice just hit the squad
    achieved: [], // ids of ACHIEVEMENTS unlocked this frame
  };
}

export function newGame() {
  return {
    state: "menu", // menu | playing | paused | gameover
    player: { x: ROAD_MID, troops: 1, damage: 1, fireRate: 2.5, weapon: "rifle" },
    bullets: [],
    zombies: [],
    gates: [],
    walls: [], // up to 3 { y, hp, maxHp } barricades zombies must chew through
    spits: [], // acid in the air: { x, y, vx, vy }; a yeti's ice has ice: true
    drops: [], // power-up crates on the road: { x, y, type }
    // seconds left; strike counts down to the airstrike landing, chill is the
    // squad's guns iced up by a yeti
    effects: { freeze: 0, rapid: 0, strike: 0, chill: 0 },
    powers: {}, // POWERUPS key -> true for every kind of crate taken this run
    flash: 0, // white-out after an airstrike, 1 -> 0
    env: "bridge", // key of ENVS this run is played in
    envPick: "bridge", // environment picked on the menu; kept between runs
    particles: [],
    floaters: [],
    events: freshEvents(),
    banner: { text: "", life: 0 }, // big center-screen announcement
    score: 0,
    kills: 0,
    inRun: false, // on the menu with a run waiting to be resumed
    best: 0,
    coins: 0, // spent on upgrades; kept between runs like the best score
    upgrades: { troops: 0, damage: 0, wall: 0 }, // level per UPGRADES entry
    earned: 0, // coins paid out by the run that just ended
    newBest: false,
    daily: null, // day number (dayOf) when this run is that day's challenge
    rng: null, // seeded random streams of a daily run, see rand()
    dailyBest: { day: 0, best: 0 }, // best daily challenge score, and its day
    newDailyBest: false,
    achieved: {}, // id -> true for every unlocked entry of ACHIEVEMENTS
    hits: 0, // zombies that got through to the squad this run
    guns: { rifle: true }, // weapons carried this run
    wave: 1,
    waveTimer: WAVE_LEN,
    bossTier: 0,
    elapsed: 0,
    shake: 0,
    fireTimer: 0,
    zombieTimer: 1.2,
    gateTimer: 3.5,
    dropTimer: 16,
  };
}

// Start over, keeping what outlives a run: best scores, coins, upgrades,
// achievements and the picked environment.
function clearRun(g) {
  const { best, coins, upgrades, dailyBest, achieved, envPick } = g;
  Object.assign(g, newGame(), { best, coins, upgrades, dailyBest, achieved, envPick });
}

// Start a run. Pass a day number (dayOf) to play that day's challenge: its
// gates and horde come from a seed fixed by the day, and bought upgrades are
// left out, so everyone faces the same run from the same start. The day also
// sets the environment.
export function resetRun(g, daily = null) {
  clearRun(g);
  if (daily === null) {
    g.player.troops += g.upgrades.troops;
    g.player.damage += g.upgrades.damage;
    g.env = ENVS[g.envPick] ? g.envPick : "bridge";
  } else {
    g.daily = daily;
    g.rng = seedRng(daily);
    g.env = ENV_KEYS[daily % ENV_KEYS.length];
  }
  g.state = "playing";
  g.banner = { text: daily === null ? "WAVE 1" : "DAILY CHALLENGE", life: 2 };
}

// ---------- Daily challenge ----------
// Days are counted in UTC, the same way the leaderboard server counts them.
export const DAY_MS = 86400000;
export const dayOf = (ms) => Math.floor(ms / DAY_MS);
export const dayEnd = (day) => (day + 1) * DAY_MS;

// A daily run draws its gates, its horde, the summoners' walkers and its
// power-up crates from separate seeded streams, so what one of them has used up (which
// depends on how the player is doing) never shifts the others. Every other
// run has no rng and uses Math.random. The stream states are plain numbers,
// so a saved run carries them along.
/* eslint-disable no-bitwise */
function seedRng(seed) {
  const mix = (n) => Math.imul(seed ^ n, 0x9e3779b1) >>> 0;
  return { gates: mix(0x1f123bb5), spawns: mix(0x5bd1e995), minions: mix(0x27d4eb2f), drops: mix(0x165667b1) };
}
function rand(g, stream) {
  if (!g.rng) return Math.random();
  // mulberry32
  let t = (g.rng[stream] = (g.rng[stream] + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/* eslint-enable no-bitwise */

// Back to the main menu. A paused run is kept so it can be resumed from
// there; a finished one is cleared away.
export function toMenu(g) {
  if (g.state === "paused") {
    g.state = "menu";
    g.inRun = true;
    return;
  }
  clearRun(g);
}

// Pick a kept run back up from the menu.
export function resumeRun(g) {
  if (!g.inRun) return;
  g.inRun = false;
  g.state = "playing";
}

// A run that can be picked up again: paused, or waiting behind the menu.
export function hasRun(g) {
  return g.state === "paused" || (g.state === "menu" && g.inRun);
}

// A kept run as a JSON string, and back. Everything in the game state is
// plain data, so a platform can store this to survive an app restart.
const SAVE_VERSION = 1;
export function saveRun(g) {
  return JSON.stringify({ v: SAVE_VERSION, run: { ...g, state: "menu", inRun: true, events: freshEvents(), shake: 0 } });
}
export function loadRun(g, json) {
  let saved;
  try { saved = JSON.parse(json); } catch { return false; }
  const run = saved && saved.v === SAVE_VERSION && saved.run;
  if (!run || !run.player || !Array.isArray(run.zombies) || !Array.isArray(run.gates)) return false;
  const best = Math.max(g.best, Number(run.best) || 0);
  // coins, upgrades, achievements and the daily best are stored on their own
  // (saveMeta), so the copy inside a saved run may be out of date and is
  // never used
  const { coins, upgrades, dailyBest, achieved, envPick } = g;
  const fresh = newGame();
  Object.assign(g, fresh, run, { state: "menu", inRun: true, best, coins, upgrades, dailyBest, achieved, envPick });
  g.effects = { ...fresh.effects, ...run.effects }; // a run saved by an older version has fewer effects
  if (!ENVS[g.env]) g.env = "bridge";
  return true;
}

// ---------- Coins and permanent upgrades ----------
// A finished run pays out coins; they buy upgrades that apply to every later
// run. costs[i] is the price of level i + 1, so its length is the top level.
// value(level) is the short text a shop screen shows for that level.
export const WALL_BONUS = 0.2; // extra wall hit points per level
export const UPGRADES = {
  troops: { label: "STARTING TROOPS", desc: "Squad size at the start", costs: [50, 120, 250, 500], value: (l) => String(1 + l) },
  damage: { label: "STARTING DAMAGE", desc: "Damage at the start", costs: [100, 250, 600], value: (l) => String(1 + l) },
  wall: { label: "WALL STRENGTH", desc: "Hit points of every wall", costs: [40, 80, 140, 220, 320], value: (l) => "+" + Math.round(l * WALL_BONUS * 100) + "%" },
};
export function coinsFor(score, wave) {
  return Math.floor(score / 10) + (wave - 1) * 2;
}
// Price of the next level, or null when the upgrade is at its top level.
export function upgradeCost(g, key) {
  const cost = UPGRADES[key].costs[g.upgrades[key]];
  return cost === undefined ? null : cost;
}
// Starting troops and damage take effect from the next run; wall strength
// from the next wall built.
export function buyUpgrade(g, key) {
  const cost = upgradeCost(g, key);
  if (cost === null || g.coins < cost) return false;
  g.coins -= cost;
  g.upgrades[key]++;
  return true;
}

// ---------- Achievements ----------
// Each one unlocks once, for good, and pays its coins on the spot. Those with
// a `when` are checked against the run every frame; the others are unlocked
// where the thing happens (a boss kill, a bomber's blast, the end of a daily
// run).
export const CHAIN_KILLS = 3; // zombies one bomber's blast has to kill for "chain"
export const ACHIEVEMENTS = [
  { id: "wave5", label: "HOLD THE LINE", desc: "Reach wave 5", coins: 10, when: (g) => g.wave >= 5 },
  { id: "wave10", label: "DUG IN", desc: "Reach wave 10", coins: 25, when: (g) => g.wave >= 10 },
  { id: "wave20", label: "LAST STAND", desc: "Reach wave 20", coins: 60, when: (g) => g.wave >= 20 },
  { id: "boss", label: "GIANT SLAYER", desc: "Defeat a boss", coins: 10 },
  { id: "rifleBoss", label: "OLD RELIABLE", desc: "Finish off a boss with the rifle", coins: 20 },
  { id: "colossus", label: "TITAN DOWN", desc: "Defeat a colossus", coins: 30 },
  { id: "kills250", label: "EXTERMINATOR", desc: "250 kills in one run", coins: 25, when: (g) => g.kills >= 250 },
  { id: "score1000", label: "FOUR DIGITS", desc: "Score 1000 in one run", coins: 40, when: (g) => g.score >= 1000 },
  { id: "fullSquad", label: "FULL HOUSE", desc: "Field a squad of " + MAX_TROOPS, coins: 20, when: (g) => g.player.troops >= MAX_TROOPS },
  { id: "fortress", label: "FORTRESS", desc: "Have three walls standing", coins: 15, when: (g) => g.walls.length >= WALL_SLOTS.length },
  { id: "arsenal", label: "ARSENAL", desc: "Carry every weapon in one run", coins: 25, when: (g) => Object.keys(WEAPONS).every((k) => g.guns[k]) },
  { id: "untouched", label: "UNTOUCHED", desc: "No zombie gets through before wave 5", coins: 30, when: (g) => g.wave >= 5 && g.hits === 0 },
  { id: "daily", label: "DAILY DUTY", desc: "Finish a daily challenge", coins: 15 },
  { id: "chain", label: "CHAIN REACTION", desc: "Kill " + CHAIN_KILLS + " zombies with one bomber's blast", coins: 20 },
  { id: "powerups", label: "FULLY LOADED", desc: "Take every kind of crate in one run", coins: 20, when: (g) => POWERUP_KEYS.every((k) => g.powers[k]) },
  { id: "yeti", label: "ICEBREAKER", desc: "Defeat the yeti of the Frozen Pass", coins: 25 },
];
function unlock(g, id) {
  if (g.achieved[id]) return;
  g.achieved[id] = true;
  g.coins += ACHIEVEMENTS.find((a) => a.id === id).coins;
  g.events.achieved.push(id);
}

// Coins, upgrades, achievements, the daily best and the picked environment as
// a JSON string, and
// back, for the platform to store. Coins already in g when the stored ones
// arrive (a run that ended before loading finished) are added on top, not
// lost.
const META_VERSION = 1;
export function saveMeta(g) {
  return JSON.stringify({
    v: META_VERSION, coins: g.coins, upgrades: g.upgrades,
    achieved: ACHIEVEMENTS.filter((a) => g.achieved[a.id]).map((a) => a.id), daily: g.dailyBest,
    env: g.envPick,
  });
}
export function loadMeta(g, json) {
  let saved;
  try { saved = JSON.parse(json); } catch { return false; }
  if (!saved || saved.v !== META_VERSION) return false;
  const whole = (n, max) => Math.max(0, Math.min(max, Math.floor(Number(n)) || 0));
  g.coins += whole(saved.coins, Number.MAX_SAFE_INTEGER);
  const levels = saved.upgrades || {};
  for (const key of Object.keys(UPGRADES)) {
    g.upgrades[key] = Math.max(g.upgrades[key], whole(levels[key], UPGRADES[key].costs.length));
  }
  const ids = Array.isArray(saved.achieved) ? saved.achieved : [];
  for (const a of ACHIEVEMENTS) if (ids.includes(a.id)) g.achieved[a.id] = true;
  const daily = saved.daily || {};
  recordDaily(g, whole(daily.day, Number.MAX_SAFE_INTEGER), whole(daily.best, Number.MAX_SAFE_INTEGER));
  if (typeof saved.env === "string" && ENVS[saved.env]) g.envPick = saved.env;
  return true;
}

// Keep a daily challenge score if it is the best for its day, and that day is
// not older than the one already held. -> true if it was kept.
function recordDaily(g, day, score) {
  const d = g.dailyBest;
  if (day < d.day || (day === d.day && score <= d.best)) return false;
  g.dailyBest = { day, best: score };
  return true;
}

export function togglePause(g) {
  if (g.state === "playing") g.state = "paused";
  else if (g.state === "paused") g.state = "playing";
}

// Screen-space hit box for the pause button (drawn in the HUD bar).
export const PAUSE_BTN = { x: W - 44, y: 6, w: 36, h: 36 };
export function inPauseBtn(wx, wy) {
  return wx >= PAUSE_BTN.x && wx <= PAUSE_BTN.x + PAUSE_BTN.w && wy >= PAUSE_BTN.y && wy <= PAUSE_BTN.y + PAUSE_BTN.h;
}

// ---------- Squad formation ----------
export function formationSpots(n, cx) {
  const spots = [];
  const perRow = 7, gap = 22, rowGap = 24;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i % perRow;
    spots.push({
      x: cx + (col - (inRow - 1) / 2) * gap,
      y: PLAYER_Y + row * rowGap,
    });
  }
  return spots;
}
export function formationHalfWidth(g) {
  return ((Math.min(g.player.troops, 7) - 1) / 2) * 22 + 12;
}

// ---------- Walls ----------
// Fixed build slots, nearest to the squad first; extra picks repair.
export const WALL_SLOTS = [PLAYER_Y - 170, PLAYER_Y - 230, PLAYER_Y - 290];
export function buildWall(g) {
  const level = g.daily === null ? g.upgrades.wall : 0; // a daily run leaves upgrades out
  const maxHp = Math.round((50 + 22 * g.wave) * (1 + WALL_BONUS * level));
  const used = new Set(g.walls.map((w) => w.y));
  const slot = WALL_SLOTS.find((s) => !used.has(s));
  if (slot !== undefined) {
    g.walls.push({ y: slot, hp: maxHp, maxHp });
  } else {
    // all three standing: repair the most damaged one
    let worst = g.walls[0];
    for (const w of g.walls) if (w.hp / w.maxHp < worst.hp / worst.maxHp) worst = w;
    worst.maxHp = maxHp;
    worst.hp = maxHp;
  }
  g.events.wallBuilt = true;
}

// ---------- Gates ----------
function changeTroops(g, v) {
  g.player.troops = Math.max(1, Math.min(MAX_TROOPS, g.player.troops + v));
}
// Gate effects are plain data ({ label, color, type, v }) so a run can be saved.
function applyGateEffect(g, e) {
  if (e.type === "troops") changeTroops(g, e.v);
  else if (e.type === "double") changeTroops(g, g.player.troops);
  else if (e.type === "damage") g.player.damage++;
  else if (e.type === "rate") g.player.fireRate = Math.min(8, g.player.fireRate * 1.2);
  else if (e.type === "wall") buildWall(g);
  else if (e.type === "weapon") {
    g.player.weapon = e.v;
    g.guns[e.v] = true;
    g.events.pickup = e.v;
  }
}
function makeGateEffect(g, allowBad) {
  if (allowBad && rand(g, "gates") < 0.45) {
    const v = -(2 + Math.floor(rand(g, "gates") * 3));
    return { label: v + " TROOPS", color: "#e0342f", bad: true, type: "troops", v };
  }
  const roll = rand(g, "gates");
  if (roll < 0.3) {
    const v = 2 + Math.floor(rand(g, "gates") * 4);
    return { label: "+" + v + " TROOPS", color: "#2ecc5e", type: "troops", v };
  } else if (roll < 0.48) {
    return { label: "DMG +1", color: "#3b9bff", type: "damage" };
  } else if (roll < 0.66) {
    return {
      label: "FIRE RATE +",
      color: "#f5c211",
      type: "rate",
    };
  } else if (roll < 0.78) {
    return { label: "BUILD WALL", color: "#4dd0c4", type: "wall" };
  } else if (roll < 0.92) {
    // a different gun, offered right in the gate
    const keys = Object.keys(WEAPONS).filter((k) => k !== g.player.weapon);
    const k = keys[Math.floor(rand(g, "gates") * keys.length)];
    const w = WEAPONS[k];
    return { label: w.label, color: w.color, type: "weapon", v: k };
  }
  return { label: "TROOPS x2", color: "#b46bff", type: "double" };
}
function spawnGatePair(g) {
  const a = makeGateEffect(g, false);
  let b = makeGateEffect(g, true);
  while (b.label === a.label) b = makeGateEffect(g, true);
  g.gates.push({ y: -GATE_H, left: a, right: b, used: false });
}

// ---------- Zombies ----------
// The heart of the difficulty fix: zombie HP scales with the squad's actual
// damage output, so building a super-squad raises the stakes instead of
// trivializing the game. Wave number drives speed and spawn density.
function powerFactor(g) {
  const wp = WEAPONS[g.player.weapon] || WEAPONS.rifle;
  const shotDmg = Math.max(1, Math.round(g.player.damage * wp.dmgMul));
  let dps = g.player.troops * shotDmg * wp.pellets * (g.player.fireRate * wp.rateMul);
  dps *= 1 + (wp.pierce || 0) * 0.4;
  if (wp.aoe) dps *= 1.6;
  return 1 + dps / 55;
}

function spawnZombie(g, kind, stream = "spawns") {
  const st = KIND_STATS[kind];
  // HP tracks the player's firepower; the wave term is capped so falling
  // behind on upgrades doesn't compound into unkillable zombies.
  const hpBase = (2.2 + Math.min(g.wave, LATE_WAVE) * 0.45) * powerFactor(g);
  let hpMul = st.hpMul;
  let scoreVal = st.score;
  if (st.boss) {
    hpMul *= 1 + (Math.min(g.bossTier, BOSS_TIER_MAX) - 1) * 0.35; // each boss comes back tougher, up to a point
    scoreVal += (g.bossTier - 1) * 10;
  }
  const env = ENVS[g.env] || ENVS.bridge;
  const baseSpeed = 40 + rand(g, stream) * 18 + Math.min(32, g.wave * 2.5) + Math.min(LATE_SPEED_MAX, lateWaves(g) * LATE_SPEED);
  const z = {
    x: ROAD_L + 20 + rand(g, stream) * (ROAD_R - ROAD_L - 40),
    y: -30,
    kind,
    hp: Math.max(1, Math.ceil(hpBase * hpMul * env.hpMul)),
    maxHp: 0,
    speed: baseSpeed * st.spdMul * env.spdMul,
    size: st.size,
    boss: !!st.boss,
    big: !!st.boss || kind === "tank",
    troopCost: st.troopCost,
    scoreVal,
    wob: Math.random() * Math.PI * 2,
    summonTimer: kind === "summoner" ? 2.5 : 0,
  };
  if (kind === "yeti") z.iceTimer = ICE_EVERY * 0.6;
  if (kind === "weaver") {
    // sways around cx, which is kept far enough from the rails
    z.cx = Math.max(ROAD_L + 20 + WEAVE, Math.min(ROAD_R - 20 - WEAVE, z.x));
    z.phase = rand(g, stream) * Math.PI * 2;
    z.x = z.cx + Math.sin(z.phase) * WEAVE;
  } else if (kind === "spitter") {
    z.spitTimer = SPIT_EVERY * 0.6;
  }
  z.maxHp = z.hp;
  g.zombies.push(z);
  return z;
}

// ---------- Effects ----------
function burst(g, x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 90;
    g.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, color });
  }
}
function floatText(g, x, y, str, color) {
  g.floaters.push({ x, y, text: str, color, life: 1 });
}

// Hurt every living zombie within r of a point, except `skip`.
function splash(g, x, y, r, dmg, wkey, skip) {
  for (const o of g.zombies) {
    if (o === skip || o.hp <= 0) continue;
    const ox = o.x - x, oy = o.y - y;
    if (ox * ox + oy * oy < r * r) {
      o.hp -= dmg;
      if (o.hp <= 0) registerKill(g, o, wkey);
    }
  }
}

function damageWall(g, w, amount) {
  if (w.hp <= 0) return;
  w.hp -= amount;
  if (w.hp <= 0) {
    burst(g, ROAD_MID, w.y - 10, "#8a6b42", 24);
    floatText(g, ROAD_MID, w.y - 30, "WALL DOWN!", "#e0342f");
    g.events.wallDown = true;
  }
}

const KILL_COLORS = { tank: "#7fa08a", bomber: "#ff8c4d", weaver: "#7fd6c9", spitter: "#c6d94a" };

// wkey: the weapon that fired the killing shot
function registerKill(g, z, wkey) {
  if (z.scored) return;
  z.scored = true;
  if (z.kind === "bomber") {
    // takes its neighbours with it; another bomber in reach goes off in turn
    // (and what that one kills counts for this blast too)
    g.events.boom = true;
    burst(g, z.x, z.y, "#ff8c4d", 18);
    const before = g.kills;
    splash(g, z.x, z.y, BOMB_RADIUS, Math.ceil(z.maxHp * 2), wkey, z);
    if (g.kills - before >= CHAIN_KILLS) unlock(g, "chain");
  }
  if (z.boss) {
    unlock(g, "boss");
    if (wkey === "rifle") unlock(g, "rifleBoss");
    if (z.kind === "colossus") unlock(g, "colossus");
    if (z.kind === "yeti") unlock(g, "yeti");
  }
  g.kills++;
  g.score += z.scoreVal;
  const col = z.boss ? "#ffd84d" : KILL_COLORS[z.kind] || "#5aa832";
  burst(g, z.x, z.y, col, z.boss ? 30 : z.big ? 22 : 8);
  if (z.boss) {
    g.events.bossDown = true;
    floatText(g, z.x, z.y - 30, "+" + z.scoreVal, "#ffd84d");
  } else if (z.big) g.events.bigKill = true;
  else g.events.kill = true;
}

// ---------- Losing troops, and the run ----------
function endRun(g, saveBest) {
  if (g.state !== "playing") return; // a second hit in the same frame must not pay out again
  g.state = "gameover";
  g.earned = coinsFor(g.score, g.wave);
  g.coins += g.earned;
  if (g.score > g.best) {
    g.best = g.score;
    g.newBest = true;
    if (saveBest) saveBest(g.best);
  }
  if (g.daily !== null) {
    g.newDailyBest = recordDaily(g, g.daily, g.score) && g.score > 0;
    unlock(g, "daily");
  }
}
// The squad loses n soldiers at (x, y); `what` leads the floating text.
function loseTroops(g, n, x, y, what, big, saveBest) {
  g.hits++;
  g.player.troops -= n;
  g.shake = big ? 12 : 6;
  burst(g, x, y, "#e0342f", big ? 30 : 16);
  floatText(g, x, y - 30, what + "-" + n + (n > 1 ? " TROOPS" : " TROOP"), "#e0342f");
  g.events.troopLost = true;
  if (g.player.troops <= 0) {
    g.player.troops = 0;
    endRun(g, saveBest);
  }
}

// ---------- Power-ups ----------
function takePowerup(g, type) {
  const p = POWERUPS[type];
  g.effects[type === "airstrike" ? "strike" : type] = p.time;
  g.powers[type] = true;
  g.events.power = type;
  floatText(g, g.player.x, PLAYER_Y - 40, p.label + "!", p.color);
  burst(g, g.player.x, PLAYER_Y - 20, p.color, 14);
}
// The airstrike lands: everything on the road dies, a boss is badly hurt.
function airstrike(g) {
  g.flash = 1;
  g.shake = 12;
  g.events.boom = true;
  for (const z of g.zombies) {
    if (z.hp <= 0 || z.y < -10) continue;
    z.hp = z.boss ? z.hp - Math.ceil(z.maxHp * STRIKE_BOSS) : 0;
    burst(g, z.x, z.y, "#ff8c4d", 6);
    if (z.hp <= 0) registerKill(g, z, "airstrike");
  }
  g.spits = [];
}

// ---------- Per-frame update ----------
// saveBest(best) is called once when a new best score is set, so each
// platform can persist it its own way (localStorage / AsyncStorage).
export function update(g, dt, saveBest) {
  g.events = freshEvents();
  g.elapsed += dt;
  g.shake = Math.max(0, g.shake - dt * 30);
  g.flash = Math.max(0, g.flash - dt * 2.5);
  g.banner.life = Math.max(0, g.banner.life - dt);

  // Power-up effects run down; the airstrike lands when its countdown ends.
  // A freeze holds the horde and its acid still, and nothing new arrives; the
  // wave clock keeps running.
  const fx = g.effects;
  const striking = fx.strike > 0;
  fx.freeze = Math.max(0, fx.freeze - dt);
  fx.rapid = Math.max(0, fx.rapid - dt);
  fx.strike = Math.max(0, fx.strike - dt);
  fx.chill = Math.max(0, fx.chill - dt);
  if (striking && fx.strike === 0) airstrike(g);
  const frozen = fx.freeze > 0;

  const half = formationHalfWidth(g);
  g.player.x = Math.max(ROAD_L + half, Math.min(ROAD_R - half, g.player.x));

  // Wave progression + boss arrivals every 3rd wave
  g.waveTimer -= dt;
  if (g.waveTimer <= 0) {
    g.wave++;
    g.waveTimer = WAVE_LEN;
    g.banner = { text: "WAVE " + g.wave, life: 2 };
    g.events.waveStart = true;
    if (g.wave % 3 === 0) {
      g.bossTier++;
      const cycle = (ENVS[g.env] || ENVS.bridge).bosses;
      const kind = cycle[(g.bossTier - 1) % cycle.length];
      spawnZombie(g, kind);
      g.banner = { text: kind.toUpperCase() + " INCOMING!", life: 2.2 };
      g.events.bossSpawn = true;
    }
  }

  // Squad volley - weapon shapes the pattern. Iced-up guns stay silent.
  const wp = WEAPONS[g.player.weapon] || WEAPONS.rifle;
  if (fx.chill <= 0) g.fireTimer -= dt;
  if (fx.chill <= 0 && g.fireTimer <= 0) {
    g.fireTimer = 1 / (g.player.fireRate * wp.rateMul * (fx.rapid > 0 ? 2 : 1));
    const dmg = Math.max(1, Math.round(g.player.damage * wp.dmgMul));
    for (const s of formationSpots(g.player.troops, g.player.x)) {
      for (let pi = 0; pi < wp.pellets; pi++) {
        const vx = wp.pellets > 1 ? (pi - (wp.pellets - 1) / 2) * 70 : 0;
        g.bullets.push({
          x: s.x + (Math.random() * 4 - 2), y: s.y - 16,
          dmg, vx, pierce: wp.pierce || 0, aoe: wp.aoe || 0, wkey: g.player.weapon,
        });
      }
    }
    g.events.shot = true;
  }
  for (const b of g.bullets) {
    b.y -= 520 * dt;
    b.x += (b.vx || 0) * dt;
  }
  g.bullets = g.bullets.filter((b) => b.y > -20);

  // Regular spawns: denser every wave, eased off a bit while a boss is up
  const bossAlive = g.zombies.some((z) => z.boss && z.hp > 0);
  if (!frozen) g.zombieTimer -= dt;
  if (g.zombieTimer <= 0) {
    let interval = Math.max(0.16, 0.85 - g.wave * 0.055);
    if (bossAlive) interval *= 1.7;
    g.zombieTimer = interval;
    const roll = rand(g, "spawns");
    const tankP = g.wave >= 5 ? Math.min(0.16, 0.03 + g.wave * 0.012) : 0;
    const runnerP = g.wave >= 3 ? Math.min(0.3, 0.06 + g.wave * 0.02) : 0;
    // the newer kinds take the top of the roll, so the older ones keep theirs
    const spitters = g.zombies.filter((z) => z.kind === "spitter" && z.hp > 0).length;
    const maxSpitters = MAX_SPITTERS + (lateWaves(g) >= LATE_SPITTER_WAVE ? 1 : 0);
    const spitterP = g.wave >= 8 && spitters < maxSpitters ? Math.min(0.07, 0.01 + g.wave * 0.005) : 0;
    const weaverP = g.wave >= 6 ? Math.min(0.1, 0.02 + g.wave * 0.007) : 0;
    const bomberP = g.wave >= 4 ? Math.min(0.1, 0.02 + g.wave * 0.008) : 0;
    let kind = "walker";
    if (roll < tankP) kind = "tank";
    else if (roll < tankP + runnerP) kind = "runner";
    else if (roll >= 1 - spitterP) kind = "spitter";
    else if (roll >= 1 - spitterP - weaverP) kind = "weaver";
    else if (roll >= 1 - spitterP - weaverP - bomberP) kind = "bomber";
    spawnZombie(g, kind);
  }

  // Power-up crates: one every so often, taken by steering the squad into it
  g.dropTimer -= dt;
  if (g.dropTimer <= 0) {
    g.dropTimer = 14 + rand(g, "drops") * 8;
    g.drops.push({
      x: ROAD_L + 30 + rand(g, "drops") * (ROAD_R - ROAD_L - 60),
      y: -20,
      type: POWERUP_KEYS[Math.floor(rand(g, "drops") * POWERUP_KEYS.length)],
    });
  }
  for (const d of g.drops) {
    d.y += DROP_SPEED * dt;
    if (d.y >= PLAYER_Y - 10 && d.y <= PLAYER_Y + 24 && Math.abs(d.x - g.player.x) < half + 16) {
      d.taken = true;
      takePowerup(g, d.type);
    }
  }
  g.drops = g.drops.filter((d) => !d.taken && d.y < H);

  g.gateTimer -= dt;
  if (g.gateTimer <= 0) {
    g.gateTimer = 6;
    spawnGatePair(g);
  }

  // Gates drift down; apply when they reach the squad
  for (const gate of g.gates) {
    gate.y += GATE_SPEED * dt;
    if (!gate.used && gate.y >= PLAYER_Y - 4) {
      gate.used = true;
      const chosen = g.player.x < ROAD_MID ? gate.left : gate.right;
      applyGateEffect(g, chosen);
      floatText(g, g.player.x, PLAYER_Y - 40, chosen.label, chosen.color);
      burst(g, g.player.x, PLAYER_Y - 20, chosen.color, 14);
      g.events.gate = chosen;
    }
  }
  g.gates = g.gates.filter((gate) => gate.y < H);

  // Zombies march; each stops at the first standing wall ahead of it and
  // chews through; summoners raise walkers as they advance
  for (const z of g.zombies) {
    if (frozen || z.hp <= 0) continue;
    let newY = z.y + z.speed * dt;
    if (z.kind === "spitter" && newY > SPIT_HOLD) newY = Math.max(z.y, SPIT_HOLD);
    let hitWall = null, stopAt = Infinity;
    for (const w of g.walls) {
      if (w.hp <= 0) continue;
      const line = w.y - 6;
      if (z.y <= line && newY >= line && line < stopAt) {
        stopAt = line;
        hitWall = w;
      }
    }
    if (hitWall && z.kind === "bomber") {
      // goes off against the wall: no kill, no score
      z.y = stopAt;
      z.hp = 0;
      g.events.boom = true;
      burst(g, z.x, z.y, "#ff8c4d", 18);
      damageWall(g, hitWall, hitWall.maxHp * BOMB_WALL);
      continue;
    }
    if (hitWall) {
      z.y = stopAt;
      damageWall(g, hitWall, (z.boss ? 30 : z.kind === "tank" ? 12 : 6) * (1 + g.wave * 0.06) * dt);
    } else {
      z.y = newY;
      if (z.kind === "weaver") {
        z.phase += dt * 2.6;
        z.x = z.cx + Math.sin(z.phase) * WEAVE;
      }
    }
    z.wob += dt * 8;
    if (z.kind === "spitter" && z.y > 60) {
      z.spitTimer -= dt;
      if (z.spitTimer <= 0) {
        // aimed at where the squad stands now, so moving on dodges it
        z.spitTimer = SPIT_EVERY * (1 - Math.min(LATE_SPIT_MAX, lateWaves(g) * LATE_SPIT));
        const dx = g.player.x - z.x, dy = PLAYER_Y - z.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        g.spits.push({ x: z.x, y: z.y, vx: (dx / dist) * SPIT_SPEED, vy: (dy / dist) * SPIT_SPEED });
        g.events.spit = true;
      }
    }
    if (z.kind === "yeti" && z.y > 40) {
      z.iceTimer -= dt;
      if (z.iceTimer <= 0) {
        // thrown like a spitter's acid: at where the squad stands now
        z.iceTimer = ICE_EVERY;
        const dx = g.player.x - z.x, dy = PLAYER_Y - z.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        g.spits.push({ x: z.x, y: z.y, vx: (dx / dist) * SPIT_SPEED, vy: (dy / dist) * SPIT_SPEED, ice: true });
        g.events.spit = true;
      }
    }
    if (z.kind === "summoner" && z.hp > 0 && z.y > 40) {
      z.summonTimer -= dt;
      if (z.summonTimer <= 0) {
        z.summonTimer = 2.5;
        for (let i = 0; i < 2; i++) {
          const m = spawnZombie(g, "walker", "minions");
          m.x = Math.max(ROAD_L + 15, Math.min(ROAD_R - 15, z.x + (i ? 26 : -26)));
          m.y = z.y + 6;
        }
        burst(g, z.x, z.y - 20, "#9a5fe0", 10);
        g.events.summon = true;
      }
    }
  }

  // Bullet hits - snipers pierce through, rockets splash
  for (const b of g.bullets) {
    for (const z of g.zombies) {
      if (z.hp <= 0) continue;
      const dx = b.x - z.x, dy = b.y - z.y;
      const r = z.size + 4;
      if (dx * dx + dy * dy < r * r) {
        z.hp -= b.dmg;
        if (z.hp <= 0) registerKill(g, z, b.wkey);
        if (b.aoe) {
          g.events.boom = true;
          burst(g, b.x, b.y, "#ff8c4d", 18);
          splash(g, b.x, b.y, b.aoe, Math.max(1, Math.round(b.dmg * 0.7)), b.wkey, z);
        }
        if (b.pierce > 0) b.pierce--;
        else b.y = -999;
        break;
      }
    }
  }
  g.bullets = g.bullets.filter((b) => b.y > -100);
  g.walls = g.walls.filter((w) => w.hp > 0);

  // Zombies reaching the squad. One that runs into the formation costs
  // troops; one that slips past the side of it and gets behind the squad
  // is a breach and costs the same, so dodging isn't a free pass.
  for (const z of g.zombies) {
    if (z.hp <= 0) continue;
    const hit = z.y >= PLAYER_Y - 8 && Math.abs(z.x - g.player.x) < half + z.size;
    const breached = z.y >= PLAYER_Y + 20;
    if (!hit && !breached) continue;
    z.hp = 0;
    loseTroops(g, z.troopCost, z.x, hit ? PLAYER_Y : PLAYER_Y + 20, hit ? "" : "BREACH ", z.boss, saveBest);
  }
  g.zombies = g.zombies.filter((z) => z.hp > 0 && z.y < H + 40);

  // Acid in flight: it costs a soldier if the squad is still under it when
  // it comes down, and splashes on the road if not. A yeti's ice costs no
  // one, but the squad it lands on cannot fire until it has shaken it off.
  for (const sp of g.spits) {
    if (frozen) break;
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
    if (sp.y < PLAYER_Y - 8) continue;
    sp.done = true;
    const onSquad = Math.abs(sp.x - g.player.x) < half + 8;
    if (!onSquad) burst(g, sp.x, PLAYER_Y, sp.ice ? "#bfe6ff" : "#b6e33c", 8);
    else if (!sp.ice) loseTroops(g, 1, sp.x, PLAYER_Y, "ACID ", false, saveBest);
    else {
      fx.chill = CHILL_TIME;
      g.shake = 6;
      g.events.chilled = true;
      burst(g, sp.x, PLAYER_Y, "#bfe6ff", 16);
      floatText(g, sp.x, PLAYER_Y - 30, "GUNS FROZEN!", "#7fd4ff");
    }
  }
  g.spits = g.spits.filter((sp) => !sp.done);
  for (const a of ACHIEVEMENTS) if (a.when && !g.achieved[a.id] && a.when(g)) unlock(g, a.id);

  for (const p of g.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  g.particles = g.particles.filter((p) => p.life > 0);
  for (const f of g.floaters) {
    f.y -= 40 * dt;
    f.life -= dt;
  }
  g.floaters = g.floaters.filter((f) => f.life > 0);
}
