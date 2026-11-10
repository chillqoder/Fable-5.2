import { STATIONS, CONTACT } from './stations.js';
import { createPlate } from './plate.js';
import { prepare, render } from './text.js';
import { createAudio } from './audio.js';

const N = STATIONS.length;
const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrowMq = matchMedia('(max-width: 820px)');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const palettes = STATIONS.map((s) => ({ bg: hex(s.colors.bg), ink: hex(s.colors.ink), acc: hex(s.colors.acc) }));

// frequency for a fractional station coordinate (piecewise-logarithmic)
function hzAt(t) {
  const k = clamp(Math.floor(t), 0, N - 2);
  const a = STATIONS[k].hz, b = STATIONS[k + 1].hz;
  return a * Math.pow(b / a, t - k);
}

// ---------- DOM: stations ----------
const stationsEl = $('#stations');
const sections = STATIONS.map((s, k) => {
  const el = document.createElement('section');
  el.id = s.id;
  el.hidden = true;
  el.setAttribute('aria-label', s.name);
  el.innerHTML = `
    <p class="kicker">${esc(s.kicker)}</p>
    <h2>${s.head}</h2>
    <p class="body"><span class="tape">${esc(s.body)}</span></p>
    ${s.form ? `<form autocomplete="off">
      <input name="idea" maxlength="24" placeholder="Например, сервис для…" aria-label="Ваша идея" enterkeyhint="send">
      <button type="submit">Собрать бриф →</button>
    </form>` : ''}
    ${!s.form ? `<div class="station-actions"><button class="primary-action" data-go="5">Обсудить проект <span>↗</span></button><button class="secondary-action" data-go="${k === 2 ? 4 : 2}">${k === 2 ? 'Форматы работы' : 'Что мы делаем'} →</button></div>` : '<p class="contact-note">Контакт студии пока не указан. Можно сохранить бриф на устройство.</p>'}
    <ul class="pins">${s.pins.map((p) => `<li><b>${esc(p.t)}</b><span class="tape">${esc(p.d)}</span></li>`).join('')}</ul>`;
  stationsEl.append(el);
  return { el, k, pins: [...el.querySelectorAll('.pins li')], text: prepare(el) };
});

// ---------- DOM: dial ----------
const strip = $('#strip');
let step = 300;
const stationButtons = [];
{
  const at = (t) => `calc(var(--step) * ${(t + 0.5).toFixed(3)})`;
  let html = '';
  for (let i = 0; i <= N * 20; i++) {
    const t = -0.5 + i * 0.05;
    const cls = i % 20 === 10 ? 'st' : i % 5 === 0 ? 'mid' : '';
    html += `<i class="${cls}" style="left:${at(t)}"></i>`;
    if (i % 20 === 0) html += `<small style="left:${at(t)}">${hzAt(t).toFixed(0)}</small>`;
  }
  strip.innerHTML = html;
  STATIONS.forEach((s, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.left = at(k);
    b.innerHTML = `<b>${String(s.hz).padStart(3, '0')}</b>${s.name}`;
    b.addEventListener('click', () => { if (drag.moved < 6) go(k); });
    strip.append(b);
    stationButtons.push(b);
  });
}

const quickButtons = STATIONS.map((s, k) => {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = s.name;
  b.addEventListener('click', () => go(k));
  $('#quick-nav').append(b);
  return b;
});
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(Number(b.dataset.go))));

// ---------- plate ----------
const canvas = $('#plate');
const grains = narrowMq.matches || (navigator.hardwareConcurrency || 8) <= 4 ? 38000 : 84000;
let plate = null;
try { plate = createPlate(canvas, STATIONS, grains); } catch (err) { console.error(err); }
if (!plate) document.body.classList.add('no-gl');
if (plate && document.fonts) {
  document.fonts.load('900 100px Fraunces').then(() => plate.refreshMasks()).catch(() => {});
}

const leaders = $('#leaders');
const audio = createAudio();
$('#shake').disabled = !plate;
$('#shake').addEventListener('click', () => { state.kick = 1; });

// ---------- state ----------
const startK = Math.max(0, STATIONS.findIndex((s) => '#' + s.id === location.hash));
const state = { t: startK, target: startK, k: -1, lock: 0, kick: 0, time: 0, lastInput: -1e9 };
const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
const drag = { on: false, x: 0, y: 0, moved: 0 };
const orbit = { yaw: 0, pitch: 0, sy: 0, sp: 0, explode: 0, target: 0 };
$('#explode').disabled = !plate;
$('#explode').addEventListener('click', (e) => {
  orbit.target = 1-orbit.target;
  e.currentTarget.setAttribute('aria-pressed', String(!!orbit.target));
  e.currentTarget.textContent = orbit.target ? 'Собрать прибор' : 'Разобрать прибор';
});
$('#reset-view').addEventListener('click', () => { orbit.yaw=0; orbit.pitch=0; });
let W = innerWidth, H = innerHeight;

function touched() {
  state.lastInput = performance.now();
  $('#hint').hidden = true;
}
function tune(d) {
  state.target = clamp(state.target + d, -0.3, N - 0.7);
  touched();
}
function go(k) {
  state.target = clamp(k, 0, N - 1);
  $('#hint').hidden = true;
}

function layout() {
  W = innerWidth; H = innerHeight;
  step = narrowMq.matches ? 190 : 300;
  root.style.setProperty('--step', step + 'px');
  plate?.resize();
}
addEventListener('resize', layout);
layout();

// ---------- input ----------
addEventListener('wheel', (e) => {
  if (e.target.closest?.('input, textarea, .pins') || (narrowMq.matches && e.target.closest?.('#stations section'))) return;
  e.preventDefault();
  const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  tune(d * (e.deltaMode === 1 ? 0.03 : 0.0011));
}, { passive: false });

for (const el of [canvas, $('#dial')]) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (el === canvas) el.setPointerCapture(e.pointerId);
    drag.on = true; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0; drag.dial = el !== canvas;
  });
}
addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / W) * 2 - 1;
  pointer.y = (e.clientY / H) * 2 - 1;
  if (!drag.on) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.dial) tune(-dx/step);
  else { orbit.yaw += dx*0.006; orbit.pitch=clamp(orbit.pitch+dy*0.004,-0.4,0.6); }
});
addEventListener('pointerup', () => { drag.on = false; });
addEventListener('pointercancel', () => { drag.on = false; });

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, button')) return;
  const near = Math.round(state.target);
  if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key)) go(near + 1);
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) go(near - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(N - 1);
  else if (/^[1-9]$/.test(e.key) && +e.key <= N) go(+e.key - 1);
  else return;
  e.preventDefault();
});
addEventListener('hashchange', () => {
  const k = STATIONS.findIndex((s) => '#' + s.id === location.hash);
  if (k >= 0 && k !== Math.round(state.target)) go(k);
});

$('#sound').addEventListener('click', (e) => {
  const on = audio.toggle();
  e.currentTarget.setAttribute('aria-pressed', on);
  e.currentTarget.textContent = on ? 'звук вкл.' : 'звук выкл.';
});

// the last station: whatever you type, the sand spells
const signalK = STATIONS.findIndex((s) => s.form);
if (signalK >= 0) {
  const form = sections[signalK].el.querySelector('form');
  const input = form.elements.idea;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      plate?.setWord(signalK, input.value.trim() || STATIONS[signalK].word);
      state.kick = 0.92; // shake the plate so the sand can redraw
    }, 90);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const idea = input.value.trim() || 'something that does not exist yet';
    if (CONTACT.endsWith('.example')) {
      const blob = new Blob(['Бриф для NODAL\n\nИдея: ' + idea + '\n\nДля кого продукт:\nОсновные функции:\nЖелаемые сроки:\nБюджет:\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'nodal-brief.txt'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    location.href = `mailto:${CONTACT}?subject=${encodeURIComponent('Signal: ' + idea)}&body=${encodeURIComponent('I want: ' + idea + '\n\n')}`;
  });
}

// ---------- per-frame ----------
const lockEl = $('#lock');
lockEl.innerHTML = '<i></i>'.repeat(8);
const lockBars = [...lockEl.children];
const hzEl = $('#hz'), modeEl = $('#mode'), themeMeta = $('meta[name="theme-color"]');
const cache = { hz: '', bars: -1, colors: '', wght: '', scramble: 0, resolved: false };

function activate(k) {
  state.k = k;
  sections.forEach((s) => { s.el.hidden = s.k !== k; });
  [stationButtons, quickButtons].forEach(buttons => buttons.forEach((b, i) => b.setAttribute('aria-current', i === k)));
  const [n, m] = STATIONS[k].mode;
  modeEl.textContent = `mode ${n}·${m}`;
  leaders.innerHTML = STATIONS[k].pins.map(() => '<line/><circle r="3.5"/>').join('');
  cache.resolved = false;
  if ('#' + STATIONS[k].id !== location.hash) history.replaceState(null, '', '#' + STATIONS[k].id);
  document.title = `NODAL — ${STATIONS[k].hz} Hz ${STATIONS[k].name}`;
}

function placePins(sec) {
  const flat = narrowMq.matches || !plate;
  const scale = clamp(W / 1440, 0.72, 1.15);
  const marks = leaders.children;
  STATIONS[sec.k].pins.forEach((p, i) => {
    const li = sec.pins[i];
    if (flat) { li.style.transform = ''; return; }
    const [sx, sy] = plate.project(p.at[0], p.at[1]);
    const w = li.offsetWidth, h = li.offsetHeight;
    const x = clamp(sx + p.off[0] * scale, W * 0.49, W - w - 24);
    const top = x + w > W - 270 ? 150 : 96; // keep clear of the frequency readout
    const y = clamp(sy + p.off[1] * scale, top, H - h - 130);
    li.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    const line = marks[i * 2], dot = marks[i * 2 + 1];
    if (!line) return;
    const ax = x + w / 2 < sx ? x + w + 6 : x - 6;
    line.setAttribute('x1', sx); line.setAttribute('y1', sy);
    line.setAttribute('x2', ax); line.setAttribute('y2', y + 11);
    dot.setAttribute('cx', sx); dot.setAttribute('cy', sy);
  });
}

let prev = performance.now();
function tick(now) {
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;
  state.time += dt;

  // dial physics: follow the hand, then fall into the nearest resonance
  if (!drag.on && now - state.lastInput > 420) {
    state.target = lerp(state.target, clamp(Math.round(state.target), 0, N - 1), 1 - Math.exp(-dt * 6));
  }
  state.t = reduced ? state.target : lerp(state.t, state.target, 1 - Math.exp(-dt * 9));
  state.kick *= Math.exp(-dt * 2.4);

  const t = state.t;
  const k = clamp(Math.round(t), 0, N - 1);
  const lock = 1 - smooth(0.03, 0.42, Math.abs(t - k));
  state.lock = lock;
  if (k !== state.k) activate(k);
  const sec = sections[k];

  // palette + camera glide between neighbouring stations
  const a = clamp(Math.floor(t), 0, N - 1), b = Math.min(a + 1, N - 1);
  const f = smooth(0.2, 0.8, clamp(t - a, 0, 1));
  const colors = {
    bg: mix3(palettes[a].bg, palettes[b].bg, f),
    // ink and accent flip quickly at the midpoint so contrast never sags for long
    ink: mix3(palettes[a].ink, palettes[b].ink, smooth(0.4, 0.6, t - a)),
    acc: mix3(palettes[a].acc, palettes[b].acc, smooth(0.4, 0.6, t - a)),
  };
  const key = css(colors.bg) + css(colors.ink) + css(colors.acc);
  if (key !== cache.colors) {
    cache.colors = key;
    root.style.setProperty('--bg', css(colors.bg));
    root.style.setProperty('--ink', css(colors.ink));
    root.style.setProperty('--acc', css(colors.acc));
    themeMeta.content = css(colors.bg);
  }

  pointer.sx = lerp(pointer.sx, pointer.x, 1 - Math.exp(-dt * 3));
  pointer.sy = lerp(pointer.sy, pointer.y, 1 - Math.exp(-dt * 3));
  const ca = STATIONS[a].cam, cb = STATIONS[b].cam;
  const sway = reduced ? 0 : 1;
  const narrow = narrowMq.matches;
  const aspect = W / H;
  const follow=reduced?1:1-Math.exp(-dt*7);
  orbit.sy=lerp(orbit.sy,orbit.yaw,follow);
  orbit.sp=lerp(orbit.sp,orbit.pitch,follow);
  orbit.explode=lerp(orbit.explode,orbit.target,follow);
  const cam = {
    yaw: orbit.sy + lerp(ca.yaw, cb.yaw, f) + sway * Math.sin(state.time * 0.23) * 0.09 + pointer.sx * 0.14,
    pitch: clamp(orbit.sp - orbit.explode*0.2 + lerp(ca.pitch, cb.pitch, f) + sway * Math.sin(state.time * 0.17) * 0.03 - pointer.sy * 0.07, 0.35, 1.47),
    dist: Math.max(lerp(ca.dist, cb.dist, f), (narrow ? 5.3 : 6.5) / aspect) + orbit.explode*0.9,
  };

  if (plate) {
    plate.frame(dt, {
      k, lock: lock * (1 - state.kick), time: state.time, colors, cam,
      shift: narrow ? [0, 0.38 - orbit.explode*0.12] : [0.43, 0.10], calm: reduced, explode: orbit.explode,
    });
  }
  placePins(sec);

  // copy resolves out of code noise as the lock closes
  if (lock < 1) {
    cache.resolved = false;
    if (now - cache.scramble > 48) { cache.scramble = now; render(sec.text, lock); }
  } else if (!cache.resolved) {
    cache.resolved = true;
    render(sec.text, 1);
  }
  const wght = lock < 1 ? `${Math.round(620 + Math.sin(state.time * 34) * (1 - lock) * 270)}|${Math.round((1 - lock) * 100)}` : '620|0';
  if (wght !== cache.wght) {
    cache.wght = wght;
    const [w, s] = wght.split('|');
    root.style.setProperty('--wght', w);
    root.style.setProperty('--soft', s);
  }

  // readouts
  const hz = hzAt(t);
  const hzText = hz.toFixed(1).padStart(5, '0');
  if (hzText !== cache.hz) { cache.hz = hzText; hzEl.textContent = hzText; }
  const bars = Math.round(lock * 8);
  if (bars !== cache.bars) {
    cache.bars = bars;
    lockBars.forEach((el, i) => el.classList.toggle('on', i < bars));
    lockEl.classList.toggle('full', bars === 8);
  }
  strip.style.transform = `translateX(${(W / 2 - (t + 0.5) * step).toFixed(1)}px)`;
  audio.update(hz, lock);

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.__nodal = { state, go, tune, orbit };
