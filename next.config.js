/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Cesium Viewer should be created once; double-invoke in StrictMode fights that.
  webpack: (config, { webpack }) => {
    // Cesium reads the global CESIUM_BASE_URL at runtime to locate its static
    // Workers / Assets / Widgets. Those are copied into /public/cesium by
    // scripts/copy-cesium.js (see package.json predev / prebuild).
    config.plugins.push(
      new webpack.DefinePlugin({
        CESIUM_BASE_URL: JSON.stringify('/cesium'),
      })
    );

    // Cesium's source references a few Node-only modules behind browser guards.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      http: false,
      https: false,
      zlib: false,
      url: false,
    };

    return config;
  },
};

module.exports = nextConfig;
