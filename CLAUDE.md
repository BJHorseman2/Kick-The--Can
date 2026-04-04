# CLAUDE.md — Kick the Can (Night Edition)

## Project Overview

A browser-based "Kick the Can" game built with **Phaser 3**. The player controls "It" (the seeker) with a flashlight mechanic in a dark arena, trying to catch AI-controlled hiders before they reach the central can for a jailbreak.

## File Structure

```
├── index.html    # Entry point — loads Phaser 3 from CDN, embeds game.js
├── game.js       # Entire game logic (single Phaser scene)
└── CLAUDE.md     # This file
```

There is no build system, package manager, or bundler. The game runs directly in a browser by opening `index.html`.

## Tech Stack

- **Phaser 3** (loaded from `cdn.jsdelivr.net`) — game framework with Arcade physics
- **Vanilla JavaScript (ES6+)** — no TypeScript, no transpilation
- **No npm/node** — no `package.json`, no dependencies to install

## How to Run

Open `index.html` in a browser. No build step or server required (though a local HTTP server avoids CORS issues with asset loading):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Architecture & Key Concepts

### Game Configuration (game.js:1-13)
- Canvas: 800×600, Arcade physics, dark background (`#0a1a0d`)
- Single scene with `preload`, `create`, `update` lifecycle functions

### Game Objects
| Object | Sprite Key | Description |
|--------|-----------|-------------|
| `it` | `'it'` (blue ball) | Player-controlled seeker, speed 180, flashlight radius 150 |
| `hiders` | `'player'` (yellow circles) | 3 AI hiders that drift toward the can |
| `can` | `'can'` | Central immovable target for jailbreaks |
| `jail` | zone | Top-right area (120×200) where captured hiders are held |

### Game States
- **`countdown`** — 3-second hide phase before play begins
- **`play`** — Active gameplay with movement and capture logic

### Hider States
- **`hiding`** — Moving toward the can, can be captured
- **`jailed`** — Held in jail zone, waiting for jailbreak
- **`freeing`** — Brief transitional state during jailbreak

### Visual System
- Dark overlay at 70% opacity (`overlay`, depth 10)
- Flashlight: inverted alpha geometry mask following "It"
- Hiders at 20% alpha outside flashlight range, full alpha inside

### Key Functions
| Function | Purpose |
|----------|---------|
| `handleItMovement()` | Arrow key input → normalized velocity |
| `capture()` | Tags hider as jailed if within flashlight radius |
| `tryJailbreak()` | Hider touches can → all jailed hiders released |

## Coding Conventions

- **No modules** — all code is in global scope with `let`/`const` declarations
- **Procedural style** — functions, not classes, for scene lifecycle
- **Inline constants** — game tuning values (speeds, radii, sizes) are hardcoded at point of use or at file top
- **Assets from CDN** — sprites loaded from `photonstorm/phaser3-examples` on jsdelivr
- **Minimal HTML** — instructions inline, single `<style>` tag for `body{margin:0}`

## Testing

No automated tests. Test manually by playing in the browser:
1. Verify arrow-key movement for "It"
2. Verify hiders drift toward the can
3. Verify flashlight reveals hiders on overlap
4. Verify capture only works within flashlight radius
5. Verify jailbreak releases all jailed hiders when a free hider touches the can

## Things to Watch Out For

- All sprites load from external CDNs — changes break if CDN is unavailable
- `tryJailbreak` spawns "Jailbreak!" text that is never cleaned up (potential memory leak on repeated jailbreaks)
- Hider AI is very simple (rotate toward can + constant velocity) — no pathfinding or evasion
- No win/lose condition is implemented yet
- The `<!-- codex:preview -->` comment in index.html enables Codex preview mode
