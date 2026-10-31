// Tiny WebGL2 renderer for GHOST//PACKET: lit meshes, sprites, particles, bloom. No dependencies.

// ───────── math (column-major mat4) ─────────
export const M4 = {
  ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(a, b, o = new Float32Array(16)) {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    } return o;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m;
  },
  lookAt(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx; m[4] = xy; m[8] = xz; m[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
    m[1] = yx; m[5] = yy; m[9] = yz; m[13] = -(yx * e[0] + yy * e[1] + yz * e[2]);
    m[2] = zx; m[6] = zy; m[10] = zz; m[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
    m[15] = 1; return m;
  },
  // translate * Ry * Rx * Rz * scale
  compose(o, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    const cx = Math.cos(rx), sxr = Math.sin(rx), cy = Math.cos(ry), syr = Math.sin(ry), cz = Math.cos(rz), szr = Math.sin(rz);
    // R = Ry*Rx*Rz
    const r00 = cy * cz + syr * sxr * szr, r01 = -cy * szr + syr * sxr * cz, r02 = syr * cx;
    const r10 = cx * szr, r11 = cx * cz, r12 = -sxr;
    const r20 = -syr * cz + cy * sxr * szr, r21 = syr * szr + cy * sxr * cz, r22 = cy * cx;
    o[0] = r00 * sx; o[1] = r10 * sx; o[2] = r20 * sx; o[3] = 0;
    o[4] = r01 * sy; o[5] = r11 * sy; o[6] = r21 * sy; o[7] = 0;
    o[8] = r02 * sz; o[9] = r12 * sz; o[10] = r22 * sz; o[11] = 0;
    o[12] = px; o[13] = py; o[14] = pz; o[15] = 1; return o;
  },
  apply(m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; },
  applyN(m, x, y, z) { const v = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z]; const l = Math.hypot(...v) || 1; return v.map(a => a / l); },
};

// ───────── geometry (non-indexed triangle soup) ─────────
export class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.e = []; this.uv = []; }
  tri(a, b, c, na, nb, nc, ua = [0, 0], ub = [0, 0], uc = [0, 0]) {
    this.p.push(...a, ...b, ...c); this.n.push(...na, ...nb, ...nc); this.uv.push(...ua, ...ub, ...uc);
    for (let i = 0; i < 3; i++) { this.c.push(1, 1, 1); this.e.push(0); }
  }
  quad(a, b, c, d, n, uvs) { // a-b-c-d counter-clockwise seen from normal side
    const u = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.tri(a, b, c, n, n, n, u[0], u[1], u[2]); this.tri(a, c, d, n, n, n, u[0], u[2], u[3]);
  }
  // bake another Geo with a transform, colour and emissive strength
  add(g, m, col = [1, 1, 1], emi = 0) {
    for (let i = 0; i < g.p.length; i += 3) {
      const p = m ? M4.apply(m, g.p[i], g.p[i + 1], g.p[i + 2]) : [g.p[i], g.p[i + 1], g.p[i + 2]];
      const n = m ? M4.applyN(m, g.n[i], g.n[i + 1], g.n[i + 2]) : [g.n[i], g.n[i + 1], g.n[i + 2]];
      this.p.push(...p); this.n.push(...n);
      this.c.push(col[0] * g.c[i], col[1] * g.c[i + 1], col[2] * g.c[i + 2]); this.e.push(Math.max(emi, g.e[i / 3]));
    }
    for (const u of g.uv) this.uv.push(u);
    return this;
  }
  static box(w, h, d) {
    const g = new Geo(), x = w / 2, y = h / 2, z = d / 2;
    g.quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1]);
    g.quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1]);
    g.quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], [1, 0, 0]);
    g.quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], [-1, 0, 0]);
    g.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], [0, 1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    g.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], [0, -1, 0]);
    return g;
  }
  // profile: [[r,y],...] bottom→top; surface of revolution with smooth normals
  static lathe(pr, seg = 24, cap = true) {
    const g = new Geo(), N = pr.length;
    const nrm = pr.map((p, i) => {
      const a = pr[Math.max(0, i - 1)], b = pr[Math.min(N - 1, i + 1)];
      const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; return [dy / l, -dr / l];
    });
    for (let i = 0; i < N - 1; i++) for (let s = 0; s < seg; s++) {
      const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
      const P = (j, a) => [pr[j][0] * Math.cos(a), pr[j][1], pr[j][0] * Math.sin(a)];
      const Nn = (j, a) => [nrm[j][0] * Math.cos(a), nrm[j][1], nrm[j][0] * Math.sin(a)];
      const u0 = s / seg, u1 = (s + 1) / seg, v0 = i / (N - 1), v1 = (i + 1) / (N - 1);
      g.tri(P(i, a0), P(i + 1, a1), P(i, a1), Nn(i, a0), Nn(i + 1, a1), Nn(i, a1), [u0, v0], [u1, v1], [u1, v0]);
      g.tri(P(i, a0), P(i + 1, a0), P(i + 1, a1), Nn(i, a0), Nn(i + 1, a0), Nn(i + 1, a1), [u0, v0], [u0, v1], [u1, v1]);
    }
    if (cap) {
      const top = pr[N - 1], bot = pr[0];
      for (let s = 0; s < seg; s++) {
        const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
        if (top[0] > 0) g.tri([0, top[1], 0], [top[0] * Math.cos(a1), top[1], top[0] * Math.sin(a1)], [top[0] * Math.cos(a0), top[1], top[0] * Math.sin(a0)], [0, 1, 0], [0, 1, 0], [0, 1, 0]);
        if (bot[0] > 0) g.tri([0, bot[1], 0], [bot[0] * Math.cos(a0), bot[1], bot[0] * Math.sin(a0)], [bot[0] * Math.cos(a1), bot[1], bot[0] * Math.sin(a1)], [0, -1, 0], [0, -1, 0], [0, -1, 0]);
      }
    }
    return g;
  }
  static cyl(r, h, seg = 24) { return Geo.lathe([[r, -h / 2], [r, h / 2]], seg).flatSides(); }
  flatSides() { return this; }
  static sphere(r, seg = 20, rings = 12) {
    const pr = []; for (let i = 0; i <= rings; i++) { const a = -Math.PI / 2 + i / rings * Math.PI; pr.push([Math.cos(a) * r + 1e-5, Math.sin(a) * r]); }
    return Geo.lathe(pr, seg, false);
  }
  static octa(r) {
    const g = new Geo(), V = [[r, 0, 0], [-r, 0, 0], [0, r * 1.25, 0], [0, -r * 1.25, 0], [0, 0, r], [0, 0, -r]];
    const F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    for (const [a, b, c] of F) {
      const A = V[a], B = V[b], C = V[c];
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n); n = n.map(x => x / l);
      // ensure outward
      const cen = [(A[0] + B[0] + C[0]), (A[1] + B[1] + C[1]), (A[2] + B[2] + C[2])];
      if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) { n = n.map(x => -x); g.tri(A, C, B, n, n, n); } else g.tri(A, B, C, n, n, n);
    }
    return g;
  }
  static torus(R, r, seg = 48, tube = 10) {
    const g = new Geo();
    const P = (i, j) => { const a = i / seg * Math.PI * 2, b = j / tube * Math.PI * 2; return [(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)]; };
    const Nn = (i, j) => { const a = i / seg * Math.PI * 2, b = j / tube * Math.PI * 2; return [Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)]; };
    for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
      g.tri(P(i, j), P(i + 1, j + 1), P(i + 1, j), Nn(i, j), Nn(i + 1, j + 1), Nn(i + 1, j));
      g.tri(P(i, j), P(i, j + 1), P(i + 1, j + 1), Nn(i, j), Nn(i, j + 1), Nn(i + 1, j + 1));
    }
    return g;
  }
  static disc(r, seg = 96) {
    const g = new Geo();
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
      const P = (a) => [r * Math.cos(a), 0, r * Math.sin(a)], U = (a) => [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)];
      g.tri([0, 0, 0], P(a1), P(a0), [0, 1, 0], [0, 1, 0], [0, 1, 0], [0.5, 0.5], U(a1), U(a0));
    }
    return g;
  }
  static plane(w, d) { const g = new Geo(), x = w / 2, z = d / 2; g.quad([-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z], [0, 1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]); return g; }
}

// ───────── shaders ─────────
const VS_MESH = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol; layout(location=3) in float aEmi; layout(location=4) in vec2 aUV;
uniform mat4 uVP, uModel; out vec3 vN; out vec3 vCol; out float vEmi; out vec2 vUV; out vec3 vW;
void main(){ vec4 w = uModel*vec4(aPos,1.); vW=w.xyz; vN=normalize(mat3(uModel)*aNor); vCol=aCol; vEmi=aEmi; vUV=aUV; gl_Position=uVP*w; }`;
const FS_MESH = `#version 300 es
precision highp float; in vec3 vN; in vec3 vCol; in float vEmi; in vec2 vUV; in vec3 vW;
uniform vec4 uTint; uniform vec3 uEmi; uniform sampler2D uTex; uniform float uUseTex, uGlow, uTime; uniform vec3 uEye, uLight, uFog; uniform float uFogD;
out vec4 o;
void main(){
  vec3 base = vCol*uTint.rgb; float a = uTint.a;
  if(uUseTex>.5){ vec4 t=texture(uTex,vUV); base*=t.rgb; a*=t.a; }
  vec3 emi = base*vEmi + uEmi;
  if(uUseTex>1.5){ vec4 t=texture(uTex,vUV); emi += t.rgb*t.a*(uUseTex-1.5)*2.; }
  if(uGlow>.5){ o=vec4(emi*a,1.); return; }
  vec3 n=normalize(vN), v=normalize(uEye-vW);
  float d=max(dot(n,normalize(uLight)),0.);
  float hemi=.5+.5*n.y;
  vec3 lit = base*(.22+.55*d+.28*hemi) + base*pow(1.-max(dot(n,v),0.),3.)*.55;
  vec3 col = lit + emi;
  float f = clamp(length(uEye-vW)/uFogD,0.,1.); col=mix(col,uFog,f*f*.85);
  o=vec4(col,a);
}`;
const VS_SPR = `#version 300 es
layout(location=0) in vec2 aC; uniform mat4 uVP, uModel; uniform vec3 uCen, uRight, uUp; uniform vec2 uSize; uniform float uBill, uRoll;
out vec2 vUV;
void main(){ vec2 c=aC; float cr=cos(uRoll), sr=sin(uRoll); vec2 r=vec2(c.x*cr-c.y*sr, c.x*sr+c.y*cr)*uSize;
  vec3 w = uBill>.5 ? uCen + uRight*r.x + uUp*r.y : (uModel*vec4(r,0.,1.)).xyz;
  vUV = c+.5; gl_Position=uVP*vec4(w,1.); }`;
const FS_SPR = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; uniform vec4 uCol; uniform float uMode, uParam, uGlow; out vec4 o;
void main(){ vec2 p=vUV-.5; float d=length(p)*2.; vec4 c;
  if(uMode<.5) c=texture(uTex,vec2(vUV.x,1.-vUV.y))*uCol;
  else if(uMode<1.5){ float a=smoothstep(uParam,0.,abs(d-.85))*step(d,1.); c=vec4(uCol.rgb,uCol.a*a); }
  else if(uMode<2.5){ float a=pow(max(1.-d,0.),2.); c=vec4(uCol.rgb,uCol.a*a); }
  else { float a=pow(max(1.-abs(p.x)*2.,0.),2.)*smoothstep(0.,.15,vUV.y)*(1.-vUV.y*.6); c=vec4(uCol.rgb,uCol.a*a); }
  if(uGlow>.5) c.rgb*=c.a;
  o=c; }`;
const VS_PT = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aCol; layout(location=2) in float aSize; layout(location=3) in float aShape;
uniform mat4 uVP; uniform float uScale; out vec4 vCol; flat out float vShape;
void main(){ gl_Position=uVP*vec4(aPos,1.); gl_PointSize=clamp(aSize*uScale/gl_Position.w,1.,128.); vCol=aCol; vShape=aShape; }`;
const FS_PT = `#version 300 es
precision highp float; in vec4 vCol; flat in float vShape; out vec4 o;
void main(){ vec2 p=gl_PointCoord-.5; float d=length(p)*2.; float a;
  if(vShape<.5) a=pow(max(1.-d,0.),1.6);
  else if(vShape<1.5){ a=step(d,1.)*(.55+.45*smoothstep(.55,.8,d)); }
  else { a=max(pow(max(1.-abs(p.x)*9.,0.),2.)*(1.-d),pow(max(1.-abs(p.y)*9.,0.),2.)*(1.-d))+pow(max(1.-d,0.),4.); }
  o=vec4(vCol.rgb*vCol.a*a, 1.); }`;
const VS_FS = `#version 300 es
layout(location=0) in vec2 aC; out vec2 vUV; void main(){ vUV=aC+.5; gl_Position=vec4(aC*2.,0.,1.); }`;
const FS_BLUR = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){ vec4 s=texture(uTex,vUV)*.227;
  s+=(texture(uTex,vUV+uDir*1.385)+texture(uTex,vUV-uDir*1.385))*.316;
  s+=(texture(uTex,vUV+uDir*3.231)+texture(uTex,vUV-uDir*3.231))*.07; o=s; }`;
const FS_COMP = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uA, uB; uniform float uK; uniform vec4 uFlash; out vec4 o;
void main(){ vec3 g=texture(uA,vUV).rgb*uK + texture(uB,vUV).rgb*uK*.9; o=vec4(g+uFlash.rgb*uFlash.a,1.); }`;
const FS_VIG = `#version 300 es
precision highp float; in vec2 vUV; uniform float uV; out vec4 o;
void main(){ float d=length(vUV-.5)*1.35; float v=1.-uV*smoothstep(.45,1.1,d); o=vec4(v,v,v,1.); }`;

function prog(gl, vs, fs) {
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
  return { p, u };
}

// ───────── particles ─────────
export class Particles {
  constructor(cap = 4000) {
    this.cap = cap; this.n = 0;
    this.d = { x: new Float32Array(cap * 3), v: new Float32Array(cap * 3), c: new Float32Array(cap * 4), s: new Float32Array(cap), sh: new Float32Array(cap), life: new Float32Array(cap), max: new Float32Array(cap), g: new Float32Array(cap), drag: new Float32Array(cap), fade: new Float32Array(cap) };
    this.buf = new Float32Array(cap * 9);
  }
  emit(o) {
    if (this.n >= this.cap) return; const i = this.n++, d = this.d;
    d.x.set(o.p, i * 3); d.v.set(o.v || [0, 0, 0], i * 3); d.c.set(o.c || [1, 1, 1, 1], i * 4);
    d.s[i] = o.s || 0.3; d.sh[i] = o.shape || 0; d.life[i] = 0; d.max[i] = o.life || 1; d.g[i] = o.g == null ? -6 : o.g; d.drag[i] = o.drag || 0.6; d.fade[i] = o.fade == null ? 1 : o.fade;
  }
  update(dt) {
    const d = this.d;
    for (let i = 0; i < this.n; i++) {
      d.life[i] += dt;
      if (d.life[i] >= d.max[i]) { this.kill(i); i--; continue; }
      const k = Math.exp(-d.drag[i] * dt);
      d.v[i * 3] *= k; d.v[i * 3 + 1] = d.v[i * 3 + 1] * k + d.g[i] * dt; d.v[i * 3 + 2] *= k;
      d.x[i * 3] += d.v[i * 3] * dt; d.x[i * 3 + 1] += d.v[i * 3 + 1] * dt; d.x[i * 3 + 2] += d.v[i * 3 + 2] * dt;
      if (d.x[i * 3 + 1] < 0.03 && d.g[i] < 0) { d.x[i * 3 + 1] = 0.03; d.v[i * 3 + 1] *= -0.35; }
    }
  }
  kill(i) {
    const d = this.d, j = --this.n; if (i === j) return;
    for (const [k, w] of [['x', 3], ['v', 3], ['c', 4]]) d[k].copyWithin(i * w, j * w, j * w + w);
    for (const k of ['s', 'sh', 'life', 'max', 'g', 'drag', 'fade']) d[k][i] = d[k][j];
  }
  pack() {
    const d = this.d, b = this.buf;
    for (let i = 0; i < this.n; i++) {
      const t = d.life[i] / d.max[i], o = i * 9, a = d.fade[i] ? (t < 0.1 ? t / 0.1 : 1 - Math.pow((t - 0.1) / 0.9, 2)) : 1;
      b[o] = d.x[i * 3]; b[o + 1] = d.x[i * 3 + 1]; b[o + 2] = d.x[i * 3 + 2];
      b[o + 3] = d.c[i * 4]; b[o + 4] = d.c[i * 4 + 1]; b[o + 5] = d.c[i * 4 + 2]; b[o + 6] = d.c[i * 4 + 3] * a;
      b[o + 7] = d.s[i]; b[o + 8] = d.sh[i];
    }
    return b.subarray(0, this.n * 9);
  }
}

// ───────── renderer ─────────
export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 が使えません');
    this.stats = { textures: 0, meshes: 0 };
    this.gl = gl; this.canvas = canvas;
    this.pm = prog(gl, VS_MESH, FS_MESH); this.ps = prog(gl, VS_SPR, FS_SPR); this.pp = prog(gl, VS_PT, FS_PT);
    this.pb = prog(gl, VS_FS, FS_BLUR); this.pc = prog(gl, VS_FS, FS_COMP); this.pv = prog(gl, VS_FS, FS_VIG);
    this.quad = gl.createVertexArray(); gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, .5, .5, -.5, -.5, .5, .5, -.5, .5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.ptVao = gl.createVertexArray(); gl.bindVertexArray(this.ptVao);
    this.ptBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf);
    const S = 36; gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, S, 28);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S, 32);
    gl.bindVertexArray(null);
    this.white = this.texture(Object.assign(document.createElement('canvas'), { width: 2, height: 2 }));
    this.fb = {}; this.w = 0; this.h = 0; this.dpr = 1; this.bloom = 0.55; this.vignette = 0.7; this.flash = [0, 0, 0, 0];
  }
  mesh(g) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const put = (loc, arr, n) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); };
    const bufs = [];
    const put2 = (loc, arr, n) => { put(loc, arr, n); bufs.push(gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)); };
    put2(0, g.p, 3); put2(1, g.n, 3); put2(2, g.c, 3); put2(3, g.e, 1); put2(4, g.uv, 2);
    gl.bindVertexArray(null); this.stats.meshes++; return { vao, count: g.p.length / 3, bufs };
  }
  texture(src, o = {}) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wr = o.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic'); if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.stats.textures++; return t;
  }
  deleteMesh(m) { if (!m || m.dead) return; const gl = this.gl; m.dead = true; gl.deleteVertexArray(m.vao); (m.bufs || []).forEach(b => gl.deleteBuffer(b)); this.stats.meshes--; }
  deleteTexture(t) { if (!t || t === this.white || t._dead) return; t._dead = true; this.gl.deleteTexture(t); this.stats.textures--; }
  updateTexture(t, src) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); gl.generateMipmap(gl.TEXTURE_2D); }
  _rt(w, h, depth) {
    const gl = this.gl, tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { tex, fb, rb, w, h };
  }
  resize(maxDpr = 1.75) {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (w === this.w && h === this.h) return;
    this.w = c.width = w; this.h = c.height = h; this.dpr = dpr;
    for (const k in this.fb) { const f = this.fb[k]; this.gl.deleteFramebuffer(f.fb); this.gl.deleteTexture(f.tex); if (f.rb) this.gl.deleteRenderbuffer(f.rb); }
    const gw = Math.max(1, w >> 1), gh = Math.max(1, h >> 1);
    this.fb = { glow: this._rt(gw, gh, true), a: this._rt(gw >> 1, gh >> 1), b: this._rt(gw >> 1, gh >> 1), c: this._rt(gw >> 2, gh >> 2), d: this._rt(gw >> 2, gh >> 2) };
  }
  render(scene, cam, time) {
    const gl = this.gl; this.resize(cam.maxDpr);
    const asp = this.w / this.h;
    const P = M4.persp(cam.fov, asp, 0.1, 200), V = M4.lookAt(cam.eye, cam.target, [0, 1, 0]), VP = M4.mul(P, V);
    const right = [V[0], V[4], V[8]], up = [V[1], V[5], V[9]];
    const ctx = { VP, right, up, eye: cam.eye, time, scene };
    // 1) glow pass
    const G = this.fb.glow; gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb); gl.viewport(0, 0, G.w, G.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._meshes(scene, ctx, true); this._sprites(scene, ctx, true); this._points(scene, ctx, G.h);
    // 2) blur (two scales)
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.useProgram(this.pb.p); gl.bindVertexArray(this.quad);
    const blur = (src, dst, dx, dy) => { gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(this.pb.u.uTex, 0); gl.uniform2f(this.pb.u.uDir, dx / src.w, dy / src.h); gl.drawArrays(gl.TRIANGLES, 0, 6); };
    const F = this.fb;
    blur(G, F.a, 1, 0); blur(F.a, F.b, 0, 1); blur(F.b, F.a, 1.6, 0); blur(F.a, F.b, 0, 1.6);
    blur(F.b, F.c, 1, 0); blur(F.c, F.d, 0, 1); blur(F.d, F.c, 2, 0); blur(F.c, F.d, 0, 2);
    // 3) main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    const fc = scene.fog; gl.clearColor(fc[0], fc[1], fc[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._meshes(scene, ctx, false); this._sprites(scene, ctx, false); this._points(scene, ctx, this.h);
    // 4) composite bloom + flash, then vignette
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(this.pc.p); gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, F.b.tex); gl.uniform1i(this.pc.u.uA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, F.d.tex); gl.uniform1i(this.pc.u.uB, 1);
    gl.uniform1f(this.pc.u.uK, this.bloom); gl.uniform4fv(this.pc.u.uFlash, this.flash); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR); gl.useProgram(this.pv.p); gl.uniform1f(this.pv.u.uV, this.vignette); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0); gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }
  _meshes(scene, c, glow) {
    const gl = this.gl, { p, u } = this.pm; gl.useProgram(p); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.uniformMatrix4fv(u.uVP, false, c.VP); gl.uniform3fv(u.uEye, c.eye); gl.uniform3fv(u.uLight, scene.light); gl.uniform3fv(u.uFog, scene.fog); gl.uniform1f(u.uFogD, scene.fogD);
    gl.uniform1f(u.uGlow, glow ? 1 : 0); gl.uniform1i(u.uTex, 0); gl.activeTexture(gl.TEXTURE0);
    const draw = (o) => {
      if (!o.visible) return;
      gl.uniformMatrix4fv(u.uModel, false, o.m); gl.uniform4fv(u.uTint, o.tint); gl.uniform3fv(u.uEmi, o.emi);
      gl.bindTexture(gl.TEXTURE_2D, o.tex || this.white); gl.uniform1f(u.uUseTex, o.tex ? (o.texEmi ? 1.5 + o.texEmi / 2 : 1) : 0);
      if (o.cull === false) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      gl.bindVertexArray(o.mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, o.mesh.count);
    };
    gl.disable(gl.BLEND); gl.depthMask(true);
    for (const o of scene.meshes) if (o.tint[3] >= 1 && !o.add) draw(o);
    gl.enable(gl.BLEND); gl.depthMask(false);
    for (const o of scene.meshes) if (o.tint[3] < 1 || o.add) { if (o.add) gl.blendFunc(gl.SRC_ALPHA, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); if (!glow || o.add) draw(o); }
    gl.depthMask(true); gl.disable(gl.CULL_FACE);
  }
  _sprites(scene, c, glow) {
    const gl = this.gl, { p, u } = this.ps; gl.useProgram(p); gl.bindVertexArray(this.quad);
    gl.uniformMatrix4fv(u.uVP, false, c.VP); gl.uniform3fv(u.uRight, c.right); gl.uniform3fv(u.uUp, c.up); gl.uniform1i(u.uTex, 0); gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.uniform1f(u.uGlow, glow ? 1 : 0);
    const list = scene.sprites.filter(s => s.visible !== false && (!glow || s.glow));
    // far to near for alpha blending
    list.sort((a, b) => (b._d || 0) - (a._d || 0));
    for (const s of list) {
      const cen = s.pos; s._d = Math.hypot(cen[0] - c.eye[0], cen[1] - c.eye[1], cen[2] - c.eye[2]);
      if (s.depthTest === false) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
      if (glow || s.add) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform3fv(u.uCen, cen); gl.uniform2fv(u.uSize, s.size); gl.uniform1f(u.uBill, s.m ? 0 : 1); gl.uniform1f(u.uRoll, s.roll || 0);
      if (s.m) gl.uniformMatrix4fv(u.uModel, false, s.m);
      const col = glow ? [s.color[0] * s.glow, s.color[1] * s.glow, s.color[2] * s.glow, s.color[3]] : s.color;
      if (!glow && s.add) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.uniform4fv(u.uCol, col); gl.uniform1f(u.uMode, s.mode || 0); gl.uniform1f(u.uParam, s.param || 0.08);
      gl.bindTexture(gl.TEXTURE_2D, s.tex || this.white); gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
  }
  _points(scene, c, h) {
    const P = scene.particles; if (!P || !P.n) return;
    const gl = this.gl, { p, u } = this.pp; gl.useProgram(p); gl.bindVertexArray(this.ptVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf); gl.bufferData(gl.ARRAY_BUFFER, P.pack(), gl.DYNAMIC_DRAW);
    gl.uniformMatrix4fv(u.uVP, false, c.VP); gl.uniform1f(u.uScale, h * 1.2);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
    gl.drawArrays(gl.POINTS, 0, P.n); gl.depthMask(true);
  }
}
