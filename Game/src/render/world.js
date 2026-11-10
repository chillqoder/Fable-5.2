// DEEPWAKE — static world rendering: terraced voxel terrain, room back walls, depth layers,
// regional decor, water, sky and conduits. Everything here is drawn FROM level data; nothing
// here affects collisions.

import * as THREE from 'three';
import { W, H, regionAt } from '../level.js';
import { Vox, MAT, PAL, h2, rng, noiseTexture, blockTexture, glowMat, additive, textPlate, lerp } from './vox.js';

export const TZ0 = -4.5;        // back of terrain blocks (rooms are deep dioramas)
export const TZ1 = 0.6;         // front of the blocks next to play space (gameplay is at z = 0)
const TZ = TZ1 - TZ0;
const CHUNK = 16;               // columns per terrain chunk (frustum + shadow culling)
const BW = TZ0;                 // back-wall plane

const STYLE = {
  workshop: { edge: 0x59687b, body: 0x3f4c5a, deep: 0x2b353f, far: 0x1f262e, metalEdge: 0x847a6e, metal: 0x625a51, trim: 0x99a8b5, metalTrim: 0xb6ac9a, back: 0x3f4e5a, backAlt: 0x364350, beam: 0x513d2d, wall: 'brick' },
  reservoir: { edge: 0x4a6b80, body: 0x324c5d, deep: 0x21333e, far: 0x17242d, metalEdge: 0x6f818d, metal: 0x4d5b64, trim: 0x88aebd, metalTrim: 0xa4b3bc, back: 0x2b4556, backAlt: 0x273c4d, beam: 0x34444f, wall: 'cave' },
  foundry: { edge: 0x6e6053, body: 0x4a4138, deep: 0x312b27, far: 0x231f1c, metalEdge: 0x897862, metal: 0x5f5348, trim: 0xb39e7d, metalTrim: 0xbeaa86, back: 0x493e36, backAlt: 0x3f342f, beam: 0x423932, wall: 'brick' },
  ascent: { edge: 0x5c6872, body: 0x3f4952, deep: 0x2a323a, far: 0x1e242a, metalEdge: 0x848f9b, metal: 0x5c6671, trim: 0xa1b0bd, metalTrim: 0xb5bec6, back: 0x3a4753, backAlt: 0x323e49, beam: 0x4c5762, wall: 'brick' },
  surface: { edge: 0x8f8777, body: 0x696356, deep: 0x4c473d, far: 0x38342e, metalEdge: 0x999180, metal: 0x726b5d, trim: 0xc1b7a4, metalTrim: 0xc1b7a4, back: 0x554e45, backAlt: 0x554e45, beam: 0x625b4f, wall: 'cave' },
};

// Air areas where the back wall is omitted so deeper layers show through (presentation only).
const OPEN = [
  [38, 12, 58, 19],
  [91, 22, 137, 30], [108, 14, 124, 22],
  [207, 30, 224, 38],
  [203, 64, 227, 75],
];

function cellRegion(i, j) {
  if (j >= 62 && i >= 196) return 'surface';
  return regionAt(i + 0.5);
}
function inOpen(i, j) {
  for (const r of OPEN) if (i >= r[0] && i < r[2] && j >= r[1] && j < r[3]) return true;
  return false;
}

/** Unit box whose deep faces repeat the block texture `rep` times (keeps texel scale constant). */
function deepBox(rep) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  for (let k = 0; k < 8; k++) uv.setX(k, uv.getX(k) * rep);
  for (let k = 8; k < 16; k++) uv.setY(k, uv.getY(k) * rep);
  uv.needsUpdate = true;
  return g;
}

export function buildWorld(scene, level) {
  const grid = level.grid;
  const solid = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? true : grid[j * W + i] !== 0);
  const air = (i, j) => !solid(i, j);
  const owned = [];        // geometries/materials/textures owned by the world (disposed together)
  const instanced = [];
  const animated = [];     // { update(t, sim) }
  const anchors = [];      // light anchors { x, y, z, color, intensity }
  const root = new THREE.Group();
  scene.add(root);
  const own = (o) => { owned.push(o); return o; };
  const m4 = new THREE.Matrix4(), col = new THREE.Color();

  /** Build chunked instanced meshes from a list of { key, m(matrix writer), color }. */
  const instances = (items, geo, matFor, { cast = true, receive = true } = {}) => {
    const groups = new Map();
    for (const it of items) { let g = groups.get(it.key); if (!g) { g = []; groups.set(it.key, g); } g.push(it); }
    for (const [key, list] of groups) {
      const mesh = new THREE.InstancedMesh(geo, matFor(key), list.length);
      list.forEach((it, k) => {
        m4.makeScale(it.sx, it.sy, it.sz); m4.setPosition(it.x, it.y, it.z);
        mesh.setMatrixAt(k, m4);
        mesh.setColorAt(k, col.setHex(it.hex).multiplyScalar(it.shade));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere(); mesh.computeBoundingBox();
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      root.add(mesh);
      instanced.push(mesh);
    }
  };

  // ── distance to the nearest air cell (8-neighbourhood BFS, capped) ──
  const dist = new Uint8Array(W * H).fill(6);
  let frontier = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (grid[j * W + i] === 0) { dist[j * W + i] = 0; frontier.push(j * W + i); }
  const seen = new Uint8Array(W * H);
  for (const idx of frontier) seen[idx] = 1;
  for (let d = 1; d <= 5 && frontier.length; d++) {
    const next = [];
    for (const idx of frontier) {
      const ci = idx % W, cj = (idx / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (!seen[n]) { seen[n] = 1; dist[n] = d; next.push(n); }
      }
    }
    frontier = next;
  }

  // ── terrain ──
  // The rock face is terraced: blocks step toward the camera the further they are from open
  // space (max slope 0.22 per cell, far below the view angle, so play space is never occluded).
  const texRockA = own(blockTexture(11, 'rock')), texRockB = own(blockTexture(23, 'rock')), texMetal = own(blockTexture(37, 'metal'));
  const mats = {
    a: own(new THREE.MeshLambertMaterial({ map: texRockA })),
    b: own(new THREE.MeshLambertMaterial({ map: texRockB })),
    m: own(new THREE.MeshLambertMaterial({ map: texMetal })),
  };
  const terrainGeo = own(deepBox(5));
  const terrainItems = [], trimItems = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const t = grid[j * W + i];
    if (t === 0) continue;
    const st = STYLE[cellRegion(i, j)];
    const d = dist[j * W + i];
    const metal = t === 2;
    const base = d <= 1 ? (metal ? st.metalEdge : st.edge) : d <= 2 ? (metal ? st.metal : st.body) : d <= 4 ? st.deep : st.far;
    const extra = d >= 2 ? Math.min(d - 1, 4) * 0.22 + Math.floor(h2(i >> 1, j >> 1, 3) * 3) * 0.08 : 0;
    const depth = TZ + extra;
    const variant = metal ? 'm' : h2(i >> 1, j >> 1, 17) < 0.5 ? 'a' : 'b';
    terrainItems.push({
      key: `${Math.floor(i / CHUNK)}:${variant}`, x: i + 0.5, y: j + 0.5, z: TZ0 + depth / 2, sx: 1, sy: 1, sz: depth,
      hex: base, shade: metal ? 0.94 + 0.1 * h2(i, j) : 0.86 + 0.22 * h2(i, j),
    });
    if (air(i, j + 1)) trimItems.push({ key: `${Math.floor(i / CHUNK)}`, x: i + 0.5, y: j + 1 - 0.065, z: TZ0 + (TZ + 0.05) / 2, sx: 1.0, sy: 0.15, sz: TZ + 0.05, hex: metal ? st.metalTrim : st.trim, shade: 0.94 + 0.1 * h2(i, j, 9) });
  }
  instances(terrainItems, terrainGeo, (key) => mats[key.split(':')[1]]);
  const trimMat = own(new THREE.MeshLambertMaterial({ map: texMetal }));
  instances(trimItems, own(deepBox(5)), () => trimMat, { cast: false });

  // ── room back walls: brick or cave panels with baked corner occlusion and pilasters ──
  const texBrick = own(blockTexture(51, 'brick')), texCave = own(blockTexture(63, 'cave'));
  const backMats = { brick: own(new THREE.MeshLambertMaterial({ map: texBrick })), cave: own(new THREE.MeshLambertMaterial({ map: texCave })) };
  const backItems = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (grid[j * W + i] !== 0 || inOpen(i, j)) continue;
    const st = STYLE[cellRegion(i, j)];
    let occl = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && solid(i + di, j + dj)) occl++;
    const cave = st.wall === 'cave';
    const relief = cave ? Math.floor(h2(i, j, 5) * 4) * 0.14 : (i % 6 === 2 ? 0.34 : 0) + (solid(i, j - 1) ? 0.12 : 0);
    const thick = 0.5 + relief;
    backItems.push({
      key: `${Math.floor(i / CHUNK)}:${st.wall}`, x: i + 0.5, y: j + 0.5, z: BW - 0.5 + thick / 2, sx: 1, sy: 1, sz: thick,
      hex: (j % 5 === 0 || solid(i, j - 1)) ? st.backAlt : st.back, shade: (1 - 0.055 * occl) * (0.9 + 0.2 * h2(i, j, 7)),
    });
  }
  instances(backItems, own(new THREE.BoxGeometry(1, 1, 1)), (key) => backMats[key.split(':')[1]], { cast: false });

  // ── helpers over the grid ──
  const floorSpots = (x0, x1, y0 = 0, y1 = H) => {
    const out = [];
    for (let i = x0; i < x1; i++) for (let j = Math.max(1, y0); j < y1; j++) {
      if (air(i, j) && solid(i, j - 1)) { let h = 0; while (air(i, j + h) && h < 30) h++; out.push({ i, j, h }); }
    }
    return out;
  };
  const ceilSpots = (x0, x1, y0 = 0, y1 = H) => {
    const out = [];
    for (let i = x0; i < x1; i++) for (let j = Math.max(1, y0); j < y1; j++) {
      if (air(i, j) && solid(i, j + 1)) { let h = 0; while (air(i, j - h) && h < 30) h++; out.push({ i, j, h }); }
    }
    return out;
  };

  const lit = new Vox(), glow = new Vox();
  const cones = [];
  const coneTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = y / 63, u = Math.abs(x / 63 - 0.5) * 2;
      const half = 0.12 + 0.88 * v;                    // widens toward the floor
      const edge = Math.max(0, 1 - u / half);
      const a = Math.pow(edge, 1.6) * Math.pow(1 - v, 0.9) * (0.6 + 0.4 * (1 - v));
      const k = (y * 64 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(255 * Math.min(1, a));
    }
    ctx.putImageData(img, 0, 0);
    const t = own(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const coneMat = (hex, op) => own(new THREE.MeshBasicMaterial({ color: hex, map: coneTex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }));
  const coneWarm = coneMat(0xffc890, 0.2), coneCool = coneMat(0xcfe3f5, 0.16);
  const coneGeo = own(new THREE.PlaneGeometry(1, 1));

  // ceiling beams running front-to-back (behind the play lane): strong perspective cue
  for (const s of ceilSpots(3, 226, 9, 62)) {
    if (s.h < 3 || inOpen(s.i, s.j) || s.i % 4 !== 1) continue;
    const st = STYLE[cellRegion(s.i, s.j)];
    if (st.wall === 'cave') continue;
    lit.box(s.i + 0.5, s.j + 1 - 0.17, (BW + -0.9) / 2, 0.34, 0.34, -0.9 - BW, st.beam);
    lit.box(s.i + 0.5, s.j + 1 - 0.42, BW + 0.3, 0.5, 0.5, 0.5, st.beam, 0, 0.8);
  }

  // ───────────────────────── Buried Workshop ─────────────────────────
  {
    const r = rng(101);
    for (const s of floorSpots(3, 80)) {
      if (inOpen(s.i, s.j)) continue;
      // square stone columns against the back wall
      if (s.i % 6 === 2 && s.h >= 4) {
        lit.box(s.i + 0.5, s.j + s.h / 2, BW + 0.75, 0.86, s.h, 0.86, 0x66778a);
        lit.box(s.i + 0.5, s.j + 0.22, BW + 0.8, 1.1, 0.44, 1.1, 0x7a8b9c);
        lit.box(s.i + 0.5, s.j + s.h - 0.22, BW + 0.8, 1.1, 0.44, 1.1, 0x7a8b9c);
      } else if (s.h >= 3 && h2(s.i, s.j, 13) < 0.16) {
        // crates and drums stored along the back
        const z = BW + 0.8 + r() * 1.3, n = 1 + Math.floor(r() * 2);
        for (let k = 0; k < n; k++) {
          const sz = 0.7 + r() * 0.2;
          lit.box(s.i + 0.5 + (r() - 0.5) * 0.2, s.j + sz / 2 + k * 0.78, z, sz, sz, sz, k ? 0x6f5a40 : 0x7d6648, (r() - 0.5) * 0.12);
          lit.box(s.i + 0.5, s.j + sz / 2 + k * 0.78, z + sz / 2 + 0.01, sz * 0.9, 0.08, 0.02, 0x4a3a2a);
        }
      } else if (s.h >= 4 && h2(s.i, s.j, 14) < 0.12) {
        // wall shelf with small parts
        lit.box(s.i + 0.5, s.j + 1.9, BW + 0.3, 1.6, 0.08, 0.5, 0x5a4432);
        lit.box(s.i + 0.1, s.j + 2.1, BW + 0.3, 0.26, 0.3, 0.26, 0x8a94a0);
        lit.box(s.i + 0.7, s.j + 2.05, BW + 0.3, 0.2, 0.2, 0.2, 0xb5562b);
        lit.box(s.i + 1.0, s.j + 2.12, BW + 0.3, 0.14, 0.34, 0.14, 0x6c7682);
      }
    }
    for (const s of ceilSpots(3, 80)) {
      // warm emergency lamps
      if (s.i % 9 === 4 && s.h >= 4) {
        const y = s.j + 1 - 0.7;
        lit.box(s.i + 0.5, y + 0.38, -1.9, 0.06, 0.64, 0.06, 0x14191f);
        lit.box(s.i + 0.5, y, -1.9, 0.62, 0.16, 0.5, 0x3a3f45);
        lit.box(s.i + 0.5, y + 0.1, -1.9, 0.4, 0.1, 0.34, 0x2a2f35);
        glow.box(s.i + 0.5, y - 0.11, -1.9, 0.46, 0.08, 0.36, 0xffc27a);
        anchors.push({ x: s.i + 0.5, y: y - 0.7, z: -1.2, color: 0xffa860, intensity: 1.25 });
        cones.push({ x: s.i + 0.5, y: y - 0.12, z: -1.9, h: Math.min(6, s.h - 0.8), warm: true });
      } else if (h2(s.i, s.j, 11) < 0.3 && s.h >= 3) {
        // hanging cables
        const len = 0.5 + r() * Math.min(2.2, s.h - 2.2);
        const z = BW + 0.4 + r() * 2.6;
        lit.box(s.i + 0.2 + r() * 0.6, s.j + 1 - len / 2, z, 0.06, len, 0.06, 0x1a2027);
        if (r() < 0.4) lit.box(s.i + 0.5, s.j + 1 - len, z, 0.18, 0.18, 0.18, 0x3b424a);
      }
    }
    // old benches and dormant tools
    for (const bx of [9.5, 20.5, 30.5, 41, 61.5, 72.5]) {
      const s = floorSpots(Math.floor(bx), Math.floor(bx) + 1)[0];
      if (!s) continue;
      const y = s.j, z = -3.0;
      lit.box(bx, y + 0.74, z, 2.1, 0.12, 0.9, 0x8a6442);
      lit.box(bx - 0.9, y + 0.34, z, 0.12, 0.68, 0.8, 0x54402f);
      lit.box(bx + 0.9, y + 0.34, z, 0.12, 0.68, 0.8, 0x54402f);
      lit.box(bx, y + 0.3, z - 0.05, 1.7, 0.08, 0.7, 0x6b5038);
      lit.box(bx - 0.5, y + 0.93, z - 0.05, 0.32, 0.26, 0.32, 0x77828e);
      lit.box(bx + 0.3, y + 0.86, z + 0.1, 0.55, 0.12, 0.22, 0x9aa5b0);
      lit.box(bx + 0.66, y + 1.02, z - 0.2, 0.12, 0.46, 0.12, 0xa98152);
      lit.box(bx - 0.1, y + 0.84, z + 0.25, 0.16, 0.08, 0.3, 0xb5562b);
      glow.box(bx - 0.5, y + 1.08, z + 0.12, 0.07, 0.07, 0.02, 0xff7a4a);
      // stool
      lit.box(bx + 1.5, y + 0.25, z + 0.5, 0.4, 0.5, 0.4, 0x54402f);
    }
    // deep machinery silhouettes behind the skitter hall
    for (let k = 0; k < 10; k++) {
      const x = 39 + k * 2.1 + r(), h = 2 + r() * 4.5, z = -6 - r() * 4;
      lit.box(x, 12 + h / 2, z, 1.2 + r(), h, 1, z < -8 ? 0x1e2832 : 0x2a3743);
      if (r() < 0.5) lit.box(x, 12 + h + 0.3, z, 2.2, 0.3, 1, 0x26323d);
      if (r() < 0.4) glow.box(x, 12 + h * 0.6, z + 0.52, 0.16, 0.16, 0.04, 0xff9a52);
    }
    lit.box(48, 15.5, -12, 30, 12, 0.5, 0x162029);
    // floor of the deep layer so the hall reads as a real space
    lit.box(48, 11.7, -8.3, 22, 0.6, 7.5, 0x26323d);
  }

  // ───────────────────────── Crystal Reservoir ─────────────────────────
  const crystalAt = (x, y, z, scale, up, r) => {
    const nShards = 2 + Math.floor(r() * 3);
    for (let k = 0; k < nShards; k++) {
      const w = (0.24 + r() * 0.3) * scale, h = (0.8 + r() * 1.8) * scale;
      const rot = (r() - 0.5) * 0.7;
      const ox = (k - (nShards - 1) / 2) * 0.34 * scale;
      const cy = y + up * (h / 2 - 0.05);
      const hex = [0x5fc0d0, 0x4aa6b6, 0x86dbe6][k % 3];
      lit.box(x + ox, cy, z, w, h, w, hex, up > 0 ? rot : Math.PI + rot);
      glow.box(x + ox, cy + up * h * 0.08, z + w * 0.32, w * 0.36, h * 0.66, w * 0.3, 0xcffaff, up > 0 ? rot : Math.PI + rot);
    }
  };
  {
    const r = rng(202);
    for (const s of floorSpots(81, 137)) {
      if (h2(s.i, s.j, 21) < 0.24) {
        const z = inOpen(s.i, s.j) ? -1.7 - r() * 2.4 : BW + 0.6 + r() * 2.0;
        crystalAt(s.i + 0.5, s.j, z, 0.7 + r() * 0.7, 1, r);
        if (r() < 0.5) anchors.push({ x: s.i + 0.5, y: s.j + 1.0, z: z + 0.6, color: 0x6fdcea, intensity: 0.7 });
      }
      // natural rubble
      if (h2(s.i, s.j, 26) < 0.2) { const z = -1.4 - r() * 2.6, q = 0.2 + r() * 0.3; lit.box(s.i + r(), s.j + q / 2, z, q * 1.5, q, q * 1.2, 0x44687f, r() - 0.5); }
    }
    for (const s of ceilSpots(81, 137)) {
      if (h2(s.i, s.j, 22) < 0.14 && s.h >= 4) crystalAt(s.i + 0.5, s.j + 1, -1.6 - r() * 2.4, 0.6 + r() * 0.6, -1, r);
      else if (h2(s.i, s.j, 23) < 0.22 && s.h >= 3) { const len = 0.4 + r() * 1.2; lit.box(s.i + 0.5, s.j + 1 - len / 2, -1.2 - r() * 3, 0.4 + r() * 0.3, len, 0.4, 0x44687f); }
    }
    // thin luminous mineral veins on the rock face
    for (let j = 12; j < 44; j++) for (let i = 82; i < 136; i++) {
      if (!solid(i, j) || dist[j * W + i] !== 1 || h2(i, j, 31) < 0.9) continue;
      const z = TZ1 + 0.02;
      glow.box(i + 0.5, j + 0.5, z, 0.9, 0.05, 0.02, 0x3fa6b5);
      glow.box(i + 0.95, j + 0.75, z, 0.05, 0.5, 0.02, 0x3fa6b5);
    }
    // deep cavern layers (darker with depth; never share the play lane)
    for (let k = 0; k < 18; k++) {
      const x = 92 + k * 2.6 + r() * 1.5, z = -6 - r() * 6;
      const overWater = x > 108 && x < 124;
      const y0 = overWater ? 19.5 : 21.5;
      const hb = 1.5 + r() * 5, shade = z < -9 ? 0x1b2a36 : 0x284050;
      lit.box(x, y0 + hb / 2, z, 1.6 + r() * 2, hb, 1.6, shade);
      lit.box(x + 0.6, y0 + hb + 0.5, z, 0.9, 1.2, 1.2, shade);
      const ht = 1.5 + r() * 4;
      lit.box(x + 1.2, 31 - ht / 2, z - 0.5, 1.2 + r() * 1.5, ht, 1.6, shade);
      if (r() < 0.55) { crystalAt(x, y0 + hb + 1, z + 0.6, 1.3, 1, r); anchors.push({ x, y: y0 + hb + 2, z: z + 1.5, color: 0x5fd0e0, intensity: 0.5 }); }
    }
    lit.box(114, 23, -13.5, 54, 22, 0.5, 0x101b24);
    lit.box(99.5, 21.6, -9, 17, 0.8, 9, 0x21323f);        // far shores
    lit.box(130.5, 21.6, -9, 13, 0.8, 9, 0x21323f);
    // broken access bridge, far behind and above the crossing (decor only)
    for (const [x0, x1] of [[108.5, 113], [118.5, 124]]) {
      lit.box((x0 + x1) / 2, 25.6, -6.4, x1 - x0, 0.25, 1.3, 0x3a3836);
      for (let x = x0 + 0.3; x < x1; x += 1.4) lit.box(x, 26.2, -6.9, 0.1, 1.0, 0.1, 0x45423f);
      lit.box((x0 + x1) / 2, 26.7, -6.9, x1 - x0, 0.08, 0.08, 0x45423f);
    }
    lit.box(113.6, 25.2, -6.4, 0.9, 0.2, 1.0, 0x3a3836, -0.5);
    for (const [x, y, w] of [[98, 26.5, 3], [127, 27, 4], [104, 27.6, 2.5]]) lit.box(x, y, -7.8, w, 0.7, 1.8, 0x2a3f4e);
    // hazard posts at both shore edges of the deep channel
    for (const x of [107.5, 124.5]) for (const z of [-1.3, -3.4]) {
      lit.box(x, 22.45, z, 0.16, 0.9, 0.16, 0x4a5058);
      glow.box(x, 22.98, z, 0.26, 0.16, 0.26, 0xff6a3d);
      lit.box(x, 22.06, z, 0.4, 0.12, 0.4, 0x3a3f46);
    }
  }

  // water: deep channel (dangerous) and shallow decorative pools (far behind the lane)
  for (const wz of level.water) {
    const wTex = own(noiseTexture(41, 0.86, 1.0, 16));
    wTex.repeat.set((wz.x1 - wz.x0) / 6, 3);
    const top = new THREE.Mesh(own(new THREE.PlaneGeometry(wz.x1 - wz.x0, 15)), own(new THREE.MeshBasicMaterial({ color: 0x1d6078, map: wTex, transparent: true, opacity: 0.82, toneMapped: false })));
    top.rotation.x = -Math.PI / 2;
    top.position.set((wz.x0 + wz.x1) / 2, wz.surface, TZ1 - 7.5);
    root.add(top);
    const front = new THREE.Mesh(own(new THREE.PlaneGeometry(wz.x1 - wz.x0, wz.surface - wz.y0)), own(new THREE.MeshBasicMaterial({ color: 0x12384c, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false })));
    front.position.set((wz.x0 + wz.x1) / 2, (wz.surface + wz.y0) / 2, TZ1 - 0.04);
    front.renderOrder = 3;
    root.add(front);
    const line = new THREE.Mesh(own(new THREE.BoxGeometry(wz.x1 - wz.x0, 0.07, 0.05)), own(glowMat(0x9fe9f2)));
    line.position.set((wz.x0 + wz.x1) / 2, wz.surface, TZ1 - 0.02);
    root.add(line);
    anchors.push({ x: (wz.x0 + wz.x1) / 2 - 4, y: wz.surface + 1, z: -1.5, color: 0x3aa0c0, intensity: 0.9 });
    anchors.push({ x: (wz.x0 + wz.x1) / 2 + 4, y: wz.surface + 1, z: -1.5, color: 0x3aa0c0, intensity: 0.9 });
    animated.push({ update: (t) => { wTex.offset.x = t * 0.02; wTex.offset.y = Math.sin(t * 0.3) * 0.05; line.material.color.setHex(0x9fe9f2).multiplyScalar(0.75 + 0.25 * Math.sin(t * 2.1)); } });
  }
  {
    const poolMat = own(new THREE.MeshBasicMaterial({ color: 0x5fc3d4, transparent: true, opacity: 0.4, toneMapped: false }));
    for (const [x0, x1, y] of [[92.5, 96, 22], [126, 129.5, 22], [99.5, 102.5, 22]]) {
      const pm = new THREE.Mesh(own(new THREE.PlaneGeometry(x1 - x0, 1.3)), poolMat);
      pm.rotation.x = -Math.PI / 2; pm.position.set((x0 + x1) / 2, y + 0.03, -3.4);
      root.add(pm);
    }
    // distant waterfalls
    const fallTex = own(noiseTexture(77, 0.7, 1.0, 16));
    fallTex.repeat.set(0.25, 0.8);
    const fallMat = own(new THREE.MeshBasicMaterial({ color: 0x9fd8e6, map: fallTex, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }));
    for (const x of [111.5, 120.3]) {
      const fm = new THREE.Mesh(own(new THREE.PlaneGeometry(1.4, 11.5)), fallMat);
      fm.position.set(x, 25.2, -12.5);
      root.add(fm);
    }
    animated.push({ update: (t) => { fallTex.offset.y = t * 0.6; } });
  }

  // ───────────────────────── Silent Foundry ─────────────────────────
  {
    const r = rng(303);
    for (const s of ceilSpots(137, 207)) {
      if (s.h < 3) continue;
      // service pipes under the ceilings
      if (s.i % 2 === 0) { lit.box(s.i + 1, s.j + 1 - 0.6, BW + 0.45, 2.02, 0.26, 0.26, 0x6a5f55); lit.box(s.i + 1, s.j + 1 - 0.95, BW + 0.35, 2.02, 0.14, 0.14, 0x8a6a43); }
      if (s.i % 6 === 1) lit.box(s.i + 0.5, s.j + 1 - 0.6, BW + 0.45, 0.3, 0.4, 0.4, 0xa08055);
      if (h2(s.i, s.j, 41) < 0.16) {
        // hanging chains
        const len = 0.8 + r() * Math.min(2, s.h - 2.4), z = -1.6 - r() * 2.2;
        for (let y = 0; y < len; y += 0.24) lit.box(s.i + 0.5, s.j + 1 - y - 0.12, z, 0.09, 0.17, 0.09, y % 0.48 < 0.2 ? 0x77706a : 0x55504a);
        if (r() < 0.5) lit.box(s.i + 0.5, s.j + 1 - len - 0.18, z, 0.3, 0.3, 0.2, 0x4a433d);
      }
    }
    for (const s of floorSpots(150, 206)) {
      // cooling channel grates along the back of the floors
      if (s.h >= 4 && s.i % 4 === 1) {
        lit.box(s.i + 0.5, s.j + 0.04, -3.3, 0.9, 0.08, 1.4, 0x231f1f);
        for (let k = 0; k < 4; k++) lit.box(s.i + 0.18 + k * 0.22, s.j + 0.09, -3.3, 0.06, 0.04, 1.4, 0x6a625b);
      }
      // ingot stacks and barrels
      if (s.h >= 4 && h2(s.i, s.j, 44) < 0.1) {
        const z = BW + 0.9 + r() * 1.2;
        for (let k = 0; k < 3; k++) lit.box(s.i + 0.5, s.j + 0.12 + k * 0.24, z, 0.9 - k * 0.2, 0.22, 0.5, k % 2 ? 0x8a7a66 : 0x9a8468);
      }
    }
    // furnace mouths (dim warm glow) and abandoned press housings against the back wall
    for (const [x, y] of [[152.5, 10], [179.5, 10], [199, 18], [145, 22]]) {
      lit.box(x, y + 1.1, BW + 0.5, 2.0, 2.2, 1.0, 0x5d5048);
      lit.box(x, y + 2.3, BW + 0.55, 2.3, 0.26, 1.1, 0x8a735a);
      lit.box(x, y + 3.2, BW + 0.4, 0.6, 1.6, 0.6, 0x4d433c);
      glow.box(x, y + 0.8, BW + 1.02, 1.2, 0.95, 0.04, 0xc8551e);
      glow.box(x, y + 0.62, BW + 1.04, 0.8, 0.45, 0.04, 0xffa050);
      anchors.push({ x, y: y + 1, z: BW + 2.2, color: 0xff8040, intensity: 1.0 });
    }
    for (const x of [158, 162]) {
      // idle counterweights
      lit.box(x, 14.4, BW + 0.5, 0.9, 1.4, 0.7, 0x6a5f55);
      lit.box(x, 15.5, BW + 0.5, 0.08, 1.0, 0.08, 0x3a3532);
      glow.box(x, 14.4, BW + 0.86, 0.5, 0.08, 0.02, 0x8a5a1c);
    }
    for (let k = 1; k <= 8; k += 2) lit.box(181.5 + k, 12.6 + k, BW + 0.3, 0.7, 0.5, 0.4, 0x6a5540);
  }

  // ───────────────────────── Ascent Shaft ─────────────────────────
  {
    const r = rng(404);
    // lift rails
    for (const x of [207.35, 210.65]) {
      lit.box(x, 52, BW + 0.4, 0.16, 24.4, 0.16, 0x8792a0);
      for (let y = 41; y < 64; y += 2) lit.box(x, y, BW + 0.4, 0.3, 0.14, 0.3, 0xaab6c4);
    }
    for (let y = 47.5; y < 63; y += 3) lit.box(209, y, BW + 0.25, 3.4, 0.14, 0.12, 0x5c6875);
    // machinery silhouettes behind service room 2
    for (let k = 0; k < 8; k++) {
      const x = 208 + k * 2.1 + r(), h = 2 + r() * 5, z = -6 - r() * 4;
      lit.box(x, 30 + h / 2, z, 1.3 + r(), h, 1, z < -8 ? 0x1c242d : 0x28323d);
      if (r() < 0.6) glow.box(x, 30 + h * 0.7, z + 0.52, 0.16, 0.16, 0.05, 0xffb648);
    }
    lit.box(215.5, 34, -12, 24, 12, 0.5, 0x131b23);
    lit.box(215.5, 29.7, -8.3, 20, 0.6, 7.5, 0x232d37);
    for (const x of [212.6, 218.4]) lit.box(x, 34, -5.5, 0.24, 8, 0.24, 0x3c4853);
    for (const s of ceilSpots(207, 224, 18, 46)) {
      if (s.i % 5 === 3 && s.h >= 3) {
        const y = s.j + 1 - 0.6;
        lit.box(s.i + 0.5, y + 0.3, -1.9, 0.06, 0.5, 0.06, 0x14191f);
        lit.box(s.i + 0.5, y, -1.9, 0.6, 0.16, 0.5, 0x3a3f45);
        glow.box(s.i + 0.5, y - 0.11, -1.9, 0.44, 0.08, 0.34, 0xdcebf5);
        anchors.push({ x: s.i + 0.5, y: y - 0.7, z: -1.2, color: 0xbfd8ee, intensity: 1.0 });
        cones.push({ x: s.i + 0.5, y: y - 0.12, z: -1.9, h: Math.min(6, s.h - 0.7), warm: false });
      }
    }
  }

  // surface terrace: ruined observation deck
  {
    const stone = 0xc2b8a4, stoneDark = 0x968d7e;
    for (const [x, h, z] of [[205, 3.2, -3.4], [213.5, 1.4, -3.8], [217.5, 4.6, -3.6], [222, 2.2, -3.2], [225.5, 5.2, -3.8], [212, 3.8, -1.6]]) {
      lit.box(x, 64 + h / 2, z, 0.8, h, 0.8, stone);
      lit.box(x, 64.15, z, 1.1, 0.3, 1.1, stoneDark);
      if (h > 3) lit.box(x, 64 + h + 0.12, z, 1.1, 0.24, 1.1, stoneDark);
    }
    lit.box(219.7, 68.75, -3.6, 5.2, 0.3, 0.8, stoneDark);
    for (let x = 212; x < 226; x += 1.1) if (h2(Math.round(x * 10), 3, 51) < 0.7) lit.box(x, 64.45, BW + 0.3, 0.12, 0.9, 0.12, stoneDark);
    lit.box(219, 64.92, BW + 0.3, 14, 0.1, 0.14, stoneDark);
    for (const [x, s, z] of [[215.2, 0.3, -1.6], [220.4, 0.22, -2.4], [223.3, 0.36, -1.9], [206.2, 0.26, -2.8], [218.3, 0.4, -3.2]]) lit.box(x, 64 + s / 2, z, s * 1.6, s, s, stone, 0.3);
  }

  // soft volumetric light cones under lamps (additive gradient texture, restrained)
  for (const c of cones) {
    for (const dz of [0, -0.9]) {
      const m = new THREE.Mesh(coneGeo, c.warm ? coneWarm : coneCool);
      m.scale.set(c.h * 0.8, c.h, 1);
      m.position.set(c.x, c.y - c.h / 2, c.z + dz);
      root.add(m);
    }
  }

  const litMesh = lit.mesh(MAT.lit), glowMesh = glow.mesh(MAT.glow);
  litMesh.frustumCulled = false; glowMesh.frustumCulled = false;
  own(litMesh.geometry); own(glowMesh.geometry);
  root.add(litMesh, glowMesh);

  // pale opening: a soft light shaft falling down the main lift shaft
  {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 64;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(225,238,248,0.55)'); g.addColorStop(0.35, 'rgba(190,214,232,0.32)'); g.addColorStop(1, 'rgba(160,190,214,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 64);
    const tex = own(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    for (const dz of [-1.2, -2.6, -3.9]) {
      const beam = new THREE.Mesh(own(new THREE.PlaneGeometry(3.4, 24)), mat);
      beam.position.set(209, 52, dz);
      root.add(beam);
    }
    const cap = new THREE.Mesh(own(new THREE.PlaneGeometry(4, 1.6)), own(glowMat(0x8fa3b3)));
    cap.position.set(209, 63.6, BW + 0.16);
    root.add(cap);
    anchors.push({ x: 209, y: 45, z: -1, color: 0xcfe3f0, intensity: 1.2 });
    animated.push({ update: (t) => { mat.opacity = 0.2 + 0.04 * Math.sin(t * 0.7); } });
  }

  // dawn sky: stays nearly dark until the final escape (dawn factor set by the renderer)
  const sky = { dawn: 0 };
  {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#23355a'); g.addColorStop(0.45, '#6c6a94'); g.addColorStop(0.72, '#e79a6c'); g.addColorStop(0.86, '#ffd29a'); g.addColorStop(1, '#ffe9c4');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 128);
    const tex = own(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace;
    const skyMat = own(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }));
    const plane = new THREE.Mesh(own(new THREE.PlaneGeometry(70, 30)), skyMat);
    plane.position.set(215, 70, -18);
    root.add(plane);
    const sunCv = document.createElement('canvas'); sunCv.width = sunCv.height = 64;
    const sctx = sunCv.getContext('2d');
    const rg = sctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,244,214,1)'); rg.addColorStop(0.25, 'rgba(255,214,150,0.8)'); rg.addColorStop(1, 'rgba(255,170,90,0)');
    sctx.fillStyle = rg; sctx.fillRect(0, 0, 64, 64);
    const sunTex = own(new THREE.CanvasTexture(sunCv)); sunTex.colorSpace = THREE.SRGBColorSpace;
    const sunMat = own(new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    const sun = new THREE.Mesh(own(new THREE.PlaneGeometry(10, 10)), sunMat);
    sun.position.set(220.5, 66.6, -17.5);
    root.add(sun);
    const ridgeMat = own(new THREE.MeshBasicMaterial({ color: 0x2b2438, toneMapped: false, fog: false }));
    const ridge = new Vox();
    const rr = rng(505);
    for (let x = 190; x < 242; x += 1.6) { const h = 1 + rr() * 2.6 + Math.sin(x * 0.4) * 0.9; ridge.box(x, 63.2 + h / 2, -15.5, 1.7, h + 1, 0.4, 0xffffff); }
    for (let x = 190; x < 242; x += 2.3) { const h = 0.5 + rr() * 1.4; ridge.box(x, 62.8 + h / 2, -11, 2.4, h + 1, 0.4, 0xffffff, 0, 0.6); }
    const ridgeMesh = new THREE.Mesh(ridge.geometry(), ridgeMat); own(ridgeMesh.geometry);
    ridgeMat.vertexColors = true;
    root.add(ridgeMesh);
    const c0 = new THREE.Color(), c1 = new THREE.Color(0x4a3850);
    animated.push({
      update: () => {
        const d = sky.dawn;
        skyMat.color.setScalar(0.04 + 0.96 * d);
        sunMat.opacity = d;
        ridgeMat.color.copy(c0.setHex(0x06090d)).lerp(c1, d);
      },
    });
  }

  // region stencils and relay letters on the back walls
  const plate = (text, x, y, h, opts) => { const m = textPlate(text, h, opts); m.position.set(x, y, BW + 0.42); root.add(m); own(m.geometry); own(m.material); own(m.material.map); return m; };
  plate('BURIED WORKSHOP', 11.5, 15.6, 0.55, { opacity: 0.42 });
  plate('SECTOR 01 · MAINTENANCE', 11.5, 14.95, 0.3, { opacity: 0.3 });
  plate('RESERVOIR ACCESS', 84.4, 16.2, 0.45, { opacity: 0.4 });
  plate('SILENT FOUNDRY', 139, 26.8, 0.5, { opacity: 0.4 });
  plate('PRESS LINE 2', 163.4, 14.6, 0.4, { opacity: 0.32 });
  plate('ASCENT LIFT', 216.5, 20.6, 0.5, { opacity: 0.42 });
  plate('RELAY A', 73.5, 16.9, 0.36, { color: '#ffb648', opacity: 0.7 });
  plate('RELAY B', 131.5, 26.2, 0.36, { color: '#ffb648', opacity: 0.7 });
  plate('RELAY C', 197.5, 22.2, 0.36, { color: '#ffb648', opacity: 0.7 });
  plate('▲ SURFACE', 214.5, 44.4, 0.42, { opacity: 0.5 });

  // ── conduits ──
  const conduits = level.conduits.map((c) => {
    const v = new Vox();
    const zAt = (x, y) => {
      const ci = Math.floor(x), cj = Math.floor(y);
      if (!solid(ci, cj)) return inOpen(ci, cj) ? -1.4 : BW + 0.42;
      const d = dist[cj * W + ci];
      return TZ1 + (d >= 2 ? Math.min(d - 1, 4) * 0.22 + 0.16 : 0) + 0.07;   // rides on the terraced rock face
    };
    for (let k = 0; k < c.pts.length - 1; k++) {
      const [ax, ay] = c.pts[k], [bx, by] = c.pts[k + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len / 0.5));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const x0 = lerp(ax, bx, t0), y0 = lerp(ay, by, t0), x1 = lerp(ax, bx, t1), y1 = lerp(ay, by, t1);
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const th = c.secondary ? 0.08 : 0.12;
        v.box(mx, my, zAt(mx, my), Math.abs(x1 - x0) + th, Math.abs(y1 - y0) + th, 0.1, 0xffffff);
      }
    }
    for (const [x, y] of c.pts) v.box(x, y, zAt(x, y) + 0.02, 0.26, 0.26, 0.14, 0xffffff);
    const mat = own(glowMat(0x3b2f22));
    const mesh = new THREE.Mesh(v.geometry(), mat); own(mesh.geometry);
    mat.vertexColors = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    return { def: c, mat, lit: 0 };
  });
  const cOff = new THREE.Color(0x6a5238), cOn = new THREE.Color(0xffb648), cRev = new THREE.Color(0xbff6fb), cTmp = new THREE.Color();
  const updateConduits = (sim, t, dt) => {
    for (const c of conduits) {
      const on = sim.powered(c.def.when) ? 1 : 0;
      c.lit += (on - c.lit) * Math.min(1, dt * 6);
      const pulse = 0.85 + 0.15 * Math.sin(t * 4 + c.def.pts[0][0]);
      cTmp.copy(cOff).lerp(cOn, c.lit * pulse);
      if (c.lit > 0.5) cTmp.multiplyScalar(1.5);
      const rev = sim.conduitReveal[c.def.id] || 0;
      if (rev > 0 && c.lit < 0.5) cTmp.lerp(cRev, Math.min(1, rev) * (0.35 + 0.25 * Math.sin(t * 9)));
      c.mat.color.copy(cTmp);
    }
  };

  return {
    root, anchors, animated, sky, updateConduits,
    dispose() {
      scene.remove(root);
      for (const o of owned) if (o && o.dispose) o.dispose();
      for (const m of instanced) m.dispose();
    },
  };
}
