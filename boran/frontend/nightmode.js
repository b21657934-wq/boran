(function () {
  const PRE = 6500, MAIN = 30000;
  const FC = (f) => ({ type: 'FeatureCollection', features: f || [] });

  function create(ctx) {
    const { map, t } = ctx;
    const st = { data: null, req: null, on: false, mode: 'ai', T: 0, playing: false, raf: 0, last: 0, riskT: -1 };
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
      ['nt-trucks', 'nt-trucks-halo', 'nt-depots', 'nt-trail', 'nt-sand', 'nt-sand-glow'].forEach((id) => { if (m.getLayer(id)) m.removeLayer(id); });
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
        fin.innerHTML = '<b>' + t('nt_result', { a: Math.round(a), b: Math.round(b), d: Math.round(a - b) }) + (dkm > 1 ? ' ' + t('nt_km', { km: num(dkm, 0) }) : '') + '</b><small>' + t('nt_model') + '</small>';
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
      if (st.playing) {
        const d = st.data, rate = st.T < d.deploy ? d.deploy / PRE : (d.end - d.deploy) / MAIN;
        st.T = Math.min(d.end, st.T + dt * rate);
        if (st.T >= st.data.end) st.playing = false;
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
      box.querySelectorAll('.mk-tabs button').forEach((b) => { b.onclick = () => { st.mode = b.dataset.m; syncTabs(); firsts(); draw(); }; });
      box.querySelector('.nt-play').onclick = () => {
        if (st.T >= st.data.end - 0.5) st.T = 0;
        st.playing = !st.playing; st.last = 0; hud();
      };
      box.querySelector('.nt-prog').onclick = (ev) => { const r = ev.currentTarget.getBoundingClientRect(); st.T = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * st.data.end; draw(); };
      syncTabs(); firsts();
    }
    function syncTabs() { box.querySelectorAll('.mk-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === st.mode))); }

    const api = {
      active: () => st.on,
      async open() {
        if (st.on) return;
        st.on = true;
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
        cancelAnimationFrame(st.raf);
        box.hidden = true;
        dropLayers();
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
