# DEEPWAKE — Feature Audit

Audit of the playable candidate against the design specification, the changes made as a result,
and the evidence for each. Status values: `Working`, `Partial`, `Missing`, `Broken`.
Priorities: **P0** blockers and consistency, **P1** required behaviour, **P2** focused polish,
**Future** out of scope for this first expedition.

## How it was checked

- **Deterministic checks:** `node tests/run.mjs` — 50 checks against the real `src/sim.js`
  (not a re-implementation). Final run: **50/50 passed**.
- **Scripted player** (`tests/bot.mjs`): ordinary inputs only, no teleports, no state edits, no
  damage protection. Required route: completed in **1:41.45** of active time, 0 recoveries, 0
  integrity lost. Full route (3 archives, 3 caches): **2:16.35**, 0 recoveries.
- **Rendered game** (Chromium through Playwright, 1280×720): both routes replayed inside the real
  page with rendering, audio and UI active; a mid-run recovery at Relay A; the lift ending;
  screenshots of every region reviewed by eye.
- **Input, pause, audio, lifecycle:** driven in the page with real `KeyboardEvent` /
  `PointerEvent` dispatch and engine-state inspection.
- **Layouts:** 1280×720 desktop, 390×844 portrait, 844×390 short landscape.

## Observed defects and what was done

| Feature or defect | Current state and evidence | Player benefit | Priority | Decision | Acceptance check | Final status |
| --- | --- | --- | --- | --- | --- | --- |
| Lift console outside the boarding area | Broken at design review: console at x 212.2 was unreachable from the boarding area (207.3–210.7), so the ending could never start | The expedition can be finished | P0 | Implement: console moved onto the lift (`src/level.js` `mainLift.consoleX`) | Bot boards and departs; gating check passes | Working — `Ending: lift gated by all three relay IDs and the boarding area` |
| Ascent chimney hard to enter | Partial: from a 1-high block the wall-contact window was 0.39 u tall | The final climb starts reliably | P0 | Implement: 2-high service block with a step (`src/level.js`) | Climb from the block reaches y 30 | Working — `Walls: required shafts are climbable` (ascent chimney 2.8 s) |
| Flat, murky 3D presentation | Broken: first render had no shadows, a flat noisy rock wall, near-orthographic camera, low contrast (user rated it 2/10) | Readable depth, edges and mood | P1 | Implement: terraced voxel terrain, bevelled block textures, shadow-mapped key light, 5-unit-deep rooms with beams and pilasters, lamp light cones, perspective camera, restrained bloom + vignette (`src/render/world.js`, `renderer.js`, `vox.js`) | Screenshots of all four regions and the surface show cast shadows, depth layers and lit standable edges | Working — reviewed in the rendered game |
| Sentinel off-screen from the cover steps | Partial: only the warning line was visible; the machine itself was 14 u away | The threat and its vent window can be read before committing | P1 | Implement: camera zone with horizontal offset and 1.2× framing (`cameraZones`, `renderer.js`) | Screenshot from the cover steps shows steps, recess, lane and Sentinel together | Working |
| Relay A could not demonstrate pulse obstruction | Partial: relay sat 6.1 u from the closed shutter, outside pulse range | The "walls block the pulse" rule is observable at the first relay | P2 | Implement: relay moved to x 73.5 | Pulse from outside the closed shutter is blocked; succeeds once open | Working — `Pulse: relay activation is blocked by a closed shutter…` |
| Door threshold read as a pit | Broken (visual): a black sill under open doors looked like a gap in the floor | No false hazard on the main route | P2 | Implement: flat amber threshold marking (`entities.js` `door`) | Screenshot at door B | Working |
| Foundry service door too low | Partial: 2-high opening beyond a 3-wide lift gap caused head bumps | The optional archive is reachable without frustration | P2 | Implement: door spans the full room height | Bot walks from the lift into the service room | Working — full route collects Archive 3 |
| Water and waterfalls looked like static noise | Broken (visual) | Deep water reads as water | P2 | Implement: smoother, darker surface texture | Screenshot of the crossing | Working |
| Portrait framing too distant | Partial: 31 u of world height on a 390×844 screen | ILO and edges stay readable on phones | P2 | Implement: minimum framed width 12 u | Portrait screenshot | Working (26 u tall view) |
| Station and relay light blow-out | Partial: ILO washed out next to a lit station and relay | Silhouette stays readable | P2 | Implement: lower accent-light intensities | Screenshot at Relay B station | Working |
| ILO's face hidden in side view | Partial: lens barely visible at a 55° turn | The lens identity light is visible while moving | P2 | Implement: 40° turn, larger lens, brow ridge | Close-up screenshot | Working |

## Required features

| Feature | Current state and evidence | Priority | Final status |
| --- | --- | --- | --- |
| Movement: acceleration, braking, variable jump, coyote, buffer, ceiling, no double jump | 0→6.5 u/s in 0.158 s; held jump 2.59 u; 58 ms tap 1.34 u; coyote accepted at +83 ms and refused at +133 ms; buffer honoured at −100 ms | P1 | Working |
| Wall slide and wall jump | Slide capped at 3.00 u/s; launch 7 / 12.5 u/s; ~100 ms steering lock; no slide while grounded; three required shafts climbed | P1 | Working |
| Dash | 20 steps (0.167 s), 2.50 u, gravity suspended, locked direction, 0.45 s cooldown, one per airborne sequence, refresh on landing and wall jump, no tunnelling | P1 | Working |
| Echo pulse | Cost 35, cooldown 0.7 s, regeneration after 1.5 s at ~20/s, radius between 5.64 and 6.32 u, line of sight, one response per target, single denial cue | P1 | Working |
| Emergency shield and damage | Shield at ≥50 energy; one outcome per hit; 0.8 s / 1.2 s immunity; safe knockback; water and crush bypass the shield | P1 | Working |
| Checkpoints | Relay commit is atomic; later switch, archive, seam, cache and cell changes roll back; clock not rewound; one recovery per event; 60 recoveries leave an identical world | P0 | Working |
| Cells and sockets | Pick up, carry limits, safe placement, explicit priority, one cell per socket, no duplication over a 6000-step input fuzz or through recovery | P0 | Working |
| Three relay puzzles | Workshop circuit, Reservoir bridge, Foundry counterweight all solved by the bot; latch persists after the cell is removed; puzzle is reversible | P1 | Working |
| Cable Skitter | Telegraph 0.50 s; locked 3.64 u lunge; bounded patrol x 45.0–52.2 over 40 s; stun is harmless; dash disables only when stunned | P1 | Working |
| Prism Drone | Aim 0.81 s with direction lock; bolt stops at terrain; pulse cancels the shot; stunned drone can be dashed | P1 | Working |
| Shutter Sentinel | Warning 0.91 s; lane x 142–156 ends at cover; three cover spots safe across two cycles; closed armour deflects; open core disables | P1 | Working |
| Vents and press | First-exposure vent warning 0.80 s; press crushes only on sustained closure; side contact is harmless | P1 | Working |
| Moving platforms and lifts | 2.00 s dock pause; rider displacement equals platform displacement; no jump boost; lift stalls above ILO instead of crushing | P1 | Working |
| Exploration | Exactly three archives (one per region) and three caches; cache gives 25 energy, 0 at full; committed discoveries survive recovery | P1 | Working |
| Ending | Lift needs all three relay IDs and the boarding area; one result commit; clock stops; input, retry and damage ignored during the 12.2 s sequence | P1 | Working |
| Records | Completion-only; full-archive needs 3/3; fewest recoveries with time tie-break; corrupt, wrong-version, throwing and missing storage handled | P1 | Working |
| Input and UI | Held confirm/jump key ignored after an overlay closes; focus loss pauses and clears input; held `E` interacts once; retry vs restart distinct; all controls inside all three viewports | P1 | Working |
| Audio | Context created only after a gesture; mute drives the master bus; pause stops the scheduler; hidden tab suspends the context; no notes scheduled while paused or hidden | P1 | Working (engine state verified; not checked by ear) |
| Lifecycle | 12 recoveries + 6 restarts in the page: geometry, texture, scene-child and listener counts unchanged | P1 | Working |
| WebGL unavailable | A game instance with a failing context shows the fallback message and does not throw | P1 | Working |

## Tuning deviations from the starting values

| Value | Specified | Used | Reason |
| --- | --- | --- | --- |
| Dash duration | 0.16 s | 0.167 s (20 fixed steps), 2.50 u | 1/120 s step quantisation |
| Short jump | "tap ≈ 1.2–1.5 u" | 2.8× gravity while rising after release | Gives 1.34 u for a 58 ms tap |
| Shield / damage knockback | not specified | 3.5 / 5.5 u/s horizontal | Small enough not to throw ILO off the crossing platform |
| Vent cycle | warning ≥ 0.6 s | 1.5 s dormant, 0.8 s warning, 1.0 s active, 3.0 u tall | Matches the walk time between safe spots |
| Stations | start, each relay, before ascent | plus one in the Reservoir and one in the Foundry | Shorter replays after water and press failures |
| Rooms | — | 5.1 u deep (was 3.6 u) | Presentation only; gameplay stays at z = 0 |

## Deferred

| Item | Priority | Reason |
| --- | --- | --- |
| Second Skitter in the relay C gallery | Future | Would stack carrying restrictions with an enemy; untested difficulty |
| Gamepad support, `W`/`↑` jump alias | Future | Not in the specified control table |
| Mid-run saves | Future | Specification keeps checkpoints in-session |
| Foreground silhouettes | Future | Risk of hiding landing surfaces; terraced rock already frames the scene |

## Limitations of this verification

- No human hands-on playthrough was performed. Completion, reachability and timing come from the
  scripted player; "feel" and first-time readability were judged from screenshots and measured
  values only.
- The **8–12 minute first playthrough** target was not measured. The scripted route takes 1:41 of
  active time with perfect execution; a first human run will be several times longer, but that is
  an expectation, not a result.
- Audio was verified through engine state (context state, voice counts, scheduler counters), not by
  listening.
- Touch input was exercised with synthetic pointer events in a desktop browser, not on a physical
  device.
- Frame rate was observed only in the automation browser on the development machine (about 100
  frames per second at 1280×720); no low-end or mobile hardware was measured.
