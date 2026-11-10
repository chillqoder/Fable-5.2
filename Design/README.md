# NODAL — vibe-code studio

A studio site with no pages. The whole site is one vibrating plate covered in sand
(Chladni figures): every section is a resonance, and navigation is a frequency dial.

- **Scroll / drag / ← →** — turn the dial. Between stations the sand scatters and the copy
  dissolves into code noise; on a resonance the grains settle into nodal lines and spell the
  station's word.
- **610 Hz — SIGNAL** — type anything; the sand writes it. "Transmit" opens a mail draft.
- **Sound** (top right) — the plate's tone at the tuned frequency, static in between.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

No framework and no runtime dependencies — any static server pointed at this folder works too.

## Where things live

| File | What |
| --- | --- |
| `src/stations.js` | All content: copy, frequencies, Chladni modes, palettes, camera poses, pinned notes, contact e-mail |
| `src/plate.js` | WebGL2 renderer and the grain-by-grain sand simulation |
| `src/main.js` | Dial physics, input, palette/camera blending, notes pinned to 3D points |
| `src/text.js` | Copy that resolves out of code noise as the dial locks |
| `src/audio.js` | WebAudio tone + static |
| `src/style.css` | Layout and type |

`CONTACT` in `src/stations.js` is a placeholder address — replace it before publishing.
