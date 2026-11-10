// DEEPWAKE — voxel construction helpers: merged box geometry, shared materials, pixel textures.

import * as THREE from 'three';

export const PAL = {
  deep: 0x101923,
  ceramic: 0xdcd7cb, ceramicShade: 0xb4afa4, charcoal: 0x2a2e34, charcoalLight: 0x444a52,
  amber: 0xffb648, amberDeep: 0xc77a1c, amberDim: 0x6d4a1c,
  cyan: 0x7fe3ee, cyanDeep: 0x3d8f9e, cyanDim: 0x1f4a54,
  teal: 0x5fd6c4, tealDim: 0x1f4d48,
  red: 0xff6a3d, redDim: 0x5a2416,
  rust: 0xb5562b, bronze: 0x8a6a43, bronzeDark: 0x4d3c28,
  steel: 0x6c7682, steelDark: 0x3d444d, steelLight: 0x98a2ad,
  white: 0xffffff, black: 0x05080b,
};

/** Deterministic cell hash in [0, 1). */
export function h2(i, j, s = 0) {
  let n = (i * 374761393 + j * 668265263 + s * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177 | 0;
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _c = new THREE.Color();
const FACES = [
  // normal, 4 corner signs (x,y,z)
  [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
  [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
];

/** Accumulates axis-aligned (optionally z-rotated) boxes into one vertex-coloured geometry. */
export class Vox {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.count = 0; }

  /** Box centred at (cx, cy, cz) with size (w, h, d). `rot` rotates around the z axis about the centre. */
  box(cx, cy, cz, w, h, d, hex, rot = 0, shade = 1) {
    _c.setHex(hex);
    const r = _c.r * shade, g = _c.g * shade, b = _c.b * shade;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const base = this.p.length / 3;
    let v = 0;
    for (const [nrm, corners] of FACES) {
      for (const s of corners) {
        const lx = (s[0] * w) / 2, ly = (s[1] * h) / 2;
        this.p.push(cx + lx * cs - ly * sn, cy + lx * sn + ly * cs, cz + (s[2] * d) / 2);
        this.n.push(nrm[0] * cs - nrm[1] * sn, nrm[0] * sn + nrm[1] * cs, nrm[2]);
        this.c.push(r, g, b);
      }
      const o = base + v;
      this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
      v += 4;
    }
    this.count++;
    return this;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    return g;
  }

  mesh(material) {
    const m = new THREE.Mesh(this.geometry(), material);
    if (material.isMeshLambertMaterial) { m.castShadow = true; m.receiveShadow = true; }
    return m;
  }
}

// Shared materials (never disposed by individual views).
export const MAT = {
  lit: new THREE.MeshLambertMaterial({ vertexColors: true }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }),
};

/** A dedicated unlit material whose colour can be animated. */
export function glowMat(hex, opts = {}) {
  return new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, fog: false, ...opts });
}
export function litMat(hex, opts = {}) { return new THREE.MeshLambertMaterial({ color: hex, ...opts }); }
export function additive(hex, opacity = 0.5) {
  return new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
}

/** Build a mesh pair (lit + glow) inside a group from a builder callback: fn(lit, glow). */
export function model(fn) {
  const lit = new Vox(), glow = new Vox();
  fn(lit, glow);
  const g = new THREE.Group();
  if (lit.count) g.add(lit.mesh(MAT.lit));
  if (glow.count) g.add(glow.mesh(MAT.glow));
  return g;
}

/** White-vertex geometry mesh with its own colourable material. */
export function tinted(fn, material) {
  const v = new Vox();
  fn(v);
  return v.mesh(material);
}

/** 16x16 nearest-filtered noise texture (multiplied with instance colour). */
export function noiseTexture(seed, lo = 0.78, hi = 1.0, size = 16) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  for (let k = 0; k < size * size; k++) {
    let v = lo + (hi - lo) * r();
    if (r() < 0.06) v = lo * 0.86;           // sparse darker speckle
    const b = Math.round(v * 255);
    img.data[k * 4] = b; img.data[k * 4 + 1] = b; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * 16x16 block-face textures: every voxel face reads as a bevelled block (light top/left edge,
 * dark bottom/right edge) instead of a flat noisy wall. Multiplied with the instance colour.
 */
export function blockTexture(seed, kind = 'rock') {
  const size = 16;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  const val = new Float32Array(size * size);
  const coarse = Array.from({ length: 16 }, () => 0.8 + r() * 0.18);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v;
    if (kind === 'metal') {
      v = 0.9 + (r() - 0.5) * 0.04;
      if (y === 8) v -= 0.1;
      if ((x === 3 || x === 12) && (y === 3 || y === 12)) v -= 0.32;
      if ((x === 4 || x === 13) && (y === 3 || y === 12)) v += 0.06;
    } else if (kind === 'brick') {
      const row = y >> 2, off = (row % 2) * 4;
      const mortar = (y % 4 === 3) || ((x + off) % 8 === 7);
      v = mortar ? 0.6 : 0.82 + ((row * 7 + ((x + off) >> 3) * 13 + seed) % 5) * 0.035 + (r() - 0.5) * 0.04;
      if (!mortar && y % 4 === 0) v += 0.05;
    } else if (kind === 'plank') {
      const col = x >> 2;
      v = 0.78 + ((col * 11 + seed) % 4) * 0.05 + (r() - 0.5) * 0.05;
      if (x % 4 === 3) v = 0.58;
      if (r() < 0.03) v -= 0.14;
    } else {
      v = coarse[(y >> 2) * 4 + (x >> 2)] + (r() - 0.5) * 0.07;
      if (kind === 'cave' && r() < 0.08) v -= 0.16;
    }
    if (kind === 'rock' || kind === 'metal' || kind === 'cave') {
      const e = kind === 'cave' ? 0.5 : 1;
      if (y === 0) v += 0.11 * e; else if (y === size - 1) v -= 0.22 * e;
      if (x === 0) v += 0.05 * e; else if (x === size - 1) v -= 0.15 * e;
    }
    val[y * size + x] = v;
  }
  if (kind === 'rock' || kind === 'cave') {          // a short hairline crack
    let cx = 3 + Math.floor(r() * 9), cy = 2 + Math.floor(r() * 4);
    for (let k = 0; k < 6; k++) { val[cy * size + cx] -= 0.2; cy = Math.min(size - 2, cy + 1); cx = Math.min(size - 2, Math.max(1, cx + (r() < 0.5 ? -1 : r() < 0.5 ? 1 : 0))); }
  }
  for (let k = 0; k < size * size; k++) {
    const b = Math.max(0, Math.min(255, Math.round(val[k] * 255)));
    img.data[k * 4] = b; img.data[k * 4 + 1] = b; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Small stencil text plate (pixel look: low-res canvas + nearest filtering). */
export function textTexture(text, { color = '#f1e9da', px = 14, pad = 3, font = 'bold' } = {}) {
  const cv = document.createElement('canvas');
  let ctx = cv.getContext('2d');
  const f = `${font} ${px}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.font = f;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.width = w; cv.height = px + pad * 2;
  ctx = cv.getContext('2d');
  ctx.font = f; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.fillText(text, pad, cv.height / 2 + 1);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.aspect = cv.width / cv.height;
  return t;
}

/** Flat text decal facing +z. */
export function textPlate(text, height, opts = {}) {
  const tex = textTexture(text, opts);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: opts.opacity ?? 0.8, depthWrite: false, toneMapped: false, fog: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * tex.userData.aspect, height), mat);
  m.userData.ownsMaterial = true;
  return m;
}

export function lerp(a, b, k) { return a + (b - a) * k; }
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function damp(a, b, lambda, dt) { return a + (b - a) * (1 - Math.exp(-lambda * dt)); }
