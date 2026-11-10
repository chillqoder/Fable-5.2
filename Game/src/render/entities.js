// DEEPWAKE — views for every dynamic object. Each view reads simulation state by stable index
// every frame (the sim rebuilds its arrays on checkpoint recovery) and never writes to it.

import * as THREE from 'three';
import { Vox, MAT, PAL, glowMat, additive, model, tinted, damp, clamp01, lerp, h2, rng } from './vox.js';
import { C } from '../config.js';

const _a = new THREE.Color(), _b = new THREE.Color();
function mix(mat, hexA, hexB, k, scale = 1) { mat.color.copy(_a.setHex(hexA)).lerp(_b.setHex(hexB), clamp01(k)).multiplyScalar(scale); }

export class EntityViews {
  constructor(scene, sim) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.scene = scene;
    this.mats = [];
    this.views = [];
    this.lights = [];      // dynamic light anchors, rebuilt every frame
    this.sparks = [];      // spark requests for the fx layer: { x, y, color }
    const L = sim.level;
    L.stations.forEach((d, i) => this.station(d, i));
    L.sockets.forEach((d, i) => this.socket(d, i));
    L.cells.forEach((d, i) => this.cell(d, i));
    L.switches.forEach((d, i) => this.switchView(d, i));
    L.relays.forEach((d, i) => this.relay(d, i));
    L.seams.forEach((d, i) => this.seam(d, i));
    L.doors.forEach((d, i) => this.door(d, i));
    L.movers.forEach((d, i) => this.mover(d, i));
    this.mainLift(L.mainLift);
    this.press(L.press);
    L.vents.forEach((d, i) => this.vent(d, i));
    L.enemies.forEach((d, i) => {
      if (d.kind === 'skitter') this.skitter(d, i); else if (d.kind === 'drone') this.drone(d, i, sim); else this.sentinel(d, i);
    });
    L.archives.forEach((d, i) => this.archive(d, i));
    L.caches.forEach((d, i) => this.cache(d, i));
    this.boltPool();
  }

  glow(hex, opts) { const m = glowMat(hex, opts); this.mats.push(m); return m; }
  add(hex, op) { const m = additive(hex, op); this.mats.push(m); return m; }
  at(obj, x, y, z = 0) { obj.position.set(x, y, z); this.root.add(obj); return obj; }
  light(x, y, z, color, intensity) { this.lights.push({ x, y, z, color, intensity }); }

  update(sim, ilo, t, dt, reduced) {
    this.lights.length = 0;
    this.sparks.length = 0;
    this.reduced = reduced;
    for (const v of this.views) v(sim, t, dt, ilo);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.views.length = 0;
  }

  // ───────────────────────── stations ─────────────────────────
  station(d, i) {
    const g = model((l) => {
      l.box(0, 0.05, -1.2, 1.7, 0.1, 1.3, PAL.steelDark);
      l.box(0, 0.11, -1.2, 1.3, 0.04, 0.9, PAL.charcoal);
      l.box(-0.78, 1.0, -1.65, 0.14, 2.0, 0.14, PAL.steel);
      l.box(0.78, 1.0, -1.65, 0.14, 2.0, 0.14, PAL.steel);
      l.box(0, 2.02, -1.65, 1.7, 0.14, 0.14, PAL.steel);
      l.box(0, 0.5, -1.72, 0.3, 0.8, 0.12, PAL.steelDark);
    });
    this.at(g, d.x, d.y);
    const mat = this.glow(PAL.tealDim);
    g.add(tinted((v) => {
      v.box(0, 0.14, -0.74, 1.3, 0.03, 0.04, 0xffffff); v.box(0, 0.14, -1.66, 1.3, 0.03, 0.04, 0xffffff);
      v.box(-0.66, 0.14, -1.2, 0.04, 0.03, 0.92, 0xffffff); v.box(0.66, 0.14, -1.2, 0.04, 0.03, 0.92, 0xffffff);
      v.box(-0.78, 1.0, -1.57, 0.05, 1.6, 0.03, 0xffffff); v.box(0.78, 1.0, -1.57, 0.05, 1.6, 0.03, 0xffffff);
      v.box(0, 2.02, -1.57, 1.4, 0.05, 0.03, 0xffffff);
    }, mat));
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), mat);
    core.position.set(0, 1.35, -1.65);
    g.add(core);
    let k = 0;
    this.views.push((sim, t, dt) => {
      const st = sim.stations[i];
      const current = sim.checkpointId === st.id;
      k = damp(k, st.lit ? (current ? 1 : 0.6) : 0.12, 6, dt);
      mix(mat, PAL.tealDim, PAL.teal, k, 0.9 + 0.1 * Math.sin(t * 2.5));
      core.rotation.set(t * 0.7, t * 1.1, 0);
      core.position.y = 1.35 + Math.sin(t * 1.6) * 0.06 * k;
      this.light(d.x, d.y + 1.2, -0.6, 0x5fd6c4, 0.2 + 0.45 * k);
    });
  }

  // ───────────────────────── sockets / cells ─────────────────────────
  socket(d, i) {
    const g = model((l) => {
      l.box(0, 0.12, -1.0, 1.0, 0.24, 0.9, PAL.bronzeDark);
      l.box(-0.52, 0.5, -1.0, 0.12, 0.76, 0.6, PAL.bronze);
      l.box(0.52, 0.5, -1.0, 0.12, 0.76, 0.6, PAL.bronze);
      l.box(0, 0.75, -1.5, 1.2, 1.5, 0.12, PAL.steelDark);
      l.box(0, 1.56, -1.5, 1.36, 0.12, 0.2, PAL.bronze);
    });
    this.at(g, d.x, d.y);
    const mat = this.glow(PAL.amberDim);
    g.add(tinted((v) => {
      v.box(0, 0.26, -0.56, 0.7, 0.04, 0.03, 0xffffff);
      v.box(-0.45, 0.9, -1.42, 0.06, 1.0, 0.03, 0xffffff); v.box(0.45, 0.9, -1.42, 0.06, 1.0, 0.03, 0xffffff);
      v.box(0, 1.42, -1.42, 0.96, 0.06, 0.03, 0xffffff);
    }, mat));
    let k = 0;
    this.views.push((sim, t, dt) => {
      const on = sim.sockets[i].cell !== null;
      k = damp(k, on ? 1 : 0, 8, dt);
      mix(mat, PAL.amberDim, PAL.amber, k, on ? 0.9 + 0.1 * Math.sin(t * 5) : 0.7 + 0.3 * Math.sin(t * 1.5));
      if (on) this.light(d.x, d.y + 0.9, 0, 0xffb648, 0.6);
    });
  }

  cell(d, i) {
    const g = model((l, gl) => {
      l.box(0, 0.06, 0, 0.62, 0.12, 0.5, PAL.steelDark);
      l.box(0, 0.78, 0, 0.62, 0.12, 0.5, PAL.steelDark);
      gl.box(0, 0.42, 0, 0.5, 0.6, 0.38, 0xf0a030);          // faceted amber body
      gl.box(0, 0.42, 0, 0.58, 0.44, 0.3, 0xffb648);
      gl.box(0, 0.42, 0, 0.42, 0.5, 0.46, 0xffc870);
      l.box(-0.3, 0.42, 0, 0.05, 0.66, 0.1, PAL.charcoal);
      l.box(0.3, 0.42, 0, 0.05, 0.66, 0.1, PAL.charcoal);
      l.box(-0.2, 0.92, 0, 0.06, 0.18, 0.08, PAL.steel);     // handle
      l.box(0.2, 0.92, 0, 0.06, 0.18, 0.08, PAL.steel);
      l.box(0, 1.02, 0, 0.46, 0.06, 0.08, PAL.steelLight);
    });
    this.at(g, d.x, d.y, -0.6);
    let init = false;
    this.views.push((sim, t, dt, ilo) => {
      const c = sim.cells[i];
      let x, y, z, lam = 22;
      if (c.state === 'carried') { const cp = ilo.carryPoint(sim.player); x = cp.x; y = cp.y; z = 0.02; lam = 30; }
      else if (c.state === 'socket') { x = c.x; y = c.y + 0.24; z = -1.0; }
      else { x = c.x; y = c.y; z = -0.6; }
      if (!init || Math.abs(g.position.x - x) > 6) { g.position.set(x, y, z); init = true; }
      else { g.position.x = damp(g.position.x, x, lam, dt); g.position.y = damp(g.position.y, y, lam, dt); g.position.z = damp(g.position.z, z, lam, dt); }
      g.rotation.y = c.state === 'carried' ? sim.player.facing * 0.5 : 0.25;
      this.light(g.position.x, g.position.y + 0.5, 0.4, 0xffb648, 0.55);
    });
  }

  // ───────────────────────── switches ─────────────────────────
  switchView(d, i) {
    const g = model((l) => {
      l.box(0, 0.5, -1.3, 0.22, 1.0, 0.22, PAL.steelDark);
      l.box(0, 1.1, -1.3, 0.6, 0.5, 0.36, PAL.steel);
      l.box(0, 0.05, -1.3, 0.6, 0.1, 0.5, PAL.charcoal);
    });
    this.at(g, d.x, d.y);
    const mat = this.glow(PAL.redDim);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.04), mat);
    lamp.position.set(0, 1.22, -1.1);
    g.add(lamp);
    const lever = new THREE.Group();
    lever.position.set(0, 1.02, -1.08);
    lever.add(model((l) => { l.box(0, 0.22, 0, 0.08, 0.44, 0.08, PAL.steelLight); l.box(0, 0.46, 0, 0.16, 0.12, 0.14, PAL.rust); }));
    g.add(lever);
    let k = 0;
    this.views.push((sim, t, dt) => {
      const on = sim.switches[i].on;
      k = damp(k, on ? 1 : 0, 12, dt);
      lever.rotation.z = lerp(0.9, -0.9, k);
      mix(mat, PAL.red, PAL.amber, k, on ? 1 : 0.45 + 0.3 * Math.sin(t * 3));
      this.light(d.x, d.y + 1.2, 0, on ? 0xffb648 : 0xff6a3d, on ? 0.6 : 0.3);
    });
  }

  // ───────────────────────── relays ─────────────────────────
  relay(d, i) {
    const g = model((l) => {
      l.box(0, 0.86, -4.1, 1.7, 0.16, 0.3, PAL.bronze); l.box(0, -0.86, -4.1, 1.7, 0.16, 0.3, PAL.bronze);
      l.box(-0.86, 0, -4.1, 0.16, 1.7, 0.3, PAL.bronze); l.box(0.86, 0, -4.1, 0.16, 1.7, 0.3, PAL.bronze);
      l.box(0, 0, -4.25, 1.6, 1.6, 0.1, PAL.bronzeDark);
      for (const [x, y] of [[-0.86, 0.86], [0.86, 0.86], [-0.86, -0.86], [0.86, -0.86]]) l.box(x, y, -4.0, 0.3, 0.3, 0.36, PAL.steelDark);
    });
    this.at(g, d.x, d.y);
    const mat = this.glow(PAL.cyanDim);
    const crystal = tinted((v) => {
      v.box(0, 0, 0, 0.36, 0.86, 0.3, 0xffffff); v.box(0, 0, 0, 0.6, 0.6, 0.26, 0xffffff, Math.PI / 4); v.box(0, 0, 0.06, 0.2, 0.5, 0.3, 0xffffff);
    }, mat);
    crystal.position.z = -3.6;
    g.add(crystal);
    const ringMat = this.glow(PAL.amberDim);
    const ring = tinted((v) => {
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; v.box(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0, 0.26, 0.07, 0.05, 0xffffff, a + Math.PI / 2); }
    }, ringMat);
    ring.position.z = -3.8;
    g.add(ring);
    // lock bars: shown while the relay still needs socket power
    const bars = model((l) => { l.box(0, 0.2, -3.4, 1.5, 0.1, 0.1, PAL.steelDark); l.box(0, -0.2, -3.4, 1.5, 0.1, 0.1, PAL.steelDark); });
    g.add(bars);
    let k = 0, lock = 1;
    this.views.push((sim, t, dt) => {
      const r = sim.relays[i];
      const ready = !r.needs || sim.powered(r.needs);
      k = damp(k, r.active ? 1 : 0, 5, dt);
      lock = damp(lock, r.active || ready ? 0 : 1, 8, dt);
      bars.visible = lock > 0.03;
      bars.scale.x = Math.max(0.001, lock);
      crystal.rotation.y = t * (0.4 + 1.2 * k);
      crystal.position.y = Math.sin(t * 1.3) * 0.05;
      const idle = ready ? 0.55 + 0.25 * Math.sin(t * 2.2) : 0.25;
      mix(mat, PAL.cyanDeep, 0xdffcff, k, lerp(idle, 1.0, k));
      mix(ringMat, PAL.amberDim, PAL.amber, k);
      ring.rotation.z = t * 0.5 * k;
      ring.scale.setScalar(1 + 0.06 * Math.sin(t * 3) * k);
      this.light(d.x, d.y, -2.6, r.active ? 0xbff6fb : 0x3d8f9e, r.active ? 1.0 : 0.4);
    });
  }

  // ───────────────────────── seams ─────────────────────────
  seam(d, i) {
    const r = rng(900 + i * 17);
    const w = d.x1 - d.x0, h = d.y1 - d.y0;
    const hidden = d.style === 'hidden';
    const mat = this.glow(PAL.amberDim);
    const g = new THREE.Group();
    const rockHex = d.x0 > 80 ? 0x4f6a80 : 0x5a6b7e;
    g.add(model((l, gl) => {
      for (let y = 0; y < h; y += 0.5) for (let x = 0; x < w; x += 0.5) {
        if (hidden) l.box(x + 0.25, y + 0.25, -1.2, 0.5, 0.5, 3.6, rockHex, 0, 0.84 + r() * 0.2);
        else {
          const hex = [0xd08a2a, 0xe8a23c, 0xb06a1c, 0xf0b452][Math.floor(r() * 4)];
          l.box(x + 0.25, y + 0.25, -0.5 + (r() - 0.5) * 0.2, 0.5, 0.5, 2.0 + r() * 0.3, hex);
          if (r() < 0.4) gl.box(x + 0.25, y + 0.25, 0.56, 0.2, 0.2, 0.06, 0xffd27a);
        }
      }
      // visible fracture pattern (dark hairlines) — present before any pulse
      const zf = hidden ? 0.62 : 0.68;
      let cx = w * 0.5, cy = 0.1;
      while (cy < h - 0.2) {
        const len = 0.3 + r() * 0.5, lean = (r() - 0.5) * 0.9;
        l.box(cx + lean * 0.2, cy + len / 2, zf, 0.05, len + 0.05, 0.03, hidden ? 0x2a333d : 0x4a2a0c, -lean * 0.6);
        cx = Math.min(w - 0.15, Math.max(0.15, cx + lean * 0.4)); cy += len;
        if (r() < 0.5) l.box(cx + 0.15, cy, zf, 0.3, 0.05, 0.03, hidden ? 0x2a333d : 0x4a2a0c, (r() - 0.5));
      }
    }));
    // luminous veins: faint at rest, bright while a pulse reveal is active
    const veins = tinted((v) => {
      const rr = rng(950 + i * 13);
      let cx = w * 0.5, cy = 0.15;
      while (cy < h - 0.2) {
        const len = 0.3 + rr() * 0.4, lean = (rr() - 0.5) * 0.8;
        v.box(cx + lean * 0.15, cy + len / 2, hidden ? 0.66 : 0.72, 0.07, len, 0.03, 0xffffff, -lean * 0.5);
        if (rr() < 0.6) v.box(cx + (rr() - 0.5) * 0.5, cy + len, hidden ? 0.66 : 0.72, 0.34, 0.06, 0.03, 0xffffff, (rr() - 0.5) * 0.8);
        cx = Math.min(w - 0.2, Math.max(0.2, cx + lean * 0.35)); cy += len;
      }
    }, mat);
    g.add(veins);
    this.at(g, d.x0, d.y0);
    this.views.push((sim, t) => {
      const s = sim.seams[i];
      g.visible = !s.broken;
      if (s.broken) return;
      const rev = clamp01(s.reveal);
      const rest = hidden ? 0.16 : 0.75;
      mix(mat, hidden ? 0x4a3a22 : PAL.amberDeep, 0xffd27a, rev, lerp(rest, 1, rev) * (rev > 0 ? 0.75 + 0.25 * Math.sin(t * 10) : 1));
      if (rev > 0) this.light(d.x0 + w / 2, d.y0 + h / 2, 1.0, 0xffb648, 0.8 * rev);
    });
  }

  // ───────────────────────── doors ─────────────────────────
  door(d, i) {
    const h = d.h;
    const relay = d.style === 'relay';
    const base = relay ? PAL.bronze : d.style === 'service' ? PAL.steel : PAL.steelDark;
    const slab = model((l) => {
      l.box(0.5, h / 2, -0.35, 0.72, h, 1.9, base);
      for (let y = 0.35; y < h; y += 0.6) l.box(0.5, y, -0.35, 0.8, 0.1, 1.96, relay ? PAL.bronzeDark : PAL.steel);
      for (let k = 0; k < 4; k++) l.box(0.5, 0.12, -1.1 + k * 0.5, 0.82, 0.2, 0.25, k % 2 ? PAL.charcoal : PAL.amberDeep);
    });
    const mat = this.glow(PAL.amberDim);
    slab.add(tinted((v) => { v.box(0.5, h * 0.62, 0.62, 0.3, 0.3, 0.03, 0xffffff); v.box(0.5, h * 0.62 - 0.5, 0.62, 0.12, 0.4, 0.03, 0xffffff); }, mat));
    this.at(slab, d.x, d.y0);
    // static frame
    this.at(model((l) => {
      l.box(0.5, h + 0.08, -0.35, 1.2, 0.16, 2.0, PAL.charcoal);
      l.box(0.5, 0.012, 0.25, 1.0, 0.03, 0.5, PAL.amberDeep);   // threshold marking (flat, never reads as a gap)
    }), d.x, d.y0);
    this.views.push((sim, t) => {
      const door = sim.doors[i];
      slab.position.y = d.y0 + door.open * h;
      const on = door.target === 1;
      mix(mat, relay ? PAL.cyanDim : PAL.redDim, on ? PAL.amber : (relay ? PAL.cyanDeep : PAL.red), 1, on ? 1 : 0.6 + 0.2 * Math.sin(t * 2));
    });
  }

  // ───────────────────────── movers ─────────────────────────
  mover(d, i) {
    const lift = d.kind === 'lift';
    const g = model((l) => {
      l.box(0, -d.h / 2, -0.4, d.w, d.h, 2.0, lift ? PAL.bronzeDark : PAL.steelDark);
      l.box(0, -0.04, -0.4, d.w, 0.09, 2.04, lift ? 0xc8b592 : PAL.steelLight);
      l.box(-d.w / 2 + 0.1, -d.h - 0.1, -0.4, 0.2, 0.22, 1.6, PAL.charcoal);
      l.box(d.w / 2 - 0.1, -d.h - 0.1, -0.4, 0.2, 0.22, 1.6, PAL.charcoal);
      if (lift) { l.box(-d.w / 2 + 0.08, 0.5, -1.3, 0.08, 1.0, 0.08, PAL.bronze); l.box(d.w / 2 - 0.08, 0.5, -1.3, 0.08, 1.0, 0.08, PAL.bronze); l.box(0, 1.0, -1.3, d.w, 0.08, 0.08, PAL.bronze); }
    });
    const mat = this.glow(PAL.amberDim);
    g.add(tinted((v) => {
      v.box(0, -d.h / 2, 0.62, d.w - 0.5, 0.08, 0.03, 0xffffff);
      v.box(-d.w / 2 + 0.2, -d.h / 2, 0.62, 0.12, 0.2, 0.03, 0xffffff); v.box(d.w / 2 - 0.2, -d.h / 2, 0.62, 0.12, 0.2, 0.03, 0xffffff);
    }, mat));
    this.at(g, d.ax, d.ay);
    let cw = null, guides = null;
    if (d.ax === d.bx) {
      // vertical guide rails behind the platform, plus a counterweight for the lift
      guides = model((l) => {
        const len = Math.abs(d.by - d.ay) + 3;
        l.box(-d.w / 2 + 0.25, len / 2 - 0.5, -4.0, 0.14, len, 0.14, PAL.steel);
        l.box(d.w / 2 - 0.25, len / 2 - 0.5, -4.0, 0.14, len, 0.14, PAL.steel);
      });
      this.at(guides, d.ax, Math.min(d.ay, d.by));
      if (lift) {
        cw = model((l) => { l.box(0, 0, 0, 1.0, 1.5, 0.5, 0x4a433d); l.box(0, 0.4, 0.26, 0.6, 0.1, 0.02, PAL.amberDeep); l.box(0, 5.75, 0, 0.07, 10, 0.07, 0x2a2623); });
        this.at(cw, d.ax, d.by, -3.6);
      }
    }
    let k = 0;
    this.views.push((sim, t, dt) => {
      const m = sim.movers[i];
      g.position.set(m.x, m.y, 0);
      const on = sim.powered(m.when);
      k = damp(k, on ? 1 : 0, 6, dt);
      mix(mat, PAL.amberDim, PAL.amber, k, 0.85 + 0.15 * Math.sin(t * 6));
      if (cw) cw.position.y = d.ay + d.by - m.y + 1.2;
      if (on) this.light(m.x, m.y - 0.8, 0.5, 0xffb648, 0.5);
    });
  }

  mainLift(d) {
    const g = model((l) => {
      l.box(0, -0.25, -0.4, d.w, 0.5, 2.2, PAL.steelDark);
      l.box(0, -0.04, -0.4, d.w, 0.09, 2.24, 0xc6d2dd);
      for (const x of [-1.85, -0.6, 0.6, 1.85]) l.box(x, 0.55, -1.42, 0.08, 1.1, 0.08, PAL.steel);
      l.box(0, 1.1, -1.42, d.w - 0.2, 0.08, 0.08, PAL.steelLight);
      l.box(0, 0.55, -1.42, d.w - 0.2, 0.05, 0.05, PAL.steel);
      // console post
      l.box(d.consoleX - d.x, 0.5, -1.0, 0.16, 1.0, 0.16, PAL.steelDark);
      l.box(d.consoleX - d.x, 1.08, -0.95, 0.5, 0.34, 0.3, PAL.steel);
      for (let k = 0; k < 6; k++) l.box(-1.75 + k * 0.7, -0.03, 0.62, 0.35, 0.06, 0.1, k % 2 ? PAL.charcoal : PAL.amberDeep);
    });
    const mat = this.glow(PAL.redDim);
    g.add(tinted((v) => { v.box(d.consoleX - d.x, 1.1, -0.78, 0.36, 0.2, 0.03, 0xffffff); v.box(0, -0.3, 0.72, d.w - 0.6, 0.08, 0.03, 0xffffff); }, mat));
    const gates = [-1, 1].map((s) => {
      const gate = model((l) => { l.box(0, 0.5, -0.4, 0.1, 1.0, 1.9, PAL.steel); l.box(0, 0.95, -0.4, 0.14, 0.12, 1.96, PAL.amberDeep); l.box(0, 0.5, -0.4, 0.14, 0.08, 1.96, PAL.charcoal); });
      gate.position.x = s * (d.w / 2 - 0.06);
      g.add(gate);
      return gate;
    });
    this.at(g, d.x, d.y);
    this.views.push((sim, t) => {
      const ml = sim.mainLift;
      g.position.y = ml.yTop;
      const all = sim.relays.every((r) => r.active);
      mix(mat, PAL.red, PAL.amber, all ? 1 : 0, all ? 0.85 + 0.15 * Math.sin(t * 4) : 0.5);
      for (const gate of gates) { gate.scale.y = Math.max(0.001, ml.barrier); gate.visible = ml.barrier > 0.01; }
      this.light(ml.x, ml.yTop + 1.5, 0.6, all ? 0xffcf90 : 0xff6a3d, all ? 0.8 : 0.3);
    });
  }

  press(d) {
    const w = d.x1 - d.x0, hh = d.top - d.upY;
    const g = model((l) => {
      l.box(0, hh / 2, -0.4, w, hh, 2.0, 0x5a5550);
      l.box(0, hh / 2, -0.4, w + 0.1, 0.3, 2.06, 0x3c3836);
      l.box(0, hh + 3.2, -0.4, 0.5, 6.4, 0.5, 0x7a726a);          // piston rod (hidden in the ceiling when raised)
      for (let k = 0; k < 6; k++) l.box(-w / 2 + (k + 0.5) * (w / 6), 0.12, 0.62, w / 6, 0.24, 0.04, k % 2 ? PAL.charcoal : PAL.amberDeep);
      l.box(0, 0.02, -0.4, w, 0.06, 2.02, 0x2a2725);
    });
    const mat = this.glow(PAL.redDim);
    g.add(tinted((v) => { v.box(-w / 2 + 0.25, hh - 0.4, 0.62, 0.22, 0.22, 0.03, 0xffffff); v.box(w / 2 - 0.25, hh - 0.4, 0.62, 0.22, 0.22, 0.03, 0xffffff); }, mat));
    this.at(g, (d.x0 + d.x1) / 2, d.upY);
    // floor hazard marking under the press + safe waiting recess marker
    this.at(model((l) => {
      for (let k = 0; k < 8; k++) l.box(d.x0 + (k + 0.5) * (w / 8), d.downY + 0.012, 0.3, w / 8, 0.03, 0.5, k % 2 ? PAL.charcoal : PAL.amberDeep);
    }), 0, 0);
    this.views.push((sim, t) => {
      const pr = sim.press;
      const tele = pr.phase === 'telegraph';
      g.position.y = pr.y0;
      g.position.x = (d.x0 + d.x1) / 2 + (tele && !this.reduced ? Math.sin(t * 70) * 0.03 : 0);
      const warn = tele ? (Math.sin(t * 28) > 0 ? 1 : 0.2) : pr.phase === 'slam' || pr.phase === 'hold' ? 1 : 0.25;
      mix(mat, PAL.redDim, PAL.red, warn);
      if (tele) this.light((d.x0 + d.x1) / 2, pr.y0 - 0.5, 0.8, 0xff6a3d, 0.9 * warn);
    });
  }

  // ───────────────────────── vents ─────────────────────────
  vent(d, i) {
    const V = C.vent;
    this.at(model((l) => {
      l.box(0, 0.05, -0.3, 1.1, 0.1, 1.5, PAL.charcoal);
      for (let k = 0; k < 5; k++) l.box(-0.36 + k * 0.18, 0.11, -0.3, 0.06, 0.04, 1.3, PAL.steel);
      l.box(-0.62, 0.1, -0.3, 0.12, 0.2, 1.5, PAL.amberDeep); l.box(0.62, 0.1, -0.3, 0.12, 0.2, 1.5, PAL.amberDeep);
    }), d.x, d.y);
    const nozzle = this.glow(PAL.redDim);
    const nz = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 1.2), nozzle);
    this.at(nz, d.x, d.y + 0.135, -0.3);
    // jet volume: exactly the damaging volume (x ± halfW, y .. y + height)
    const jetMat = this.add(0xff7a3a, 0.0);
    const jet = new THREE.Mesh(new THREE.BoxGeometry(V.halfW * 2, V.height, 0.7), jetMat);
    this.at(jet, d.x, d.y + V.height / 2, 0);
    const coreMat = this.add(0xffe0b0, 0.0);
    const core = new THREE.Mesh(new THREE.BoxGeometry(V.halfW * 0.9, V.height, 0.3), coreMat);
    this.at(core, d.x, d.y + V.height / 2, 0);
    const chevMat = this.add(0xff8a4a, 0.0);
    const chev = tinted((v) => { for (let k = 0; k < 3; k++) { v.box(-0.14, k * 0.34, 0, 0.3, 0.07, 0.04, 0xffffff, 0.6); v.box(0.14, k * 0.34, 0, 0.3, 0.07, 0.04, 0xffffff, -0.6); } }, chevMat);
    this.at(chev, d.x, d.y + 0.4, 0.2);
    this.views.push((sim, t) => {
      const v = sim.vents[i];
      const warn = v.phase === 'warning', act = v.phase === 'active';
      mix(nozzle, PAL.redDim, act ? 0xffd0a0 : PAL.red, warn ? 0.5 + 0.5 * Math.sin(t * 18) : act ? 1 : 0);
      jetMat.opacity = act ? 0.42 + 0.12 * Math.sin(t * 37) : 0;
      coreMat.opacity = act ? 0.55 + 0.2 * Math.sin(t * 51) : 0;
      jet.visible = core.visible = act;
      chev.visible = warn;
      chevMat.opacity = warn ? 0.9 : 0;
      if (warn) chev.position.y = d.y + 0.4 + ((t * 2.2) % 1) * 1.2;
      if (warn && Math.sin(t * 30) > 0.6) this.sparks.push({ x: d.x, y: d.y + 0.2, color: 0xff8a4a, up: 2.5 });
      if (act) { this.sparks.push({ x: d.x + (Math.sin(t * 91) * 0.3), y: d.y + 0.3, color: 0xffb070, up: 9 }); this.light(d.x, d.y + 1.5, 0.6, 0xff7a3a, 1.2); }
    });
  }

  // ───────────────────────── enemies ─────────────────────────
  skitter(d, i) {
    const S = C.skitter;
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    body.add(model((l) => {
      l.box(0, 0.36, 0, 1.2, 0.24, 0.6, PAL.steelDark);
      l.box(-0.05, 0.5, 0, 0.9, 0.08, 0.46, PAL.steel);
      l.box(0.5, 0.36, 0, 0.16, 0.3, 0.66, PAL.charcoal);
      l.box(-0.58, 0.36, 0, 0.1, 0.16, 0.2, PAL.charcoal);
      l.box(-0.2, 0.56, 0.1, 0.2, 0.06, 0.2, PAL.rust);
    }));
    const sensor = this.glow(PAL.amber);
    body.add(tinted((v) => { v.box(0.6, 0.38, 0, 0.05, 0.12, 0.56, 0xffffff); v.box(0.3, 0.55, 0.24, 0.3, 0.03, 0.03, 0xffffff); }, sensor));
    const legs = [];
    for (const side of [-1, 1]) for (const x of [-0.38, 0.02, 0.42]) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.34, side * 0.3);
      hip.add(model((l) => { l.box(0, 0.06, side * 0.14, 0.05, 0.05, 0.3, PAL.charcoalLight); l.box(0, -0.12, side * 0.28, 0.05, 0.42, 0.05, PAL.charcoal); l.box(0, -0.32, side * 0.28, 0.09, 0.05, 0.09, PAL.steelLight); }));
      body.add(hip);
      legs.push({ hip, side, ph: x * 4 + (side > 0 ? 0 : Math.PI) });
    }
    const cable = [];
    for (let k = 0; k < 6; k++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), MAT.lit);
      seg.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(72).fill(0.02), 3));
      g.add(seg); cable.push(seg);
    }
    this.at(g, d.x, d.y);
    let tilt = 0, drop = 0, walk = 0, lastX = d.x, dirS = 1;
    this.views.push((sim, t, dt) => {
      const e = sim.enemies[i];
      const st = e.state;
      walk += Math.abs(e.x - lastX) * 9; lastX = e.x;
      dirS = damp(dirS, e.dir, 14, dt);
      g.position.set(e.x, e.y, 0);
      body.scale.x = dirS >= 0 ? 1 : -1;
      const shake = st === 'alert' && !this.reduced ? Math.sin(t * 60) * 0.02 : 0;
      tilt = damp(tilt, st === 'alert' ? 0.28 : st === 'lunge' ? -0.12 : st === 'stunned' ? -0.2 : st === 'disabled' ? 0.24 : 0, 16, dt);
      drop = damp(drop, st === 'disabled' ? 0.17 : st === 'stunned' ? 0.1 : st === 'dormant' ? 0.07 : 0, 12, dt);
      body.rotation.z = tilt;
      body.position.set(shake, -drop, 0);
      for (const lg of legs) {
        const lift = st === 'stunned' ? 0.5 : st === 'disabled' ? 0.9 : 0;
        lg.hip.rotation.z = Math.sin(walk + lg.ph) * 0.35 * (lift ? 0 : 1);
        lg.hip.rotation.x = -lg.side * (lift + (st === 'stunned' ? Math.sin(t * 25 + lg.ph) * 0.08 : 0));
      }
      cable.forEach((seg, k) => {
        seg.position.set((-0.75 - k * 0.2) * (dirS >= 0 ? 1 : -1), 0.05 + Math.sin(t * 3 + k * 0.9) * 0.02, Math.sin(t * 2 + k * 0.7) * 0.06);
      });
      // state language: amber steady (patrol), fast red flash (alert/lunge), cyan flicker (stunned), dark (disabled)
      if (st === 'disabled') sensor.color.setHex(0x0a0c0e);
      else if (st === 'stunned') { sensor.color.setHex(PAL.cyan).multiplyScalar(Math.sin(t * 31) > 0 ? 0.9 : 0.25); if (Math.sin(t * 13) > 0.7) this.sparks.push({ x: e.x, y: e.y + 0.6, color: 0x7fe3ee, up: 2 }); }
      else if (st === 'alert') sensor.color.setHex(PAL.red).multiplyScalar(Math.sin(t * 40) > 0 ? 1.2 : 0.3);
      else if (st === 'lunge') sensor.color.setHex(0xff3d1e);
      else if (st === 'dormant') sensor.color.setHex(PAL.amber).multiplyScalar(0.25 + 0.1 * Math.sin(t * 1.5));
      else sensor.color.setHex(PAL.amber).multiplyScalar(st === 'recover' ? 0.5 : 0.95);
      if (st !== 'disabled') this.light(e.x, e.y + 0.6, 0.5, st === 'stunned' ? 0x7fe3ee : st === 'alert' || st === 'lunge' ? 0xff5a2e : 0xffb648, st === 'dormant' ? 0.15 : 0.5);
    });
    void S;
  }

  drone(d, i, sim0) {
    const D = C.drone;
    const g = new THREE.Group();
    g.add(model((l) => {
      l.box(0, 0, 0, 0.34, 0.62, 0.34, PAL.steel);
      l.box(0, 0, 0, 0.58, 0.34, 0.5, PAL.steelDark);
      l.box(0, 0, 0, 0.46, 0.46, 0.44, PAL.charcoalLight, Math.PI / 4);
      l.box(0, 0.36, 0, 0.16, 0.12, 0.16, PAL.charcoal);
    }));
    const lens = this.glow(PAL.cyan);
    const eye = new THREE.Group();
    eye.add(tinted((v) => { v.box(0.3, 0, 0.1, 0.1, 0.2, 0.2, 0xffffff); v.box(0, 0, 0.27, 0.2, 0.2, 0.04, 0xffffff); }, lens));
    g.add(eye);
    const plates = [0, 1, 2].map(() => { const p = model((l) => { l.box(0, 0, 0, 0.34, 0.07, 0.2, PAL.steelLight); l.box(0, -0.05, 0, 0.2, 0.03, 0.12, PAL.cyanDeep); }); g.add(p); return p; });
    this.at(g, d.ax, d.ay);
    const lineMat = this.add(PAL.amber, 0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lineMat);
    this.at(line, d.ax, d.ay, 0.15);
    // resting place for a disabled drone: the floor below its patrol
    let floorY = d.ay;
    for (let j = Math.floor(d.ay); j > 0; j--) if (sim0.solidAt(Math.floor(d.ax), j)) { floorY = j + 1.32; break; }
    let fall = 0, spin = 0;
    this.views.push((sim, t, dt) => {
      const e = sim.enemies[i];
      const st = e.state;
      fall = damp(fall, st === 'disabled' ? 1 : 0, 5, dt);
      const y = lerp(e.y + (st === 'disabled' ? 0 : Math.sin(t * 2.2) * 0.06), floorY - 1, fall);
      g.position.set(e.x, y, 0);
      g.rotation.z = fall * 0.5 + (st === 'stunned' ? Math.sin(t * 9) * 0.18 : 0);
      spin += dt * (st === 'stunned' ? 0.4 : st === 'disabled' ? 0 : st === 'aim' ? 6 : 1.8);
      plates.forEach((p, k) => {
        const a = spin + (k * Math.PI * 2) / 3;
        const rad = st === 'disabled' ? 0.4 : st === 'stunned' ? 0.72 : 0.62;
        p.position.set(Math.cos(a) * rad, (k - 1) * 0.16 - (st === 'stunned' ? 0.14 : 0) - fall * 0.2, Math.sin(a) * rad);
        p.rotation.y = -a; p.rotation.z = st === 'stunned' ? 0.5 : 0;
      });
      const aimAng = Math.atan2(e.aimY, e.aimX);
      eye.rotation.z = st === 'aim' || st === 'cooldown' ? aimAng : damp(eye.rotation.z, e.toB ? 0 : Math.PI, 6, dt);
      // lens: cyan (patrol) → amber (aim) → hot (locked); flicker when stunned; dark when disabled
      if (st === 'disabled') lens.color.setHex(0x0a0c0e);
      else if (st === 'stunned') lens.color.setHex(0xdffcff).multiplyScalar(Math.sin(t * 33) > 0 ? 0.8 : 0.15);
      else if (st === 'aim') lens.color.setHex(e.t <= D.aimLock ? 0xff5a2e : PAL.amber).multiplyScalar(e.t <= D.aimLock ? 1.3 : 0.8 + 0.2 * Math.sin(t * 30));
      else lens.color.setHex(PAL.cyan).multiplyScalar(st === 'cooldown' ? 0.5 : 0.95);
      if (st === 'stunned' && Math.sin(t * 15) > 0.75) this.sparks.push({ x: e.x, y: e.y, color: 0x7fe3ee, up: 1 });
      // narrow targeting line: flickers while tracking, solid once the direction is locked
      if (st === 'aim') {
        let len = 0;
        while (len < 14 && !sim.solidPoint(e.x + e.aimX * (len + 0.3), e.y + e.aimY * (len + 0.3))) len += 0.3;
        const locked = e.t <= D.aimLock;
        line.visible = true;
        line.position.set(e.x + (e.aimX * len) / 2, e.y + (e.aimY * len) / 2, 0.15);
        line.rotation.z = aimAng;
        line.scale.set(Math.max(0.01, len), locked ? 0.09 : 0.04, 1);
        lineMat.opacity = locked ? 0.95 : 0.3 + 0.25 * Math.sin(t * 40);
        lineMat.color.setHex(locked ? 0xff5a2e : PAL.amber);
      } else line.visible = false;
      if (st !== 'disabled') this.light(e.x, y, 0.6, st === 'aim' ? 0xffb648 : 0x7fe3ee, 0.5);
    });
  }

  sentinel(d, i) {
    const T = C.sentinel, dir = d.dir;
    const g = model((l) => {
      l.box(dir * 0.04, 0, -0.3, 0.1, 2.5, 2.0, PAL.charcoal);
      l.box(dir * 0.3, 0, -0.3, 0.5, 2.0, 1.5, PAL.steelDark);
      l.box(dir * 0.3, 1.08, -0.3, 0.6, 0.16, 1.6, PAL.steel);
      l.box(dir * 0.3, -1.08, -0.3, 0.6, 0.16, 1.6, PAL.steel);
      l.box(dir * 0.5, 0, -0.3, 0.12, 0.7, 1.0, PAL.black);
    });
    this.at(g, d.x, d.y);
    const core = this.glow(PAL.redDim);
    g.add(tinted((v) => { v.box(dir * 0.58, 0, -0.3, 0.1, 0.5, 0.8, 0xffffff); v.box(dir * 0.62, 0, 0.12, 0.06, 0.3, 0.06, 0xffffff); }, core));
    const lamp = this.glow(PAL.redDim);
    g.add(tinted((v) => { v.box(dir * 0.3, 1.24, 0.2, 0.3, 0.16, 0.3, 0xffffff); }, lamp));
    const panels = [1, -1].map((s) => {
      const p = model((l) => { l.box(dir * 0.68, 0, -0.3, 0.16, 0.42, 1.24, PAL.steelLight); l.box(dir * 0.77, 0, -0.3, 0.04, 0.3, 1.0, PAL.steel); l.box(dir * 0.68, -s * 0.19, -0.3, 0.2, 0.05, 1.28, PAL.amberDeep); });
      g.add(p); return { p, s };
    });
    const laneMat = this.add(0xff3d1e, 0);
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), laneMat);
    this.at(lane, d.x, d.y, 0.12);
    const beamMat = this.add(0xff6a2e, 0);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1, T.laneHalf * 2, 0.5), beamMat);
    this.at(beam, d.x, d.y, 0.05);
    const hotMat = this.add(0xfff0d0, 0);
    const hot = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 0.2), hotMat);
    this.at(hot, d.x, d.y, 0.12);
    let open = 0;
    this.views.push((sim, t, dt) => {
      const e = sim.enemies[i];
      const st = e.state;
      open = damp(open, st === 'venting' ? 1 : st === 'disabled' ? 0.55 : 0, 10, dt);
      for (const { p, s } of panels) { p.position.y = s * (0.21 + open * 0.42); p.rotation.z = st === 'disabled' ? s * 0.12 : 0; }
      const len = Math.max(0.01, e.laneX1 - e.laneX0), mid = (e.laneX0 + e.laneX1) / 2;
      lane.visible = st === 'warning';
      beam.visible = hot.visible = st === 'firing';
      if (st === 'warning') {
        lane.position.x = mid; lane.scale.set(len, 0.05 + 0.5 * (e.t / T.warning) * (T.laneHalf * 2 - 0.05) * 0.2, 1);
        laneMat.opacity = Math.sin(t * 26) > 0 ? 0.85 : 0.25;
      }
      if (st === 'firing') {
        beam.position.x = mid; beam.scale.x = len; hot.position.x = mid; hot.scale.x = len;
        beamMat.opacity = 0.55 + 0.15 * Math.sin(t * 60); hotMat.opacity = 0.9;
        this.light(mid, d.y, 0.8, 0xff6a2e, 1.6);
      }
      if (st === 'disabled') { core.color.setHex(0x120a08); lamp.color.setHex(0x0a0c0e); }
      else {
        mix(core, PAL.redDim, st === 'venting' ? 0xffb080 : PAL.red, st === 'venting' ? 0.8 + 0.2 * Math.sin(t * 12) : st === 'firing' ? 1 : st === 'warning' ? 0.6 : 0.3);
        mix(lamp, PAL.redDim, PAL.red, st === 'warning' ? (Math.sin(t * 26) > 0 ? 1 : 0.1) : st === 'firing' ? 1 : 0.15);
        if (st === 'venting') { if (Math.sin(t * 24) > 0.3) this.sparks.push({ x: d.x + dir * 0.8, y: d.y + (Math.sin(t * 77) * 0.3), color: 0xd0d8e0, up: 1.5 }); this.light(d.x + dir, d.y, 0.6, 0xff8a4a, 0.9); }
      }
    });
  }

  boltPool() {
    const mat = this.glow(0xffc070);
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const pool = [];
    for (let k = 0; k < 12; k++) { const m = new THREE.Mesh(geo, mat); m.visible = false; this.root.add(m); pool.push(m); }
    this.views.push((sim, t) => {
      pool.forEach((m, k) => {
        const b = sim.bolts[k];
        m.visible = !!b;
        if (!b) return;
        m.position.set(b.x, b.y, 0.1);
        m.rotation.set(t * 9, t * 7, Math.PI / 4);
        this.light(b.x, b.y, 0.5, 0xffb060, 0.7);
        this.sparks.push({ x: b.x, y: b.y, color: 0xffb060, up: 0, trail: true });
      });
    });
  }

  // ───────────────────────── discoveries ─────────────────────────
  archive(d, i) {
    const g = model((l) => {
      l.box(0, 0.25, -1.2, 0.6, 0.5, 0.6, PAL.steelDark);
      l.box(0, 0.54, -1.2, 0.76, 0.08, 0.76, PAL.steel);
      l.box(0, 0.05, -1.2, 0.8, 0.1, 0.8, PAL.charcoal);
    });
    this.at(g, d.x, d.y);
    const mat = this.glow(PAL.cyan);
    const cube = tinted((v) => { v.box(0, 0, 0, 0.3, 0.3, 0.3, 0xffffff); v.box(0, 0, 0, 0.42, 0.06, 0.42, 0xffffff); v.box(0, 0, 0, 0.06, 0.46, 0.06, 0xffffff); }, mat);
    cube.position.set(0, 1.05, -1.2);
    g.add(cube);
    const beaconMat = this.add(PAL.cyan, 0);
    const beacon = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.2), beaconMat);
    beacon.position.set(0, 1.4, -1.1);
    g.add(beacon);
    this.views.push((sim, t) => {
      const a = sim.archives[i];
      cube.visible = !a.collected;
      const rev = clamp01(a.reveal);
      cube.rotation.set(t * 0.6, t * 0.9, 0);
      cube.position.y = 1.05 + Math.sin(t * 1.5) * 0.06;
      cube.scale.setScalar(1 + rev * 0.3 * (0.6 + 0.4 * Math.sin(t * 9)));
      mat.color.setHex(PAL.cyan).multiplyScalar(0.75 + 0.25 * Math.sin(t * 2.4));
      beaconMat.opacity = a.collected ? 0 : 0.1 + rev * 0.3;
      if (!a.collected) this.light(d.x, d.y + 1, 0, 0x7fe3ee, 0.6 + rev * 0.6);
    });
  }

  cache(d, i) {
    const g = model((l) => {
      l.box(0, 0.24, -1.1, 0.8, 0.48, 0.6, PAL.bronzeDark);
      l.box(-0.3, 0.24, -1.1, 0.08, 0.5, 0.62, PAL.steel); l.box(0.3, 0.24, -1.1, 0.08, 0.5, 0.62, PAL.steel);
    });
    this.at(g, d.x, d.y);
    const lid = new THREE.Group();
    lid.position.set(0, 0.48, -1.4);
    lid.add(model((l) => { l.box(0, 0.06, 0.3, 0.84, 0.12, 0.64, PAL.bronze); l.box(0, 0.13, 0.3, 0.3, 0.04, 0.3, PAL.steelLight); }));
    g.add(lid);
    const mat = this.glow(PAL.cyan);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.03), mat);
    lamp.position.set(0, 0.3, -0.78);
    g.add(lamp);
    let k = 0;
    this.views.push((sim, t, dt) => {
      const c = sim.caches[i];
      k = damp(k, c.collected ? 1 : 0, 9, dt);
      lid.rotation.x = -k * 1.5;
      mat.color.setHex(PAL.cyan).multiplyScalar(c.collected ? 0.06 : 0.6 + 0.4 * Math.sin(t * 3));
      if (!c.collected) this.light(d.x, d.y + 0.6, 0, 0x7fe3ee, 0.35);
    });
  }
}

void Vox; void h2;
