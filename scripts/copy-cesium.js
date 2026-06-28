/* eslint-disable */
/**
 * Copies Cesium's prebuilt static assets (Workers, Assets, ThirdParty, Widgets)
 * from node_modules into /public/cesium so the browser can fetch them at
 * runtime. CESIUM_BASE_URL is set to "/cesium" in next.config.js.
 *
 * Runs automatically via the "predev" / "prebuild" npm scripts.
 */
const fs = require('fs');
const path = require('path');

function resolveCesiumBuildDir() {
  // Resolve the installed cesium package, then walk to its Build/Cesium folder.
  const pkgJson = require.resolve('cesium/package.json');
  return path.join(path.dirname(pkgJson), 'Build', 'Cesium');
}

function main() {
  let cesiumBuild;
  try {
    cesiumBuild = resolveCesiumBuildDir();
  } catch (err) {
    console.error(
      '[copy-cesium] Could not resolve the "cesium" package. Did you run `npm install`?'
    );
    process.exit(1);
  }

  const dest = path.join(process.cwd(), 'public', 'cesium');
  const folders = ['Workers', 'Assets', 'ThirdParty', 'Widgets'];

  fs.mkdirSync(dest, { recursive: true });

  for (const folder of folders) {
    const from = path.join(cesiumBuild, folder);
    const to = path.join(dest, folder);
    if (!fs.existsSync(from)) {
      console.warn(`[copy-cesium] Skipping missing folder: ${from}`);
      continue;
    }
    fs.cpSync(from, to, { recursive: true });
  }

  console.log(`[copy-cesium] Copied Cesium static assets -> ${dest}`);
}

main();
