'use client';

import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

import { GameEngine } from '@/game/GameEngine';
import { EngineCallbacks } from '@/game/types';

// Cesium loads its workers/assets from CESIUM_BASE_URL (set to "/cesium" via
// next.config.js DefinePlugin; assets copied there by scripts/copy-cesium.js).

interface Props {
  apiKey: string;
  /** Demo mode: skip Google 3D tiles and fly over a stylized neon-grid globe. */
  demo?: boolean;
  callbacks: EngineCallbacks;
  onReady: () => void;
  onError: (msg: string) => void;
}

export default function CesiumGame({ apiKey, demo = false, callbacks, onReady, onError }: Props) {
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
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
      scene.screenSpaceCameraController.enableInputs = false; // we drive the camera
      // hide the Cesium credit logo but KEEP the data-attribution text visible
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.background = 'transparent';

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

      engine = new GameEngine(viewer, callbacks);
      engine.init();
      onReady();
      engine.start();
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
