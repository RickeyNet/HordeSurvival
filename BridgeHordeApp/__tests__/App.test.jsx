/* eslint-env jest */
/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

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
  return { tree, tap, tapBtn, G, ...AppModule };
}

test('main menu: leaderboard opens and closes, Fight Horde starts a run', async () => {
  jest.useFakeTimers();
  const { tree, tap, tapBtn, G, MENU_BTNS, HOME_BTN } = await mount();
  const spy = jest.spyOn(G, 'resetRun');
  await tap(G.W / 2, 60); // empty space on the menu does nothing
  expect(spy).not.toHaveBeenCalled();
  await tapBtn(MENU_BTNS.board);
  await tap(G.W / 2, G.H / 2); // close; must not start a run
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
