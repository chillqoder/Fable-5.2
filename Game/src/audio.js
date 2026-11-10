// DEEPWAKE — procedural audio (Web Audio). One owner, bounded scheduling, gain ramps, node cleanup.
// Audio is optional: every entry point is safe when the context is missing or blocked.

const REGION_MUSIC = {
  // root (Hz), scale (semitones), tempo (bpm), arrangement flags
  workshop: { root: 110.0, scale: [0, 3, 5, 7, 10], bpm: 66, pluck: 0.34, bell: 0.0, thud: 0.0, tick: 0.12, drone: 0.5 },
  reservoir: { root: 130.81, scale: [0, 2, 5, 7, 9], bpm: 72, pluck: 0.12, bell: 0.42, thud: 0.0, tick: 0.0, drone: 0.4 },
  foundry: { root: 98.0, scale: [0, 3, 5, 6, 10], bpm: 80, pluck: 0.2, bell: 0.0, thud: 0.5, tick: 0.3, drone: 0.55 },
  ascent: { root: 123.47, scale: [0, 2, 3, 7, 10], bpm: 88, pluck: 0.4, bell: 0.2, thud: 0.4, tick: 0.25, drone: 0.5 },
  surface: { root: 130.81, scale: [0, 4, 7, 11, 14], bpm: 60, pluck: 0.0, bell: 0.5, thud: 0.0, tick: 0.0, drone: 0.45 },
};
const MAX_VOICES = 28;
const LOOKAHEAD = 0.25;      // seconds of music scheduled ahead (bounded)
const TICK_MS = 90;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.voices = 0;
    this.region = 'workshop';
    this.timer = null;
    this.nextBeat = 0;
    this.beat = 0;
    this.playing = false;       // music allowed (in play, not paused, tab visible)
    this.seed = 1234567;
    this.lastSfx = new Map();   // type -> time, rate limiting
    this.slide = null;
    this.scheduled = 0;         // diagnostic: notes scheduled in total
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ready) { this.resumeContext(); return true; }
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.ratio.value = 4; this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
      this.musicBus = c.createGain(); this.musicBus.gain.value = 0.0;
      this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.8;
      this.musicBus.connect(this.master); this.sfxBus.connect(this.master);
      this.master.connect(this.comp); this.comp.connect(c.destination);
      // shared noise buffer (1 s)
      const len = Math.floor(c.sampleRate * 1.0);
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let s = 22222;
      for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
      this.ready = true;
      this.resumeContext();
      return true;
    } catch {
      this.ctx = null; this.ready = false;
      return false;
    }
  }

  resumeContext() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch { /* ignore */ } }

  setMuted(m) {
    this.muted = m;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // Mute acts on the master bus, so already-scheduled notes and effects are silenced too.
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, t, 0.02);
  }

  /** Start or stop gameplay music (pause, overlays, hidden tab). Never plays a backlog. */
  setPlaying(on) {
    if (!this.ready) { this.playing = on; return; }
    if (on === this.playing && (on ? this.timer !== null : this.timer === null)) return;
    this.playing = on;
    const c = this.ctx, t = c.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    if (on) {
      this.resumeContext();
      this.musicBus.gain.setTargetAtTime(0.5, t, 0.4);
      this.nextBeat = t + 0.08;        // restart the clock from "now": no catch-up notes
      if (this.timer === null) this.timer = setInterval(() => this.schedule(), TICK_MS);
    } else {
      this.musicBus.gain.setTargetAtTime(0.0, t, 0.05);
      if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
      this.stopSlide();
    }
  }

  /** Page hidden: suspend the whole context so nothing accumulates. */
  setHidden(hidden) {
    if (!this.ready) return;
    try {
      if (hidden) { if (this.timer !== null) { clearInterval(this.timer); this.timer = null; } this.stopSlide(); this.ctx.suspend(); }
      else { this.ctx.resume(); if (this.playing) { this.playing = false; this.setPlaying(true); } }
    } catch { /* ignore */ }
  }

  setRegion(id) { if (REGION_MUSIC[id]) this.region = id; }

  rnd() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }

  // ───────────── voices ─────────────

  voice(bus, { type = 'sine', f = 440, f2 = null, t = 0, dur = 0.2, gain = 0.2, attack = 0.005, filter = null, q = 1, detune = 0 }) {
    if (!this.ready || this.voices >= MAX_VOICES) return;
    const c = this.ctx, t0 = Math.max(c.currentTime, t);
    try {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.value = detune;
      if (f2 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let last = o;
      let flt = null;
      if (filter) { flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = filter; flt.Q.value = q; o.connect(flt); last = flt; }
      last.connect(g); g.connect(bus);
      this.voices++;
      o.onended = () => { this.voices--; try { o.disconnect(); g.disconnect(); if (flt) flt.disconnect(); } catch { /* gone */ } };
      o.start(t0); o.stop(t0 + dur + 0.03);
    } catch { /* ignore */ }
  }

  noise(bus, { t = 0, dur = 0.2, gain = 0.2, f = 1200, f2 = null, q = 0.8, type = 'bandpass', attack = 0.004 }) {
    if (!this.ready || this.voices >= MAX_VOICES) return;
    const c = this.ctx, t0 = Math.max(c.currentTime, t);
    try {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t0); flt.Q.value = q;
      if (f2 !== null) flt.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(flt); flt.connect(g); g.connect(bus);
      this.voices++;
      src.onended = () => { this.voices--; try { src.disconnect(); flt.disconnect(); g.disconnect(); } catch { /* gone */ } };
      src.start(t0, this.rnd() * 0.5); src.stop(t0 + dur + 0.03);
    } catch { /* ignore */ }
  }

  // ───────────── music ─────────────

  schedule() {
    if (!this.ready || !this.playing) return;
    const c = this.ctx;
    if (c.state !== 'running') return;
    const M = REGION_MUSIC[this.region] || REGION_MUSIC.workshop;
    const spb = 60 / M.bpm / 2;                 // eighth notes
    // If the timer was throttled, skip ahead instead of scheduling a backlog.
    if (this.nextBeat < c.currentTime - 0.05) this.nextBeat = c.currentTime + 0.05;
    let guard = 0;
    while (this.nextBeat < c.currentTime + LOOKAHEAD && guard++ < 8) {
      this.playBeat(M, this.beat, this.nextBeat, spb);
      this.nextBeat += spb; this.beat = (this.beat + 1) % 64;
    }
  }

  note(M, degree, octave = 0) {
    const sc = M.scale, n = sc.length;
    const d = ((degree % n) + n) % n, o = Math.floor(degree / n) + octave;
    return M.root * Math.pow(2, (sc[d] + 12 * o) / 12);
  }

  playBeat(M, beat, t, spb) {
    const bus = this.musicBus;
    this.scheduled++;
    // low mechanical drone: one long overlapping note every 16 eighths
    if (beat % 16 === 0) {
      const deg = [0, 0, 3, 1][(beat / 16) % 4];
      const f = this.note(M, deg, -1);
      this.voice(bus, { type: 'sawtooth', f, t, dur: spb * 17, gain: 0.11 * M.drone, attack: spb * 4, filter: 260, q: 0.5 });
      this.voice(bus, { type: 'sawtooth', f: f * 1.004, t, dur: spb * 17, gain: 0.09 * M.drone, attack: spb * 5, filter: 220, q: 0.5 });
      this.voice(bus, { type: 'sine', f: f / 2, t, dur: spb * 16, gain: 0.16 * M.drone, attack: spb * 3 });
    }
    // sparse rhythm
    if (M.thud > 0 && (beat % 8 === 0 || (beat % 16 === 11))) {
      this.voice(bus, { type: 'sine', f: 82, f2: 38, t, dur: 0.34, gain: 0.5 * M.thud, attack: 0.004 });
    }
    if (M.tick > 0 && beat % 4 === 2 && this.rnd() < 0.8) {
      this.noise(bus, { t, dur: 0.05, gain: 0.16 * M.tick, f: 4200, q: 3 });
    }
    // soft tonal pulses
    if (M.pluck > 0 && this.rnd() < M.pluck && beat % 2 === 0) {
      const deg = [0, 2, 4, 1, 3, 5, 7][Math.floor(this.rnd() * 7)];
      const f = this.note(M, deg, 1);
      this.voice(bus, { type: 'triangle', f, t, dur: 0.9, gain: 0.11, attack: 0.008, filter: 1800 });
    }
    // crystal-like resonances
    if (M.bell > 0 && this.rnd() < M.bell && beat % 2 === 1) {
      const deg = [0, 2, 4, 5, 7, 9][Math.floor(this.rnd() * 6)];
      const f = this.note(M, deg, 2);
      this.voice(bus, { type: 'sine', f, t, dur: 2.2, gain: 0.07, attack: 0.004 });
      this.voice(bus, { type: 'sine', f: f * 2.01, t, dur: 1.2, gain: 0.025, attack: 0.004 });
    }
  }

  /** Restrained musical resolution for the ending. */
  resolution() {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.05, bus = this.sfxBus;
    const chord = [130.81, 164.81, 196.0, 246.94, 329.63];
    chord.forEach((f, i) => {
      this.voice(bus, { type: 'sine', f, t: t + i * 0.22, dur: 4.5, gain: 0.1, attack: 0.5 });
      this.voice(bus, { type: 'triangle', f: f * 2, t: t + i * 0.22 + 0.1, dur: 3.2, gain: 0.03, attack: 0.3 });
    });
  }

  // ───────────── continuous wall-slide noise ─────────────

  setSlide(on) {
    if (!this.ready) return;
    if (on && !this.slide) {
      try {
        const c = this.ctx;
        const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
        const flt = c.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 900; flt.Q.value = 1.2;
        const g = c.createGain(); g.gain.value = 0.0001;
        g.gain.setTargetAtTime(0.07, c.currentTime, 0.04);
        src.connect(flt); flt.connect(g); g.connect(this.sfxBus); src.start();
        this.slide = { src, flt, g };
      } catch { this.slide = null; }
    } else if (!on && this.slide) this.stopSlide();
  }

  stopSlide() {
    const s = this.slide;
    if (!s) return;
    this.slide = null;
    try {
      const t = this.ctx.currentTime;
      s.g.gain.cancelScheduledValues(t); s.g.gain.setTargetAtTime(0.0001, t, 0.03);
      s.src.stop(t + 0.15);
      s.src.onended = () => { try { s.src.disconnect(); s.flt.disconnect(); s.g.disconnect(); } catch { /* gone */ } };
    } catch { /* ignore */ }
  }

  // ───────────── effects ─────────────

  /** Play the effect for a simulation event. Rate-limited per type. */
  sfx(type, e = {}) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const last = this.lastSfx.get(type) || 0;
    if (now - last < 0.03) return;
    this.lastSfx.set(type, now);
    const b = this.sfxBus, t = now;
    const V = (o) => this.voice(b, { t, ...o }), N = (o) => this.noise(b, { t, ...o });
    switch (type) {
      case 'step':
        if (e.surface === 'metal') { N({ dur: 0.05, gain: 0.1, f: 2600, q: 4 }); V({ type: 'square', f: 190 + this.rnd() * 30, dur: 0.04, gain: 0.03 }); }
        else if (e.surface === 'crystal') { N({ dur: 0.06, gain: 0.07, f: 1700, q: 2 }); V({ type: 'sine', f: 1500 + this.rnd() * 400, dur: 0.07, gain: 0.02 }); }
        else N({ dur: 0.07, gain: 0.1, f: 520 + this.rnd() * 120, q: 1.2 });
        break;
      case 'jump': V({ type: 'triangle', f: 240, f2: 420, dur: 0.12, gain: 0.12 }); N({ dur: 0.06, gain: 0.05, f: 900 }); break;
      case 'walljump': V({ type: 'triangle', f: 300, f2: 560, dur: 0.13, gain: 0.13 }); N({ dur: 0.07, gain: 0.09, f: 1400, q: 2 }); break;
      case 'land': {
        const k = Math.min(1, (e.speed || 4) / 18);
        N({ dur: 0.1 + k * 0.08, gain: 0.08 + k * 0.14, f: e.surface === 'metal' ? 900 : 380, q: 0.9 });
        V({ type: 'sine', f: 110, f2: 60, dur: 0.1, gain: 0.08 + k * 0.1 });
        break;
      }
      case 'bonk': V({ type: 'square', f: 150, f2: 90, dur: 0.07, gain: 0.06 }); break;
      case 'dash': N({ dur: 0.2, gain: 0.18, f: 600, f2: 3200, q: 1.5 }); V({ type: 'sawtooth', f: 180, f2: 520, dur: 0.16, gain: 0.07, filter: 1800 }); break;
      case 'dashStop': N({ dur: 0.08, gain: 0.12, f: 400 }); break;
      case 'pulse':
        V({ type: 'sine', f: 520, f2: 1040, dur: 0.4, gain: 0.16 }); V({ type: 'sine', f: 780, f2: 1560, dur: 0.5, gain: 0.07 });
        N({ dur: 0.4, gain: 0.05, f: 2500, f2: 6000, q: 2 });
        break;
      case 'pulseDenied': V({ type: 'sine', f: 196, f2: 150, dur: 0.16, gain: 0.07 }); break;
      case 'blocked': case 'placeDenied': V({ type: 'triangle', f: 170, dur: 0.07, gain: 0.05 }); break;
      case 'shield':
        V({ type: 'triangle', f: 1320, f2: 660, dur: 0.25, gain: 0.14 }); V({ type: 'sine', f: 1980, f2: 880, dur: 0.3, gain: 0.07 });
        N({ dur: 0.18, gain: 0.1, f: 5200, q: 4 });
        break;
      case 'damage': V({ type: 'sawtooth', f: 220, f2: 70, dur: 0.3, gain: 0.16, filter: 1200 }); N({ dur: 0.2, gain: 0.16, f: 700 }); break;
      case 'cellPick': V({ type: 'square', f: 330, f2: 440, dur: 0.09, gain: 0.06 }); N({ dur: 0.06, gain: 0.06, f: 1500 }); break;
      case 'cellPlace': V({ type: 'square', f: 300, f2: 210, dur: 0.1, gain: 0.06 }); N({ dur: 0.08, gain: 0.09, f: 500 }); break;
      case 'socketIn':
        N({ dur: 0.07, gain: 0.12, f: 1100, q: 2 });
        V({ type: 'sawtooth', f: 110, f2: 220, dur: 0.5, gain: 0.1, filter: 900 }); V({ type: 'sine', f: 440, t: t + 0.12, dur: 0.4, gain: 0.08 }); V({ type: 'sine', f: 660, t: t + 0.24, dur: 0.5, gain: 0.07 });
        break;
      case 'socketOut': V({ type: 'sawtooth', f: 220, f2: 90, dur: 0.35, gain: 0.09, filter: 900 }); N({ dur: 0.07, gain: 0.1, f: 900 }); break;
      case 'switch': N({ dur: 0.05, gain: 0.16, f: 1800, q: 3 }); V({ type: 'square', f: 140, dur: 0.08, gain: 0.07 }); V({ type: 'sine', f: 520, t: t + 0.1, dur: 0.35, gain: 0.08 }); break;
      case 'door': V({ type: 'sawtooth', f: e.open ? 70 : 100, f2: e.open ? 110 : 60, dur: 0.6, gain: 0.08, filter: 500 }); N({ dur: 0.5, gain: 0.05, f: 300 }); break;
      case 'relay':
        [392, 523.25, 659.25, 783.99].forEach((f, i) => { this.voice(b, { type: 'sine', f, t: t + i * 0.13, dur: 1.6, gain: 0.12, attack: 0.01 }); this.voice(b, { type: 'triangle', f: f * 2, t: t + i * 0.13, dur: 0.9, gain: 0.03 }); });
        V({ type: 'sawtooth', f: 65, f2: 130, dur: 1.4, gain: 0.1, filter: 500 });
        break;
      case 'relayDormant': V({ type: 'sine', f: 300, f2: 240, dur: 0.25, gain: 0.07 }); break;
      case 'archive': [659.25, 987.77, 1318.5].forEach((f, i) => this.voice(b, { type: 'sine', f, t: t + i * 0.16, dur: 1.2, gain: 0.07 })); break;
      case 'cache': V({ type: 'triangle', f: 520, f2: 780, dur: 0.15, gain: 0.08 }); V({ type: 'sine', f: 1040, t: t + 0.1, dur: 0.3, gain: 0.06 }); N({ dur: 0.08, gain: 0.07, f: 2200 }); break;
      case 'seamBreak': N({ dur: 0.35, gain: 0.22, f: 3200, f2: 800, q: 1.2 }); [1700, 2300, 2900].forEach((f, i) => this.voice(b, { type: 'sine', f: f + this.rnd() * 200, t: t + i * 0.04, dur: 0.3, gain: 0.05 })); break;
      case 'reveal': V({ type: 'sine', f: 1568, dur: 0.5, gain: 0.03 }); break;
      case 'telegraph':
        if (e.kind === 'skitter') { V({ type: 'square', f: 880, dur: 0.07, gain: 0.07 }); this.voice(b, { type: 'square', f: 880, t: t + 0.14, dur: 0.07, gain: 0.07 }); this.voice(b, { type: 'square', f: 1100, t: t + 0.28, dur: 0.1, gain: 0.08 }); }
        else if (e.kind === 'drone') V({ type: 'sine', f: 600, f2: 1500, dur: 0.75, gain: 0.08 });
        else { V({ type: 'sawtooth', f: 90, f2: 240, dur: 0.85, gain: 0.12, filter: 1400 }); V({ type: 'square', f: 660, dur: 0.08, gain: 0.06 }); this.voice(b, { type: 'square', f: 660, t: t + 0.3, dur: 0.08, gain: 0.06 }); this.voice(b, { type: 'square', f: 660, t: t + 0.6, dur: 0.08, gain: 0.06 }); }
        break;
      case 'lunge': N({ dur: 0.25, gain: 0.16, f: 1800, f2: 500, q: 2 }); break;
      case 'bolt': V({ type: 'sawtooth', f: 900, f2: 300, dur: 0.22, gain: 0.1, filter: 2400 }); break;
      case 'boltHit': N({ dur: 0.1, gain: 0.08, f: 1500 }); break;
      case 'beam': V({ type: 'sawtooth', f: 140, dur: 0.9, gain: 0.13, filter: 1600, q: 4 }); V({ type: 'sawtooth', f: 281, dur: 0.9, gain: 0.07, filter: 2600 }); N({ dur: 0.9, gain: 0.07, f: 3000, q: 1 }); break;
      case 'ventOpen': N({ dur: 1.2, gain: 0.09, f: 2400, f2: 900, q: 0.8 }); break;
      case 'deflect': V({ type: 'square', f: 1400, f2: 900, dur: 0.12, gain: 0.08 }); N({ dur: 0.1, gain: 0.1, f: 3800, q: 5 }); break;
      case 'stun': V({ type: 'sawtooth', f: 700, f2: 180, dur: 0.35, gain: 0.09, filter: 2000 }); N({ dur: 0.25, gain: 0.07, f: 4200, q: 6 }); break;
      case 'disable': V({ type: 'sawtooth', f: 320, f2: 40, dur: 0.7, gain: 0.14, filter: 1500 }); N({ dur: 0.3, gain: 0.14, f: 1200 }); break;
      case 'ventWarn': N({ dur: 0.5, gain: 0.05, f: 700, f2: 1600, q: 3 }); V({ type: 'square', f: 440, dur: 0.05, gain: 0.04 }); break;
      case 'ventFire': N({ dur: 0.95, gain: 0.13, f: 1500, q: 0.7, attack: 0.03 }); break;
      case 'pressWarn': V({ type: 'square', f: 330, dur: 0.08, gain: 0.06 }); this.voice(b, { type: 'square', f: 330, t: t + 0.25, dur: 0.08, gain: 0.06 }); N({ dur: 0.6, gain: 0.05, f: 300 }); break;
      case 'pressSlam': V({ type: 'sine', f: 90, f2: 30, dur: 0.45, gain: 0.3 }); N({ dur: 0.3, gain: 0.2, f: 300, q: 0.6 }); break;
      case 'moverGo': V({ type: 'sawtooth', f: 60, f2: 85, dur: 0.5, gain: 0.05, filter: 400 }); break;
      case 'moverStop': N({ dur: 0.08, gain: 0.07, f: 600 }); break;
      case 'station': [523.25, 783.99].forEach((f, i) => this.voice(b, { type: 'sine', f, t: t + i * 0.12, dur: 0.9, gain: 0.09 })); break;
      case 'shutdown': V({ type: 'sawtooth', f: 330, f2: 35, dur: 0.9, gain: 0.16, filter: 1400 }); N({ dur: 0.5, gain: 0.08, f: 600, f2: 120 }); break;
      case 'reboot': [196, 261.63, 392, 523.25].forEach((f, i) => this.voice(b, { type: 'triangle', f, t: t + i * 0.11, dur: 0.4, gain: 0.08 })); break;
      case 'liftDenied': V({ type: 'square', f: 160, dur: 0.12, gain: 0.07 }); this.voice(b, { type: 'square', f: 130, t: t + 0.14, dur: 0.16, gain: 0.07 }); break;
      case 'liftStart': V({ type: 'sawtooth', f: 45, f2: 90, dur: 6.5, gain: 0.12, filter: 420, attack: 0.8 }); N({ dur: 0.5, gain: 0.1, f: 500 }); V({ type: 'sine', f: 392, dur: 0.6, gain: 0.07 }); break;
      case 'liftArrive': N({ dur: 0.25, gain: 0.12, f: 400 }); V({ type: 'sine', f: 196, dur: 0.8, gain: 0.08 }); break;
      case 'ui': V({ type: 'triangle', f: 520, dur: 0.06, gain: 0.05 }); break;
      default: break;
    }
  }
}
