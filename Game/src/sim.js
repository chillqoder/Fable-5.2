// DEEPWAKE — authoritative simulation.
// No DOM, no rendering, no audio. Runs identically in the browser and in Node checks.
// Fixed step: call step(input) once per 1/120 s while the expedition is not paused.

import { C, DT } from './config.js';
import { buildLevel, W, H, regionAt } from './level.js';

const HW = C.bodyW / 2;
const PH = C.bodyH;
const EPS = 1e-6;

const approach = (v, target, d) => (v < target ? Math.min(v + d, target) : Math.max(v - d, target));
const smooth = (k) => { const t = Math.min(1, Math.max(0, k)); return t * t * (3 - 2 * t); };

export const NO_INPUT = Object.freeze({
  left: false, right: false, jumpHeld: false, jumpPressed: false,
  dashPressed: false, pulsePressed: false, interactPressed: false, retryPressed: false,
});

function segHitsRect(x0, y0, x1, y1, rx0, ry0, rx1, ry1) {
  // Liang–Barsky segment vs AABB
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, x0 - rx0) && clip(dx, rx1 - x0) && clip(-dy, y0 - ry0) && clip(dy, ry1 - y0) && t0 < t1;
}

export class Sim {
  constructor(level = buildLevel()) {
    this.level = level;
    this.grid = level.grid;
    this.events = [];
    this.reset();
  }

  // ───────────────────────── lifecycle ─────────────────────────

  /** Full restart: a fresh world. Records and settings live outside the sim. */
  reset() {
    this.state = 'play';
    this.stateT = 0;
    this.time = 0;          // active expedition clock (seconds)
    this.tick = 0;
    this.recoveries = 0;
    this.result = null;
    this.resultCommits = 0;
    this.focus = null;      // optional camera focus point during relay activation
    this.liftPhase = null;
    this.events.length = 0;
    this.buildWorld();
    this.spawnPlayer(this.level.start.x, this.level.start.y);
    const st = this.stations.find((s) => s.id === this.level.start.station);
    st.inside = true; st.lit = true;
    this.snapshot = null;
    this.commit(st.id);
    this.region = regionAt(this.player.x);
    this.emit('reset');
  }

  emit(type, data) {
    if (this.events.length < 256) this.events.push(data ? { type, ...data } : { type });
  }

  buildWorld() {
    const L = this.level;
    this.relays = L.relays.map((r) => ({ ...r, active: false }));
    this.sockets = L.sockets.map((s) => ({ ...s, cell: null }));
    this.cells = L.cells.map((c) => ({ id: c.id, x: c.x, y: c.y, state: 'loose', socket: null }));
    this.switches = L.switches.map((s) => ({ ...s, on: false }));
    this.seams = L.seams.map((s) => ({ ...s, kind: 'seam', broken: false, reveal: 0, solid: true }));
    this.doors = L.doors.map((d) => ({
      id: d.id, kind: 'door', style: d.style, when: d.when, baseY: d.y0, h: d.h,
      x0: d.x, x1: d.x + 1, y0: d.y0, y1: d.y0 + d.h, open: 0, solid: true, target: 0,
    }));
    this.movers = L.movers.map((m) => {
      const u = m.park === 'b' ? 1 : 0;
      const mv = { ...m, u, phase: 0, pt: 0, wasPowered: false, x: 0, y: 0, vx: 0, vy: 0, solid: true, stalled: false };
      this.placeMover(mv, m.ax + (m.bx - m.ax) * u, m.ay + (m.by - m.ay) * u);
      return mv;
    });
    const ml = L.mainLift;
    this.mainLift = {
      ...ml, kind: 'mainlift', yTop: ml.y, barrier: 0, moving: false, solid: true,
      x0: ml.x - ml.w / 2, x1: ml.x + ml.w / 2, y0: ml.y - ml.h, y1: ml.y,
    };
    const pr = L.press;
    this.press = { ...pr, kind: 'press', phase: 'wait', t: 0, y0: pr.upY, y1: pr.top, solid: true };
    this.vents = L.vents.map((v) => ({ ...v, phase: 'dormant', t: -v.offset, awake: false }));
    this.enemies = L.enemies.map((e) => this.makeEnemy(e));
    this.archives = L.archives.map((a) => ({ ...a, collected: false, reveal: 0 }));
    this.caches = L.caches.map((c) => ({ ...c, collected: false }));
    this.stations = L.stations.map((s) => ({ ...s, lit: false, inside: false }));
    this.conduitReveal = {};
    for (const c of L.conduits) this.conduitReveal[c.id] = 0;
    this.bolts = [];
    this.pulses = [];
    this.target = null;
    this.pulseHint = null;
    this.hint = null;
    this.dyn = [...this.seams, ...this.doors, ...this.movers, this.mainLift, this.press];
    this.byId = new Map();
    for (const list of [this.relays, this.sockets, this.cells, this.switches, this.seams, this.doors, this.movers, this.enemies, this.archives, this.caches, this.stations]) {
      for (const o of list) this.byId.set(o.id, o);
    }
  }

  makeEnemy(e) {
    if (e.kind === 'skitter') {
      return { ...e, state: 'dormant', t: 0, disabled: false, range: e.range || [e.zone[0] + 7, e.zone[2] - 5.7] };
    }
    if (e.kind === 'drone') {
      return { ...e, x: e.ax, y: e.ay, toB: true, state: 'patrol', t: 0, cd: 0, aimX: 1, aimY: 0, disabled: false };
    }
    return { ...e, state: 'closed', t: 0, laneX0: e.x, laneX1: e.x, disabled: false };
  }

  spawnPlayer(x, y) {
    this.player = {
      x, y, vx: 0, vy: 0, facing: 1,
      grounded: true, ground: { id: 'tile', type: 1 },
      wallDir: 0, lastWallDir: 0, wallSliding: false, wallCoyote: 0,
      coyote: 0, jumpBuf: 0, varJump: false, steerLock: 0,
      dashT: 0, dashDir: 1, dashCd: 0, dashAvail: true, dashedThisStep: false,
      carry: null,
      integrity: C.integrityMax, energy: C.energyMax, regenDelay: 0, pulseCd: 0,
      immune: 0, crushT: 0,
      // presentation timers (seconds since event; do not influence collisions)
      walkDist: 0, lastStepDist: 0, landT: 9, pulseT: 9, hurtT: 9, shieldT: 9, actT: 9, denyT: 9, airT: 0,
    };
  }

  // ───────────────────────── queries ─────────────────────────

  powered(key) {
    if (!key || key === 'always') return true;
    const k = key.charCodeAt(0);
    const id = key.slice(key.indexOf(':') + 1);
    const o = this.byId.get(id);
    if (!o) return false;
    if (k === 114) return o.active === true;      // relay:
    if (k === 115 && key[1] === 'o') return o.cell !== null; // socket:
    return o.on === true;                         // switch:
  }

  solidAt(i, j) {
    if (i < 0 || j < 0 || i >= W || j >= H) return true;
    return this.grid[j * W + i] !== 0;
  }

  tileAt(i, j) {
    if (i < 0 || j < 0 || i >= W || j >= H) return 1;
    return this.grid[j * W + i];
  }

  rectHitsTiles(x0, y0, x1, y1) {
    const i0 = Math.floor(x0 + EPS), i1 = Math.floor(x1 - EPS);
    const j0 = Math.floor(y0 + EPS), j1 = Math.floor(y1 - EPS);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.solidAt(i, j)) return true;
    return false;
  }

  rectHitsDyn(x0, y0, x1, y1, except = null) {
    for (const d of this.dyn) {
      if (!d.solid || d === except) continue;
      if (x0 < d.x1 - EPS && x1 > d.x0 + EPS && y0 < d.y1 - EPS && y1 > d.y0 + EPS) return d;
    }
    return null;
  }

  solidPoint(x, y) {
    if (this.solidAt(Math.floor(x), Math.floor(y))) return true;
    for (const d of this.dyn) if (d.solid && x > d.x0 && x < d.x1 && y > d.y0 && y < d.y1) return true;
    return false;
  }

  playerBlocked(except = null) {
    const p = this.player;
    return this.rectHitsTiles(p.x - HW, p.y, p.x + HW, p.y + PH)
      || this.rectHitsDyn(p.x - HW, p.y, p.x + HW, p.y + PH, except) !== null;
  }

  playerOverlaps(x0, y0, x1, y1) {
    const p = this.player;
    return p.x - HW < x1 - EPS && p.x + HW > x0 + EPS && p.y < y1 - EPS && p.y + PH > y0 + EPS;
  }

  /** Deterministic line of sight. Thick walls, doors and the press block; seams and platforms do not. */
  los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.1));
    for (let k = 1; k < n; k++) {
      if (this.solidAt(Math.floor(x0 + (dx * k) / n), Math.floor(y0 + (dy * k) / n))) return false;
    }
    for (const d of this.doors) {
      if (d.solid && segHitsRect(x0, y0, x1, y1, d.x0, d.y0, d.x1, d.y1)) return false;
    }
    const pr = this.press;
    if (segHitsRect(x0, y0, x1, y1, pr.x0, pr.y0, pr.x1, pr.y1)) return false;
    return true;
  }

  get archivesFound() { return this.archives.filter((a) => a.collected).length; }
  get cachesFound() { return this.caches.filter((c) => c.collected).length; }
  get machinesDisabled() { return this.enemies.filter((e) => e.disabled).length; }
  get relaysActive() { return this.relays.filter((r) => r.active).length; }

  // ───────────────────────── checkpoints ─────────────────────────

  /** Atomically commit the persistent world state at a station. */
  commit(stationId) {
    const st = this.byId.get(stationId);
    const snap = {
      station: stationId,
      relays: this.relays.filter((r) => r.active).map((r) => r.id),
      switches: this.switches.filter((s) => s.on).map((s) => s.id),
      seams: this.seams.filter((s) => s.broken).map((s) => s.id),
      disabled: this.enemies.filter((e) => e.disabled).map((e) => e.id),
      archives: this.archives.filter((a) => a.collected).map((a) => a.id),
      caches: this.caches.filter((c) => c.collected).map((c) => c.id),
      lit: this.stations.filter((s) => s.lit || s.id === stationId).map((s) => s.id),
      cells: this.cells.map((c) => {
        if (c.state === 'socket') return { id: c.id, state: 'socket', socket: c.socket };
        // A carried cell is committed resting beside the station (snapshot-safe).
        if (c.state === 'carried') return { id: c.id, state: 'loose', x: st.x - 1, y: st.y };
        return { id: c.id, state: 'loose', x: c.x, y: c.y };
      }),
    };
    this.snapshot = JSON.stringify(snap);
    this.checkpointId = stationId;
  }

  /** Restore the committed snapshot. Run time and recovery count are not rolled back. */
  restore() {
    const s = JSON.parse(this.snapshot);
    this.buildWorld();
    for (const id of s.relays) this.byId.get(id).active = true;
    for (const id of s.switches) this.byId.get(id).on = true;
    for (const id of s.seams) { const m = this.byId.get(id); m.broken = true; m.solid = false; }
    for (const id of s.disabled) { const e = this.byId.get(id); e.disabled = true; e.state = 'disabled'; }
    for (const id of s.archives) this.byId.get(id).collected = true;
    for (const id of s.caches) this.byId.get(id).collected = true;
    for (const id of s.lit) this.byId.get(id).lit = true;
    for (const c of s.cells) {
      const cell = this.byId.get(c.id);
      if (c.state === 'socket') {
        const so = this.byId.get(c.socket);
        cell.state = 'socket'; cell.socket = so.id; cell.x = so.x; cell.y = so.y; so.cell = cell.id;
      } else { cell.state = 'loose'; cell.socket = null; cell.x = c.x; cell.y = c.y; }
    }
    // Derived machinery settles instantly into its snapshot-safe pose.
    for (const d of this.doors) {
      d.open = this.powered(d.when) ? 1 : 0;
      d.target = d.open; d.y0 = d.baseY + d.open * d.h; d.solid = d.open < 0.999;
    }
    for (const m of this.movers) {
      if (this.powered(m.when)) { m.wasPowered = true; m.phase = 0; m.pt = 0; m.u = 0; }
      else { m.wasPowered = false; m.u = m.park === 'b' ? 1 : 0; }
      this.placeMover(m, m.ax + (m.bx - m.ax) * m.u, m.ay + (m.by - m.ay) * m.u);
    }
    const st = this.byId.get(s.station);
    this.spawnPlayer(st.x, st.y);
    this.player.immune = C.rebootImmunity;
    st.inside = true;
    this.focus = null;
    this.region = regionAt(this.player.x);
    this.emit('restored', { station: st.id });
  }

  beginShutdown(cause) {
    if (this.state !== 'play') return false;
    this.state = 'shutdown';
    this.stateT = cause === 'retry' ? C.retryShutdownTime : C.shutdownTime;
    this.recoveries += 1;
    this.shutdownCause = cause;
    const p = this.player;
    p.vx = 0; p.vy = 0; p.dashT = 0;
    this.emit('shutdown', { cause });
    return true;
  }

  // ───────────────────────── main step ─────────────────────────

  step(inp = NO_INPUT) {
    this.tick++;
    switch (this.state) {
      case 'play':
        this.stepPlay(inp);
        break;
      case 'relayActivation':
        this.stateT += DT;
        this.updateDoors(DT);
        for (const pu of this.pulses) pu.t += DT;
        this.pulses = this.pulses.filter((pu) => pu.t < 0.7);
        this.player.pulseT += DT; this.player.actT += DT;
        if (this.stateT >= C.relayTime) { this.state = 'play'; this.focus = null; this.emit('relayDone'); }
        break;
      case 'shutdown':
        this.stateT -= DT;
        this.player.hurtT += DT;
        if (this.stateT <= 0) {
          this.restore();
          this.state = 'reboot';
          this.stateT = C.rebootTime;
          this.emit('reboot');
        }
        break;
      case 'reboot':
        this.stateT -= DT;
        if (this.stateT <= 0) { this.state = 'play'; this.emit('rebootDone'); }
        break;
      case 'liftSequence':
        this.stepLiftSequence();
        break;
      default:
        break;
    }
  }

  stepPlay(inp) {
    this.time += DT;
    if (inp.retryPressed) { this.beginShutdown('retry'); return; }
    this.updateDoors(DT);
    this.updateMovers(DT);
    this.updatePress(DT);
    if (this.state !== 'play') return;
    this.updatePlayer(inp);
    this.updateInteraction(inp);
    if (this.state !== 'play') return;
    this.updateEnemies(DT);
    this.updateBolts(DT);
    this.updateVents(DT);
    this.updatePulses(DT);
    this.updateStations();
    this.updateZones();
  }

  // ───────────────────────── doors / movers / press ─────────────────────────

  doorColumnOccupied(d) {
    const x0 = d.x0 - 0.05, x1 = d.x1 + 0.05, y0 = d.baseY, y1 = d.baseY + d.h;
    if (this.playerOverlaps(x0, y0, x1, y1)) return true;
    for (const c of this.cells) {
      if (c.state === 'loose' && c.x + 0.4 > x0 && c.x - 0.4 < x1 && c.y < y1 && c.y + 0.9 > y0) return true;
    }
    return false;
  }

  updateDoors(dt) {
    for (const d of this.doors) {
      let target = this.powered(d.when) ? 1 : 0;
      // A shutter never closes through ILO or a cell: it holds/reopens until clear.
      if (target === 0 && d.open > 0 && this.doorColumnOccupied(d)) target = 1;
      if (target !== d.target) { d.target = target; this.emit('door', { id: d.id, open: target === 1, x: d.x0 + 0.5, y: d.baseY }); }
      d.open = approach(d.open, target, dt / 0.6);
      d.y0 = d.baseY + d.open * d.h;
      d.solid = d.open < 0.999;
    }
  }

  placeMover(m, x, y) {
    m.x = x; m.y = y;
    m.x0 = x - m.w / 2; m.x1 = x + m.w / 2; m.y0 = y - m.h; m.y1 = y;
  }

  advanceMover(m, dt) {
    const len = Math.hypot(m.bx - m.ax, m.by - m.ay);
    const du = (m.speed * dt) / len;
    if (!this.powered(m.when)) {
      m.wasPowered = false;
      m.u = approach(m.u, m.park === 'b' ? 1 : 0, du);
      return;
    }
    if (!m.wasPowered) {
      m.wasPowered = true;
      if (m.u <= 0) { m.phase = 0; m.pt = 0; }
      else if (m.u >= 1) { m.phase = 2; m.pt = Math.max(0, m.pause - 1); }
      else m.phase = m.park === 'b' ? 1 : 3;
      this.emit('moverOn', { id: m.id });
    }
    switch (m.phase) {
      case 0: m.pt += dt; if (m.pt >= m.pause) { m.phase = 1; m.pt = 0; this.emit('moverGo', { id: m.id, x: m.x, y: m.y }); } break;
      case 1: m.u += du; if (m.u >= 1) { m.u = 1; m.phase = 2; m.pt = 0; this.emit('moverStop', { id: m.id, x: m.x, y: m.y }); } break;
      case 2: m.pt += dt; if (m.pt >= m.pause) { m.phase = 3; m.pt = 0; this.emit('moverGo', { id: m.id, x: m.x, y: m.y }); } break;
      default: m.u -= du; if (m.u <= 0) { m.u = 0; m.phase = 0; m.pt = 0; this.emit('moverStop', { id: m.id, x: m.x, y: m.y }); } break;
    }
  }

  updateMovers(dt) {
    const p = this.player;
    for (const m of this.movers) {
      const su = m.u, sphase = m.phase, spt = m.pt, spow = m.wasPowered;
      const ox = m.x, oy = m.y;
      this.advanceMover(m, dt);
      const nx = m.ax + (m.bx - m.ax) * m.u, ny = m.ay + (m.by - m.ay) * m.u;
      const dx = nx - ox, dy = ny - oy;
      m.vx = dx / dt; m.vy = dy / dt; m.stalled = false;
      if (dx === 0 && dy === 0) continue;
      const px = p.x, py = p.y;
      const rider = p.grounded && p.ground === m;
      this.placeMover(m, nx, ny);
      if (rider) {
        // Displacement is applied exactly once per step; it never feeds jump velocity.
        p.x += dx; p.y = m.y;
        if (this.rectHitsTiles(p.x - HW, p.y, p.x + HW, p.y + PH)) p.x = px;
      } else if (this.playerOverlaps(m.x0, m.y0, m.x1, m.y1)) {
        if (dy > 0) { p.y = m.y1; p.vy = 0; p.grounded = true; p.ground = m; }
        else if (dy < 0) p.y = m.y0 - PH;
        if (dx > 0) p.x = m.x1 + HW; else if (dx < 0) p.x = m.x0 - HW;
      } else continue;
      if (this.playerBlocked(m)) {
        // Obstruction: the platform waits instead of crushing.
        m.u = su; m.phase = sphase; m.pt = spt; m.wasPowered = spow;
        this.placeMover(m, ox, oy);
        p.x = px; p.y = py; m.vx = 0; m.vy = 0; m.stalled = true;
      }
    }
  }

  updatePress(dt) {
    const pr = this.press, p = this.player, T = C.press;
    const z = pr.zone;
    const inZone = p.x > z[0] && p.x < z[2] && p.y > z[1] && p.y < z[3];
    if (!inZone && pr.phase === 'wait') { pr.t = 0; return; }
    pr.t += dt;
    let bottom = pr.y0;
    switch (pr.phase) {
      case 'wait': bottom = pr.upY; if (pr.t >= T.wait) { pr.phase = 'telegraph'; pr.t = 0; this.emit('pressWarn', { x: 167, y: 13 }); } break;
      case 'telegraph': bottom = pr.upY; if (pr.t >= T.telegraph) { pr.phase = 'slam'; pr.t = 0; } break;
      case 'slam':
        bottom = pr.upY + (pr.downY - pr.upY) * Math.min(1, pr.t / T.slam);
        if (pr.t >= T.slam) { pr.phase = 'hold'; pr.t = 0; bottom = pr.downY; this.emit('pressSlam', { x: 167, y: 10 }); }
        break;
      case 'hold': bottom = pr.downY; if (pr.t >= T.hold) { pr.phase = 'rise'; pr.t = 0; } break;
      default:
        bottom = pr.downY + (pr.upY - pr.downY) * Math.min(1, pr.t / T.rise);
        if (pr.t >= T.rise) { pr.phase = 'wait'; pr.t = 0; bottom = pr.upY; }
        break;
    }
    pr.y0 = bottom;
    if (!this.playerOverlaps(pr.x0, pr.y0, pr.x1, pr.y1)) { p.crushT = 0; return; }
    // Closure against ILO. A shallow side overlap is ordinary side contact: slide out.
    const px = p.x, py = p.y;
    const overL = p.x + HW - pr.x0, overR = pr.x1 - (p.x - HW);
    if (Math.min(overL, overR) < 0.3) {
      p.x = overL < overR ? pr.x0 - HW : pr.x1 + HW;
      if (!this.playerBlocked(pr)) { p.crushT = 0; return; }
      p.x = px;
    }
    p.y = pr.y0 - PH;
    if (!this.playerBlocked(pr)) { p.vy = Math.min(p.vy, 0); p.crushT = 0; return; }
    p.y = py;
    // Sustained closure with no escape: confirmed crush (the shield does not apply).
    p.crushT += dt;
    if (p.crushT >= C.crushTime) this.beginShutdown('crush');
  }

  // ───────────────────────── player ─────────────────────────

  breakSeam(s) {
    if (s.broken) return;
    s.broken = true; s.solid = false;
    this.emit('seamBreak', { id: s.id, x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2, style: s.style });
  }

  moveX(dx) {
    const p = this.player;
    if (dx === 0) return 0;
    const prevX = p.x;
    p.x += dx;
    let hit = 0;
    const y0 = p.y, y1 = p.y + PH;
    const j0 = Math.floor(y0 + EPS), j1 = Math.floor(y1 - EPS);
    if (dx > 0) {
      const i = Math.floor(p.x + HW - EPS);
      for (let j = j0; j <= j1; j++) if (this.solidAt(i, j)) { p.x = i - HW; hit = 1; break; }
    } else {
      const i = Math.floor(p.x - HW + EPS);
      for (let j = j0; j <= j1; j++) if (this.solidAt(i, j)) { p.x = i + 1 + HW; hit = -1; break; }
    }
    for (const d of this.dyn) {
      if (!d.solid || !(y0 < d.y1 - EPS && y1 > d.y0 + EPS)) continue;
      if (dx > 0 && prevX + HW <= d.x0 + 1e-4 && p.x + HW > d.x0 + EPS) {
        if (d.kind === 'seam' && p.dashT > 0) { this.breakSeam(d); continue; }
        p.x = d.x0 - HW; hit = 1;
      } else if (dx < 0 && prevX - HW >= d.x1 - 1e-4 && p.x - HW < d.x1 - EPS) {
        if (d.kind === 'seam' && p.dashT > 0) { this.breakSeam(d); continue; }
        p.x = d.x1 + HW; hit = -1;
      }
    }
    return hit;
  }

  moveY(dy) {
    const p = this.player;
    if (dy === 0) return 0;
    const prevY = p.y;
    p.y += dy;
    let hit = 0;
    const i0 = Math.floor(p.x - HW + EPS), i1 = Math.floor(p.x + HW - EPS);
    if (dy < 0) {
      const j = Math.floor(p.y + EPS);
      for (let i = i0; i <= i1; i++) {
        if (this.solidAt(i, j)) { p.y = j + 1; hit = -1; p.ground = { id: 'tile', type: this.tileAt(i, j) }; break; }
      }
    } else {
      const j = Math.floor(p.y + PH - EPS);
      for (let i = i0; i <= i1; i++) if (this.solidAt(i, j)) { p.y = j - PH; hit = 1; break; }
    }
    const x0 = p.x - HW, x1 = p.x + HW;
    for (const d of this.dyn) {
      if (!d.solid || !(x0 < d.x1 - EPS && x1 > d.x0 + EPS)) continue;
      if (dy < 0 && prevY >= d.y1 - 1e-4 && p.y < d.y1 - EPS) { p.y = d.y1; hit = -1; p.ground = d; }
      else if (dy > 0 && prevY + PH <= d.y0 + 1e-4 && p.y + PH > d.y0 + EPS) { p.y = d.y0 - PH; hit = 1; }
    }
    return hit;
  }

  probeGround() {
    const p = this.player;
    const x0 = p.x - HW, x1 = p.x + HW;
    for (const d of this.dyn) {
      if (d.solid && x0 < d.x1 - EPS && x1 > d.x0 + EPS && Math.abs(d.y1 - p.y) < 0.02) return d;
    }
    const j = Math.floor(p.y - 0.02);
    if (p.y - j - 1 < 0.02) {
      const i0 = Math.floor(x0 + EPS), i1 = Math.floor(x1 - EPS);
      for (let i = i0; i <= i1; i++) if (this.solidAt(i, j)) return { id: 'tile', type: this.tileAt(i, j) };
    }
    return null;
  }

  /** A valid wall: solid rock/metal, a seam or a door beside the body centre. */
  wallProbe(dir) {
    const p = this.player;
    const x = dir > 0 ? p.x + HW + 0.06 : p.x - HW - 0.06;
    const y = p.y + 0.75;
    if (this.solidAt(Math.floor(x), Math.floor(y))) return true;
    for (const d of this.dyn) {
      if (d.solid && (d.kind === 'seam' || d.kind === 'door') && x > d.x0 && x < d.x1 && y > d.y0 && y < d.y1) return true;
    }
    return false;
  }

  updatePlayer(inp) {
    const p = this.player;
    const carrying = p.carry !== null;
    const maxSpeed = carrying ? C.carrySpeed : C.maxSpeed;

    p.coyote = Math.max(0, p.coyote - DT);
    p.jumpBuf = Math.max(0, p.jumpBuf - DT);
    p.dashCd = Math.max(0, p.dashCd - DT);
    p.steerLock = Math.max(0, p.steerLock - DT);
    p.pulseCd = Math.max(0, p.pulseCd - DT);
    p.immune = Math.max(0, p.immune - DT);
    p.wallCoyote = Math.max(0, p.wallCoyote - DT);
    p.landT += DT; p.pulseT += DT; p.hurtT += DT; p.shieldT += DT; p.actT += DT; p.denyT += DT;

    if (inp.jumpPressed) p.jumpBuf = C.jumpBuffer;
    const move = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const steer = p.steerLock > 0 ? 0 : move;

    if (inp.dashPressed) {
      if (carrying) { p.denyT = 0; this.emit('blocked', { what: 'dash' }); }
      else if (p.dashT <= 0 && p.dashCd <= 0 && p.dashAvail) {
        if (move !== 0) p.facing = move;
        p.dashT = C.dashTime; p.dashDir = p.facing; p.dashCd = C.dashCooldown;
        p.dashAvail = false; p.varJump = false; p.steerLock = 0;
        this.emit('dash', { x: p.x, y: p.y, dir: p.dashDir });
      }
    }

    const wasGrounded = p.grounded;
    let fallV = 0;
    p.dashedThisStep = false;

    if (p.dashT > 0) {
      // Dash: locked direction, gravity suspended, swept in sub-tile steps (0.125 u per step).
      p.dashedThisStep = true;
      p.vx = p.dashDir * C.dashSpeed; p.vy = 0;
      p.dashT -= DT;
      const hit = this.moveX(p.vx * DT);
      if (hit) { p.dashT = 0; p.vx = 0; this.emit('dashStop', { x: p.x, y: p.y }); }
      else if (p.dashT <= 0) { p.dashT = 0; p.vx = p.dashDir * C.dashExitSpeed; }
      const g = this.probeGround();
      p.grounded = g !== null; p.ground = g;
      p.wallSliding = false;
    } else {
      if (steer !== 0) p.facing = steer;
      const accel = p.grounded ? C.groundAccel : C.airAccel;
      const brake = p.grounded ? C.groundBrake : C.airBrake;
      if (steer !== 0) {
        const target = steer * maxSpeed;
        if (p.vx * steer > maxSpeed) p.vx = approach(p.vx, target, brake * DT);
        else if (p.vx * steer < 0) p.vx = approach(p.vx, target, Math.max(accel, brake) * DT);
        else p.vx = approach(p.vx, target, accel * DT);
      } else if (p.steerLock <= 0) {
        p.vx = approach(p.vx, 0, brake * DT);
      }

      if (p.jumpBuf > 0) {
        if (p.grounded || p.coyote > 0) {
          p.vy = C.jumpSpeed; p.varJump = true; p.jumpBuf = 0; p.coyote = 0;
          p.grounded = false; p.ground = null;
          this.emit('jump', { x: p.x, y: p.y });
        } else if (!carrying) {
          const wd = p.wallDir !== 0 ? p.wallDir : (p.wallCoyote > 0 ? p.lastWallDir : 0);
          if (wd !== 0) {
            p.vx = -wd * C.wallJumpX; p.vy = C.wallJumpY; p.steerLock = C.wallSteerLock;
            p.facing = -wd; p.dashAvail = true; p.varJump = false;
            p.jumpBuf = 0; p.wallCoyote = 0; p.wallDir = 0;
            this.emit('walljump', { x: p.x, y: p.y, dir: -wd });
          }
        }
      }

      let g = C.gravity;
      if (p.varJump && p.vy > 0 && !inp.jumpHeld) g *= C.releaseGravityScale;
      if (p.vy <= 0) p.varJump = false;
      p.vy = Math.max(-C.fallLimit, p.vy - g * DT);

      p.wallSliding = false;
      if (!p.grounded && !carrying && p.wallDir !== 0 && steer === p.wallDir && p.vy < 0) {
        p.wallSliding = true;
        if (p.vy < -C.wallSlideLimit) p.vy = -C.wallSlideLimit;
      }

      if (this.moveX(p.vx * DT)) p.vx = 0;
      fallV = p.vy;
      const hy = this.moveY(p.vy * DT);
      if (hy === -1) { p.grounded = true; p.vy = 0; }
      else {
        if (hy === 1) { p.vy = 0; p.varJump = false; this.emit('bonk', { x: p.x, y: p.y + PH }); }
        p.grounded = false; p.ground = null;
      }
    }

    if (p.grounded) {
      if (!wasGrounded) {
        p.landT = 0; p.wallSliding = false;
        this.emit('land', { x: p.x, y: p.y, speed: -fallV, surface: this.surfaceOf(p.ground) });
      }
      p.coyote = C.coyote;
      if (p.dashT <= 0) p.dashAvail = true;
      p.wallDir = 0; p.airT = 0;
      const sp = Math.abs(p.vx);
      if (sp > 0.6) {
        p.walkDist += sp * DT;
        if (p.walkDist - p.lastStepDist > 1.15) {
          p.lastStepDist = p.walkDist;
          this.emit('step', { x: p.x, y: p.y, surface: this.surfaceOf(p.ground) });
        }
      }
    } else {
      p.airT += DT;
      if (carrying || p.steerLock > 0) p.wallDir = 0;
      else {
        const l = this.wallProbe(-1), r = this.wallProbe(1);
        p.wallDir = r && (move >= 0 || !l) ? 1 : l ? -1 : 0;
        if (p.wallDir !== 0) { p.lastWallDir = p.wallDir; p.wallCoyote = C.wallCoyote; }
      }
    }

    if (p.regenDelay > 0) p.regenDelay -= DT;
    else if (p.energy < C.energyMax) p.energy = Math.min(C.energyMax, p.energy + C.regenRate * DT);

    if (inp.pulsePressed) this.tryPulse();
  }

  surfaceOf(g) {
    if (!g) return 'rock';
    if (g.id !== 'tile') return 'metal';
    if (g.type === 2) return 'metal';
    return this.region === 'reservoir' ? 'crystal' : 'rock';
  }

  /** One ordinary hit: either the shield absorbs it or one integrity unit is lost — never both. */
  hurt(fromX, cause) {
    const p = this.player;
    if (this.state !== 'play' || p.immune > 0) return false;
    const dir = p.x >= fromX ? 1 : -1;
    p.dashT = 0;
    if (p.energy >= C.shieldCost) {
      p.energy -= C.shieldCost; p.regenDelay = C.regenDelay;
      p.immune = C.shieldImmunity; p.shieldT = 0;
      p.vx = dir * 3.5; p.vy = Math.max(p.vy, 3.5); p.steerLock = 0.1;
      this.emit('shield', { cause, x: p.x, y: p.y + 0.75 });
    } else {
      p.integrity -= 1; p.immune = C.hitImmunity; p.hurtT = 0;
      p.vx = dir * 5.5; p.vy = 6.5; p.steerLock = 0.16;
      this.emit('damage', { cause, integrity: p.integrity, x: p.x, y: p.y + 0.75 });
      if (p.integrity <= 0) this.beginShutdown('integrity');
    }
    p.grounded = false; p.ground = null;
    return true;
  }

  // ───────────────────────── echo pulse ─────────────────────────

  tryPulse() {
    const p = this.player;
    if (p.carry !== null) { p.denyT = 0; this.emit('blocked', { what: 'pulse' }); return false; }
    if (p.pulseCd > 0) return false;
    if (p.energy < C.pulseCost) { p.denyT = 0; this.emit('pulseDenied'); return false; }
    p.energy -= C.pulseCost; p.regenDelay = C.regenDelay; p.pulseCd = C.pulseCooldown; p.pulseT = 0;
    this.pulses.push({ x: p.x, y: p.y + 0.75, t: 0, hit: new Set(), blocked: [] });
    this.emit('pulse', { x: p.x, y: p.y + 0.75 });
    return true;
  }

  updatePulses(dt) {
    for (const pu of this.pulses) {
      pu.t += dt;
      const r = C.pulseRadius * Math.min(1, pu.t / C.pulseExpand);
      // Each eligible entity responds at most once; a wall-blocked target never responds.
      const reach = (id, x, y, needLos) => {
        if (pu.hit.has(id)) return false;
        if (Math.hypot(x - pu.x, y - pu.y) > r) return false;
        pu.hit.add(id);
        if (needLos && !this.los(pu.x, pu.y, x, y)) { pu.blocked.push(id); return false; }
        return true;
      };
      for (const rl of this.relays) if (reach(rl.id, rl.x, rl.y, true)) this.pulseRelay(rl);
      for (const e of this.enemies) {
        if (e.disabled) continue;
        if (e.kind === 'sentinel') {
          if (reach(e.id, e.x + e.dir * 0.4, e.y, true)) {
            if (e.state === 'venting') this.disableEnemy(e);
            else this.emit('deflect', { id: e.id, x: e.x + e.dir * 0.4, y: e.y });
          }
        } else {
          const ty = e.kind === 'skitter' ? e.y + 0.3 : e.y;
          if (reach(e.id, e.x, ty, true) && e.state !== 'dormant') {
            e.state = 'stunned';
            e.t = e.kind === 'skitter' ? C.skitter.stun : C.drone.stun;
            this.emit('stun', { id: e.id, kind: e.kind, x: e.x, y: ty });
          }
        }
      }
      for (const s of this.seams) {
        if (!s.broken && reach(s.id, (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, true)) {
          s.reveal = C.revealTime; this.emit('reveal', { id: s.id, kind: 'seam' });
        }
      }
      for (const a of this.archives) {
        if (!a.collected && reach(a.id, a.x, a.y + 0.6, true)) { a.reveal = C.revealTime; this.emit('reveal', { id: a.id, kind: 'archive' }); }
      }
      for (const c of this.level.conduits) {
        if (pu.hit.has(c.id)) continue;
        for (const pt of c.pts) {
          if (Math.hypot(pt[0] - pu.x, pt[1] - pu.y) <= r) { pu.hit.add(c.id); this.conduitReveal[c.id] = C.revealTime; break; }
        }
      }
    }
    this.pulses = this.pulses.filter((pu) => pu.t < 0.7);
    for (const s of this.seams) if (s.reveal > 0) s.reveal -= dt;
    for (const a of this.archives) if (a.reveal > 0) a.reveal -= dt;
    for (const k in this.conduitReveal) if (this.conduitReveal[k] > 0) this.conduitReveal[k] -= dt;
  }

  pulseRelay(rl) {
    if (rl.active) return;
    if (rl.needs && !this.powered(rl.needs)) { this.emit('relayDormant', { id: rl.id, x: rl.x, y: rl.y }); return; }
    rl.active = true;
    const door = this.byId.get(rl.door);
    this.focus = { x: door.x0 + 0.5, y: door.baseY + 1.5 };
    this.state = 'relayActivation';
    this.stateT = 0;
    this.player.actT = 0;
    const st = this.byId.get(rl.station);
    st.lit = true;
    // Atomic checkpoint: relay, sockets, cells and every route change are committed together.
    this.commit(rl.station);
    this.emit('relay', { id: rl.id, x: rl.x, y: rl.y, count: this.relaysActive });
  }

  disableEnemy(e) {
    if (e.disabled) return;
    e.disabled = true; e.state = 'disabled';
    this.emit('disable', { id: e.id, kind: e.kind, x: e.x, y: e.y });
  }

  // ───────────────────────── interaction ─────────────────────────

  cellFits(x, y) {
    const hw = 0.38, h = 0.9;
    if (this.rectHitsTiles(x - hw, y, x + hw, y + h)) return false;
    if (this.rectHitsDyn(x - hw, y - 0.05, x + hw, y + h)) return false;
    const j = Math.floor(y - 0.5);
    if (!this.solidAt(Math.floor(x - hw + 0.05), j) || !this.solidAt(Math.floor(x + hw - 0.05), j)) return false;
    for (const v of this.vents) if (Math.abs(v.x - x) < C.vent.halfW + hw && Math.abs(v.y - y) < 0.6) return false;
    const pr = this.press;
    if (x + hw > pr.x0 && x - hw < pr.x1 && y < pr.top && y + h > pr.downY) return false;
    for (const d of this.doors) {
      if (x + hw > d.x0 && x - hw < d.x1 && y < d.baseY + d.h && y + h > d.baseY) return false;
    }
    for (const k of this.level.killZones) if (x + hw > k.x0 && x - hw < k.x1 && y < k.y1) return false;
    return true;
  }

  placementSpot() {
    const p = this.player;
    if (!p.grounded || !p.ground || p.ground.id !== 'tile') return null;
    for (const off of [0.95, 0.55, 0]) {
      const x = p.x + p.facing * off;
      if (this.cellFits(x, p.y)) return { x, y: p.y };
    }
    return null;
  }

  /** Explicit priority: socket for a carried cell > loose cell > socketed cell > other interactables. */
  computeTarget() {
    const p = this.player;
    const near = (o, r) => Math.abs(o.x - p.x) <= r && Math.abs(o.y - p.y) <= 1.2;
    const nearest = (list, r, ok) => {
      let best = null, bd = 1e9;
      for (const o of list) {
        if (!ok(o) || !near(o, r)) continue;
        const d = Math.abs(o.x - p.x);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    };
    if (p.carry !== null) {
      const so = nearest(this.sockets, C.cellReach, (s) => s.cell === null);
      if (so) return { kind: 'insert', id: so.id, label: 'Insert Cell', x: so.x, y: so.y, ok: true };
      const spot = this.placementSpot();
      return { kind: 'place', id: p.carry, label: 'Place Cell', x: spot ? spot.x : p.x, y: p.y, ok: spot !== null, spot };
    }
    const cell = nearest(this.cells, C.cellReach, (c) => c.state === 'loose');
    if (cell) return { kind: 'pickup', id: cell.id, label: 'Lift Cell', x: cell.x, y: cell.y, ok: true };
    const so = nearest(this.sockets, C.cellReach, (s) => s.cell !== null);
    if (so) return { kind: 'remove', id: so.id, label: 'Remove Cell', x: so.x, y: so.y, ok: true };
    const sw = nearest(this.switches, C.interactReach, (s) => !s.on);
    if (sw) return { kind: 'switch', id: sw.id, label: 'Throw Switch', x: sw.x, y: sw.y, ok: true };
    const ca = nearest(this.caches, 1.2, (c) => !c.collected);
    if (ca) return { kind: 'cache', id: ca.id, label: 'Open Salvage Cache', x: ca.x, y: ca.y, ok: true };
    const ar = nearest(this.archives, 1.2, (a) => !a.collected);
    if (ar) return { kind: 'archive', id: ar.id, label: 'Recover Archive', x: ar.x, y: ar.y, ok: true };
    const ml = this.mainLift;
    if (!ml.moving && Math.abs(ml.consoleX - p.x) <= 1.4 && Math.abs(ml.consoleY - p.y) <= 1.2) {
      const all = this.relays.every((r) => r.active);
      const aboard = this.aboardLift();
      const label = !all ? 'Lift Offline — Restore All Relays' : aboard ? 'Activate Lift' : 'Step Onto The Lift';
      return { kind: 'lift', id: ml.id, label, x: ml.consoleX, y: ml.consoleY, ok: all && aboard };
    }
    return null;
  }

  aboardLift() {
    const p = this.player, ml = this.mainLift;
    return p.grounded && p.x >= ml.boardX0 && p.x <= ml.boardX1 && Math.abs(p.y - ml.yTop) < 0.05;
  }

  updateInteraction(inp) {
    const p = this.player;
    const t = this.computeTarget();
    this.target = t;
    if (!inp.interactPressed || !t) return;
    switch (t.kind) {
      case 'insert': {
        const so = this.byId.get(t.id), cell = this.byId.get(p.carry);
        if (so.cell !== null || cell.state !== 'carried') break;
        cell.state = 'socket'; cell.socket = so.id; cell.x = so.x; cell.y = so.y;
        so.cell = cell.id; p.carry = null; p.actT = 0;
        this.emit('socketIn', { id: so.id, x: so.x, y: so.y });
        break;
      }
      case 'place': {
        if (!t.ok) { p.denyT = 0; this.emit('placeDenied'); break; }
        const cell = this.byId.get(p.carry);
        cell.state = 'loose'; cell.x = t.spot.x; cell.y = t.spot.y; p.carry = null; p.actT = 0;
        this.emit('cellPlace', { id: cell.id, x: cell.x, y: cell.y });
        break;
      }
      case 'pickup': {
        const cell = this.byId.get(t.id);
        if (cell.state !== 'loose') break;
        cell.state = 'carried'; p.carry = cell.id; p.actT = 0;
        p.dashT = 0; p.wallSliding = false;
        this.emit('cellPick', { id: cell.id, x: cell.x, y: cell.y });
        break;
      }
      case 'remove': {
        const so = this.byId.get(t.id), cell = this.byId.get(so.cell);
        so.cell = null; cell.socket = null; cell.state = 'carried'; p.carry = cell.id; p.actT = 0;
        this.emit('socketOut', { id: so.id, x: so.x, y: so.y });
        break;
      }
      case 'switch': {
        const sw = this.byId.get(t.id);
        sw.on = true; p.actT = 0;
        this.emit('switch', { id: sw.id, x: sw.x, y: sw.y });
        break;
      }
      case 'cache': {
        const ca = this.byId.get(t.id);
        if (ca.collected) break;
        ca.collected = true; p.actT = 0;
        const before = p.energy;
        p.energy = Math.min(C.energyMax, p.energy + C.cacheEnergy);
        this.emit('cache', { id: ca.id, x: ca.x, y: ca.y, gained: Math.round(p.energy - before) });
        break;
      }
      case 'archive': {
        const ar = this.byId.get(t.id);
        if (ar.collected) break;
        ar.collected = true; p.actT = 0;
        this.emit('archive', { id: ar.id, title: ar.title, text: ar.text, x: ar.x, y: ar.y });
        break;
      }
      case 'lift':
        this.tryLift();
        break;
      default: break;
    }
    this.target = this.computeTarget();
  }

  // ───────────────────────── enemies ─────────────────────────

  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.disabled) continue;
      const z = e.zone;
      const inZone = p.x > z[0] && p.x < z[2] && p.y + 0.75 > z[1] && p.y + 0.75 < z[3];
      if (e.kind === 'skitter') this.updateSkitter(e, inZone, dt);
      else if (e.kind === 'drone') this.updateDrone(e, inZone, dt);
      else this.updateSentinel(e, inZone, dt);
      if (this.state !== 'play') return;
    }
  }

  updateSkitter(e, inZone, dt) {
    const S = C.skitter, p = this.player;
    if (!inZone) { e.state = 'dormant'; return; }
    const blockedAhead = (step) => {
      const front = e.x + step + e.dir * (S.w / 2);
      return this.solidPoint(front, e.y + 0.3) || !this.solidPoint(front, e.y - 0.3);
    };
    switch (e.state) {
      case 'dormant': e.state = 'patrol'; break;
      case 'patrol': {
        if (e.x < e.range[0]) e.dir = 1; else if (e.x > e.range[1]) e.dir = -1;
        const step = e.dir * S.speed * dt;
        if (blockedAhead(step + e.dir * 0.1)) e.dir = -e.dir; else e.x += step;
        const dx = p.x - e.x, dy = p.y + 0.75 - (e.y + 0.3);
        if (dx * dx + dy * dy < S.detect * S.detect && this.los(e.x, e.y + 0.45, p.x, p.y + 0.75)) {
          e.state = 'alert'; e.t = S.telegraph; e.dir = dx >= 0 ? 1 : -1;
          this.emit('telegraph', { id: e.id, kind: 'skitter', x: e.x, y: e.y });
        }
        break;
      }
      case 'alert':
        e.t -= dt;
        if (e.t <= 0) { e.state = 'lunge'; e.t = S.lungeTime; this.emit('lunge', { id: e.id, x: e.x, y: e.y }); }
        break;
      case 'lunge': {
        // Direction was locked when the telegraph began; no retargeting mid-lunge.
        const step = e.dir * S.lungeSpeed * dt;
        if (blockedAhead(step)) e.t = 0; else e.x += step;
        e.t -= dt;
        if (e.t <= 0) { e.state = 'recover'; e.t = S.recover; }
        break;
      }
      case 'recover': e.t -= dt; if (e.t <= 0) e.state = 'patrol'; break;
      case 'stunned': e.t -= dt; if (e.t <= 0) e.state = 'patrol'; break;
      default: break;
    }
    if (this.playerOverlaps(e.x - S.w / 2, e.y, e.x + S.w / 2, e.y + S.h)) {
      if (e.state === 'stunned') { if (p.dashedThisStep) this.disableEnemy(e); }
      else if (e.state !== 'dormant') this.hurt(e.x, 'skitter');
    }
  }

  updateDrone(e, inZone, dt) {
    const D = C.drone, p = this.player;
    if (!inZone) { if (e.state === 'aim') e.state = 'patrol'; return; }
    const tx = p.x, ty = p.y + 0.75;
    const patrolMove = () => {
      const gx = e.toB ? e.bx : e.ax, gy = e.toB ? e.by : e.ay;
      const dx = gx - e.x, dy = gy - e.y, d = Math.hypot(dx, dy), s = D.speed * dt;
      if (d <= s) { e.x = gx; e.y = gy; e.toB = !e.toB; } else { e.x += (dx / d) * s; e.y += (dy / d) * s; }
    };
    switch (e.state) {
      case 'patrol':
        patrolMove();
        if (Math.hypot(tx - e.x, ty - e.y) < D.detect && this.los(e.x, e.y, tx, ty)) {
          e.state = 'aim'; e.t = D.aim;
          this.emit('telegraph', { id: e.id, kind: 'drone', x: e.x, y: e.y });
        }
        break;
      case 'aim': {
        e.t -= dt;
        if (e.t > D.aimLock) { // track, then lock before firing
          const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
          e.aimX = dx / d; e.aimY = dy / d;
        }
        if (e.t <= 0) {
          this.bolts.push({ x: e.x + e.aimX * 0.5, y: e.y + e.aimY * 0.5, vx: e.aimX * D.boltSpeed, vy: e.aimY * D.boltSpeed, life: D.boltLife });
          if (this.bolts.length > 12) this.bolts.shift();
          e.state = 'cooldown'; e.t = D.cooldown;
          this.emit('bolt', { id: e.id, x: e.x, y: e.y });
        }
        break;
      }
      case 'cooldown': patrolMove(); e.t -= dt; if (e.t <= 0) e.state = 'patrol'; break;
      case 'stunned': e.t -= dt; if (e.t <= 0) { e.state = 'cooldown'; e.t = 0.5; } break;
      default: break;
    }
    const h = D.size / 2;
    if (this.playerOverlaps(e.x - h, e.y - h, e.x + h, e.y + h)) {
      if (e.state === 'stunned') { if (p.dashedThisStep) this.disableEnemy(e); }
      else this.hurt(e.x, 'drone');
    }
  }

  sentinelLane(e) {
    const j = Math.floor(e.y);
    let i = Math.floor(e.x + e.dir * 0.5);
    let n = 0;
    while (!this.solidAt(i, j) && n < 60) { i += e.dir; n++; }
    if (e.dir < 0) { e.laneX0 = i + 1; e.laneX1 = e.x; } else { e.laneX0 = e.x; e.laneX1 = i; }
  }

  updateSentinel(e, inZone, dt) {
    const T = C.sentinel;
    if (!inZone) { e.state = 'closed'; e.t = 0; return; } // re-arms: first exposure always gets the full warning
    e.t += dt;
    switch (e.state) {
      case 'closed':
        if (e.t >= T.closed) { e.state = 'warning'; e.t = 0; this.sentinelLane(e); this.emit('telegraph', { id: e.id, kind: 'sentinel', x: e.x, y: e.y }); }
        break;
      case 'warning':
        if (e.t >= T.warning) { e.state = 'firing'; e.t = 0; this.emit('beam', { id: e.id, x: e.x, y: e.y }); }
        break;
      case 'firing':
        // Damage volume == visible lane.
        if (this.playerOverlaps(e.laneX0, e.y - T.laneHalf, e.laneX1, e.y + T.laneHalf)) this.hurt(e.x, 'beam');
        if (e.t >= T.firing) { e.state = 'venting'; e.t = 0; this.emit('ventOpen', { id: e.id, x: e.x, y: e.y }); }
        break;
      case 'venting':
        if (e.t >= T.venting) { e.state = 'closed'; e.t = 0; }
        break;
      default: break;
    }
  }

  updateBolts(dt) {
    const p = this.player;
    for (const b of this.bolts) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) continue;
      if (this.solidPoint(b.x, b.y)) { b.life = 0; this.emit('boltHit', { x: b.x, y: b.y }); continue; }
      if (b.x > p.x - HW - 0.18 && b.x < p.x + HW + 0.18 && b.y > p.y - 0.18 && b.y < p.y + PH + 0.18) {
        b.life = 0;
        this.hurt(b.x - b.vx, 'bolt');
        if (this.state !== 'play') break;
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
  }

  updateVents(dt) {
    const V = C.vent, p = this.player;
    const cycle = V.dormant + V.warning + V.active;
    for (const v of this.vents) {
      const awake = Math.abs(p.x - v.x) < 11 && Math.abs(p.y - v.y) < 8;
      if (!awake) { v.phase = 'dormant'; v.t = -v.offset; v.awake = false; continue; }
      v.awake = true;
      v.t += dt;
      const tt = v.t < 0 ? 0 : v.t % cycle;
      const phase = tt < V.dormant ? 'dormant' : tt < V.dormant + V.warning ? 'warning' : 'active';
      if (phase !== v.phase) {
        v.phase = phase;
        if (phase === 'warning') this.emit('ventWarn', { id: v.id, x: v.x, y: v.y });
        else if (phase === 'active') this.emit('ventFire', { id: v.id, x: v.x, y: v.y });
      }
      if (phase === 'active' && this.playerOverlaps(v.x - V.halfW, v.y, v.x + V.halfW, v.y + V.height)) {
        this.hurt(v.x, 'vent');
        if (this.state !== 'play') return;
      }
    }
  }

  // ───────────────────────── stations / zones ─────────────────────────

  updateStations() {
    const p = this.player;
    for (const st of this.stations) {
      const inside = p.grounded && Math.abs(p.x - st.x) < 0.9 && Math.abs(p.y - st.y) < 0.6;
      if (inside && !st.inside) {
        p.integrity = C.integrityMax; p.energy = C.energyMax; p.regenDelay = 0;
        st.lit = true;
        this.commit(st.id);
        this.emit('station', { id: st.id, x: st.x, y: st.y, label: st.label });
      }
      st.inside = inside;
    }
  }

  updateZones() {
    const p = this.player;
    if (p.y < 1) { this.beginShutdown('fall'); return; }
    for (const k of this.level.killZones) {
      if (p.x > k.x0 && p.x < k.x1 && p.y >= k.y0 && p.y < k.y1) { this.beginShutdown(k.kind); return; }
    }
    const region = regionAt(p.x);
    if (region !== this.region) { this.region = region; this.emit('region', { id: region }); }
    let hint = null;
    for (const h of this.level.hints) {
      const r = h.rect;
      if (p.x >= r[0] && p.x <= r[2] && p.y >= r[1] - 0.01 && p.y <= r[3]) { hint = h.id; break; }
    }
    this.hint = hint;
    let ph = null;
    for (const rl of this.relays) {
      if (rl.active) continue;
      if (Math.hypot(rl.x - p.x, rl.y - (p.y + 0.75)) < C.pulseRadius - 0.6 && this.los(p.x, p.y + 0.75, rl.x, rl.y)) {
        ph = { id: rl.id, ready: !rl.needs || this.powered(rl.needs) };
      }
    }
    this.pulseHint = ph;
  }

  // ───────────────────────── ending ─────────────────────────

  /** The lift departs only with all three relay IDs active, ILO aboard, lift idle, expedition in play. */
  tryLift() {
    const ml = this.mainLift;
    if (this.state !== 'play' || ml.moving) return false;
    const missing = this.relays.filter((r) => !r.active).map((r) => r.id);
    if (missing.length > 0) { this.emit('liftDenied', { reason: 'relays', missing }); return false; }
    if (!this.aboardLift()) { this.emit('liftDenied', { reason: 'board' }); return false; }
    // Commit the run result exactly once and stop the completion clock.
    this.result = {
      time: this.time,
      recoveries: this.recoveries,
      archives: this.archivesFound,
      caches: this.cachesFound,
      machines: this.machinesDisabled,
      relays: this.relays.map((r) => ({ id: r.id, active: r.active })),
      fullArchive: this.archivesFound === this.archives.length,
    };
    this.resultCommits += 1;
    ml.moving = true;
    this.state = 'liftSequence';
    this.stateT = 0;
    this.liftPhase = 'barrier';
    this.bolts.length = 0;
    const p = this.player;
    p.vx = 0; p.vy = 0; p.dashT = 0; p.immune = 0;
    this.emit('liftStart', { x: ml.x, y: ml.yTop });
    return true;
  }

  stepLiftSequence() {
    this.stateT += DT;
    const t = this.stateT, ml = this.mainLift, p = this.player;
    p.actT += DT; p.landT += DT; p.pulseT += DT; p.hurtT += DT; p.shieldT += DT;
    const RISE = 6.2;
    if (t < 0.9) {
      this.liftPhase = 'barrier';
      ml.barrier = t / 0.9;
      p.x = approach(p.x, ml.x - 0.3, 1.6 * DT); p.vx = 0;
    } else if (t < 0.9 + RISE) {
      this.liftPhase = 'rise';
      ml.barrier = 1;
      ml.yTop = ml.y + (ml.topY - ml.y) * smooth((t - 0.9) / RISE);
      p.y = ml.yTop;
    } else if (t < 0.9 + RISE + 0.9) {
      if (this.liftPhase !== 'arrive') this.emit('liftArrive', { x: ml.x, y: ml.topY });
      this.liftPhase = 'arrive';
      ml.yTop = ml.topY; p.y = ml.yTop;
      ml.barrier = 1 - (t - 0.9 - RISE) / 0.9;
    } else if (p.x < ml.exitX && this.liftPhase !== 'rest') {
      this.liftPhase = 'walk';
      ml.barrier = 0;
      p.facing = 1; p.vx = 2.4; p.x += p.vx * DT; p.walkDist += p.vx * DT;
      if (p.walkDist - p.lastStepDist > 1.15) { p.lastStepDist = p.walkDist; this.emit('step', { x: p.x, y: p.y, surface: 'rock' }); }
      this.restT = 0;
    } else {
      this.liftPhase = 'rest';
      p.vx = 0;
      this.restT = (this.restT || 0) + DT;
      if (this.restT >= 1.4) { this.state = 'complete'; this.emit('complete', { result: this.result }); }
    }
    ml.y1 = ml.yTop; ml.y0 = ml.yTop - ml.h;
  }
}
