(function () {
  const PRE = 6500, MAIN = 30000, MORN = 26000;
  const FC = (f) => ({ type: 'FeatureCollection', features: f || [] });

  const VS = 'attribute vec2 a_pos;attribute vec2 a_st;uniform mat4 u_m;uniform float u_size;varying vec2 v_st;'
    + 'void main(){gl_Position=u_m*vec4(a_pos,0.0,1.0);float s=u_size;if(a_st.x>0.5)s=u_size*mix(7.5,1.9,a_st.y);gl_PointSize=s;v_st=a_st;}';
  const FS = 'precision mediump float;varying vec2 v_st;'
    + 'void main(){vec2 c=gl_PointCoord*2.0-1.0;float r=dot(c,c);if(r>1.0)discard;'
    + 'if(v_st.x>0.5){float ring=smoothstep(0.5,0.82,r)*(1.0-smoothstep(0.82,1.0,r));float core=1.0-smoothstep(0.0,0.3,r);'
    + 'float a=mix(ring+core,1.0-r*0.6,v_st.y);gl_FragColor=vec4(1.0,0.22,0.24,a);}'
    + 'else{gl_FragColor=vec4(0.70,0.94,1.0,(1.0-r)*0.95*v_st.y);}}';

  function shader(gl, type, src) { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; }

  function decodeMorning(m) {
    const paths = m.paths.map((enc) => {
      const n = enc.length / 2, x = new Float64Array(n), y = new Float64Array(n), cum = new Float64Array(n);
      let lo = 0, la = 0;
      for (let i = 0; i < n; i++) {
        lo += enc[2 * i]; la += enc[2 * i + 1];
        const lon = lo / 1e5, lat = la / 1e5;
        x[i] = (lon + 180) / 360;
        y[i] = (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
        if (i) { const pl = (lo - enc[2 * i]) / 1e5, pa = (la - enc[2 * i + 1]) / 1e5; cum[i] = cum[i - 1] + Math.hypot((lon - pl) * 111320 * Math.cos(lat * Math.PI / 180), (lat - pa) * 110540); }
      }
      return { x, y, cum, len: cum[n - 1] || 1 };
    });
    const N = m.agents.length, A = { n: N, pi: new Int32Array(N), dep: new Float32Array(N), v: new Float32Array(N), f: { now: new Float32Array(N), ai: new Float32Array(N) } };
    m.agents.forEach((r, i) => { A.pi[i] = r[0]; A.dep[i] = r[1] / 10; A.v[i] = r[2] / 100; A.f.now[i] = r[3]; A.f.ai[i] = r[4]; });
    const buf = () => ({ pos: new Float32Array(6 * N), st: new Float32Array(6 * N), n: 0, fallen: 0 });
    return { paths, A, dur: m.dur, falls: m.falls, out: { now: buf(), ai: buf() } };
  }

  function crowdLayer(id, M, key) {
    let prog = null, bp = null, bs = null, lp = -1, ls = -1, um = null, us = null;
    return {
      id, type: 'custom', renderingMode: '2d',
      onAdd(m, gl) {
        prog = gl.createProgram();
        gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
        lp = gl.getAttribLocation(prog, 'a_pos'); ls = gl.getAttribLocation(prog, 'a_st');
        um = gl.getUniformLocation(prog, 'u_m'); us = gl.getUniformLocation(prog, 'u_size');
        bp = gl.createBuffer(); bs = gl.createBuffer();
        this.map = m;
      },
      render(gl, matrix) {
        const c = M.out[typeof key === 'function' ? key() : key];
        if (!c || !c.n || !prog) return;
        if (gl.bindVertexArray) gl.bindVertexArray(null);
        gl.useProgram(prog);
        gl.uniformMatrix4fv(um, false, matrix);
        const z = this.map.getZoom();
        gl.uniform1f(us, Math.max(1.8, Math.min(7, 1.6 + (z - 11) * 1.15)) * (window.devicePixelRatio || 1));
        gl.bindBuffer(gl.ARRAY_BUFFER, bp); gl.bufferData(gl.ARRAY_BUFFER, c.pos.subarray(0, 2 * c.n), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, bs); gl.bufferData(gl.ARRAY_BUFFER, c.st.subarray(0, 2 * c.n), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(ls); gl.vertexAttribPointer(ls, 2, gl.FLOAT, false, 0, 0);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, c.n);
        gl.disableVertexAttribArray(lp); gl.disableVertexAttribArray(ls);
      },
    };
  }

  function computeCrowd(M, T, keys) {
    const A = M.A, P = M.paths;
    keys.forEach((k) => { M.out[k].n = 0; M.out[k].fallen = 0; });
    for (let i = 0; i < A.n; i++) {
      const t = T - A.dep[i];
      if (t < 0) continue;
      const p = P[A.pi[i]], v = A.v[i], s = t * 60 * v;
      for (const k of keys) {
        const fr = A.f[k][i], fs = fr >= 0 ? fr / 1000 * p.len : Infinity, o = M.out[k];
        let d = s, kind = 0, ph = 1;
        if (s >= fs) { d = fs; kind = 1; ph = Math.min(1, (t - fs / (60 * v)) / 2.5); o.fallen++; }
        else if (s >= p.len) continue;
        const reps = kind ? 1 : 3;
        for (let r = 0; r < reps; r++) {
          const dd = Math.max(0, d - r * 9);
          let lo = 0, hi = p.cum.length - 1;
          while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.cum[mid] <= dd) lo = mid; else hi = mid; }
          const seg = p.cum[hi] - p.cum[lo], q = seg > 0 ? (dd - p.cum[lo]) / seg : 0, j = o.n * 2;
          o.pos[j] = p.x[lo] + (p.x[hi] - p.x[lo]) * q; o.pos[j + 1] = p.y[lo] + (p.y[hi] - p.y[lo]) * q;
          o.st[j] = kind; o.st[j + 1] = kind ? ph : [1, 0.5, 0.22][r];
          o.n++;
        }
      }
    }
  }

  const GRADE = [
    [0, [255, 122, 69, 0.42], [58, 42, 106, 0.34], [0, 0, 0, 0]],
    [1.6, [255, 110, 80, 0.10], [42, 40, 110, 0.22], [0, 0, 0, 0]],
    [3, [0, 0, 0, 0], [24, 30, 80, 0.12], [90, 122, 255, 0.07]],
    [7, [0, 0, 0, 0], [31, 165, 181, 0.10], [90, 122, 255, 0.05]],
    [9.4, [0, 0, 0, 0], [60, 50, 140, 0.14], [106, 76, 200, 0.18]],
    [11, [0, 0, 0, 0], [255, 178, 122, 0.20], [255, 138, 74, 0.44]],
    [12.5, [0, 0, 0, 0], [168, 200, 255, 0.22], [255, 210, 154, 0.32]],
  ];

  function grade(h) {
    let g = document.getElementById('grade');
    if (h == null) { if (g) g.style.opacity = '0'; return; }
    if (!g) { g = document.createElement('div'); g.id = 'grade'; document.body.insertBefore(g, document.getElementById('snow')); }
    let i = 1;
    while (i < GRADE.length - 1 && GRADE[i][0] < h) i++;
    const a = GRADE[i - 1], b = GRADE[i], k = Math.max(0, Math.min(1, (h - a[0]) / (b[0] - a[0])));
    const mix = (j) => a[j].map((v, n) => v + (b[j][n] - v) * k);
    const rgba = (c) => 'rgba(' + c.slice(0, 3).map(Math.round).join(',') + ',' + c[3].toFixed(3) + ')';
    const west = mix(1), top = mix(2), east = mix(3);
    g.style.opacity = '1';
    g.style.background = 'radial-gradient(70% 55% at 0% 8%,' + rgba(west) + ',rgba(0,0,0,0) 70%),'
      + 'radial-gradient(75% 60% at 100% 6%,' + rgba(east) + ',rgba(0,0,0,0) 72%),'
      + 'linear-gradient(180deg,' + rgba(top) + ' 0%,rgba(0,0,0,0) 55%)';
  }

  function create(ctx) {
    const { map, t } = ctx;
    const st = { data: null, req: null, on: false, mode: 'ai', T: 0, playing: false, raf: 0, last: 0, riskT: -1, phase: 'night', M: null, mT: 0, twin: null, split: false, mainKey: 'ai', auto: 0 };
    const SPLIT = document.getElementById('split'), BOX2 = document.getElementById('map2');
    const sandFC = (key) => FC(st.data[key].sand.map((x) => ({ type: 'Feature', properties: { t: x.t, t0: x.t0 }, geometry: { type: 'LineString', coordinates: x.line } })));

    function sandLayers(m, key) {
      if (m.getSource('nt-sand')) { m.getSource('nt-sand').setData(sandFC(key)); return; }
      m.addSource('nt-sand', { type: 'geojson', data: sandFC(key) });
      m.addLayer({ id: 'nt-sand-glow', type: 'line', source: 'nt-sand', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2BD96B', 'line-blur': 6, 'line-opacity': 0.4, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 18] } });
      m.addLayer({ id: 'nt-sand', type: 'line', source: 'nt-sand', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2BD96B', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 15, 5] } });
    }

    function startMorning() {
      if (!st.on || st.phase === 'morning' || !st.data.morning) return;
      clearTimeout(st.auto);
      st.phase = 'morning'; st.mT = 0; st.playing = true; st.last = 0;
      if (!st.M) st.M = decodeMorning(st.data.morning);
      const m = map();
      st.split = window.innerWidth > 760;
      st.mainKey = st.split ? 'now' : st.mode;
      ['nt-trucks', 'nt-trucks-halo', 'nt-trail', 'nt-depots'].forEach((id) => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none'); });
      m.setFilter('nt-sand', null); m.setFilter('nt-sand-glow', null);
      sandLayers(m, st.mainKey);
      if (!m.getLayer('nt-crowd')) m.addLayer(crowdLayer('nt-crowd', st.M, () => st.mainKey));
      const view = { center: [71.43, 51.137], zoom: st.split ? 13.3 : 12.2, pitch: 50, bearing: -18 };
      m.flyTo(Object.assign({ duration: 2200, essential: true, padding: st.split ? { top: 0, bottom: 0, left: 0, right: 0 } : { top: 0, left: 0, right: 0, bottom: window.innerHeight * 0.42 } }, view));
      if (ctx.hideExtras) ctx.hideExtras(true, true);
      m.once('moveend', () => { if (st.phase === 'morning') m.easeTo({ bearing: 8, zoom: view.zoom + 0.35, duration: MORN, easing: (x) => x }); });
      document.body.classList.add('nightshow');
      if (ctx.setWind) ctx.setWind(0);
      if (st.split) {
        box.hidden = true;
        BOX2.hidden = false; SPLIT.hidden = false;
        SPLIT.querySelector('.split-l').textContent = t('nt_now');
        SPLIT.querySelector('.split-r').textContent = t('nt_ai');
        st.twin = ctx.makeTwin(BOX2);
        st.twin.on('load', () => { st.sync(); sandLayers(st.twin, 'ai'); st.twin.addLayer(crowdLayer('nt-crowd', st.M, () => 'ai')); });
        st.sync = () => { if (st.twin) st.twin.jumpTo({ center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), padding: m.getPadding() }); };
        m.on('move', st.sync);
        const knob = SPLIT.querySelector('.split-knob');
        knob.onpointerdown = (ev) => {
          knob.setPointerCapture(ev.pointerId);
          knob.onpointermove = (e2) => document.documentElement.style.setProperty('--split', Math.max(8, Math.min(92, e2.clientX / window.innerWidth * 100)) + '%');
          knob.onpointerup = () => { knob.onpointermove = null; };
        };
      } else render();
    }

    function stopMorning() {
      if (st.phase !== 'morning') return;
      st.phase = 'night';
      const m = map();
      if (m) {
        if (st.sync) m.off('move', st.sync);
        if (m.getLayer('nt-crowd')) m.removeLayer('nt-crowd');
        ['nt-trucks', 'nt-trucks-halo', 'nt-trail', 'nt-depots'].forEach((id) => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible'); });
      }
      if (st.twin) { st.twin.remove(); st.twin = null; }
      document.body.classList.remove('nightshow');
      if (ctx.setWind && st.on) ctx.setWind(0.4);
      BOX2.hidden = true; SPLIT.hidden = true; BOX2.innerHTML = '';
      document.documentElement.style.removeProperty('--split');
      SPLIT.querySelectorAll('.split-fin').forEach((x) => x.remove());
      st.drawnMode = null;
    }

    function morningTick() {
      const m = map(), M = st.M;
      if (!m.getLayer('nt-crowd') && m.isStyleLoaded()) { sandLayers(m, st.mainKey); m.addLayer(crowdLayer('nt-crowd', M, () => st.mainKey)); }
      computeCrowd(M, st.mT, ['now', 'ai']);
      grade(11 + st.mT / 60);
      m.triggerRepaint();
      if (st.twin) st.twin.triggerRepaint();
      const clk = clock(st.data.end + st.mT), total = M.A.n;
      const done = st.mT >= M.dur - 0.01;
      if (st.split) {
        const cell = (k) => '<b class="red">' + M.out[k].fallen + '</b><small>' + t('nt_fell') + ' · ' + t('nt_of', { n: total.toLocaleString('ru-RU') }) + ' · ' + clk + '</small>';
        SPLIT.querySelector('.split-cl').innerHTML = cell('now');
        SPLIT.querySelector('.split-cr').innerHTML = cell('ai');
        let fin = SPLIT.querySelector('.split-fin');
        if (done && !fin) {
          fin = document.createElement('div'); fin.className = 'split-fin';
          const a = M.out.now.fallen, b = M.out.ai.fallen;
          fin.innerHTML = '<p>' + t('nt_m_result', { a, b, d: a - b }) + '</p><small>' + t('nt_m_note') + '</small><div><button class="cta sf-again">' + t('nt_again') + '</button><button class="btn2 sf-close">' + t('nt_close') + '</button></div>';
          SPLIT.append(fin);
          fin.querySelector('.sf-again').onclick = () => { fin.remove(); st.mT = 0; st.playing = true; st.last = 0; };
          fin.querySelector('.sf-close').onclick = () => api.close();
        }
      } else {
        const k = box.querySelector('.nt-big');
        if (k) {
          box.querySelector('.nt-clock').textContent = clk;
          box.querySelector('.nt-kpi small').textContent = t('nt_m_kpi', { n: total.toLocaleString('ru-RU') });
          box.querySelector('.nt-stats').textContent = '';
          box.querySelector('.nt-phase').textContent = t('nt_m_note');
          k.textContent = M.out[st.mainKey].fallen;
          box.querySelector('.nt-base').textContent = t('nt_m_vs', { a: M.out.now.fallen, b: M.out.ai.fallen });
          box.querySelector('.nt-prog i').style.width = (st.mT / M.dur * 100).toFixed(1) + '%';
          const fin = box.querySelector('.nt-fin');
          if (done) { fin.hidden = false; fin.innerHTML = '<b>' + t('nt_m_result', { a: M.out.now.fallen, b: M.out.ai.fallen, d: M.out.now.fallen - M.out.ai.fallen }) + '</b><small>' + t('nt_m_note') + '</small>'; }
          box.querySelector('.nt-play').textContent = st.playing ? '❚❚' : (done ? '↻' : '▶');
        }
      }
    }

    const box = document.getElementById('night');
    const $ = (sel) => box.querySelector(sel);
    const num = (v, d = 0) => Number(v).toFixed(d).replace('-', '−');

    function load() {
      if (st.data) return Promise.resolve(st.data);
      if (!st.req) st.req = fetch('night.json?v=' + (ctx.version() || '')).then((r) => r.json()).then((d) => { st.data = d; return d; });
      return st.req;
    }

    function clock(m) { const h = (st.data.start + Math.floor(m / 60)) % 24; return String(h).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0'); }

    function layers() {
      const m = map();
      if (!m || !m.isStyleLoaded()) return false;
      if (m.getSource('nt-sand')) return true;
      m.addSource('nt-sand', { type: 'geojson', data: FC() });
      m.addSource('nt-trail', { type: 'geojson', data: FC() });
      m.addSource('nt-trucks', { type: 'geojson', data: FC() });
      m.addSource('nt-depots', { type: 'geojson', data: FC() });
      m.addLayer({ id: 'nt-sand-glow', type: 'line', source: 'nt-sand', filter: ['<=', ['get', 't0'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2BD96B', 'line-blur': 6, 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 18] } });
      m.addLayer({ id: 'nt-sand', type: 'line', source: 'nt-sand', filter: ['<=', ['get', 't0'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2BD96B', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 15, 6] } });
      m.addLayer({ id: 'nt-trail', type: 'line', source: 'nt-trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'c'], 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 6] } });
      m.addLayer({ id: 'nt-depots', type: 'circle', source: 'nt-depots',
        paint: { 'circle-radius': 7, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'viewport' } });
      m.addLayer({ id: 'nt-trucks-halo', type: 'circle', source: 'nt-trucks',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 11, 15, 22], 'circle-color': ['get', 'c'], 'circle-opacity': 0.28, 'circle-blur': 0.5, 'circle-pitch-alignment': 'viewport' } });
      m.addLayer({ id: 'nt-trucks', type: 'circle', source: 'nt-trucks',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9], 'circle-color': ['get', 'c'], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'viewport' } });
      st.drawnMode = null;
      return true;
    }

    function dropLayers() {
      const m = map();
      if (!m) return;
      ['nt-crowd', 'nt-trucks', 'nt-trucks-halo', 'nt-depots', 'nt-trail', 'nt-sand', 'nt-sand-glow'].forEach((id) => { if (m.getLayer(id)) m.removeLayer(id); });
      ['nt-trucks', 'nt-depots', 'nt-trail', 'nt-sand'].forEach((id) => { if (m.getSource(id)) m.removeSource(id); });
    }

    const COL = { ai: '#3FD0E0', now: '#FF9A3C' };

    function at(path, T) {
      if (!path.length || T < path[0][2]) return null;
      let lo = 0, hi = path.length - 1;
      if (T >= path[hi][2]) return [path[hi][0], path[hi][1], hi];
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid][2] <= T) lo = mid; else hi = mid; }
      const a = path[lo], b = path[hi], k = b[2] > a[2] ? (T - a[2]) / (b[2] - a[2]) : 0;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, lo];
    }

    function draw() {
      const m = map();
      if (!st.data || !layers()) return;
      const run = st.data[st.mode], T = st.T;
      if (st.drawnMode !== st.mode) {
        st.drawnMode = st.mode;
        m.getSource('nt-sand').setData(FC(run.sand.map((s) => ({ type: 'Feature', properties: { t: s.t, t0: s.t0 }, geometry: { type: 'LineString', coordinates: s.line } }))));
        m.getSource('nt-depots').setData(FC(st.data.depots.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))));
      }
      m.setFilter('nt-sand', ['<=', ['get', 't0'], T]);
      m.setFilter('nt-sand-glow', ['<=', ['get', 't0'], T]);
      const trucks = [], trails = [];
      run.trucks.forEach((p) => {
        const q = at(p, T);
        if (!q) return;
        trucks.push({ type: 'Feature', properties: { c: COL[st.mode] }, geometry: { type: 'Point', coordinates: [q[0], q[1]] } });
        const tail = [];
        for (let i = q[2]; i >= 0 && p[i][2] >= T - 18; i--) tail.unshift([p[i][0], p[i][1]]);
        tail.push([q[0], q[1]]);
        if (tail.length > 1) trails.push({ type: 'Feature', properties: { c: COL[st.mode] }, geometry: { type: 'LineString', coordinates: tail } });
      });
      m.getSource('nt-trucks').setData(FC(trucks));
      m.getSource('nt-trail').setData(FC(trails));
      const hf = Math.min(st.data.tables.length - 1.001, T / 60), h0 = Math.floor(hf), k = hf - h0;
      const key = Math.round(T / 4);
      if (key !== st.riskT) {
        st.riskT = key;
        const a = st.data.tables[h0], b = st.data.tables[h0 + 1];
        ctx.setRisk(a.map((v, i) => Math.round(v + (b[i] - v) * k)));
      }
      hud();
      grade(T / 60);
    }

    function level(run, T) {
      let v = run.curve[0][1];
      for (const [tm, x] of run.curve) { if (tm <= T) v = x; else break; }
      return v;
    }

    function hud() {
      const d = st.data, T = st.T, run = d[st.mode];
      const hf = Math.min(d.ice.length - 1, Math.floor(T / 60));
      $('.nt-clock').textContent = clock(T);
      $('.nt-temp').textContent = num(d.temps[hf]) + '°';
      $('.nt-ice i').style.width = Math.round(d.ice[hf] * 100) + '%';
      $('.nt-ice b').textContent = t('nt_ice', { p: Math.round(d.ice[hf] * 100) });
      $('.nt-prog i').style.width = (T / d.end * 100).toFixed(1) + '%';
      const v = level(run, T);
      $('.nt-big').textContent = Math.round(v);
      $('.nt-base').textContent = t('nt_base', { n: Math.round(run.base) }) + (v < run.base ? ' · −' + Math.round((1 - v / run.base) * 100) + '%' : '');
      const done = run.sand.filter((s) => s.t <= T);
      $('.nt-stats').textContent = t('nt_stats', { n: d.depots.length, km: num(done.reduce((a, s) => a + lineKm(s.line), 0), 0), s: done.length });
      $('.nt-phase').textContent = T < d.deploy ? t('nt_wait') : T < d.deploy + 30 ? t('nt_go') : (st.mode === 'ai' ? t('nt_how_ai') : t('nt_how_now'));
      const fin = $('.nt-fin');
      if (T >= d.end - 0.5) {
        const a = d.now.final, b = d.ai.final, dkm = d.now.km - d.ai.km;
        fin.hidden = false;
        fin.innerHTML = '<b>' + t('nt_result', { a: Math.round(a), b: Math.round(b), d: Math.round(a - b) }) + (dkm > 1 ? ' ' + t('nt_km', { km: num(dkm, 0) }) : '') + '</b><small>' + t('nt_model') + '</small>'
          + (d.morning ? '<button class="cta nt-morning">' + t('nt_morning_btn', { n: d.morning.agents.length.toLocaleString('ru-RU') }) + '</button>' : '');
        const mb = fin.querySelector('.nt-morning'); if (mb) mb.onclick = startMorning;
      } else fin.hidden = true;
      $('.nt-play').textContent = st.playing ? '❚❚' : (T >= d.end - 0.5 ? '↻' : '▶');
    }

    const kmCache = new WeakMap();
    function lineKm(line) {
      if (kmCache.has(line)) return kmCache.get(line);
      let s = 0;
      for (let i = 1; i < line.length; i++) { const dx = (line[i][0] - line[i - 1][0]) * 69.9, dy = (line[i][1] - line[i - 1][1]) * 111.3; s += Math.hypot(dx, dy); }
      kmCache.set(line, s);
      return s;
    }

    function firsts() {
      const run = st.data[st.mode];
      $('.nt-first').innerHTML = '<h4>' + t('nt_first') + '</h4><ol>' + run.firsts.slice(0, 5).map((f) => '<li><span>' + f.t + '</span><b>' + (f.name || t('r_noname')) + '</b><small>' + f.len + ' м' + (st.mode === 'ai' ? ' · ' + t('nt_saved', { n: num(f.saved, 1) }) : '') + '</small></li>').join('') + '</ol>';
    }

    function tick(now) {
      if (!st.on) return;
      const dt = st.last ? now - st.last : 0;
      st.last = now;
      if (st.phase === 'morning') {
        if (st.playing) { st.mT = Math.min(st.M.dur, st.mT + dt / MORN * st.M.dur); if (st.mT >= st.M.dur) st.playing = false; }
        morningTick();
        st.raf = requestAnimationFrame(tick);
        return;
      }
      if (st.playing) {
        const d = st.data, rate = st.T < d.deploy ? d.deploy / PRE : (d.end - d.deploy) / MAIN;
        st.T = Math.min(d.end, st.T + dt * rate);
        if (st.T >= st.data.end) { st.playing = false; clearTimeout(st.auto); st.auto = setTimeout(startMorning, 3500); }
      }
      draw();
      st.raf = requestAnimationFrame(tick);
    }

    function render() {
      box.innerHTML = '<div class="brain-head"><h3>' + t('nt_title') + '</h3><button class="x nt-x" aria-label="close"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
        + '<div class="nt-body"><div class="mk-tabs" role="tablist"><button role="tab" data-m="now">' + t('nt_now') + '</button><button role="tab" data-m="ai">' + t('nt_ai') + '</button></div>'
        + '<div class="nt-time"><button class="nt-play" aria-label="play"></button><div class="nt-clock"></div><div class="nt-temp"></div><div class="nt-ice"><i></i><b></b></div></div>'
        + '<div class="nt-prog"><i></i></div>'
        + '<div class="nt-kpi"><small>' + t('nt_inj') + '</small><div class="nt-big"></div><div class="nt-base"></div></div>'
        + '<p class="nt-stats"></p><p class="nt-phase"></p><div class="nt-fin" hidden></div><div class="nt-first"></div></div>';
      box.querySelector('.nt-x').onclick = () => api.close();
      box.querySelectorAll('.mk-tabs button').forEach((b) => { b.onclick = () => {
        st.mode = b.dataset.m; syncTabs(); firsts();
        if (st.phase === 'morning') { st.mainKey = st.mode; sandLayers(map(), st.mainKey); } else draw();
      }; });
      box.querySelector('.nt-play').onclick = () => {
        if (st.phase === 'morning') { if (st.mT >= st.M.dur - 0.01) st.mT = 0; st.playing = !st.playing; st.last = 0; return; }
        clearTimeout(st.auto);
        if (st.T >= st.data.end - 0.5) st.T = 0;
        st.playing = !st.playing; st.last = 0; hud();
      };
      box.querySelector('.nt-prog').onclick = (ev) => {
        const r = ev.currentTarget.getBoundingClientRect(), f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        if (st.phase === 'morning') { st.mT = f * st.M.dur; return; }
        clearTimeout(st.auto); st.T = f * st.data.end; draw();
      };
      syncTabs(); firsts();
    }
    function syncTabs() { box.querySelectorAll('.mk-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === st.mode))); }

    const api = {
      active: () => st.on,
      async open() {
        if (st.on) return;
        st.on = true;
        if (ctx.forceNight) ctx.forceNight(true);
        if (ctx.hideExtras) ctx.hideExtras(true, false);
        if (ctx.setWind) ctx.setWind(0.4);
        box.hidden = false;
        box.innerHTML = '<p class="empty" style="padding:18px">' + t('nt_loading') + '</p>';
        if (ctx.onOpen) ctx.onOpen();
        try { await load(); } catch (e) { box.innerHTML = '<p class="empty" style="padding:18px">' + t('nt_fail') + '</p>'; return; }
        if (!st.on) return;
        st.T = 0; st.mode = 'ai'; st.riskT = -1; st.drawnMode = null;
        render();
        const m = map();
        const mobile = window.innerWidth <= 760;
        m.flyTo({ center: [71.445, 51.14], zoom: mobile ? 10.6 : 11.4, pitch: 38, bearing: -8, duration: 1800, essential: true, padding: mobile ? { bottom: window.innerHeight * 0.42 } : { right: 420 } });
        st.playing = true; st.last = 0;
        cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(tick);
      },
      close() {
        if (!st.on) return;
        st.on = false; st.playing = false;
        clearTimeout(st.auto);
        cancelAnimationFrame(st.raf);
        stopMorning();
        grade(null);
        box.hidden = true;
        dropLayers();
        if (ctx.hideExtras) ctx.hideExtras(false, false);
        if (ctx.forceNight) ctx.forceNight(false);
        if (ctx.setWind) ctx.setWind(1);
        ctx.setRisk(null);
        if (ctx.onClose) ctx.onClose();
      },
      restyle() { if (st.on) { st.drawnMode = null; st.riskT = -1; } },
      relabel() { if (st.on && st.data) { render(); hud(); } },
    };
    return api;
  }

  window.BoranNight = { create };
})();
