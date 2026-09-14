/* globals jest */
jest.mock('react-native-audio-api', () => require('react-native-audio-api/mock'));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);
// The headless CanvasKit build has no system fonts; the app tolerates a null
// font, so font lookup returns null in tests.
jest.mock('@shopify/react-native-skia/lib/module/skia/core/Font', () => ({
  useFont: () => null,
  matchFont: () => null,
  listFontFamilies: () => [],
  useFonts: () => null,
}));
