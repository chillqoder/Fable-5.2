# DEEPWAKE

An atmospheric voxel platformer. You are **ILO**, a small maintenance robot waking beneath a
collapsed research station. Restore three resonance relays, power the ascent lift, and reach the
surface.

Vanilla JavaScript + Three.js (vendored, pinned to 0.160.1). No build step, no account, no backend,
no CDN.

## Run

Serve the folder with any static HTTP server and open `index.html`:

```sh
python3 -m http.server 8080
# then open http://localhost:8080/
```

`npm start` runs the same command. Opening the file directly (`file://`) does not work because the
game uses ES modules.

## Controls

| Input | Action |
| --- | --- |
| `A / D` or `← / →` | Move |
| `Space` or `Z` | Jump — hold for a higher jump; press while touching a wall to kick away |
| `Shift` or `X` | Horizontal dash in the facing direction |
| `Q` | Echo pulse (35 resonance) |
| `E` | Interact — pick up, place or insert a power cell; switches, caches, archives, lift |
| `R` | Retry from the last checkpoint |
| `P` / `Esc` | Pause or resume |
| `Enter` | Confirm the main overlay action |

On touch devices on-screen buttons appear for left, right, jump, dash, pulse and use. Pause and
mute buttons are always in the top-right corner. `Restart Expedition` (full restart) lives in the
pause menu, separate from `Retry from Checkpoint`.

## How it plays

- **Echo pulse** reveals cracked seams, archives and conduits for 5 s, wakes relays, and stuns
  machines. Thick walls block it; the ring visibly stops where the wave is blocked.
- **Dash** shatters cracked amber seams and disables a *stunned* machine. Dashing into an active
  machine hurts.
- **Emergency shield**: with at least 50 resonance a hit costs 50 energy instead of integrity.
- **Power cells** open routes. While carrying one you move slower and cannot dash, pulse or use
  walls.
- **Deep cooling water** and machinery crushes always send ILO back to the last checkpoint.

## Checkpoints

Reboot stations commit the world when ILO steps onto them (start, after each relay, before the
final ascent, plus one in the Reservoir and one in the Foundry). Activating a relay also commits a
checkpoint at its station. A recovery (death or `R`) restores that committed snapshot: relays,
sockets, cells, seams, disabled machines, archives and caches. Anything changed after the commit is
rolled back. The expedition clock is never rewound, and every recovery is counted.

Checkpoints last for the session only. `Best Completion Time`, `Best Full-Archive Time` and
`Fewest Recoveries` are stored locally (versioned and validated); the game keeps working if storage
is unavailable.

## Validation

```sh
node tests/run.mjs            # 50 deterministic checks against the real simulation
node tests/run.mjs --verbose  # list every check with its measured values
```

The checks cover movement, walls, dash, pulse, damage, enemies, cells, puzzles, checkpoints, the
ending, records, and two scripted playthroughs that use ordinary inputs only (`tests/bot.mjs`): the
required route, and a full run with all three archives and all caches.

The same scripted player can drive the rendered game. In the browser console, after pressing
`Begin Expedition`:

```js
await __deepwake.botInit('main');   // or 'full'
while (__deepwake.botNext() !== null) await new Promise(requestAnimationFrame);
```

`__deepwake.step(n, input)` advances the real game by `n` fixed steps. This inspection API is for
checks only and is not part of the player interface.

## Layout

| Path | Role |
| --- | --- |
| `index.html`, `style.css` | Entry point, HUD and overlays |
| `src/sim.js` | Authoritative simulation (fixed 1/120 s step; no DOM, no rendering) |
| `src/level.js` | Collision grid and entity placement as explicit data |
| `src/config.js` | Tuning constants |
| `src/main.js` | Game states, fixed-step loop, event routing |
| `src/input.js`, `src/audio.js`, `src/ui.js`, `src/records.js` | Input, synthesized audio, interface, persistent records |
| `src/render/` | Three.js presentation: world, ILO, entities, effects, camera and lights |
| `vendor/` | Three.js 0.160.1 and its post-processing modules (MIT) |
| `tests/` | Deterministic checks and the scripted player |
| `FEATURE_AUDIT.md` | Feature-gap audit, decisions and verification evidence |
