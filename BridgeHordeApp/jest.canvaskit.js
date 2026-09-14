/* eslint-env jest */
// CanvasKit must be created inside the Jest sandbox (not in a custom test
// environment) or its Array/Float32Array checks fail across realms.
// Tests must require the app lazily, after this has run.
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');

beforeAll(async () => {
  if (!global.CanvasKit) global.CanvasKit = await CanvasKitInit({});
});
