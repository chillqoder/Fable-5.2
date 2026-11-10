# DEEPWAKE — Complete Voxel Platformer Creation and Improvement Prompt

You are a game designer, gameplay programmer, voxel artist, sound designer, and QA engineer. Build a complete, polished browser platformer called **DEEPWAKE**, or rebuild the active game around this specification if an implementation already exists.

Deliver a playable game, not a mockup, concept presentation, or list of suggestions. Implement the required systems, inspect the result, fix the meaningful gaps, and verify the final experience.

**All player-facing text, menus, controls, notifications, result screens, documentation, and feature-audit notes must be in English.**

## 1. Identity and core experience

DEEPWAKE is an atmospheric, movement-focused platformer set inside a buried industrial sanctuary. Render its world and characters as carefully designed voxel models in Three.js. Gameplay takes place on a two-dimensional plane within a three-dimensional scene.

The player controls **ILO**, a small maintenance robot waking beneath a collapsed underground research station. The station's only ascent lift has no power. ILO must reactivate three resonance relays, reconnect the lift, and escape to the surface.

Build the experience around these pillars:

- Precise running, variable-height jumping, wall slides, wall jumps, and short horizontal dashes.
- Echo pulses that reveal nearby information and briefly interrupt vulnerable machines.
- Readable underground routes with vertical traversal, quiet exploration, and short bursts of danger.
- Three distinct regions: the Buried Workshop, the Crystal Reservoir, and the Silent Foundry.
- Encounters solved through positioning, observation, disabling attacks, and movement.
- Small environmental puzzles involving portable power cells, sockets, shutters, and lifts.
- A final ascent that combines familiar mechanics.
- Checkpoint-based recovery, optional discoveries, and completion records.

The central loop is: **observe a chamber → reveal or understand its mechanism → traverse hazards → activate a relay → open the next route**.

Aim for a complete first playthrough of approximately 8–12 minutes, with optional exploration extending the run. Prioritize reliable controls and a completable route over map size or visual density.

This specification replaces the previous game's narrative, character designs, enemy logic, abilities, pickups, progression, level structure, UI, and ending. Reuse sound technical infrastructure when appropriate, but rebuild systems whose behavior conflicts with this design.

## 2. Inspect an existing project before rebuilding

If code already exists:

1. Read project instructions and identify the active playable entry point, renderer, simulation, level data, input system, assets, and validation tools.
2. Run and inspect the actual game when browser tools are available.
3. Inventory reusable infrastructure and identify incompatible gameplay systems.
4. Integrate the new design into the active project; keep one primary playable entry point.
5. Remove obsolete player-facing names, models, mechanics, instructions, and result fields from the active experience.
6. Preserve unrelated user files and work.

If starting from scratch, create a compact feature inventory and implement the complete required experience below.

Use numerical values as coherent starting points. Tune them against the authored course, and document meaningful deviations in the feature audit.

## 3. Technical delivery

- Use `index.html` as the primary entry point.
- Use vanilla JavaScript and Three.js unless the existing project already has a suitable established architecture.
- Make the game runnable from a simple local HTTP server without a mandatory build step, account, backend, or online service.
- Vendor the rendering library locally and pin its version. The finished game must not require a CDN connection.
- Generate voxel models, small pixel textures, effects, and synthesized audio procedurally where practical.
- Use compact, clearly named supporting modules. A single-file implementation is acceptable when maintainable.
- If a strictly single-file deliverable is explicitly requested, embed all required runtime code and assets.
- Separate authoritative simulation, rendering, audio, UI, and persistent records.
- Define collision geometry and entity placement as explicit level data. Rendering must reflect that data without determining collisions.
- Keep gameplay at `z = 0`; reserve depth for scenery and visual construction.
- Use a fixed simulation step, preferably `1 / 120` second, with a capped accumulator and a separate render loop.
- Use deterministic level construction and restart behavior.
- Handle unavailable WebGL, audio, and storage gracefully. Audio or storage failure must never prevent play.
- Expose a small deterministic inspection API if useful for checks; keep debugging details out of the player interface.

## 4. Art direction and underground readability

### Overall appearance

Create a dark, atmospheric world with legible silhouettes and carefully placed light. Build shapes from aligned cubes, stepped rock faces, simple mechanical assemblies, and restrained pixel textures. Use flat or lightly shaded materials, contact shadows, and controlled emissive accents.

Darkness is a mood, not a visibility test. The player must always distinguish solid ground, platform edges, wall-jump surfaces, active hazards, enemies, and interactive objects.

| Element | Visual direction |
| --- | --- |
| Deep background | Blue-black, around `#101923` |
| Foreground rock | Cool slate, around `#384552` |
| Traversable edges | Lighter blue-gray stone or pale metal trim |
| Old machinery | Oxidized steel, muted bronze, rust |
| Resonance crystals | Desaturated cyan with bright cores |
| Active power connections | Warm amber |
| Safe stations | Soft teal illumination |
| Armed hazards | Orange-red with shape and motion cues |
| ILO's chassis | Pale ceramic and charcoal joints |
| UI | Warm off-white text on a restrained dark backing |

Use small textures, such as 16 by 16 pixels, with nearest-neighbor filtering. Keep texel scale consistent. Avoid dense visual noise, excessive particles, aggressive bloom, and fully black landing zones.

### Three regional identities

**Buried Workshop:** fractured maintenance halls, hanging cables, dust shafts, old benches, dormant tools, square stone columns, and warm emergency lamps. This region teaches controls and safe interactions.

**Crystal Reservoir:** layered natural caverns around shallow reflective water, tall cyan crystal formations, suspended stone shelves, old access bridges, and distant waterfalls. This region emphasizes wall movement, vertical routes, pulse discovery, and platform timing. Use mineral formations and thin luminous mineral veins for natural accents.

**Silent Foundry:** abandoned presses, counterweights, slow piston assemblies, suspended service platforms, cooling channels, and amber power conduits. This region combines traversal, sentries, and power routing.

Give the final lift shaft a visible vertical destination: a distant pale opening above the machinery. Reveal warm daylight only after the final escape.

Use multiple depth layers and subtle camera-relative parallax. Background rocks, water, rails, and machines must never disguise a playable gap or imply a collision surface that does not exist.

## 5. ILO: original protagonist

Build a distinctive small utility robot with a compact torso, a chamfered rectangular ceramic head, a dark face panel, one offset amber optical lens, a short flexible antenna, articulated charcoal limbs, oversized magnetic feet, and a small cyan resonance module mounted in the chest.

A short rust-orange utility cape may hang from one shoulder. Keep it restrained and behind the body so it never hides the feet or wall contacts. ILO has no human facial features or clothing-based transformation states.

At normal play scale, the player must recognize the head, lens, torso module, hands, articulated knees, and separate feet. The lens and chest module provide a consistent visual identity in dark areas.

- Approximate collision body: 0.75 units wide and 1.5 units high.
- Define position at the center of the feet.
- Keep collision dimensions constant throughout the game.
- Animate limbs through explicit shoulder, hip, knee, and ankle pivots where practical.
- Use lens direction and body orientation to indicate facing.
- Small cosmetic antenna and cape movement must not affect simulation.

### Animation set

Include idle scanning, walking, running, takeoff, ascent, falling, landing compression, wall slide, wall jump, dash lean, pulse emission, lifting and carrying a cell, socket interaction, relay activation, damage recoil, shutdown, checkpoint reboot, and lift arrival.

Animations must communicate the gameplay state without moving the authoritative collision body. Preserve body proportions and readable feet contacts.

## 6. Controls

| Input | Action |
| --- | --- |
| `A / D` or `Left / Right` | Move |
| `Space` or `Z` | Jump; hold for a higher jump; jump away from a contacted wall |
| `Shift` or `X` | Horizontal dash in the facing direction |
| `Q` | Emit an echo pulse |
| `E` | Interact; pick up, place, or insert a nearby power cell |
| `P / Escape` | Pause or resume |
| `R` | Retry from the last checkpoint during play |
| `Enter` | Confirm the main overlay action |

Provide accessible pause and mute buttons. Put a separate full-run restart action in the pause menu. Label checkpoint retry and full restart distinctly.

Provide touch controls for left, right, jump, dash, pulse, and interact. Support movement while jumping or using an ability. Keep controls inside safe viewport margins and verify a compact landscape layout.

Prevent handled keys from scrolling. Use fresh presses for jump, dash, pulse, and interaction. Holding interact must not repeatedly insert and remove the same cell.

Release all held inputs on focus loss, pointer cancellation, lost capture, pause, retry, full restart, and scene transitions. Never let a held confirmation key immediately activate gameplay after an overlay closes.

## 7. Movement and collision contracts

### Suggested baseline

One ordinary terrain voxel is approximately one world unit. Subdivide character models more finely when needed.

| Parameter | Starting value |
| --- | ---: |
| Maximum movement speed | 6.5 units per second |
| Ground acceleration | 42 units per second squared |
| Air acceleration | 28 units per second squared |
| Ground braking | 38 units per second squared |
| Air braking | 8 units per second squared |
| Gravity | -32 units per second squared |
| Jump launch speed | 13 units per second |
| Fall speed limit | 24 units per second |
| Coyote time | 110 milliseconds |
| Jump buffer | 140 milliseconds |
| Wall-slide fall speed limit | 3 units per second |

A held ordinary jump should rise approximately 2.6 units. Tune jump release so a short tap rises approximately 1.2–1.5 units. Design mandatory ordinary jumps below the measured maximum, with a forgiving landing margin.

### Wall movement

Touching a valid vertical rock or metal wall while airborne and holding toward it starts a wall slide. Grounded side contact must not start a slide.

A fresh jump press during wall contact launches ILO up and away, with approximately 7 units per second horizontal and 12.5 units per second vertical velocity. Use a brief steering lock of around 100 milliseconds to make the separation visible, then restore control.

Allow repeated wall jumps between suitable walls. Design each required climbing shaft with enough horizontal space for the full body and enough vertical clearance for the jump arc.

### Required collision guarantees

- Stable standing on ground, ledges, lifts, moving platforms, and cell tops only where explicitly intended.
- No false side collision from a surface on which ILO is already standing.
- Reliable ceiling resolution during jumps and wall jumps.
- No tunneling during dashes; use swept collision or conservative substeps.
- Moving-platform displacement is applied once per simulation step and does not amplify jump velocity.
- Crush detection distinguishes sustained closure from ordinary side contact.
- Dynamic shutters never close through ILO or a carried cell; delay closure or reopen safely.
- Decorative rails, light cones, mist, and background machinery never determine contacts.
- State transitions never leave the player embedded in terrain.
- Contact hazards award damage only through their explicit active collision regions.

## 8. Abilities and shared energy

ILO begins with all three movement and sensing abilities available. Teach them through the opening chambers. Do not hide essential movement behind optional rewards.

### Horizontal dash

- Launch in the facing direction at approximately 15 units per second for 0.16 seconds.
- Suspend gravity during the dash and use a controlled exit velocity.
- Allow one dash per airborne sequence. Refresh it after a valid ground landing or a successful wall jump.
- Apply an approximately 0.45-second cooldown between activations, including refreshes.
- Dash does not consume resonance energy.
- Ordinary stone and metal stop the dash safely.
- A dash can shatter visibly cracked amber crystal seams and damage a vulnerable disabled machine.
- A dash does not grant general invulnerability. Active hazards remain dangerous.
- Dash direction remains locked for its duration; pressing the opposite direction does not reverse it midway.

Place a clearly readable harmless seam in the tutorial so the player learns its material language before using it near a gap.

### Echo pulse

Pressing `Q` emits a short circular resonance wave centered on ILO.

- Maximum resonance energy is 100.
- A pulse costs 35 energy and has a 0.7-second cooldown.
- Regeneration starts 1.5 seconds after the last pulse or shield activation and restores approximately 20 energy per second.
- Pulse radius is approximately 6 units.
- Pulse expands over roughly 0.35 seconds; each eligible entity responds at most once to that pulse.
- Nearby hidden seam markings, optional archive alcoves, and conductive connections remain highlighted for approximately 5 seconds.
- Pulse-sensitive relay nodes activate only when directly reached by the wave.
- Vulnerable machines are stunned according to the enemy rules below.
- Thick opaque walls block functional pulse effects. Represent this with deterministic line-of-sight checks; thin crystal seams may transmit the wave and must be visually distinct.
- Cosmetic rings may fade against walls, but they must not imply a functional hit that did not occur.

Insufficient energy produces one quiet cue and a brief meter response. It must not consume energy, trigger an effective pulse, or spam notifications while the key is held.

The pulse reveals information; it does not manufacture platforms or make ordinary terrain disappear.

### Emergency shield

When ILO would take an ordinary contact, projectile, beam, or vent hit and has at least 50 resonance energy, automatically spend 50 energy to absorb that hit. Show a brief geometric shield fracture and apply approximately 0.8 seconds of damage immunity.

Without enough energy, lose one integrity unit and receive approximately 1.2 seconds of damage immunity. One hit cannot spend shield energy and also remove integrity. Immunity suppresses all ordinary damage sources, including repeated overlap with a beam or vent. Knockback must resolve safely against walls.

The shield does not protect against falling out of the playable world or a confirmed machinery crush. Those events trigger checkpoint recovery.

## 9. Integrity, recovery, and checkpoints

ILO has three integrity units. There is no finite-life pool and no lethal countdown. A small optional run clock supports personal completion records.

Reaching zero integrity triggers a short visible shutdown followed by checkpoint recovery. Stop accepting damage immediately when shutdown begins; overlapping hits must not start multiple recovery sequences.

Place a reboot station at the start and after each relay, plus a safe station before the final ascent. Activating a station repairs integrity, refills energy, and commits the run's persistent world state.

Checkpoint recovery restores that committed snapshot:

- Restore ILO at the station with full integrity, full energy, zero velocity, and a short contact-immunity period.
- Preserve every relay, collected archive, and salvaged cache included in the snapshot.
- Roll back relay activations, cell placements, pickups, broken seams, and disabled enemies changed after the snapshot.
- Reset local enemies, hazards, platform phases, and loose cells to deterministic snapshot-safe positions.
- Clear transient effects, projectiles, ability timers, input, and camera offsets.

When a relay activates, commit an atomic checkpoint at its nearby safe station. The restored snapshot must contain all committed socket and route changes, not just a relay count.

Track recoveries separately from the restored world. Retrying adds one recovery and does not rewind elapsed run time. Avoid counting an automatic death recovery twice.

Checkpoints are an in-session system; local persistence is required for records, not for arbitrary mid-run saves. Full restart creates a fresh world and clears all run state while preserving personal records.

## 10. World structure and progression

Build a connected, authored course with a general left-to-right progression and meaningful vertical chambers. Use approximately 180–240 units of route length across multiple elevations, rather than a long flat corridor.

| Region | Main purpose | Required encounters and traversal |
| --- | --- | --- |
| Buried Workshop | Teach movement, dash, pulse, and interaction | Safe steps, a small gap, a training seam, one vulnerable enemy, a cell socket, Relay A |
| Crystal Reservoir | Develop vertical movement and observation | Wall-jump shafts, a slow platform above water, a pulse-revealed side passage, Relay B |
| Silent Foundry | Combine movement with machines and power routing | Telegraphing sentry, timed vents, a counterweight lift puzzle, Relay C |
| Ascent Shaft | Apply learned skills and escape | A short climb using walls, service platforms, and timed hazards, followed by the main lift |

Teach one mechanic in a safe setting before combining it with another. Use illuminated edge trim, mechanical motion, small signs, and enemy behavior to communicate routes.

Each relay powers a visible conduit segment leading toward the central ascent machinery. Update the HUD and nearby world lighting immediately. The newly opened route should be visible from the relay chamber or clearly indicated by a short restrained camera look.

### Required route rules

- Every required jump and dash must have measured reachability and room to land.
- Mandatory paths cannot depend on a secret, a damage boost, an exploit, or a hidden collectible.
- The first wall-jump shaft has safe ground beneath it.
- The first moving platform has a generous boarding window.
- Provide safe observation spots before timed hazards and enemy attacks.
- Maintain recovery space after demanding combinations.
- No puzzle requires carrying a cell across a gap that cannot be crossed under the carrying rules.
- Reaching a region's relay must not strand ILO behind a closed shutter.
- The final lift is unlocked only when all three relay IDs are active. Repeated interaction cannot fabricate progress.

Small optional loops may return to the main route. This is a focused course, not an open-ended procedural world.

## 11. Environmental objects and puzzles

### Portable power cells and sockets

Use large, faceted amber battery cells with visible handles. These are puzzle objects, not consumable combat upgrades.

- A fresh interact press picks up the nearest eligible cell within approximately 1.3 units.
- While carrying, movement speed is reduced to 4.5 units per second.
- Ordinary jumping remains available; dash, pulse, wall slide, and wall jump are unavailable until the cell is placed or inserted.
- Show this state through the carrying pose and subdued ability icons.
- Interact near a compatible empty socket inserts the carried cell; otherwise it places the cell safely in front of ILO.
- Reject placement inside terrain or hazards. Retain the carried cell when placement is impossible.
- A cell may power one socket at a time. A socket accepts one cell.
- Inserted cells cannot be duplicated through repeated input or checkpoint recovery.

Define interaction priority explicitly: compatible socket for a carried cell, nearby loose cell, removable socketed cell, then other interactables. Highlight the current target.

Use three concise puzzle variations:

1. **Workshop circuit:** carry a cell along safe ground to open a shutter; pulse the exposed relay node.
2. **Reservoir bridge:** reach a fixed power switch through a wall-jump route; activate a slow crossing platform; traverse it and pulse Relay B. No carried cell is required in the climbing section.
3. **Foundry counterweight:** insert a cell into a lower lift socket, ride to an upper switch, and latch the upper route open. The route remains accessible after the cell is removed; then carry that cell along safe ground to the relay socket and pulse Relay C.

Show each mechanism's powered state through lit conduits and motion. Do not rely on a long text explanation.

### Moving platforms and machinery

Use a small number of deterministic platforms with bounded paths and clear endpoints. They pause briefly at boarding positions. Carry a standing player correctly and allow clean jump departure.

Vent jets use three visible stages: dormant, warning, and active. Give a first-exposure warning of at least 0.6 seconds. Their visible active volume and damaging volume must agree.

Heavy presses are optional traversal hazards in the foundry. If included, telegraph their motion, provide a safe waiting recess, and verify crushing and recovery. Do not add them if reliable collision handling is unfinished.

### Water and falls

Reservoir water is non-swimmable cooling water. Clearly distinguish shallow decorative pools outside the gameplay lane from dangerous deep channels.

Falling into a deep channel or below a chamber's explicit recovery boundary triggers a brief shutdown and checkpoint recovery. Do not leave the player walking on invisible water or falling indefinitely.

## 12. Original enemies and encounter rules

Create enemies as distinct cave-adapted industrial machines. Each has its own silhouette, sensory cue, and state machine. Contact from above follows the same damage rules as side contact; jumping onto an enemy is not an attack.

### Cable Skitter

A low rectangular maintenance machine with six thin jointed legs, a trailing cable, and an amber sensor bar.

- States: dormant, patrol, alert, lunge, stunned, disabled.
- Patrols a physically bounded service surface at approximately 1.4 units per second.
- Turns before exposed ledges using a floor-ahead check.
- Detects ILO within approximately 5 units with an unobstructed view.
- Telegraphs a short forward lunge for roughly 0.5 seconds before attacking.
- Cannot retarget in the middle of a lunge; follows with a recovery pause.
- An echo pulse stuns it for approximately 2 seconds.
- Dashing into a stunned Skitter permanently disables it until checkpoint restoration or full restart.
- Dashing into an active Skitter is harmful. Make active and stunned states clearly different.

### Prism Drone

A floating faceted surveillance unit with three orbiting voxel plates and a cyan-to-amber lens.

- States: patrol, aim, fire, cooldown, stunned, disabled.
- Follows a short bounded airborne route inside its chamber.
- When ILO is visible, stops and displays a narrow targeting line for approximately 0.8 seconds.
- Locks the aim direction before firing one slow energy bolt; does not track ILO through the shot.
- Bolts collide with solid terrain and expire after a bounded lifetime.
- A pulse interrupts aim and stuns the drone for approximately 2.5 seconds.
- Place every required drone encounter near a reachable ledge so a stunned drone can be disabled with a dash, or safely bypassed.

### Shutter Sentinel

A heavy wall-mounted rectangular machine with sliding armor panels and a visible red-orange core.

- States: closed, warning, firing, venting, disabled.
- Closed armor blocks disable attempts.
- A warning light and a visible line indicate its firing lane before an approximately 0.9-second beam burst.
- After firing, panels open during a roughly 2-second venting window.
- An echo pulse reaching the open core disables the Sentinel.
- Pulse against closed armor gives clear deflection feedback and does not change its state.
- Beams stop at solid cover. Their damage volume must match the visible lane.
- Provide a safe cover recess before the first Sentinel encounter.

### General enemy guarantees

- Activate encounters near the current chamber or viewport; distant enemies do not exhaust their attack cycles offscreen.
- Stunned machines cannot deal contact damage or attack.
- Disabled machines immediately stop all harmful contacts and attacks.
- Existing emitted projectiles retain their own rules unless explicitly cleared by a transition.
- Each disable is recorded once per world state; duplicate collisions do not create duplicate statistics.
- Enemy attack timing freezes during pause, overlays, and recovery transitions.
- Telegraphs use shape, animation, and sound as well as color.
- Defeating every enemy is optional. A careful player can bypass encounters through movement and cover.

## 13. Exploration and optional discoveries

Include exactly three **Memory Archives**, one in each main region. They contain short environmental fragments about the station and provide a clear completion objective for exploration.

Suggested placements:

1. A workshop maintenance alcove behind a pulse-marked cracked seam.
2. An upper reservoir shelf reached through an optional wall-jump route.
3. A foundry service room reached by observing a secondary powered connection.

Hidden seams must exist as visible physical surfaces before discovery. The pulse highlights a subtle fracture pattern; a dash breaks the seam. Do not use arbitrary invisible walls or floor blocks that unexpectedly appear.

Use a few one-time **Salvage Caches** tucked along optional routes. They contain visual repair scraps and immediately refill 25 resonance energy. Collect by interacting with the cache; show the energy gain once. At full energy, allow collection and record it without generating an upgrade.

Neither archives nor caches modify ILO's collision size, unlock mandatory abilities, or grant extra lives. Avoid trails of small currency pickups; guide the player with lights, architecture, and mineral growth.

Track discoveries by stable IDs. Collecting an archive triggers one short English text fragment and a restrained sound. Allow the fragment to be dismissed or read from a compact pause-menu archive panel.

A checkpoint commits collected discoveries. Recovery restores the committed discovery state consistently with the rest of the world. The run's completion screen reports the final retained discoveries.

## 14. Camera and presentation

Use an orthographic or low-perspective three-quarter side camera that keeps platform surfaces and ILO's silhouette readable. Keep control directions aligned with screen-left and screen-right.

- Smoothly follow horizontal movement with a small look-ahead.
- Frame vertical shafts so the next ledge and the ground beneath ILO remain understandable.
- Use chamber camera bounds to avoid exposing unfinished voids.
- Ease between framing zones without affecting collision coordinates.
- Avoid sudden camera movement during precision jumps.
- Clamp damage shake to a small amount and provide a reduced-motion option.
- Relay activation may briefly highlight the powered route, then restore control and framing safely.
- Decorative foreground silhouettes must not obscure active encounters or landing surfaces.

Ensure the dash destination is normally visible before the player commits. Recalculate framing for narrow screens without changing world-space movement or hazard timing.

## 15. States, pause, and restart

Use explicit states such as `title`, `play`, `paused`, `relayActivation`, `shutdown`, `reboot`, `liftSequence`, and `complete`.

Pause freezes simulation, abilities, enemies, projectiles, hazards, moving platforms, gameplay animation timers, and the run clock. Silence or suspend gameplay music while paused or while the page is hidden.

Pressing `R` during ordinary play initiates checkpoint recovery. It must not restart the complete run or remove committed progress. Disable repeated retry input during shutdown or reboot.

The pause menu's `Restart Expedition` action resets all run-specific state: relays, sockets, cells, pickups, seams, archives, caches, machines, projectiles, timers, recovery count, checkpoint snapshot, effects, inputs, and camera. It retains only validated personal records and user settings.

Define the completion clock as active expedition time: count ordinary play and the fixed ability/puzzle interactions performed under player control; exclude title, pause, shutdown/reboot presentation, locked relay cinematics, and the final lift celebration. Retrying must not roll back accumulated time. Apply this definition consistently.

## 16. Final ascent and ending

After Relay C activates, visibly power the ascent shaft and open its entrance. The final climb combines a short wall-jump section, a moving service platform, a timed vent, and one optional enemy bypass.

Place a reboot station before this section so failure does not force replaying the foundry puzzle.

At the top, ILO reaches the main lift. Interacting with its console succeeds only when:

- All three relay IDs are active.
- ILO stands inside the valid boarding area.
- The lift is idle and the expedition is still in play.

Use a staged ending:

1. Commit the run result exactly once and stop the completion clock.
2. Disable normal input and damage.
3. Close the lift's protective barrier after safe boarding.
4. Raise the lift through the shaft while underground light recedes.
5. Reveal a quiet surface opening with warm dawn light and drifting dust.
6. Show ILO stepping onto a small ruined observation terrace.
7. Save records and display the completion overlay.

Use a restrained musical resolution and environmental payoff. The route ends through restoring machinery and reaching the surface, with no score-conversion ceremony.

## 17. UI, results, and records

Use a compact HUD with:

- `Integrity`: three clearly readable segments.
- `Resonance`: a 0–100 energy meter with ability costs indicated accessibly.
- `Relays`: three individually identified states, A / B / C.
- `Archives`: collected count out of three.
- Accessible pause and mute controls.

Show contextual prompts only near meaningful interactions, such as `E — Insert Cell`, `Q — Echo Pulse`, or `E — Activate Lift`. Do not cover landing zones. Show carrying status through a small cell icon and the robot's pose.

| State | Main text | Primary action |
| --- | --- | --- |
| Title | `DEEPWAKE` | `Begin Expedition` |
| Pause | `Expedition Paused` | `Resume` |
| Recovery | `Rebooting at Station` | Automatic return after a brief transition |
| Complete | `Signal Restored` | `New Expedition` |

The title backdrop should show the actual workshop scene. Keep introductory text to one or two short lines: restore three relays and reach the ascent lift.

The completion screen shows expedition time, recoveries, archives recovered, caches found, machines disabled, and all three relay states. Clearly distinguish an ordinary completed expedition from a completion with all three archives.

Persist `Best Completion Time`, `Best Full-Archive Time`, and `Fewest Recoveries` using versioned, validated local data. Only completed expeditions qualify for records. The full-archive time requires all three archives. Fewer recoveries wins that record; use completion time only as its tie-breaker.

Retain in-memory records if storage is unavailable or full. Validate loaded values and ignore corrupt or incompatible data without interrupting play.

Verify a desktop viewport, narrow portrait viewport, and short landscape viewport. Keep HUD, overlays, archive text, and touch controls in bounds. Make tall result panels scroll internally.

## 18. Sound and effects

Generate original atmospheric electronic music and concise effects with Web Audio. Use sparse rhythm, low mechanical drones, soft tonal pulses, and gentle crystal-like resonances.

Give the three regions distinct arrangements within one coherent sound palette. Intensify the final ascent subtly without turning it into a lethal timed escape.

Include sounds for footsteps by surface, takeoff and landing, wall sliding, dash, echo pulse, insufficient energy, shield absorption, damage, cell handling, socket power, relay activation, archive discovery, enemy telegraphs, stun, disable, shutdown, reboot, and lift movement.

Initialize audio after a user gesture. Use one audio owner, bounded scheduling, gain ramps, and cleanup of finished nodes. Pausing or returning from a hidden tab must not play a backlog of notes or effects. Mute affects both music and effects, including scheduled sounds.

Keep continuous machinery and background audio quiet enough for telegraphs to remain distinct. Use subtle visual indicators for important cues so gameplay does not require sound.

Effects should communicate states: a short dash trail, one expanding pulse ring, small crystal fragments, restrained shield facets, and brief conduit illumination. Bound effect lifetimes and counts. Avoid full-screen flashes or effects that hide edges.

## 19. Performance and lifecycle

- Reuse geometries, textures, and materials; instance repeated rock and structural modules.
- Cap pixel ratio and use reasonable shadow settings.
- Use a small number of purposeful real lights. Prefer emissive materials and inexpensive visual tricks for minor accents.
- Limit dynamic lights associated with projectiles and effects.
- Cull or suspend distant decorative animation without changing authoritative puzzle state.
- Remove expired projectiles, debris, trails, transient UI, and audio nodes.
- Dispose of owned temporary resources without destroying shared assets.
- Repeated checkpoint recovery and full restart must not accumulate event listeners, meshes, timers, arrays, lights, or abandoned state.
- Preserve deterministic platform and hazard state through checkpoint restoration.
- Keep collision and interaction logic independent of rendering frame rate and camera position.

## 20. Required validation

Use focused deterministic checks and actual browser interaction. Test the real implementation rather than a separate approximation of the rules.

| Area | Required evidence |
| --- | --- |
| Movement | Acceleration, braking, short/held jumps, coyote time, buffering, ceiling hits, and no double jumps |
| Walls | Valid wall slides, deliberate wall jumps, steering lock, shaft reachability, and no grounded slide |
| Dash | Duration, cooldown, landing/wall-jump refresh, swept collision, seam breaking, and vulnerable-enemy interactions |
| Pulse | Cost, cooldown, regeneration delay, radius, line of sight, one response per target, and blocked activation |
| Damage | Shield threshold, one damage outcome per hit, immunity, knockback, deep water, and crush recovery |
| Enemies | Telegraphs, targeting locks, stun immunity to contact, correct disable windows, and projectile cleanup |
| Cells | Pick up, carry restrictions, safe placement, socket priority, one-cell ownership, and no duplication |
| Puzzles | All three authored solutions, foundry latch behavior, no softlocks, and route access after power changes |
| Checkpoints | Atomic snapshot, committed relays/discoveries, rollback of later changes, safe restored objects, and one recovery count |
| Main route | Full completion using ordinary movement, required mechanisms, and no optional discoveries or debug protection |
| Exploration | All three archive routes, retained discovery counts, cache energy limits, and correct restore behavior |
| Platforms | Boarding, carrying, jumping off, endpoint pauses, obstruction handling, and deterministic reset |
| Ending | Relay gating, boarding bounds, one result commit, clock stop, lift sequence, records, and replay |
| Records | Completion-only saves, full-archive qualification, tie-breaking, reload, and corrupt/unavailable storage |
| Input/UI | Keyboard, touch combinations, clear focus-loss input, pause/retry/restart distinction, and responsive layouts |
| Audio | Gesture gating, telegraphs, mute, pause, hidden tabs, regional transitions, and bounded scheduling |
| Lifecycle | Repeated recovery and restart without duplicated entities, stale projectiles, or growing listeners |

Verify the full required route and every optional archive route in the actual rendered game when tools permit. Confirm that cues and safe observation areas are visible from the gameplay camera.

Record actual results. Do not claim browser playthroughs, audio playback, measured performance, or tests that were not performed. If a tool is unavailable, state the precise limitation and perform the remaining available checks.

## 21. Mandatory feature-gap audit and improvement pass

**After the baseline is playable, inspect it, implement justified improvements, and verify them before delivering the final version. Do not stop after writing an audit.**

### A. Inspect the playable candidate

Review the actual code and play the current game again. Ask concrete questions:

- Does ILO feel precise during normal jumps, wall jumps, and dash exits?
- Can a new player understand pulse, shield energy, and enemy vulnerability without reading a manual?
- Does the shared energy system create useful choices without causing a progression softlock?
- Do pulse visuals accurately communicate range and obstruction?
- Are carrying restrictions and socket priorities obvious?
- Can the foundry cell puzzle be solved and reversed safely?
- Do checkpoints restore cells, shutters, relays, collectibles, and hazards consistently?
- Are underground edges and danger volumes visible on a small screen?
- Does each region have a distinct silhouette, traversal rhythm, and sound?
- Does the final ascent provide a satisfying use of learned abilities?
- Are there dead controls, placeholders, duplicate interactions, or misleading prompts?

### B. Write a concrete audit

Create `FEATURE_AUDIT.md` with a concise English table:

| Feature or defect | Current state and evidence | Player benefit | Priority | Decision | Acceptance check | Final status |
| --- | --- | --- | --- | --- | --- | --- |
| Example: restored lift socket | Cell returns to its checkpoint location, but the lift remains incorrectly powered | Prevents a misleading puzzle state after recovery | P0 | Implement | Recovery restores cell ownership, socket state, conduit state, and lift phase together | Pending |

Classify findings as `Working`, `Partial`, `Missing`, or `Broken`. Keep observed defects separate from proposed design improvements.

- **P0:** completion blockers, unsafe collisions, duplication, lost input, checkpoint inconsistency, or softlocks.
- **P1:** missing required abilities, puzzles, enemies, teaching, feedback, UI, audio, or ending behavior.
- **P2:** focused improvements to atmosphere, route readability, optional exploration, animation, or replay information.
- **Future:** larger systems outside this complete first expedition.

### C. Implement selected work

Fix all P0 findings and complete missing required P1 behavior. Choose only a small coherent set of justified P2 improvements. Examples include clearer seam markings, a better pulse obstruction cue, safer camera framing, or improved archive presentation.

Do not add unrelated worlds, bosses, equipment trees, multiplayer, procedural generation, or crafting merely to expand the feature list.

Proceed from audit to implementation within the authorized project scope. Ask only when a real external dependency or consequential ambiguity prevents a decision.

### D. Verify and update

For every selected item, test its acceptance check and its interactions with movement, energy, carrying, enemies, checkpoints, pause, retry, and full restart. Run relevant regressions and inspect the rendered result when possible.

Update the audit with implementation locations and actual verification evidence. After the last gameplay change, re-check the full required route, all relay puzzles, checkpoint recovery, mobile layout, and the ending.

The final gate requires working required features, implemented and verified selected additions, no unresolved P0 item, accurate English controls and documentation, and honest reporting of limitations. Deferred optional ideas must have explicit reasons and must not be presented as completed.

## 22. Final delivery

Provide:

1. The complete playable game and required local runtime files.
2. A short English `README.md` with launch instructions, controls, checkpoint behavior, and validation commands.
3. The completed `FEATURE_AUDIT.md` with implemented, verified, and intentionally deferred items.
4. Relevant deterministic checks and concise verification results.

In the final response, identify the playable entry point, summarize meaningful implemented behavior and improvements, state what was actually tested, and disclose material verification limitations. Deliver the finished result rather than ending with a proposed implementation plan.

The game should feel like a complete original underground expedition: a small robot restoring a silent world through movement, observation, resonance, and machinery.
