// The plate: a WebGL2 renderer plus a grain-by-grain sand simulation.
// Sand is agitated in proportion to the local vibration amplitude, so it
// migrates to wherever the plate stays still: nodal lines and letterforms.

export const G = 224; // field resolution (cells per plate side)
const MESH = 128;     // plate mesh resolution
const FOV = (35 * Math.PI) / 180;

const PLATE_VS = `#version 300 es
precision highp float;
in vec2 aP;
uniform sampler2D uField;
uniform mat4 uVP;
uniform vec2 uShift;
uniform float uTime, uLock, uBreath, uExplode;
out vec2 vP;
out vec3 vW;
float hgt(vec2 p){
  float u = texture(uField, p*0.5+0.5).r*2.0-1.0;
  float still = u*sin(uTime*5.2)*uBreath;
  float chaos = sin(p.x*9.0+uTime*3.1)*sin(p.y*7.0-uTime*2.3)*0.014*(1.0-uLock);
  return still+chaos;
}
void main(){
  vP = aP;
  vec3 w = vec3(aP.x, hgt(aP)+uExplode*0.72, -aP.y);
  vW = w;
  vec4 c = uVP*vec4(w,1.0);
  c.xy += uShift*c.w;
  gl_Position = c;
}`;

const PLATE_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec3 vW;
uniform vec3 uBg, uInk, uEye, uAcc;
uniform float uTime, uLock;
out vec4 o;
void main(){
  vec2 corner=max(abs(vP)-0.94,0.0);
  if(length(corner)>0.06) discard;
  vec3 n=normalize(cross(dFdx(vW),dFdy(vW)));
  if(n.y<0.0) n=-n;
  vec3 v=normalize(uEye-vW);
  vec3 r=reflect(-v,n);
  float key=pow(max(dot(r,normalize(vec3(-0.6,1.0,-0.4))),0.0),18.0);
  float strip=pow(max(dot(r,normalize(vec3(0.8,0.65,0.2))),0.0),42.0);
  float fres=pow(1.0-max(dot(n,v),0.0),4.0);
  float grain=fract(sin(dot(vP,vec2(127.1,311.7)))*43758.5453);
  vec3 col=vec3(0.075,0.092,0.10)+grain*0.012;
  col+=key*vec3(0.20,0.23,0.25)+strip*vec3(0.32,0.24,0.16)+fres*0.12;
  // Fine etched grid and concentric calibration marks, antialiased in screen space.
  vec2 grid=abs(fract(vP*10.0+0.5)-0.5)/max(fwidth(vP*10.0),vec2(0.001));
  float gridLine=1.0-min(min(grid.x,grid.y),1.0);
  col+=gridLine*0.018;
  float e=1.0-max(abs(vP.x),abs(vP.y));
  float along=abs(vP.x)>abs(vP.y)?vP.y:vP.x;
  float fi=(along*0.5+0.5)*40.0;
  float nearTick=abs(fract(fi+0.5)-0.5);
  float major=step(mod(floor(fi+0.5),5.0),0.5);
  float tick=(1.0-smoothstep(0.025,0.025+fwidth(fi),nearTick))*step(e,mix(0.025,0.055,major))*step(0.012,e);
  col=mix(col,vec3(0.65,0.70,0.69),tick*0.7);
  float border=1.0-smoothstep(0.002,0.002+fwidth(e),abs(e-0.075));
  col+=border*0.06;
  float radius=length(vP);
  float ring=1.0-smoothstep(0.002,0.002+fwidth(radius),abs(radius-0.035));
  col=mix(col,vec3(0.71,0.48,0.22),ring);
  float pulse=exp(-pow((radius-fract(uTime*0.6)*1.7)*24.0,2.0));
  col+=pulse*(1.0-uLock)*vec3(0.30,0.13,0.025);
  o=vec4(col,1.0);
}`;

const SAND_VS = `#version 300 es
precision highp float;
in vec2 aP;
in float aSeed;
uniform sampler2D uField;
uniform mat4 uVP;
uniform vec2 uShift;
uniform float uTime, uLock, uBreath, uHop, uSize, uExplode;
out float vAir;
out float vSeed;
void main(){
  vec2 f = texture(uField, aP*0.5+0.5).rg;
  float u = f.r*2.0-1.0;
  float a = f.g;
  float base = u*sin(uTime*5.2)*uBreath
    + sin(aP.x*9.0+uTime*3.1)*sin(aP.y*7.0-uTime*2.3)*0.014*(1.0-uLock);
  float hop = a*uHop*abs(sin(uTime*(7.0+aSeed*11.0)+aSeed*40.0));
  vec4 c = uVP*vec4(aP.x, base+hop+0.004+uExplode*0.72, -aP.y, 1.0);
  c.xy += uShift*c.w;
  gl_Position = c;
  gl_PointSize = max(1.0, uSize*(0.65+0.7*fract(aSeed*7.13))/c.w);
  vAir = clamp(hop/0.07,0.0,1.0);
  vSeed = aSeed;
}`;

const SAND_FS = `#version 300 es
precision highp float;
in float vAir, vSeed;
uniform vec3 uInk, uAcc;
out vec4 o;
void main(){
  vec2 d=gl_PointCoord*2.0-1.0;
  float rr=dot(d,d);
  if(rr>1.0) discard;
  vec3 n=vec3(d,sqrt(1.0-rr));
  float diffuse=max(dot(n,normalize(vec3(-0.5,-0.65,1.0))),0.0);
  float spec=pow(max(dot(n,normalize(vec3(-0.4,-0.5,1.0))),0.0),24.0);
  vec3 gold=mix(vec3(0.50,0.28,0.09),vec3(0.93,0.74,0.40),vSeed);
  vec3 col=gold*(0.38+diffuse*0.72)+spec*vec3(0.5,0.44,0.30);
  col+=vAir*vec3(0.14,0.08,0.02);
  o=vec4(col,1.0);
}`;

const BODY_VS = `#version 300 es
precision highp float;
in vec3 aPos, aNormal;
in float aMaterial, aLayer;
uniform mat4 uVP;
uniform vec2 uShift;
uniform float uExplode;
out vec3 vPos, vNormal;
flat out float vMaterial;
void main(){
  vPos=aPos+vec3(0.0,aLayer*uExplode*0.72,0.0); vNormal=aNormal; vMaterial=aMaterial;
  vec4 c=uVP*vec4(vPos,1.0);
  c.xy+=uShift*c.w;
  gl_Position=c;
}`;
const BODY_FS = `#version 300 es
precision highp float;
in vec3 vPos, vNormal;
flat in float vMaterial;
uniform vec3 uBg, uInk, uEye, uAcc;
uniform float uShadow, uTime, uLock;
out vec4 o;
void main(){
  if(uShadow>0.5){
    vec2 d=max(abs(vPos.xz-vec2(0.06,0.04))-vec2(0.88),0.0);
    float a=exp(-dot(d,d)*8.0)*0.24;
    a+=exp(-dot(d,d)*35.0)*0.12;
    a*=1.0-smoothstep(1.4,1.9,max(abs(vPos.x),abs(vPos.z)));
    o=vec4(vec3(0.035,0.03,0.025),a);return;
  }
  vec3 n=normalize(vNormal), v=normalize(uEye-vPos);
  vec3 light=normalize(vec3(-0.5,0.9,0.4));
  float diffuse=max(dot(n,light),0.0);
  vec3 r=reflect(-v,n);
  float key=pow(max(dot(r,normalize(vec3(-0.5,1.0,0.4))),0.0),24.0);
  float rim=pow(max(dot(r,normalize(vec3(0.7,0.4,-0.6))),0.0),12.0);
  float softbox=exp(-pow((r.x+0.35)*4.0,2.0)-pow((r.y-0.7)*2.0,2.0));
  key+=softbox*0.6;
  float fres=pow(1.0-max(dot(n,v),0.0),4.0);
  vec3 base=vec3(0.12,0.15,0.16);
  if(vMaterial>0.5 && vMaterial<1.5) base=vec3(0.58,0.62,0.63);
  if(vMaterial>1.5 && vMaterial<2.5) base=vec3(0.62,0.34,0.12);
  if(vMaterial>2.5 && vMaterial<3.5) base=vec3(0.027,0.033,0.036);
  vec3 col=base*(0.42+diffuse*0.62)+key*0.38+rim*vec3(0.18,0.22,0.25)+fres*0.10;
  // Recessed cooling slots on the dark lower chassis.
  if(vMaterial<0.5 && abs(n.y)<0.2 && vPos.y< -0.15 && vPos.y> -0.27){
    float along=abs(n.z)>0.5?vPos.x:vPos.z;
    float slot=step(0.35,fract(along*24.0))*step(abs(along),0.73);
    float ends=smoothstep(-0.27,-0.25,vPos.y)*(1.0-smoothstep(-0.18,-0.15,vPos.y));
    col=mix(col,vec3(0.018,0.023,0.025),slot*ends*0.85);
  }
  if(vMaterial>3.5 && vMaterial<4.5){
    col=vec3(0.85,0.30,0.055)*(0.8+0.2*sin(uTime*3.0)*(1.0-uLock));
  }
  if(vMaterial>4.5 && vMaterial<5.5) col=vec3(0.025,0.16,0.12)*(0.6+diffuse*0.6)+key*0.08;
  if(vMaterial>5.5 && vMaterial<6.5) col=vec3(0.035,0.04,0.045)*(0.7+diffuse)+key*0.08;
  o=vec4(col,1.0);
}`;

// ---- tiny mat4 (column-major) ----
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
  return m;
}
function lookAt(e, t, up) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[4] = xy; m[5] = yy; m[6] = zy; m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
  m[13] = -(yx * e[0] + yy * e[1] + yz * e[2]);
  m[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
  m[15] = 1;
  return m;
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

// ---- word → stillness mask: the plate does not move inside the glyphs ----
function wrapWord(text) {
  const t = text.toUpperCase().trim().slice(0, 24);
  const max = t.length <= 7 ? 7 : t.length <= 16 ? 8 : 9;
  const lines = [];
  let cur = '';
  for (const w of t.split(/\s+/)) {
    let word = w;
    while (word.length > max) { if (cur) { lines.push(cur); cur = ''; } lines.push(word.slice(0, max)); word = word.slice(max); }
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= max) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

const scratch = document.createElement('canvas');
scratch.width = scratch.height = G;
const sctx = scratch.getContext('2d', { willReadFrequently: true });

function rasterWord(text) {
  const lines = wrapWord(text);
  const out = new Float32Array(G * G);
  out.size = 0;
  if (!lines.length || !lines[0]) return out;
  const face = 'Fraunces, "Arial Black", Impact, sans-serif';
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.shadowBlur = 0;
  sctx.clearRect(0, 0, G, G);
  if ('letterSpacing' in sctx) sctx.letterSpacing = '2px';
  let size = 100;
  sctx.font = `900 ${size}px ${face}`;
  const widest = Math.max(...lines.map((l) => sctx.measureText(l).width));
  size = Math.min((size * G * 0.82) / widest, (G * 0.62) / (lines.length * 0.9));
  out.size = size;
  sctx.font = `900 ${size}px ${face}`;
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillStyle = '#fff';
  const lh = size * 0.9;
  lines.forEach((l, i) => sctx.fillText(l, G / 2, G / 2 + (i - (lines.length - 1) / 2) * lh + size * 0.04));
  const d = sctx.getImageData(0, 0, G, G).data;
  for (let r = 0; r < G; r++) for (let i = 0; i < G; i++) out[(G - 1 - r) * G + i] = d[(r * G + i) * 4 + 3] / 255;
  return out;
}

function boxBlur(src, r) {
  const tmp = new Float32Array(G * G), out = new Float32Array(G * G), n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    const a = pass ? tmp : src, b = pass ? out : tmp, stride = pass ? G : 1;
    for (let line = 0; line < G; line++) {
      const base = pass ? line : line * G;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += a[base + Math.max(0, Math.min(G - 1, i)) * stride];
      for (let i = 0; i < G; i++) {
        b[base + i * stride] = acc / n;
        acc += a[base + Math.min(G - 1, i + r + 1) * stride] - a[base + Math.max(0, i - r) * stride];
      }
    }
  }
  return out;
}

export function createPlate(canvas, stations, count) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  const plateProg = program(gl, PLATE_VS, PLATE_FS);
  const sandProg = program(gl, SAND_VS, SAND_FS);
  const bodyProg = program(gl, BODY_VS, BODY_FS);
  // Rounded, layered metal housing. All normals are explicit: bevels catch the softbox.
  const bodyVerts=[];
  let layer=1;
  function triangle(a,b,c,mat) {
    const u=b.map((v,i)=>v-a[i]), v=c.map((v,i)=>v-a[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const len=Math.hypot(...n)||1;
    for(const p of [a,b,c]) bodyVerts.push(...p,...n.map(x=>x/len),mat,layer);
  }
  function roundedRing(size,y,radius=0.11) {
    const ring=[];
    for(let corner=0;corner<4;corner++) {
      const angle=corner*Math.PI/2;
      const cx=Math.cos(angle+Math.PI/4)>0?size-radius:-size+radius;
      const cz=Math.sin(angle+Math.PI/4)>0?size-radius:-size+radius;
      for(let j=0;j<=10;j++) {
        const theta=angle+j*Math.PI/20;
        ring.push([cx+Math.cos(theta)*radius,y,cz+Math.sin(theta)*radius]);
      }
    }
    return ring;
  }
  function join(a,b,mat) {
    for(let i=0;i<a.length;i++) {
      const j=(i+1)%a.length;
      triangle(a[i],a[j],b[i],mat); triangle(a[j],b[j],b[i],mat);
    }
  }
  function housing(levels,mat) {
    for(let i=0;i<levels.length-1;i++) join(roundedRing(...levels[i]),roundedRing(...levels[i+1]),mat);
  }
  housing([[1.0,-0.008,0.06],[1.075,-0.008],[1.105,-0.035],[1.105,-0.09],[1.08,-0.115]],1);
  layer=0.7;
  housing([[1.08,-0.115],[1.08,-0.137]],3);
  layer=0.45;
  housing([[1.08,-0.137],[1.095,-0.145],[1.095,-0.17]],2);
  layer=0;
  housing([[1.095,-0.17],[1.08,-0.185],[1.08,-0.29],[1.05,-0.32]],0);
  housing([[1.05,-0.32],[1.045,-0.34]],3);
  function cylinder(x,z,radius,top,bottom,mat,segments=32) {
    const a=[], b=[];
    for(let i=0;i<segments;i++) {const t=i/segments*Math.PI*2; a.push([x+Math.cos(t)*radius,top,z+Math.sin(t)*radius]); b.push([x+Math.cos(t)*radius,bottom,z+Math.sin(t)*radius]);}
    join(a,b,mat);
    for(let i=0;i<segments;i++) triangle([x,top,z],a[(i+1)%segments],a[i],mat);
  }
  for(const x of [-0.88,0.88]) for(const z of [-0.88,0.88]) {
    cylinder(x,z,0.11,-0.30,-0.43,3);
    cylinder(x,z,0.085,-0.34,-0.37,2);
  }
  // Exposed actuator: a suspended copper voice-coil inside the chassis.
  const floor=roundedRing(1.04,-0.285);
  for(let i=0;i<floor.length;i++) triangle([0,-0.285,0],floor[(i+1)%floor.length],floor[i],0);
  // Tube geometry follows a continuous helix or cable, rather than stacked discs.
  function tube(points,radius,mat,sides=8) {
    let previous=null;
    for(let i=0;i<points.length;i++) {
      const p=points[i], a=points[Math.max(0,i-1)], b=points[Math.min(points.length-1,i+1)];
      const t=b.map((v,j)=>v-a[j]); const len=Math.hypot(...t); for(let j=0;j<3;j++) t[j]/=len||1;
      const ref=Math.abs(t[1])<0.9?[0,1,0]:[1,0,0];
      const n=[t[1]*ref[2]-t[2]*ref[1],t[2]*ref[0]-t[0]*ref[2],t[0]*ref[1]-t[1]*ref[0]];
      const nl=Math.hypot(...n); for(let j=0;j<3;j++) n[j]/=nl;
      const v=[t[1]*n[2]-t[2]*n[1],t[2]*n[0]-t[0]*n[2],t[0]*n[1]-t[1]*n[0]];
      const ring=Array.from({length:sides},(_,k)=>p.map((q,j)=>q+radius*(n[j]*Math.cos(k/sides*Math.PI*2)+v[j]*Math.sin(k/sides*Math.PI*2))));
      if(previous) join(previous,ring,mat); previous=ring;
    }
  }
  function helix(x,z,r,top,height,turns,wire,mat) {
    const steps=turns*48;
    tube(Array.from({length:steps+1},(_,i)=>{const t=i/steps;return [x+r*Math.cos(t*turns*Math.PI*2),top-height*t,z+r*Math.sin(t*turns*Math.PI*2)];}),wire,mat);
  }
  function box(x,y,z,w,h,d,mat) {
    const a=[[x-w,y,z-d],[x+w,y,z-d],[x+w,y,z+d],[x-w,y,z+d]];
    join(a,a.map(p=>[p[0],y-h,p[2]]),mat);
    triangle(a[0],a[2],a[1],mat);triangle(a[0],a[3],a[2],mat);
  }
  // A populated controller board sits in the lower tray.
  layer=0;
  box(0,-0.265,0,0.92,0.014,0.91,5);
  for(const x of [-0.58,0.58]) {
    box(x,-0.22,0.1,0.12,0.042,0.16,6);
    for(let j=0;j<8;j++) for(const side of [-1,1]) box(x+side*0.135,-0.239,-0.035+j*0.038,0.028,0.008,0.006,1);
    for(let j=0;j<5;j++) {
      box(x,-0.245,0.40+j*0.065,0.035,0.018,0.016,6);
      box(x-0.035,-0.244,0.40+j*0.065,0.008,0.015,0.016,1);
      box(x+0.035,-0.244,0.40+j*0.065,0.008,0.015,0.016,1);
    }
    for(let j=0;j<4;j++) cylinder(x+j*0.09-0.13,-0.57,0.028,-0.17,-0.26,1,16);
    for(let j=0;j<6;j++) {
      const z=-0.1+j*0.075;
      tube([[x+0.17,-0.249,z],[x+0.24,-0.249,z],[x+0.28,-0.249,z+0.04],[x+0.28,-0.249,0.72]],0.0025,2,4);
    }
  }
  for(let j=0;j<3;j++) tube(Array.from({length:40},(_,i)=>{const t=i/39;return [-0.45+t*0.9,-0.21+Math.sin(t*Math.PI)*0.11,-0.64+j*0.035+Math.sin(t*Math.PI)*0.12];}),0.012,j===0?2:3);
  layer=0.42;
  cylinder(0,0,0.44,-0.16,-0.27,3,64);
  cylinder(0,0,0.35,-0.08,-0.17,1,64);
  helix(0,0,0.37,-0.08,0.095,12,0.0045,2);
  cylinder(0,0,0.21,-0.055,-0.085,0,64);
  cylinder(0,0,0.07,-0.012,-0.06,1);
  for(const x of [-0.76,0.76]) for(const z of [-0.76,0.76]) {
    cylinder(x,z,0.052,-0.06,-0.25,1);
    helix(x,z,0.071,-0.065,0.19,7,0.009,1);
  }
  layer=1;
  // Four machined fasteners, with a recessed cross-head.
  for(const x of [-1.025,1.025]) for(const z of [-1.025,1.025]) {
    cylinder(x,z,0.031,0.002,-0.012,3);
    cylinder(x,z,0.023,0.006,0.002,1);
    for(const [dx,dz] of [[0.018,0.003],[0.003,0.018]]) {
      const a=[x-dx,0.0065,z-dz],b=[x+dx,0.0065,z-dz],c=[x-dx,0.0065,z+dz],d=[x+dx,0.0065,z+dz];
      triangle(a,c,b,3);triangle(b,c,d,3);
    }
  }
  layer=0;
  // A warm status light inset into the front edge.
  triangle([0.80,-0.20,1.081],[0.94,-0.20,1.081],[0.80,-0.22,1.081],4);
  triangle([0.94,-0.20,1.081],[0.94,-0.22,1.081],[0.80,-0.22,1.081],4);
  const bodyCount=bodyVerts.length/8;
  triangle([-1.9,-0.44,-1.9],[-1.9,-0.44,1.9],[1.9,-0.44,-1.9],0);
  triangle([-1.9,-0.44,1.9],[1.9,-0.44,1.9],[1.9,-0.44,-1.9],0);
  const bodyVAO=gl.createVertexArray();
  gl.bindVertexArray(bodyVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(bodyVerts),gl.STATIC_DRAW);
  for(const [name,size,offset] of [['aPos',3,0],['aNormal',3,12],['aMaterial',1,24],['aLayer',1,28]]) {
    const loc=gl.getAttribLocation(bodyProg.p,name);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,size,gl.FLOAT,false,32,offset);
  }
  gl.bindVertexArray(null);

  // plate mesh
  const verts = new Float32Array(MESH * MESH * 2);
  for (let j = 0; j < MESH; j++) for (let i = 0; i < MESH; i++) {
    verts[(j * MESH + i) * 2] = (i / (MESH - 1)) * 2 - 1;
    verts[(j * MESH + i) * 2 + 1] = (j / (MESH - 1)) * 2 - 1;
  }
  const idx = new Uint16Array((MESH - 1) * (MESH - 1) * 6);
  let q = 0;
  for (let j = 0; j < MESH - 1; j++) for (let i = 0; i < MESH - 1; i++) {
    const a = j * MESH + i, b = a + 1, c = a + MESH, d = c + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c;
  }
  const plateVAO = gl.createVertexArray();
  gl.bindVertexArray(plateVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const pLoc = gl.getAttribLocation(plateProg.p, 'aP');
  gl.enableVertexAttribArray(pLoc);
  gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  // sand
  const pos = new Float32Array(count * 2);
  const seed = new Float32Array(count);
  const rest = new Float32Array(count); // each grain comes to rest at its own amplitude, so lines have body
  for (let i = 0; i < count; i++) {
    pos[i * 2] = Math.random() * 2 - 1; pos[i * 2 + 1] = Math.random() * 2 - 1; seed[i] = Math.random();
    rest[i] = 0.02 + 0.2 * Math.pow(Math.random(), 1.5);
  }
  const sandVAO = gl.createVertexArray();
  gl.bindVertexArray(sandVAO);
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  const sP = gl.getAttribLocation(sandProg.p, 'aP');
  gl.enableVertexAttribArray(sP);
  gl.vertexAttribPointer(sP, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, seed, gl.STATIC_DRAW);
  const sS = gl.getAttribLocation(sandProg.p, 'aSeed');
  gl.enableVertexAttribArray(sS);
  gl.vertexAttribPointer(sS, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // field texture: R = signed displacement, G = agitation amplitude
  const tex = gl.createTexture();
  const texData = new Uint8Array(G * G * 2);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, G, G, 0, gl.RG, gl.UNSIGNED_BYTE, texData);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);

  // Chladni modes, one grid per station
  const modes = stations.map(({ mode: [n, m, s] }) => {
    const f = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const X = ((i + 0.5) / G) * Math.PI, Y = ((j + 0.5) / G) * Math.PI;
      f[j * G + i] = (Math.cos(n * X) * Math.cos(m * Y) + s * Math.cos(m * X) * Math.cos(n * Y)) / 2;
    }
    return f;
  });
  // agitation pattern per mode: |u| rescaled by its slope, i.e. roughly "distance to the nearest
  // nodal line", so sand ribbons keep a readable width even for busy high-frequency modes
  const pats = modes.map((U, k) => {
    const [n, m] = stations[k].mode;
    const w = Math.max(10, Math.min(45, (G / (n + m)) * 0.9));
    const P = new Float32Array(G * G), last = G - 1;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const c = j * G + i;
      const gx = (U[i < last ? c + 1 : c] - U[i > 0 ? c - 1 : c]) * 0.5;
      const gy = (U[j < last ? c + G : c] - U[j > 0 ? c - G : c]) * 0.5;
      P[c] = Math.min(1, Math.abs(U[c]) / (Math.hypot(gx, gy) * w + 0.02));
    }
    return P;
  });
  const masks = stations.map(() => null);
  const halos = stations.map(() => null);
  const softs = stations.map(() => null);
  const words = stations.map((s) => s.word);

  const amp = new Float32Array(G * G);
  let fieldKey = '';
  let maskVersion = 0;

  function ensureMask(k) {
    if (!masks[k]) {
      masks[k] = rasterWord(words[k]);
      // funnel: a wide falloff around the word; agitation rises with distance from the glyphs,
      // so every grain in the neighbourhood is carried into the letters
      const wide = boxBlur(boxBlur(masks[k], 7), 7);
      let peak = 1e-6;
      for (let i = 0; i < wide.length; i++) if (wide[i] > peak) peak = wide[i];
      for (let i = 0; i < wide.length; i++) wide[i] /= peak;
      halos[k] = wide;
      // blur radius follows stroke weight, so thin letters still have a still core for grains to rest in
      softs[k] = boxBlur(masks[k], Math.max(1, Math.min(3, Math.round(masks[k].size * 0.045))));
    }
  }
  function compose(k, lock) {
    const key = `${k}|${Math.round(lock * 250)}|${maskVersion}`;
    if (key === fieldKey) return;
    fieldKey = key;
    ensureMask(k);
    const U = modes[k], P = pats[k], M = masks[k], H = halos[k], S = softs[k], chaos = (1 - lock) * 0.75;
    for (let i = 0; i < G * G; i++) {
      const u = U[i], m = M[i];
      let pat = P[i];
      const h = H[i];
      const ridge = Math.min(1, h / 0.12) * (0.3 + 0.7 * (1 - h));
      if (ridge > pat) pat = ridge;
      pat = pat * (1 - m) + m * 0.5 * Math.pow(1 - S[i], 1.3);
      const a = lock * pat + chaos;
      amp[i] = a;
      texData[i * 2] = 127.5 + 127.5 * u * (1 - Math.min(1, h * 1.6)) * lock; // the plate lies flat under the word
      texData[i * 2 + 1] = a * 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.UNSIGNED_BYTE, texData);
  }

  function simulate(dt) {
    const k = Math.sqrt(Math.min(dt, 0.05) * 60);
    const s = 0.026 * k, drift = 0.011 * k, last = G - 1;
    for (let p = 0; p < count; p++) {
      let x = pos[p * 2], y = pos[p * 2 + 1];
      let i = ((x * 0.5 + 0.5) * G) | 0, j = ((y * 0.5 + 0.5) * G) | 0;
      if (i < 0) i = 0; else if (i > last) i = last;
      if (j < 0) j = 0; else if (j > last) j = last;
      const c = j * G + i, a = amp[c];
      if (a < rest[p]) continue;
      const gx = amp[i < last ? c + 1 : c] - amp[i > 0 ? c - 1 : c];
      const gy = amp[j < last ? c + G : c] - amp[j > 0 ? c - G : c];
      const inv = (drift * a) / (Math.sqrt(gx * gx + gy * gy) + 0.012);
      x += (Math.random() - 0.5) * 2 * s * a - inv * gx;
      y += (Math.random() - 0.5) * 2 * s * a - inv * gy;
      if (x < -1) x = -2 - x; else if (x > 1) x = 2 - x;
      if (y < -1) y = -2 - y; else if (y > 1) y = 2 - y;
      // Keep grains inside the rounded rim.
      const cx=Math.max(Math.abs(x)-0.93,0), cy=Math.max(Math.abs(y)-0.93,0);
      const cr=Math.hypot(cx,cy);
      if(cr>0.06){x=Math.sign(x)*(Math.min(Math.abs(x),0.93)+cx*0.06/cr);y=Math.sign(y)*(Math.min(Math.abs(y),0.93)+cy*0.06/cr);}
      pos[p * 2] = x; pos[p * 2 + 1] = y;
    }
  }

  let W = 1, H = 1, dpr = 1, VP = new Float32Array(16), shift = [0, 0], explode = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();

  function frame(dt, st) {
    compose(st.k, st.lock);
    simulate(dt);

    const { yaw, pitch, dist } = st.cam;
    const cp = Math.cos(pitch);
    const eye = [Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist, Math.cos(yaw) * cp * dist];
    VP = mul(perspective(FOV, W / H, 0.1, 30), lookAt(eye, [0, 0, 0], [0, 1, 0]));
    shift = st.shift;
    explode = st.explode || 0;

    const { bg, ink, acc } = st.colors;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);

    // busier modes get a shallower swell, otherwise the plate reads as crumpled
    const [mn, mm] = stations[st.k].mode;
    const breath = (st.calm ? 0.003 : 0.014) * Math.sqrt(3 / (mn + mm));
    const common = (prog) => {
      gl.useProgram(prog.p);
      gl.uniform1i(prog.u.uField, 0);
      gl.uniformMatrix4fv(prog.u.uVP, false, VP);
      gl.uniform2f(prog.u.uShift, shift[0], shift[1]);
      gl.uniform1f(prog.u.uTime, st.time);
      gl.uniform1f(prog.u.uLock, st.lock);
      gl.uniform1f(prog.u.uBreath, breath);
      gl.uniform1f(prog.u.uExplode, explode);
      gl.uniform3fv(prog.u.uInk, ink);
    };

    gl.useProgram(bodyProg.p);
    gl.uniformMatrix4fv(bodyProg.u.uVP,false,VP);
    gl.uniform2f(bodyProg.u.uShift,shift[0],shift[1]);
    gl.uniform3fv(bodyProg.u.uBg,bg);
    gl.uniform3fv(bodyProg.u.uInk,ink);
    gl.uniform3fv(bodyProg.u.uEye,eye);
    gl.uniform3fv(bodyProg.u.uAcc,acc);
    gl.uniform1f(bodyProg.u.uTime,st.time);
    gl.uniform1f(bodyProg.u.uExplode,explode);
    gl.uniform1f(bodyProg.u.uLock,st.lock);
    gl.bindVertexArray(bodyVAO);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(bodyProg.u.uShadow,1);
    gl.drawArrays(gl.TRIANGLES,bodyCount,6);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.uniform1f(bodyProg.u.uShadow,0);
    gl.drawArrays(gl.TRIANGLES,0,bodyCount);

    common(plateProg);
    gl.uniform3fv(plateProg.u.uEye,eye);
    gl.uniform3fv(plateProg.u.uAcc,acc);
    gl.uniform3fv(plateProg.u.uBg, bg);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.bindVertexArray(plateVAO);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // grains ride the surface; skipping the depth test keeps them from sinking into mesh facets
    gl.enable(gl.DEPTH_TEST);
    common(sandProg);
    gl.uniform3fv(sandProg.u.uAcc, acc);
    gl.uniform1f(sandProg.u.uHop, (st.calm ? 0.4 : 1) * (0.05 + 0.13 * (1 - st.lock)));
    gl.uniform1f(sandProg.u.uSize, (0.008 * canvas.height) / (2 * Math.tan(FOV / 2)));
    gl.bindVertexArray(sandVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
  }

  // plate coords → CSS pixels
  function project(px, py) {
    const x = VP[0] * px + VP[4]*explode*0.72 - VP[8] * py + VP[12];
    const y = VP[1] * px + VP[5]*explode*0.72 - VP[9] * py + VP[13];
    const w = VP[3] * px + VP[7]*explode*0.72 - VP[11] * py + VP[15];
    return [((x / w + shift[0]) * 0.5 + 0.5) * W, (1 - ((y / w + shift[1]) * 0.5 + 0.5)) * H];
  }

  function setWord(k, text) {
    words[k] = text; masks[k] = null; maskVersion++;
  }
  function refreshMasks() { masks.fill(null); maskVersion++; }

  return { frame, resize, project, setWord, refreshMasks, count };
}
