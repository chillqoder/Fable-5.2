// DEEPWAKE — keyboard and touch input.
// Produces one input object per fixed simulation step. Jump, dash, pulse, interact and retry
// are edge-triggered: one fresh press yields exactly one "pressed" step, however long it is held.

const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', KeyZ: 'jump',
  ShiftLeft: 'dash', ShiftRight: 'dash', KeyX: 'dash',
  KeyQ: 'pulse',
  KeyE: 'interact',
  KeyR: 'retry',
};
const UI_KEYS = { KeyP: 'pause', Escape: 'pause', Enter: 'confirm' };
const SCROLL_KEYS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const ACTIONS = ['left', 'right', 'jump', 'dash', 'pulse', 'interact', 'retry'];

export class Input {
  /**
   * @param target element that receives key events (window)
   * @param touchRoot container of [data-act] touch buttons
   * @param onUi callback(action) for 'pause' / 'confirm'
   */
  constructor(target, touchRoot, onUi) {
    this.onUi = onUi;
    this.enabled = false;            // gameplay input accepted only while the expedition is in play
    this.keys = new Map();           // action -> Set of physical sources currently holding it
    this.fresh = new Set();          // actions pressed since the last consumed step
    this.listeners = [];
    this.touchSeen = false;
    this.onTouchSeen = null;
    for (const a of ACTIONS) this.keys.set(a, new Set());

    const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); this.listeners.push([el, type, fn, opts]); };

    on(target, 'keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ui = UI_KEYS[e.code];
      if (ui) {
        // Enter on a focused control keeps its native activation (no double trigger).
        if (e.code === 'Enter' && isTextTarget(e.target)) return;
        if (!e.repeat) this.onUi(ui, e);
        e.preventDefault();
        return;
      }
      const act = KEYMAP[e.code];
      if (!act) return;
      if (SCROLL_KEYS.has(e.code) || this.enabled) e.preventDefault();
      if (e.repeat) return;            // auto-repeat never counts as a fresh press
      this.press(act, e.code);
    });
    on(target, 'keyup', (e) => {
      const act = KEYMAP[e.code];
      if (act) this.release(act, e.code);
    });
    // Release everything whenever focus or visibility is lost.
    on(target, 'blur', () => this.clear());
    on(document, 'visibilitychange', () => { if (document.hidden) this.clear(); });
    on(target, 'contextmenu', (e) => { if (this.touchSeen) e.preventDefault(); });

    if (touchRoot) {
      for (const btn of touchRoot.querySelectorAll('[data-act]')) {
        const act = btn.dataset.act;
        const src = `touch:${act}`;
        const down = (e) => {
          e.preventDefault();
          try { btn.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
          btn.classList.add('down');
          this.press(act, src);
        };
        const up = (e) => { e.preventDefault(); btn.classList.remove('down'); this.release(act, src); };
        on(btn, 'pointerdown', down);
        on(btn, 'pointerup', up);
        on(btn, 'pointercancel', up);
        on(btn, 'lostpointercapture', up);
        on(btn, 'contextmenu', (e) => e.preventDefault());
      }
      on(window, 'touchstart', () => {
        if (!this.touchSeen) { this.touchSeen = true; if (this.onTouchSeen) this.onTouchSeen(); }
      }, { passive: true });
    }
  }

  press(act, src) {
    const set = this.keys.get(act);
    if (!set) return;
    const wasHeld = set.size > 0;
    set.add(src);
    if (!wasHeld && this.enabled) this.fresh.add(act);
  }

  release(act, src) { const set = this.keys.get(act); if (set) set.delete(src); }

  held(act) { return this.enabled && this.keys.get(act).size > 0; }

  /**
   * Drop every held input. Keys that are physically still down stay ignored until they are
   * released and pressed again (key repeat is filtered), so a held confirmation or movement
   * key can never leak into gameplay after an overlay closes.
   */
  clear() {
    for (const set of this.keys.values()) set.clear();
    this.fresh.clear();
    for (const el of document.querySelectorAll('.touch .down')) el.classList.remove('down');
  }

  setEnabled(v) { if (this.enabled !== v) { this.enabled = v; this.clear(); } }

  /** Input for the next fixed step. Fresh presses are delivered once and then consumed. */
  consume() {
    const f = this.fresh;
    const inp = {
      left: this.held('left'), right: this.held('right'), jumpHeld: this.held('jump'),
      jumpPressed: f.has('jump'), dashPressed: f.has('dash'), pulsePressed: f.has('pulse'),
      interactPressed: f.has('interact'), retryPressed: f.has('retry'),
    };
    f.clear();
    return inp;
  }

  dispose() {
    for (const [el, type, fn, opts] of this.listeners) el.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
  }
}

function isTextTarget(t) { return t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'SUMMARY'); }
