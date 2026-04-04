# CLAUDE.md — Kick the Can (Night Edition)

## Project Overview

A browser-based 3D "Kick the Can" game built with **Three.js**. The player controls "It" (the seeker) with a spotlight flashlight mechanic in a dark arena, trying to catch AI-controlled hiders before they reach the central can for a jailbreak. Playable on desktop (arrow keys / WASD) and mobile (touch joystick).

## File Structure

```
├── index.html    # Entry point — loads Three.js via import map, UI/HUD/joystick markup
├── game.js       # Entire game logic (Three.js ES module)
└── CLAUDE.md     # This file
```

No build system, package manager, or bundler. The game runs directly in a browser via `index.html`.

## Tech Stack

- **Three.js r160** (loaded via `cdn.jsdelivr.net` import map) — 3D rendering, lighting, shadows
- **Vanilla JavaScript (ES modules)** — no TypeScript, no transpilation
- **No npm/node** — no `package.json`, no dependencies to install

## How to Run

Must be served over HTTP (ES modules require it):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

For iPhone/mobile testing, bind to all interfaces:
```sh
python3 -m http.server 8000 --bind 0.0.0.0
# then open http://<your-ip>:8000 on your phone
```

## Architecture & Key Concepts

### Rendering
- Three.js WebGLRenderer with PCFSoft shadow maps and ACES filmic tone mapping
- PerspectiveCamera looking down at the arena from above
- FogExp2 for atmospheric darkness

### Lighting System
- **SpotLight** (flashlight): follows "It", primary visibility mechanic
- **AmbientLight**: dim green ambient to keep scene barely visible
- **DirectionalLight** (moonlight): very faint overhead fill

### Game Objects
| Object | 3D Shape | Description |
|--------|----------|-------------|
| `itMesh` | Blue sphere | Player-controlled seeker, speed 12, flashlight radius 8 |
| `hiders[]` | Colored spheres (yellow/orange/green) | 3 AI hiders drifting toward center can |
| `canGroup` | Red cylinder + silver lid + glow ring | Central target for jailbreaks |
| `jailFloor` | Semi-transparent plane | Top-right zone with corner posts |

### Arena
- World units: 40×30 (ARENA_W × ARENA_H)
- Ground plane with arena border outline
- All positions clamped to arena bounds

### Game States
- **`countdown`** — 3-second scatter phase, hiders move to random positions
- **`play`** — Active gameplay with movement, capture, and jailbreak logic
- **`won`** — All hiders captured, game displays win message

### Hider States
- **`hiding`** — Moving toward the can, can be captured
- **`jailed`** — Held in jail zone, lerps toward jail position
- **`freeing`** — Brief transition during jailbreak

### Input System
- **Keyboard**: Arrow keys and WASD, combined and normalized
- **Touch joystick**: Left half of screen, drag to steer (appears on touch)
- Both inputs merge into a single `input` vector

### Key Functions
| Function | Purpose |
|----------|---------|
| `animate()` | Main loop — handles countdown, movement, AI, capture, rendering |
| `updateFlashlight()` | Positions spotlight to track "It" |
| `moveToward()` | Moves a position toward a target at a given speed |
| `tryJailbreak()` | Hider reaches can → all jailed hiders released |
| `showMessage()` | Displays centered HUD message with fade |
| `makeTextSprite()` | Creates billboard text labels from canvas |

## Coding Conventions

- **ES module** — `import * as THREE from 'three'` via import map in HTML
- **Procedural style** — functions and top-level code, no classes
- **Constants at top** — arena size, speeds, radii, distances
- **No external assets** — all geometry is code-generated (spheres, cylinders, torus)
- **Responsive** — resizes to fill viewport, pixel ratio capped at 2

## Testing

No automated tests. Test manually:
1. **Desktop**: arrow keys / WASD move "It"; verify flashlight follows
2. **Mobile**: touch left side of screen to activate joystick; drag to move
3. Verify hiders drift toward the can during play
4. Verify hiders only visible when within flashlight radius
5. Verify capture triggers "Got [name]!" when overlapping an illuminated hider
6. Verify jailbreak releases all jailed hiders when a free hider reaches the can
7. Verify win condition when all 3 hiders are jailed

## Things to Watch Out For

- Three.js loaded from CDN — offline play requires bundling
- `makeTextSprite` creates canvas textures — if adding many, consider atlas
- Hider AI is simple (move toward center can) — no pathfinding or evasion
- Jailed hider position uses `lerp` with random targets each frame (jitter effect is intentional)
- The `<!-- codex:preview -->` comment in index.html enables Codex preview mode
