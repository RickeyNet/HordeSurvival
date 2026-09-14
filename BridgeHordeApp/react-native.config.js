// react-native-gesture-handler is only present to satisfy an import inside
// react-native-audio-api's AudioControls UI (which this app never renders).
// Its native Android build trips the Windows 260-char path limit, so skip it.
// Its JS is stubbed out in metro.config.js to match.
module.exports = {
  dependencies: {
    'react-native-gesture-handler': {
      platforms: {
        android: null,
      },
    },
  },
};
