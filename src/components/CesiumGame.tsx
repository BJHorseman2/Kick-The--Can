'use client';

import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

import { GameEngine } from '@/game/GameEngine';
import { LevelDef } from '@/game/levels';
import { EngineCallbacks } from '@/game/types';

// Cesium loads its workers/assets from CESIUM_BASE_URL (set to "/cesium" via
// next.config.js DefinePlugin; assets copied there by scripts/copy-cesium.js).

interface Props {
  apiKey: string;
  level: LevelDef;
  /** Demo mode: skip Google 3D tiles and fly over a stylized neon-grid globe. */
  demo?: boolean;
  /** Placement-audit mode: park at a route object (r<N>/o<N>/p) instead of flying. */
  inspect?: string | null;
  /** Night mode: dark tinted city, starfield, bloom on the neon. */
  night?: boolean;
  callbacks: EngineCallbacks;
  onReady: () => void;
  onError: (msg: string) => void;
}

export default function CesiumGame({ apiKey, level, demo = false, inspect = null, night = false, callbacks, onReady, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let viewer: Cesium.Viewer | null = null;
    let engine: GameEngine | null = null;
    let cancelled = false;

    async function boot() {
      if (!containerRef.current) return;

      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

      viewer = new Cesium.Viewer(containerRef.current, {
        // hide all default UI — we draw our own HUD
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        selectionIndicator: false,
        infoBox: false,
        scene3DOnly: true,
        baseLayer: false, // no default Bing imagery (we use Google 3D tiles)
        showRenderLoopErrors: false, // we surface render crashes on our own screen
      });

      const scene = viewer.scene;
      scene.globe.show = false; // the world IS the 3D tiles
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = !night;
      if (night) {
        // Starfield sky: kill the daytime atmosphere shell and the sun disc;
        // Cesium's default sky box supplies the stars.
        if (scene.sun) scene.sun.show = false;
        if (scene.moon) scene.moon.show = false;
        scene.backgroundColor = Cesium.Color.fromCssColorString('#05070f');
      }
      scene.screenSpaceCameraController.enableInputs = false; // we drive the camera
      // hide the Cesium credit logo but KEEP the data-attribution text visible
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.background = 'transparent';

      // Cinematic polish: smooth the jaggies and let distance haze soften the
      // horizon instead of tiles popping against a hard sky.
      scene.postProcessStages.fxaa.enabled = true;
      if (scene.fog) {
        scene.fog.enabled = !night; // night keeps its clean starfield look
        scene.fog.density = 0.00012; // gentle haze — mood, not soup
        scene.fog.minimumBrightness = 0.25;
      }

      // Surface renderer crashes (usually GPU memory pressure on phones) on
      // our error screen with the real message, instead of Cesium's dead panel.
      scene.renderError.addEventListener((_scene: Cesium.Scene, error: unknown) => {
        console.error('Cesium render error:', error);
        const msg = error instanceof Error ? error.message : String(error);
        onError(
          `The 3D renderer stopped: "${msg}". On phones this usually means the device ran out of graphics memory — close other tabs and reopen, or fly the Training Grid demo. If it keeps happening, send me that quoted message.`
        );
      });
      viewer.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        onError(
          'The graphics context was lost — the device ran out of GPU memory. Close other tabs, reopen this page, or fly the Training Grid demo.'
        );
      });

      if (demo) {
        // --- Demo mode: stylized neon-grid globe, no API key required ---
        scene.globe.show = true;
        scene.globe.baseColor = Cesium.Color.fromCssColorString('#060a18');
        viewer.imageryLayers.addImageryProvider(
          new Cesium.GridImageryProvider({
            color: Cesium.Color.fromCssColorString('#19e6ff').withAlpha(0.4),
            glowColor: Cesium.Color.fromCssColorString('#19e6ff').withAlpha(0.15),
            glowWidth: 3,
            backgroundColor: Cesium.Color.fromCssColorString('#060a18').withAlpha(0.9),
            cells: 8,
          })
        );
      } else {
        // --- Load Google Photorealistic 3D Tiles (official Map Tiles API) ---
        let tileset: Cesium.Cesium3DTileset;
        try {
          Cesium.GoogleMaps.defaultApiKey = apiKey;
          tileset = await Cesium.createGooglePhotorealistic3DTileset();
        } catch (e) {
          // Fallback for older Cesium signatures that take the key directly.
          try {
            // @ts-expect-error legacy signature
            tileset = await Cesium.createGooglePhotorealistic3DTileset(apiKey);
          } catch (e2) {
            console.error(e2);
            onError(
              'Failed to load Google Photorealistic 3D Tiles. Check that NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is valid and that the "Map Tiles API" is enabled for it.'
            );
            return;
          }
        }
        if (cancelled || !viewer) return;

        // Phones/tablets can't hold desktop-detail photorealistic tiles in
        // memory (mobile Safari especially) — trade detail for stability.
        const mobile =
          navigator.maxTouchPoints > 1 || /iPhone|iPad|Android/i.test(navigator.userAgent);
        if (mobile) {
          tileset.maximumScreenSpaceError = 40; // much coarser LOD, far fewer tiles
          tileset.cacheBytes = 160 * 1024 * 1024;
          tileset.maximumCacheOverflowBytes = 64 * 1024 * 1024;
          tileset.dynamicScreenSpaceError = true; // drop detail in the distance
          // trim GPU load further: no atmosphere shader, no anti-alias resolve
          if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
          viewer.resolutionScale = Math.min(1, viewer.resolutionScale);
        } else {
          // Desktop smoothness tuning: at game speeds the streamer juggles a
          // huge vista — shed distant detail and keep requests flowing while
          // the camera moves so tiles arrive before you do, not after.
          tileset.maximumScreenSpaceError = 20; // slightly coarser than the 16 default
          tileset.dynamicScreenSpaceError = true; // distant tiles load coarser
          tileset.cullRequestsWhileMovingMultiplier = 10; // keep fetching at speed (default 60 defers)
        }

        if (night) {
          // The tiles' textures have baked daylight — multiply them toward a
          // deep moonlit blue. Tuned so streets/water stay readable.
          tileset.style = new Cesium.Cesium3DTileStyle({ color: 'color("#5a6890")' });
        }

        scene.primitives.add(tileset);

        // Streaming indicator so slow tile loads don't look like a dead world.
        const statusEl = document.createElement('div');
        statusEl.className = 'tile-status';
        containerRef.current!.appendChild(statusEl);
        tileset.loadProgress.addEventListener((pending: number, processing: number) => {
          const active = pending + processing;
          if (active === 0) {
            statusEl.style.display = 'none';
          } else {
            statusEl.style.display = 'block';
            statusEl.textContent = `STREAMING CITY · ${active}`;
          }
        });
      }

      if (night) {
        // Bloom makes the neon rings/orbs/trail burn against the dark city.
        // Skip on phones — full-screen post-processing is a GPU tax.
        const mobileBloom =
          navigator.maxTouchPoints > 1 || /iPhone|iPad|Android/i.test(navigator.userAgent);
        if (!mobileBloom) {
          const bloom = scene.postProcessStages.bloom;
          bloom.enabled = true;
          bloom.uniforms.glowOnly = false;
          bloom.uniforms.brightness = -0.25;
          bloom.uniforms.contrast = 119;
          bloom.uniforms.delta = 0.9;
          bloom.uniforms.sigma = 3.0;
          bloom.uniforms.stepSize = 1.0;
        }
      }

      engine = new GameEngine(viewer, level, callbacks);
      engine.init();
      onReady();
      if (inspect) {
        engine.inspect(inspect);
        // "<spec>.live": park on the approach, then run physics from there —
        // a deterministic start pose for playtest harnesses (e.g. e0.live puts
        // bandit 0 dead ahead at cannon range).
        if (inspect.endsWith('.live')) engine.start();
      } else engine.start();
    }

    boot().catch((err) => {
      console.error(err);
      onError('Unexpected error initializing the game. See the browser console for details.');
    });

    return () => {
      cancelled = true;
      engine?.destroy();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="cesium-container" />;
}
