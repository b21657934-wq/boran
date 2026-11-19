(function () {
  const VS = 'attribute vec2 a_c;attribute vec2 a_head;attribute vec2 a_tail;attribute float a_a;'
    + 'uniform mat4 u_m;uniform vec2 u_res;uniform float u_w;varying float v_t;varying float v_s;varying float v_a;'
    + 'void main(){vec4 h=u_m*vec4(a_head,0.0,1.0);vec4 t=u_m*vec4(a_tail,0.0,1.0);'
    + 'vec2 hs=h.xy/h.w*u_res;vec2 ts=t.xy/t.w*u_res;vec2 d=hs-ts;float L=length(d);'
    + 'vec2 n=L>0.0001?vec2(-d.y,d.x)/L:vec2(0.0,1.0);vec4 p=mix(t,h,a_c.x);'
    + 'float w=u_w*mix(0.25,1.0,a_c.x);p.xy+=n*a_c.y*w/u_res*p.w;gl_Position=p;v_t=a_c.x;v_s=a_c.y;v_a=a_a;}';
  const FS = 'precision mediump float;varying float v_t;varying float v_s;varying float v_a;uniform vec3 u_col;uniform float u_hot;uniform float u_k;'
    + 'void main(){float edge=1.0-v_s*v_s;float a=u_k*v_a*pow(v_t,1.6)*edge;if(a<0.003)discard;'
    + 'vec3 c=mix(u_col,vec3(1.0),u_hot*v_t*v_t*0.55);gl_FragColor=vec4(c*a,a);}';

  const CIRC = 40075016.686 * Math.cos(51.13 * Math.PI / 180);
  const CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);

  function chill(t, v) {
    const k = v * 3.6;
    if (t > 10 || k < 4.8) return t;
    const p = Math.pow(k, 0.16);
    return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
  }

  function palette(w, night) {
    const stops = night
      ? [[-60, [0.86, 0.42, 1.0]], [-40, [0.66, 0.50, 1.0]], [-28, [0.47, 0.62, 1.0]], [-15, [0.45, 0.86, 1.0]], [0, [0.80, 0.94, 1.0]], [10, [0.95, 0.98, 1.0]]]
      : [[-60, [0.45, 0.12, 0.62]], [-40, [0.33, 0.18, 0.70]], [-28, [0.18, 0.28, 0.72]], [-15, [0.10, 0.38, 0.66]], [0, [0.20, 0.42, 0.62]], [10, [0.30, 0.46, 0.60]]];
    if (w <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (w <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i], k = (w - a[0]) / (b[0] - a[0]);
        return a[1].map((v, j) => v + (b[1][j] - v) * k);
      }
    }
    return stops[stops.length - 1][1];
  }

  function create(ctx) {
    const st = { parts: [], buf: null, n: 0, last: 0, prog: null, loc: null, ext: null, vao: null, glBuf: {}, on: true };

    function weather() { return ctx.weather() || { temp: -10, wind: 4, wdir: 220 }; }

    function spawn(m, p, fresh) {
      const c = m.getCanvas(), w = c.clientWidth, h = c.clientHeight;
      const pitch = m.getPitch();
      for (let tries = 0; tries < 4; tries++) {
        const sx = Math.random() * w;
        const sy = h * (pitch > 30 ? 0.1 + 0.9 * Math.random() : Math.random());
        const ll = m.unproject([sx, sy]);
        if (!ll || Math.abs(ll.lat - 51.13) > 0.6 || Math.abs(ll.lng - 71.44) > 0.9) continue;
        p.x = (ll.lng + 180) / 360;
        p.y = (1 - Math.log(Math.tan(Math.PI / 4 + ll.lat * Math.PI / 360)) / Math.PI) / 2;
        const l2 = m.unproject([sx + 12, sy]);
        p.s = Math.min(8 / (512 * Math.pow(2, m.getZoom())), Math.abs((l2.lng - ll.lng) / 360) / 12) || 1 / (512 * Math.pow(2, m.getZoom()));
        p.life = 1.6 + Math.random() * 2.6;
        p.age = fresh ? Math.random() * p.life : 0;
        p.k = 0.7 + Math.random() * 0.6;
        p.tx = p.x; p.ty = p.y;
        return true;
      }
      p.age = p.life;
      return false;
    }

    function field(x, y, t, out) {
      const X = x * CIRC / 1000, Y = y * CIRC / 1000;
      const a = 0.9, b = 1.7, c = 3.1;
      const p1 = a * X + 0.21 * t, q1 = a * Y - 0.17 * t, g = b * (X + Y) + 0.43 * t, h = c * (X - 0.6 * Y) - 0.61 * t;
      const dX = a * Math.cos(p1) * Math.cos(q1) + 0.5 * b * Math.cos(g) - 0.3 * c * Math.sin(h);
      const dY = -a * Math.sin(p1) * Math.sin(q1) + 0.5 * b * Math.cos(g) + 0.18 * c * Math.sin(h);
      out.u = dY / 2.2;
      out.v = -dX / 2.2;
      return out;
    }

    const tmp = { u: 0, v: 0 };

    function step(m, dt, now) {
      const wx = weather();
      const v = Math.max(0, wx.wind || 0);
      const c = m.getCanvas();
      const area = (c.clientWidth * c.clientHeight) / 1300000;
      const target = Math.round(Math.max(450, Math.min(5000, (700 + v * 240) * Math.max(0.45, Math.min(1.6, area)))));
      while (st.parts.length < target) { const p = { life: 3 }; spawn(m, p, true); st.parts.push(p); }
      if (st.parts.length > target) st.parts.length = target;
      const pxs = 30 + v * 14;
      const th = ((wx.wdir || 0) + 180) * Math.PI / 180;
      const mx = Math.sin(th), my = -Math.cos(th);
      const turb = v < 1 ? 1.2 : 0.55 + 2.2 / (v + 2);
      const t = now / 1000;
      const trail = 0.6;
      for (const p of st.parts) {
        p.age += dt;
        if (p.age >= p.life) { spawn(m, p, false); continue; }
        field(p.x, p.y, t, tmp);
        const gust = 1 + 0.35 * Math.sin(t * 0.9 + p.x * 4000) * Math.sin(t * 0.37 + p.y * 3000);
        const vx = (mx + turb * tmp.u * 0.6) * pxs * p.s * p.k * gust;
        const vy = (my + turb * tmp.v * 0.6) * pxs * p.s * p.k * gust;
        p.x += vx * dt; p.y += vy * dt;
        p.tx = p.x - vx * trail; p.ty = p.y - vy * trail;
      }
    }

    function fill() {
      const N = st.parts.length;
      if (!st.buf || st.buf.length < N * 5) st.buf = new Float32Array(Math.ceil(N * 1.3) * 5);
      const B = st.buf;
      let i = 0;
      for (const p of st.parts) {
        const lf = p.age / p.life;
        const a = Math.min(1, lf * 5) * Math.min(1, (1 - lf) * 3);
        B[i++] = p.x; B[i++] = p.y; B[i++] = p.tx; B[i++] = p.ty; B[i++] = a;
      }
      return N;
    }

    function shader(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }

    const layer = {
      id: 'b-wind', type: 'custom', renderingMode: '2d',
      onAdd(m, gl) {
        this.map = m;
        st.prog = gl.createProgram();
        gl.attachShader(st.prog, shader(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(st.prog, shader(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(st.prog);
        const L = (n) => gl.getAttribLocation(st.prog, n), U = (n) => gl.getUniformLocation(st.prog, n);
        st.loc = { c: L('a_c'), head: L('a_head'), tail: L('a_tail'), a: L('a_a'), m: U('u_m'), res: U('u_res'), w: U('u_w'), col: U('u_col'), hot: U('u_hot'), k: U('u_k') };
        st.gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        st.ext = st.gl2 ? null : gl.getExtension('ANGLE_instanced_arrays');
        st.vao = st.gl2 ? null : gl.getExtension('OES_vertex_array_object');
        st.glBuf.c = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, st.glBuf.c);
        gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
        st.glBuf.inst = gl.createBuffer();
        st.last = 0;
      },
      onRemove(m, gl) {
        if (st.prog) gl.deleteProgram(st.prog);
        Object.values(st.glBuf).forEach((b) => gl.deleteBuffer(b));
        st.glBuf = {}; st.prog = null; st.parts = [];
      },
      render(gl, matrix) {
        const m = this.map;
        if (!st.prog || !st.on || (!st.gl2 && !st.ext) || ctx.strength() <= 0.01) { st.last = 0; return; }
        const now = performance.now();
        const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0.016;
        st.last = now;
        step(m, dt, now);
        const N = fill();
        if (!N) return;
        const night = ctx.isNight();
        const wx = weather();
        const col = palette(chill(wx.temp, wx.wind || 0), night);
        if (st.gl2) gl.bindVertexArray(null); else if (st.vao) st.vao.bindVertexArrayOES(null);
        gl.useProgram(st.prog);
        gl.uniformMatrix4fv(st.loc.m, false, matrix);
        gl.uniform2f(st.loc.res, gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2);
        const dpr = window.devicePixelRatio || 1;
        gl.uniform1f(st.loc.w, (night ? 1.7 : 1.5) * dpr * Math.max(0.8, Math.min(1.5, (m.getZoom() - 10) / 3)));
        gl.uniform3f(st.loc.col, col[0], col[1], col[2]);
        gl.uniform1f(st.loc.hot, night ? 1 : 0);
        const div = (loc, d) => { if (st.gl2) gl.vertexAttribDivisor(loc, d); else st.ext.vertexAttribDivisorANGLE(loc, d); };
        gl.bindBuffer(gl.ARRAY_BUFFER, st.glBuf.c);
        gl.enableVertexAttribArray(st.loc.c); gl.vertexAttribPointer(st.loc.c, 2, gl.FLOAT, false, 0, 0); div(st.loc.c, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, st.glBuf.inst);
        gl.bufferData(gl.ARRAY_BUFFER, st.buf.subarray(0, N * 5), gl.DYNAMIC_DRAW);
        [['head', 2, 0], ['tail', 2, 8], ['a', 1, 16]].forEach(([k, n, off]) => {
          gl.enableVertexAttribArray(st.loc[k]); gl.vertexAttribPointer(st.loc[k], n, gl.FLOAT, false, 20, off); div(st.loc[k], 1);
        });
        gl.enable(gl.BLEND);
        gl.uniform1f(st.loc.k, (night ? 0.62 : 0.42) * ctx.strength());
        gl.blendFunc(gl.ONE, night ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        if (st.gl2) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, N); else st.ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, N);
        ['c', 'head', 'tail', 'a'].forEach((k) => { div(st.loc[k], 0); gl.disableVertexAttribArray(st.loc[k]); });
        m.triggerRepaint();
      },
    };

    return {
      attach() {
        const m = ctx.map();
        if (!m || !m.isStyleLoaded() || m.getLayer('b-wind')) return;
        const layers = m.getStyle().layers;
        const before = layers.find((L) => L.type === 'fill-extrusion' || L.type === 'symbol');
        try { m.addLayer(layer, before ? before.id : undefined); } catch (e) { }
      },
      show(on) { st.on = !!on; const m = ctx.map(); if (m) m.triggerRepaint(); },
      count: () => st.parts.length,
    };
  }

  window.BoranWind = { create };
})();
