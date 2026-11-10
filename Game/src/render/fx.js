// DEEPWAKE — transient effects. Every pool is bounded; lifetimes are short; nothing here is authoritative.

import * as THREE from 'three';
import { PAL, additive, glowMat, clamp01 } from './vox.js';
import { C } from '../config.js';

const MAX_PARTICLES = 160;
const RING_SEGS = 64;
const MAX_RINGS = 4;
const MAX_GHOSTS = 8;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.owned = [];
    const own = (o) => { this.owned.push(o); return o; };

    // particles: one instanced mesh of tiny unlit cubes
    this.pGeo = own(new THREE.BoxGeometry(1, 1, 1));
    this.pMat = own(new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }));
    this.pMesh = new THREE.InstancedMesh(this.pGeo, this.pMat, MAX_PARTICLES);
    this.pMesh.frustumCulled = false;
    this.pMesh.count = 0;
    this.root.add(this.pMesh);
    this.parts = [];
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.v = new THREE.Vector3();
    this.col = new THREE.Color(); this.eul = new THREE.Euler();

    // pulse rings: each segment is clamped by a wall distance measured when the pulse is emitted,
    // so the cosmetic wave visibly stops where the functional wave is blocked.
    this.rings = [];
    for (let k = 0; k < MAX_RINGS; k++) {
      const geo = own(new THREE.BufferGeometry());
      const pos = new Float32Array((RING_SEGS + 1) * 2 * 3), colr = new Float32Array((RING_SEGS + 1) * 2 * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      const idx = [];
      for (let s = 0; s < RING_SEGS; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      const mat = own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, fog: false, side: THREE.DoubleSide }));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 5;
      this.root.add(mesh);
      this.rings.push({ mesh, geo, t: 9, x: 0, y: 0, limit: new Float32Array(RING_SEGS + 1), color: new THREE.Color(PAL.cyan), maxR: C.pulseRadius, dur: 0.6 });
    }

    // dash trail ghosts
    this.ghostGeo = own(new THREE.PlaneGeometry(0.7, 1.35));
    this.ghosts = [];
    for (let k = 0; k < MAX_GHOSTS; k++) {
      const mat = own(additive(PAL.cyan, 0));
      const m = new THREE.Mesh(this.ghostGeo, mat);
      m.visible = false; this.root.add(m);
      this.ghosts.push({ m, mat, t: 9 });
    }
    this.ghostTimer = 0;

    // shield: restrained geometric facets
    this.shieldMat = own(new THREE.MeshBasicMaterial({ color: PAL.cyan, wireframe: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    this.shield = new THREE.Mesh(own(new THREE.IcosahedronGeometry(1.05, 0)), this.shieldMat);
    this.shield.visible = false;
    this.root.add(this.shield);

    // interaction target bracket
    this.bracketMat = own(glowMat(0xf1e9da));
    this.bracket = new THREE.Group();
    const bg = own(new THREE.BoxGeometry(1, 1, 1));
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const h = new THREE.Mesh(bg, this.bracketMat); h.scale.set(0.3, 0.05, 0.05); h.position.set(sx * 0.4, sy * 0.55, 0);
      const v = new THREE.Mesh(bg, this.bracketMat); v.scale.set(0.05, 0.3, 0.05); v.position.set(sx * 0.53, sy * 0.42, 0);
      this.bracket.add(h, v);
    }
    this.bracket.visible = false;
    this.root.add(this.bracket);
  }

  clear() {
    this.parts.length = 0;
    this.pMesh.count = 0;
    for (const r of this.rings) { r.t = 9; r.mesh.visible = false; }
    for (const g of this.ghosts) { g.t = 9; g.m.visible = false; }
    this.shield.visible = false;
    this.bracket.visible = false;
  }

  spawn(x, y, z, vx, vy, vz, life, size, hex, grav = 0) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push({ x, y, z, vx, vy, vz, life, max: life, size, hex, grav, rot: Math.random() * 6 });
  }

  burst(x, y, n, hex, speed = 4, size = 0.1, life = 0.5, grav = 12, z = 0.2) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.6,
        Math.cos(a) * s, Math.sin(a) * s + speed * 0.3, (Math.random() - 0.5) * 2, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), hex, grav);
    }
  }

  ring(sim, x, y, hex = PAL.cyan, maxR = C.pulseRadius, dur = 0.6, walls = true) {
    let r = this.rings[0];
    for (const c of this.rings) if (c.t > r.t) r = c;
    r.t = 0; r.x = x; r.y = y; r.color.setHex(hex); r.maxR = maxR; r.dur = dur;
    for (let s = 0; s <= RING_SEGS; s++) {
      let d = maxR;
      if (walls) {
        const a = (s / RING_SEGS) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
        for (let q = 0.2; q <= maxR; q += 0.2) {
          const px = x + dx * q, py = y + dy * q;
          let blocked = sim.solidAt(Math.floor(px), Math.floor(py));
          if (!blocked) for (const dr of sim.doors) if (dr.solid && px > dr.x0 && px < dr.x1 && py > dr.y0 && py < dr.y1) { blocked = true; break; }
          if (blocked) { d = q; break; }
        }
      }
      r.limit[s] = d;
    }
    r.mesh.position.set(x, y, 0.3);
    r.mesh.visible = true;
  }

  /** Route a simulation event to its effect. */
  onEvent(e, sim) {
    const p = sim.player;
    switch (e.type) {
      case 'pulse': this.ring(sim, e.x, e.y, PAL.cyan, C.pulseRadius, 0.62, true); break;
      case 'pulseDenied': this.ring(sim, p.x, p.y + 0.75, 0x6a7680, 0.7, 0.25, false); break;
      case 'land': if (e.speed > 6) for (let k = 0; k < 5; k++) this.spawn(e.x + (Math.random() - 0.5) * 0.6, e.y + 0.05, 0.3, (Math.random() - 0.5) * 2.4, 0.6 + Math.random(), 0, 0.35, 0.09, 0x8a97a5, 2); break;
      case 'walljump': for (let k = 0; k < 4; k++) this.spawn(e.x - e.dir * 0.35, e.y + 0.3 + Math.random() * 0.6, 0.3, -e.dir * (0.5 + Math.random()), Math.random() * 1.5, 0, 0.3, 0.08, 0x9db0c2, 4); break;
      case 'dashStop': this.burst(e.x, e.y + 0.7, 5, 0x9db0c2, 2.5, 0.08, 0.3, 8); break;
      case 'seamBreak': this.burst(e.x, e.y, 26, e.style === 'amber' ? 0xffb648 : 0x8fa3b5, 6, 0.16, 0.8, 16); this.burst(e.x, e.y, 10, 0xffd27a, 4, 0.08, 0.6, 10); break;
      case 'shield': this.shieldT = 0; this.burst(e.x, e.y, 10, PAL.cyan, 5, 0.09, 0.4, 0); break;
      case 'damage': this.burst(e.x, e.y, 12, PAL.red, 4.5, 0.09, 0.45, 10); break;
      case 'socketIn': this.burst(e.x, e.y + 0.6, 12, PAL.amber, 3.5, 0.07, 0.5, 6, -0.6); break;
      case 'socketOut': this.burst(e.x, e.y + 0.6, 6, 0x9a8a70, 2.5, 0.07, 0.4, 6, -0.6); break;
      case 'switch': this.burst(e.x, e.y + 1.1, 8, PAL.amber, 3, 0.06, 0.4, 5, -0.9); break;
      case 'relay': this.ring(sim, e.x, e.y, PAL.amber, 4.5, 1.1, false); this.burst(e.x, e.y, 22, 0xdffcff, 5, 0.09, 0.9, 2, -1.2); break;
      case 'relayDormant': this.ring(sim, e.x, e.y, 0x6a7680, 0.9, 0.3, false); break;
      case 'deflect': this.ring(sim, e.x, e.y, 0xd8dee6, 1.0, 0.25, false); this.burst(e.x, e.y, 6, 0xd8dee6, 4, 0.06, 0.25, 6); break;
      case 'stun': this.burst(e.x, e.y, 10, PAL.cyan, 3.5, 0.07, 0.5, 4); break;
      case 'disable': this.burst(e.x, e.y, 18, 0xffb060, 5, 0.1, 0.7, 14); this.burst(e.x, e.y, 8, 0x40464e, 3, 0.14, 0.9, 16); break;
      case 'boltHit': this.burst(e.x, e.y, 6, 0xffb060, 3, 0.07, 0.3, 4); break;
      case 'cache': this.burst(e.x, e.y + 0.6, 12, PAL.cyan, 3, 0.07, 0.7, -3, -0.8); break;
      case 'archive': this.ring(sim, e.x, e.y + 1, PAL.cyan, 2.2, 0.8, false); this.burst(e.x, e.y + 1, 14, 0xdffcff, 2.5, 0.06, 0.9, -2, -0.9); break;
      case 'station': this.ring(sim, e.x, e.y + 0.2, PAL.teal, 1.8, 0.7, false); break;
      case 'pressSlam': for (let k = 0; k < 10; k++) this.spawn(e.x + (Math.random() - 0.5) * 2.6, e.y + 0.1, 0.4, (Math.random() - 0.5) * 5, Math.random() * 1.5, 0, 0.5, 0.12, 0x8a8078, 3); break;
      case 'cellPlace': this.burst(e.x, e.y + 0.1, 4, 0x8a97a5, 1.5, 0.07, 0.3, 4, -0.4); break;
      default: break;
    }
  }

  update(sim, cam, t, dt, reduced, sparks) {
    const p = sim.player;

    // ambient dust near the camera (few, slow, tiny)
    if (!reduced && Math.random() < dt * 5 && this.parts.length < MAX_PARTICLES - 40) {
      this.spawn(cam.x + (Math.random() - 0.5) * 22, cam.y + (Math.random() - 0.5) * 12, -1 + Math.random() * 1.6, (Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.2, 0, 4, 0.04, sim.liftPhase ? 0xffe2b0 : 0x8296a8, 0);
    }
    // wall-slide grit and dash sparks
    if (p.wallSliding && Math.random() < dt * 30) this.spawn(p.x + p.wallDir * 0.4, p.y + 0.9 + Math.random() * 0.4, 0.3, -p.wallDir * 0.4, -0.5, 0, 0.3, 0.06, 0x9db0c2, 3);
    for (const s of sparks) {
      if (s.trail) { if (Math.random() < dt * 40) this.spawn(s.x, s.y, 0.1, 0, 0, 0, 0.25, 0.1, s.color, 0); }
      else this.spawn(s.x + (Math.random() - 0.5) * 0.5, s.y, 0.2 + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 1.5, s.up * (0.5 + Math.random() * 0.5), 0, 0.35, 0.07, s.color, 2);
    }

    // particles
    let n = 0;
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const q = this.parts[k];
      q.life -= dt;
      if (q.life <= 0) { this.parts.splice(k, 1); continue; }
      q.vy -= q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    for (const q of this.parts) {
      const a = clamp01(q.life / q.max);
      const sz = q.size * (0.3 + 0.7 * a);
      this.eul.set(q.rot + t * 3, q.rot * 2 + t * 2, 0);
      this.q.setFromEuler(this.eul);
      this.m4.compose(this.v.set(q.x, q.y, q.z), this.q, this.s.set(sz, sz, sz));
      this.pMesh.setMatrixAt(n, this.m4);
      this.pMesh.setColorAt(n, this.col.setHex(q.hex).multiplyScalar(0.25 + 0.75 * a));
      n++;
    }
    this.pMesh.count = n;
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;

    // rings
    for (const r of this.rings) {
      if (r.t > r.dur) { r.mesh.visible = false; continue; }
      r.t += dt;
      const k = clamp01(r.t / (r.dur * 0.58));           // expansion matches the functional wave (0.35 s of 0.6 s)
      const rad = r.maxR * k;
      const fade = clamp01(1 - (r.t - r.dur * 0.5) / (r.dur * 0.5));
      const pos = r.geo.attributes.position.array, colr = r.geo.attributes.color.array;
      const th = 0.1 + 0.16 * (1 - k);
      for (let s = 0; s <= RING_SEGS; s++) {
        const a = (s / RING_SEGS) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
        const lim = r.limit[s];
        const stopped = rad >= lim;
        const rr = stopped ? lim : rad;
        // a blocked segment dims quickly: it must not suggest a hit beyond the wall
        const b = (stopped ? 0.22 : 1) * fade;
        const o = s * 6;
        pos[o] = dx * Math.max(0, rr - th); pos[o + 1] = dy * Math.max(0, rr - th); pos[o + 2] = 0;
        pos[o + 3] = dx * rr; pos[o + 4] = dy * rr; pos[o + 5] = 0;
        colr[o] = r.color.r * b * 0.25; colr[o + 1] = r.color.g * b * 0.25; colr[o + 2] = r.color.b * b * 0.25;
        colr[o + 3] = r.color.r * b; colr[o + 4] = r.color.g * b; colr[o + 5] = r.color.b * b;
      }
      r.geo.attributes.position.needsUpdate = true; r.geo.attributes.color.needsUpdate = true;
    }

    // dash trail
    this.ghostTimer -= dt;
    if (p.dashT > 0 && this.ghostTimer <= 0 && sim.state === 'play') {
      this.ghostTimer = 0.03;
      let g = this.ghosts[0];
      for (const c of this.ghosts) if (c.t > g.t) g = c;
      g.t = 0; g.m.position.set(p.x, p.y + 0.72, -0.05); g.m.visible = true;
    }
    for (const g of this.ghosts) {
      if (!g.m.visible) continue;
      g.t += dt;
      const a = 1 - g.t / 0.22;
      if (a <= 0) { g.m.visible = false; continue; }
      g.mat.opacity = 0.32 * a; g.m.scale.set(1, 0.6 + 0.4 * a, 1);
    }

    // shield fracture
    if (this.shieldT !== undefined && this.shieldT < 0.45) {
      this.shieldT += dt;
      const a = clamp01(1 - this.shieldT / 0.45);
      this.shield.visible = true;
      this.shield.position.set(p.x, p.y + 0.75, 0);
      this.shield.scale.setScalar(1 + (1 - a) * 0.5);
      this.shield.rotation.set(t * 2, t * 3, 0);
      this.shieldMat.opacity = 0.9 * a;
    } else this.shield.visible = false;

    // current interaction target
    const tg = sim.state === 'play' ? sim.target : null;
    if (tg && tg.kind !== 'place') {
      this.bracket.visible = true;
      const big = tg.kind === 'lift' || tg.kind === 'switch' || tg.kind === 'archive';
      this.bracket.position.set(tg.x, tg.y + (big ? 0.95 : 0.6), 0.5);
      const s = 1 + 0.06 * Math.sin(t * 6);
      this.bracket.scale.set(s * (big ? 1.2 : 1.15), s * (big ? 1.5 : 1.0), 1);
      this.bracketMat.color.setHex(tg.ok ? 0xf1e9da : PAL.red);
    } else if (tg && tg.kind === 'place' && tg.ok) {
      this.bracket.visible = true;
      this.bracket.position.set(tg.spot.x, tg.spot.y + 0.5, 0.5);
      this.bracket.scale.set(0.95, 0.8, 1);
      this.bracketMat.color.setHex(0x8a97a5);
    } else this.bracket.visible = false;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const o of this.owned) o.dispose();
    this.pMesh.dispose();
  }
}
