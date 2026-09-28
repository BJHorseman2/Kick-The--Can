# Sky Fury: World Tour ✈️🔥

Arcade **fighter-jet dogfights over the real world.** The cities and mountains
are Google's photorealistic 3D tiles, streamed live and rendered with
**CesiumJS**; on top of them: bandits on patrol, radar locks, homing missiles,
a cannon, a wingman, and an extraction portal. Plays in the browser on a phone
or a desktop.

**Stack:** Next.js (App Router) · React · TypeScript · CesiumJS · Google Map Tiles API.

---

## The game

**Campaign** — each clear unlocks the next:

1. **Paris: Seine Patrol** (ROOKIE) — three bandits over the City of Light; Flight School teaches the lock.
2. **San Francisco: City Intercept** (PRO) — five bandits, downtown to the Golden Gate.
3. **Chicago: Loop Siege** (ACE) — five bandits between the towers; one of them hunts you.
4. **New York: Manhattan Fury** (ACE) — six bandits, WTC to Central Park; extract at Lady Liberty.

**Bonus missions** (always open): **Yosemite: Granite Skies** and **Southampton: Dune Patrol**.

**How it plays.** The jet always flies forward. Find a red dot on the radar,
put it in your nose, hold for the lock, fire. Missiles home on their own (and
bandits pop flares — get closer, or go guns). You carry six missiles; fly
through the portal to rearm. Bandits shoot back: when INCOMING flashes, a red
arrow shows where from — break hard and boost. Splash every bandit, then
extract through the portal. Viper 2 flies on your wing; Overlord, the AWACS
controller, talks you through it with recorded radio calls.

**Also:** impact cam on missile kills, shields that recharge, kill streaks,
best score/time per mission, night mode with procedural city lights, a pause
menu, and a neon practice grid that needs no map key.

### Controls

| Keyboard | Touch | Action |
| --- | --- | --- |
| `W` / `S` | stick down / up | Dive / climb |
| `A` / `D` | stick left / right | Bank (turn) |
| `Q` / `E` | — | Rise / sink |
| `Space` | BOOST | Afterburner |
| `F` tap | FIRE tap | Missile (needs a lock) |
| `F` hold | FIRE hold | Cannon |
| `Esc` / `P` | ❚❚ | Pause |
| `R` | — | Retry from the end screen |

---

## Run it locally

**Needs:** Node.js 18.17+ (20+ recommended) and a Google Maps Platform key with
the Map Tiles API enabled (without one the game runs on the neon grid).

1. **Key.** In the [Google Cloud Console](https://console.cloud.google.com/):
   enable billing, enable **Map Tiles API**, create an API key, and restrict it
   to HTTP referrers (`http://localhost:3000/*` plus your deployed domains) and
   to the Map Tiles API. The key is used in the browser, so the restrictions
   are what protect it.
2. **Install and configure.**
   ```bash
   npm install                       # also copies Cesium's assets into /public/cesium
   cp .env.local.example .env.local  # then set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
   ```
3. **Play.**
   ```bash
   npm run dev                       # http://localhost:3000
   ```

Deep links for testing: `/?level=chicagosiege` jumps into a mission;
`&night=1` for night mode; `&world=grid` for the practice grid.

## Deploy

- **GitHub Pages (static):**
  `STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/Kick-The--Can/beta npm run build`, then
  publish `out/`. The live beta is at
  `https://bjhorseman2.github.io/Kick-The--Can/beta/`.
- **Vercel:** import the repo; see [VERCEL.md](VERCEL.md). Vercel also hosts the
  optional voice link (talk to Overlord live), which needs a server.

## Radio voice

Overlord and Viper 2's lines (`src/game/radioLines.ts`) are recorded once with
ElevenLabs or OpenAI text-to-speech into `public/voice/` by a GitHub Action,
and played through a military-radio effect in game. Lines without a recording
fall back to the browser's speech voice. `/audition` lets you hear candidate
voices before recording. See [VOICE.md](VOICE.md).

---

## Project structure

```
src/
├─ app/
│  ├─ page.tsx            # screens and flow: menu → loading → flight/pause → end
│  ├─ audition/page.tsx   # voice audition page
│  └─ globals.css         # all styling (HUD, menus, phone layout)
├─ components/
│  ├─ CesiumGame.tsx      # Cesium viewer, Google 3D tiles, memory tiers, night shader
│  ├─ StartScreen.tsx, Hud.tsx, GameOverScreen.tsx, TouchControls.tsx, Tutorial.tsx
└─ game/
   ├─ GameEngine.ts       # flight, bandits, weapons, wingman, camera, collisions, scoring
   ├─ levels.ts           # missions: start, bandit patrols, portal, campaign order
   ├─ constants.ts        # gameplay tuning
   ├─ sound.ts            # synthesized engine/weapon audio + the radio channel
   ├─ radio.ts, radioLines.ts, voiceBank.ts   # radio chatter and recorded voice
   ├─ tilePruner.ts       # frees city areas you've left (keeps memory flat)
   └─ storage.ts          # best runs (localStorage)
scripts/                  # Cesium asset copy, radio line + voice generators
```

### Google tiles: the rules this follows

Tiles load only through the official helper
(`Cesium.createGooglePhotorealistic3DTileset()`), streamed live from Google at
runtime. The game does not scrape, store, prefetch or cache tile content, and
Google's attribution stays visible bottom-right, per the
[Google Maps Platform terms](https://cloud.google.com/maps-platform/terms).

---

## Troubleshooting

- **Black world / "SIGNAL LOST":** the key is missing or invalid, the Map
  Tiles API isn't enabled, billing is off, or the domain isn't in the key's
  referrer list. The browser console says which.
- **Cesium assets 404 (`/cesium/Workers/...`):** run `node scripts/copy-cesium.js`
  (it runs automatically before `dev` and `build`).
- **Phone closes the game mid-mission:** that's the OS reclaiming memory. The
  game already runs leaner budgets on phones and restarts at reduced detail if
  the graphics context is lost; closing other tabs helps.
