/* eslint-env jest */
/**
 * @format
 */

import * as G from '../game/core';

// A run in progress. update(g, 0) runs one frame without moving anything,
// which makes single rules easy to check in isolation.
function run(over = {}) {
  const g = G.newGame();
  G.resetRun(g);
  Object.assign(g, over);
  return g;
}
const zombie = (over = {}) => ({
  x: G.ROAD_MID, y: 100, kind: 'walker', hp: 1e6, maxHp: 1e6, speed: 0, size: 13,
  boss: false, big: false, troopCost: 1, scoreVal: 1, wob: 0, summonTimer: 0, ...over,
});
const gate = (left, right, y = G.PLAYER_Y) => ({
  y, used: false,
  left: { label: 'L', color: '#fff', ...left },
  right: { label: 'R', color: '#fff', ...right },
});
// Math.random() returns the given values in turn, then keeps the last one.
function random(...values) {
  let i = 0;
  return jest.spyOn(Math, 'random').mockImplementation(() => values[Math.min(i++, values.length - 1)]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('run lifecycle', () => {
  test('resetRun starts a fresh run and keeps the best score', () => {
    const g = G.newGame();
    g.best = 77;
    g.score = 12;
    G.resetRun(g);
    expect(g.state).toBe('playing');
    expect(g.score).toBe(0);
    expect(g.best).toBe(77);
    expect(g.wave).toBe(1);
    expect(g.player.troops).toBe(1);
  });

  test('pause toggles only between playing and paused', () => {
    const g = run();
    G.togglePause(g);
    expect(g.state).toBe('paused');
    G.togglePause(g);
    expect(g.state).toBe('playing');
    g.state = 'gameover';
    G.togglePause(g);
    expect(g.state).toBe('gameover');
  });

  test('leaving a paused run keeps it; leaving a finished one clears it', () => {
    const g = run({ score: 40, best: 90 });
    expect(G.hasRun(g)).toBe(false);
    G.togglePause(g);
    expect(G.hasRun(g)).toBe(true);
    G.toMenu(g);
    expect(g.state).toBe('menu');
    expect(g.inRun).toBe(true);
    expect(g.score).toBe(40);
    expect(G.hasRun(g)).toBe(true);
    G.resumeRun(g);
    expect(g.state).toBe('playing');
    expect(g.inRun).toBe(false);

    g.state = 'gameover';
    G.toMenu(g);
    expect(g.state).toBe('menu');
    expect(g.inRun).toBe(false);
    expect(g.score).toBe(0);
    expect(g.best).toBe(90);
    G.resumeRun(g); // nothing to resume
    expect(g.state).toBe('menu');
  });

  test('a saved run loads back as a run waiting behind the menu', () => {
    const g = run({ score: 123, wave: 4, best: 50 });
    g.player.troops = 9;
    g.walls.push({ y: G.WALL_SLOTS[0], hp: 10, maxHp: 60 });
    g.gates.push(gate({ type: 'damage' }, { type: 'wall' }, 80));
    g.events.gate = g.gates[0].left;
    const fresh = G.newGame();
    fresh.best = 200;
    expect(G.loadRun(fresh, G.saveRun(g))).toBe(true);
    expect(fresh.state).toBe('menu');
    expect(fresh.inRun).toBe(true);
    expect(fresh.score).toBe(123);
    expect(fresh.wave).toBe(4);
    expect(fresh.player.troops).toBe(9);
    expect(fresh.walls).toEqual(g.walls);
    expect(fresh.gates).toEqual(g.gates);
    expect(fresh.events.gate).toBeNull(); // one-frame events are not carried over
    expect(fresh.best).toBe(200); // the higher best wins
  });

  test('loadRun rejects anything that is not a saved run', () => {
    const g = G.newGame();
    expect(G.loadRun(g, 'not json')).toBe(false);
    expect(G.loadRun(g, 'null')).toBe(false);
    expect(G.loadRun(g, JSON.stringify({ v: 99, run: run() }))).toBe(false);
    expect(G.loadRun(g, JSON.stringify({ v: 1, run: { player: {}, zombies: [] } }))).toBe(false);
    expect(g.state).toBe('menu');
    expect(g.inRun).toBe(false);
  });
});

describe('squad', () => {
  test('formation is rows of seven, centred on the squad', () => {
    const spots = G.formationSpots(9, 200);
    expect(spots).toHaveLength(9);
    expect(spots.slice(0, 7).every((s) => s.y === G.PLAYER_Y)).toBe(true);
    expect(spots[3].x).toBe(200); // middle of the full first row
    expect(spots[7].y).toBeGreaterThan(G.PLAYER_Y);
    expect((spots[7].x + spots[8].x) / 2).toBe(200); // short row is centred too
  });

  test('the squad is kept on the road', () => {
    const g = run();
    g.player.x = -500;
    G.update(g, 0);
    expect(g.player.x).toBe(G.ROAD_L + G.formationHalfWidth(g));
    g.player.troops = 7;
    g.player.x = 5000;
    G.update(g, 0);
    expect(g.player.x).toBe(G.ROAD_R - G.formationHalfWidth(g));
  });

  test('each soldier fires one shot per volley, a shotgun three', () => {
    const g = run();
    g.player.troops = 4;
    G.update(g, 0);
    expect(g.bullets).toHaveLength(4);
    expect(g.events.shot).toBe(true);
    const s = run();
    s.player.troops = 4;
    s.player.weapon = 'shotgun';
    G.update(s, 0);
    expect(s.bullets).toHaveLength(12);
  });
});

describe('wave scaling', () => {
  test('a wave lasts WAVE_LEN seconds', () => {
    const g = run({ zombieTimer: 1e9, gateTimer: 1e9 });
    for (let t = 0; t < G.WAVE_LEN - 0.5; t += 0.05) G.update(g, 0.05);
    expect(g.wave).toBe(1);
    let started = false;
    for (let t = 0; t < 1; t += 0.05) {
      G.update(g, 0.05);
      started = started || g.events.waveStart;
    }
    expect(g.wave).toBe(2);
    expect(started).toBe(true);
    expect(g.banner.text).toBe('WAVE 2');
  });

  test('every third wave brings a boss, cycling brute, summoner, colossus', () => {
    const g = run({ zombieTimer: 1e9, gateTimer: 1e9 });
    const bosses = [];
    for (let wave = 2; wave <= 12; wave++) {
      g.waveTimer = 0;
      G.update(g, 0);
      expect(g.wave).toBe(wave);
      expect(g.events.bossSpawn).toBe(wave % 3 === 0);
      if (g.events.bossSpawn) bosses.push(g.zombies[g.zombies.length - 1]);
    }
    expect(bosses.map((z) => z.kind)).toEqual(['brute', 'summoner', 'colossus', 'brute']);
    expect(bosses.every((z) => z.boss)).toBe(true);
    // the second time around a boss is tougher and worth more
    expect(bosses[3].hp).toBeGreaterThan(bosses[0].hp);
    expect(bosses[3].scoreVal).toBe(G.KIND_STATS.brute.score + 30);
  });

  test('spawns get denser each wave, down to a floor, and ease off for a boss', () => {
    const interval = (wave, boss) => {
      const g = run({ wave, zombieTimer: 0, gateTimer: 1e9 });
      if (boss) g.zombies.push(zombie({ boss: true, y: -30 }));
      G.update(g, 0);
      return g.zombieTimer;
    };
    expect(interval(1)).toBeCloseTo(0.795);
    expect(interval(5)).toBeLessThan(interval(1));
    expect(interval(13)).toBeCloseTo(0.16);
    expect(interval(40)).toBeCloseTo(0.16);
    expect(interval(5, true)).toBeCloseTo(interval(5) * 1.7);
  });

  test('runners arrive at wave 3 and tanks at wave 5', () => {
    const spawned = (wave) => {
      random(0); // lowest roll: the rarest kind available
      const g = run({ wave, zombieTimer: 0, gateTimer: 1e9 });
      G.update(g, 0);
      jest.restoreAllMocks();
      return g.zombies[0].kind;
    };
    expect(spawned(1)).toBe('walker');
    expect(spawned(2)).toBe('walker');
    expect(spawned(3)).toBe('runner');
    expect(spawned(4)).toBe('runner');
    expect(spawned(5)).toBe('tank');
  });

  test('zombie health follows the squad firepower; the wave part is capped', () => {
    const walker = (wave, setup) => {
      random(0.5);
      const g = run({ wave, zombieTimer: 0, gateTimer: 1e9 });
      if (setup) setup(g.player);
      G.update(g, 0);
      jest.restoreAllMocks();
      return g.zombies[0];
    };
    const weak = walker(1);
    expect(weak.kind).toBe('walker');
    expect(weak.hp).toBe(3);
    expect(weak.maxHp).toBe(weak.hp);
    const strong = walker(1, (p) => { p.troops = 20; p.damage = 5; });
    expect(strong.hp).toBe(12); // 100x the damage output, 4x the health
    expect(walker(8).hp).toBeGreaterThan(weak.hp);
    expect(walker(30).hp).toBe(walker(12).hp);
    // speed also rises with the wave, up to a cap
    expect(walker(8).speed).toBeGreaterThan(weak.speed);
    expect(walker(30).speed).toBe(walker(13).speed);
  });
});

describe('gates', () => {
  // One frame with a gate at the squad's line, squad on the given side.
  const take = (g, side, left, right) => {
    g.gates = [gate(left, right)];
    g.player.x = side === 'left' ? G.ROAD_MID - 60 : G.ROAD_MID + 60;
    G.update(g, 0);
    return g;
  };

  test('the first gate arrives a few seconds in and then every six', () => {
    const g = run({ zombieTimer: 1e9 });
    for (let t = 0; t < 3.4; t += 0.05) G.update(g, 0.05);
    expect(g.gates).toHaveLength(0);
    for (let t = 0; t < 0.3; t += 0.05) G.update(g, 0.05);
    expect(g.gates).toHaveLength(1);
    expect(g.gateTimer).toBeGreaterThan(5.5);
  });

  test('a new pair never offers the same thing twice, and only the right side can be bad', () => {
    for (let i = 0; i < 200; i++) {
      const g = run({ gateTimer: 0, zombieTimer: 1e9 });
      G.update(g, 0);
      const pair = g.gates[0];
      expect(pair.left.label).not.toBe(pair.right.label);
      expect(pair.left.bad).toBeUndefined();
      if (pair.right.bad) expect(pair.right.v).toBeLessThan(0);
    }
  });

  test('the side the squad stands on is the one applied, once', () => {
    const g = take(run(), 'left', { type: 'damage' }, { type: 'troops', v: 5 });
    expect(g.player.damage).toBe(2);
    expect(g.player.troops).toBe(1);
    expect(g.events.gate).toBe(g.gates[0].left);
    expect(g.gates[0].used).toBe(true);
    G.update(g, 0);
    expect(g.player.damage).toBe(2);
    expect(g.events.gate).toBeNull();

    const r = take(run(), 'right', { type: 'damage' }, { type: 'troops', v: 5 });
    expect(r.player.damage).toBe(1);
    expect(r.player.troops).toBe(6);
  });

  test('a gate does nothing until it reaches the squad, and leaves at the bottom', () => {
    const g = run({ zombieTimer: 1e9, gateTimer: 1e9 });
    g.gates = [gate({ type: 'damage' }, { type: 'damage' }, G.PLAYER_Y - 30)];
    G.update(g, 0.05);
    expect(g.player.damage).toBe(1);
    for (let t = 0; t < 1; t += 0.05) G.update(g, 0.05);
    expect(g.player.damage).toBe(2);
    for (let t = 0; t < 3; t += 0.05) G.update(g, 0.05);
    expect(g.gates).toHaveLength(0);
  });

  test('troop gates stay between one soldier and the squad limit', () => {
    const g = run();
    g.player.troops = 3;
    take(g, 'left', { type: 'troops', v: -5 }, {});
    expect(g.player.troops).toBe(1);
    g.player.troops = 20;
    take(g, 'left', { type: 'double' }, {});
    expect(g.player.troops).toBe(G.MAX_TROOPS);
    g.player.troops = 6;
    take(g, 'left', { type: 'double' }, {});
    expect(g.player.troops).toBe(12);
  });

  test('fire rate grows by a fifth and is capped', () => {
    const g = take(run(), 'left', { type: 'rate' }, {});
    expect(g.player.fireRate).toBeCloseTo(3);
    g.player.fireRate = 7.5;
    take(g, 'left', { type: 'rate' }, {});
    expect(g.player.fireRate).toBe(8);
  });

  test('weapon and wall gates', () => {
    const g = take(run(), 'right', {}, { type: 'weapon', v: 'sniper' });
    expect(g.player.weapon).toBe('sniper');
    expect(g.events.pickup).toBe('sniper');
    take(g, 'right', {}, { type: 'wall' });
    expect(g.walls).toHaveLength(1);
    expect(g.events.wallBuilt).toBe(true);
  });
});

describe('walls', () => {
  test('walls fill the three slots nearest first; a fourth repairs the weakest', () => {
    const g = run({ wave: 2 });
    G.buildWall(g);
    G.buildWall(g);
    G.buildWall(g);
    expect(g.walls.map((w) => w.y)).toEqual(G.WALL_SLOTS);
    expect(g.walls[0].maxHp).toBe(50 + 22 * 2);
    g.walls[0].hp = 60;
    g.walls[1].hp = 10;
    g.wave = 5;
    G.buildWall(g);
    expect(g.walls).toHaveLength(3);
    expect(g.walls[1].hp).toBe(50 + 22 * 5);
    expect(g.walls[1].maxHp).toBe(50 + 22 * 5);
    expect(g.walls[0].hp).toBe(60);
  });

  test('a destroyed wall frees its slot', () => {
    const g = run();
    G.buildWall(g);
    G.buildWall(g);
    g.walls[0].hp = 0;
    G.update(g, 0);
    expect(g.walls.map((w) => w.y)).toEqual([G.WALL_SLOTS[1]]);
    G.buildWall(g);
    expect(g.walls.map((w) => w.y)).toEqual([G.WALL_SLOTS[1], G.WALL_SLOTS[0]]);
  });

  test('a zombie stops at a wall and chews through it', () => {
    const g = run({ zombieTimer: 1e9, gateTimer: 1e9 });
    G.buildWall(g);
    const wall = g.walls[0];
    const line = wall.y - 6;
    const z = zombie({ y: line - 3, speed: 100 });
    g.zombies.push(z);
    G.update(g, 0.05);
    expect(z.y).toBe(line);
    expect(wall.hp).toBeCloseTo(wall.maxHp - 6 * 1.06 * 0.05);
    for (let i = 0; i < 10; i++) G.update(g, 0.05);
    expect(z.y).toBe(line); // still held
    // once it falls the zombie walks on
    wall.hp = 0.01;
    G.update(g, 0.05);
    expect(g.events.wallDown).toBe(true);
    expect(g.walls).toHaveLength(0);
    G.update(g, 0.05);
    expect(z.y).toBeGreaterThan(line);
  });

  test('tanks and bosses break walls faster', () => {
    const damage = (over) => {
      const g = run({ zombieTimer: 1e9, gateTimer: 1e9 });
      G.buildWall(g);
      g.zombies.push(zombie({ y: g.walls[0].y - 7, speed: 100, ...over }));
      G.update(g, 0.05);
      return g.walls[0].maxHp - g.walls[0].hp;
    };
    const walker = damage();
    expect(damage({ kind: 'tank' })).toBeCloseTo(walker * 2);
    expect(damage({ boss: true })).toBeCloseTo(walker * 5);
  });
});

describe('combat', () => {
  const bullet = (over = {}) => ({ x: G.ROAD_MID, y: 100, dmg: 1, vx: 0, pierce: 0, aoe: 0, wkey: 'rifle', ...over });
  // a quiet run: the squad itself does not fire
  const quiet = (over) => run({ fireTimer: 1e9, zombieTimer: 1e9, gateTimer: 1e9, ...over });

  test('a kill scores once and the bullet is spent', () => {
    const g = quiet();
    g.zombies.push(zombie({ hp: 1, scoreVal: 4 }));
    g.bullets.push(bullet(), bullet());
    G.update(g, 0);
    expect(g.kills).toBe(1);
    expect(g.score).toBe(4);
    expect(g.events.kill).toBe(true);
    expect(g.zombies).toHaveLength(0);
    expect(g.bullets).toHaveLength(1); // the second had nothing left to hit
  });

  test('a piercing bullet carries on to the next zombie', () => {
    const g = quiet();
    g.zombies.push(zombie({ hp: 1 }), zombie({ hp: 1 }));
    g.bullets.push(bullet({ pierce: 1 }));
    G.update(g, 0);
    expect(g.kills).toBe(1);
    expect(g.bullets).toHaveLength(1);
    G.update(g, 0);
    expect(g.kills).toBe(2);
    expect(g.bullets).toHaveLength(0);
  });

  test('a rocket splashes zombies near the one it hits', () => {
    const g = quiet();
    const near = zombie({ x: G.ROAD_MID + 40, hp: 5 });
    const far = zombie({ x: G.ROAD_MID + 100, hp: 5 });
    g.zombies.push(zombie({ hp: 5 }), near, far);
    g.bullets.push(bullet({ dmg: 10, aoe: 60 }));
    G.update(g, 0);
    expect(g.events.boom).toBe(true);
    expect(g.kills).toBe(2);
    expect(near.hp).toBeLessThanOrEqual(0);
    expect(far.hp).toBe(5);
  });

  test('a summoner raises two walkers at a time', () => {
    const g = quiet();
    g.zombies.push(zombie({ kind: 'summoner', boss: true, summonTimer: 0.01 }));
    G.update(g, 0.05);
    expect(g.events.summon).toBe(true);
    expect(g.zombies.map((z) => z.kind)).toEqual(['summoner', 'walker', 'walker']);
  });
});

describe('losing troops', () => {
  const quiet = (troops) => {
    const g = run({ fireTimer: 1e9, zombieTimer: 1e9, gateTimer: 1e9 });
    g.player.troops = troops;
    return g;
  };

  test('a zombie reaching the formation costs its troop cost', () => {
    const g = quiet(5);
    g.zombies.push(zombie({ y: G.PLAYER_Y - 8, troopCost: 2 }));
    G.update(g, 0);
    expect(g.player.troops).toBe(3);
    expect(g.events.troopLost).toBe(true);
    expect(g.zombies).toHaveLength(0);
    expect(g.state).toBe('playing');
    expect(g.kills).toBe(0);
  });

  test('one that slips past the side only costs troops once it is behind the squad', () => {
    const g = quiet(5);
    const z = zombie({ x: G.ROAD_R - 20, y: G.PLAYER_Y - 8 });
    g.player.x = G.ROAD_L + 30;
    g.zombies.push(z);
    G.update(g, 0);
    expect(g.player.troops).toBe(5);
    z.y = G.PLAYER_Y + 20;
    G.update(g, 0);
    expect(g.player.troops).toBe(4);
    expect(g.floaters.some((f) => f.text.startsWith('BREACH'))).toBe(true);
  });

  test('losing the last soldier ends the run and reports a new best', () => {
    const g = quiet(2);
    g.score = 50;
    g.best = 10;
    g.zombies.push(zombie({ y: G.PLAYER_Y - 8, troopCost: 3 }));
    const saveBest = jest.fn();
    G.update(g, 0, saveBest);
    expect(g.state).toBe('gameover');
    expect(g.player.troops).toBe(0);
    expect(g.best).toBe(50);
    expect(g.newBest).toBe(true);
    expect(saveBest).toHaveBeenCalledTimes(1);
    expect(saveBest).toHaveBeenCalledWith(50);
  });

  test('a run below the best leaves it alone', () => {
    const g = quiet(1);
    g.score = 5;
    g.best = 10;
    g.zombies.push(zombie({ y: G.PLAYER_Y - 8 }));
    const saveBest = jest.fn();
    G.update(g, 0, saveBest);
    expect(g.state).toBe('gameover');
    expect(g.best).toBe(10);
    expect(g.newBest).toBe(false);
    expect(saveBest).not.toHaveBeenCalled();
  });
});

describe('coins and upgrades', () => {
  test('a finished run pays coins for its score and wave', () => {
    expect(G.coinsFor(0, 1)).toBe(0);
    expect(G.coinsFor(259, 6)).toBe(25 + 10);
    const g = run({ score: 259, wave: 4, coins: 7 });
    g.zombies.push(zombie({ y: G.PLAYER_Y - 8 }));
    G.update(g, 0);
    expect(g.state).toBe('gameover');
    expect(g.earned).toBe(31);
    expect(g.coins).toBe(38);
    // coins and upgrades outlive the run; the payout line does not
    g.upgrades.wall = 2;
    G.toMenu(g);
    expect(g.coins).toBe(38);
    expect(g.earned).toBe(0);
    expect(g.upgrades.wall).toBe(2);
  });

  test('buying costs coins and stops at the top level', () => {
    const g = G.newGame();
    const [first, second] = G.UPGRADES.troops.costs;
    g.coins = first + second - 1;
    expect(G.upgradeCost(g, 'troops')).toBe(first);
    expect(G.buyUpgrade(g, 'troops')).toBe(true);
    expect(g.upgrades.troops).toBe(1);
    expect(g.coins).toBe(second - 1);
    expect(G.buyUpgrade(g, 'troops')).toBe(false); // one coin short
    expect(g.upgrades.troops).toBe(1);
    expect(g.coins).toBe(second - 1);
    g.coins = 1e6;
    g.upgrades.damage = G.UPGRADES.damage.costs.length;
    expect(G.upgradeCost(g, 'damage')).toBeNull();
    expect(G.buyUpgrade(g, 'damage')).toBe(false);
    expect(g.coins).toBe(1e6);
  });

  test('a new run starts with the bought troops and damage', () => {
    const g = G.newGame();
    g.upgrades = { troops: 3, damage: 2, wall: 0 };
    G.resetRun(g);
    expect(g.player.troops).toBe(4);
    expect(g.player.damage).toBe(3);
    G.resetRun(g); // not added twice
    expect(g.player.troops).toBe(4);
    expect(g.player.damage).toBe(3);
  });

  test('wall strength makes every wall tougher', () => {
    const g = run({ wave: 2 });
    g.upgrades.wall = 3;
    G.buildWall(g);
    expect(g.walls[0].maxHp).toBe(Math.round((50 + 22 * 2) * (1 + 3 * G.WALL_BONUS)));
    expect(g.walls[0].hp).toBe(g.walls[0].maxHp);
  });

  test('coins and upgrades save and load', () => {
    const g = G.newGame();
    g.coins = 310;
    g.upgrades = { troops: 2, damage: 1, wall: 4 };
    const fresh = G.newGame();
    fresh.coins = 5; // earned before the stored copy arrived
    expect(G.loadMeta(fresh, G.saveMeta(g))).toBe(true);
    expect(fresh.coins).toBe(315);
    expect(fresh.upgrades).toEqual({ troops: 2, damage: 1, wall: 4 });
  });

  test('loadMeta ignores junk and keeps levels in range', () => {
    const g = G.newGame();
    expect(G.loadMeta(g, 'not json')).toBe(false);
    expect(G.loadMeta(g, 'null')).toBe(false);
    expect(G.loadMeta(g, JSON.stringify({ v: 99, coins: 50 }))).toBe(false);
    expect(g.coins).toBe(0);
    expect(G.loadMeta(g, JSON.stringify({ v: 1, coins: -20, upgrades: { troops: 99, damage: 'x', wall: 1.7 } }))).toBe(true);
    expect(g.coins).toBe(0);
    expect(g.upgrades).toEqual({ troops: G.UPGRADES.troops.costs.length, damage: 0, wall: 1 });
  });

  test('loading a saved run leaves coins and upgrades alone', () => {
    const old = run({ score: 30, coins: 100 });
    const saved = G.saveRun(old);
    const g = G.newGame();
    g.coins = 20; // spent since the run was saved
    g.upgrades.troops = 2;
    expect(G.loadRun(g, saved)).toBe(true);
    expect(g.score).toBe(30);
    expect(g.coins).toBe(20);
    expect(g.upgrades.troops).toBe(2);
  });
});

describe('daily challenge', () => {
  const DAY = 20766;
  // Play a run hands-off for a while and note what came down the bridge. The
  // squad is kept at the given size, so the run lasts.
  const play = (g, seconds, troops = 12) => {
    const seen = { gates: [], zombies: [] };
    for (let t = 0; t < seconds; t += 0.05) {
      const gates = g.gates.length, zombies = g.zombies.length;
      g.player.troops = troops;
      G.update(g, 0.05);
      if (g.state !== 'playing') break;
      if (g.gates.length > gates) seen.gates.push(g.gates[g.gates.length - 1]);
      if (g.zombies.length > zombies) seen.zombies.push(g.zombies[g.zombies.length - 1]);
    }
    return {
      gates: seen.gates.map((p) => p.left.label + ' | ' + p.right.label),
      zombies: seen.zombies.map((z) => [z.kind, z.x, z.speed]),
    };
  };
  const daily = (day = DAY) => {
    const g = G.newGame();
    G.resetRun(g, day);
    return g;
  };
  // A squad that holds its fire, so every zombie that arrives is seen by play().
  const silent = (g) => Object.assign(g, { fireTimer: 1e9 });

  test('days are UTC days', () => {
    const midnight = Date.UTC(2026, 10, 9);
    expect(G.dayOf(midnight)).toBe(DAY);
    expect(G.dayOf(midnight - 1)).toBe(DAY - 1);
    expect(G.dayEnd(DAY)).toBe(midnight + G.DAY_MS);
  });

  test('the same day gives the same gates and horde, whatever Math.random does', () => {
    const first = play(silent(daily()), 40);
    random(0.99);
    const second = play(silent(daily()), 40);
    expect(first.gates.length).toBeGreaterThan(5);
    expect(first.zombies.length).toBeGreaterThan(20);
    expect(second).toEqual(first);
  });

  test('another day, or an ordinary run, is different', () => {
    const today = play(silent(daily()), 40);
    const tomorrow = play(silent(daily(DAY + 1)), 40);
    expect(tomorrow.gates).not.toEqual(today.gates);
    expect(tomorrow.zombies).not.toEqual(today.zombies);
    expect(play(silent(run()), 40).zombies).not.toEqual(today.zombies);
  });

  test('what the squad does to the horde does not change the gates', () => {
    const calm = play(daily(), 40);
    const g = daily();
    g.zombies.push(zombie({ kind: 'summoner', boss: true, summonTimer: 0.01, y: 60 })); // raises walkers
    const busy = play(g, 40, 30); // a bigger squad: tougher zombies, other kills
    expect(busy.zombies).not.toEqual(calm.zombies);
    expect(busy.gates).toEqual(calm.gates);
  });

  test('a daily run starts without the bought upgrades', () => {
    const g = G.newGame();
    g.upgrades = { troops: 3, damage: 2, wall: 4 };
    G.resetRun(g, DAY);
    expect(g.daily).toBe(DAY);
    expect(g.player.troops).toBe(1);
    expect(g.player.damage).toBe(1);
    expect(g.banner.text).toBe('DAILY CHALLENGE');
    G.buildWall(g);
    expect(g.walls[0].maxHp).toBe(50 + 22);
    // the next ordinary run has them again
    G.resetRun(g);
    expect(g.daily).toBeNull();
    expect(g.rng).toBeNull();
    expect(g.player.troops).toBe(4);
  });

  test('a saved daily run carries on with the same seed', () => {
    const whole = daily();
    play(whole, 20);
    const half = daily();
    play(half, 10);
    const loaded = G.newGame();
    expect(G.loadRun(loaded, G.saveRun(half))).toBe(true);
    expect(loaded.daily).toBe(DAY);
    G.resumeRun(loaded);
    play(loaded, 10);
    expect(loaded.rng).toEqual(whole.rng);
  });

  const lose = (g) => {
    g.zombies.push(zombie({ y: G.PLAYER_Y - 8, troopCost: 99 }));
    G.update(g, 0);
    expect(g.state).toBe('gameover');
    return g;
  };

  test('the best daily score is kept per day, next to the overall best', () => {
    const g = daily();
    g.best = 500;
    g.score = 120;
    lose(g);
    expect(g.dailyBest).toEqual({ day: DAY, best: 120 });
    expect(g.newDailyBest).toBe(true);
    expect(g.newBest).toBe(false);
    // a lower score the same day changes nothing
    G.resetRun(g, DAY);
    expect(g.newDailyBest).toBe(false);
    g.score = 80;
    lose(g);
    expect(g.dailyBest).toEqual({ day: DAY, best: 120 });
    expect(g.newDailyBest).toBe(false);
    // the next day starts from nothing; an ordinary run never counts
    G.resetRun(g, DAY + 1);
    g.score = 30;
    lose(g);
    expect(g.dailyBest).toEqual({ day: DAY + 1, best: 30 });
    G.resetRun(g);
    g.score = 400;
    lose(g);
    expect(g.dailyBest).toEqual({ day: DAY + 1, best: 30 });
    // a run saved yesterday and finished today does not replace today's best
    G.resetRun(g, DAY);
    g.score = 999;
    lose(g);
    expect(g.dailyBest).toEqual({ day: DAY + 1, best: 30 });
    expect(g.newDailyBest).toBe(false);
    expect(g.best).toBe(999); // it is still a run like any other
  });
});

describe('achievements', () => {
  const quiet = (over) => run({ fireTimer: 1e9, zombieTimer: 1e9, gateTimer: 1e9, ...over });
  const bullet = (wkey) => ({ x: G.ROAD_MID, y: 100, dmg: 1, vx: 0, pierce: 0, aoe: 0, wkey });
  const coinsOf = (...ids) => ids.reduce((sum, id) => sum + G.ACHIEVEMENTS.find((a) => a.id === id).coins, 0);

  test('ids are unique and every one pays coins', () => {
    const ids = G.ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of G.ACHIEVEMENTS) {
      expect(a.coins).toBeGreaterThan(0);
      expect(a.label && a.desc).toBeTruthy();
    }
  });

  test('a fresh run unlocks nothing', () => {
    const g = quiet();
    G.update(g, 0);
    expect(g.achieved).toEqual({});
    expect(g.events.achieved).toEqual([]);
  });

  test('an achievement unlocks once, pays its coins and is reported for one frame', () => {
    const g = quiet({ wave: 5, hits: 1 });
    G.update(g, 0);
    expect(g.events.achieved).toEqual(['wave5']);
    expect(g.achieved).toEqual({ wave5: true });
    expect(g.coins).toBe(coinsOf('wave5'));
    G.update(g, 0);
    expect(g.events.achieved).toEqual([]);
    expect(g.coins).toBe(coinsOf('wave5'));
    // it stays unlocked, and unpaid, in every later run
    G.resetRun(g);
    g.wave = 5;
    g.hits = 1;
    G.update(g, 0);
    expect(g.events.achieved).toEqual([]);
    expect(g.coins).toBe(coinsOf('wave5'));
  });

  test('reaching wave 5 before a zombie gets through', () => {
    const g = quiet({ wave: 4 });
    g.player.troops = 5;
    g.waveTimer = 0;
    G.update(g, 0);
    expect(g.achieved.untouched).toBe(true);
    const hurt = quiet({ wave: 4 });
    hurt.player.troops = 5;
    hurt.zombies.push(zombie({ y: G.PLAYER_Y - 8 }));
    G.update(hurt, 0);
    expect(hurt.hits).toBe(1);
    hurt.waveTimer = 0;
    G.update(hurt, 0);
    expect(hurt.achieved).toEqual({ wave5: true });
  });

  test('boss kills: any boss, the rifle, a colossus', () => {
    const kill = (kind, wkey) => {
      const g = quiet();
      g.zombies.push(zombie({ kind, boss: true, hp: 1 }));
      g.bullets.push(bullet(wkey));
      G.update(g, 0);
      return Object.keys(g.achieved).sort();
    };
    expect(kill('brute', 'smg')).toEqual(['boss']);
    expect(kill('brute', 'rifle')).toEqual(['boss', 'rifleBoss']);
    expect(kill('colossus', 'sniper')).toEqual(['boss', 'colossus']);
    // an ordinary zombie is no boss
    const g = quiet();
    g.zombies.push(zombie({ hp: 1 }));
    g.bullets.push(bullet('rifle'));
    G.update(g, 0);
    expect(g.achieved).toEqual({});
  });

  test('a boss that reaches the squad is not a kill', () => {
    const g = quiet();
    g.player.troops = 9;
    g.zombies.push(zombie({ kind: 'brute', boss: true, y: G.PLAYER_Y - 8 }));
    G.update(g, 0);
    expect(g.achieved).toEqual({});
  });

  test('run totals: kills, score, squad size, walls, weapons', () => {
    const got = (setup) => {
      const g = quiet();
      setup(g);
      G.update(g, 0);
      return Object.keys(g.achieved);
    };
    expect(got((g) => { g.kills = 249; })).toEqual([]);
    expect(got((g) => { g.kills = 250; })).toEqual(['kills250']);
    expect(got((g) => { g.score = 1000; })).toEqual(['score1000']);
    expect(got((g) => { g.player.troops = G.MAX_TROOPS; })).toEqual(['fullSquad']);
    expect(got((g) => { G.buildWall(g); G.buildWall(g); })).toEqual([]);
    expect(got((g) => { G.buildWall(g); G.buildWall(g); G.buildWall(g); })).toEqual(['fortress']);
    // every weapon: the rifle is carried from the start, the rest come from gates
    const g = quiet();
    const others = Object.keys(G.WEAPONS).filter((k) => k !== 'rifle');
    others.forEach((k, i) => {
      expect(g.achieved.arsenal).toBeUndefined();
      g.gates = [gate({ type: 'weapon', v: k }, {})];
      g.player.x = G.ROAD_MID - 60;
      G.update(g, 0);
      expect(Object.keys(g.guns)).toHaveLength(i + 2);
    });
    expect(g.achieved.arsenal).toBe(true);
  });

  test('finishing a daily challenge', () => {
    const end = (g) => {
      g.zombies.push(zombie({ y: G.PLAYER_Y - 8, troopCost: 99 }));
      G.update(g, 0);
      return g;
    };
    expect(end(quiet()).achieved).toEqual({});
    const g = G.newGame();
    G.resetRun(g, 20766);
    end(g);
    expect(g.achieved).toEqual({ daily: true });
    expect(g.events.achieved).toEqual(['daily']);
    expect(g.coins).toBe(g.earned + coinsOf('daily'));
  });

  test('achievements and the daily best save and load', () => {
    const g = G.newGame();
    g.achieved = { boss: true, wave5: true };
    g.dailyBest = { day: 20766, best: 140 };
    const saved = JSON.parse(G.saveMeta(g));
    expect(saved.achieved).toEqual(['wave5', 'boss']);
    expect(saved.daily).toEqual({ day: 20766, best: 140 });
    const fresh = G.newGame();
    fresh.achieved = { daily: true }; // unlocked before the stored copy arrived
    expect(G.loadMeta(fresh, JSON.stringify(saved))).toBe(true);
    expect(fresh.achieved).toEqual({ daily: true, boss: true, wave5: true });
    expect(fresh.dailyBest).toEqual({ day: 20766, best: 140 });
  });

  test('loadMeta takes what an older version stored, and ignores junk', () => {
    const old = G.newGame();
    expect(G.loadMeta(old, JSON.stringify({ v: 1, coins: 9, upgrades: { troops: 1 } }))).toBe(true);
    expect(old.achieved).toEqual({});
    expect(old.dailyBest).toEqual({ day: 0, best: 0 });
    const g = G.newGame();
    g.dailyBest = { day: 20766, best: 50 };
    const junk = { v: 1, achieved: ['boss', 'nope', 7, '__proto__'], daily: { day: 'x', best: -4 } };
    expect(G.loadMeta(g, JSON.stringify(junk))).toBe(true);
    expect(g.achieved).toEqual({ boss: true });
    expect(g.dailyBest).toEqual({ day: 20766, best: 50 });
    expect(G.loadMeta(g, JSON.stringify({ v: 1, achieved: 'boss', daily: 5 }))).toBe(true);
    expect(g.achieved).toEqual({ boss: true });
    // an older day never replaces a newer one; the same day keeps the higher score
    G.loadMeta(g, JSON.stringify({ v: 1, daily: { day: 20765, best: 900 } }));
    G.loadMeta(g, JSON.stringify({ v: 1, daily: { day: 20766, best: 40 } }));
    expect(g.dailyBest).toEqual({ day: 20766, best: 50 });
    G.loadMeta(g, JSON.stringify({ v: 1, daily: { day: 20766, best: 70 } }));
    expect(g.dailyBest).toEqual({ day: 20766, best: 70 });
  });

  test('loading a saved run leaves achievements and the daily best alone', () => {
    const old = run({ score: 30 });
    old.achieved = { boss: true };
    old.dailyBest = { day: 5, best: 5 };
    const g = G.newGame();
    g.achieved = { wave5: true };
    g.dailyBest = { day: 20766, best: 50 };
    expect(G.loadRun(g, G.saveRun(old))).toBe(true);
    expect(g.achieved).toEqual({ wave5: true });
    expect(g.dailyBest).toEqual({ day: 20766, best: 50 });
  });
});
