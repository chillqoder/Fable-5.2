// DEEPWAKE — entry point: explicit game states, fixed-step loop, and the glue between the
// authoritative simulation, the renderer, audio, UI and persistent records.

import { Sim } from './sim.js';
import { DT } from './config.js';
import { REGIONS } from './level.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { RecordStore, SettingsStore } from './records.js';
import { Renderer } from './render/renderer.js';

const MAX_STEPS_PER_FRAME = 12;   // capped accumulator: a long frame never causes a simulation burst

class Game {
  constructor() {
    this.sim = new Sim();
    this.records = new RecordStore();
    this.settings = new SettingsStore();
    this.audio = new AudioEngine();
    this.audio.muted = this.settings.values.muted;
    this.mode = 'title';            // title | play | paused | complete  (the sim holds play sub-states)
    this.acc = 0;
    this.animT = 0;
    this.last = 0;
    this.pendingRetry = false;
    this.botDriving = false;
    this.toastGate = new Map();
    this.frames = 0;

    this.ui = new UI({
      begin: () => this.begin(),
      resume: () => this.resume(),
      retry: () => { this.resume(); this.pendingRetry = true; },
      restart: () => this.restart(),
      newExpedition: () => this.restart(),
      togglePause: () => this.togglePause(),
      setMuted: (m) => this.setMuted(m),
      setReducedMotion: (v) => { this.settings.set('reducedMotion', v); this.ui.setReducedMotion(v); },
    });
    this.ui.setMuted(this.settings.values.muted);
    this.ui.setReducedMotion(this.settings.values.reducedMotion);
    this.ui.renderTitle(this.records.records);

    this.input = new Input(window, document.getElementById('touch'), (action) => this.onUiKey(action));
    this.input.onTouchSeen = () => this.ui.setTouchMode(true);
    try { if (globalThis.matchMedia && matchMedia('(pointer: coarse)').matches) this.ui.setTouchMode(true); } catch { /* ignore */ }

    try {
      this.renderer = new Renderer(document.getElementById('scene'), this.sim);
    } catch (err) {
      this.renderer = null;
      this.ui.showError('WebGL is unavailable in this browser, so the expedition cannot be drawn. Enable hardware acceleration or try another browser.');
      console.error(err);
      return;
    }

    this.onResize = () => { this.renderer.resize(); };
    this.onVisibility = () => {
      if (document.hidden) { if (this.mode === 'play') this.pause(); this.audio.setHidden(true); }
      else { this.audio.setHidden(false); this.last = performance.now(); }
    };
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', () => { if (this.mode === 'play') this.pause(); });

    this.ui.show('title');
    this.loop = (now) => this.frame(now);
    requestAnimationFrame(this.loop);
  }

  // ───────────── state transitions ─────────────

  begin() {
    if (!this.renderer || this.mode !== 'title') return;
    this.audio.init();
    this.audio.setMuted(this.settings.values.muted);
    this.enterPlay();
    this.renderer.snap(this.sim);
    this.ui.showRegion(REGIONS[0].name);
  }

  enterPlay() {
    this.mode = 'play';
    this.acc = 0;
    this.last = performance.now();
    this.ui.show('play');
    this.input.setEnabled(true);
    this.input.clear();                 // a held confirm/jump key must not act on the first step
    this.audio.setRegion(this.sim.state === 'complete' ? 'surface' : this.sim.region);
    this.audio.setPlaying(true);
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.input.setEnabled(false);
    this.audio.setPlaying(false);
    this.audio.setSlide(false);
    this.ui.renderPause(this.sim);
    this.ui.show('paused');
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.audio.init();
    this.enterPlay();
  }

  togglePause() { if (this.mode === 'play') this.pause(); else if (this.mode === 'paused') this.resume(); }

  /** Full restart: fresh world and run state; personal records and settings are kept. */
  restart() {
    if (!this.renderer) return;
    this.audio.init();
    this.sim.reset();
    this.sim.events.length = 0;
    this.pendingRetry = false;
    this.toastGate.clear();
    this.ui.clearTransient();
    this.ui.cache = {};
    this.renderer.dawn = 0;
    this.renderer.snap(this.sim);
    this.enterPlay();
    this.ui.showRegion(REGIONS[0].name);
  }

  setMuted(m) {
    this.settings.set('muted', m);
    this.audio.init();
    this.audio.setMuted(m);
    this.ui.setMuted(m);
  }

  onUiKey(action) {
    if (action === 'pause') { if (this.mode === 'play' || this.mode === 'paused') this.togglePause(); }
    else if (action === 'confirm') this.ui.confirm();
  }

  // ───────────── simulation step + event routing ─────────────

  stepSim(inp) {
    this.sim.step(inp);
    const ev = this.sim.events;
    if (ev.length === 0) return;
    for (let k = 0; k < ev.length; k++) this.onEvent(ev[k]);
    ev.length = 0;
  }

  gatedToast(key, text, tone, gap = 2.5) {
    const now = performance.now() / 1000;
    if ((this.toastGate.get(key) || -99) + gap > now) return;
    this.toastGate.set(key, now);
    this.ui.toast(text, tone);
  }

  onEvent(e) {
    const sim = this.sim;
    this.audio.sfx(e.type, e);
    if (this.renderer) this.renderer.onEvent(e, sim);
    switch (e.type) {
      case 'damage': this.ui.flashHit(); break;
      case 'shield': this.gatedToast('shield', 'Emergency shield absorbed the hit  −50 Resonance', '', 0.5); break;
      case 'pulseDenied': this.ui.flashDeny(); break;
      case 'blocked': this.ui.flashDeny(); this.gatedToast('blocked', 'Unavailable while carrying a cell', 'amber'); break;
      case 'placeDenied': this.gatedToast('place', 'No safe place for the cell here', 'amber'); break;
      case 'cache': this.ui.toast(e.gained > 0 ? `Salvage Cache  +${e.gained} Resonance` : 'Salvage Cache recorded  (Resonance already full)'); break;
      case 'archive': this.ui.showArchive(e.title, e.text); this.ui.toast(`Memory Archive ${sim.archivesFound} / 3`); break;
      case 'station': this.gatedToast(`st${e.id}`, `Checkpoint committed — ${e.label}`, '', 4); break;
      case 'relay': this.ui.toast(`Relay ${e.id} restored  (${e.count} / 3)`, 'amber'); this.input.clear(); break;
      case 'relayDormant': this.gatedToast('dormant', 'Relay dormant — power its socket first', 'red'); break;
      case 'deflect': this.gatedToast('deflect', 'Armor closed — pulse deflected. Wait for the vent.', 'red'); break;
      case 'disable': this.ui.toast('Machine disabled'); break;
      case 'switch': this.ui.toast(e.id === 'SWB' ? 'Crossing platform powered' : 'Upper route latched open', 'amber'); break;
      case 'socketIn': this.gatedToast('socket', 'Socket powered', 'amber', 1); break;
      case 'region': { const r = REGIONS.find((x) => x.id === e.id); if (r) this.ui.showRegion(r.name); this.audio.setRegion(e.id); break; }
      case 'liftDenied': this.gatedToast('lift', e.reason === 'relays' ? `Lift offline — relay ${e.missing.join(', ')} not restored` : 'Step onto the lift platform', 'red'); break;
      case 'shutdown': this.input.clear(); this.audio.setSlide(false); break;
      case 'restored': this.input.clear(); this.ui.clearTransient(); if (this.renderer) this.renderer.snap(sim); this.audio.setRegion(sim.region); break;
      case 'liftStart': this.input.clear(); this.ui.clearTransient(); break;
      case 'liftArrive': this.audio.setRegion('surface'); this.audio.resolution(); break;
      case 'complete': this.complete(e.result); break;
      default: break;
    }
  }

  complete(result) {
    // The result was committed once by the simulation; records are saved here, after the ending.
    const improved = this.records.submit(result);
    this.mode = 'complete';
    this.input.setEnabled(false);
    this.ui.renderComplete(result, this.records.records, improved);
    this.ui.renderTitle(this.records.records);
    this.ui.show('complete');
  }

  // ───────────── frame loop ─────────────

  frame(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frames++;
    let animDt = dt;
    if (this.mode === 'play' && !this.botDriving) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < MAX_STEPS_PER_FRAME) {
        const inp = this.input.consume();
        if (this.pendingRetry) { inp.retryPressed = true; this.pendingRetry = false; }
        this.stepSim(inp);
        this.acc -= DT; n++;
        if (this.mode !== 'play') break;
      }
      if (n === MAX_STEPS_PER_FRAME) this.acc = 0;
      this.audio.setSlide(this.sim.player.wallSliding && this.sim.state === 'play');
    } else if (this.mode === 'paused') {
      animDt = 0;                        // pause freezes presentation timers too
    }
    this.animT += animDt;
    if (this.mode !== 'title') this.ui.update(this.sim);
    this.renderer.frame(this.sim, this.animT, animDt, { reduced: this.settings.values.reducedMotion, title: this.mode === 'title' });
  }
}

const game = new Game();

// Small deterministic inspection API for checks (not part of the player interface).
let botState = null;
globalThis.__deepwake = {
  game,
  get sim() { return game.sim; },
  get mode() { return game.mode; },
  /** Advance the real game by n fixed steps with a given input (events reach audio/effects/UI). */
  step(n = 1, inp = {}) { for (let k = 0; k < n; k++) game.stepSim(inp); },
  /** Prepare a scripted route ('main' or 'full'); the page loop stops stepping while the bot drives. */
  async botInit(kind = 'main') {
    const mod = await import('../tests/bot.mjs');
    const bot = new mod.Bot(game.sim, (inp) => game.stepSim(inp));
    botState = { bot, route: kind === 'full' ? mod.fullRoute(game.sim) : mod.mainRoute(game.sim), index: 0 };
    game.botDriving = true;
    return botState.route.map((s) => s[0]);
  },
  /** Run the next route segment synchronously; returns its name, or null when finished. */
  botNext() {
    if (!botState || botState.index >= botState.route.length) { game.botDriving = false; return null; }
    const [name, fn] = botState.route[botState.index++];
    fn(botState.bot);
    if (botState.index >= botState.route.length) game.botDriving = false;
    return name;
  },
  botStop() { game.botDriving = false; botState = null; },
};
