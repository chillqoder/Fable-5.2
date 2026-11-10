// DEEPWAKE — deterministic checks against the real simulation (no approximation of the rules).
// Run: node tests/run.mjs        (add --verbose to list every passing check)

import { Sim } from '../src/sim.js';
import { C, DT, STORAGE_KEY, RECORDS_VERSION } from '../src/config.js';
import { buildLevel, W, H, regionAt } from '../src/level.js';
import { Bot, mainRoute, fullRoute, routeUntil, playRoute } from './bot.mjs';
import { RecordStore, applyResult, validateRecords, emptyRecords, isCompletedResult, formatTime } from '../src/records.js';

const verbose = process.argv.includes('--verbose');
const results = [];
function test(area, name, fn) {
  try { const note = fn(); results.push({ area, name, ok: true, note: note || '' }); }
  catch (e) { results.push({ area, name, ok: false, note: e.message }); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg}: got ${a}, expected ${b} ±${tol}`); }

const HW = C.bodyW / 2;
function tp(sim, x, y, grounded = true) {
  const p = sim.player;
  p.x = x; p.y = y; p.vx = 0; p.vy = 0;
  p.grounded = grounded; p.ground = grounded ? { id: 'tile', type: 1 } : null;
  p.coyote = 0; p.jumpBuf = 0; p.wallDir = 0; p.wallCoyote = 0; p.dashT = 0; p.dashCd = 0; p.dashAvail = true;
  sim.region = regionAt(x);
  ok(!sim.playerBlocked(), `test teleport into solid at ${x},${y}`);
}
function steps(sim, n, inp = {}) { for (let i = 0; i < n; i++) sim.step(inp); }
function secs(sim, t, inp = {}) { steps(sim, Math.round(t * 120), inp); }
function drain(sim) { const e = sim.events.slice(); sim.events.length = 0; return e; }
function count(evts, type) { return evts.filter((e) => e.type === type).length; }
function until(sim, pred, maxSec = 20, inp = {}) {
  const max = Math.round(maxSec * 120);
  for (let i = 0; i < max; i++) { if (pred()) return i; sim.step(inp); }
  throw new Error('until(): condition not reached');
}
function carry(sim, cellId) { const c = sim.byId.get(cellId); c.state = 'carried'; c.socket = null; sim.player.carry = cellId; }
function socketIn(sim, cellId, socketId) {
  const c = sim.byId.get(cellId), s = sim.byId.get(socketId);
  c.state = 'socket'; c.socket = socketId; c.x = s.x; c.y = s.y; s.cell = cellId;
}
function cellInvariant(sim) {
  const p = sim.player;
  ok(sim.cells.length === 2, 'exactly two cells exist');
  for (const c of sim.cells) {
    if (c.state === 'socket') ok(sim.byId.get(c.socket).cell === c.id, `socket ${c.socket} owns ${c.id}`);
    else if (c.state === 'carried') ok(p.carry === c.id, `${c.id} carried by ILO`);
    else ok(c.state === 'loose' && c.socket === null, `${c.id} loose`);
  }
  for (const s of sim.sockets) if (s.cell) { const c = sim.byId.get(s.cell); ok(c.state === 'socket' && c.socket === s.id, `socket ${s.id} consistent`); }
  if (p.carry) ok(sim.byId.get(p.carry).state === 'carried', 'carry consistent');
  const owned = sim.sockets.filter((s) => s.cell).map((s) => s.cell);
  ok(new Set(owned).size === owned.length, 'a cell powers one socket at a time');
}
function runRoute(mk) { const sim = new Sim(); const bot = new Bot(sim); playRoute(bot, mk(sim)); return { sim, bot }; }
function midRun(key, full = false) { const sim = new Sim(); const bot = new Bot(sim); playRoute(bot, routeUntil(sim, key, full)); sim.events.length = 0; return { sim, bot }; }
function die(sim) { tp(sim, 115, 21, false); until(sim, () => sim.state === 'shutdown', 2); until(sim, () => sim.state === 'play', 4); }

// ═════════════════════════ Level data ═════════════════════════
test('Level', 'entities sit in open cells on solid ground', () => {
  const L = buildLevel();
  const solid = (x, y) => L.grid[Math.floor(y) * W + Math.floor(x)] !== 0;
  for (const list of [L.stations, L.sockets, L.cells, L.switches, L.archives, L.caches]) {
    for (const o of list) { ok(!solid(o.x, o.y + 0.5), `${o.id} is inside rock`); ok(solid(o.x, o.y - 0.5), `${o.id} has no floor`); }
  }
  for (const s of L.seams) for (let j = s.y0; j < s.y1; j++) for (let i = s.x0; i < s.x1; i++) ok(L.grid[j * W + i] === 0, `seam ${s.id} overlaps terrain`);
  for (const d of L.doors) for (let j = d.y0; j < d.y0 + d.h; j++) ok(L.grid[j * W + d.x] === 0, `door ${d.id} overlaps terrain`);
  for (const r of L.relays) ok(!solid(r.x, r.y), `relay ${r.id} inside rock`);
  ok(L.archives.length === 3 && new Set(L.archives.map((a) => regionAt(a.x))).size === 3, 'exactly three archives, one per main region');
  const route = L.stations[L.stations.length - 1].x - L.stations[0].x;
  return `grid ${W}x${H}; station span ${route} u`;
});

// ═════════════════════════ Movement ═════════════════════════
test('Movement', 'ground acceleration and braking', () => {
  const sim = new Sim(); tp(sim, 4.5, 10);
  const a = until(sim, () => sim.player.vx >= C.maxSpeed, 1, { right: true });
  secs(sim, 0.2, { right: true });
  ok(sim.player.vx === C.maxSpeed, 'speed is capped at 6.5');
  const b = until(sim, () => sim.player.vx === 0, 1);
  ok(a >= 18 && a <= 20, `accel steps ${a}`); ok(b >= 20 && b <= 22, `brake steps ${b}`);
  return `0→6.5 u/s in ${a} steps (${(a / 120).toFixed(3)} s); stop in ${b} steps`;
});
test('Movement', 'held jump ≈ 2.6 u, short tap 1.2–1.5 u', () => {
  const height = (holdSteps) => {
    const sim = new Sim(); tp(sim, 9, 10);
    let max = 10;
    sim.step({ jumpPressed: true, jumpHeld: true });
    for (let k = 1; k < 200; k++) { sim.step({ jumpHeld: k < holdSteps }); max = Math.max(max, sim.player.y); if (sim.player.grounded) break; }
    return max - 10;
  };
  const full = height(999), tap = height(7);
  near(full, 2.62, 0.08, 'held jump height'); ok(tap >= 1.2 && tap <= 1.5, `tap height ${tap}`);
  return `held ${full.toFixed(2)} u; 58 ms tap ${tap.toFixed(2)} u`;
});
test('Movement', 'coyote time window', () => {
  const tryAt = (k) => {
    const sim = new Sim(); tp(sim, 24.2, 12);
    until(sim, () => !sim.player.grounded, 2, { right: true });
    steps(sim, k, { right: true }); drain(sim);
    sim.step({ jumpPressed: true, jumpHeld: true, right: true });
    return count(drain(sim), 'jump') === 1;
  };
  ok(tryAt(10), 'jump 83 ms after leaving the ledge'); ok(!tryAt(16), 'no jump 133 ms after leaving the ledge');
  return 'jump accepted at +83 ms, rejected at +133 ms';
});
test('Movement', 'jump buffering before landing', () => {
  const tryAt = (pressStep) => {
    const sim = new Sim(); tp(sim, 9, 11, false); drain(sim);
    for (let k = 0; k < 60; k++) sim.step(k === pressStep ? { jumpPressed: true, jumpHeld: true } : { jumpHeld: true });
    return count(drain(sim), 'jump') === 1;
  };
  ok(tryAt(18), 'press 0.1 s before landing jumps on landing'); ok(!tryAt(3), 'press 0.22 s early expires');
  return 'buffer honoured at −100 ms, expired at −225 ms';
});
test('Movement', 'ceiling hit resolves cleanly', () => {
  const sim = new Sim(); tp(sim, 33.6, 12); drain(sim);
  let top = 0;
  sim.step({ jumpPressed: true, jumpHeld: true });
  for (let k = 0; k < 150; k++) { sim.step({ jumpHeld: true }); top = Math.max(top, sim.player.y + C.bodyH); ok(!sim.playerBlocked(), 'embedded in ceiling'); }
  ok(top <= 16 + 1e-9, `head reached ${top}`); ok(count(drain(sim), 'bonk') === 1, 'one ceiling contact'); ok(sim.player.grounded, 'landed');
  return `head stopped at y=${top.toFixed(3)} under the y=16 ceiling`;
});
test('Movement', 'no double jump', () => {
  const sim = new Sim(); tp(sim, 9, 10); drain(sim);
  sim.step({ jumpPressed: true, jumpHeld: true });
  steps(sim, 40, { jumpHeld: true });
  const vy = sim.player.vy;
  sim.step({ jumpPressed: true, jumpHeld: true });
  ok(sim.player.vy < vy, 'second press must not relaunch');
  until(sim, () => sim.player.grounded, 2); steps(sim, 30);
  const ev = drain(sim);
  ok(count(ev, 'jump') === 1 && count(ev, 'walljump') === 0, 'exactly one jump');
});

// ═════════════════════════ Walls ═════════════════════════
test('Walls', 'no slide while grounded; slide capped at 3 u/s when airborne', () => {
  const sim = new Sim(); tp(sim, 90.5, 13);
  steps(sim, 30, { right: true });
  ok(sim.player.wallDir === 0 && !sim.player.wallSliding, 'grounded side contact must not slide');
  sim.step({ jumpPressed: true, jumpHeld: true, right: true });
  let slid = false, minVy = 0;
  for (let k = 0; k < 90 && !sim.player.grounded; k++) {
    sim.step({ jumpHeld: true, right: true });
    if (sim.player.wallSliding) { slid = true; minVy = Math.min(minVy, sim.player.vy); }
  }
  ok(slid, 'wall slide started'); ok(minVy >= -C.wallSlideLimit - 1e-9, `slide speed ${minVy}`);
  return `slide speed limit ${minVy.toFixed(2)} u/s`;
});
test('Walls', 'wall jump launch, steering lock, release ends slide', () => {
  const sim = new Sim(); tp(sim, 90.5, 13);
  sim.step({ jumpPressed: true, jumpHeld: true, right: true });
  until(sim, () => sim.player.wallSliding, 2, { jumpHeld: true, right: true }); drain(sim);
  const y0 = sim.player.y;
  sim.step({ jumpPressed: true, jumpHeld: true, right: true });
  ok(count(drain(sim), 'walljump') === 1, 'wall jump event');
  ok(sim.player.vx === -C.wallJumpX, `vx ${sim.player.vx}`); near(sim.player.vy, C.wallJumpY - C.gravity * DT, 1e-9, 'vy');
  steps(sim, 8, { right: true });
  ok(sim.player.vx === -C.wallJumpX, 'steering locked for ~100 ms');
  steps(sim, 8, { right: true });
  ok(sim.player.vx > -C.wallJumpX, 'steering restored after the lock');
  ok(sim.player.y > y0 + 1, 'gained height');
  // release ends the slide
  const s2 = new Sim(); tp(s2, 90.5, 13);
  s2.step({ jumpPressed: true, jumpHeld: true, right: true });
  until(s2, () => s2.player.wallSliding, 2, { jumpHeld: true, right: true });
  steps(s2, 5); ok(!s2.player.wallSliding, 'slide ends when not holding toward the wall');
});
test('Walls', 'required shafts are climbable by repeated wall jumps', () => {
  const out = [];
  for (const [x, y, exitY, label] of [[88.2, 13, 22, 'reservoir shaft'], [100.6, 22, 32, 'switch shaft'], [211.2, 20, 30, 'ascent chimney']]) {
    const sim = new Sim(); tp(sim, x, y); const bot = new Bot(sim);
    bot.climb(1, exitY); ok(sim.player.y === exitY, `${label} exit`);
    out.push(`${label} ${(bot.steps / 120).toFixed(1)} s`);
  }
  return out.join('; ');
});
test('Walls', 'carrying a cell disables wall slide and wall jump', () => {
  const sim = new Sim(); tp(sim, 90.5, 13); carry(sim, 'C1'); drain(sim);
  sim.step({ jumpPressed: true, jumpHeld: true, right: true });
  let touched = false;
  for (let k = 0; k < 70; k++) { sim.step(k === 45 ? { jumpPressed: true, right: true } : { jumpHeld: true, right: true }); touched = touched || sim.player.wallDir !== 0 || sim.player.wallSliding; }
  ok(!touched, 'no wall contact state while carrying'); ok(count(drain(sim), 'walljump') === 0, 'no wall jump while carrying');
});

// ═════════════════════════ Dash ═════════════════════════
test('Dash', 'duration, distance, gravity suspension, exit speed, direction lock', () => {
  const sim = new Sim(); tp(sim, 4.5, 13, false);
  sim.step({ dashPressed: true, right: true });
  let n = 1; const y0 = sim.player.y; let lastX = sim.player.x;
  while (sim.player.dashT > 0) { sim.step({ left: true }); n++; ok(sim.player.x > lastX, 'direction locked'); ok(sim.player.y === y0, 'gravity suspended'); lastX = sim.player.x; }
  const dist = sim.player.x - 4.5;
  ok(n >= 19 && n <= 20, `dash steps ${n}`); ok(dist > 2.3 && dist < 2.6, `dash distance ${dist}`);
  ok(sim.player.vx === C.dashExitSpeed, `exit vx ${sim.player.vx}`);
  return `${n} steps (${(n / 120).toFixed(3)} s), ${dist.toFixed(2)} u, exit ${sim.player.vx} u/s`;
});
test('Dash', 'cooldown between activations', () => {
  const sim = new Sim(); tp(sim, 4, 10); drain(sim);
  sim.step({ dashPressed: true, right: true }); secs(sim, 0.3);
  sim.step({ dashPressed: true, right: true });
  ok(count(drain(sim), 'dash') === 1, 'second dash at +0.31 s must be refused'); secs(sim, 0.16);
  sim.step({ dashPressed: true, right: true });
  ok(count(drain(sim), 'dash') === 1, 'dash accepted after 0.45 s');
});
test('Dash', 'one air dash; refresh on landing and on wall jump', () => {
  const sim = new Sim(); tp(sim, 89.5, 25, false); drain(sim);
  sim.step({ dashPressed: true, left: true }); secs(sim, 0.5);
  sim.step({ dashPressed: true, left: true });
  ok(count(drain(sim), 'dash') === 1, 'no second dash in the same airborne sequence');
  until(sim, () => sim.player.grounded, 3); sim.step({ dashPressed: true, right: true });
  ok(count(drain(sim), 'dash') === 1, 'dash refreshed by landing');
  const s2 = new Sim(); tp(s2, 90, 19, false); drain(s2);
  s2.step({ dashPressed: true, right: true });
  until(s2, () => s2.player.wallDir === 1, 1, { right: true });
  s2.step({ jumpPressed: true, right: true }); secs(s2, 0.46);
  ok(!s2.player.grounded, 'still airborne after the wall jump');
  s2.step({ dashPressed: true, left: true });
  const ev = drain(s2);
  ok(count(ev, 'walljump') === 1 && count(ev, 'dash') === 2, 'dash refreshed by wall jump');
});
test('Dash', 'no tunnelling through thin shutters or terrain', () => {
  const sim = new Sim(); tp(sim, 67.5, 13);
  sim.step({ dashPressed: true, right: true });
  for (let k = 0; k < 40; k++) { sim.step({ right: true }); ok(sim.player.x <= 69 - HW + 1e-9, 'passed through the closed shutter'); }
  const s2 = new Sim(); tp(s2, 11.6, 10);
  s2.step({ dashPressed: true, right: true });
  for (let k = 0; k < 40; k++) { s2.step({ right: true }); ok(s2.player.x <= 13 - HW + 1e-9, 'passed through terrain'); }
  ok(!s2.playerBlocked(), 'not embedded');
  return 'stopped flush at x=68.625 (shutter) and x=12.625 (step)';
});
test('Dash', 'breaks cracked seams; harmful against an active Skitter; disables a stunned one', () => {
  const sim = new Sim(); tp(sim, 33.4, 12);
  sim.step({ dashPressed: true, right: true }); secs(sim, 0.3, { right: true });
  ok(sim.byId.get('seamT').broken && sim.player.x > 36, 'training seam broken and passed');
  const walk = new Sim(); tp(walk, 33.4, 12); secs(walk, 1, { right: true });
  ok(!walk.byId.get('seamT').broken && walk.player.x <= 35 - HW + 1e-9, 'walking does not break a seam');
  const s2 = new Sim(); tp(s2, 47.4, 9); s2.step(); drain(s2);
  const k = s2.byId.get('K1'); k.x = 49; k.state = 'patrol';
  s2.step({ dashPressed: true, right: true }); secs(s2, 0.3);
  const ev = drain(s2);
  ok(count(ev, 'shield') === 1 && !k.disabled, 'dash into an active Skitter is absorbed as a hit, not a disable');
  const s3 = new Sim(); tp(s3, 47.4, 9); s3.step(); drain(s3);
  const k3 = s3.byId.get('K1'); k3.x = 49; k3.state = 'stunned'; k3.t = 2;
  s3.step({ dashPressed: true, right: true }); secs(s3, 0.3);
  const ev3 = drain(s3);
  ok(k3.disabled && count(ev3, 'disable') === 1 && count(ev3, 'shield') + count(ev3, 'damage') === 0, 'stunned Skitter disabled without harm');
});

// ═════════════════════════ Pulse ═════════════════════════
test('Pulse', 'cost, cooldown, regeneration delay and rate', () => {
  const sim = new Sim(); tp(sim, 9, 10); drain(sim);
  sim.step({ pulsePressed: true }); ok(sim.player.energy === 65, 'costs 35');
  secs(sim, 0.5); sim.step({ pulsePressed: true });
  ok(count(drain(sim), 'pulse') === 1 && sim.player.energy === 65, 'cooldown refuses a second pulse at +0.5 s');
  secs(sim, 0.9); ok(sim.player.energy === 65, 'no regeneration before 1.5 s');
  secs(sim, 1.1); near(sim.player.energy, 65 + 20 * 1.0, 1.0, 'regeneration ≈ 20/s after the delay');
  const s2 = new Sim(); tp(s2, 9, 10); s2.step({ pulsePressed: true }); secs(s2, 0.71); s2.step({ pulsePressed: true });
  ok(s2.player.energy === 30, 'second pulse accepted after 0.7 s');
});
test('Pulse', 'insufficient energy: one cue, nothing consumed', () => {
  const sim = new Sim(); tp(sim, 9, 10); sim.player.energy = 20; sim.player.regenDelay = 5; drain(sim);
  sim.step({ pulsePressed: true }); secs(sim, 0.3);
  const ev = drain(sim);
  ok(count(ev, 'pulseDenied') === 1 && count(ev, 'pulse') === 0, 'one denial cue'); ok(sim.player.energy === 20 && sim.pulses.length === 0, 'no energy spent, no wave');
});
test('Pulse', 'radius ≈ 6 u', () => {
  const at = (x) => { const sim = new Sim(); tp(sim, x, 12); sim.step({ pulsePressed: true }); secs(sim, 0.5); return sim.byId.get('seamT').reveal > 0; };
  ok(at(30), 'seam at 5.64 u is reached'); ok(!at(29.3), 'seam at 6.32 u is not reached');
  return 'target at 5.64 u responds, at 6.32 u does not';
});
test('Pulse', 'thick walls block; thin seams transmit', () => {
  const sim = new Sim(); tp(sim, 41, 12); sim.step({ pulsePressed: true }); secs(sim, 0.45);
  ok(sim.byId.get('AR1').reveal <= 0 && sim.pulses[0].blocked.includes('AR1'), 'alcove under the floor is not revealed through rock');
  const s2 = new Sim(); tp(s2, 45.5, 9); s2.step({ pulsePressed: true }); secs(s2, 0.45);
  ok(s2.byId.get('seamH1').reveal > 0 && s2.byId.get('AR1').reveal > 0, 'seam highlighted and the alcove revealed through the thin seam');
});
test('Pulse', 'relay activation is blocked by a closed shutter and by an unpowered socket', () => {
  const sim = new Sim(); tp(sim, 68.6, 13); sim.step({ pulsePressed: true }); secs(sim, 0.45);
  ok(!sim.byId.get('A').active && sim.pulses[0].blocked.includes('A'), 'Relay A stays dark behind the shutter');
  socketIn(sim, 'C1', 'SA'); secs(sim, 1.2); sim.player.energy = 100;
  sim.step({ pulsePressed: true }); secs(sim, 0.45);
  ok(sim.byId.get('A').active, 'Relay A wakes once the shutter is open');
  const s2 = new Sim(); tp(s2, 195.5, 18); drain(s2); s2.step({ pulsePressed: true }); secs(s2, 0.45);
  ok(!s2.byId.get('C').active && count(drain(s2), 'relayDormant') === 1, 'Relay C is dormant without its socket');
});
test('Pulse', 'each target responds at most once per pulse', () => {
  const sim = new Sim(); tp(sim, 46.5, 9); sim.step(); drain(sim);
  sim.step({ pulsePressed: true }); secs(sim, 0.8);
  const ev = drain(sim);
  ok(count(ev, 'stun') === 1, `stun events ${count(ev, 'stun')}`);
  ok(ev.filter((e) => e.type === 'reveal' && e.id === 'seamH1').length === 1, 'one reveal per target');
});

// ═════════════════════════ Damage ═════════════════════════
test('Damage', 'shield threshold; one outcome per hit; immunity windows', () => {
  const sim = new Sim(); tp(sim, 9, 10); const p = sim.player; drain(sim);
  ok(sim.hurt(8, 'test') && p.energy === 50 && p.integrity === 3, 'first hit: shield spends 50, integrity intact');
  near(p.immune, C.shieldImmunity, 1e-9, 'shield immunity');
  ok(!sim.hurt(8, 'test') && p.energy === 50, 'hit during immunity is ignored');
  secs(sim, 0.85); ok(sim.hurt(8, 'test') && p.energy === 0 && p.integrity === 3, 'second hit at exactly 50 energy still shields');
  secs(sim, 0.85); ok(sim.hurt(8, 'test') && p.integrity === 2 && p.energy === 0, 'third hit removes one integrity, no energy');
  near(p.immune, C.hitImmunity, 1e-9, 'damage immunity');
  const s2 = new Sim(); tp(s2, 9, 10); s2.player.energy = 49.9; s2.player.regenDelay = 9;
  s2.hurt(8, 'test'); ok(s2.player.integrity === 2 && s2.player.energy === 49.9, 'below 50 energy: integrity lost, energy untouched');
  const ev = drain(sim);
  ok(count(ev, 'shield') === 2 && count(ev, 'damage') === 1, 'exactly one outcome per accepted hit');
});
test('Damage', 'vent overlap: warning ≥ 0.6 s, a single hit per immunity window', () => {
  const sim = new Sim(); tp(sim, 160, 10); drain(sim);
  let warnAt = -1, fireAt = -1; const hits = [];
  for (let k = 0; k < 400; k++) {
    sim.step();
    for (const e of drain(sim)) {
      if (e.type === 'ventWarn' && e.id === 'V1' && warnAt < 0) warnAt = k;
      if (e.type === 'ventFire' && e.id === 'V1' && fireAt < 0) fireAt = k;
      if (e.type === 'shield' || e.type === 'damage') hits.push(k);
    }
    if (fireAt >= 0) { sim.player.x = 160; sim.player.vx = 0; } // hold ILO inside the jet for the whole active stage
  }
  ok(warnAt > 0 && (fireAt - warnAt) / 120 >= 0.6, `warning ${(fireAt - warnAt) / 120}s`);
  ok(hits.length === 2 && hits[0] === fireAt, `hits ${hits}`);
  ok((hits[1] - hits[0]) / 120 >= C.shieldImmunity - 1e-9, 'continuous overlap cannot hit again inside the immunity window');
  return `first-exposure warning ${((fireAt - warnAt) / 120).toFixed(2)} s; held inside a 1.0 s jet: hits ${((hits[1] - hits[0]) / 120).toFixed(2)} s apart`;
});
test('Damage', 'knockback resolves safely against walls', () => {
  const sim = new Sim(); tp(sim, 12.6, 10); sim.player.energy = 0; sim.player.regenDelay = 9;
  sim.hurt(11, 'test');
  for (let k = 0; k < 120; k++) { sim.step(); ok(!sim.playerBlocked(), 'embedded after knockback'); }
  ok(sim.player.grounded, 'landed after knockback');
});
test('Damage', 'deep water and zero integrity trigger exactly one recovery', () => {
  const sim = new Sim(); tp(sim, 115, 21, false); drain(sim);
  until(sim, () => sim.state === 'shutdown', 2);
  ok(sim.player.energy === 100, 'shield does not absorb deep water');
  ok(sim.shutdownCause === 'water', 'cause water');
  steps(sim, 5, { retryPressed: true });
  until(sim, () => sim.state === 'reboot', 3); steps(sim, 5, { retryPressed: true });
  until(sim, () => sim.state === 'play', 3);
  ok(sim.recoveries === 1 && sim.player.x === 6 && sim.player.y === 10, 'restored at the start station, one recovery');
  const s2 = new Sim(); tp(s2, 9, 10); s2.player.integrity = 1; s2.player.energy = 0; s2.player.regenDelay = 9; drain(s2);
  ok(s2.hurt(8, 'test') && s2.state === 'shutdown', 'shutdown at zero integrity');
  ok(!s2.hurt(8, 'test') && !s2.beginShutdown('integrity'), 'no further damage or second shutdown');
  until(s2, () => s2.state === 'play', 4);
  ok(s2.recoveries === 1 && s2.player.integrity === 3 && s2.player.energy === 100, 'one recovery, full restore');
  near(s2.player.immune, C.rebootImmunity, 0.02, 'short contact immunity after reboot');
});
test('Damage', 'press: sustained closure crushes; side contact does not', () => {
  const sim = new Sim(); tp(sim, 167, 10); drain(sim);
  until(sim, () => sim.state === 'shutdown', 5);
  ok(sim.shutdownCause === 'crush' && sim.player.energy === 100, 'crush ignores the shield');
  until(sim, () => sim.state === 'play', 4); ok(sim.recoveries === 1, 'one recovery');
  const s2 = new Sim(); tp(s2, 165.3, 10);
  until(s2, () => s2.press.phase === 'hold', 5); secs(s2, 0.3, { right: true });
  ok(s2.state === 'play' && s2.player.x <= 166 - HW + 1e-9, 'pressing against the lowered press is ordinary side contact');
  const s3 = new Sim(); tp(s3, 165.76, 10);
  until(s3, () => s3.press.phase === 'hold', 5); secs(s3, 0.2);
  ok(s3.state === 'play' && !s3.playerBlocked(), 'shallow overlap slides out instead of crushing');
});

// ═════════════════════════ Enemies ═════════════════════════
test('Enemies', 'Skitter: telegraph before lunge, no retargeting mid-lunge', () => {
  const sim = new Sim(); tp(sim, 46, 9); sim.player.energy = 0; sim.player.regenDelay = 99; sim.player.immune = 99;
  const k = sim.byId.get('K1');
  until(sim, () => k.state === 'alert', 3);
  const x0 = k.x, dir = k.dir;
  const n = until(sim, () => k.state === 'lunge', 2);
  ok(k.x === x0, 'holds position while telegraphing'); near(n / 120, C.skitter.telegraph, 0.02, 'telegraph time');
  tp(sim, 52, 9);
  let moved = 0;
  while (k.state === 'lunge') { const px = k.x; sim.step(); moved += (k.x - px) * dir; ok(k.dir === dir, 'direction changed mid-lunge'); }
  ok(moved > 0.5 && k.state === 'recover', 'lunge committed, then recovery pause');
  return `telegraph ${(n / 120).toFixed(2)} s; lunge ${moved.toFixed(2)} u in the locked direction`;
});
test('Enemies', 'Skitter patrol stays on its bounded surface', () => {
  const sim = new Sim(); tp(sim, 40, 12); sim.player.immune = 1e9;
  const k = sim.byId.get('K1'); let lo = 99, hi = 0;
  for (let i = 0; i < 120 * 40; i++) { sim.step(); sim.player.immune = 1e9; lo = Math.min(lo, k.x); hi = Math.max(hi, k.x); ok(k.y === 9, 'left its floor'); }
  ok(lo >= 44.6 && hi <= 52.4, `patrol range ${lo}..${hi}`);
  return `x ${lo.toFixed(2)}..${hi.toFixed(2)} over 40 s`;
});
test('Enemies', 'stunned machines are harmless; disables are recorded once', () => {
  const sim = new Sim(); tp(sim, 49, 9); sim.step(); drain(sim);
  const k = sim.byId.get('K1'); k.x = 49; k.state = 'stunned'; k.t = 2;
  secs(sim, 0.5);
  ok(count(drain(sim), 'shield') === 0, 'no contact damage from a stunned Skitter');
  sim.step({ dashPressed: true, right: true }); secs(sim, 0.6);
  sim.step({ dashPressed: true, left: true }); secs(sim, 0.6);
  const ev = drain(sim);
  ok(k.disabled && count(ev, 'disable') === 1 && sim.machinesDisabled === 1, 'one disable recorded');
  ok(count(ev, 'shield') + count(ev, 'damage') === 0, 'a disabled machine deals no contact damage');
});
test('Enemies', 'Prism Drone: aim telegraph, locked shot, bolt cleanup, pulse interrupt', () => {
  const sim = new Sim(); tp(sim, 126, 22); sim.player.immune = 99;
  const d = sim.byId.get('D1'); drain(sim);
  until(sim, () => d.state === 'aim', 2);
  const n = until(sim, () => d.t <= C.drone.aimLock, 2);
  const ax = d.aimX, ay = d.aimY;
  tp(sim, 133, 22); sim.player.immune = 99;
  const m = until(sim, () => sim.bolts.length === 1, 2);
  near((n + m) / 120, C.drone.aim, 0.03, 'aim time');
  const b = sim.bolts[0];
  near(b.vx, ax * C.drone.boltSpeed, 1e-9, 'bolt keeps the locked direction (x)'); near(b.vy, ay * C.drone.boltSpeed, 1e-9, 'bolt keeps the locked direction (y)');
  const life = until(sim, () => sim.bolts.length === 0 || d.state === 'aim', 5);
  ok(life / 120 <= C.drone.boltLife + 0.05, 'bolt expired');
  // interrupt
  const s2 = new Sim(); tp(s2, 126, 22); const d2 = s2.byId.get('D1');
  until(s2, () => d2.state === 'aim', 2); secs(s2, 0.2); drain(s2);
  s2.step({ pulsePressed: true }); secs(s2, 0.3);
  ok(d2.state === 'stunned', 'pulse stuns the drone');
  secs(s2, 1.5);
  ok(count(drain(s2), 'bolt') === 0, 'the interrupted shot never fires');
  // stunned drone can be dashed
  const s3 = new Sim(); tp(s3, 125.3, 23.4, false); const d3 = s3.byId.get('D1'); d3.state = 'stunned'; d3.t = 2; drain(s3);
  s3.step({ dashPressed: true, right: true }); secs(s3, 0.2);
  ok(d3.disabled, 'dash disables a stunned drone');
  return `aim ${((n + m) / 120).toFixed(2)} s; bolt lived ${(life / 120).toFixed(2)} s and stopped at terrain`;
});
test('Enemies', 'Shutter Sentinel: warning, beam lane, cover, deflect, core disable', () => {
  const sim = new Sim(); tp(sim, 143, 22); const t = sim.byId.get('T1'); drain(sim);
  let warn = -1, beam = -1, hit = -1;
  for (let k = 0; k < 120 * 4 && hit < 0; k++) {
    sim.step();
    for (const e of drain(sim)) { if (e.type === 'telegraph') warn = k; if (e.type === 'beam') beam = k; if (e.type === 'shield') hit = k; }
  }
  near((beam - warn) / 120, C.sentinel.warning, 0.02, 'warning time'); ok(hit >= beam, 'beam hits ILO standing in the lane');
  ok(t.laneX0 === 142 && t.laneX1 === 156, `lane ${t.laneX0}..${t.laneX1}`);
  for (const [x, y, label] of [[141.5, 24, 'cover steps'], [147, 20, 'cover recess'], [139, 22, 'behind the cover']]) {
    const s = new Sim(); tp(s, x, y); drain(s); secs(s, 11.5);
    const ev = drain(s);
    ok(count(ev, 'beam') >= 2 && count(ev, 'shield') + count(ev, 'damage') === 0, `${label} must be safe`);
  }
  const s2 = new Sim(); tp(s2, 150.5, 22); const t2 = s2.byId.get('T1'); s2.player.immune = 99; drain(s2);
  s2.step({ pulsePressed: true }); secs(s2, 0.5);
  ok(count(drain(s2), 'deflect') === 1 && !t2.disabled && t2.state === 'closed', 'closed armour deflects the pulse');
  until(s2, () => t2.state === 'venting', 8); s2.player.energy = 100; s2.player.pulseCd = 0;
  s2.step({ pulsePressed: true }); secs(s2, 0.5);
  ok(t2.disabled, 'pulse into the open core disables it');
  drain(s2); secs(s2, 6); ok(count(drain(s2), 'beam') === 0, 'a disabled Sentinel never fires');
  return `warning ${((beam - warn) / 120).toFixed(2)} s; lane x 142..156 stops at the cover steps`;
});
test('Enemies', 'distant machines and hazards do not run their cycles; timers freeze outside play', () => {
  const sim = new Sim(); secs(sim, 10);
  const t = sim.byId.get('T1'), d = sim.byId.get('D1'), k = sim.byId.get('K1');
  ok(t.state === 'closed' && t.t === 0 && d.x === d.ax && k.state === 'dormant' && k.x === 49, 'machines idle while ILO is far away');
  ok(sim.vents.every((v) => v.phase === 'dormant' && !v.awake) && sim.press.phase === 'wait' && sim.press.t === 0, 'hazards idle');
  const s2 = new Sim(); tp(s2, 143, 22); secs(s2, 1); const t2 = s2.byId.get('T1');
  const snap = [t2.state, t2.t, s2.time];
  s2.state = 'relayActivation'; s2.stateT = 0; secs(s2, 1);
  ok(t2.state === snap[0] && t2.t === snap[1] && s2.time === snap[2], 'enemy timers and the run clock freeze during relay activation');
});

// ═════════════════════════ Cells ═════════════════════════
test('Cells', 'pick up; carry speed; dash, pulse and walls unavailable', () => {
  const sim = new Sim(); tp(sim, 59.4, 12); drain(sim);
  sim.step({ interactPressed: true }); ok(sim.player.carry === 'C1', 'picked up');
  tp(sim, 20, 12); secs(sim, 0.5, { right: true }); ok(sim.player.vx === C.carrySpeed, `carry speed ${sim.player.vx}`);
  sim.step({ dashPressed: true, right: true }); sim.step({ pulsePressed: true });
  const ev = drain(sim);
  ok(count(ev, 'dash') === 0 && count(ev, 'pulse') === 0 && count(ev, 'blocked') === 2 && sim.player.energy === 100, 'abilities blocked without cost');
  let max = 0; tp(sim, 20, 12); sim.step({ jumpPressed: true, jumpHeld: true });
  for (let k = 0; k < 120; k++) { sim.step({ jumpHeld: true }); max = Math.max(max, sim.player.y - 12); }
  near(max, 2.62, 0.08, 'ordinary jump while carrying');
});
test('Cells', 'safe placement; rejected in terrain, door columns, air and on movers', () => {
  const sim = new Sim(); tp(sim, 59.4, 12); sim.step({ interactPressed: true });
  tp(sim, 61, 12); sim.player.facing = 1; sim.step({ interactPressed: true });
  const c = sim.byId.get('C1');
  ok(c.state === 'loose' && Math.abs(c.x - 61.95) < 1e-9 && c.y === 12, 'placed in front of ILO');
  tp(sim, 61.4, 12); sim.step({ interactPressed: true }); ok(sim.player.carry === 'C1', 'picked up again');
  tp(sim, 62.5, 12); sim.player.facing = 1; sim.step({ interactPressed: true });
  ok(c.state === 'loose' && !sim.rectHitsTiles(c.x - 0.38, c.y, c.x + 0.38, c.y + 0.9), 'never placed inside terrain');
  tp(sim, c.x, 12); sim.step({ interactPressed: true });
  tp(sim, 68.2, 13); sim.player.facing = 1; sim.step({ interactPressed: true });
  ok(c.state === 'loose' && c.x + 0.38 <= 69, 'not placed in a shutter column');
  tp(sim, c.x, 13); sim.step({ interactPressed: true });
  tp(sim, 60, 14, false); drain(sim); sim.step({ interactPressed: true });
  ok(sim.player.carry === 'C1' && count(drain(sim), 'placeDenied') === 1, 'retained while airborne');
  const s2 = new Sim(); carry(s2, 'C2'); tp(s2, 174.5, 10); s2.player.ground = s2.byId.get('LIFT'); s2.target = s2.computeTarget();
  ok(s2.target.kind === 'place' && !s2.target.ok, 'cannot place on the lift platform');
  tp(s2, 160.3, 10); s2.player.facing = -1;
  const spot = s2.placementSpot();
  ok(spot === null || Math.abs(spot.x - 160) >= C.vent.halfW + 0.38, 'never placed on a vent');
});
test('Cells', 'interaction priority and one-cell sockets', () => {
  const sim = new Sim(); carry(sim, 'C1'); tp(sim, 64.4, 13);
  ok(sim.computeTarget().kind === 'insert', 'carried cell + empty socket → insert');
  sim.step({ interactPressed: true }); ok(sim.byId.get('SA').cell === 'C1', 'inserted');
  const c2 = sim.byId.get('C2'); c2.x = 64.6; c2.y = 13;
  ok(sim.computeTarget().kind === 'pickup' && sim.computeTarget().id === 'C2', 'loose cell before a socketed cell');
  sim.step({ interactPressed: true }); ok(sim.player.carry === 'C2', 'picked the loose cell');
  ok(sim.computeTarget().kind === 'place', 'occupied socket does not accept a second cell');
  sim.step({ interactPressed: true });
  ok(sim.byId.get('SA').cell === 'C1' && c2.state === 'loose', 'second cell placed, socket unchanged');
  c2.x = 170.5; c2.y = 10;
  ok(sim.computeTarget().kind === 'remove', 'then the socketed cell');
  cellInvariant(sim);
});
test('Cells', 'no duplication through repeated input (fuzz) or checkpoint recovery', () => {
  const sim = new Sim(); tp(sim, 60, 12);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 6000; k++) {
    const r = rnd();
    sim.step({ interactPressed: r < 0.08, right: rnd() < 0.5, left: rnd() < 0.45, jumpPressed: rnd() < 0.02, jumpHeld: true });
    if (k % 50 === 0) cellInvariant(sim);
  }
  cellInvariant(sim);
  const s2 = new Sim(); socketIn(s2, 'C1', 'SA'); s2.commit('S0');
  tp(s2, 64.4, 13); s2.step({ interactPressed: true }); ok(s2.player.carry === 'C1', 'removed after the commit');
  s2.beginShutdown('retry'); until(s2, () => s2.state === 'play', 4);
  ok(s2.byId.get('SA').cell === 'C1' && s2.player.carry === null && s2.byId.get('C1').state === 'socket', 'recovery restores socket ownership');
  cellInvariant(s2);
  const s3 = new Sim(); carry(s3, 'C1'); s3.commit('S0'); s3.beginShutdown('retry'); until(s3, () => s3.state === 'play', 4);
  const c = s3.byId.get('C1');
  ok(c.state === 'loose' && c.x === 5 && c.y === 10 && s3.player.carry === null, 'a carried cell is committed resting beside the station');
  cellInvariant(s3);
});

// ═════════════════════════ Route / puzzles / ending ═════════════════════════
let mainRun = null, fullRun = null;
test('Main route', 'full completion with ordinary inputs, no optional discoveries', () => {
  mainRun = runRoute(mainRoute);
  const { sim, bot } = mainRun, r = sim.result;
  ok(sim.state === 'complete' && r && r.relays.every((x) => x.active), 'completed with three relays');
  ok(r.archives === 0 && r.caches === 0, 'no optional discoveries used'); ok(sim.recoveries === 0, 'no recoveries');
  ok(sim.seams.filter((s) => s.style === 'hidden').every((s) => !s.broken), 'no hidden seam used');
  ok(sim.player.integrity === 3, 'no integrity lost');
  return `time ${formatTime(r.time)}, recoveries ${r.recoveries}, shield absorptions ${bot.shieldHits}, integrity lost ${bot.damageHits}, machines disabled ${r.machines}`;
});
test('Exploration', 'all three archive routes and all caches in one run', () => {
  fullRun = runRoute(fullRoute);
  const { sim } = fullRun, r = sim.result;
  ok(sim.state === 'complete' && r.archives === 3 && r.caches === 3 && r.fullArchive, 'full-archive completion');
  return `time ${formatTime(r.time)}, archives ${r.archives}/3, caches ${r.caches}/3, recoveries ${r.recoveries}`;
});
test('Puzzles', 'workshop circuit: removing the cell closes the shutter but never strands ILO', () => {
  const { sim, bot } = midRun('relayA');
  ok(sim.byId.get('A').active && sim.byId.get('doorA').open === 1, 'door A open after Relay A');
  bot.go(65.8); bot.interact(); ok(bot.p.carry === 'C1', 'cell removed from SA');
  bot.wait(1.5);
  ok(sim.byId.get('shutterA').open === 0 && sim.byId.get('A').active && sim.byId.get('doorA').open === 1, 'shutter closed, relay and its door unaffected');
  bot.go(64.6); bot.interact(); bot.wait(1); ok(sim.byId.get('shutterA').open === 1, 'reinserting reopens the route');
});
test('Puzzles', 'shutters never close through ILO or a cell', () => {
  const sim = new Sim(); socketIn(sim, 'C1', 'SA'); secs(sim, 1);
  const d = sim.byId.get('shutterA'); ok(d.open === 1, 'open');
  tp(sim, 69.5, 13); const so = sim.byId.get('SA'), c = sim.byId.get('C1');
  so.cell = null; c.state = 'loose'; c.socket = null; c.x = 60; c.y = 12;
  for (let k = 0; k < 240; k++) { sim.step(); ok(!sim.playerBlocked(), 'door closed through ILO'); }
  ok(d.open === 1, 'held open while ILO stands in the column');
  tp(sim, 72, 13); secs(sim, 1); ok(d.open === 0, 'closes once clear');
});
test('Puzzles', 'foundry: latch persists, cell reusable, relay survives cell removal', () => {
  const { sim, bot } = midRun('relayC');
  ok(sim.byId.get('C').active && sim.byId.get('doorC').open === 1, 'Relay C active');
  bot.go(193.6); bot.interact(); ok(bot.p.carry === 'C2', 'cell removed from the relay socket');
  bot.wait(1);
  ok(sim.byId.get('C').active && sim.byId.get('doorC').open === 1 && sim.byId.get('gateF').open === 1, 'relay, door C and latch gate persist');
  bot.go(179, { maxSec: 30 }); bot.interact(); ok(sim.byId.get('SL').cell === 'C2', 'puzzle is reversible: cell back in the lift socket');
});
test('Puzzles', 'lift waits instead of crushing; platform carries without boosting jumps', () => {
  const sim = new Sim(); socketIn(sim, 'C2', 'SL'); tp(sim, 150.5, 10);
  const lift = sim.byId.get('LIFT');
  until(sim, () => lift.phase === 2, 10); tp(sim, 174.5, 9);
  for (let k = 0; k < 120 * 12; k++) { sim.step(); ok(!sim.playerBlocked(), 'lift pressed into ILO'); }
  ok(sim.state === 'play' && lift.y0 >= 9 + C.bodyH - 1e-9 && lift.stalled, 'lift stalls above ILO in the pit');
  const s2 = new Sim(); s2.byId.get('SWB').on = true; tp(s2, 106, 22); const m = s2.byId.get('P1');
  until(s2, () => m.phase === 0 && m.u === 0, 15); tp(s2, 110, 22); s2.step();
  ok(s2.player.ground === m, 'boarded');
  const pauseSteps = until(s2, () => m.phase === 1, 5);
  near(pauseSteps / 120, m.pause, 0.05, 'boarding pause');
  secs(s2, 1);
  const x0 = s2.player.x, mx0 = m.x; secs(s2, 1);
  near(s2.player.x - x0, m.x - mx0, 1e-9, 'rider displacement equals platform displacement');
  s2.step({ jumpPressed: true, jumpHeld: true });
  near(s2.player.vy, C.jumpSpeed - C.gravity * DT, 1e-9, 'jump velocity is not amplified by the platform');
  ok(s2.player.vx === 0, 'no inherited velocity');
  return `dock pause ${(pauseSteps / 120).toFixed(2)} s; rider tracks platform exactly`;
});

// ═════════════════════════ Checkpoints ═════════════════════════
test('Checkpoints', 'relay commit is atomic; later changes roll back; committed state survives', () => {
  const { sim } = midRun('relayA', true);   // includes Archive 1
  ok(sim.checkpointId === 'S1' && sim.archivesFound === 1, 'S1 committed with one archive');
  const timeBefore = sim.time;
  // later, uncommitted changes
  tp(sim, 105.3, 32); sim.step({ interactPressed: true }); ok(sim.byId.get('SWB').on, 'switch thrown');
  tp(sim, 95.6, 38); sim.step({ interactPressed: true }); ok(sim.archivesFound === 2, 'archive 2 taken');
  tp(sim, 89.3, 13); sim.step({ dashPressed: true, right: true }); secs(sim, 0.3, { right: true }); ok(sim.byId.get('seamH2').broken, 'seam broken');
  tp(sim, 95.4, 13); sim.step({ interactPressed: true }); ok(sim.cachesFound === 1, 'cache taken');
  tp(sim, 64.4, 13); sim.step({ interactPressed: true }); ok(sim.player.carry === 'C1', 'cell pulled from SA');
  die(sim);
  const p = sim.player, id = (k) => sim.byId.get(k);
  ok(p.x === 77 && p.y === 13 && p.vx === 0 && p.vy === 0 && p.integrity === 3 && p.energy === 100 && p.carry === null, 'ILO restored at station S1');
  ok(id('A').active && id('SA').cell === 'C1' && id('shutterA').open === 1 && id('doorA').open === 1, 'relay, socket and both doors restored together');
  ok(id('K1').disabled && id('seamT').broken && id('seamH1').broken && id('AR1').collected, 'committed disables, seams and archive kept');
  ok(!id('SWB').on && !id('AR2').collected && !id('seamH2').broken && id('seamH2').solid && !id('CA1').collected, 'uncommitted switch, archive, seam and cache rolled back');
  ok(id('P1').u === 1 && id('P1').x === 122, 'platform parked at its deterministic position');
  ok(sim.recoveries === 1 && sim.time > timeBefore, 'one recovery; run time not rewound');
  ok(sim.bolts.length === 0 && sim.pulses.length === 0 && !sim.playerBlocked(), 'transients cleared, ILO not embedded');
  cellInvariant(sim);
});
test('Checkpoints', 'retry adds one recovery, keeps progress, never rewinds the clock', () => {
  const { sim } = midRun('relayA');
  const t0 = sim.time;
  sim.step({ retryPressed: true }); ok(sim.state === 'shutdown', 'retry starts recovery');
  steps(sim, 20, { retryPressed: true });
  until(sim, () => sim.state === 'play', 4, { retryPressed: false });
  ok(sim.recoveries === 1 && sim.byId.get('A').active && sim.player.x === 77, 'one recovery at S1 with Relay A kept');
  ok(sim.time >= t0 && sim.time - t0 < 0.05, 'clock neither rewound nor advanced during the recovery presentation');
  return `clock ${t0.toFixed(2)} → ${sim.time.toFixed(2)} s across the retry`;
});
test('Checkpoints', 'restore is deterministic and repeatable (lifecycle)', () => {
  const { sim } = midRun('relayB');
  const sig = () => JSON.stringify([sim.player.x, sim.player.y, sim.cells, sim.sockets, sim.switches.map((s) => s.on), sim.movers.map((m) => [m.u, m.phase, m.pt]),
    sim.doors.map((d) => d.open), sim.enemies.map((e) => [e.x, e.y, e.state]), sim.vents.map((v) => [v.phase, v.t]), sim.press.phase]);
  sim.restore(); const a = sig(); const sizes = [sim.dyn.length, sim.enemies.length, sim.byId.size];
  for (let k = 0; k < 60; k++) { secs(sim, 0.3, { right: k % 2 === 0, jumpPressed: k % 7 === 0 }); sim.state = 'play'; sim.beginShutdown('retry'); until(sim, () => sim.state === 'play', 4); }
  sim.restore();
  ok(sig() === a, 'identical world after 60 recoveries');
  ok(sim.dyn.length === sizes[0] && sim.enemies.length === sizes[1] && sim.byId.size === sizes[2] && sim.events.length <= 256 && sim.bolts.length === 0, 'no accumulated entities or events');
  for (let k = 0; k < 20; k++) sim.reset();
  ok(sim.relaysActive === 0 && sim.time === 0 && sim.recoveries === 0 && sim.dyn.length === sizes[0] && sim.byId.get('C1').x === 60, 'full restart yields a fresh world');
  return `world signature stable; dyn=${sizes[0]}, enemies=${sizes[1]}`;
});

// ═════════════════════════ Ending ═════════════════════════
test('Ending', 'lift gated by all three relay IDs and the boarding area', () => {
  const sim = new Sim(); tp(sim, 209.2, 40); sim.player.ground = sim.mainLift; drain(sim);
  for (let k = 0; k < 10; k++) sim.step({ interactPressed: true });
  ok(sim.state === 'play' && sim.resultCommits === 0 && count(drain(sim), 'liftDenied') === 10, 'repeated interaction cannot fabricate progress');
  sim.byId.get('A').active = true; sim.byId.get('C').active = true; sim.step({ interactPressed: true });
  ok(sim.state === 'play' && sim.resultCommits === 0, 'two relays are not enough');
  sim.byId.get('B').active = true; tp(sim, 211.3, 40); drain(sim); sim.step({ interactPressed: true });
  const ev = drain(sim);
  ok(sim.state === 'play' && ev.some((e) => e.type === 'liftDenied' && e.reason === 'board'), 'must stand inside the boarding area');
  tp(sim, 209.2, 40); sim.step({ interactPressed: true }); ok(sim.state === 'liftSequence' && sim.resultCommits === 1, 'departs when every condition holds');
});
test('Ending', 'one result commit, clock stops, lift sequence completes, replay is clean', () => {
  const { sim } = mainRun;
  ok(sim.resultCommits === 1 && sim.result.time === sim.time, 'result committed once at departure; clock stopped');
  const s2 = new Sim(); for (const r of s2.relays) r.active = true; tp(s2, 209.2, 40); s2.player.ground = s2.mainLift; secs(s2, 0.5);
  s2.step({ interactPressed: true }); const t = s2.time; drain(s2);
  let n = 0; while (s2.state === 'liftSequence' && n < 3000) { s2.step({ interactPressed: true, jumpPressed: true, right: true, retryPressed: true }); n++; ok(!s2.hurt(0, 'test'), 'damage disabled during the lift sequence'); }
  ok(s2.state === 'complete' && s2.resultCommits === 1 && s2.time === t && s2.recoveries === 0, 'input, retry and damage ignored; single commit; clock frozen');
  ok(s2.player.y === 64 && s2.player.x >= s2.mainLift.exitX && s2.mainLift.yTop === 64, 'ILO arrives on the surface terrace');
  ok(count(drain(s2), 'complete') === 1, 'one completion event');
  s2.reset(); ok(s2.state === 'play' && s2.result === null && s2.relaysActive === 0 && s2.mainLift.yTop === 40, 'new expedition starts fresh');
  return `lift sequence ${(n / 120).toFixed(1)} s`;
});

// ═════════════════════════ Records ═════════════════════════
const mem = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; };
const res = (time, recoveries, archives, done = true) => ({ time, recoveries, archives, caches: 0, machines: 0, relays: ['A', 'B', 'C'].map((id) => ({ id, active: done || id !== 'C' })) });
test('Records', 'completion-only saves, full-archive qualification, tie-breaking', () => {
  const st = mem(); const store = new RecordStore(st);
  store.submit(res(300, 4, 0, false)); ok(store.records.bestTime === null && !(STORAGE_KEY in st._m && JSON.parse(st._m[STORAGE_KEY]).bestTime), 'incomplete expedition is not recorded');
  store.submit(res(300, 4, 1)); ok(store.records.bestTime === 300 && store.records.bestFullArchiveTime === null, 'two archives do not qualify for the full-archive record');
  store.submit(res(350, 2, 3)); ok(store.records.bestTime === 300 && store.records.bestFullArchiveTime === 350 && store.records.fewestRecoveries.recoveries === 2, 'full-archive time and fewer recoveries recorded');
  store.submit(res(250, 5, 0)); ok(store.records.bestTime === 250 && store.records.fewestRecoveries.recoveries === 2, 'faster time does not beat fewer recoveries');
  store.submit(res(340, 2, 0)); ok(store.records.fewestRecoveries.time === 340, 'equal recoveries: faster time breaks the tie');
  store.submit(res(345, 2, 0)); ok(store.records.fewestRecoveries.time === 340, 'slower tie does not replace');
  const reload = new RecordStore(st);
  ok(JSON.stringify(reload.records) === JSON.stringify(store.records), 'records reload from storage');
});
test('Records', 'corrupt, incompatible, unavailable or full storage never interrupts play', () => {
  ok(new RecordStore(mem({ [STORAGE_KEY]: '{not json' })).records.bestTime === null, 'corrupt JSON ignored');
  ok(new RecordStore(mem({ [STORAGE_KEY]: JSON.stringify({ version: RECORDS_VERSION + 1, bestTime: 10 }) })).records.bestTime === null, 'other version ignored');
  const bad = validateRecords({ version: RECORDS_VERSION, bestTime: -5, bestFullArchiveTime: 'fast', fewestRecoveries: { recoveries: 1.5, time: NaN } });
  ok(JSON.stringify(bad) === JSON.stringify(emptyRecords()), 'invalid fields dropped');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const s = new RecordStore(throwing); const imp = s.submit(res(200, 0, 3));
  ok(imp.bestTime && s.records.bestTime === 200 && !s.persisted, 'in-memory records kept when storage throws');
  const none = new RecordStore(null); none.submit(res(100, 1, 0)); ok(none.records.bestTime === 100, 'works with no storage at all');
  ok(!isCompletedResult(null) && !isCompletedResult({ time: 5 }) && applyResult(null, null).records.bestTime === null, 'defensive against missing results');
  ok(isCompletedResult(mainRun.sim.result) && isCompletedResult(fullRun.sim.result), 'real results qualify');
});

// ═════════════════════════ report ═════════════════════════
let failed = 0, area = '';
for (const r of results) {
  if (!r.ok) failed++;
  if (!verbose && r.ok) continue;
  if (r.area !== area) { area = r.area; console.log(`\n${area}`); }
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.note ? ` — ${r.note}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) process.exit(1);
