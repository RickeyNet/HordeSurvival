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

test('opens and closes the leaderboard screen from the menu', async () => {
  const App = require('../App').default;
  const G = require('../game/core');
  jest.useFakeTimers();
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  const root = tree.root.findAll((n) => n.props.onResponderGrant)[0];
  // Test renderer window is 750x1334; map the button's world coords to screen.
  const scale = Math.min(750 / G.W, 1334 / G.H);
  const tap = (wx, wy) =>
    ReactTestRenderer.act(() => {
      root.props.onResponderGrant({
        nativeEvent: { pageX: (750 - G.W * scale) / 2 + wx * scale, pageY: (1334 - G.H * scale) / 2 + wy * scale },
      });
      jest.advanceTimersByTime(50);
    });
  await tap(G.W / 2, G.H / 2 + 145); // leaderboard button
  await tap(G.W / 2, G.H / 2); // close
  await tap(G.W / 2, G.H / 2); // start a run
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(200);
    tree.unmount();
  });
  jest.useRealTimers();
});
