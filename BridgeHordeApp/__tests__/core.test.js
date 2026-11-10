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
