// DEEPWAKE — HUD, prompts and overlays (DOM only). Reads simulation state; never mutates it.

import { C } from './config.js';
import { formatTime } from './records.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      hud: $('hud'), integrity: $('integrity'), energy: $('energy'), energyFill: $('energyFill'), energyNum: $('energyNum'),
      relays: $('relays'), archives: $('archives'), carry: $('carry'), clock: $('clock'),
      abDash: $('abDash'), abPulse: $('abPulse'), abShield: $('abShield'),
      btnMute: $('btnMute'), btnPause: $('btnPause'),
      region: $('region'), hint: $('hint'), prompt: $('prompt'), toasts: $('toasts'), banner: $('banner'),
      archivePanel: $('archivePanel'), archiveTitle: $('archiveTitle'), archiveText: $('archiveText'), archiveDismiss: $('archiveDismiss'),
      touch: $('touch'), overlay: $('overlay'),
      scrTitle: $('ovTitleScreen'), scrPause: $('ovPause'), scrComplete: $('ovComplete'), scrError: $('ovError'),
      btnBegin: $('btnBegin'), btnResume: $('btnResume'), btnRetry: $('btnRetry'), btnRestart: $('btnRestart'),
      restartConfirm: $('restartConfirm'), btnRestartYes: $('btnRestartYes'), btnRestartNo: $('btnRestartNo'),
      optMute: $('optMute'), optMotion: $('optMotion'),
      pauseArchives: $('pauseArchives'), pauseArchiveCount: $('pauseArchiveCount'),
      titleRecords: $('titleRecords'), completeRecords: $('completeRecords'), resultsTable: $('resultsTable'),
      completeTitle: $('completeTitle'), completeKind: $('completeKind'), btnNew: $('btnNew'), errorText: $('errorText'),
    };
    this.cache = {};
    this.touchMode = false;
    this.screen = 'title';
    this.regionTimer = null;
    this.archiveTimer = null;
    this.listeners = [];
    const on = (el, type, fn) => { el.addEventListener(type, fn); this.listeners.push([el, type, fn]); };
    const click = (el, fn) => on(el, 'click', (e) => { e.preventDefault(); el.blur(); fn(); });
    const e = this.el;
    click(e.btnBegin, () => this.h.begin());
    click(e.btnResume, () => this.h.resume());
    click(e.btnRetry, () => this.h.retry());
    click(e.btnRestart, () => { e.restartConfirm.classList.remove('hidden'); e.btnRestartYes.focus(); });
    click(e.btnRestartNo, () => e.restartConfirm.classList.add('hidden'));
    click(e.btnRestartYes, () => this.h.restart());
    click(e.btnNew, () => this.h.newExpedition());
    click(e.btnPause, () => this.h.togglePause());
    click(e.btnMute, () => this.h.setMuted(e.btnMute.getAttribute('aria-pressed') !== 'true'));
    click(e.archiveDismiss, () => this.hideArchive());
    on(e.optMute, 'change', () => this.h.setMuted(e.optMute.checked));
    on(e.optMotion, 'change', () => this.h.setReducedMotion(e.optMotion.checked));
  }

  dispose() { for (const [el, type, fn] of this.listeners) el.removeEventListener(type, fn); this.listeners.length = 0; }

  set(key, value, apply) { if (this.cache[key] !== value) { this.cache[key] = value; apply(value); } }

  setTouchMode(on) {
    this.touchMode = on;
    this.el.touch.classList.toggle('hidden', !on || this.screen !== 'play');
    document.body.classList.toggle('touch-on', on);
    this.cache.prompt = null; this.cache.hint = null;
  }

  setMuted(m) {
    this.el.btnMute.setAttribute('aria-pressed', m ? 'true' : 'false');
    this.el.btnMute.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
    this.el.optMute.checked = m;
  }

  setReducedMotion(v) { this.el.optMotion.checked = v; }

  // ───────────── screens ─────────────

  show(screen) {
    this.screen = screen;
    const e = this.el;
    const overlay = screen === 'title' || screen === 'paused' || screen === 'complete' || screen === 'error';
    e.overlay.classList.toggle('hidden', !overlay);
    e.scrTitle.classList.toggle('hidden', screen !== 'title');
    e.scrPause.classList.toggle('hidden', screen !== 'paused');
    e.scrComplete.classList.toggle('hidden', screen !== 'complete');
    e.scrError.classList.toggle('hidden', screen !== 'error');
    e.hud.classList.toggle('hidden', screen === 'title' || screen === 'error');
    e.touch.classList.toggle('hidden', !this.touchMode || screen !== 'play');
    e.restartConfirm.classList.add('hidden');
    if (screen !== 'play') { e.prompt.classList.add('hidden'); e.hint.classList.add('hidden'); this.cache.prompt = null; this.cache.hint = null; }
    if (screen === 'title') e.btnBegin.focus({ preventScroll: true });
    else if (screen === 'paused') e.btnResume.focus({ preventScroll: true });
    else if (screen === 'complete') e.btnNew.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (overlay) document.getElementById('panel').scrollTop = 0;
  }

  /** Enter: activates the main action of the current overlay. */
  confirm() {
    if (this.screen === 'title') this.h.begin();
    else if (this.screen === 'paused') this.h.resume();
    else if (this.screen === 'complete') this.h.newExpedition();
    else if (!this.el.archivePanel.classList.contains('hidden')) this.hideArchive();
  }

  showError(text) { this.el.errorText.textContent = text; this.show('error'); }

  // ───────────── HUD ─────────────

  update(sim) {
    const p = sim.player, e = this.el;
    this.set('integrity', p.integrity, (v) => {
      [...e.integrity.children].forEach((seg, i) => seg.classList.toggle('off', i >= v));
      e.integrity.setAttribute('aria-label', `Integrity ${v} of ${C.integrityMax}`);
    });
    const en = Math.round(p.energy);
    this.set('energy', en, (v) => {
      e.energyFill.style.width = `${v}%`;
      e.energyNum.textContent = String(v);
      e.energy.classList.toggle('low', v < C.pulseCost);
      e.energy.setAttribute('aria-label', `Resonance ${v} of ${C.energyMax}. Pulse costs ${C.pulseCost}, shield costs ${C.shieldCost}.`);
    });
    const relayKey = sim.relays.map((r) => (r.active ? 1 : 0)).join('');
    this.set('relays', relayKey, () => {
      for (const node of e.relays.children) node.classList.toggle('on', sim.byId.get(node.dataset.id).active);
      e.relays.setAttribute('aria-label', `Relays: ${sim.relays.map((r) => `${r.id} ${r.active ? 'restored' : 'offline'}`).join(', ')}`);
    });
    this.set('archives', sim.archivesFound, (v) => { e.archives.textContent = `${v} / 3`; });
    const carrying = p.carry !== null;
    this.set('carry', carrying, (v) => e.carry.classList.toggle('hidden', !v));
    this.set('abDash', carrying ? 'off' : (p.dashAvail && p.dashCd <= 0 ? 'ready' : ''), (v) => { e.abDash.className = `ab ${v}`; });
    this.set('abPulse', carrying ? 'off' : (p.energy >= C.pulseCost && p.pulseCd <= 0 ? 'ready' : ''), (v) => { e.abPulse.className = `ab ${v}`; });
    this.set('abShield', p.energy >= C.shieldCost ? 'ready' : '', (v) => { e.abShield.className = `ab ${v}`; });
    this.set('clock', Math.floor(sim.time * 10), () => { e.clock.textContent = formatTime(sim.time).slice(0, -1); });
    this.set('banner', sim.state === 'reboot' || sim.state === 'shutdown', (v) => {
      e.banner.classList.toggle('hidden', !v);
    });

    // contextual prompt: interaction target first, then relay pulse hint
    let prompt = '';
    let denied = false;
    if (sim.state === 'play') {
      const t = sim.target;
      if (t) {
        prompt = `${this.key('E', 'Use')}${t.label}`;
        denied = !t.ok;
        if (t.kind === 'place' && !t.ok) prompt = `${this.key('E', 'Use')}No room to place the cell here`;
      } else if (sim.pulseHint) {
        prompt = sim.pulseHint.ready ? `${this.key('Q', 'Pulse')}Echo Pulse` : 'Relay dormant — power its socket first';
        denied = !sim.pulseHint.ready;
      }
    }
    this.set('prompt', prompt + (denied ? '!' : ''), () => {
      e.prompt.classList.toggle('hidden', prompt === '');
      e.prompt.classList.toggle('denied', denied);
      e.prompt.innerHTML = prompt;
    });
    const hintId = sim.state === 'play' && !sim.target ? sim.hint : null;
    this.set('hint', hintId, (id) => {
      const h = id ? sim.level.hints.find((x) => x.id === id) : null;
      e.hint.classList.toggle('hidden', !h);
      if (h) {
        const k = this.touchMode ? h.touch : h.keys;
        e.hint.innerHTML = `${k ? `<kbd>${k}</kbd>` : ''}${h.text}`;
      }
    });
  }

  key(k, touch) { return `<kbd>${this.touchMode ? touch : k}</kbd>`; }

  flashHit() { const el = this.el.integrity; el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  flashDeny() { const el = this.el.energy; el.classList.remove('deny'); void el.offsetWidth; el.classList.add('deny'); }

  toast(text, tone = '') {
    const box = this.el.toasts;
    while (box.children.length >= 3) box.firstChild.remove();
    const d = document.createElement('div');
    d.className = `toast ${tone}`;
    d.textContent = text;
    d.addEventListener('animationend', () => d.remove(), { once: true });
    box.appendChild(d);
  }

  clearTransient() {
    this.el.toasts.replaceChildren();
    this.hideArchive();
    this.el.region.classList.remove('show');
  }

  showRegion(name) {
    const el = this.el.region;
    el.textContent = name;
    el.classList.add('show');
    clearTimeout(this.regionTimer);
    this.regionTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  showArchive(title, text) {
    const e = this.el;
    e.archiveTitle.textContent = title; e.archiveText.textContent = text;
    e.archivePanel.classList.remove('hidden');
    clearTimeout(this.archiveTimer);
    this.archiveTimer = setTimeout(() => this.hideArchive(), 14000);
  }

  hideArchive() { clearTimeout(this.archiveTimer); this.el.archivePanel.classList.add('hidden'); }

  // ───────────── overlays content ─────────────

  renderPause(sim) {
    const e = this.el;
    e.pauseArchiveCount.textContent = `${sim.archivesFound} / 3`;
    e.pauseArchives.replaceChildren(...sim.archives.map((a, i) => {
      const d = document.createElement('div');
      d.className = `archive-item${a.collected ? '' : ' missing'}`;
      const b = document.createElement('b');
      b.textContent = a.collected ? a.title : `Archive ${i + 1} — not recovered`;
      d.appendChild(b);
      if (a.collected) d.appendChild(document.createTextNode(a.text));
      return d;
    }));
  }

  recordRows(container, rec, improved = {}) {
    const rows = [
      ['Best Completion Time', rec.bestTime !== null ? formatTime(rec.bestTime) : '—', improved.bestTime],
      ['Best Full-Archive Time', rec.bestFullArchiveTime !== null ? formatTime(rec.bestFullArchiveTime) : '—', improved.bestFullArchiveTime],
      ['Fewest Recoveries', rec.fewestRecoveries ? `${rec.fewestRecoveries.recoveries} (${formatTime(rec.fewestRecoveries.time)})` : '—', improved.fewestRecoveries],
    ];
    container.replaceChildren(...rows.map(([label, value, isNew]) => {
      const d = document.createElement('div'); d.className = `rec${isNew ? ' new' : ''}`;
      const a = document.createElement('span'); a.textContent = isNew ? `${label} — new record` : label;
      const b = document.createElement('span'); b.textContent = value;
      d.append(a, b); return d;
    }));
  }

  renderTitle(rec) {
    const has = rec.bestTime !== null;
    this.el.titleRecords.classList.toggle('hidden', !has);
    if (has) this.recordRows(this.el.titleRecords, rec);
  }

  renderComplete(result, rec, improved) {
    const e = this.el;
    e.completeTitle.textContent = 'Signal Restored';
    e.completeKind.innerHTML = result.fullArchive
      ? '<span class="full-archive">Full-Archive Expedition — every memory recovered.</span>'
      : `Expedition complete. ${3 - result.archives} memory archive${3 - result.archives === 1 ? '' : 's'} still buried below.`;
    const rows = [
      ['Expedition Time', formatTime(result.time)],
      ['Recoveries', String(result.recoveries)],
      ['Archives Recovered', `${result.archives} / 3`],
      ['Caches Found', `${result.caches} / 3`],
      ['Machines Disabled', `${result.machines} / 4`],
      ['Relays', result.relays.map((r) => `${r.id} ${r.active ? '●' : '○'}`).join('   ')],
    ];
    e.resultsTable.replaceChildren(...rows.map(([k, v]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.textContent = k;
      const td = document.createElement('td'); td.textContent = v;
      tr.append(th, td); return tr;
    }));
    this.recordRows(e.completeRecords, rec, improved);
  }
}
