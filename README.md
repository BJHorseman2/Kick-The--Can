# Sky Heist: Manhattan 🚁💎

An arcade **drone-heist** game played over real-world Manhattan. The world is
streamed photorealistic 3D — actual NYC buildings — via **Google Maps Platform
Photorealistic 3D Tiles**, rendered with **CesiumJS**. On top of that real world
we paint stylized arcade objects: glowing checkpoint rings, neon loot orbs, and
an escape portal.

> Real places become playable obstacle courses.

**Stack:** Next.js (App Router) · React · TypeScript · CesiumJS · Google Map Tiles API.

---

## What's in the MVP

- Full-screen CesiumJS viewer streaming Google Photorealistic 3D Tiles.
- A controllable futuristic drone that launches above Lower Manhattan.
- Arcade flight model (no realistic physics): constant thrust, snappy banking, boost.
- Smooth chase camera behind the drone.
- A three-city world tour of increasing difficulty (each completion unlocks the next):
  1. **Paris: City of Light** (SCENIC) — up the Seine past the Eiffel Tower, the Louvre and
     Notre-Dame to a portal above Sacré-Cœur.
  2. **San Francisco: Gate Runner** (PRO) — thread the Golden Gate, skim the bay to Alcatraz,
     slalom the downtown towers. Faster drone, 1.75× score.
  3. **Dubai: Burj Ascent** (ACE) — canyon-run the Marina, skim Palm Jumeirah, then climb the
     Burj Khalifa. Fastest drone, 2.25× score.
- Each level: glowing checkpoint rings, loot orbs, and an escape portal.
- Scoring: rings + loot + speed bonus + risky low-altitude bonus + time/perfect bonuses.
- Crash state when you hit the ground or a building.
- HUD: speed, altitude (AGL), timer, score, objective, collectibles.
- Start screen and game-over (crashed / completed) screen with restart.

---

## 1. Prerequisites

- **Node.js 18.17+** (Node 20+ recommended) and npm.
- A **Google Cloud** account with billing enabled.

Check your versions:

```bash
node -v
npm -v
```

---

## 2. Get a Google Maps Platform API key (Map Tiles API)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create (or select) a project.
3. **Enable billing** for the project (the Map Tiles API requires it).
4. Open **APIs & Services → Library**, search for **“Map Tiles API”**, and click **Enable**.
   - (The Photorealistic 3D Tiles are served through the Map Tiles API.)
5. Open **APIs & Services → Credentials → Create credentials → API key**.
6. Copy the key. Then click **Edit API key** and lock it down:
   - **Application restrictions →** HTTP referrers. Add:
     - `http://localhost:3000/*`
     - your production domain, e.g. `https://your-app.vercel.app/*`
   - **API restrictions →** Restrict key → select **Map Tiles API**.

> 💡 This key is used in the browser (Cesium fetches tiles client-side), so it
> can't be fully secret. The HTTP-referrer + API restrictions above are what
> keep it safe. Never commit `.env.local`.

---

## 3. Install & configure

From the project root:

```bash
# 1. Install dependencies (also copies Cesium's static assets into /public/cesium)
npm install

# 2. Create your local env file from the template
cp .env.local.example .env.local
```

Open **`.env.local`** and paste your key:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...your-real-key...
# optional, silences a Cesium console warning; not required:
NEXT_PUBLIC_CESIUM_ION_TOKEN=
```

**Where keys go:** only in `.env.local` (git-ignored). The app reads
`process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` at build/boot. Restart the dev
server after any change to `.env.local`.

---

## 4. Run it

```bash
npm run dev
```

Open **http://localhost:3000**, click **START HEIST**, wait a moment for the
3D tiles to stream in, and fly.

> **No API key yet?** The game still runs: click **FLY THE TRAINING GRID
> (demo)** to play the full mission (rings, loot, portal, scoring, crashes)
> over a stylized neon-grid world instead of photorealistic Manhattan.

### Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Dive / descend (nose down) |
| `S` / `↓` | Climb (nose up) |
| `A` / `←` | Bank left (turns you left) |
| `D` / `→` | Bank right (turns you right) |
| `Q` / `E` | Rise / sink — direct drone lift without pitching |
| `Space` | Boost |
| `R` | Restart after crash / completion |

On touch screens a virtual stick (left thumb) and BOOST button (right thumb)
appear automatically.

The drone always flies forward. Fly through the **cyan rings**, grab the **3
magenta loot orbs**, then dive through the **purple portal** to escape. Flying
**fast** and **low** scores more — but clip a building or the ground and you
crash. The yellow guide line points to your next objective.

---

## 5. Build for production

```bash
npm run build
npm run start
```

---

## 6. Deploy to Vercel (later)

1. Push this repo to GitHub.
2. Import it in [Vercel](https://vercel.com/new).
3. Add the env var **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** in
   **Project Settings → Environment Variables**.
4. Add your Vercel domain to the API key's HTTP-referrer allowlist (step 2).
5. Deploy.

The `prebuild` script copies Cesium's assets automatically during Vercel's build.

---

## Project structure

```
.
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx          # root layout + fonts + metadata
│  │  ├─ page.tsx            # screen/state orchestrator (start → play → game over)
│  │  └─ globals.css         # neon HUD + screen styling
│  ├─ components/
│  │  ├─ CesiumGame.tsx      # creates the Cesium Viewer + loads Google 3D Tiles + runs the engine
│  │  ├─ StartScreen.tsx
│  │  ├─ Hud.tsx
│  │  └─ GameOverScreen.tsx
│  └─ game/
│     ├─ GameEngine.ts       # flight model, entities, camera, collision, scoring, loop
│     ├─ constants.ts        # all gameplay tuning
│     ├─ route.ts            # Manhattan start + checkpoints + orbs + portal coordinates
│     └─ types.ts            # shared TS types
├─ scripts/
│  └─ copy-cesium.js         # copies Cesium static assets → /public/cesium (pre dev/build)
├─ next.config.js            # CESIUM_BASE_URL define + webpack fallbacks
├─ .env.local.example
└─ package.json
```

### How the Google tiles are loaded (and the rules)

The 3D tiles are loaded **only** through the official Cesium helper, which calls
the Google Map Tiles API directly:

```ts
Cesium.GoogleMaps.defaultApiKey = apiKey;
const tileset = await Cesium.createGooglePhotorealistic3DTileset();
viewer.scene.primitives.add(tileset);
```

This streams tiles live from Google at runtime. The app does **not** scrape,
store, prefetch, or cache tile content, and Google's required on-screen data
attribution is left visible in the bottom-right corner — per the
[Google Maps Platform terms](https://cloud.google.com/maps-platform/terms).

---

## Tuning & extending

- **Flight feel / scoring:** edit `src/game/constants.ts`.
- **The route:** edit `src/game/route.ts` (lon/lat/height of start, rings, orbs, portal).
- **Visuals of arcade objects:** the `build*` methods in `src/game/GameEngine.ts`.

### Roadmap (not in this MVP)

- Supabase for accounts, leaderboards, and saved runs.
- More cities / missions.
- Replace the placeholder box drone with a glTF model.

> Intentionally **not** included yet: multiplayer and realistic flight physics.

---

## Troubleshooting

- **Blank/black world, START works but nothing streams:** your API key is
  missing/invalid, the **Map Tiles API isn't enabled**, billing is off, or your
  domain isn't in the referrer allowlist. Check the browser console.
- **`Could not resolve "cesium"` from copy-cesium:** run `npm install` first.
- **Cesium assets 404 (`/cesium/Workers/...`):** re-run `npm run dev` (it runs
  `predev` → `scripts/copy-cesium.js`), or run `node scripts/copy-cesium.js`.
- **Tiles loaded but I crash instantly:** the ground/buildings load a beat after
  the tiles; the engine waits for a valid ground sample before it can crash you,
  so just give it a second on a fast connection.
```
