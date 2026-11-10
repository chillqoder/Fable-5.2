// DEEPWAKE — ILO: voxel model with explicit shoulder / elbow / hip / knee / ankle pivots.
// Purely presentational: every pose is derived from simulation state and never feeds back.

import * as THREE from 'three';
import { Vox, MAT, PAL, glowMat, damp, clamp01 } from './vox.js';

const HIP = 0.56;
const YAW = 0.7;    // three-quarter turn so the face panel and lens stay readable from the side

function part(fn) { const v = new Vox(); fn(v); return v.mesh(MAT.lit); }
function pivot(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

export class IloView {
  constructor() {
    this.root = new THREE.Group();
    this.body = pivot(this.root, 0, 0, 0);
    this.owned = [];
    const C = PAL;

    // legs
    this.legs = [-1, 1].map((side) => {
      const hip = pivot(this.body, side * 0.13, HIP, 0);
      hip.add(part((v) => { v.box(0, -0.12, 0, 0.09, 0.24, 0.1, C.charcoal); v.box(0, 0, 0, 0.12, 0.1, 0.12, C.charcoalLight); }));
      const knee = pivot(hip, 0, -0.24, 0);
      knee.add(part((v) => { v.box(0, -0.11, 0, 0.08, 0.22, 0.09, C.ceramicShade); v.box(0, 0, 0.01, 0.11, 0.1, 0.12, C.charcoalLight); }));
      const ankle = pivot(knee, 0, -0.22, 0);
      ankle.add(part((v) => {
        v.box(0, -0.05, 0.06, 0.2, 0.1, 0.32, C.charcoal);          // oversized magnetic foot
        v.box(0, -0.035, 0.2, 0.2, 0.07, 0.08, C.ceramic);          // pale toe cap
        v.box(0, -0.09, 0.06, 0.22, 0.03, 0.34, C.steelDark);       // magnetic sole
        v.box(0, 0.01, -0.02, 0.1, 0.06, 0.1, C.charcoalLight);
      }));
      return { hip, knee, ankle };
    });

    // torso
    this.torso = pivot(this.body, 0, HIP, 0);
    this.torso.add(part((v) => {
      v.box(0, 0.0, 0, 0.34, 0.08, 0.24, C.charcoal);
      v.box(0, 0.2, 0, 0.4, 0.32, 0.28, C.ceramic);
      v.box(0, 0.33, 0, 0.34, 0.06, 0.24, C.ceramicShade);
      v.box(0, 0.2, 0.135, 0.22, 0.22, 0.03, C.charcoal);          // chest frame
      v.box(0, 0.2, -0.17, 0.26, 0.24, 0.08, C.charcoal);          // back unit
      v.box(-0.21, 0.2, 0, 0.03, 0.2, 0.2, C.ceramicShade);
      v.box(0.21, 0.2, 0, 0.03, 0.2, 0.2, C.ceramicShade);
    }));
    this.chestMat = glowMat(C.cyan);
    this.owned.push(this.chestMat);
    this.chest = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.04), this.chestMat);
    this.owned.push(this.chest.geometry);
    this.chest.position.set(0, 0.2, 0.155);
    this.torso.add(this.chest);

    // head: chamfered rectangular ceramic shell, dark face panel, one offset amber lens
    this.head = pivot(this.torso, 0, 0.38, 0);
    this.head.add(part((v) => {
      v.box(0, 0.02, 0, 0.1, 0.06, 0.1, C.charcoal);
      v.box(0, 0.23, 0, 0.56, 0.28, 0.42, C.ceramic);
      v.box(0, 0.395, 0, 0.46, 0.05, 0.34, C.ceramic);
      v.box(0, 0.07, 0, 0.46, 0.05, 0.34, C.ceramicShade);
      v.box(0, 0.23, 0.2, 0.46, 0.22, 0.05, C.black);              // face panel
      v.box(0.11, 0.24, 0.228, 0.2, 0.2, 0.02, C.charcoalLight);   // lens ring
      v.box(-0.29, 0.23, 0, 0.03, 0.12, 0.12, C.ceramicShade);     // side sensor discs
      v.box(0.29, 0.23, 0, 0.03, 0.12, 0.12, C.ceramicShade);
      v.box(0, 0.36, 0.21, 0.5, 0.03, 0.03, C.ceramicShade);       // brow ridge
      v.box(-0.12, 0.19, 0.228, 0.1, 0.02, 0.01, C.charcoalLight);
      v.box(-0.12, 0.25, 0.228, 0.06, 0.02, 0.01, C.charcoalLight);
    }));
    this.lensMat = glowMat(C.amber);
    this.owned.push(this.lensMat);
    this.lens = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.05), this.lensMat);
    this.owned.push(this.lens.geometry);
    this.lens.position.set(0.11, 0.24, 0.245);
    this.head.add(this.lens);
    this.antenna = pivot(this.head, -0.17, 0.42, -0.06);
    this.antenna.add(part((v) => { v.box(0, 0.08, 0, 0.03, 0.16, 0.03, C.charcoal); }));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), this.lensMat);
    this.owned.push(tip.geometry);
    tip.position.set(0, 0.18, 0);
    this.antenna.add(tip);

    // arms
    this.arms = [-1, 1].map((side) => {
      const shoulder = pivot(this.torso, side * 0.255, 0.3, 0);
      shoulder.add(part((v) => { v.box(0, 0, 0, 0.1, 0.1, 0.12, C.charcoalLight); v.box(0, -0.12, 0, 0.08, 0.2, 0.08, C.ceramicShade); }));
      const elbow = pivot(shoulder, 0, -0.22, 0);
      elbow.add(part((v) => { v.box(0, 0, 0, 0.09, 0.08, 0.09, C.charcoalLight); v.box(0, -0.1, 0, 0.07, 0.18, 0.07, C.charcoal); v.box(0, -0.22, 0, 0.11, 0.1, 0.11, C.ceramic); }));
      return { shoulder, elbow, side };
    });

    // short utility cape, hanging behind one shoulder (never covers the feet)
    this.cape = [];
    let parent = pivot(this.torso, -0.1, 0.34, -0.2);
    for (let k = 0; k < 3; k++) {
      parent.add(part((v) => { v.box(0, -0.085, 0, 0.26 - k * 0.03, 0.17, 0.025, k === 2 ? 0x8f4322 : PAL.rust); }));
      this.cape.push(parent);
      parent = pivot(parent, 0, -0.17, 0);
    }

    this.pose = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, ankL: 0, ankR: 0, shL: 0, shR: 0, shZ: 0.06, elL: -0.15, elR: -0.15, lean: 0, headPitch: 0, headYaw: 0, bodyY: 0, squash: 1, cape: 0.15 };
    this.yaw = YAW;
    this.lensColor = new THREE.Color(PAL.amber);
    this.cyan = new THREE.Color(PAL.cyan);
    this.tmp = new THREE.Color();
    this.carryY = 0;
  }

  /** @returns {{x:number,y:number}} world position of the carried cell (above the head, hands raised) */
  carryPoint(p) { return { x: p.x, y: p.y + 1.56 + this.pose.bodyY }; }

  update(sim, t, dt, reduced) {
    const p = sim.player, P = this.pose;
    const q = {};   // target pose
    const speed = Math.abs(p.vx), run = clamp01(speed / 6.5);
    const carrying = p.carry !== null;
    const state = sim.state;
    let lambda = 18;
    let lensLevel = 1;

    // defaults: idle scan
    q.hipL = 0; q.hipR = 0; q.kneeL = 0.04; q.kneeR = 0.04; q.ankL = 0; q.ankR = 0;
    q.shL = 0.05; q.shR = 0.05; q.shZ = 0.07; q.elL = -0.18; q.elR = -0.18;
    q.lean = 0.02; q.headPitch = Math.sin(t * 0.9) * 0.04; q.headYaw = Math.sin(t * 0.55) * 0.45;
    q.bodyY = Math.sin(t * 2.1) * 0.008; q.squash = 1; q.cape = 0.12 + Math.sin(t * 1.7) * 0.04;

    if (state === 'shutdown') {
      const k = clamp01(1 - sim.stateT / 0.9);
      q.hipL = q.hipR = -1.25 * k; q.kneeL = q.kneeR = 1.7 * k; q.lean = 0.75 * k; q.headPitch = 0.7 * k; q.headYaw = 0;
      q.shL = q.shR = 0.25 * k; q.elL = q.elR = -0.1; q.bodyY = -0.02 * k; lensLevel = 1 - k; lambda = 14;
    } else if (state === 'reboot') {
      const k = clamp01(sim.stateT / 0.9);   // 1 → 0 as ILO stands back up
      q.hipL = q.hipR = -1.25 * k; q.kneeL = q.kneeR = 1.7 * k; q.lean = 0.75 * k; q.headPitch = 0.7 * k; q.headYaw = 0;
      lensLevel = (1 - k) * (Math.sin(t * 40) > -0.3 ? 1 : 0.25); lambda = 12;
    } else if (p.dashT > 0) {
      q.lean = 1.05; q.hipL = 0.55; q.hipR = 0.3; q.kneeL = 0.25; q.kneeR = 0.5; q.shL = 1.0; q.shR = 0.8; q.elL = q.elR = -0.1;
      q.headPitch = -0.75; q.headYaw = 0; q.cape = 1.35; lambda = 40;
    } else if (p.hurtT < 0.28) {
      q.lean = -0.45; q.shL = q.shR = -1.0; q.shZ = 1.0; q.hipL = -0.5; q.hipR = 0.3; q.kneeL = 0.6; q.kneeR = 0.4; q.headPitch = -0.3; q.headYaw = 0; lambda = 35;
    } else if (state === 'relayActivation') {
      q.shR = -2.5; q.elR = -0.2; q.headPitch = -0.38; q.headYaw = 0.2; q.shL = 0.1; q.lean = -0.05;
    } else if (p.wallSliding) {
      q.shR = -2.7; q.shL = -0.6; q.elL = -0.9; q.elR = -0.2; q.hipL = -1.0; q.kneeL = 1.3; q.hipR = -0.45; q.kneeR = 0.9;
      q.lean = -0.12; q.headPitch = 0.25; q.headYaw = -0.5; q.cape = 0.6;
    } else if (!p.grounded) {
      q.headYaw = 0;
      if (p.vy > 1) {            // takeoff / ascent
        const early = p.airT < 0.09;
        q.hipL = early ? 0.1 : -0.65; q.kneeL = early ? 0.05 : 1.0; q.hipR = early ? 0.2 : 0.2; q.kneeR = early ? 0.05 : 0.5;
        q.ankL = early ? 0.5 : 0.2; q.ankR = 0.5;
        q.shL = q.shR = early ? 0.5 : -0.5; q.shZ = 0.35; q.elL = q.elR = -0.5; q.lean = 0.1; q.headPitch = -0.15; q.cape = 0.5;
      } else {                   // falling
        q.hipL = -0.3; q.kneeL = 0.35; q.hipR = 0.25; q.kneeR = 0.45; q.shL = q.shR = -2.2; q.shZ = 0.55; q.elL = q.elR = -0.3;
        q.lean = -0.06; q.headPitch = 0.2; q.cape = -0.9;
      }
      if (p.steerLock > 0) { q.hipL = 0.6; q.hipR = 0.3; q.kneeL = 0.15; q.kneeR = 0.3; q.shL = q.shR = -1.2; q.lean = 0.35; lambda = 30; }
    } else if (speed > 0.4) {
      const ph = p.walkDist * 4.2, amp = 0.45 + 0.55 * run;
      const s = Math.sin(ph);
      q.hipL = -s * 0.8 * amp; q.hipR = s * 0.8 * amp;
      q.kneeL = Math.max(0, Math.sin(ph + 1.0)) * 1.1 * amp + 0.08; q.kneeR = Math.max(0, Math.sin(ph + 1.0 + Math.PI)) * 1.1 * amp + 0.08;
      q.ankL = -q.hipL * 0.3; q.ankR = -q.hipR * 0.3;
      q.shL = s * 0.7 * amp; q.shR = -s * 0.7 * amp; q.elL = q.elR = -0.35 - 0.45 * run;
      q.lean = 0.07 + 0.16 * run; q.bodyY = Math.abs(Math.cos(ph)) * 0.035 * amp; q.headYaw = 0; q.headPitch = -0.05 * run;
      q.cape = 0.25 + 0.7 * run; lambda = 26;
    }
    if (state === 'liftSequence') {
      if (sim.liftPhase === 'rise' || sim.liftPhase === 'barrier' || sim.liftPhase === 'arrive') { q.headPitch = -0.45; q.headYaw = 0.25; }
      else if (sim.liftPhase === 'rest') { q.headPitch = -0.12; q.headYaw = 0.1; q.shR = -0.3; }
    }
    if (p.grounded && p.landT < 0.16 && state === 'play') {   // landing compression
      const k = 1 - p.landT / 0.16;
      q.squash = 1 - 0.13 * k; q.kneeL += 0.7 * k; q.kneeR += 0.7 * k; q.hipL -= 0.4 * k; q.hipR -= 0.4 * k; q.lean += 0.1 * k; lambda = 40;
    }
    if (p.pulseT < 0.32) {                                      // pulse emission
      q.shL = q.shR = -0.5; q.shZ = 1.25; q.elL = q.elR = -0.2; q.headPitch = -0.22; q.lean = -0.08; lambda = 30;
    }
    if (carrying) {                                             // lifting / carrying a cell overhead
      q.shL = q.shR = -2.95; q.shZ = 0.2; q.elL = q.elR = -0.12; q.headPitch = Math.min(q.headPitch, -0.05); q.headYaw = 0;
    } else if (p.actT < 0.24) {                                 // socket / switch interaction
      q.shR = -1.35; q.elR = -0.5; q.lean += 0.28; q.kneeL += 0.35; q.kneeR += 0.35; q.hipL -= 0.2; q.hipR -= 0.2; q.headPitch = 0.2;
    }

    for (const k in q) P[k] = damp(P[k], q[k], lambda, dt);

    // apply
    const face = state === 'liftSequence' && sim.liftPhase !== 'walk' && sim.liftPhase !== 'rest' ? 0.3 : p.facing * YAW;
    this.yaw = damp(this.yaw, face, 16, dt);
    this.root.position.set(p.x, p.y, 0);
    this.body.rotation.set(P.lean, this.yaw, 0, 'YXZ');
    this.body.position.y = P.bodyY - (1 - P.squash) * 0.2;
    this.body.scale.set(1 + (1 - P.squash) * 0.5, P.squash, 1 + (1 - P.squash) * 0.5);
    const [L, R] = this.legs;
    L.hip.rotation.x = P.hipL; L.knee.rotation.x = P.kneeL; L.ankle.rotation.x = P.ankL - P.lean * 0.5;
    R.hip.rotation.x = P.hipR; R.knee.rotation.x = P.kneeR; R.ankle.rotation.x = P.ankR - P.lean * 0.5;
    const [AL, AR] = this.arms;
    AL.shoulder.rotation.set(P.shL, 0, -P.shZ); AL.elbow.rotation.x = P.elL;
    AR.shoulder.rotation.set(P.shR, 0, P.shZ); AR.elbow.rotation.x = P.elR;
    this.head.rotation.set(P.headPitch - P.lean * 0.6, P.headYaw * 0.6, 0);
    this.antenna.rotation.x = -0.25 - clamp01(run) * 0.5 + Math.sin(t * 5.3) * 0.06 - p.vy * 0.02;
    this.antenna.rotation.z = Math.sin(t * 3.1) * 0.08;
    for (let k = 0; k < 3; k++) this.cape[k].rotation.x = P.cape * (0.5 + k * 0.3) + Math.sin(t * 6 + k) * 0.05 * (0.3 + run);

    // lens and chest module: constant identity lights in the dark
    this.lensMat.color.copy(this.lensColor).multiplyScalar(0.15 + 0.85 * lensLevel);
    const e = clamp01(p.energy / 100);
    const pulseGlow = p.pulseT < 0.4 ? 1.6 - p.pulseT * 2 : 0;
    this.tmp.copy(this.cyan).multiplyScalar((0.3 + 0.7 * e) * (0.9 + 0.1 * Math.sin(t * 3)) * lensLevel + pulseGlow);
    this.chestMat.color.copy(this.tmp);
    const cs = 1 + (p.pulseT < 0.3 ? (0.3 - p.pulseT) * 2.4 : 0);
    this.chest.scale.set(cs, cs, 1);

    // contact-immunity blink (slower when reduced motion is on)
    let visible = true;
    if (p.immune > 0 && state === 'play') visible = Math.sin(t * (reduced ? 14 : 44)) > -0.35;
    this.body.visible = visible;
  }

  dispose() { for (const o of this.owned) o.dispose(); this.root.traverse((o) => { if (o.isMesh && o.material === MAT.lit) o.geometry.dispose(); }); }
}
