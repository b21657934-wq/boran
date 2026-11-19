(function () {
  const VS = 'attribute vec3 a_p;attribute vec3 a_n;attribute float a_m;attribute vec2 a_uv;uniform mat4 u_m;'
    + 'varying vec3 v_p;varying vec3 v_n;varying float v_m;varying vec2 v_uv;'
    + 'void main(){v_p=a_p;v_n=a_n;v_m=a_m;v_uv=a_uv;gl_Position=u_m*vec4(a_p,1.0);}';
  const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 v_p;varying vec3 v_n;varying float v_m;varying vec2 v_uv;
uniform vec3 u_eye;uniform vec3 u_sun;uniform float u_night;uniform float u_time;
float net(vec2 q){return min(abs(fract(q.x+q.y)-0.5),abs(fract(q.x-q.y)-0.5));}
float grid(vec2 q,float w){vec2 f=abs(fract(q)-0.5);return smoothstep(0.5-w-0.02,0.5-w,max(f.x,f.y));}
void main(){
  vec3 n=normalize(v_n);if(!gl_FrontFacing)n=-n;
  vec3 V=normalize(u_eye-v_p);vec3 L=normalize(u_sun);
  float lam=max(dot(n,L),0.0);float hemi=0.5+0.5*n.z;
  float fres=pow(1.0-max(dot(n,V),0.0),3.0);
  float spec=pow(max(dot(n,normalize(L+V)),0.0),56.0);
  float m=v_m;vec3 c;
  if(m<0.5||m>4.5){
    if(m>4.5&&v_uv.y>5.0&&v_uv.y<77.0){if(net(vec2(v_uv.x*30.0,v_uv.y/2.3))>0.30)discard;}
    if(u_night>0.5){float up=clamp(v_p.z/100.0,0.0,1.0);c=mix(vec3(0.42,0.50,0.80),vec3(1.0,0.95,0.86),up)*(0.55+0.45*hemi)+fres*vec3(0.35,0.45,0.8);}
    else{c=vec3(0.96,0.97,0.98)*(0.42+0.58*lam)*mix(0.78,1.0,hemi)+spec*0.25;}
  }else if(m<1.5){
    float g=grid(vec2(v_uv.x*28.0,v_uv.y*14.0),0.06);
    vec3 gold=vec3(0.95,0.70,0.24);
    if(u_night>0.5){c=gold*1.25+vec3(1.0,0.86,0.55)*fres*0.9+vec3(1.0,0.95,0.8)*spec*0.5;c*=mix(1.0,0.62,g);}
    else{c=gold*(0.28+0.85*lam)+vec3(1.0,0.93,0.7)*spec*1.6+gold*fres*0.55;c*=mix(1.0,0.72,g);}
  }else if(m<2.5){
    c=vec3(0.84,0.82,0.78)*(0.5+0.5*lam);if(u_night>0.5)c=vec3(0.30,0.32,0.42)*(0.6+0.4*hemi);
  }else if(m<3.5){
    float l=1.0-smoothstep(0.0,0.05,net(vec2(v_uv.x*54.0,v_uv.y*16.0)));
    if(u_night>0.5){
      vec3 a=vec3(0.62,0.28,1.0),b=vec3(0.22,0.80,1.0);
      float k=0.5+0.5*sin(u_time*0.35+v_uv.x*6.2832);
      c=mix(a,b,clamp(v_uv.y*0.9+0.25*k,0.0,1.0))*(0.62+0.38*sin(u_time*0.6-v_uv.y*5.0))+fres*0.35;
      c=mix(c,c*0.45,l);
    }else{c=vec3(0.95,0.90,0.77)*(0.48+0.55*lam)*mix(0.85,1.0,hemi)+spec*0.35;c=mix(c,c*0.72,l);}
  }else{
    float g=grid(vec2(v_uv.x*40.0,v_uv.y*20.0),0.05);
    if(u_night>0.5){
      float band=1.0-smoothstep(0.0,0.06,abs(fract(v_uv.y*1.5-u_time*0.06)-0.5)-0.38);
      c=vec3(0.07,0.14,0.36)+fres*vec3(0.25,0.5,1.0)+g*vec3(0.25,0.85,1.0)*(0.45+0.9*band)+band*vec3(0.05,0.25,0.5);
    }else{c=vec3(0.52,0.68,0.84)*(0.3+0.6*lam)+vec3(1.0)*spec*1.4+fres*vec3(0.55,0.75,0.95)*0.6;c=mix(c,vec3(0.86,0.9,0.95),g*0.65);}
  }
  gl_FragColor=vec4(c,1.0);
}`;

  function Mesh() { this.v = []; this.i = []; }
  Mesh.prototype.n = function () { return this.v.length / 9; };

  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function grid(M, nu, nv, f, core, mat, uvf, wrap) {
    const P = [];
    for (let j = 0; j <= nv; j++) { const row = []; for (let i = 0; i <= nu; i++) row.push(f(i / nu, j / nv)); P.push(row); }
    const base = M.n();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const iu0 = i > 0 ? i - 1 : (wrap ? nu - 1 : 0), iu1 = i < nu ? i + 1 : (wrap ? 1 : nu);
        const jv0 = Math.max(0, j - 1), jv1 = Math.min(nv, j + 1);
        let nr = norm(cross(sub(P[j][iu1], P[j][iu0]), sub(P[jv1][i], P[jv0][i])));
        const o = core(i / nu, j / nv), p = P[j][i];
        if (dot(nr, sub(p, o)) < 0) nr = [-nr[0], -nr[1], -nr[2]];
        if (!isFinite(nr[0])) nr = [0, 0, 1];
        const uv = uvf(i / nu, j / nv, p);
        M.v.push(p[0], p[1], p[2], nr[0], nr[1], nr[2], mat, uv[0], uv[1]);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        M.i.push(a, b, d, a, d, c);
      }
    }
  }

  function lathe(M, prof, seg, mat, cx = 0, cy = 0) {
    const zs = prof.map((q) => q[1]);
    const at = (t) => {
      const s = t * (prof.length - 1), k = Math.min(prof.length - 2, Math.floor(s)), f = s - k;
      return [prof[k][0] + (prof[k + 1][0] - prof[k][0]) * f, prof[k][1] + (prof[k + 1][1] - prof[k][1]) * f];
    };
    grid(M, seg, (prof.length - 1) * 4, (u, v) => { const [r, z] = at(v), a = u * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]; },
      (u, v) => [cx, cy, at(v)[1]], mat, (u, v, p) => [u, p[2]], true);
    return zs;
  }

  function sphere(M, cx, cy, cz, R, nu, nv, mat) {
    grid(M, nu, nv, (u, v) => { const a = u * Math.PI * 2, b = (v - 0.5) * Math.PI; return [cx + Math.cos(a) * Math.cos(b) * R, cy + Math.sin(a) * Math.cos(b) * R, cz + Math.sin(b) * R]; },
      () => [cx, cy, cz], mat, (u, v) => [u, v], true);
  }

  function tube(M, pts, r0, r1, seg, mat) {
    const n = pts.length;
    const frames = pts.map((p, k) => {
      const t = norm(sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
      const up = Math.abs(t[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
      const nn = norm(cross(t, up)), bb = cross(t, nn);
      return [nn, bb];
    });
    grid(M, seg, n - 1, (u, v) => {
      const k = Math.round(v * (n - 1)), p = pts[k], [nn, bb] = frames[k], a = u * Math.PI * 2, r = r0 + (r1 - r0) * v;
      return [p[0] + (nn[0] * Math.cos(a) + bb[0] * Math.sin(a)) * r, p[1] + (nn[1] * Math.cos(a) + bb[1] * Math.sin(a)) * r, p[2] + (nn[2] * Math.cos(a) + bb[2] * Math.sin(a)) * r];
    }, (u, v) => pts[Math.round(v * (n - 1))], mat, (u, v, p) => [u, p[2]], true);
  }

  function bez(p0, p1, p2, p3, t) {
    const a = 1 - t;
    return p0.map((_, k) => a * a * a * p0[k] + 3 * a * a * t * p1[k] + 3 * a * t * t * p2[k] + t * t * t * p3[k]);
  }

  function baiterek() {
    const M = new Mesh();
    lathe(M, [[9.5, 0], [9.5, 1.4], [7.2, 2.2], [6.2, 3.0]], 40, 2);
    lathe(M, [[6.0, 2.8], [5.0, 8], [4.3, 22], [3.9, 46], [3.6, 66], [3.4, 80]], 36, 5);
    lathe(M, [[2.0, 2.8], [2.0, 80]], 16, 0);
    sphere(M, 0, 0, 89, 11, 48, 28, 1);
    tube(M, Array.from({ length: 40 }, (_, k) => { const a = (k / 39) * Math.PI * 2; return [Math.cos(a) * 10.4, Math.sin(a) * 10.4, 83]; }), 0.55, 0.55, 8, 0);
    const curve = (ph, ctl) => Array.from({ length: 25 }, (_, k) => { const q = bez(ctl[0], ctl[1], ctl[2], ctl[3], k / 24); return [Math.cos(ph) * q[0], Math.sin(ph) * q[0], q[1]]; });
    const N = 12, outer = [];
    for (let i = 0; i < N; i++) {
      const ph = (i / N) * Math.PI * 2;
      const pts = curve(ph, [[4.2, 36], [8.5, 54], [16.5, 74], [24.5, 99]]);
      outer.push(pts);
      tube(M, pts, 0.85, 0.12, 8, 0);
    }
    const rAt = (z) => { const P = outer[0]; for (let k = 1; k < P.length; k++) if (P[k][2] >= z) { const a = P[k - 1], b = P[k], f = (z - a[2]) / (b[2] - a[2]); return Math.hypot(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f); } return 24; };
    const ring = (z, r, w) => tube(M, Array.from({ length: 49 }, (_, k) => { const a = (k / 48) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r, z]; }), w, w, 6, 0);
    [52, 64, 79].forEach((z, k) => ring(z, rAt(z), k === 2 ? 0.7 : 0.4));
    const at = (P, z) => { for (let k = 1; k < P.length; k++) if (P[k][2] >= z) { const a = P[k - 1], b = P[k], f = (z - a[2]) / (b[2] - a[2]); return a.map((q, n) => q + (b[n] - q) * f); } return P[P.length - 1]; };
    for (let i = 0; i < N; i++) {
      const A = outer[i], B = outer[(i + 1) % N];
      [[44, 58], [58, 72], [72, 88]].forEach(([z0, z1]) => {
        tube(M, [at(A, z0), at(B, z1)], 0.32, 0.32, 5, 0);
        tube(M, [at(B, z0), at(A, z1)], 0.32, 0.32, 5, 0);
      });
    }
    ring(80, 12.2, 0.9);
    for (let i = 0; i < 16; i++) {
      const ph = ((i + 0.5) / 16) * Math.PI * 2;
      tube(M, curve(ph, [[3.6, 60], [5.5, 70], [9.5, 76], [12.2, 80]]), 0.35, 0.3, 6, 0);
    }
    lathe(M, [[0.55, 99.6], [0.08, 107]], 10, 0);
    return M;
  }

  function khanShatyr() {
    const M = new Mesh();
    const A = 98.5, B = 84, rot = -8.5 * Math.PI / 180, H = 118, ox = -19.9, oy = 16.3;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const surf = (u, v) => {
      const a = u * Math.PI * 2, s = Math.pow(1 - v, 1.45), w = Math.pow(v, 1.25);
      const ex = Math.cos(a) * A * s, ey = Math.sin(a) * B * s;
      return [ex * cr - ey * sr + ox * w, ex * sr + ey * cr + oy * w, H * v];
    };
    grid(M, 72, 44, (u, v) => surf(u, Math.min(v, 0.985)), (u, v) => { const w = Math.pow(Math.min(v, 0.985), 1.25); return [ox * w, oy * w, H * Math.min(v, 0.985) - 6]; }, 3, (u, v) => [u, v], true);
    const top = [ox, oy, H * 0.985];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const foot = [top[0] + Math.cos(a) * 4.5, top[1] + Math.sin(a) * 4.5, H - 16];
      const tip = [top[0] - Math.cos(a) * 3.5 + 2, top[1] - Math.sin(a) * 3.5 - 1.5, 151];
      const pts = Array.from({ length: 8 }, (_, j) => { const t = j / 7; return foot.map((q, n) => q + (tip[n] - q) * t); });
      tube(M, pts, 0.7, 0.3, 8, 0);
    }
    return M;
  }

  function nurAlem() {
    const M = new Mesh();
    lathe(M, [[26, 0], [26, 6], [22, 12], [14, 16], [12, 24]], 48, 2);
    sphere(M, 0, 0, 60, 40, 72, 40, 4);
    return M;
  }

  const SITES = [
    { id: 'baiterek', lon: 71.43048, lat: 51.12827, build: baiterek },
    { id: 'khanshatyr', lon: 71.40388, lat: 51.13249, build: khanShatyr },
    { id: 'nuralem', lon: 71.41613, lat: 51.08893, build: nurAlem },
  ];

  function mul(a, b) {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
    }
    return o;
  }

  function inv(m) {
    const a = m, o = new Float64Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!d) return null;
    d = 1 / d;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
    return o;
  }

  function create(ctx) {
    const st = { prog: null, loc: null, sites: [] };
    function shader(gl, type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('landmarks shader', gl.getShaderInfoLog(s));
      return s;
    }
    const layer = {
      id: 'b-monuments', type: 'custom', renderingMode: '3d',
      onAdd(m, gl) {
        this.map = m;
        st.prog = gl.createProgram();
        gl.attachShader(st.prog, shader(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(st.prog, shader(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(st.prog);
        const A = (k) => gl.getAttribLocation(st.prog, k), U = (k) => gl.getUniformLocation(st.prog, k);
        st.loc = { p: A('a_p'), n: A('a_n'), m: A('a_m'), uv: A('a_uv'), M: U('u_m'), eye: U('u_eye'), sun: U('u_sun'), night: U('u_night'), time: U('u_time') };
        st.vao = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? null : gl.getExtension('OES_vertex_array_object');
        st.sites = SITES.map((s) => {
          const mesh = s.build();
          const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.v), gl.STATIC_DRAW);
          const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.i), gl.STATIC_DRAW);
          const mc = maplibregl.MercatorCoordinate.fromLngLat([s.lon, s.lat], 0), sc = mc.meterInMercatorCoordinateUnits();
          return { id: s.id, vb, ib, count: mesh.i.length, model: new Float64Array([sc, 0, 0, 0, 0, -sc, 0, 0, 0, 0, sc, 0, mc.x, mc.y, 0, 1]) };
        });
      },
      onRemove(m, gl) {
        st.sites.forEach((s) => { gl.deleteBuffer(s.vb); gl.deleteBuffer(s.ib); });
        if (st.prog) gl.deleteProgram(st.prog);
        st.sites = []; st.prog = null;
      },
      render(gl, matrix) {
        if (!st.prog) return;
        if (gl.bindVertexArray) gl.bindVertexArray(null); else if (st.vao) st.vao.bindVertexArrayOES(null);
        gl.useProgram(st.prog);
        const night = ctx.isNight();
        gl.uniform1f(st.loc.night, night ? 1 : 0);
        gl.uniform1f(st.loc.time, performance.now() / 1000);
        const sun = night ? [-0.25, -0.45, 0.86] : [0.48, -0.56, 0.68];
        gl.uniform3f(st.loc.sun, sun[0], sun[1], sun[2]);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
        gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
        const P = Float64Array.from(matrix);
        for (const s of st.sites) {
          const F = mul(P, s.model), I = inv(F);
          if (!I) continue;
          const e = [I[8], I[9], I[10], I[11]];
          const w = Math.abs(e[3]) > 1e-12 ? e[3] : 1e-12;
          gl.uniform3f(st.loc.eye, e[0] / w, e[1] / w, e[2] / w);
          gl.uniformMatrix4fv(st.loc.M, false, Float32Array.from(F));
          gl.bindBuffer(gl.ARRAY_BUFFER, s.vb);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.ib);
          const L = st.loc;
          gl.enableVertexAttribArray(L.p); gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 36, 0);
          gl.enableVertexAttribArray(L.n); gl.vertexAttribPointer(L.n, 3, gl.FLOAT, false, 36, 12);
          gl.enableVertexAttribArray(L.m); gl.vertexAttribPointer(L.m, 1, gl.FLOAT, false, 36, 24);
          gl.enableVertexAttribArray(L.uv); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 36, 28);
          gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_SHORT, 0);
        }
        [st.loc.p, st.loc.n, st.loc.m, st.loc.uv].forEach((l) => gl.disableVertexAttribArray(l));
        if (night) this.map.triggerRepaint();
      },
    };
    return {
      attach() {
        const m = ctx.map();
        if (!m || !m.isStyleLoaded() || m.getLayer('b-monuments')) return;
        const layers = m.getStyle().layers;
        let last = -1;
        layers.forEach((L, k) => { if (/^b-/.test(L.id)) last = k; });
        const next = layers[last + 1];
        try { m.addLayer(layer, next ? next.id : undefined); } catch (e) { }
      },
    };
  }

  window.BoranLandmarks = { create, SITES };
})();
