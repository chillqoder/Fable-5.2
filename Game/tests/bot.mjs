// DEEPWAKE — scripted player.
// Drives the real simulation with ordinary inputs only (no teleports, no state edits, no
// damage protection). Used by the Node checks and by the in-browser rendered playthrough.
// It has no Node-only dependencies, so the page can import it directly.

export class Bot {
  /**
   * @param sim the live Sim instance
   * @param stepFn optional function(input) that advances the sim one fixed step
   *        (the browser passes the game's own step so events reach audio/effects)
   */
  constructor(sim, stepFn = null) {
    this.sim = sim;
    this.stepFn = stepFn || ((inp) => sim.step(inp));
    this.steps = 0;
    this.collect = !stepFn;   // in Node, the bot owns the event queue
    this.log = [];            // collected events
    this.shieldHits = 0;
    this.damageHits = 0;
  }

  get p() { return this.sim.player; }

  tick(inp = {}) {
    this.stepFn(inp);
    this.steps++;
    if (this.collect) {
      for (const e of this.sim.events) {
        if (e.type === 'shield') this.shieldHits++;
        if (e.type === 'damage') this.damageHits++;
        this.log.push(e);
      }
      this.sim.events.length = 0;
      if (this.log.length > 4000) this.log.splice(0, 2000);
    }
  }

  fail(msg) {
    const p = this.p, s = this.sim;
    throw new Error(`${msg} @ x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} vx=${p.vx.toFixed(2)} vy=${p.vy.toFixed(2)} ` +
      `grounded=${p.grounded} state=${s.state} time=${s.time.toFixed(2)} integrity=${p.integrity} energy=${p.energy.toFixed(0)} recoveries=${s.recoveries}`);
  }

  /** Run fn(k) every step until it returns true. fn returns the input for that step. */
  run(label, fn, maxSec = 20) {
    const max = Math.round(maxSec * 120);
    for (let k = 0; k < max; k++) {
      const inp = fn(k);
      if (inp === true) return;
      this.tick(inp || {});
    }
    this.fail(`timeout: ${label}`);
  }

  wait(sec, inp = {}) { const n = Math.round(sec * 120); for (let k = 0; k < n; k++) this.tick(inp); }
  waitFor(label, pred, maxSec = 15, inp = {}) { this.run(label, () => (pred() ? true : inp), maxSec); }
  waitPlay(maxSec = 8) { this.waitFor('state play', () => this.sim.state === 'play', maxSec); }
  settle() { this.run('settle', () => (this.p.grounded && Math.abs(this.p.vx) < 0.05 ? true : {}), 4); }

  /** Walk to x. Jumps automatically when a step blocks the way. */
  go(x, { jump = true, tol = 0.12, maxSec = 15, stop = true } = {}) {
    const dir = x > this.p.x ? 1 : -1;
    this.run(`go ${x}`, () => {
      const p = this.p;
      const left = (x - p.x) * dir;
      if (!stop) { if (left <= tol) return true; }
      else if (p.grounded) { if (left <= tol + (p.vx * p.vx) / (2 * 38)) return true; }
      else if (left <= tol + 0.25) {
        // airborne at the target: counter-steer so the landing stays near x
        if (p.vx * dir > 0.4) return dir > 0 ? { left: true, jumpHeld: true } : { right: true, jumpHeld: true };
        return { jumpHeld: true };
      }
      const inp = { jumpHeld: true };
      if (dir > 0) inp.right = true; else inp.left = true;
      if (jump && p.grounded && this.sim.solidPoint(p.x + dir * 0.55, p.y + 0.25)) inp.jumpPressed = true;
      return inp;
    }, maxSec);
    if (stop) this.settle();
  }

  /** Jump (held) while holding a direction until ILO lands again. */
  leap(dir) {
    const d = dir > 0 ? 'right' : 'left';
    this.tick({ jumpPressed: true, jumpHeld: true, [d]: true });
    this.run('leap', () => (this.p.grounded ? true : { jumpHeld: true, [d]: true }), 5);
  }

  /** Climb a shaft by wall jumps and leave through an opening on the exitDir side at exitY. */
  climb(exitDir, exitY, { startDir = exitDir, maxSec = 25 } = {}) {
    let dir = startDir;
    let groundedSteps = 0;
    this.run('climb', () => {
      const p = this.p;
      if (p.grounded) groundedSteps++; else groundedSteps = 0;
      if (p.grounded && p.y >= exitY - 0.01) return true;
      const inp = { jumpHeld: true };
      if (dir > 0) inp.right = true; else inp.left = true;
      if (p.grounded && groundedSteps > 3) { inp.jumpPressed = true; dir = startDir; return inp; }
      if (!p.grounded && p.wallDir === dir && p.vy <= 1) {
        const atExit = dir === exitDir && p.y >= exitY - 0.2;
        if (!atExit) { inp.jumpPressed = true; dir = -dir; }
      }
      return inp;
    }, maxSec);
    this.settle();
  }

  energy(n) { this.waitFor(`energy ${n}`, () => this.p.energy >= n && this.p.pulseCd <= 0, 10); }
  pulse() { this.energy(35); this.tick({ pulsePressed: true }); }
  /** Pulse, then wait for the expanding wave to produce the expected response. */
  pulseUntil(label, pred) { this.pulse(); this.waitFor(label, pred, 0.6); }
  interact() { this.tick({ interactPressed: true }); }
  dash(dir) { this.tick({ dashPressed: true, [dir > 0 ? 'right' : 'left']: true }); }
  expect(cond, msg) { if (!cond) this.fail(`expectation failed: ${msg}`); }
}

/**
 * Route segments. `mainRoute` uses only required mechanisms: no archives, no caches, no hidden
 * seams. `fullRoute` splices in every optional discovery. Enemy disables along the way are the
 * taught interactions; nothing here edits simulation state.
 */
function segments(sim) {
  const id = (k) => sim.byId.get(k);
  const vent = (vid) => sim.vents.find((v) => v.id === vid);
  const ventRests = (v) => v.phase === 'dormant' && v.t > 0 && v.t % 3.3 < 0.35;
  return {
    steps: ['workshop: steps and gap', (b) => {
      b.go(12.3, { stop: false });
      b.leap(1);                       // safe steps
      b.expect(b.p.y >= 11, 'on the steps');
      b.go(24.4, { stop: false });
      b.leap(1);                       // small gap
      b.expect(b.p.y === 12 && b.p.x > 28, 'crossed the gap');
    }],
    seam: ['workshop: training seam', (b) => {
      b.go(33.4, { stop: false });
      b.dash(1);
      b.wait(0.3, { right: true });
      b.expect(id('seamT').broken, 'training seam shattered');
      b.go(43.3);
    }],
    skitter: ['workshop: skitter', (b) => {
      const k = id('K1');
      b.waitFor('skitter approaches', () => k.x < 47.4 && k.state !== 'dormant', 30);
      b.pulseUntil('skitter stunned', () => k.state === 'stunned');
      b.run('drop to skitter', () => {
        const p = b.p;
        if (p.grounded && p.y < 9.1) return true;
        return k.x - p.x > 0.3 ? { right: true } : {};
      }, 4);
      b.dash(k.x >= b.p.x ? 1 : -1);
      b.wait(0.25);
      b.expect(k.disabled, 'skitter disabled by dash while stunned');
    }],
    trench: ['workshop: leave the trench', (b) => {
      b.go(56.5);
      b.expect(b.p.y === 12, 'left the trench');
    }],
    relayA: ['workshop: cell circuit and Relay A', (b) => {
      b.go(59.4);
      b.interact();
      b.expect(b.p.carry === 'C1', 'carrying C1');
      b.go(64.2);
      b.interact();
      b.expect(id('SA').cell === 'C1' && b.p.carry === null, 'C1 inserted in SA');
      b.go(72.5);
      b.pulseUntil('Relay A active', () => id('A').active && sim.state === 'relayActivation');
      b.waitPlay();
      b.go(77);
      b.expect(sim.checkpointId === 'S1', 'checkpoint S1');
      b.go(88.2);
    }],
    shaft1: ['reservoir: first shaft', (b) => {
      b.climb(1, 22);
      b.expect(b.p.y === 22 && b.p.x > 91, 'reached the upper cavern');
      b.go(94.5);
      b.expect(sim.checkpointId === 'SR', 'checkpoint SR');
    }],
    switchB: ['reservoir: power switch', (b) => {
      b.go(100.6);
      b.climb(1, 32);
      b.expect(b.p.y === 32 && b.p.x > 103, 'reached the switch pocket');
      b.go(105.3);
      b.interact();
      b.expect(id('SWB').on, 'bridge power on');
    }],
    cavern: ['reservoir: return to the cavern', (b) => {
      b.go(102.4, { stop: false });
      b.waitFor('land in cavern', () => b.p.grounded && b.p.y === 22, 8, { left: true });
      b.settle();
    }],
    relayB: ['reservoir: crossing and Relay B', (b) => {
      const m = id('P1');
      b.go(107.2);
      b.waitFor('platform docks left', () => m.phase === 0 && m.pt < 0.8, 30);
      b.go(110);
      b.expect(b.p.ground === m, 'standing on the platform');
      b.waitFor('platform docks right', () => m.phase === 2, 20);
      b.go(127, { stop: false });
      b.pulseUntil('Relay B active', () => id('B').active);
      b.waitPlay();
      b.go(134);
      b.expect(sim.checkpointId === 'S2', 'checkpoint S2');
    }],
    sentinel: ['foundry: sentinel corridor', (b) => {
      const t = id('T1');
      b.go(141.5);
      b.expect(b.p.y === 24, 'on the cover steps');
      b.waitFor('sentinel fires', () => t.state === 'firing', 12);
      b.waitFor('sentinel vents', () => t.state === 'venting', 3);
      b.go(145.3, { stop: false });
      b.leap(1);                       // over the cover recess
      b.expect(b.p.y === 22, 'landed past the recess');
      b.pulseUntil('sentinel disabled through its open core', () => t.disabled);
    }],
    drop: ['foundry: drop into the hall', (b) => {
      b.go(152.6, { stop: false });
      b.waitFor('drop into the hall', () => b.p.grounded && b.p.y === 10, 6);
      b.go(157);
      b.expect(sim.checkpointId === 'SF', 'checkpoint SF');
    }],
    hazards: ['foundry: vents and press', (b) => {
      const v1 = vent('V1'), v2 = vent('V2'), pr = sim.press;
      b.go(158.9);
      b.waitFor('vent 1 rests', () => ventRests(v1), 10);
      b.go(161.6);
      b.waitFor('vent 2 rests', () => ventRests(v2), 10);
      b.go(165.1);
      b.waitFor('press resets', () => pr.phase === 'wait' && pr.t < 0.3, 10);
      b.go(169.9);
    }],
    latch: ['foundry: counterweight lift and latch', (b) => {
      const lift = id('LIFT');
      b.interact();
      b.expect(b.p.carry === 'C2', 'carrying C2');
      b.go(177.2);
      b.interact();
      b.expect(id('SL').cell === 'C2', 'C2 inserted in the lift socket');
      b.go(174.6);
      b.expect(b.p.ground === lift, 'on the lift');
      b.waitFor('lift at top', () => lift.phase === 2, 12);
      b.go(170.3);
      b.interact();
      b.expect(id('SWU').on, 'route latch thrown');
    }],
    retrieve: ['foundry: retrieve the cell', (b) => {
      b.go(174.5);
      b.waitFor('back at the bottom', () => b.p.grounded && b.p.y === 10, 20);
      b.go(177.2);
      b.interact();
      b.expect(b.p.carry === 'C2' && id('SL').cell === null, 'C2 removed from the lift socket');
      b.expect(id('gateF').target === 1, 'latch gate stays open without the cell');
    }],
    relayC: ['foundry: Relay C', (b) => {
      b.go(192.2, { maxSec: 30 });
      b.expect(b.p.y === 18, 'climbed the service stair with the cell');
      b.interact();
      b.expect(id('SC').cell === 'C2', 'C2 inserted in the relay socket');
      b.go(195.5);
      b.pulseUntil('Relay C active', () => id('C').active);
      b.waitPlay();
      b.go(201.5);
      b.expect(sim.checkpointId === 'S3', 'checkpoint S3');
      b.go(216);
      b.expect(sim.checkpointId === 'S4', 'checkpoint S4');
    }],
    chimney: ['ascent: chimney', (b) => {
      b.go(211.2);
      b.expect(b.p.y === 20, 'on the service block');
      b.climb(1, 30);
      b.expect(b.p.y === 30 && b.p.x > 213, 'reached service room 2');
    }],
    chimneyCache: ['ascent: chimney and cache 3', (b) => {
      b.go(211.2);
      b.climb(-1, 30);
      b.expect(b.p.y === 30 && b.p.x < 209, 'reached the side ledge');
      b.go(208.2);
      b.interact();
      b.expect(id('CA3').collected, 'cache 3 collected');
      b.go(208.55);
      b.leap(1);
      if (b.p.y < 30) b.climb(1, 30);
      b.go(214.2);
      b.expect(b.p.y === 30 && b.p.x > 213, 'reached service room 2');
    }],
    service: ['ascent: vent and service platform', (b) => {
      const v3 = vent('V3'), m = id('P2');
      b.go(216.1);
      b.waitFor('vent 3 rests', () => ventRests(v3), 10);
      b.go(219.6);
      b.waitFor('platform at the bottom', () => m.phase === 0 && m.pt < 1.0, 30);
      b.go(222.5);
      b.expect(b.p.ground === m, 'on the service platform');
      b.waitFor('platform at the top', () => m.phase === 2, 12);
    }],
    lift: ['ascent: main lift', (b) => {
      b.go(209.2);
      b.expect(sim.aboardLift(), 'aboard the main lift');
      b.interact();
      b.expect(sim.state === 'liftSequence', 'lift sequence started');
      b.waitFor('expedition complete', () => sim.state === 'complete', 30);
    }],

    // ── optional discoveries ──
    // Workshop alcove: from inside the trench the pulse marks the seam; a dash breaks it.
    archive1: ['optional: workshop archive', (b) => {
      const s = id('seamH1');
      b.go(46.5);
      b.pulseUntil('hidden seam highlighted by the pulse', () => s.reveal > 0);
      b.go(45.6, { stop: false });
      b.dash(-1);
      b.wait(0.3, { left: true });
      b.expect(s.broken, 'hidden seam broken');
      b.go(41.2);
      b.interact();
      b.expect(id('AR1').collected, 'archive 1 collected');
      b.go(46);
    }],
    // Reservoir side passage at the foot of the first shaft.
    cache1: ['optional: reservoir side passage', (b) => {
      const s = id('seamH2');
      b.go(88.6);
      b.pulseUntil('side passage seam highlighted', () => s.reveal > 0);
      b.go(89.3, { stop: false });
      b.dash(1);
      b.wait(0.3, { right: true });
      b.expect(s.broken, 'side passage opened');
      b.go(95.4);
      b.interact();
      b.expect(id('CA1').collected, 'cache 1 collected');
      b.go(88.2);
    }],
    // Upper reservoir shelf: continue the wall-jump route above the switch pocket.
    archive2: ['optional: reservoir shelf archive', (b) => {
      b.go(103.7);
      b.climb(-1, 38, { startDir: -1 });
      b.expect(b.p.y === 38 && b.p.x < 99, 'reached the upper shelf');
      b.go(95.6);
      b.interact();
      b.expect(id('AR2').collected, 'archive 2 collected');
      b.go(99.6, { stop: false });
      b.waitFor('drop from the shelf', () => b.p.grounded && b.p.y <= 32, 10, { right: true });
      b.settle();
    }],
    // Sentinel's foot: only reachable by crossing the whole firing lane.
    cache2: ['optional: sentinel cache', (b) => {
      b.go(150.4, { stop: false });
      b.leap(1);
      b.expect(b.p.y === 22 && b.p.x > 154, 'crossed the drop shaft');
      b.go(155.1);
      b.interact();
      b.expect(id('CA2').collected, 'cache 2 collected');
    }],
    // Foundry service room: open only while the lift socket is powered (secondary conduit).
    archive3: ['optional: foundry service room', (b) => {
      const lift = id('LIFT');
      b.expect(id('serviceDoor').target === 1, 'service door powered by the secondary conduit');
      b.waitFor('lift returns to the top', () => lift.phase === 2 && lift.pt < 0.3, 25);
      b.go(179.4);
      b.interact();
      b.expect(id('AR3').collected, 'archive 3 collected');
    }],
  };
}

const MAIN = ['steps', 'seam', 'skitter', 'trench', 'relayA', 'shaft1', 'switchB', 'cavern', 'relayB',
  'sentinel', 'drop', 'hazards', 'latch', 'retrieve', 'relayC', 'chimney', 'service', 'lift'];
const FULL = ['steps', 'seam', 'skitter', 'archive1', 'trench', 'relayA', 'cache1', 'shaft1', 'switchB', 'archive2',
  'cavern', 'relayB', 'sentinel', 'cache2', 'drop', 'hazards', 'latch', 'archive3', 'retrieve', 'relayC',
  'chimneyCache', 'service', 'lift'];

export function mainRoute(sim) { const s = segments(sim); return MAIN.map((k) => s[k]); }
export function fullRoute(sim) { const s = segments(sim); return FULL.map((k) => s[k]); }
/** Segments up to (and including) a key — used by checks that need a mid-run world. */
export function routeUntil(sim, key, full = false) {
  const s = segments(sim), list = full ? FULL : MAIN;
  return list.slice(0, list.indexOf(key) + 1).map((k) => s[k]);
}
export function playRoute(bot, route) { for (const [, fn] of route) fn(bot); }
