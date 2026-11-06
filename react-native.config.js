// iOS uses Apple Maps (react-native-maps) — Mapbox native SDK is Android-only.
// Excluding it on iOS avoids the Mapbox binary download during pod install.
module.exports = {
  dependencies: {
    '@rnmapbox/maps': {
      platforms: {
        ios: null,
      },
    },
  },
};
