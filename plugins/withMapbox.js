const { withAndroidManifest } = require('@expo/config-plugins');

// Injects Mapbox public token into AndroidManifest meta-data.
// Token comes from env MAPBOX_PUBLIC_TOKEN at build time (EAS secret / .env) — never hardcoded.
module.exports = function withMapbox(config) {
  return withAndroidManifest(config, (cfg) => {
    const token = process.env.MAPBOX_PUBLIC_TOKEN ?? '';
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    app['meta-data'] = app['meta-data'] ?? [];
    const existing = app['meta-data'].find((m) => m.$?.['android:name'] === 'com.mapbox.token');
    if (existing) existing.$['android:value'] = token;
    else app['meta-data'].push({ $: { 'android:name': 'com.mapbox.token', 'android:value': token } });
    return cfg;
  });
};
