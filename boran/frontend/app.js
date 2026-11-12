(function () {
  const D = window.deck;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  };
  const STATE_COL = { dry: '#7C8DB5', wet: '#4FA3FF', snow: '#DDEBFF', packed: '#FFB547', ice: '#FF5A5F' };
  const LANGS = ['ru', 'kk', 'en'];

  const S = {
    args: null, city: null, cityVersion: null, lang: store.get('boran.lang', 'ru'), themeForce: null,
    src: null, dst: null, picking: null, markMode: false, n: 0, pendingRoute: false,
    routeKey: null, routeT0: 0, waveT0: 0, view: null, riskVersion: 0, risk: null,
    marks: store.get('boran.marks', []), splashDone: false, introDone: false, t0: performance.now(),
  };
  const t = (k, vars) => { let s = (window.I18N[S.lang] || window.I18N.ru)[k]; if (s == null) s = window.I18N.ru[k] ?? k; if (vars) for (const a in vars) s = s.split('{' + a + '}').join(vars[a]); return s; };
  const num = (v, d = 0) => Number(v).toFixed(d).replace('-', '−');
  const isNight = () => (S.themeForce ? S.themeForce === 'night' : !S.args || S.args.weather.night !== false);

  function post(type, extra) { window.parent.postMessage(Object.assign({ isStreamlitMessage: true, type }, extra), '*'); }
  function send() {
    S.n += 1;
    post('streamlit:setComponentValue', {
      dataType: 'json',
      value: { n: S.n, scenario: S.scenario || 'live', src: S.wantRoute && S.src ? [S.src.lon, S.src.lat] : null, dst: S.wantRoute && S.dst ? [S.dst.lon, S.dst.lat] : null },
    });
  }
  window.addEventListener('message', (e) => { if (e.data && e.data.type === 'streamlit:render') onRender(e.data.args.payload); });
  post('streamlit:componentReady', { apiVersion: 1 });
  post('streamlit:setFrameHeight', { height: 900 });

  async function onRender(args) {
    const first = !S.args;
    S.args = args;
    S.scenario = args.scenario;
    if (first) {
      const places = args.places;
      const P = (id) => { const p = places.find((q) => q.id === id); return { id, lon: p.lon, lat: p.lat }; };
      S.src = P('dorm'); S.dst = P('campus');
    }
    if (S.cityVersion !== args.cityVersion) {
      S.cityVersion = args.cityVersion;
      S.city = args.city || await fetch('city.json?v=' + args.cityVersion).then((r) => r.json());
      S.city.edges.forEach((e, i) => { const m = e.p[e.p.length >> 1]; e.c = m; e.i = i; });
      initDeck();
    }
    S.risk = args.risk; S.riskVersion += 1;
    document.body.classList.toggle('night', isNight());
    document.body.classList.toggle('day', !isNight());
    renderAll();
    const key = args.route ? JSON.stringify([args.route.src, args.route.dst, args.scenario]) : null;
    if (key !== S.routeKey) {
      S.routeKey = key;
      if (args.route) { S.waveT0 = performance.now(); S.routeT0 = S.waveT0 + 900; fitRoute(args.route); $('panel').classList.remove('min'); }
    }
    S.pendingRoute = false; $('btn-go').classList.remove('busy');
    if (first) startSplash();
  }

  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  function riskColor(r, alpha) {
    const ok = [75, 227, 160], warn = [255, 181, 71], bad = [255, 90, 95];
    const c = r < 0.4 ? mix(ok, warn, r / 0.4) : mix(warn, bad, Math.min(1, (r - 0.4) / 0.35));
    return [c[0], c[1], c[2], alpha];
  }

  let deckgl = null;
  const VIEW0 = { longitude: 71.4305, latitude: 51.1283, zoom: 14.3, pitch: 58, bearing: -35, maxPitch: 75, minZoom: 11.5, maxZoom: 18 };
  function setView(v) { S.view = Object.assign({}, S.view || VIEW0, v); deckgl.setProps({ initialViewState: Object.assign({}, S.view) }); }
  function initDeck() {
    if (deckgl) { deckgl.finalize(); $('map').innerHTML = ''; }
    S.view = Object.assign({}, VIEW0);
    deckgl = new D.Deck({
      parent: $('map'), views: new D.MapView({ repeat: false, farZMultiplier: 2.2 }), initialViewState: S.view,
      controller: { dragRotate: true, touchRotate: true, inertia: 300 }, pickingRadius: 6,
      getCursor: ({ isDragging }) => (isDragging ? 'grabbing' : S.picking || S.markMode ? 'crosshair' : 'grab'),
      onViewStateChange: ({ viewState }) => { S.live = viewState; },
      onClick: onMapClick, layers: [],
    });
    S.live = S.view;
    requestAnimationFrame(frame);
  }

  function lighting() {
    const night = isNight();
    return new D.LightingEffect({
      ambient: new D.AmbientLight({ color: night ? [150, 175, 255] : [255, 255, 255], intensity: night ? 1.25 : 2.1 }),
      key: new D.DirectionalLight({ color: night ? [160, 190, 255] : [255, 244, 225], intensity: night ? 1.0 : 1.9, direction: [-3, -2, -4] }),
      rim: new D.DirectionalLight({ color: night ? [255, 170, 110] : [200, 220, 255], intensity: night ? 0.5 : 0.5, direction: [4, 3, -2] }),
    });
  }

  let lightKey = null, lightFx = null;
  function buildLayers(now) {
    const c = S.city, a = S.args, night = isNight();
    const sec = (now - S.t0) / 1000;
    const lk = night ? 'n' : 'd';
    if (lightKey !== lk) { lightKey = lk; lightFx = [lighting()]; deckgl.setProps({ effects: lightFx }); }
    const [s, w, n, e] = c.bbox;
    const pad = 0.05;
    const L = [];
    L.push(new D.PolygonLayer({ id: 'ground', data: [[[w - pad, s - pad], [e + pad, s - pad], [e + pad, n + pad], [w - pad, n + pad]]], getPolygon: (d) => d, getFillColor: night ? [9, 14, 30] : [226, 236, 247], stroked: false, material: false, updateTriggers: { getFillColor: lk } }));
    L.push(new D.PathLayer({ id: 'river', data: c.water.lines, getPath: (d) => d, getColor: night ? [22, 48, 92] : [150, 190, 230], getWidth: 85, widthUnits: 'meters', capRounded: true, jointRounded: true, updateTriggers: { getColor: lk } }));
    L.push(new D.PathLayer({ id: 'river-ice', data: c.water.lines, getPath: (d) => d, getColor: night ? [70, 120, 180, 70] : [255, 255, 255, 150], getWidth: 48, widthUnits: 'meters', capRounded: true, jointRounded: true, updateTriggers: { getColor: lk } }));
    L.push(new D.PolygonLayer({ id: 'lakes', data: c.water.polys, getPolygon: (d) => d, getFillColor: night ? [22, 48, 92] : [150, 190, 230], stroked: false, material: false, updateTriggers: { getFillColor: lk } }));
    const rv = S.riskVersion + lk;
    L.push(new D.PathLayer({
      id: 'risk-glow', data: c.edges, getPath: (d) => d.p, getColor: (d) => riskColor(S.risk[d.i] / 100, S.risk[d.i] > 42 ? (night ? 46 : 60) : 0),
      getWidth: (d) => (d.b ? 30 : 20), widthUnits: 'meters', widthMinPixels: 3, capRounded: true, jointRounded: true,
      updateTriggers: { getColor: rv }, transitions: { getColor: 700 }, parameters: { depthTest: false },
    }));
    L.push(new D.PathLayer({
      id: 'risk', data: c.edges, getPath: (d) => d.p, getColor: (d) => riskColor(S.risk[d.i] / 100, night ? 215 : 235),
      getWidth: (d) => (d.b ? 9 : 5), widthUnits: 'meters', widthMinPixels: 1.2, capRounded: true, jointRounded: true, pickable: false,
      updateTriggers: { getColor: rv }, transitions: { getColor: 700 }, parameters: { depthTest: false },
    }));
    L.push(new D.ScatterplotLayer({
      id: 'warm', data: c.warm, getPosition: (d) => [d.lon, d.lat, 2], getRadius: (d) => (d.kind === 'mall' ? 60 : 22) * (1 + 0.25 * Math.sin(sec * 2.2 + d.lon * 9000)),
      getFillColor: (d) => [255, 180, 107, d.kind === 'mall' ? 70 : 60], radiusUnits: 'meters', radiusMinPixels: 2, stroked: true, getLineColor: [255, 190, 120, 200], lineWidthMinPixels: 1,
      updateTriggers: { getRadius: Math.floor(sec * 20) }, parameters: { depthTest: false },
    }));
    L.push(new D.PolygonLayer({
      id: 'buildings', data: c.buildings, getPolygon: (d) => d.p, extruded: true, getElevation: (d) => d.h, wireframe: false,
      getFillColor: (d, { index }) => {
        const k = Math.min(1, d.h / 90);
        if (!night) return mix([222, 231, 243], [196, 210, 230], k).concat(255);
        if (index % 9 === 0) return [48, 37, 36, 255];
        return mix([17, 24, 48], [30, 44, 86], k).concat(255);
      },
      material: { ambient: 0.4, diffuse: 0.65, shininess: 24, specularColor: night ? [70, 90, 150] : [255, 255, 255] }, updateTriggers: { getFillColor: lk },
    }));
    const r = a.route;
    if (r) {
      const waveK = Math.max(0, Math.min(1, (now - S.waveT0) / 900));
      const wave = (r.transit ? r.transit.wave : r.wave) || [];
      const fade = Math.max(0, 1 - Math.max(0, now - S.waveT0 - 900) / 1100);
      if (fade > 0) {
        L.push(new D.ScatterplotLayer({
          id: 'wave', data: wave.slice(0, Math.ceil(wave.length * waveK)), getPosition: (d) => [d[0], d[1], 3], getRadius: 5, radiusUnits: 'pixels',
          getFillColor: [159, 227, 255, Math.round(190 * fade)], parameters: { depthTest: false },
        }));
      }
      const drawK = Math.max(0, Math.min(1, (now - S.routeT0) / 1700));
      const shortLines = r.transit ? r.transit.short_legs : [r.short.line];
      const safeLines = r.transit ? r.transit.legs : [r.safe.line];
      L.push(new D.PathLayer({
        id: 'short', data: shortLines, getPath: (d) => d, getColor: night ? [255, 255, 255, Math.round(170 * drawK)] : [40, 60, 100, Math.round(200 * drawK)], getWidth: 2.5, widthUnits: 'pixels',
        getDashArray: [5, 4], dashJustified: true, extensions: [new D.PathStyleExtension({ dash: true })], parameters: { depthTest: false }, updateTriggers: { getColor: [drawK, lk] },
      }));
      const trips = safeLines.map((line) => {
        let acc = 0; const ts = [0];
        for (let i = 1; i < line.length; i++) { acc += Math.hypot((line[i][0] - line[i - 1][0]) * 0.63, line[i][1] - line[i - 1][1]); ts.push(acc); }
        return { path: line, ts: ts.map((v) => v / (acc || 1)) };
      });
      const col = night ? [159, 227, 255] : [14, 143, 163];
      L.push(new D.TripsLayer({ id: 'safe-glow', data: trips, getPath: (d) => d.path, getTimestamps: (d) => d.ts, getColor: col, opacity: 0.22, widthMinPixels: 16, capRounded: true, jointRounded: true, trailLength: 2, fadeTrail: false, currentTime: drawK, parameters: { depthTest: false } }));
      L.push(new D.TripsLayer({ id: 'safe', data: trips, getPath: (d) => d.path, getTimestamps: (d) => d.ts, getColor: night ? [225, 247, 255] : [14, 143, 163], opacity: 1, widthMinPixels: 5, capRounded: true, jointRounded: true, trailLength: 2, fadeTrail: false, currentTime: drawK, parameters: { depthTest: false } }));
      if (drawK >= 1) {
        L.push(new D.TripsLayer({ id: 'safe-pulse', data: trips, getPath: (d) => d.path, getTimestamps: (d) => d.ts, getColor: [255, 255, 255], opacity: 0.95, widthMinPixels: 7, capRounded: true, jointRounded: true, trailLength: 0.14, fadeTrail: true, currentTime: (sec * 0.32) % 1.2, parameters: { depthTest: false } }));
      }
      if (r.transit) {
        L.push(new D.ArcLayer({ id: 'ride', data: [r.transit.ride], getSourcePosition: (d) => d[0], getTargetPosition: (d) => d[1], getSourceColor: [159, 227, 255, Math.round(230 * drawK)], getTargetColor: [255, 180, 107, Math.round(230 * drawK)], getWidth: 4, getHeight: 0.28, greatCircle: false, updateTriggers: { getSourceColor: drawK, getTargetColor: drawK } }));
        L.push(new D.ScatterplotLayer({ id: 'ride-stops', data: r.transit.stops, getPosition: (d) => [d.lon, d.lat, 4], getRadius: 7, radiusUnits: 'pixels', getFillColor: [10, 16, 38], stroked: true, getLineColor: [159, 227, 255], lineWidthMinPixels: 2.5, parameters: { depthTest: false } }));
      }
      if (r.bayes && r.bayes.at) {
        const pulse = 1 + 0.35 * Math.sin(sec * 3);
        L.push(new D.ScatterplotLayer({ id: 'worst', data: [r.bayes.at], getPosition: (d) => [d[0], d[1], 5], getRadius: 16 * pulse, radiusUnits: 'pixels', filled: false, stroked: true, getLineColor: [255, 90, 95, 230], lineWidthMinPixels: 2, parameters: { depthTest: false }, updateTriggers: { getRadius: sec } }));
      }
    }
    const ends = [];
    if (S.src) ends.push({ p: [S.src.lon, S.src.lat], c: [159, 227, 255] });
    if (S.dst) ends.push({ p: [S.dst.lon, S.dst.lat], c: [255, 180, 107] });
    L.push(new D.ScatterplotLayer({ id: 'ends-halo', data: ends, getPosition: (d) => [d.p[0], d.p[1], 6], getRadius: 20 + 4 * Math.sin(sec * 2.4), radiusUnits: 'pixels', getFillColor: (d) => d.c.concat(50), parameters: { depthTest: false }, updateTriggers: { getRadius: sec } }));
    L.push(new D.ScatterplotLayer({ id: 'ends', data: ends, getPosition: (d) => [d.p[0], d.p[1], 6], getRadius: 8, radiusUnits: 'pixels', getFillColor: night ? [8, 13, 30] : [255, 255, 255], stroked: true, getLineColor: (d) => d.c, lineWidthMinPixels: 3.5, parameters: { depthTest: false }, updateTriggers: { getFillColor: lk } }));
    if (S.marks.length) {
      const mc = { ice: [255, 90, 95], packed: [255, 181, 71], dry: [75, 227, 160] };
      L.push(new D.ScatterplotLayer({ id: 'marks', data: S.marks, getPosition: (d) => [d.lon, d.lat, 7], getRadius: 6, radiusUnits: 'pixels', getFillColor: (d) => mc[d.actual], stroked: true, getLineColor: [255, 255, 255], lineWidthMinPixels: 1.5, parameters: { depthTest: false } }));
    }
    const labels = a.places.map((p) => ({ p: [p.lon, p.lat], text: p.name[S.lang] || p.name.ru, big: p.kind !== 'landmark' }));
    L.push(new D.TextLayer({
      id: 'labels', data: labels, getPosition: (d) => [d.p[0], d.p[1], 60], getText: (d) => d.text, getSize: (d) => (d.big ? 13 : 12), fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, characterSet: 'auto',
      getColor: night ? [238, 243, 255] : [16, 27, 54], background: true, getBackgroundColor: night ? [12, 19, 42, 215] : [255, 255, 255, 225], backgroundPadding: [9, 5, 9, 5], getBorderColor: night ? [159, 227, 255, 90] : [20, 40, 80, 40], getBorderWidth: 1,
      getPixelOffset: [0, -30], parameters: { depthTest: false }, updateTriggers: { getText: S.lang, getColor: lk, getBackgroundColor: lk, getBorderColor: lk }, fontSettings: { sdf: false, fontSize: 48, buffer: 6 },
    }));
    return L;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!deckgl || !S.city || !S.args || document.hidden) return;
    deckgl.setProps({ layers: buildLayers(now) });
    drawSnow(now);
  }

  const snow = { cv: $('snow'), ctx: $('snow').getContext('2d'), parts: [], w: 0, h: 0, last: 0 };
  function sizeSnow() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    snow.w = window.innerWidth; snow.h = window.innerHeight;
    snow.cv.width = snow.w * dpr; snow.cv.height = snow.h * dpr;
    snow.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', sizeSnow); sizeSnow();
  function drawSnow(now) {
    const dt = Math.min(0.05, (now - (snow.last || now)) / 1000); snow.last = now;
    const wx = S.args.weather.now;
    const cold = wx.temp < 2;
    const target = !cold ? 0 : Math.round((40 + Math.min(1, wx.snow / 2) * 520 + Math.min(1, wx.wind / 18) * 160) * Math.min(1.4, (snow.w * snow.h) / 900000 + 0.45));
    while (snow.parts.length < target) snow.parts.push({ x: Math.random() * snow.w, y: Math.random() * snow.h, z: 0.35 + Math.random() * 0.65, ph: Math.random() * 6.28 });
    if (snow.parts.length > target) snow.parts.length = target;
    const bearing = ((S.live && S.live.bearing) || 0) * Math.PI / 180;
    const dir = Math.sin((wx.wdir + 180) * Math.PI / 180 - bearing);
    const vx = dir * wx.wind * 26 + (dir >= 0 ? 12 : -12), vy = 70 + wx.snow * 30 + wx.wind * 5;
    const streak = Math.min(1, Math.max(0, (wx.wind - 7) / 9));
    const g = snow.ctx;
    g.clearRect(0, 0, snow.w, snow.h);
    g.strokeStyle = g.fillStyle = isNight() ? 'rgba(235,245,255,.85)' : 'rgba(255,255,255,.95)';
    g.lineCap = 'round';
    if (!isNight()) { g.shadowColor = 'rgba(40,70,120,.35)'; g.shadowBlur = 2; } else { g.shadowBlur = 0; }
    for (const p of snow.parts) {
      const sx = vx * p.z + Math.sin(now / 900 + p.ph) * 10, sy = vy * p.z;
      p.x += sx * dt; p.y += sy * dt;
      if (p.y > snow.h + 10) { p.y = -10; p.x = Math.random() * snow.w; }
      if (p.x > snow.w + 20) p.x = -20; else if (p.x < -20) p.x = snow.w + 20;
      g.globalAlpha = 0.35 + 0.6 * p.z;
      if (streak > 0.05) {
        const k = 0.018 + streak * 0.03;
        g.lineWidth = 0.8 + p.z * 1.1;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - sx * k, p.y - sy * k); g.stroke();
      } else {
        g.beginPath(); g.arc(p.x, p.y, 0.8 + p.z * 1.5, 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1;
    const sev = Math.min(1, wx.wind / 18) * 0.6 + Math.min(1, wx.snow / 2) * 0.4 + (wx.temp < -25 ? 0.35 : 0);
    $('frost').style.opacity = cold ? Math.min(0.9, 0.15 + sev * 0.8).toFixed(2) : '0';
  }

  function placeName(p) {
    if (!p) return '—';
    if (p.id) { const q = S.args.places.find((x) => x.id === p.id); if (q) return q.name[S.lang] || q.name.ru; }
    return p.label || t('mappoint');
  }

  function renderAll() {
    const a = S.args, wx = a.weather, now = wx.now;
    document.documentElement.lang = S.lang === 'kk' ? 'kk' : S.lang;
    $('t-brain').textContent = t('brain'); $('t-scn').textContent = t('scn'); $('t-from').textContent = t('from'); $('t-to').textContent = t('to');
    $('t-build').textContent = t('build'); $('t-legend').textContent = t('legend'); $('t-leg-lo').textContent = t('lo'); $('t-leg-hi').textContent = t('hi');
    $('t-brain-title').textContent = t('brain'); $('t-marks-title').textContent = t('m_title'); $('btn-lang').textContent = t('code');
    $('btn-brain').setAttribute('aria-label', t('brain')); $('btn-scn').setAttribute('aria-label', t('scn')); $('btn-ice').setAttribute('aria-label', t('m_title'));
    $('wx-t').textContent = num(Math.round(now.temp));
    const live = wx.source === 'live';
    $('wx-src').textContent = live ? t('live') : t('scn_' + wx.source);
    $('wx-src').classList.toggle('scn', !live);
    $('wx-feel').textContent = t('feels', { v: num(Math.round(now.apparent)) });
    $('wx-wind').textContent = num(now.wind, 0) + ' ' + t('ms');
    $('wx-snow').textContent = num(now.snow, 1) + ' ' + t('mmh');
    $('wx-hum').textContent = num(now.hum, 0) + '%';
    $('wx-arrow').style.transform = 'rotate(' + (now.wdir + 180) + 'deg)';
    spark(wx);
    const h = a.hmm, top = h.now.indexOf(Math.max(...h.now)), sn = h.states[top];
    $('wx-state').innerHTML = '<i style="background:' + STATE_COL[sn] + '"></i>' + t('state_line', { s: '<b>' + t('st_' + sn) + '</b>', p: Math.round(h.now[top] * 100) });
    const badge = S.city && S.city.demo ? t('demo') : wx.fallback ? t('wxfall') : '';
    $('badge').hidden = !badge; $('badge').textContent = badge;
    $('src-name').textContent = placeName(S.src); $('dst-name').textContent = placeName(S.dst);
    $('slot-src').classList.toggle('on', S.picking === 'src'); $('slot-dst').classList.toggle('on', S.picking === 'dst');
    if ($('sp-sub')) $('sp-sub').textContent = t('sp', { t: num(Math.round(now.temp)) });
    renderResult();
    if (!$('brain').hidden) renderBrain();
    if (!$('marks').hidden) renderMarks();
  }

  function spark(wx) {
    const all = wx.past.concat(wx.ahead), n = all.length, np = wx.past.length;
    const ts = all.map((h) => h.temp);
    let lo = Math.min(...ts), hi = Math.max(...ts);
    if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
    const X = (i) => 4 + (i / (n - 1)) * 232, Y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * 30;
    const d = (arr, off) => arr.map((v, i) => (i ? 'L' : 'M') + X(i + off).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    let s = '<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ice)" stop-opacity=".35"/><stop offset="1" stop-color="var(--ice)" stop-opacity="0"/></linearGradient></defs>';
    if (lo < 0 && hi > 0) s += '<line x1="4" x2="236" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--warn)" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/><text x="236" y="' + (Y(0) - 3) + '" text-anchor="end" font-size="8" fill="var(--warn)" font-family="Inter">0°</text>';
    s += '<path d="' + d(ts.slice(0, np), 0) + ' L' + X(np - 1) + ' 44 L4 44 Z" fill="url(#sg)"/>';
    s += '<path d="' + d(ts.slice(0, np), 0) + '" fill="none" stroke="var(--ice)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    s += '<path d="' + d(ts.slice(np - 1), np - 1) + '" fill="none" stroke="var(--t3)" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round"/>';
    s += '<circle cx="' + X(np - 1) + '" cy="' + Y(ts[np - 1]) + '" r="3.5" fill="var(--bg0)" stroke="var(--ice)" stroke-width="2"/>';
    s += '<text x="4" y="45" font-size="8" fill="var(--t3)" font-family="Inter">' + all[0].time + '</text><text x="' + X(np - 1) + '" y="45" text-anchor="middle" font-size="8" fill="var(--t2)" font-family="Inter">' + all[np - 1].time + '</text>';
    $('wx-spark').innerHTML = s;
  }

  function renderResult() {
    const r = S.args.route, box = $('result');
    if (!r || !S.wantRoute) { box.hidden = true; return; }
    box.hidden = false;
    const m = r.mdp, now = S.args.weather.now, best = m.best;
    const adv = $('advice'); adv.className = 'advice ' + best;
    $('adv-eyebrow').textContent = t('eyebrow');
    $('adv-title').textContent = t('a_' + best);
    let why;
    if (best === 'go') why = t('w_go', { m: num(r.safe.minutes), r: num(r.safe.fall * 100, 1) });
    else if (best === 'wait') { const idx = ['calm', 'snow', 'blizzard'].indexOf(m.level); const p = m.trans.slice(0, idx).reduce((x, y) => x + y, 0); why = t('w_wait', { p: Math.round(p * 100) }); }
    else if (r.transit) why = t('w_transit_long', { km: num(r.safe.length / 1000, 1), m: num(r.safe.minutes), t: num(Math.round(now.apparent)), tm: num(r.transit.total_min) });
    else why = t('w_transit_cold', { t: num(Math.round(now.apparent)), m: num(r.safe.minutes) });
    $('adv-why').textContent = why;
    const cmp = $('compare'); cmp.innerHTML = '';
    const A = r.transit ? r.transit.walk : r.safe, B = r.transit ? r.transit.short_walk : r.short;
    const dm = A.minutes - B.minutes, k = B.fall > 0 && A.fall > 0 ? B.fall / A.fall : 1;
    const head = el('div', 'cmp-head');
    head.innerHTML = (k > 1.04 ? t('c_head', { dm: num(Math.max(0, dm), 1), k: '<b>' + num(k, 1) + '</b>' }) : t('c_same')) + (A.warm ? ' · ' + t('c_warm', { w: A.warm }) : '');
    cmp.append(head);
    if (r.transit) {
      const legs = el('div', 'legs');
      legs.innerHTML = '<span>' + t('walk') + ' <b>' + num(r.transit.walk.minutes) + '</b></span><span class="sep">→</span><span>' + t('wait') + ' <b>' + num(r.transit.wait_min) + '</b></span><span class="sep">→</span><span>' + t('bus') + ' <b>' + num(r.transit.ride_min) + '</b></span><span class="sep">=</span><span>' + t('total') + ' <b>' + num(r.transit.total_min) + ' ' + t('min') + '</b></span>';
      cmp.append(legs);
    }
    const grid = el('div', 'cmp');
    const cell = (cls, name, x) => '<div><div class="k"><i class="' + cls + '"></i>' + name + '</div><div class="v">' + num(x.minutes) + ' <small>' + t('min') + ' · ' + num(x.length / 1000, 1) + ' ' + t('km') + '</small></div><div class="r">' + t('risk') + ' <b>' + num(x.fall * 100, 1) + '%</b></div></div>';
    grid.innerHTML = cell('', t('safe') + (r.transit ? ' · ' + t('walk') : ''), A) + cell('s', t('short') + (r.transit ? ' · ' + t('walk') : ''), B);
    cmp.append(grid);
    if (r.transit) cmp.append(el('div', 'note', t('t_note')));
    $('btn-why').innerHTML = t('how') + ' <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>';
  }

  function hmmViz(h) {
    const n = h.beliefs.length, W = 340, H = 96, bw = W / n;
    let s = '<svg class="viz" viewBox="0 0 ' + W + ' ' + (H + 34) + '" role="img">';
    h.beliefs.forEach((b, i) => {
      let y = 0;
      b.forEach((p, j) => { const hh = p * H; s += '<rect x="' + (i * bw + 1.5) + '" y="' + y.toFixed(1) + '" width="' + (bw - 3) + '" height="' + Math.max(0, hh - 0.6).toFixed(1) + '" rx="2" fill="' + STATE_COL[h.states[j]] + '"/>'; y += hh; });
      s += '<rect x="' + (i * bw + 1.5) + '" y="' + (H + 6) + '" width="' + (bw - 3) + '" height="9" rx="3" fill="' + STATE_COL[h.states[h.viterbi[i]]] + '"/>';
      if (i % 3 === 0 || i === n - 1) s += '<text x="' + (i * bw + bw / 2) + '" y="' + (H + 28) + '" text-anchor="middle" font-size="9" fill="var(--t3)" font-family="Inter">' + h.times[i] + '</text>';
    });
    s += '</svg><div class="keyline">' + h.states.map((x) => '<span><i style="background:' + STATE_COL[x] + '"></i>' + t('st_' + x) + '</span>').join('') + '<span style="margin-left:auto;color:var(--t3)">▬ ' + t('s1vit') + '</span></div>';
    return s;
  }

  function renderBrain() {
    const a = S.args, h = a.hmm, r = S.wantRoute ? a.route : null, body = $('brain-body');
    const step = (n, title, algo, inner) => '<section class="step"><div class="step-h"><span class="step-n">' + n + '</span><div><small>' + algo + '</small><b>' + title + '</b></div></div>' + inner + '</section>';
    const io = (rows) => '<dl class="io">' + rows.map(([k, v]) => '<dt>' + t(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>';
    const order = h.now.map((p, i) => [p, i]).sort((x, y) => y[0] - x[0]).slice(0, 3);
    const lastObs = h.obs.slice(-4).map((o) => t('ob_' + h.obs_names[o])).join(' → ');
    let html = step(1, t('s1'), t('s1a'), io([
      ['in', t('s1in', { n: h.obs.length }) + '<br><span style="color:var(--t3)">… ' + lastObs + '</span>'],
      ['calc', t('s1calc', { lp: num(h.logp, 2) })],
      ['out', order.map(([p, i]) => '<b>' + t('st_' + h.states[i]) + ' ' + Math.round(p * 100) + '%</b>').join(' · ')],
    ]) + hmmViz(h) + '<p class="say">' + t('s1say') + '</p>');
    if (r && r.bayes) {
      const b = r.bayes;
      const facts = b.steps.map((s) => '<div class="fact"><span class="tick ' + (s.present ? 'y' : '') + '">' + (s.present ? '✓' : '–') + '</span><span style="color:' + (s.present ? 'var(--t1)' : 'var(--t3)') + '">' + t('f_' + s.feature) + '</span><span class="p">' + num(s.after, 2) + '</span></div>').join('');
      html += step(2, t('s2'), t('s2a'), io([['in', t('s2in', { p: '<b>' + num(b.prior, 2) + '</b>' })]]) + facts + '<div class="fact"><div class="bar" style="--w:' + (100 / Math.max(0.05, b.posterior)).toFixed(0) + '%"><i style="width:' + (b.posterior * 100).toFixed(0) + '%"></i></div></div>' + io([['out', '<b>' + t('s2out', { q: num(b.posterior, 2) }) + '</b>']]) + '<p class="say">' + t('s2say') + '</p>');
    } else html += step(2, t('s2'), t('s2a'), io([['in', t('s2in', { p: '<b>' + num(a.prior, 2) + '</b>' })]]) + '<p class="empty">' + t('s2empty') + '</p>');
    const nn = new Set(); S.city.edges.forEach((e) => { nn.add(e.p[0].join()); nn.add(e.p[e.p.length - 1].join()); });
    if (r) {
      const x = r.transit ? r.transit.expanded : r.safe.expanded;
      html += step(3, t('s3'), t('s3a'), io([
        ['in', t('s3in', { n: nn.size, e: S.city.edges.length })],
        ['calc', t('s3calc', { a: a.params.alpha, b: num(a.params.beta * a.wind_k, 2) })],
        ['out', '<b>' + t('s3out', { x, y: r.expanded_short }) + '</b>'],
      ]) + '<p class="say">' + t('s3say') + '</p>');
      const m = r.mdp, acts = ['go', 'wait', 'transit'];
      let tb = '<table class="q"><tr><th></th>' + acts.map((x) => '<th>' + t('ac_' + x) + '</th>').join('') + '</tr>';
      ['calm', 'snow', 'blizzard'].forEach((lv) => {
        const q = m.table[lv];
        tb += '<tr class="' + (lv === m.level ? 'cur' : '') + '"><td>' + t('l_' + lv) + '</td>' + acts.map((x) => '<td class="' + (m.policy[lv] === x ? 'best' : '') + '">' + (q[x] == null ? '—' : num(q[x], 1)) + '</td>').join('') + '</tr>';
      });
      tb += '</table>';
      html += step(4, t('s4'), t('s4a'), io([
        ['in', t('s4in', { l: '<b>' + t('l_' + m.level) + '</b>', tr: '<b>' + t('tr_' + m.trend) + '</b>' })],
        ['calc', 'V(s) = max<sub>a</sub> Q(s, a), γ = ' + m.gamma + '<br>P(s′) = [' + m.trans.map((p) => num(p, 2)).join(', ') + ']'],
        ['out', '<b>' + t('a_' + m.best) + '</b>'],
      ]) + tb + '<p class="say">' + t('s4say') + '</p>');
    } else {
      html += step(3, t('s3'), t('s3a'), io([['in', t('s3in', { n: nn.size, e: S.city.edges.length })]]) + '<p class="empty">' + t('s3empty') + '</p>');
      html += step(4, t('s4'), t('s4a'), '<p class="empty">' + t('s3empty') + '</p>');
    }
    body.innerHTML = html + '<p class="assume">' + t('assume') + '</p>';
  }

  function predictAt(lon, lat) {
    let best = null, bd = Infinity;
    for (const e of S.city.edges) { const d = ((e.c[0] - lon) * 0.63) ** 2 + (e.c[1] - lat) ** 2; if (d < bd) { bd = d; best = e; } }
    const risk = S.risk[best.i] / 100;
    return { risk, pred: risk >= 0.5 ? 'ice' : risk >= 0.25 ? 'packed' : 'dry' };
  }

  function renderMarks() {
    const body = $('marks-body'), M = S.marks, cls = ['ice', 'packed', 'dry'];
    if (!M.length) { body.innerHTML = '<p class="empty">' + t('m_none') + '</p>'; return; }
    const hit = M.filter((m) => m.actual === m.pred).length;
    let cm = '<table class="cm"><tr><th>' + t('m_pred') + '</th>' + cls.map((c) => '<th>' + t('m_' + c) + '</th>').join('') + '</tr>';
    cls.forEach((p) => { cm += '<tr><th>' + t('m_' + p) + '</th>' + cls.map((c) => '<td class="' + (p === c ? 'd' : '') + '">' + M.filter((m) => m.pred === p && m.actual === c).length + '</td>').join('') + '</tr>'; });
    body.innerHTML = '<div class="acc"><div><b>' + M.length + '</b><small>' + t('m_n') + '</small></div><div><b>' + Math.round((hit / M.length) * 100) + '%</b><small>' + t('m_match') + '</small></div></div>' + cm + '</table><div style="display:flex;gap:8px;margin-top:12px"><button class="btn2" id="m-csv">' + t('m_csv') + '</button><button class="btn2" id="m-clear">' + t('m_clear') + '</button></div><p class="assume">≥ 0.50 → ' + t('m_ice') + ' · 0.25–0.50 → ' + t('m_packed') + ' · &lt; 0.25 → ' + t('m_dry') + '</p>';
    $('m-csv').onclick = () => {
      const rows = ['time,lon,lat,actual,predicted,risk,scenario'].concat(M.map((m) => [m.t, m.lon, m.lat, m.actual, m.pred, m.risk, m.scenario].join(',')));
      const a = el('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })); a.download = 'boran_marks.csv'; a.click();
    };
    $('m-clear').onclick = () => { S.marks = []; store.set('boran.marks', []); renderMarks(); };
  }

  let toastTimer = null;
  function toast(text) { const e = $('toast'); e.textContent = text; e.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { e.hidden = true; }, 2600); }

  function onMapClick(info, ev) {
    $('scn-menu').hidden = true; $('mark-pop').hidden = true;
    if (!info || !info.coordinate) return;
    const [lon, lat] = info.coordinate;
    const [s, w, n, e] = S.city.bbox;
    if (lon < w || lon > e || lat < s || lat > n) return;
    if (S.picking) {
      S[S.picking] = { lon: +lon.toFixed(5), lat: +lat.toFixed(5) };
      S.picking = null; S.wantRoute = false; $('place-list').hidden = true;
      renderAll(); return;
    }
    if (S.markMode) {
      const pop = $('mark-pop');
      pop.style.left = info.x + 'px'; pop.style.top = info.y + 'px';
      const col = { ice: 'var(--bad)', packed: 'var(--warn)', dry: 'var(--ok)' };
      pop.innerHTML = ['ice', 'packed', 'dry'].map((c) => '<button data-c="' + c + '"><i style="background:' + col[c] + '"></i>' + t('m_' + c) + '</button>').join('');
      pop.hidden = false;
      pop.querySelectorAll('button').forEach((b) => { b.onclick = () => {
        const pr = predictAt(lon, lat);
        S.marks.push({ t: new Date().toISOString(), lon: +lon.toFixed(5), lat: +lat.toFixed(5), actual: b.dataset.c, pred: pr.pred, risk: +pr.risk.toFixed(2), scenario: S.args.scenario });
        store.set('boran.marks', S.marks); pop.hidden = true; toast(t('m_saved'));
        if (!$('marks').hidden) renderMarks();
      }; });
    }
  }

  function fitRoute(r) {
    const lines = r.transit ? r.transit.legs.concat([r.transit.ride]) : [r.safe.line, r.short.line];
    let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
    lines.forEach((l) => l.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
    const mobile = window.innerWidth <= 760;
    const W = window.innerWidth * (mobile ? 0.8 : 0.55), H = window.innerHeight * (mobile ? 0.34 : 0.6);
    const zx = Math.log2((W * 360) / (512 * Math.max(0.002, x1 - x0))), zy = Math.log2((H * 360) / (512 * Math.max(0.002, (y1 - y0) * 1.6)));
    const zoom = Math.max(11.8, Math.min(16.2, Math.min(zx, zy) - 0.1));
    const span = 360 / Math.pow(2, zoom) / 512;
    const cx = (x0 + x1) / 2 - (mobile ? 0 : span * 150), cy = (y0 + y1) / 2 - (mobile ? span * window.innerHeight * 0.13 : 0);
    setView({ longitude: cx, latitude: cy, zoom, pitch: 44, bearing: 12, transitionDuration: 2200, transitionInterpolator: new D.FlyToInterpolator({ speed: 1.4 }) });
  }

  function startSplash() {
    const sp = $('splash');
    const done = () => {
      if (S.splashDone) return; S.splashDone = true;
      sp.classList.add('out'); setTimeout(() => sp.remove(), 950);
      const c = S.args.places.find((p) => p.id === 'campus');
      setView({ bearing: 25, transitionDuration: 2600, transitionInterpolator: new D.LinearInterpolator(['bearing']) });
      setTimeout(() => { if (!S.args.route) setView({ longitude: c.lon - 0.004, latitude: c.lat + 0.003, zoom: 14.4, pitch: 60, bearing: 18, transitionDuration: 5200, transitionInterpolator: new D.FlyToInterpolator({ speed: 0.9 }) }); }, 2650);
    };
    const quick = /[?&]quick/.test(location.search) || /[?&]quick/.test(document.referrer) || navigator.webdriver;
    sp.addEventListener('pointerdown', done);
    setTimeout(done, quick ? 50 : 3600);
  }

  function openPlaces(which) {
    S.picking = null;
    const box = $('place-list');
    if (!box.hidden && box.dataset.which === which) { box.hidden = true; renderAll(); return; }
    box.dataset.which = which; box.innerHTML = ''; box.hidden = false;
    const icon = { campus: '🎓', dorm: '🏠', landmark: '★', mall: '🛍' };
    const add = (ic, name, sub, fn) => { const b = el('button', '', '<i>' + ic + '</i><span>' + esc(name) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '')); b.onclick = fn; box.append(b); };
    add('⌖', t('pick'), '', () => { S.picking = which; box.hidden = true; toast(t('tap')); renderAll(); });
    S.args.places.forEach((p) => add(icon[p.kind] || '•', p.name[S.lang] || p.name.ru, '', () => { S[which] = { id: p.id, lon: p.lon, lat: p.lat }; S.wantRoute = false; box.hidden = true; renderAll(); }));
    S.city.warm.filter((x) => x.kind === 'mall' && x.name).slice(0, 8).forEach((m) => add(icon.mall, m.name, t('mall'), () => { S[which] = { lon: m.lon, lat: m.lat, label: m.name }; S.wantRoute = false; box.hidden = true; renderAll(); }));
    $('slot-' + which).classList.add('on'); $('slot-' + (which === 'src' ? 'dst' : 'src')).classList.remove('on');
  }

  $('slot-src').onclick = () => openPlaces('src');
  $('slot-dst').onclick = () => openPlaces('dst');
  $('btn-swap').onclick = () => { const a = S.src; S.src = S.dst; S.dst = a; S.wantRoute = false; renderAll(); };
  $('btn-go').onclick = () => {
    if (!S.src || !S.dst) { toast(t('need')); return; }
    $('place-list').hidden = true; S.picking = null;
    S.wantRoute = true; S.pendingRoute = true; S.routeKey = null; $('btn-go').classList.add('busy');
    send();
  };
  $('btn-why').onclick = () => { $('marks').hidden = true; $('brain').hidden = false; renderBrain(); };
  $('btn-brain').onclick = () => { const b = $('brain'); $('marks').hidden = true; b.hidden = !b.hidden; if (!b.hidden) renderBrain(); };
  $('brain-x').onclick = () => { $('brain').hidden = true; };
  $('marks-x').onclick = () => { $('marks').hidden = true; };
  $('btn-lang').onclick = () => { S.lang = LANGS[(LANGS.indexOf(S.lang) + 1) % LANGS.length]; store.set('boran.lang', S.lang); renderAll(); };
  $('btn-theme').onclick = () => { S.themeForce = isNight() ? 'day' : 'night'; document.body.classList.toggle('night', isNight()); document.body.classList.toggle('day', !isNight()); renderAll(); };
  $('btn-ice').onclick = () => {
    S.markMode = !S.markMode; $('btn-ice').setAttribute('aria-pressed', String(S.markMode)); $('mark-pop').hidden = true;
    if (S.markMode) { $('brain').hidden = true; $('marks').hidden = false; renderMarks(); toast(t('m_hint')); $('panel').classList.add('min'); } else { $('marks').hidden = true; toast(t('m_off')); }
  };
  $('btn-scn').onclick = (ev) => {
    const m = $('scn-menu');
    if (!m.hidden) { m.hidden = true; return; }
    const r = ev.currentTarget.getBoundingClientRect();
    m.style.top = r.bottom + 8 + 'px'; m.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
    m.innerHTML = '';
    ['live'].concat(S.args.scenarios).forEach((k) => {
      const b = el('button', k === S.args.scenario ? 'on' : '', '<span>' + t('scn_' + k) + '<small>' + (k === 'live' ? t('scn_live_d') : t('scn_d')) + '</small></span>');
      b.setAttribute('role', 'menuitemradio');
      b.onclick = () => { m.hidden = true; S.scenario = k; S.themeForce = null; S.routeKey = null; send(); };
      m.append(b);
    });
    m.hidden = false;
  };
  $('panel-handle').onclick = () => $('panel').classList.toggle('min');
  $('wx').onclick = () => $('wx').classList.toggle('open');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('brain').hidden = true; $('marks').hidden = true; $('scn-menu').hidden = true; $('place-list').hidden = true; S.picking = null; if (S.args) renderAll(); } });
  window.__boran = S;
})();
