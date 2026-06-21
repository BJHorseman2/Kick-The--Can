# Boeing 747-400 — procedural Three.js model

A fully procedural, realistically-proportioned Boeing 747-400 built with
[Three.js](https://threejs.org/) (r184). No external 3D assets — every
surface (fuselage, blended upper-deck hump, swept airfoil wings with
winglets, four turbofans, tail surfaces, landing gear) is generated in code,
and the livery / windows are drawn into a procedural canvas texture.

## Viewing

It uses ES modules, so it must be served over HTTP (not opened from `file://`):

```bash
npx serve boeing747      # or: python3 -m http.server --directory boeing747
```

Then open the printed URL. Drag to orbit, scroll to zoom, and use the buttons
in the top-left to jump to named inspection views.

## Self-verifying render loop

The model was built with a render-inspect-improve loop. `render.js` (root of
the repo) launches headless Chromium via Puppeteer, loads the viewer, drives
the camera to each named inspection view (front, rear, both profiles, top,
bottom, hero, three-quarter, nose, cockpit, engine, tail, gear) and writes a
PNG per view to `boeing747/renders/`. Those renders are then inspected to find
the least-realistic feature, which is improved, and the loop repeats.

```bash
npm install            # three + puppeteer
node render.js         # render every view
node render.js side_left hero front   # render a subset
```

## Key dimensions (1 unit = 1 metre)

| | 747-400 | model |
|---|---|---|
| Length | 70.6 m | ~73 |
| Wingspan | 64.4 m | ~64 |
| Tail height | 19.4 m | ~19 |
| Wing sweep | 37.5° | 37.5° |
