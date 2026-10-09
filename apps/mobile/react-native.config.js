// Each map library is linked into one platform only (owner's decision,
// 2026-10-09): iOS draws Apple Maps through react-native-maps, Android draws
// OpenStreetMap through MapLibre. Without this, both native libraries would
// ship in both apps — and react-native-maps on Android is Google Maps.
module.exports = {
  dependencies: {
    'react-native-maps': { platforms: { android: null } },
    '@maplibre/maplibre-react-native': { platforms: { ios: null } },
  },
};
