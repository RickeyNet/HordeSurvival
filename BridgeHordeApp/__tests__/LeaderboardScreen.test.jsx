/* eslint-env jest */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('../leaderboard', () => ({
  enabled: () => true,
  flushPending: () => Promise.resolve(),
  recordRun: () => Promise.resolve(),
  fetchBoard: () =>
    Promise.resolve({
      top: [
        { rank: 1, name: 'SwiftOtter482', score: 900, wave: 12 },
        { rank: 2, name: 'BraveFox17', score: 450, wave: 8 },
      ],
      me: { name: 'BraveFox17', score: 450, wave: 8, rank: 2 },
      total: 2,
    }),
}));

test('draws a loaded leaderboard without throwing', async () => {
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
  await ReactTestRenderer.act(async () => {
    root.props.onResponderGrant({
      nativeEvent: {
        pageX: (750 - G.W * scale) / 2 + (G.W / 2) * scale,
        pageY: (1334 - G.H * scale) / 2 + (G.H / 2 + 145) * scale,
      },
    });
    await Promise.resolve();
    jest.advanceTimersByTime(100);
  });
  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
  jest.useRealTimers();
});
