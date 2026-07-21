const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withCleartextTraffic(config, props = {}) {
  const enabled = props.enabled !== false;

  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];

    if (application?.$) {
      application.$["android:usesCleartextTraffic"] = String(enabled);
    }

    return modConfig;
  });
};
