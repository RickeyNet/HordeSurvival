/* eslint-env jest */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

const mockBoard = (board) => ({
  board,
  top: [
    { rank: 1, name: 'SwiftOtter482', score: 900, wave: 12 },
    { rank: 2, name: 'BraveFox17', score: 450, wave: 8, you: true },
  ],
  me: { name: 'BraveFox17', score: 450, wave: 8, rank: 2 },
  total: 2,
  ...(board === 'week' ? { endsAt: Date.now() + 3 * 86400000 } : {}),
  ...(board === 'day' ? { endsAt: Date.now() + 5 * 3600000 } : {}),
});
const mockStanding = {
  name: 'BraveFox17',
  all: { best: 450, rank: 2, total: 2 },
  week: { id: 1, endsAt: 0, best: 0, rank: null, total: 1 },
  day: { id: 1, endsAt: 0, best: 450, rank: 1, total: 7 },
};
jest.mock('../leaderboard', () => ({
  enabled: () => true,
  flushPending: () => Promise.resolve(null),
  recordRun: jest.fn(() => Promise.resolve(mockStanding)),
  setName: jest.fn(() => Promise.resolve()),
  fetchBoard: jest.fn((board = 'all') => Promise.resolve(mockBoard(board))),
}));

// Mounts the app and returns a tapBtn(button) helper that also lets pending
// leaderboard answers arrive and a few frames draw.
async function mount() {
  const AppModule = require('../App');
  const G = require('../game/core');
  jest.useFakeTimers();
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<AppModule.default />);
  });
  const root = tree.root.findAll((n) => n.props.onResponderGrant)[0];
  // Test renderer window is 750x1334; map world coords to screen.
  const scale = Math.min(750 / G.W, 1334 / G.H);
  const tapBtn = (b) =>
    ReactTestRenderer.act(async () => {
      root.props.onResponderGrant({
        nativeEvent: {
          pageX: (750 - G.W * scale) / 2 + (b.x + b.w / 2) * scale,
          pageY: (1334 - G.H * scale) / 2 + (b.y + b.h / 2) * scale,
        },
      });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      jest.advanceTimersByTime(100);
    });
  const unmount = async () => {
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
    jest.useRealTimers();
  };
  return { tapBtn, unmount, G, LB: require('../leaderboard'), ...AppModule };
}

beforeEach(() => jest.clearAllMocks());

test('draws the three boards and switches between them', async () => {
  const { tapBtn, unmount, LB, MENU_BTNS, BOARD_BTNS } = await mount();
  await tapBtn(MENU_BTNS.board);
  expect(LB.fetchBoard.mock.calls).toEqual([['all']]);
  await tapBtn(BOARD_BTNS.all); // already there: no reload
  expect(LB.fetchBoard).toHaveBeenCalledTimes(1);
  await tapBtn(BOARD_BTNS.week);
  expect(LB.fetchBoard).toHaveBeenLastCalledWith('week');
  await tapBtn(BOARD_BTNS.all);
  expect(LB.fetchBoard.mock.calls).toEqual([['all'], ['week'], ['all']]);
  await tapBtn(BOARD_BTNS.day);
  await tapBtn(BOARD_BTNS.day); // already there: no reload
  expect(LB.fetchBoard.mock.calls).toEqual([['all'], ['week'], ['all'], ['day']]);
  await tapBtn(BOARD_BTNS.week);
  expect(LB.fetchBoard).toHaveBeenLastCalledWith('week');
  await unmount();
});

test('name picker: starts from the current name, saves the picked one and reloads the board', async () => {
  const { tapBtn, unmount, LB, MENU_BTNS, BOARD_BTNS, NAME_STEPS, NAME_BTNS } = await mount();
  const stepBtn = (field, delta) => NAME_STEPS.find((b) => b.field === field && b.delta === delta);
  await tapBtn(MENU_BTNS.board);
  await tapBtn(BOARD_BTNS.week);
  await tapBtn(BOARD_BTNS.name);
  await tapBtn(BOARD_BTNS.close); // covered by the picker (and not on one of its buttons)
  await tapBtn(stepBtn('a', -1)); // Brave -> Swift
  await tapBtn(stepBtn('b', 1)); // Fox -> Hawk
  await tapBtn(stepBtn('n', 10)); // 17 -> 27
  await tapBtn(stepBtn('n', -1)); // 26
  await tapBtn(NAME_BTNS.save);
  expect(LB.setName.mock.calls).toEqual([['SwiftHawk26']]);
  expect(LB.fetchBoard).toHaveBeenLastCalledWith('week'); // back on the tab it was opened from
  expect(LB.fetchBoard).toHaveBeenCalledTimes(3);
  await unmount();
});

test('name picker: values wrap around, Shuffle picks a valid name, Cancel saves nothing', async () => {
  const { tapBtn, unmount, LB, MENU_BTNS, BOARD_BTNS, NAME_STEPS, NAME_BTNS } = await mount();
  const { ADJECTIVES, ANIMALS, parseName } = require('../names');
  const stepBtn = (field, delta) => NAME_STEPS.find((b) => b.field === field && b.delta === delta);
  await tapBtn(MENU_BTNS.board);
  await tapBtn(BOARD_BTNS.name);
  await tapBtn(stepBtn('a', -1));
  await tapBtn(stepBtn('a', -1)); // Brave -> Swift -> last adjective
  await tapBtn(stepBtn('n', -10));
  await tapBtn(stepBtn('n', -10)); // 17 -> 7 -> 997
  await tapBtn(NAME_BTNS.save);
  expect(LB.setName).toHaveBeenLastCalledWith(ADJECTIVES[ADJECTIVES.length - 1] + 'Fox997');

  await tapBtn(BOARD_BTNS.name);
  await tapBtn(NAME_BTNS.shuffle);
  await tapBtn(NAME_BTNS.save);
  const shuffled = parseName(LB.setName.mock.calls[1][0]);
  expect(shuffled).not.toBeNull();
  expect(ANIMALS[shuffled.b]).toBeDefined();

  await tapBtn(BOARD_BTNS.name);
  await tapBtn(stepBtn('b', 1));
  await tapBtn(NAME_BTNS.cancel);
  expect(LB.setName).toHaveBeenCalledTimes(2);
  await tapBtn(BOARD_BTNS.close);
  await unmount();
});

test('game over: sends the run and draws the rank line', async () => {
  const { tapBtn, unmount, G, LB, MENU_BTNS, rankLine } = await mount();
  const spy = jest.spyOn(G, 'resetRun');
  await tapBtn(MENU_BTNS.fight);
  const g = spy.mock.calls[0][0];
  spy.mockRestore();
  // a zombie already behind the squad that costs every troop
  g.zombies.push({
    x: G.ROAD_MID, y: G.PLAYER_Y + 25, hp: 1, maxHp: 1, size: 13, speed: 0,
    wob: 0, kind: 'walker', troopCost: 99, scoreVal: 1,
  });
  await tapBtn({ x: G.W / 2, y: 400, w: 0, h: 0 }); // advances frames; the overlay is drawn
  expect(g.state).toBe('gameover');
  expect(LB.recordRun).toHaveBeenCalledTimes(1);
  expect(LB.recordRun).toHaveBeenCalledWith(g.score, g.wave, g.elapsed, null); // not a daily run
  await tapBtn({ x: 0, y: 0, w: 0, h: 0 }); // the standing has arrived: drawn with the rank line (tap retries)

  expect(rankLine(mockStanding)).toBe('Global #2 of 2');
  expect(rankLine({ all: { rank: 12, total: 340 }, week: { rank: 3, total: 41 } })).toBe('Global #12 of 340  -  Week #3 of 41');
  expect(rankLine({ all: { rank: null, total: 5 }, week: { rank: null, total: 0 } })).toBe('');
  await unmount();
});

test('game over after a daily run: sends the day and shows the place on the daily board', async () => {
  const { tapBtn, unmount, G, LB, MENU_BTNS, rankLine } = await mount();
  const today = G.dayOf(Date.now());
  const spy = jest.spyOn(G, 'resetRun');
  await tapBtn(MENU_BTNS.daily);
  const g = spy.mock.calls[0][0];
  spy.mockRestore();
  g.score = 450;
  g.zombies.push({
    x: G.ROAD_MID, y: G.PLAYER_Y + 25, hp: 1, maxHp: 1, size: 13, speed: 0,
    wob: 0, kind: 'walker', troopCost: 99, scoreVal: 1,
  });
  await tapBtn({ x: G.W / 2, y: 400, w: 0, h: 0 });
  expect(g.state).toBe('gameover');
  expect(LB.recordRun).toHaveBeenCalledTimes(1);
  expect(LB.recordRun).toHaveBeenCalledWith(450, g.wave, g.elapsed, today);
  await tapBtn({ x: 0, y: 0, w: 0, h: 0 }); // drawn with the rank line

  // today's place comes first and takes the weekly one's spot; ordinary runs never show it
  expect(rankLine(mockStanding, true)).toBe('Today #1 of 7  -  Global #2 of 2');
  expect(rankLine(mockStanding, false)).toBe('Global #2 of 2');
  const full = { all: { rank: 12, total: 340 }, week: { rank: 3, total: 41 }, day: { rank: 5, total: 60 } };
  expect(rankLine(full, true)).toBe('Today #5 of 60  -  Global #12 of 340');
  expect(rankLine({ ...full, day: { rank: null, total: 60 } }, true)).toBe('Global #12 of 340  -  Week #3 of 41');
  expect(rankLine({ all: full.all, week: full.week }, true)).toBe('Global #12 of 340  -  Week #3 of 41'); // an older server
  await unmount();
});

test('fmtLeft shows the time until the weekly board resets', () => {
  const { fmtLeft } = require('../App');
  const H = 3600000;
  expect(fmtLeft(3 * 24 * H + 4 * H + 5 * 60000)).toBe('3d 4h');
  expect(fmtLeft(5 * H + 7 * 60000)).toBe('5h 7m');
  expect(fmtLeft(59 * 60000 + 59000)).toBe('59m');
  expect(fmtLeft(-1000)).toBe('0m');
});
