const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      // See stubs/gesture-handler-stub.js - native build disabled on Windows.
      if (
        moduleName === 'react-native-gesture-handler' ||
        moduleName.startsWith('react-native-gesture-handler/')
      ) {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'stubs', 'gesture-handler-stub.js'),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
