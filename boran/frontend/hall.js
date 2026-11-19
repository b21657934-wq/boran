(function () {
  const FC = (f) => ({ type: 'FeatureCollection', features: f || [] });
  const KCOL = { ice: '#FF5A5F', packed: '#FFB547', dry: '#4BE3A0' };
  const THINK = 2.5;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TRUCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 15V7h11v8M13 10h4l3 3v2h-1M2 15h2"/><circle cx="6.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/></svg>';
  const X = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const dev = (id) => { const m = /^u([a-z0-9]{4,8})\./.exec(id || ''); return m ? m[1] : id; };
  const clamp = (x) => Math.max(0, Math.min(1, x));

  function at(path, s) {
    const n = path.length - 1;
    if (n < 0) return null;
    if (s <= path[0][2]) return [path[0][0], path[0][1], 0];
    if (s >= path[n][2]) return [path[n][0], path[n][1], n];
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid][2] <= s) lo = mid; else hi = mid; }
    const a = path[lo], b = path[hi], k = b[2] > a[2] ? (s - a[2]) / (b[2] - a[2]) : 0;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, lo];
  }

  function create(ctx) {
    const t = ctx.t, map = ctx.map;
    const st = { on: false, phone: false, hall: null, feed: null, t0: 0, seen: new Set(), people: new Set(), marks: new Set(), done: new Set(), react: new Map(),
      labels: new Map(), trucks: new Map(), raf: 0, poll: 0, req: null, panelAt: 0, mine: [], pin: null, pick: null, lastSend: 0, sent: 0 };
    const $ = (sel) => document.querySelector(sel);

    function qrSvg(url) {
      if (!window.qrcode) return '';
      const q = window.qrcode(0, 'M');
      q.addData(url); q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: url });
    }

    function load(name, ok) {
      if (st.req) return;
      st.req = fetch(name + '?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) ok(d); }).catch(() => {}).finally(() => { st.req = null; });
    }

    function layers() {
      const m = map();
      if (!m || !m.isStyleLoaded()) return false;
      if (m.getSource('hl-sand')) return true;
      ['hl-sand', 'hl-plan', 'hl-trail', 'hl-marks', 'hl-ripple'].forEach((id) => m.addSource(id, { type: 'geojson', data: FC() }));
      m.addLayer({ id: 'hl-sand-glow', type: 'line', source: 'hl-sand', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2BD96B', 'line-blur': 8, 'line-opacity': ['*', 0.7, ['get', 'g']], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 30] } });
      m.addLayer({ id: 'hl-sand', type: 'line', source: 'hl-sand', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2BD96B', 'line-opacity': ['get', 'a'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 8] } });
      m.addLayer({ id: 'hl-plan-glow', type: 'line', source: 'hl-plan', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3FD0E0', 'line-blur': 6, 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 15, 16] } });
      m.addLayer({ id: 'hl-plan', type: 'line', source: 'hl-plan', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#9FE3FF', 'line-opacity': 0.75, 'line-dasharray': [1.2, 1.6], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5] } });
      m.addLayer({ id: 'hl-trail-glow', type: 'line', source: 'hl-trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFB547', 'line-blur': 6, 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 20] } });
      m.addLayer({ id: 'hl-trail', type: 'line', source: 'hl-trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFC14D', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 8] } });
      m.addLayer({ id: 'hl-ripple', type: 'circle', source: 'hl-ripple',
        paint: { 'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 3, 'circle-stroke-opacity': ['get', 'o'], 'circle-pitch-alignment': 'viewport' } });
      m.addLayer({ id: 'hl-marks', type: 'circle', source: 'hl-marks',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 15, 9], 'circle-color': ['get', 'c'], 'circle-opacity': ['get', 'o'],
          'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1.6, 'circle-pitch-alignment': 'viewport' } });
      return true;
    }

    function dropLayers() {
      const m = map();
      if (!m) return;
      ['hl-marks', 'hl-ripple', 'hl-trail', 'hl-trail-glow', 'hl-plan', 'hl-plan-glow', 'hl-sand', 'hl-sand-glow'].forEach((id) => { if (m.getLayer(id)) m.removeLayer(id); });
      ['hl-marks', 'hl-ripple', 'hl-trail', 'hl-plan', 'hl-sand'].forEach((id) => { if (m.getSource(id)) m.removeSource(id); });
      st.labels.forEach((L) => { if (L.mk) L.mk.remove(); if (L.beam) L.beam.remove(); }); st.labels.clear();
      st.trucks.forEach((T) => T.mk.remove()); st.trucks.clear();
    }

    function ingest(d) {
      st.hall = d;
      const fresh = ctx.now() - 6;
      d.feed.forEach((e) => {
        if (e.t < st.t0 - 120) return;
        st.marks.add(e.id); st.people.add(dev(e.id));
        if (!st.seen.has(e.id)) { st.seen.add(e.id); if (e.t >= fresh) st.labels.set(e.id, { e, born: Math.max(e.t, ctx.now() - 0.3), mk: null }); }
      });
      d.jobs.forEach((j) => {
        if (j.c < st.t0 - 120) return;
        if (!st.react.has(j.id)) st.react.set(j.id, Math.max(0, j.t1 - j.c - THINK));
      });
    }

    function jobOf(e) { return st.hall && e.job ? st.hall.jobs.find((j) => j.id === e.job) : null; }

    function line(o, props) { return { type: 'Feature', properties: props || {}, geometry: { type: 'LineString', coordinates: o } }; }
    function point(lon, lat, props) { return { type: 'Feature', properties: props || {}, geometry: { type: 'Point', coordinates: [lon, lat] } }; }

    function truckEl(id) {
      const el = document.createElement('div');
      el.className = 'hl-truck s-idle';
      el.innerHTML = TRUCK + '<b>' + id + '</b>';
      return el;
    }

    function setTruck(id, pos, state) {
      let T = st.trucks.get(id);
      if (!T) { const el = truckEl(id); T = { el, mk: new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(map()), s: 'idle' }; st.trucks.set(id, T); }
      T.mk.setLngLat(pos);
      if (T.s !== state) { T.s = state; T.el.className = 'hl-truck s-' + state; }
    }

    function labelHtml(e, j, T) {
      const k = t('r_' + e.k), nm = e.name ? ' · ' + esc(e.name) : '';
      const ab = { a: Math.round((e.pr ?? e.p) * 100), b: Math.round(e.p * 100) };
      if (e.act === 'wait') return '<b class="k-' + e.k + '">' + t('hl_ai', ab) + '</b><small>' + t('hl_wait_s') + '</small>';
      if (e.act === 'clear') return '<b class="k-dry">' + k + '</b><small>' + t('hl_clear') + '</small>';
      if (!j) return '<b class="k-' + e.k + '">' + k + nm + '</b>';
      if (T < j.t0) return '<b class="k-' + e.k + '">' + t('hl_ai', ab) + '</b><small>' + (j.q ? t('hl_q', { n: j.tr }) : t('hl_think')) + '</small>';
      if (T < j.t1) return '<b>' + TRUCK + ' ' + t('hl_eta', { n: j.tr, m: Math.max(1, Math.ceil((j.t1 - T) / st.hall.spm)) }) + '</b><small>' + k + nm + '</small>';
      if (T < j.t2) return '<b class="k-dry">' + t('hl_sanding', { n: j.tr }) + '</b><small>' + k + nm + '</small>';
      return '<b class="k-dry">✓ ' + t('hl_sanded') + '</b><small>' + k + nm + '</small>';
    }

    function drawLabels(T) {
      const m = map(), list = [...st.labels.entries()];
      list.forEach(([id, L], i) => {
        const j = jobOf(L.e);
        const end = j ? j.t2 + 5 : L.born + 9;
        const keep = T < end && i >= list.length - 8;
        if (!keep) { if (L.mk) L.mk.remove(); if (L.beam) L.beam.remove(); st.labels.delete(id); return; }
        if (!L.beam && T - L.e.t < 3) {
          const b = document.createElement('div'); b.innerHTML = '<div class="hl-beam k-' + L.e.k + '"></div>';
          L.beam = new maplibregl.Marker({ element: b, anchor: 'bottom' }).setLngLat([L.e.lon, L.e.lat]).addTo(m);
          setTimeout(() => { if (L.beam) { L.beam.remove(); L.beam = null; } }, 4200);
        }
        if (!L.mk) {
          const el = document.createElement('div'); el.innerHTML = '<div class="hl-lbl"></div>';
          L.el = el.firstChild; L.mk = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -12] }).setLngLat([L.e.lon, L.e.lat]).addTo(m);
        }
        const html = labelHtml(L.e, j, T);
        if (html !== L.html) { L.html = html; L.el.innerHTML = html; }
        L.el.style.opacity = String(clamp((end - T) / 1.2));
      });
    }

    function draw() {
      const m = map(), d = st.hall;
      if (!d) { if (performance.now() - st.panelAt > 500) { st.panelAt = performance.now(); panel(ctx.now(), 0); } return; }
      if (!layers()) { if (performance.now() - st.panelAt > 300) { st.panelAt = performance.now(); panel(ctx.now(), 0); } return; }
      const T = ctx.now();
      const plan = [], trail = [], sand = [], ripple = [], marks = [];
      const byTr = new Map();
      d.jobs.forEach((j) => { if (!byTr.has(j.tr)) byTr.set(j.tr, []); byTr.get(j.tr).push(j); });
      let road = 0;
      d.trucks.forEach(([id, lon, lat]) => {
        let pos = [lon, lat], state = 'idle';
        for (const j of byTr.get(id) || []) {
          if (T < j.t0) break;
          if (T < j.t1) { const q = at(j.path, T - j.t0); pos = [q[0], q[1]]; state = 'drive'; break; }
          pos = [j.lon, j.lat];
          if (T < j.t2) { state = 'sand'; break; }
        }
        if (state === 'drive') road += 1;
        setTruck(id, pos, state);
      });
      d.jobs.forEach((j) => {
        if (T >= j.c && T < j.t1 && j.path.length > 1) {
          const k = j.q ? 1 : clamp((T - j.c) / (THINK * 0.85));
          const from = Math.floor((1 - k) * (j.path.length - 1));
          const pts = j.path.slice(from).map((p) => [p[0], p[1]]);
          if (pts.length > 1) plan.push(line(pts));
        }
        if (T >= j.t0 && T < j.t1 + 2 && j.path.length > 1) {
          const q = at(j.path, T - j.t0);
          const tail = j.path.slice(0, q[2] + 1).filter((p) => p[2] >= T - j.t0 - 14).map((p) => [p[0], p[1]]);
          tail.push([q[0], q[1]]);
          if (tail.length > 1) trail.push(line(tail));
        }
        if (T >= j.t1) {
          const k = clamp((T - j.t1) / Math.max(0.5, j.t2 - j.t1));
          const g = T < j.t2 ? 0.55 + 0.45 * Math.sin((T - j.t1) * 6) : Math.max(0, 1 - (T - j.t2) / 3) * 0.6;
          j.sand.forEach((s) => sand.push(line(s, { a: 0.35 + 0.65 * k, g })));
          if (T >= j.t2 && j.c >= st.t0 - 120) st.done.add(j.id);
        }
      });
      d.feed.forEach((e) => {
        if (e.t < st.t0 - 600) return;
        const j = jobOf(e), sanded = j && T >= j.t2;
        marks.push(point(e.lon, e.lat, { c: sanded ? KCOL.dry : KCOL[e.k], o: e.act === 'wait' ? 0.55 : 1 }));
        const age = T - e.t;
        if (age >= 0 && age < 4.4) {
          [0, 0.6, 1.2].forEach((lag) => { const a = (age - lag) / 3; if (a > 0 && a < 1) ripple.push(point(e.lon, e.lat, { r: 8 + a * 110, o: (1 - a) * (1 - a), c: KCOL[e.k] })); });
        }
        if (j && T >= j.t1 && T < j.t1 + 1.6) { const a = (T - j.t1) / 1.6; ripple.push(point(j.lon, j.lat, { r: 8 + a * 46, o: 1 - a, c: KCOL.dry })); }
      });
      m.getSource('hl-plan').setData(FC(plan));
      m.getSource('hl-trail').setData(FC(trail));
      m.getSource('hl-sand').setData(FC(sand));
      m.getSource('hl-ripple').setData(FC(ripple));
      m.getSource('hl-marks').setData(FC(marks));
      drawLabels(T);
      if (performance.now() - st.panelAt > 300) { st.panelAt = performance.now(); panel(T, road); }
    }

    function ago(s) { s = Math.max(0, Math.round(s)); return s < 60 ? t('hl_s', { s }) : t('hl_m', { m: Math.round(s / 60) }); }

    function feedText(e, j, T) {
      if (e.act === 'wait') return t('hl_wait', { a: Math.round((e.pr ?? e.p) * 100), b: Math.round(e.p * 100) });
      if (e.act === 'clear') return t('hl_clear');
      if (!j) return '';
      const conf = e.with ? t('hl_conf', { a: Math.round(e.p0 * 100), b: Math.round(e.p * 100) }) + ' · ' : '';
      if (T < j.t1) return conf + (e.act === 'join' ? t('hl_join', { n: j.tr }) : t(j.q ? 'hl_go_q' : 'hl_go', { n: j.tr })) + ' · ' + t('hl_min', { m: Math.max(1, Math.ceil((j.t1 - T) / st.hall.spm)) });
      if (T < j.t2) return conf + t('hl_sanding', { n: j.tr });
      return conf + '✓ ' + t('hl_sanded_n', { n: j.tr, m: Math.max(1, Math.round((j.t1 - j.c - THINK) / st.hall.spm)) });
    }

    function panel(T, road) {
      const box = document.getElementById('hall');
      if (!box || box.hidden) return;
      const set = (k, v) => { const e = box.querySelector('.hl-k-' + k + ' b'); if (e && e.textContent !== String(v)) { e.textContent = v; e.parentNode.classList.remove('bump'); void e.parentNode.offsetWidth; e.parentNode.classList.add('bump'); } };
      set('people', st.people.size); set('marks', st.marks.size); set('road', road); set('done', st.done.size);
      const r = [...st.react.values()], spm = st.hall ? st.hall.spm : 1;
      box.querySelector('.hl-react').textContent = r.length ? t('hl_react', { m: Math.max(1, Math.round(r.reduce((a, b) => a + b, 0) / r.length / spm)) }) : t('hl_fast');
      const items = (st.hall ? st.hall.feed : []).filter((e) => e.t >= st.t0 - 600).slice(0, 9);
      const html = items.length ? items.map((e) => {
        const j = jobOf(e), txt = feedText(e, j, T), done = j && T >= j.t2;
        return '<li class="' + (done ? 'ok' : e.act) + '"><i style="background:' + (done ? KCOL.dry : KCOL[e.k]) + '"></i><div><b>' + t('r_' + e.k) + (e.name ? ' · ' + esc(e.name) : '') + '</b><small>' + txt + '</small></div><time>' + ago(T - e.t) + '</time></li>';
      }).join('') : '<li class="empty">' + t('hl_empty') + '</li>';
      const ol = box.querySelector('.hl-list');
      if (ol.innerHTML !== html) ol.innerHTML = html;
    }

    function renderScreen() {
      const box = document.getElementById('hall');
      const kpi = (k) => '<div class="hl-k hl-k-' + k + '"><b>0</b><small>' + t('hl_' + k) + '</small></div>';
      box.innerHTML = '<section class="hl-qr glass"><div class="hl-code">' + qrSvg(ctx.url()) + '</div>'
        + '<div class="hl-how"><h2>' + t('hl_qr_h') + '</h2><ol><li>' + t('hl_qr_1') + '</li><li>' + t('hl_qr_2') + '</li><li>' + t('hl_qr_3') + '</li></ol></div>'
        + '<div class="hl-kpis">' + kpi('people') + kpi('marks') + kpi('road') + kpi('done') + '</div><p class="hl-react"></p><p class="hl-note">' + t('hl_note') + '</p></section>'
        + '<section class="hl-feed glass"><div class="brain-head"><h3>' + t('hl_feed') + '</h3><button class="x hl-x" aria-label="close">' + X + '</button></div><ol class="hl-list"></ol></section>';
      box.querySelector('.hl-x').onclick = () => api.close();
      st.panelAt = 0;
    }

    function tick() {
      if (!st.on) return;
      try { if (st.phone) phoneTick(); else draw(); } catch (e) { }
      st.raf = requestAnimationFrame(tick);
    }

    function startPolling(name, every, ok) {
      clearInterval(st.poll);
      load(name, ok);
      st.poll = setInterval(() => { if (document.visibilityState === 'visible') load(name, ok); }, every);
    }

    function phoneSheet() {
      const box = document.getElementById('hallp');
      const mine = st.mine[0];
      let body = '';
      if (st.pick) {
        body = '<h2>' + t('hp_what') + '</h2><div class="hp-kinds">' + ['ice', 'packed', 'dry'].map((k) => '<button data-k="' + k + '" class="k-' + k + '"><i></i>' + t('r_' + k) + '</button>').join('') + '</div><button class="link hp-cancel">' + t('hp_cancel') + '</button>';
      } else if (mine) {
        body = '<div class="hp-status"></div><button class="cta hp-more">' + t('hp_more') + '</button>';
      } else {
        body = '<h2>' + t('hp_tap') + '</h2><p>' + t('hp_sub') + '</p>';
      }
      box.innerHTML = '<div class="hp-head"><b>' + t('hp_title') + '</b></div>' + body;
      box.querySelectorAll('.hp-kinds button').forEach((b) => { b.onclick = () => choose(b.dataset.k); });
      const c = box.querySelector('.hp-cancel'); if (c) c.onclick = () => { st.pick = null; if (st.pin) { st.pin.remove(); st.pin = null; } phoneSheet(); };
      const more = box.querySelector('.hp-more'); if (more) more.onclick = () => { st.mine = []; phoneSheet(); };
      st.stHtml = null;
      phoneTick();
    }

    function phoneStatus(T) {
      const mine = st.mine[0];
      const s = st.feed && st.feed.status ? st.feed.status[mine.id] : null;
      const spm = (st.feed && st.feed.spm) || 1;
      const k = '<span class="hp-kind k-' + mine.k + '"><i></i>' + t('r_' + mine.k) + '</span>';
      if (!s) return k + '<div class="hp-big"><span class="hp-spin"></span></div><p>' + t('hp_sent') + '</p>';
      const p = '<p class="hp-p">' + t('hp_p', { p: Math.round(s.p * 100) }) + '</p>';
      if (s.act === 'clear') return k + '<div class="hp-big ok">✓</div><p>' + t('hp_clear') + '</p>';
      if (s.act === 'wait') return k + '<div class="hp-big warn">' + Math.round(s.p * 100) + '%</div><p><b>' + t('hp_wait') + '</b></p><p>' + t('hp_wait2') + '</p>';
      if (T < s.t1) return k + p + '<p><b>' + t('hp_go', { n: s.tr }) + '</b></p><div class="hp-big">' + Math.max(1, Math.ceil((s.t1 - T) / spm)) + '<small>' + t('hp_min') + '</small></div><p class="hp-note">' + t('hl_note') + '</p>';
      if (T < s.t2) return k + p + '<div class="hp-big ok"><span class="hp-spin ok"></span></div><p><b>' + t('hp_here', { n: s.tr }) + '</b></p>';
      return k + p + '<div class="hp-big ok">✓</div><p><b>' + t('hp_done', { n: s.tr }) + '</b></p>';
    }

    function phoneTick() {
      if (!st.mine.length || st.pick) return;
      const box = document.querySelector('#hallp .hp-status');
      if (!box) return;
      const html = phoneStatus(ctx.now());
      if (html !== st.stHtml) { st.stHtml = html; box.innerHTML = html; }
    }

    function tap(lon, lat) {
      const m = map();
      if (!st.pin) { const el = document.createElement('div'); el.innerHTML = '<div class="hp-pin"></div>'; st.pin = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lon, lat]).addTo(m); }
      st.pin.setLngLat([lon, lat]);
      st.pick = { lon, lat };
      phoneSheet();
    }

    async function choose(k) {
      const p = st.pick;
      if (!p) return;
      if (st.sent >= 12) { ctx.toast(t('hp_limit')); return; }
      if (Date.now() - st.lastSend < 3000) { ctx.toast(t('hp_slow')); return; }
      st.lastSend = Date.now(); st.sent += 1;
      st.pick = null;
      if (st.pin) { st.pin.getElement().firstChild.className = 'hp-pin k-' + k; st.pin = null; }
      const id = await ctx.mark(k, p.lon, p.lat);
      st.mine.unshift({ id, k });
      phoneSheet();
      startPolling('feed.json', 1500, (d) => { st.feed = d; ctx.seen(Object.keys(d.status || {})); });
    }

    const api = {
      active: () => st.on && !st.phone,
      phoneOn: () => st.on && st.phone,
      open() {
        if (st.on) return;
        st.on = true; st.phone = false; st.t0 = ctx.now();
        st.seen = new Set(); st.people = new Set(); st.marks = new Set(); st.done = new Set(); st.react = new Map();
        if (ctx.onOpen) ctx.onOpen();
        if (ctx.forceNight) ctx.forceNight(true);
        if (ctx.hideExtras) ctx.hideExtras(true, /^b-(warm|marks|points|route|short|ride|runner|wave|cmp)/);
        if (ctx.setWind) ctx.setWind(0.5);
        document.body.classList.add('hallshow');
        const box = document.getElementById('hall');
        box.hidden = false;
        renderScreen();
        const m = map(), mobile = window.innerWidth <= 760;
        m.flyTo({ center: [71.445, 51.138], zoom: mobile ? 10.4 : 11.35, pitch: 34, bearing: -6, duration: 1800, essential: true,
          padding: mobile ? { top: 0, bottom: window.innerHeight * 0.45, left: 0, right: 0 } : { left: 380, right: 380, top: 0, bottom: 0 } });
        startPolling('hall.json', 1200, ingest);
        if (ctx.fastReports) ctx.fastReports(true);
        cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(tick);
      },
      openPhone() {
        st.on = true; st.phone = true;
        document.body.classList.add('hallphone');
        const box = document.getElementById('hallp');
        box.hidden = false;
        phoneSheet();
        const m = map();
        m.jumpTo({ center: [71.43, 51.128], zoom: 12.2, pitch: 0, bearing: 0 });
        cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(tick);
      },
      tap,
      close() {
        if (!st.on || st.phone) return;
        st.on = false;
        clearInterval(st.poll);
        cancelAnimationFrame(st.raf);
        document.getElementById('hall').hidden = true;
        document.body.classList.remove('hallshow');
        dropLayers();
        const m = map();
        if (m) m.easeTo({ padding: { left: 0, right: 0, top: 0, bottom: 0 }, duration: 0 });
        if (ctx.fastReports) ctx.fastReports(false);
        if (ctx.hideExtras) ctx.hideExtras(false);
        if (ctx.forceNight) ctx.forceNight(false);
        if (ctx.setWind) ctx.setWind(1);
        if (ctx.onClose) ctx.onClose();
      },
      restyle() { if (st.on && !st.phone) { const m = map(); if (m && !m.getSource('hl-sand')) layers(); } },
      relabel() { if (!st.on) return; if (st.phone) phoneSheet(); else { renderScreen(); } },
    };
    return api;
  }

  window.BoranHall = { create };
})();
