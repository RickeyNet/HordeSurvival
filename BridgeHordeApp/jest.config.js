module.exports = {
  preset: '@react-native/jest-preset',
  // The preset only transforms .js/.ts/.tsx; the app lives in .jsx files.
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  setupFiles: [
    '<rootDir>/node_modules/@react-native/jest-preset/jest/setup.js',
    '<rootDir>/node_modules/@shopify/react-native-skia/jestSetup.js',
    '<rootDir>/jest.setup.js',
  ],
  // Loads CanvasKit inside the test realm so the real Skia drawing code runs.
  setupFilesAfterEnv: ['<rootDir>/jest.canvaskit.js'],
  transformIgnorePatterns: [
    'node_modules[\\/](?!((jest-)?react-native|@react-native(-community)?|@shopify[\\/]react-native-skia|@react-native-async-storage[\\/]async-storage|react-native-audio-api)[\\/])',
  ],
};
