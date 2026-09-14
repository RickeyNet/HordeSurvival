// No-op stand-in for react-native-gesture-handler.
// The real library's native Android build breaks on the Windows 260-char path
// limit, and this app never uses it - only react-native-audio-api's optional
// AudioControls UI imports it, which we never render. Every export resolves to
// a component/function that does nothing.
const noop = () => null;
module.exports = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === '__esModule') return true;
      return noop;
    },
  },
);
