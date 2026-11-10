
# Prompt: Bloom — a single-file procedural Three.js growing-flower animation

## Goal

Build a complete, polished 3D animation in **one self-contained `index.html`**, rendered with **Three.js**. It shows a single flower growing in real time: a seed resting in dark soil cracks open, a sprout pushes up and unfurls its first leaves, the stem rises and curves, a bud forms, swells, and finally opens into a full flower with layered petals. After a short hold in full bloom, the animation loops seamlessly back to the seed.

The result is recorded as a **vertical 9:16 short video**, so it must look like a finished, cinematic nature macro shot: soft directional light, translucent petals, dew-like highlights, shallow-feeling depth, and a slow, deliberate camera. It is a single-subject study: no text overlays during the animation, no UI clutter, no other plants competing for attention.

**Deliver the working HTML implementation, not a plan, pseudocode, or a description.** Build every stage below. Do not stop at a cylinder with a few flat discs on top; the flower must read as one living, designed organism.

## The flower (fixed design)

- **Type:** an original single-headed flower. Not a copy of a specific real cultivar; inspired by the general shape of a peony-like cup bloom crossed with a lotus.
- **Petals:** three rings, 5 + 8 + 13 petals (outer to inner), each petal a curved, cupped, slightly ruffled surface with a pointed-round tip. Inner petals are smaller and stay more closed.
- **Petal color:** a gradient from deep magenta-rose `#b8326a` at the base to pale blush `#ffd6e2` at the tip, with fine darker veins and a soft translucent edge.
- **Center:** a cluster of 30–60 slender stamens with golden tips `#ffc94a` around a small green-yellow pistil.
- **Stem:** green `#4f8a3a`, slightly thicker at the base, with a gentle S-curve, never perfectly straight.
- **Leaves:** two cotyledons at the start (small, round, later wither slightly), then 3–4 true leaves alternating up the stem, elongated with a midrib and a slight twist.
- **Sepals:** 5 green sepals that wrap the bud and fold back as the flower opens.
- **Soil:** a small mound of dark earth `#2b1d14` with procedural crumbs and a few pebbles, on a minimal pot-free ground disc that fades into darkness.
- **Background:** a dark gradient, deep teal-black at the bottom to warm dusk violet at the top, with very faint floating light particles (pollen/dust motes) far behind the flower.

## Technical boundaries

- One HTML file: inline CSS, JavaScript, shaders, and procedural textures.
- Three.js and any addons from a **pinned CDN version** through an import map. Pin core and addons to the same version.
- **No external assets:** no images, HDR files, GLTF/OBJ models, fonts, videos, or audio. Every texture, gradient, and environment is generated at runtime.
- Build geometry procedurally: custom `BufferGeometry` for petals and leaves (parametric surfaces with per-vertex deformation), `TubeGeometry` or a custom swept tube along a `CatmullRomCurve3` for the stem, instanced meshes for stamens, soil crumbs, and particles.
- Organize the code into clear builders and update functions: `createSoil()`, `createSeed()`, `createStem()`, `createLeaf()`, `createPetal()`, `createFlowerHead()`, `setupLights()`, `setupCamera()`, `updateGrowth(t)`, `animate()`.
- Drive all growth from **one normalized timeline value** so any moment can be reproduced: `updateGrowth(t)` must render a correct state for any `t` in `[0, 1]`, independent of frame rate.
- Use delta time in seconds; clamp large deltas after a hidden tab resumes.
- Keep a clean console.

## Frame and timing

- **Aspect:** render a vertical **9:16** frame. If the window is wider than 9:16, center a 9:16 canvas with dark bars; if taller, fill and crop sensibly. The flower must stay fully in frame on a phone-shaped window (for example 1080×1920 or 540×960).
- **Loop length:** about **20 seconds** total:
  - 0–2 s: seed in soil, stillness, light slowly brightening.
  - 2–5 s: seed cracks, root tip dips into soil, sprout hook emerges and straightens, cotyledons open.
  - 5–10 s: stem rises with a living S-curve, true leaves unfurl one after another.
  - 10–13 s: bud forms inside sepals and swells.
  - 13–17 s: sepals fold back, petals open ring by ring, outer first, with slight overshoot and settle; stamens spread.
  - 17–19 s: full bloom hold, gentle breeze sway, pollen motes drift.
  - 19–20 s: seamless return to the seed state (for example a soft fade through a light bloom or petals closing and the plant sinking), with no visible jump at the loop seam.
- Use smooth easing curves for every phase. Growth should feel organic: slightly uneven speeds, never linear.
- Add a `?t=0.75` URL parameter (or similar) that freezes the timeline at a given value, and a key (`Space`) to pause/resume, for capturing stills. No visible UI in the default view.

---

## Stage 1 — Renderer, frame, and camera

1. Renderer with `antialias: true`, `ACESFilmicToneMapping`, sRGB output, capped pixel ratio (`Math.min(devicePixelRatio, 2)`), soft shadows.
2. Perspective camera with a 30–35° field of view, framed for vertical composition.
3. **Camera path:** a slow, continuous cinematic move synchronized with the timeline: starts low and close on the seed, rises with the stem, slowly orbits about 60–90° around the plant over the loop, and ends at a slightly elevated three-quarter view of the open flower. Use smooth interpolation (splines or eased lerps), never sudden cuts, shakes, or snaps. The camera at `t = 1` must match `t = 0` so the loop is seamless.
4. The camera always keeps the growing tip (and later the flower head) in the upper-middle third of the vertical frame.

**Stage acceptance:** with only soil and seed, the frame already feels like an intentional macro shot in 9:16.

## Stage 2 — Seed and sprout

- The seed: an ovoid with a subtle seam, satin surface. It splits along the seam; the two halves stay visible in the soil.
- The sprout emerges as a hook shape (bent stem pulling the cotyledons up), then straightens. Soil crumbs near the emergence point shift slightly.
- Cotyledons open from folded to flat with a soft unfold.

**Stage acceptance:** the emergence reads as a plant pushing through soil, not a mesh scaling up from zero.

## Stage 3 — Stem and leaves

- The stem grows by extending its curve from the tip, not by uniform scaling: new length appears at the top, the base thickens over time.
- Leaves emerge at nodes as the tip passes them, starting rolled and unfurling, with a midrib, slight twist, and gentle droop under their own weight.
- Leaves and stem respond subtly to a soft procedural breeze (layered noise), stronger at the tip than the base.

**Stage acceptance:** at any frame, the stem looks continuous with no gaps, popping, or stretched textures.

## Stage 4 — Bud and bloom

- The bud forms at the tip enclosed by sepals, swells, and tints from green to rose at the tip.
- Opening: sepals fold back first, then the outer petal ring opens, then middle, then inner, each petal with a small time offset so the motion ripples around the flower. Petals curve outward with slight overshoot and settle.
- Stamens unfold from a tight bundle into a spread crown.
- No petal may intersect another during opening; tune curvature and ring offsets so layers slide past each other.

**Stage acceptance:** the bloom moment is the visual climax of the loop and looks smooth at full speed and in slow motion.

## Stage 5 — Materials

- Petals: `MeshPhysicalMaterial` with `transmission` or `sheen` and a thin translucent look; procedural canvas texture for the color gradient and veins; slightly lighter backlit edges. Double-sided.
- Stem and leaves: soft waxy green with subtle roughness variation, vein texture on leaves.
- Stamens: golden tips with a soft glow; pistil slightly glossy.
- Soil: rough, matte, with crumb instances and a few darker damp spots.
- Optional: a few tiny dew drops on leaves and petals (small refractive spheres) catching the highlight.
- Use a procedurally generated environment (for example `RoomEnvironment` with `PMREMGenerator`, or a generated gradient) for gentle reflections. No HDR files.

**Stage acceptance:** petals, leaves, stem, and soil are distinguishable by their response to light alone.

## Stage 6 — Lighting and atmosphere

- Key: a warm, soft light from upper-left behind the flower, creating rim light and translucency through the petals.
- Fill: a cool, dim light from the front so the plant never goes black.
- A subtle bloom/glow post-effect (`UnrealBloomPass` or equivalent) on highlights only, restrained so petals do not blow out.
- Light intensity brightens gradually from seed to bloom, like dawn arriving.
- Faint drifting pollen/dust particles in the background with soft depth falloff; they must never cover the flower.
- Optional gentle vignette.

**Stage acceptance:** the default frame at full bloom looks like a finished nature-film still.

## Stage 7 — Resilience and performance

- Handle resize, keeping the 9:16 composition.
- Smooth 60 fps on a typical laptop: share geometries and materials, use instancing, avoid allocations in the animation loop.
- No runtime errors or unfinished functions.
- If WebGL is unavailable, show a short readable message instead of a blank page.

## Final acceptance checklist

- [ ] One self-contained `index.html` using only pinned Three.js/addon CDN imports.
- [ ] No external images, models, fonts, HDR files, or audio.
- [ ] Vertical 9:16 frame; the plant always fully in frame.
- [ ] Full sequence: seed → sprout → stem and leaves → bud → open flower → hold → seamless loop.
- [ ] Growth extends from the tip; nothing simply scales up from zero.
- [ ] Three petal rings opening in sequence without intersections.
- [ ] Translucent petals, distinct materials, warm backlight, restrained bloom.
- [ ] Slow continuous camera move that matches at the loop seam.
- [ ] `updateGrowth(t)` reproduces any moment; `?t=` freeze and `Space` pause work.
- [ ] Clean console, smooth performance, working resize.

## How to evaluate the run

1. Open in a 540×960 window and watch at least three full loops.
2. Capture stills at `t = 0.1, 0.3, 0.5, 0.7, 0.9`.
3. Watch the loop seam and the bloom moment for jumps, popping, and petal clipping.
4. Resize the window, switch tabs and return.
5. Record what was built, what is missing, and whether a failure is in geometry, materials, timing, or camera.

One run is not a conclusion. Run the prompt at least twice per model with the same settings before writing a verdict.
