// DEEPWAKE — renderer: scene, perspective diorama camera, shadow-casting key light, a small pool
// of accent lights and a restrained post chain (bloom, vignette, filmic tone mapping).
// Reads the simulation; world-space movement, hazards and timing never depend on anything here.

import * as THREE from 'three';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/jsm/postprocessing/OutputPass.js';
import { buildWorld } from './world.js';
import { IloView } from './ilo.js';
import { EntityViews } from './entities.js';
import { Fx } from './fx.js';
import { W, H } from '../level.js';
import { C } from '../config.js';
import { MAT, damp, clamp01, lerp } from './vox.js';

const FOV = 32;
const PITCH = 0.2;           // three-quarter look down into the rooms
const BASE_VIEW_H = 12.2;    // world units visible vertically at the gameplay plane
const MIN_VIEW_W = 12;       // never show less than this horizontally (narrow screens zoom out)
const POOL = 6;
const SHADOW_SIZE = 2048;
const KEY = 1.5;            // key light intensity
const AMB = 0.42;            // ambient intensity

const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.42 }, saturation: { value: 1.12 }, lift: { value: new THREE.Vector3(0.012, 0.018, 0.03) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation; uniform vec3 lift; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.86);
      float v = smoothstep(0.78, 0.2, length(d));
      c.rgb *= mix(1.0 - vignette, 1.0, v);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation) + lift * (1.0 - v) * 0.5;
      gl_FragColor = c;
    }`,
};

export class Renderer {
  constructor(canvas, sim) {
    // Throws when WebGL is unavailable; the caller shows a fallback message.
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setClearColor(0x080d13, 1);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.12;
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a1119, 40, 70);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 140);
    MAT.glow.color.setScalar(1.35);       // emissive accents sit above the bloom threshold

    // Key light: enters the open front of every room and casts real shadows onto floors and back walls.
    this.keyDir = new THREE.Vector3(-0.4, 0.52, 0.76).normalize();
    this.key = new THREE.DirectionalLight(0xfff0dc, KEY);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.035;
    this.key.shadow.radius = 2.2;
    // Top fill keeps standable surfaces brightest even inside shadow.
    this.fill = new THREE.DirectionalLight(0xbdd3ee, 0.4);
    this.ambient = new THREE.AmbientLight(0x8fa6c4, AMB);
    this.hemi = new THREE.HemisphereLight(0x9fc0e0, 0x20262e, 0.32);
    this.scene.add(this.key, this.key.target, this.fill, this.fill.target, this.ambient, this.hemi);
    this.pool = [];
    for (let k = 0; k < POOL; k++) { const l = new THREE.PointLight(0xffffff, 0, 12, 1.8); this.scene.add(l); this.pool.push(l); }
    this.iloLight = new THREE.PointLight(0xcfe9f2, 2.2, 7.5, 1.7);
    this.scene.add(this.iloLight);

    this.world = buildWorld(this.scene, sim.level);
    this.ilo = new IloView();
    this.scene.add(this.ilo.root);
    this.ents = new EntityViews(this.scene, sim);
    this.fx = new Fx(this.scene);

    this.cam = { x: sim.player.x, y: sim.player.y + 2, look: 0, zoom: 1, dx: 0, dy: 0, shake: 0, focusW: 0 };
    this.viewH = BASE_VIEW_H; this.aspect = 1;
    this.dawn = 0;
    this.anchorBuf = [];
    this.cWarm = new THREE.Color(0xffd2a0); this.cCool = new THREE.Color(0xfff0dc); this.cAmbCool = new THREE.Color(0x8fa6c4); this.cAmbWarm = new THREE.Color(0xffd9b8);
    this.lr = new THREE.Vector3(); this.lu = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.lr.crossVectors(new THREE.Vector3(0, 1, 0), this.keyDir).normalize();
    this.lu.crossVectors(this.keyDir, this.lr).normalize();

    // Post chain (optional): any failure falls back to direct rendering.
    this.composer = null;
    try {
      const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.gl, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.5, 0.72);
      this.composer.addPass(this.bloom);
      this.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.grade);
      this.composer.addPass(new OutputPass());
    } catch (err) {
      console.warn('Post-processing unavailable; rendering directly.', err);
      this.composer = null;
    }

    this.resize();
    this.snap(sim, true);
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || globalThis.innerWidth), h = Math.max(1, this.canvas.clientHeight || globalThis.innerHeight);
    this.gl.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(this.pixelRatio); this.composer.setSize(w, h); }
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    // Narrow screens widen the framing; world-space rules are untouched.
    this.viewH = Math.max(BASE_VIEW_H, MIN_VIEW_W / this.aspect);
    this.camera.updateProjectionMatrix();
  }

  zoneFor(sim) {
    const p = sim.player;
    for (const z of sim.level.cameraZones) {
      const r = z.rect;
      if (p.x >= r[0] && p.x <= r[2] && p.y >= r[1] - 0.1 && p.y <= r[3]) return z;
    }
    return null;
  }

  target(sim, title) {
    if (title) return { x: 10.5, y: 13.0, zoom: 0.9 };
    const p = sim.player, z = this.zoneFor(sim);
    return { x: p.x + this.cam.look + this.cam.dx, y: p.y + 1.9 + this.cam.dy, zoom: z ? z.zoom : 1 };
  }

  /** Jump the camera to its framing immediately (after recovery, restart or resize). */
  snap(sim, title = false) {
    this.cam.look = 0; this.cam.shake = 0; this.cam.focusW = 0;
    const z0 = title ? null : this.zoneFor(sim);
    this.cam.dx = z0 ? z0.dx || 0 : 0; this.cam.dy = z0 ? z0.dy || 0 : 0;
    const tg = this.target(sim, title);
    this.cam.x = tg.x; this.cam.y = tg.y; this.cam.zoom = tg.zoom;
    this.fx.clear();
  }

  onEvent(e, sim) {
    this.fx.onEvent(e, sim);
    if (e.type === 'damage') this.cam.shake = 0.12;
    else if (e.type === 'pressSlam' && Math.abs(e.x - sim.player.x) < 12) this.cam.shake = Math.max(this.cam.shake, 0.08);
    else if (e.type === 'seamBreak') this.cam.shake = Math.max(this.cam.shake, 0.05);
    else if (e.type === 'shutdown') this.cam.shake = Math.max(this.cam.shake, 0.08);
  }

  frame(sim, t, dt, { reduced = false, title = false } = {}) {
    const p = sim.player, cam = this.cam;

    this.ilo.update(sim, t, dt, reduced);
    this.ents.update(sim, this.ilo, t, dt, reduced);
    this.world.updateConduits(sim, t, dt);
    for (const a of this.world.animated) a.update(t, sim);

    // ── camera ──
    const z = this.zoneFor(sim);
    const moving = Math.abs(p.vx) > 1 ? 1 : 0;
    cam.look = damp(cam.look, title ? 0 : p.facing * 1.7 * (0.35 + 0.65 * moving), 2.2, dt);
    cam.dy = damp(cam.dy, z ? z.dy || 0 : 0, 2.5, dt);
    cam.dx = damp(cam.dx, z && !title ? z.dx || 0 : 0, 2.0, dt);
    const tg = this.target(sim, title);
    let tx = tg.x, ty = tg.y;
    if (title) tx += Math.sin(t * 0.12) * 1.2;
    // relay activation: a short restrained look at the newly powered route, then back
    let fw = 0;
    if (sim.state === 'relayActivation' && sim.focus) { const s = sim.stateT / C.relayTime; fw = smooth(0.08, 0.3, s) * (1 - smooth(0.72, 0.95, s)); }
    cam.focusW = damp(cam.focusW, fw, 8, dt);
    if (cam.focusW > 0.001 && sim.focus) { tx = lerp(tx, sim.focus.x, cam.focusW * 0.8); ty = lerp(ty, sim.focus.y + 0.5, cam.focusW * 0.8); }
    if (sim.state === 'liftSequence' && (sim.liftPhase === 'walk' || sim.liftPhase === 'rest' || sim.liftPhase === 'arrive')) { tx = lerp(tx, 215, 0.7); ty = Math.max(ty, 68.0); }
    if (sim.state === 'complete') { tx = lerp(tx, 215, 0.7); ty = Math.max(ty, 68.0); }
    cam.zoom = damp(cam.zoom, tg.zoom, 2.5, dt);
    const viewH = this.viewH * cam.zoom, halfW = (viewH * this.aspect) / 2, halfH = viewH / 2;
    if (halfW * 2 < W) tx = Math.min(W - halfW, Math.max(halfW, tx));
    ty = Math.min(H - halfH + 0.5, Math.max(halfH, ty));
    cam.x = damp(cam.x, tx, 6.5, dt);
    cam.y = damp(cam.y, ty, Math.abs(ty - cam.y) > 3 ? 7 : 4.5, dt);
    cam.shake = Math.max(0, cam.shake - dt * 0.5);
    const sh = reduced ? 0 : Math.min(0.12, cam.shake);
    const sx = Math.sin(t * 91) * sh, sy = Math.cos(t * 77) * sh;
    const dist = halfH / Math.tan((FOV * Math.PI) / 360);
    this.camera.position.set(cam.x + sx, cam.y + sy + Math.sin(PITCH) * dist, Math.cos(PITCH) * dist);
    this.camera.lookAt(cam.x + sx, cam.y + sy, 0);
    this.scene.fog.near = dist + 5; this.scene.fog.far = dist + 30;

    this.fx.update(sim, cam, t, dt, reduced, this.ents.sparks);

    // ── dawn: warm daylight appears only during the final escape ──
    let dawnTarget = 0;
    if (sim.state === 'liftSequence' || sim.state === 'complete') {
      dawnTarget = sim.liftPhase === 'barrier' ? 0 : sim.liftPhase === 'rise' ? smooth(46, 62, p.y) * 0.75 : 1;
    }
    this.dawn = damp(this.dawn, dawnTarget, 1.6, dt);
    this.world.sky.dawn = this.dawn;
    this.key.color.copy(this.cCool).lerp(this.cWarm, this.dawn);
    this.key.intensity = KEY + 1.5 * this.dawn;
    this.ambient.color.copy(this.cAmbCool).lerp(this.cAmbWarm, this.dawn);
    this.ambient.intensity = AMB + 0.45 * this.dawn;

    // ── key light + shadow frustum follow the framed area (snapped to shadow texels: no shimmer) ──
    const ext = Math.max(halfW + 5, halfH + 7);
    const texel = (ext * 2) / SHADOW_SIZE;
    this.tmp.set(cam.x, cam.y - 0.5, -1.8);
    const pr = Math.round(this.tmp.dot(this.lr) / texel) * texel, pu = Math.round(this.tmp.dot(this.lu) / texel) * texel, pd = this.tmp.dot(this.keyDir);
    this.tmp.set(0, 0, 0).addScaledVector(this.lr, pr).addScaledVector(this.lu, pu).addScaledVector(this.keyDir, pd);
    this.key.target.position.copy(this.tmp);
    this.key.position.copy(this.tmp).addScaledVector(this.keyDir, 50);
    const sc = this.key.shadow.camera;
    if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 5; sc.far = 100; sc.updateProjectionMatrix(); }
    this.fill.position.set(cam.x + 1, cam.y + 30, 6);
    this.fill.target.position.set(cam.x, cam.y, 0);

    // ── light pool: nearest anchors to the framed area ──
    const buf = this.anchorBuf;
    buf.length = 0;
    for (const a of this.world.anchors) { const d = Math.hypot(a.x - cam.x, a.y - cam.y); if (d < 20) buf.push([d, a]); }
    for (const a of this.ents.lights) { const d = Math.hypot(a.x - cam.x, a.y - cam.y); if (d < 20) buf.push([d - a.intensity * 2, a]); }
    buf.sort((m, n) => m[0] - n[0]);
    for (let k = 0; k < POOL; k++) {
      const l = this.pool[k], item = buf[k];
      if (!item) { l.intensity = 0; continue; }
      const a = item[1];
      l.position.set(a.x, a.y, a.z + 0.6);
      l.color.setHex(a.color);
      l.intensity = a.intensity * 11 * clamp01(1.25 - Math.max(0, item[0]) / 16);
    }
    this.iloLight.position.set(p.x, p.y + 1.0, 1.4);
    this.iloLight.intensity = sim.state === 'shutdown' ? 0.6 : 2.2;

    if (this.composer) this.composer.render(dt);
    else this.gl.render(this.scene, this.camera);
  }

  dispose() {
    this.world.dispose(); this.ents.dispose(); this.fx.dispose(); this.ilo.dispose();
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.gl.dispose();
  }
}
