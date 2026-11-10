// Bridge Horde - shared game logic.
// This file is pure JavaScript with no rendering or platform code, so the
// exact same logic runs in the browser dev page (web/dev.html) and in the
// React Native app (App.tsx). Tune gameplay here.

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

// ---------- Enemy catalog ----------
// hpMul scales off the adaptive hp base; spdMul off the wave-scaled speed.
// troopCost = soldiers lost if it reaches your line.
export const KIND_STATS = {
  walker:   { size: 13, hpMul: 0.75, spdMul: 1.0,  troopCost: 1, score: 1 },
  runner:   { size: 11, hpMul: 0.4,  spdMul: 1.8,  troopCost: 1, score: 2 },
  tank:     { size: 18, hpMul: 2.6,  spdMul: 0.55, troopCost: 2, score: 4 },
  brute:    { size: 30, hpMul: 9,    spdMul: 0.4,  troopCost: 3, score: 25, boss: true },
  summoner: { size: 26, hpMul: 7,    spdMul: 0.34, troopCost: 3, score: 30, boss: true },
  colossus: { size: 38, hpMul: 14,   spdMul: 0.26, troopCost: 5, score: 50, boss: true },
};
const BOSS_CYCLE = ["brute", "summoner", "colossus"];

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
    particles: [],
    floaters: [],
    events: freshEvents(),
    banner: { text: "", life: 0 }, // big center-screen announcement
    score: 0,
    kills: 0,
    best: 0,
    newBest: false,
    wave: 1,
    waveTimer: WAVE_LEN,
    bossTier: 0,
    elapsed: 0,
    shake: 0,
    fireTimer: 0,
    zombieTimer: 1.2,
    gateTimer: 3.5,
  };
}

export function resetRun(g) {
  const best = g.best;
  Object.assign(g, newGame());
  g.best = best;
  g.state = "playing";
  g.banner = { text: "WAVE 1", life: 2 };
}

// Back to the main menu with a clean bridge behind it (abandons any run).
export function toMenu(g) {
  const best = g.best;
  Object.assign(g, newGame());
  g.best = best;
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
  const maxHp = 50 + 22 * g.wave;
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
function makeGateEffect(g, allowBad) {
  if (allowBad && Math.random() < 0.45) {
    const v = -(2 + Math.floor(Math.random() * 3));
    return { label: v + " TROOPS", color: "#e0342f", bad: true, apply: () => changeTroops(g, v) };
  }
  const roll = Math.random();
  if (roll < 0.3) {
    const v = 2 + Math.floor(Math.random() * 4);
    return { label: "+" + v + " TROOPS", color: "#2ecc5e", apply: () => changeTroops(g, v) };
  } else if (roll < 0.48) {
    return { label: "DMG +1", color: "#3b9bff", apply: () => { g.player.damage++; } };
  } else if (roll < 0.66) {
    return {
      label: "FIRE RATE +",
      color: "#f5c211",
      apply: () => { g.player.fireRate = Math.min(8, g.player.fireRate * 1.2); },
    };
  } else if (roll < 0.78) {
    return { label: "BUILD WALL", color: "#4dd0c4", apply: () => buildWall(g) };
  } else if (roll < 0.92) {
    // a different gun, offered right in the gate
    const keys = Object.keys(WEAPONS).filter((k) => k !== g.player.weapon);
    const k = keys[Math.floor(Math.random() * keys.length)];
    const w = WEAPONS[k];
    return { label: w.label, color: w.color, apply: () => { g.player.weapon = k; g.events.pickup = k; } };
  }
  return { label: "TROOPS x2", color: "#b46bff", apply: () => changeTroops(g, g.player.troops) };
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

function spawnZombie(g, kind) {
  const st = KIND_STATS[kind];
  // HP tracks the player's firepower; the wave term is capped so falling
  // behind on upgrades doesn't compound into unkillable zombies.
  const hpBase = (2.2 + Math.min(g.wave, 12) * 0.45) * powerFactor(g);
  let hpMul = st.hpMul;
  let scoreVal = st.score;
  if (st.boss) {
    hpMul *= 1 + (g.bossTier - 1) * 0.35; // each boss cycle comes back tougher
    scoreVal += (g.bossTier - 1) * 10;
  }
  const baseSpeed = 40 + Math.random() * 18 + Math.min(32, g.wave * 2.5);
  const z = {
    x: ROAD_L + 20 + Math.random() * (ROAD_R - ROAD_L - 40),
    y: -30,
    kind,
    hp: Math.max(1, Math.ceil(hpBase * hpMul)),
    maxHp: 0,
    speed: baseSpeed * st.spdMul,
    size: st.size,
    boss: !!st.boss,
    big: !!st.boss || kind === "tank",
    troopCost: st.troopCost,
    scoreVal,
    wob: Math.random() * Math.PI * 2,
    summonTimer: kind === "summoner" ? 2.5 : 0,
  };
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

function registerKill(g, z) {
  if (z.scored) return;
  z.scored = true;
  g.kills++;
  g.score += z.scoreVal;
  const col = z.boss ? "#ffd84d" : z.kind === "tank" ? "#7fa08a" : "#5aa832";
  burst(g, z.x, z.y, col, z.boss ? 30 : z.big ? 22 : 8);
  if (z.boss) {
    g.events.bossDown = true;
    floatText(g, z.x, z.y - 30, "+" + z.scoreVal, "#ffd84d");
  } else if (z.big) g.events.bigKill = true;
  else g.events.kill = true;
}

// ---------- Per-frame update ----------
// saveBest(best) is called once when a new best score is set, so each
// platform can persist it its own way (localStorage / AsyncStorage).
export function update(g, dt, saveBest) {
  g.events = freshEvents();
  g.elapsed += dt;
  g.shake = Math.max(0, g.shake - dt * 30);
  g.banner.life = Math.max(0, g.banner.life - dt);

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
      const kind = BOSS_CYCLE[(g.bossTier - 1) % BOSS_CYCLE.length];
      spawnZombie(g, kind);
      g.banner = { text: kind.toUpperCase() + " INCOMING!", life: 2.2 };
      g.events.bossSpawn = true;
    }
  }

  // Squad volley - weapon shapes the pattern
  const wp = WEAPONS[g.player.weapon] || WEAPONS.rifle;
  g.fireTimer -= dt;
  if (g.fireTimer <= 0) {
    g.fireTimer = 1 / (g.player.fireRate * wp.rateMul);
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
  g.zombieTimer -= dt;
  if (g.zombieTimer <= 0) {
    let interval = Math.max(0.16, 0.85 - g.wave * 0.055);
    if (bossAlive) interval *= 1.7;
    g.zombieTimer = interval;
    const roll = Math.random();
    const tankP = g.wave >= 5 ? Math.min(0.16, 0.03 + g.wave * 0.012) : 0;
    const runnerP = g.wave >= 3 ? Math.min(0.3, 0.06 + g.wave * 0.02) : 0;
    let kind = "walker";
    if (roll < tankP) kind = "tank";
    else if (roll < tankP + runnerP) kind = "runner";
    spawnZombie(g, kind);
  }

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
      chosen.apply();
      floatText(g, g.player.x, PLAYER_Y - 40, chosen.label, chosen.color);
      burst(g, g.player.x, PLAYER_Y - 20, chosen.color, 14);
      g.events.gate = chosen;
    }
  }
  g.gates = g.gates.filter((gate) => gate.y < H);

  // Zombies march; each stops at the first standing wall ahead of it and
  // chews through; summoners raise walkers as they advance
  for (const z of g.zombies) {
    const newY = z.y + z.speed * dt;
    let hitWall = null, stopAt = Infinity;
    for (const w of g.walls) {
      if (w.hp <= 0) continue;
      const line = w.y - 6;
      if (z.y <= line && newY >= line && line < stopAt) {
        stopAt = line;
        hitWall = w;
      }
    }
    if (hitWall) {
      z.y = stopAt;
      hitWall.hp -= (z.boss ? 30 : z.kind === "tank" ? 12 : 6) * (1 + g.wave * 0.06) * dt;
      if (hitWall.hp <= 0) {
        burst(g, ROAD_MID, hitWall.y - 10, "#8a6b42", 24);
        floatText(g, ROAD_MID, hitWall.y - 30, "WALL DOWN!", "#e0342f");
        g.events.wallDown = true;
      }
    } else {
      z.y = newY;
    }
    z.wob += dt * 8;
    if (z.kind === "summoner" && z.hp > 0 && z.y > 40) {
      z.summonTimer -= dt;
      if (z.summonTimer <= 0) {
        z.summonTimer = 2.5;
        for (let i = 0; i < 2; i++) {
          const m = spawnZombie(g, "walker");
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
        if (z.hp <= 0) registerKill(g, z);
        if (b.aoe) {
          g.events.boom = true;
          burst(g, b.x, b.y, "#ff8c4d", 18);
          const splash = Math.max(1, Math.round(b.dmg * 0.7));
          for (const o of g.zombies) {
            if (o === z || o.hp <= 0) continue;
            const ox = o.x - b.x, oy = o.y - b.y;
            if (ox * ox + oy * oy < b.aoe * b.aoe) {
              o.hp -= splash;
              if (o.hp <= 0) registerKill(g, o);
            }
          }
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
    g.player.troops -= z.troopCost;
    g.shake = z.boss ? 12 : 6;
    const fy = hit ? PLAYER_Y : PLAYER_Y + 20;
    burst(g, z.x, fy, "#e0342f", z.boss ? 30 : 16);
    const label = "-" + z.troopCost + (z.troopCost > 1 ? " TROOPS" : " TROOP");
    floatText(g, z.x, fy - 30, hit ? label : "BREACH " + label, "#e0342f");
    g.events.troopLost = true;
    if (g.player.troops <= 0) {
      g.player.troops = 0;
      g.state = "gameover";
      if (g.score > g.best) {
        g.best = g.score;
        g.newBest = true;
        if (saveBest) saveBest(g.best);
      }
    }
  }
  g.zombies = g.zombies.filter((z) => z.hp > 0 && z.y < H + 40);

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
