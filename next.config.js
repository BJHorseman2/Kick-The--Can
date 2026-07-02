// For static hosting under a subpath (e.g. GitHub Pages at /Kick-The--Can),
// build with:  STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/Kick-The--Can npm run build
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const isStaticExport = process.env.STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Cesium Viewer should be created once; double-invoke in StrictMode fights that.
  // SWC's minifier corrupts Cesium's bundle (emits invalid octal escapes in
  // template strings -> "SyntaxError: Octal escape sequences are not allowed"
  // and the chunk never parses). Terser handles it correctly.
  swcMinify: false,
  ...(isStaticExport ? { output: 'export' } : {}),
  ...(basePath ? { basePath } : {}),
  webpack: (config, { webpack }) => {
    // Cesium reads the global CESIUM_BASE_URL at runtime to locate its static
    // Workers / Assets / Widgets. Those are copied into /public/cesium by
    // scripts/copy-cesium.js (see package.json predev / prebuild).
    config.plugins.push(
      new webpack.DefinePlugin({
        CESIUM_BASE_URL: JSON.stringify(`${basePath}/cesium`),
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
