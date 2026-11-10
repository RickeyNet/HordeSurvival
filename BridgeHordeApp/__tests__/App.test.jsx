/* eslint-env jest */
/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

afterEach(async () => {
  // a run left behind the menu is stored; don't let it leak into the next test
  await require('@react-native-async-storage/async-storage').default.clear();
});

test('renders and runs a few frames without throwing', async () => {
  // Required lazily: the Skia mock needs CanvasKit, loaded in beforeAll.
  const App = require('../App').default;
  jest.useFakeTimers();
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(200);
  });
  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
  jest.useRealTimers();
});

// Mounts the app and returns a tap(worldX, worldY) helper.
async function mount() {
  const AppModule = require('../App');
  const G = require('../game/core');
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<AppModule.default />);
  });
  const root = tree.root.findAll((n) => n.props.onResponderGrant)[0];
  // Test renderer window is 750x1334; map world coords to screen.
  const scale = Math.min(750 / G.W, 1334 / G.H);
  const tap = (wx, wy) =>
    ReactTestRenderer.act(() => {
      root.props.onResponderGrant({
        nativeEvent: { pageX: (750 - G.W * scale) / 2 + wx * scale, pageY: (1334 - G.H * scale) / 2 + wy * scale },
      });
      jest.advanceTimersByTime(50);
    });
  const tapBtn = (b) => tap(b.x + b.w / 2, b.y + b.h / 2);
  // drag by dx world units from the last touch
  const drag = (dx) =>
    ReactTestRenderer.act(() => {
      root.props.onResponderGrant({ nativeEvent: { pageX: 300, pageY: 900 } });
      root.props.onResponderMove({ nativeEvent: { pageX: 300 + dx * scale, pageY: 900 } });
      jest.advanceTimersByTime(50);
    });
  return { tree, tap, tapBtn, drag, G, ...AppModule };
}

test('main menu: leaderboard opens and closes, Fight Horde starts a run', async () => {
  jest.useFakeTimers();
  const { tree, tap, tapBtn, G, MENU_BTNS, BOARD_BTNS, HOME_BTN } = await mount();
  const spy = jest.spyOn(G, 'resetRun');
  await tap(G.W / 2, 60); // empty space on the menu does nothing
  expect(spy).not.toHaveBeenCalled();
  await tapBtn(MENU_BTNS.board);
  await tap(G.W / 2, G.H / 2); // empty space on the board does nothing
  await tapBtn(MENU_BTNS.fight); // still covered by the board
  expect(spy).not.toHaveBeenCalled();
  await tapBtn(BOARD_BTNS.close);
  expect(spy).not.toHaveBeenCalled();
  await tapBtn(MENU_BTNS.fight);
  expect(spy).toHaveBeenCalledTimes(1);
  const g = spy.mock.calls[0][0];
  expect(g.state).toBe('playing');
  // pause, then leave for the main menu
  await tap(G.PAUSE_BTN.x + 5, G.PAUSE_BTN.y + 5);
  expect(g.state).toBe('paused');
  await tapBtn(HOME_BTN);
  expect(g.state).toBe('menu');
  spy.mockRestore();
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(200);
    tree.unmount();
  });
  jest.useRealTimers();
});

test('settings: toggles are saved and Back returns to the menu', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  jest.useFakeTimers();
  const { tree, tapBtn, G, MENU_BTNS, SETTING_ROWS, BACK_BTN } = await mount();
  const spy = jest.spyOn(G, 'resetRun');
  await tapBtn(MENU_BTNS.settings);
  await tapBtn(SETTING_ROWS[0]); // music off
  expect(JSON.parse(await AsyncStorage.getItem('hordeSettings'))).toEqual({ music: false, sfx: true, shake: true, haptics: true });
  await tapBtn(SETTING_ROWS[0]); // back on
  expect(JSON.parse(await AsyncStorage.getItem('hordeSettings')).music).toBe(true);
  await tapBtn(MENU_BTNS.fight); // settings still open: must not start a run
  expect(spy).not.toHaveBeenCalled();
  await tapBtn(BACK_BTN);
  await tapBtn(MENU_BTNS.fight);
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(200);
    tree.unmount();
  });
  jest.useRealTimers();
});

test('game over: buzzes and draws the run summary', async () => {
  const haptics = require('react-native-haptic-feedback');
  jest.useFakeTimers();
  const { tree, tap, tapBtn, G, MENU_BTNS } = await mount();
  const spy = jest.spyOn(G, 'resetRun');
  await tapBtn(MENU_BTNS.fight);
  const g = spy.mock.calls[0][0];
  spy.mockRestore();
  haptics.trigger.mockClear();
  // a zombie already behind the squad that costs every troop
  g.zombies.push({
    x: G.ROAD_MID, y: G.PLAYER_Y + 25, hp: 1, maxHp: 1, size: 13, speed: 0,
    wob: 0, kind: 'walker', troopCost: 99, scoreVal: 1,
  });
  await tap(G.W / 2, 400); // advances a few frames; the overlay is drawn
  expect(g.state).toBe('gameover');
  expect(g.kills).toBe(0);
  expect(haptics.trigger).toHaveBeenCalledTimes(1);
  expect(haptics.trigger).toHaveBeenCalledWith('notificationError');
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(200);
    tree.unmount();
  });
  jest.useRealTimers();
});

test('a run left for the main menu can be resumed, and survives a restart', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  jest.useFakeTimers();
  let app = await mount();
  const { G, HOME_BTN, MENU_BTNS, RUN_MENU_BTNS, CONFIRM_BTNS } = app;
  const spy = jest.spyOn(G, 'resetRun');
  await app.tapBtn(MENU_BTNS.fight);
  const g = spy.mock.calls[0][0];
  g.score = 123;
  g.wave = 4;
  g.gates.push({ y: 100, left: { label: 'DMG +1', color: '#fff', type: 'damage' }, right: { label: 'x', color: '#fff', type: 'wall' }, used: false });
  await app.tap(G.PAUSE_BTN.x + 5, G.PAUSE_BTN.y + 5);
  await app.tapBtn(HOME_BTN);
  expect(g.state).toBe('menu');
  expect(g.inRun).toBe(true);
  expect(g.score).toBe(123);
  expect(JSON.parse(await AsyncStorage.getItem('hordeRun')).run.score).toBe(123);
  // resume: same run, and the stored copy is dropped
  await app.tapBtn(RUN_MENU_BTNS.resume);
  expect(g.state).toBe('playing');
  expect(g.score).toBeGreaterThanOrEqual(123);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem('hordeRun')).toBeNull();
  // leave again, then "restart the app"
  await app.tap(G.PAUSE_BTN.x + 5, G.PAUSE_BTN.y + 5);
  await app.tapBtn(HOME_BTN);
  await ReactTestRenderer.act(() => { app.tree.unmount(); });
  const load = jest.spyOn(G, 'loadRun');
  app = await mount();
  await ReactTestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(50); });
  const g2 = load.mock.calls[0][0];
  expect(g2).not.toBe(g);
  expect(g2.inRun).toBe(true);
  expect(g2.wave).toBe(4);
  expect(g2.gates.length).toBe(g.gates.length);
  await app.tapBtn(RUN_MENU_BTNS.resume);
  expect(g2.state).toBe('playing');
  // New Run asks first; backing out keeps the run
  await app.tap(G.PAUSE_BTN.x + 5, G.PAUSE_BTN.y + 5);
  await app.tapBtn(HOME_BTN);
  const kept = g2.score;
  await app.tapBtn(RUN_MENU_BTNS.fight);
  await app.tapBtn(CONFIRM_BTNS.cancel);
  expect(g2.inRun).toBe(true);
  expect(g2.score).toBe(kept);
  expect(spy).toHaveBeenCalledTimes(1);
  await app.tapBtn(RUN_MENU_BTNS.fight);
  await app.tap(G.W / 2, 60); // outside the buttons also cancels
  expect(g2.inRun).toBe(true);
  expect(await AsyncStorage.getItem('hordeRun')).not.toBeNull();
  // confirming abandons the kept run
  await app.tapBtn(RUN_MENU_BTNS.fight);
  await app.tapBtn(CONFIRM_BTNS.yes);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(g2.state).toBe('playing');
  expect(g2.score).toBe(0);
  expect(await AsyncStorage.getItem('hordeRun')).toBeNull();
  spy.mockRestore();
  load.mockRestore();
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(200);
    app.tree.unmount();
  });
  jest.useRealTimers();
});

test('first run: hints for moving and gates, shown only once', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  jest.useFakeTimers();
  const app = await mount();
  const { G, MENU_BTNS, tutorialHint } = app;
  await ReactTestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(50); });
  const spy = jest.spyOn(G, 'resetRun');
  await app.tapBtn(MENU_BTNS.fight);
  const g = spy.mock.calls[0][0];
  // the app's own tutorial state isn't exported; drive it and check storage
  expect(tutorialHint({ on: true, moved: 0 }, g).title).toMatch(/DRAG/);
  expect(tutorialHint({ on: true, moved: 50 }, g)).toBeNull(); // no gate yet
  g.gates.push({ y: 100, left: { label: 'DMG +1', color: '#fff', type: 'damage' }, right: { label: 'x', color: '#fff', type: 'wall' }, used: false });
  expect(tutorialHint({ on: true, moved: 50 }, g).title).toMatch(/GATE/);
  expect(tutorialHint({ on: false, moved: 0 }, g)).toBeNull();
  await app.drag(60); // draws the gate hint for a few frames
  expect(await AsyncStorage.getItem('hordeTutorial')).toBeNull();
  g.gates[0].y = G.PLAYER_Y; // squad reaches the gate
  await app.drag(5);
  expect(g.gates.every((gate) => gate.used)).toBe(true);
  expect(await AsyncStorage.getItem('hordeTutorial')).toBe('1');
  spy.mockRestore();
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(200);
    app.tree.unmount();
  });
  jest.useRealTimers();
});

test('upgrades: coins from a run buy a level, saved across a restart', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  jest.useFakeTimers();
  let app = await mount();
  const { G, MENU_BTNS, UPGRADE_ROWS, BACK_BTN, HOME_BTN } = app;
  const spy = jest.spyOn(G, 'resetRun');
  await ReactTestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(50); });
  await app.tapBtn(MENU_BTNS.fight);
  const g = spy.mock.calls[0][0];
  expect(g.player.troops).toBe(1);
  // end the run with enough score to afford the first troop upgrade
  const cost = G.UPGRADES.troops.costs[0];
  g.score = cost * 10 + 30;
  g.zombies.push({
    x: G.ROAD_MID, y: G.PLAYER_Y + 25, hp: 1, maxHp: 1, size: 13, speed: 0,
    wob: 0, kind: 'walker', troopCost: 99, scoreVal: 1,
  });
  await app.tap(G.W / 2, 400); // game over is drawn with the coins earned
  expect(g.state).toBe('gameover');
  expect(g.coins).toBe(cost + 3);
  expect(JSON.parse(await AsyncStorage.getItem('hordeMeta')).coins).toBe(cost + 3);
  await app.tapBtn(HOME_BTN);
  // the shop: a row buys a level; one that costs too much does nothing
  const row = (key) => UPGRADE_ROWS.find((r) => r.key === key);
  await app.tapBtn(MENU_BTNS.shop);
  await app.tapBtn(MENU_BTNS.fight); // covered by the shop
  expect(spy).toHaveBeenCalledTimes(1);
  await app.tapBtn(row('damage'));
  expect(g.upgrades.damage).toBe(0);
  await app.tapBtn(row('troops'));
  expect(g.upgrades.troops).toBe(1);
  expect(g.coins).toBe(3);
  expect(JSON.parse(await AsyncStorage.getItem('hordeMeta'))).toEqual({ v: 1, coins: 3, upgrades: { troops: 1, damage: 0, wall: 0 } });
  await app.tapBtn(BACK_BTN);
  // "restart the app": the upgrade is still there and the next run uses it
  await ReactTestRenderer.act(() => { app.tree.unmount(); });
  app = await mount();
  await ReactTestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(50); });
  await app.tapBtn(MENU_BTNS.shop); // draws a bought level
  await app.tapBtn(BACK_BTN);
  await app.tapBtn(MENU_BTNS.fight);
  const g2 = spy.mock.calls[1][0];
  expect(g2).not.toBe(g);
  expect(g2.coins).toBe(3);
  expect(g2.player.troops).toBe(2);
  spy.mockRestore();
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(200);
    app.tree.unmount();
  });
  jest.useRealTimers();
});
