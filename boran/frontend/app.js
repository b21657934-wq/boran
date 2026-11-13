(function () {
  window.addEventListener('error', (e) => { try { const b = document.getElementById('toast'); b.textContent = 'JS: ' + e.message; b.hidden = false; } catch (x) { } });
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
    routeKey: null, routeT0: 0, waveT0: 0, view: null, riskTable: null, tiles: new Map(), tileReq: new Map(), tileShown: '',
    marks: store.get('boran.marks', []), splashDone: false, introDone: false, t0: performance.now(),
  };
  const t = (k, vars) => { let s = (window.I18N[S.lang] || window.I18N.ru)[k]; if (s == null) s = window.I18N.ru[k] ?? k; if (vars) for (const a in vars) s = s.split('{' + a + '}').join(vars[a]); return s; };
  const num = (v, d = 0) => Number(v).toFixed(d).replace('-', '−');
  const isNight = () => S.themeForce === 'night';

  function post(type, extra) { window.parent.postMessage(Object.assign({ isStreamlitMessage: true, type }, extra), '*'); }
  function send() {
    S.n += 1;
    post('streamlit:setComponentValue', {
      dataType: 'json',
      value: { n: S.n, scenario: S.scenario || 'live', src: S.wantRoute && S.src ? [S.src.lon, S.src.lat] : null, dst: S.wantRoute && S.dst ? [S.dst.lon, S.dst.lat] : null, cmp: !!(S.wantCompare && S.wantRoute) },
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
      S.tileSet = new Set(S.city.tiles); S.tiles = new Map(); S.tileReq = new Map(); S.tileShown = '';
      S.big = null; S.bigReq = null;
      S.heat = null; S.heatReq = null;
      if (S.city.inline) {
        const { heat, ...rest } = S.city.inline;
        for (const k in rest) S.tiles.set(k, tileFeats(rest[k]));
        S.big = tileFeats([].concat(...Object.values(rest)).filter((x) => x[2] === 1));
        S.heat = heat ? heatFeats(heat) : null;
      }
      S.riskTable = args.riskTable;
      await initMap();
    }
    if (String(S.riskTable) !== String(args.riskTable)) { S.riskTable = args.riskTable; pushRisk(); }
    document.body.classList.toggle('night', isNight());
    document.body.classList.toggle('day', !isNight());
    renderAll();
    const key = args.route ? JSON.stringify([args.route.src, args.route.dst, args.scenario]) : null;
    if (key !== S.routeKey) {
      S.routeKey = key;
      if (args.route) {
        S.waveT0 = performance.now(); S.routeT0 = S.waveT0 + 900; S.drawK = null; S.waveN = -1; $('panel').classList.remove('min');
        if (S.brief && !$('brief').hidden) briefRoute(args.route); else fitRoute(args.route);
      }
    }
    if (!S.pendingRoute || args.ack >= S.n) { S.pendingRoute = false; $('btn-go').classList.remove('busy'); }
    if (args.error && S.wantRoute) { toast(args.error === 'no_path' ? t('nopath') : t('err') + ' ' + args.error); if (S.brief) closeBrief(false); }
    if (args.compare && S.wantCompare && S.src && S.dst) {
      const same = args.compare.src[0].toFixed(4) === S.src.lon.toFixed(4) && args.compare.dst[0].toFixed(4) === S.dst.lon.toFixed(4);
      if (same && S.cmp !== args.compare) { S.cmp = args.compare; S.cmpPending = false; if (!$('algos').hidden) { renderAlgos(); pushCompare(); fitCompare(); } }
    }
    if (first) startSplash();
  }

  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  function riskColor(r, alpha) {
    const ok = [75, 227, 160], warn = [255, 181, 71], bad = [255, 90, 95];
    const k = Math.max(0, Math.min(1, (r - 0.15) / 0.7));
    const c = k < 0.5 ? mix(ok, warn, k / 0.5) : mix(warn, bad, (k - 0.5) / 0.5);
    return [c[0], c[1], c[2], alpha];
  }


  const ML = window.maplibregl;
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  let map = null, baseStyle = null, styleKey = null;
  const markers = { src: null, dst: null, places: [] };
  const FC = (features) => ({ type: 'FeatureCollection', features: features || [] });
  const PAL = {
    day: {
      bg: '#F1F4F7', res: '#E9EEF2', block: '#E5EAEF', park: '#E7EDF2', tree: '#BCC9D6', wood: '#DDE5EC', woodTree: '#AEBFCF', pitch: '#E7EDF2',
      water: '#CBDDEA', iceCrack: '#A6C2D6', iceShine: '#EAF3F9', waterLine: '#B6CEDF',
      road: '#A9B3BE', sec: '#808C9A', major: '#5A6573', casing: '#F1F4F7', majorCasing: '#F1F4F7', path: '#C8D0D8', rail: '#B0BAC5',
      bld2d: '#E0E6EC', bldOutline: '#CCD5DE', bld3d: '#F5F8FA', bldTall: '#D2DDE8', text: '#1F2A37', poiText: '#5B6878', waterText: '#45708E', halo: '#F1F4F7',
      risk: ['#9AA7B6', '#F2A93B', '#E0344C'], ok: '#1FA971', heat: ['rgba(242,169,59,0.24)', 'rgba(238,120,48,0.4)', 'rgba(224,52,76,0.56)'],
      route: '#0B7A92', routeCasing: '#FFFFFF', routeGlow: '#14A5C2', short: '#5E6B85', ride: '#6C4CE0', wave: '#0B7A92', warm: '#E8743B', worst: '#E0344C',
      light: { anchor: 'viewport', color: '#FFFFFF', intensity: 0.3, position: [1.3, 200, 35] },
      sky: { 'sky-color': '#BCD1E5', 'horizon-color': '#EEF3F7', 'fog-color': '#E7EDF3', 'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.6, 'atmosphere-blend': 0.4 },
    },
    night: {
      bg: '#0B1220', res: '#0E1626', block: '#0F1828', park: '#111C2D', tree: '#1F2E45', wood: '#121F31', woodTree: '#24364F', pitch: '#111C2D',
      water: '#122A43', iceCrack: '#24476A', iceShine: '#1A3856', waterLine: '#1D3B5B',
      road: '#283550', sec: '#34445F', major: '#4A5D7E', casing: '#0B1220', majorCasing: '#0B1220', path: '#1E2A42', rail: '#2A3550',
      bld2d: '#141C2B', bldOutline: '#1E2839', bld3d: '#1A2231', bldTall: '#25334A', text: '#DCE6F5', poiText: '#8A9AB8', waterText: '#6E9CC8', halo: '#0B1220',
      risk: ['#4A5A76', '#FFB547', '#FF4D6A'], ok: '#4BE3A0', heat: ['rgba(255,181,71,0.22)', 'rgba(255,128,64,0.4)', 'rgba(255,77,106,0.58)'],
      route: '#7FE7F5', routeCasing: '#0B1220', routeGlow: '#2CC5E0', short: '#8F9BB5', ride: '#B9A6FF', wave: '#7FE7F5', warm: '#FFB46B', worst: '#FF4D6A',
      light: { anchor: 'viewport', color: '#C9D5F0', intensity: 0.3, position: [1.2, 210, 35] },
      sky: { 'sky-color': '#04070E', 'horizon-color': '#16233C', 'fog-color': '#0D1627', 'fog-ground-blend': 0.6, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.7, 'atmosphere-blend': 0.4 },
    },
  };
  const pal = () => PAL[isNight() ? 'night' : 'day'];
  function patternImage(kind, night) {
    const P = PAL[night ? 'night' : 'day'], n = 128, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    let seed = kind === 'ice' ? 11 : kind === 'wood' ? 29 : 17;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const wrap = (fn) => { for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { g.save(); g.translate(dx, dy); fn(); g.restore(); } };
    g.fillStyle = kind === 'ice' ? P.water : kind === 'wood' ? P.wood : P.park;
    g.fillRect(0, 0, n, n);
    if (kind === 'ice') {
      for (let i = 0; i < 5; i++) {
        const x = rnd() * n, y = rnd() * n, r = 10 + rnd() * 22;
        wrap(() => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, P.iceShine); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 0.55; g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); });
      }
      g.globalAlpha = 1;
      for (let i = 0; i < 6; i++) {
        const pts = []; let x = rnd() * n, y = rnd() * n, a = rnd() * Math.PI * 2;
        pts.push([x, y]);
        for (let j = 0; j < 6; j++) { a += (rnd() - 0.5) * 1.3; const L = 5 + rnd() * 13; x += Math.cos(a) * L; y += Math.sin(a) * L; pts.push([x, y]); }
        const w = 0.6 + rnd() * 0.7;
        wrap(() => { g.strokeStyle = P.iceCrack; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke(); });
      }
    } else {
      const count = kind === 'wood' ? 54 : 24, col = kind === 'wood' ? P.woodTree : P.tree;
      for (let i = 0; i < count; i++) {
        const x = rnd() * n, y = rnd() * n, r = 1.1 + rnd() * (kind === 'wood' ? 1.5 : 1.3), al = 0.3 + rnd() * 0.35;
        wrap(() => { g.globalAlpha = al; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
      }
    }
    return g.getImageData(0, 0, n, n);
  }
  function roadMeters(id) {
    const m = /motorway(?!_link)/.test(id) ? 24 : /trunk_primary/.test(id) ? 19 : /secondary_tertiary/.test(id) ? 12.5 : /link/.test(id) ? 7 : /service_track/.test(id) ? 4.5 : /path_pedestrian/.test(id) ? 2.4 : /minor|street/.test(id) ? 7.5 : 0;
    return m && /casing/.test(id) ? m + 2.2 : m;
  }
  function realWidth(w, m) {
    if (!m || !Array.isArray(w) || w[0] !== 'interpolate' || !Array.isArray(w[2]) || w[2][0] !== 'zoom') return w;
    const out = w.slice(0, 3);
    let last = 0;
    for (let i = 3; i < w.length - 1; i += 2) {
      if (typeof w[i + 1] !== 'number') return w;
      if (w[i] < 16.5) { out.push(w[i], w[i + 1]); last = w[i + 1]; }
    }
    for (let z = 17; z <= 24; z++) { last = Math.max(last, +(m * Math.pow(2, z) / 98325).toFixed(2)); out.push(z, last); }
    return out;
  }
  function restyle(base, night, lang) {
    const st = JSON.parse(JSON.stringify(base));
    const P = PAL[night ? 'night' : 'day'];
    const nameKey = lang === 'kk' ? 'name:kk' : lang === 'en' ? 'name:en' : 'name:ru';
    const out = [];
    for (const L of st.layers) {
      const sl = L['source-layer'] || '', id = L.id;
      const p = L.paint = Object.assign({}, L.paint);
      L.layout = Object.assign({}, L.layout);
      if (L.type === 'raster' || sl === 'boundary' || /shield/.test(id) || id === 'park_outline') continue;
      if (L.type === 'background') p['background-color'] = P.bg;
      else if (L.type === 'fill') {
        delete p['fill-pattern'];
        const th = night ? 'night' : 'day';
        if (id === 'water') { p['fill-color'] = P.water; p['fill-pattern'] = 'b-ice-' + th; }
        else if (id === 'park' || id === 'landcover_grass') { p['fill-color'] = P.park; p['fill-opacity'] = 1; p['fill-pattern'] = 'b-park-' + th; }
        else if (id === 'landcover_wood') { p['fill-color'] = P.wood; p['fill-opacity'] = 1; p['fill-pattern'] = 'b-wood-' + th; }
        else if (/pitch|track/.test(id)) { p['fill-color'] = P.pitch; p['fill-opacity'] = 1; }
        else if (id === 'landuse_residential') { p['fill-color'] = P.res; p['fill-opacity'] = 1; }
        else if (/landuse|landcover|aeroway/.test(id)) { p['fill-color'] = P.block; p['fill-opacity'] = 1; }
        else if (id === 'building') { p['fill-color'] = P.bld2d; p['fill-outline-color'] = P.bldOutline; }
        else if (sl === 'transportation') { p['fill-color'] = P.path; }
      } else if (L.type === 'line') {
        delete p['line-pattern'];
        if (sl === 'waterway') p['line-color'] = P.waterLine;
        else if (sl === 'transportation') {
          if (/rail/.test(id)) p['line-color'] = P.rail;
          else if (/casing/.test(id)) p['line-color'] = /trunk|primary|motorway/.test(id) ? P.majorCasing : P.casing;
          else if (/path|pedestrian/.test(id)) p['line-color'] = P.path;
          else if (/motorway|trunk_primary/.test(id)) p['line-color'] = P.major;
          else if (/secondary_tertiary/.test(id)) p['line-color'] = P.sec;
          else p['line-color'] = P.road;
          if (!/rail/.test(id)) p['line-width'] = realWidth(p['line-width'], roadMeters(id));
        } else if (sl === 'aeroway') p['line-color'] = P.casing;
      } else if (L.type === 'fill-extrusion') {
        p['fill-extrusion-color'] = P.bld3d;
        p['fill-extrusion-vertical-gradient'] = true;
        L.minzoom = 12.6;
        p['fill-extrusion-opacity'] = ['interpolate', ['linear'], ['zoom'], 12.6, 0, 13.4, 1];
        const tall = ['>=', ['coalesce', ['get', 'render_height'], 0], 48], f0 = ['all', ...(L.filter ? [L.filter] : []), ['>', ['distance', { type: 'Point', coordinates: [71.41613, 51.08893] }], 24]];
        L.filter = f0 ? ['all', f0, ['!', tall]] : ['!', tall];
        out.push(L);
        const T = JSON.parse(JSON.stringify(L));
        T.id = id + '-tall'; T.filter = f0 ? ['all', f0, tall] : tall; T.paint['fill-extrusion-color'] = P.bldTall;
        out.push(T);
        continue;
      } else if (L.type === 'symbol') {
        if (sl === 'poi' && id !== 'poi_transit') {
          if (id !== 'poi_r1') continue;
          delete L.layout['icon-image']; delete L.layout['text-variable-anchor'];
          L.layout['text-offset'] = [0, 0]; L.layout['text-anchor'] = 'center'; L.layout['text-size'] = 11.5;
          L.minzoom = Math.max(L.minzoom || 0, 16.4);
        }
        if (id === 'poi_transit') { L.minzoom = Math.max(L.minzoom || 0, 15); p['icon-opacity'] = night ? 0.6 : 0.8; }
        if (L.layout['text-field'] && /place|poi|transportation_name|water_name|waterway|aerodrome/.test(sl)) {
          L.layout['text-field'] = ['coalesce', ['get', nameKey], ['get', 'name:ru'], ['get', 'name'], ['get', 'name:latin']];
        }
        p['text-color'] = sl === 'water_name' || sl === 'waterway' ? P.waterText : sl === 'poi' ? P.poiText : P.text;
        p['text-halo-color'] = P.halo; p['text-halo-width'] = 1.6; delete p['text-halo-blur'];
        if (night && id !== 'poi_transit') p['icon-opacity'] = 0.7;
      }
      out.push(L);
    }
    if (!out.some((L) => L.type === 'fill-extrusion')) {
      const src = Object.keys(st.sources).find((k) => st.sources[k].type === 'vector');
      if (src) {
        const at = out.findIndex((L) => L.type === 'symbol');
        out.splice(at < 0 ? out.length : at, 0, { id: 'building-3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 13.4, paint: { 'fill-extrusion-color': P.bld3d, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 1 } });
      }
    }
    st.layers = out;
    st.light = P.light;
    st.sky = P.sky;
    return st;
  }

  function flatStyle(night) {
    const P = PAL[night ? 'night' : 'day'];
    return { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': P.bg } }], light: P.light, sky: P.sky };
  }

  function circlePoly(lon, lat, r, n = 28) {
    const kx = 1 / (111320 * Math.cos(lat * Math.PI / 180)), ky = 1 / 110540, ring = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; ring.push([lon + Math.cos(a) * r * kx, lat + Math.sin(a) * r * ky]); }
    return [ring];
  }
  function landmarkFeatures() {
    const f = [];
    const add = (lon, lat, r, base, h, color) => f.push({ type: 'Feature', properties: { base, h, color }, geometry: { type: 'Polygon', coordinates: circlePoly(lon, lat, r) } });
    const bx = 71.43048, by = 51.12827;
    add(bx, by, 7, 0, 3, '#D9D4CB');
    for (let i = 0; i < 6; i++) add(bx, by, 3.2 - i * 0.1, 3 + i * 11, 3 + (i + 1) * 11, '#F7F7F4');
    const R = 11, c = 86;
    for (let k = 0; k < 10; k++) {
      const z0 = c - R + (k * 2 * R) / 10, z1 = z0 + (2 * R) / 10, zm = (z0 + z1) / 2;
      add(bx, by, Math.max(1.5, Math.sqrt(Math.max(0, R * R - (zm - c) ** 2))), z0, z1, '#E9B93A');
    }
    add(bx, by, 2.2, 63, 75, '#F7F7F4');
    const nl = isNight(), ex = 71.41613, ey = 51.08893;
    add(ex, ey, 24, 0, 12, nl ? '#25324A' : '#D7DEE6');
    add(ex, ey, 13, 12, 22, nl ? '#2E3E5C' : '#C4CFDA');
    const SR = 40, SC = 60, BANDS = 32, SECT = 24, k0 = 111320 * Math.cos(ey * Math.PI / 180);
    const glassA = nl ? '#3E63B0' : '#A7C6DE', glassB = nl ? '#5577C8' : '#BBD5E8', frame = nl ? '#9B8CFF' : '#7F9DB9';
    for (let k = 0; k < BANDS; k++) {
      const z0 = SC - SR + (k * 2 * SR) / BANDS, z1 = z0 + (2 * SR) / BANDS, zm = (z0 + z1) / 2;
      const r = Math.max(2, Math.sqrt(Math.max(0, SR * SR - (zm - SC) ** 2)));
      for (let j = 0; j < SECT; j++) {
        const a0 = (j / SECT) * Math.PI * 2, a1 = ((j + 1) / SECT) * Math.PI * 2, ring = [[ex, ey]];
        for (let q = 0; q <= 3; q++) { const a = a0 + ((a1 - a0) * q) / 3; ring.push([ex + (Math.cos(a) * r) / k0, ey + (Math.sin(a) * r) / 110540]); }
        ring.push([ex, ey]);
        const col = k % 4 === 0 ? frame : (j + (k >> 2)) % 2 ? glassA : glassB;
        f.push({ type: 'Feature', properties: { base: z0, h: z1, color: col }, geometry: { type: 'Polygon', coordinates: [ring] } });
      }
    }
    return FC(f);
  }

  const TILE_Z = 12.5, DETAIL_Z = 14.4;
  function tileFeats(arr) {
    const all = arr.map(([p, m, b]) => ({ type: 'Feature', properties: { m, b }, geometry: { type: 'LineString', coordinates: p } }));
    all.big = all.filter((f) => f.properties.b === 1);
    all.mid = arr.map(([p]) => p[p.length >> 1]);
    return all;
  }
  const tileKey = (lon, lat) => { const [s, w] = S.city.bbox, [dy, dx] = S.city.cell; return Math.floor((lat - s) / dy) + '_' + Math.floor((lon - w) / dx); };
  function loadTile(k) {
    if (S.tiles.has(k)) return Promise.resolve(S.tiles.get(k));
    if (!S.tileSet.has(k)) return Promise.resolve(null);
    if (S.tileReq.has(k)) return S.tileReq.get(k);
    const v = S.cityVersion;
    const pr = fetch('tiles/' + v + '/' + k + '.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((arr) => { if (v !== S.cityVersion) return null; const f = tileFeats(arr); S.tiles.set(k, f); return f; })
      .catch(() => { S.tileReq.delete(k); return null; });
    S.tileReq.set(k, pr);
    return pr;
  }
  function loadBig() {
    if (S.big || S.bigReq) return S.bigReq || Promise.resolve(S.big);
    const v = S.cityVersion;
    S.bigReq = fetch('tiles/' + v + '/big.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((arr) => { if (v === S.cityVersion) S.big = tileFeats(arr); S.bigReq = null; return S.big; })
      .catch(() => { S.bigReq = null; return null; });
    return S.bigReq;
  }
  function viewTiles() {
    if (!map || !S.city || map.getZoom() < TILE_Z) return { keys: [], low: true, off: true };
    if (map.getZoom() < DETAIL_Z) return { keys: [], low: true };
    const b = map.getBounds(), c = map.getCenter();
    const [s, w, n, e] = S.city.bbox, [dy, dx] = S.city.cell;
    const rad = 2.6, low = false;
    const lo = Math.max(s, b.getSouth(), c.lat - rad * dy), hi = Math.min(n, b.getNorth(), c.lat + rad * dy);
    const le = Math.max(w, b.getWest(), c.lng - rad * dx), ri = Math.min(e, b.getEast(), c.lng + rad * dx);
    const keys = [];
    if (lo > hi || le > ri) return { keys, low };
    for (let r = Math.floor((lo - s) / dy); r <= Math.floor((hi - s) / dy); r++)
      for (let q = Math.floor((le - w) / dx); q <= Math.floor((ri - w) / dx); q++) { const k = r + '_' + q; if (S.tileSet.has(k)) keys.push(k); }
    return { keys, low };
  }
  function riskFeatures() {
    const { keys, low, off } = S.view || { keys: [], low: true, off: true };
    if (low) return FC(!off && S.big ? S.big : []);
    const out = [];
    for (const k of keys) { const f = S.tiles.get(k); if (f) { const L = low ? f.big : f; for (let i = 0; i < L.length; i++) out.push(L[i]); } }
    return FC(out);
  }
  let tileTimer = null;
  function showTiles() {
    tileTimer = null;
    const v = S.view || { keys: [], low: true, off: true };
    const sig = v.low ? (v.off ? 'O' : 'L' + (S.big ? 1 : 0)) : 'H' + v.keys.filter((k) => S.tiles.has(k)).join(',');
    if (sig === S.tileShown) return;
    S.tileShown = sig;
    const s = src('b-risk'); if (s) s.setData(riskFeatures());
  }
  function refreshTiles() {
    if (!map || !S.city) return;
    S.view = viewTiles();
    if (S.view.low && !S.view.off && !S.big) loadBig().then(() => { if (!tileTimer) tileTimer = setTimeout(showTiles, 80); });
    const wait = S.view.keys.filter((k) => !S.tiles.has(k));
    wait.forEach((k) => loadTile(k).then(() => { if (!tileTimer) tileTimer = setTimeout(showTiles, 80); }));
    showTiles();
  }
  function heatFeats(arr) { return arr.map(([lon, lat, m, c]) => ({ type: 'Feature', properties: { m, c }, geometry: { type: 'Point', coordinates: [lon, lat] } })); }
  function loadHeat() {
    if (S.heat || S.heatReq) return;
    const v = S.cityVersion;
    S.heatReq = fetch('tiles/' + v + '/heat.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((arr) => { S.heatReq = null; if (v !== S.cityVersion) return; S.heat = heatFeats(arr); const s = src('b-heat'); if (s) s.setData(FC(S.heat)); })
      .catch(() => { S.heatReq = null; });
  }
  const heatWeight = () => ['*', ['min', 1, ['/', ['get', 'c'], 8]], ['max', 0, ['/', ['-', rExpr(), 42], 58]]];
  const rExpr = () => ['at', ['get', 'm'], ['literal', S.riskTable && S.riskTable.length === 32 ? S.riskTable : new Array(32).fill(0)]];
  const riskPaint = (P) => ['interpolate', ['linear'], rExpr(), 20, P.risk[0], 50, P.risk[1], 80, P.risk[2]];
  const glowFilter = () => ['all', ['>=', rExpr(), 80], ['==', ['get', 'b'], 1]];

  function arrows(id, source, P) {
    return { id, type: 'symbol', source, minzoom: 13,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 13, 70, 17, 110], 'text-field': '›', 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 13, 17, 20], 'text-keep-upright': false, 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'map', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-offset': [0, -0.08] },
      paint: { 'text-color': isNight() ? P.bg : '#FFFFFF', 'text-opacity': 0 } };
  }
  function addOverlay(st) {
    const P = PAL[isNight() ? 'night' : 'day'];
    const firstBld = st.layers.findIndex((L) => L.id === 'building' || L.type === 'fill-extrusion');
    const firstSym = st.layers.findIndex((L) => L.type === 'symbol');
    let before = firstBld < 0 ? (firstSym < 0 ? st.layers.length : firstSym) : firstBld;
    Object.assign(st.sources, {
      'b-heat': { type: 'geojson', data: FC(S.heat || []) },
      'b-risk': { type: 'geojson', data: riskFeatures(), tolerance: 0.6 },
      'b-route': { type: 'geojson', data: FC(), lineMetrics: true },
      'b-short': { type: 'geojson', data: FC() },
      'b-ride': { type: 'geojson', data: FC(), lineMetrics: true },
      'b-points': { type: 'geojson', data: FC() },
      'b-wave': { type: 'geojson', data: FC() },
      'b-runner': { type: 'geojson', data: FC() },
      'b-warm': { type: 'geojson', data: FC(S.city.warm.map((w) => ({ type: 'Feature', properties: { k: w.kind }, geometry: { type: 'Point', coordinates: [w.lon, w.lat] } }))) },
      'b-marks': { type: 'geojson', data: FC() },
      'b-landmarks': { type: 'geojson', data: landmarkFeatures() },
      'b-cmp': { type: 'geojson', data: FC() },
      'b-cmp-wave': { type: 'geojson', data: FC() },
    });
    const riskColor = riskPaint(P);
    const heat = { id: 'b-heat', type: 'heatmap', source: 'b-heat', maxzoom: 14.6,
      paint: { 'heatmap-weight': heatWeight(), 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 12, 0.5, 14, 0.9],
        'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, 16, 12, 40, 14, 110],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.22, 'rgba(0,0,0,0)', 0.4, P.heat[0], 0.65, P.heat[1], 0.9, P.heat[2]],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 12.6, 0.95, 14.4, 0] } };
    const firstRoad = st.layers.findIndex((L) => L['source-layer'] === 'transportation');
    const heatAt = firstRoad < 0 ? Math.min(1, st.layers.length) : firstRoad;
    st.layers.splice(heatAt, 0, heat);
    if (heatAt <= before) before += 1;
    const below = [
      { id: 'b-risk-glow', type: 'line', source: 'b-risk', minzoom: 13, filter: glowFilter(), layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': riskColor, 'line-blur': 4, 'line-opacity': isNight() ? 0.4 : 0.22, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13, 3, 16, 10, 18, 24] } },
      { id: 'b-risk', type: 'line', source: 'b-risk', minzoom: 12.5, filter: ['any', ['==', ['get', 'b'], 1], ['>=', ['zoom'], 14.6]], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': riskColor,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, ['case', ['==', ['get', 'b'], 1], 0.85, 0.5], 16, ['case', ['==', ['get', 'b'], 1], 0.85, 0.62]],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13, ['case', ['==', ['get', 'b'], 1], 1.2, 0.5], 16, ['case', ['==', ['get', 'b'], 1], 2.6, 1.3], 18, ['case', ['==', ['get', 'b'], 1], 6, 3.2]] } },
      { id: 'b-warm', type: 'circle', source: 'b-warm', minzoom: 13,
        paint: { 'circle-color': P.warm, 'circle-opacity': 0.18, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, ['case', ['==', ['get', 'k'], 'mall'], 6, 2], 17, ['case', ['==', ['get', 'k'], 'mall'], 26, 9]], 'circle-stroke-color': P.warm, 'circle-stroke-width': 1.2, 'circle-stroke-opacity': 0.8, 'circle-pitch-alignment': 'map' } },
      { id: 'b-short', type: 'line', source: 'b-short', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': P.short, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 3.5], 'line-dasharray': [1.2, 1.6], 'line-opacity': 0 } },
      { id: 'b-route-glow', type: 'line', source: 'b-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': P.routeGlow, 'line-blur': 6, 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 26] } },
      { id: 'b-route-casing', type: 'line', source: 'b-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-gradient': ['step', ['line-progress'], P.routeCasing, 0, 'rgba(0,0,0,0)'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6.5, 13, 8.5, 17, 14] } },
      { id: 'b-route', type: 'line', source: 'b-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-gradient': ['step', ['line-progress'], P.route, 0, 'rgba(0,0,0,0)'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.8, 13, 5, 17, 9] } },
      arrows('b-route-arrows', 'b-route', P),
      { id: 'b-wave', type: 'circle', source: 'b-wave', paint: { 'circle-color': P.wave, 'circle-radius': 3, 'circle-opacity': 0.7, 'circle-pitch-alignment': 'map' } },
      { id: 'b-points', type: 'circle', source: 'b-points', paint: {
        'circle-radius': ['case', ['==', ['get', 'k'], 'worst'], 14, 6], 'circle-color': ['case', ['==', ['get', 'k'], 'worst'], 'rgba(0,0,0,0)', isNight() ? '#0A1022' : '#FFFFFF'],
        'circle-stroke-color': ['case', ['==', ['get', 'k'], 'worst'], P.worst, P.ride], 'circle-stroke-width': ['case', ['==', ['get', 'k'], 'worst'], 2.5, 3], 'circle-pitch-alignment': 'map' } },
      { id: 'b-cmp-wave', type: 'circle', source: 'b-cmp-wave', paint: { 'circle-color': '#1E88E5', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 16, 3.5], 'circle-opacity': 0.55, 'circle-pitch-alignment': 'map' } },
      { id: 'b-cmp-casing', type: 'line', source: 'b-cmp', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': P.routeCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 17, 14] } },
      { id: 'b-cmp', type: 'line', source: 'b-cmp', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'c'], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.45], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['case', ['==', ['get', 'sel'], 1], 4, 2], 17, ['case', ['==', ['get', 'sel'], 1], 9, 3.5]] } },
      { id: 'b-runner', type: 'circle', source: 'b-runner', paint: { 'circle-radius': 6, 'circle-color': '#FFFFFF', 'circle-stroke-color': P.route, 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' } },
      { id: 'b-marks', type: 'circle', source: 'b-marks', paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'a'], 'ice', P.risk[2], 'packed', P.risk[1], P.ok], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1.5 } },
    ];
    st.layers.splice(before, 0, ...below);
    const ext = st.layers.findIndex((L) => L.type === 'fill-extrusion');
    const sym = st.layers.findIndex((L) => L.type === 'symbol');
    const lmAt = ext >= 0 ? ext + 1 : (sym < 0 ? st.layers.length : sym);
    st.layers.splice(lmAt, 0,
      { id: 'b-landmarks', type: 'fill-extrusion', source: 'b-landmarks', minzoom: 12.5, paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } },
      { id: 'b-ride-casing', type: 'line', source: 'b-ride', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': P.routeCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6, 13, 8.5, 17, 14], 'line-opacity': 0 } },
      { id: 'b-ride', type: 'line', source: 'b-ride', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': P.ride, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.6, 13, 5, 17, 8.5], 'line-opacity': 0 } },
      arrows('b-ride-arrows', 'b-ride', P));
    return st;
  }

  function applyStyle() {
    if (!map) return;
    const key = (isNight() ? 'n' : 'd') + S.lang + (baseStyle ? 1 : 0) + (S.city ? S.cityVersion : '');
    if (key === styleKey) return;
    styleKey = key;
    const st = baseStyle && !S.city.demo ? restyle(baseStyle, isNight(), S.lang) : flatStyle(isNight());
    if (!baseStyle || S.city.demo) {
      const P = pal();
      st.sources.city_water = { type: 'geojson', data: FC(S.city.water.lines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } })).concat(S.city.water.polys.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [p] } })))) };
      st.layers.push({ id: 'city-water-fill', type: 'fill', source: 'city_water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': P.water } });
      st.layers.push({ id: 'city-water-line', type: 'line', source: 'city_water', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': P.water, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 11, 4, 16, 90] } });
    }
    const full = addOverlay(st);
    S.styleTry = (S.styleTry || 0) + 1;
    const attempt = S.styleTry;
    map.setStyle(full, { diff: false });
    map.once('styledata', () => { S.routeDrawn = null; S.drawK = null; S.waveN = -1; S.tileShown = ''; refreshTiles(); loadHeat(); pushRoute(true); pushMarks(); pushCompare(); });
    setTimeout(() => {
      if (attempt !== S.styleTry || (map.getStyle() && map.getLayer('b-risk'))) return;
      if (attempt > 3) return;
      styleKey = null; applyStyle();
    }, 5000);
  }

  const VIEW0 = { center: [71.4305, 51.1283], zoom: 15.4, pitch: 58, bearing: -28 };
  async function initMap() {
    if (map) { map.remove(); $('map').innerHTML = ''; styleKey = null; }
    const [s, w, n, e] = S.city.bbox;
    map = new ML.Map({
      container: 'map', style: flatStyle(isNight()), center: VIEW0.center, zoom: VIEW0.zoom, pitch: VIEW0.pitch, bearing: VIEW0.bearing,
      maxPitch: 70, minZoom: 10.5, maxZoom: 18.5, attributionControl: false, maxBounds: [[w - 0.25, s - 0.15], [e + 0.25, n + 0.15]], antialias: true,
    });
    map.addControl(new ML.AttributionControl({ compact: true }), 'bottom-right');
    const foldAttrib = () => { const a = document.querySelector('.maplibregl-ctrl-attrib'); if (a) { a.classList.add('maplibregl-compact'); a.classList.remove('maplibregl-compact-show'); a.removeAttribute('open'); } };
    map.once('load', () => setTimeout(foldAttrib, 400)); map.on('styledata', () => setTimeout(foldAttrib, 400));
    map.on('moveend', refreshTiles);
    map.on('styleimagemissing', (ev) => {
      const k = /^b-(ice|park|wood)-(day|night)$/.exec(ev.id);
      if (k && !map.hasImage(ev.id)) map.addImage(ev.id, patternImage(k[1], k[2] === 'night'), { pixelRatio: 2 });
    });
    map.on('click', (ev) => onMapClick({ coordinate: [ev.lngLat.lng, ev.lngLat.lat], x: ev.point.x, y: ev.point.y }));
    map.on('error', (ev) => { if (ev && ev.error && /style|layers\[/.test(String(ev.error.message))) console.warn(ev.error.message); });
    window.__map = map;
    if (NAV) NAV.stop(true);
    NAV = window.BoranNav ? window.BoranNav.create({ map, t, isNight, lang: () => S.lang, onStart: navStart, onExit: navExit }) : null;
    requestAnimationFrame(frame);
    if (!S.city.demo) {
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
        baseStyle = await fetch(STYLE_URL, { signal: ctl.signal }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
        clearTimeout(tm);
      } catch (err) { baseStyle = null; S.noTiles = true; }
    }
    applyStyle(); syncMarkers(); renderAll();
  }

  function pinEl(cls) { return el('div', 'pin ' + cls, '<i></i>'); }
  function syncMarkers() {
    if (!map || !S.args) return;
    for (const k of ['src', 'dst']) {
      const p = S[k];
      if (!p) { if (markers[k]) { markers[k].remove(); markers[k] = null; } continue; }
      if (!markers[k]) markers[k] = new ML.Marker({ element: pinEl(k === 'src' ? 'a' : 'b'), anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map);
      else markers[k].setLngLat([p.lon, p.lat]);
    }
    const key = S.lang + (S.noTiles ? 1 : 0);
    if (markers.placesKey === key) return;
    markers.placesKey = key;
    markers.places.forEach((m) => m.remove()); markers.places = [];
    S.args.places.filter((p) => p.kind !== 'landmark' || S.city.demo || S.noTiles).forEach((p) => {
      const e = el('div', 'mk-label', esc(p.name[S.lang] || p.name.ru));
      markers.places.push(new ML.Marker({ element: e, anchor: 'bottom', offset: [0, -16] }).setLngLat([p.lon, p.lat]).addTo(map));
    });
  }

  const src = (id) => (map && map.getSource(id)) || null;
  function setPaint(id, k, v) { if (map && map.getLayer(id)) map.setPaintProperty(id, k, v); }

  function pushRisk() {
    if (!map || !map.getLayer('b-risk')) return;
    const P = PAL[isNight() ? 'night' : 'day'];
    setPaint('b-risk', 'line-color', riskPaint(P)); setPaint('b-risk-glow', 'line-color', riskPaint(P));
    if (map.getLayer('b-risk-glow')) map.setFilter('b-risk-glow', glowFilter());
    setPaint('b-heat', 'heatmap-weight', heatWeight());
  }
  function pushMarks() { const s = src('b-marks'); if (s) s.setData(FC(S.marks.map((m) => ({ type: 'Feature', properties: { a: m.actual }, geometry: { type: 'Point', coordinates: [m.lon, m.lat] } })))); }

  function lineLen(line) { let a = 0; for (let i = 1; i < line.length; i++) a += Math.hypot((line[i][0] - line[i - 1][0]) * 0.63, line[i][1] - line[i - 1][1]); return a; }
  function pointAt(line, t) {
    const L = lineLen(line); let need = L * t;
    for (let i = 1; i < line.length; i++) {
      const d = Math.hypot((line[i][0] - line[i - 1][0]) * 0.63, line[i][1] - line[i - 1][1]);
      if (need <= d || i === line.length - 1) { const k = d ? Math.min(1, need / d) : 0; return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * k, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * k]; }
      need -= d;
    }
    return line[line.length - 1];
  }

  function pushRoute(force) {
    if (!map || !src('b-route')) return;
    const r = S.wantRoute ? S.args.route : null;
    if (!force && S.routeDrawn === r) return;
    S.routeDrawn = r;
    const lineF = (lines) => FC(lines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } })));
    if (!r) {
      ['b-route', 'b-short', 'b-ride', 'b-points', 'b-wave', 'b-runner'].forEach((id) => src(id) && src(id).setData(FC()));
      return;
    }
    const safe = r.transit ? r.transit.legs : [r.safe.line];
    const short = r.transit ? r.transit.short_legs : [r.short.line];
    S.safeLines = safe;
    src('b-route').setData(lineF(safe));
    src('b-short').setData(lineF(short));
    src('b-ride').setData(r.transit ? lineF([r.transit.ride]) : FC());
    const pts = [];
    if (r.transit) r.transit.stops.forEach((s) => pts.push({ type: 'Feature', properties: { k: 'stop' }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } }));
    if (r.bayes && r.bayes.at) pts.push({ type: 'Feature', properties: { k: 'worst' }, geometry: { type: 'Point', coordinates: r.bayes.at } });
    src('b-points').setData(FC(pts));
  }

  function animate(now) {
    const r = S.wantRoute && S.args.route;
    if (!r || !src('b-route')) return;
    const P = pal();
    const waveK = Math.max(0, Math.min(1, (now - S.waveT0) / 900));
    const wave = (r.transit ? r.transit.wave : r.wave) || [];
    const waveFade = Math.max(0, 1 - Math.max(0, now - S.waveT0 - 900) / 1100);
    const wn = waveFade > 0 ? Math.ceil(wave.length * waveK) : 0;
    if (wn !== S.waveN) { S.waveN = wn; src('b-wave').setData(FC(wave.slice(0, wn).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } })))); }
    setPaint('b-wave', 'circle-opacity', 0.75 * waveFade);
    const k = Math.max(0, Math.min(1, (now - S.routeT0) / 1700));
    if (k !== S.drawK) {
      S.drawK = k;
      const tr = 'rgba(0,0,0,0)';
      setPaint('b-route', 'line-gradient', k >= 1 ? ['step', ['line-progress'], P.route, 2, P.route] : ['step', ['line-progress'], P.route, Math.max(0.0001, k), tr]);
      setPaint('b-route-casing', 'line-gradient', k >= 1 ? ['step', ['line-progress'], P.routeCasing, 2, P.routeCasing] : ['step', ['line-progress'], P.routeCasing, Math.max(0.0001, k), tr]);
      if (!S.cmpOpen) { setPaint('b-route-glow', 'line-opacity', (isNight() ? 0.55 : 0.28) * k); setPaint('b-short', 'line-opacity', 0.85 * k); }
      setPaint('b-ride', 'line-opacity', 0.95 * k);
      setPaint('b-ride-casing', 'line-opacity', 0.95 * k);
      if (!S.cmpOpen) { setPaint('b-route-arrows', 'text-opacity', k >= 1 ? 0.95 : 0); setPaint('b-ride-arrows', 'text-opacity', k >= 1 ? 0.95 : 0); }
    }
    if (k >= 1 && S.safeLines) {
      const sec = now / 1000;
      const runner = S.safeLines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pointAt(l, (sec * 0.12) % 1) } }));
      src('b-runner').setData(FC(runner));
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!map || !S.city || !S.args || document.hidden) return;
    if (now - (S.lastAnim || 0) > 33) { S.lastAnim = now; animate(now); animateCompare(now); }
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
    const bearing = (map ? map.getBearing() : 0) * Math.PI / 180;
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
    $('t-build').textContent = t('build'); $('t-walk').textContent = t('walk_btn'); $('t-legend').textContent = t('legend'); $('t-leg-lo').textContent = t('lo'); $('t-leg-hi').textContent = t('hi');
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
    const badge = S.city && S.city.demo ? t('demo') : S.noTiles ? t('notiles') : wx.fallback ? t('wxfall') : '';
    $('badge').hidden = !badge; $('badge').textContent = badge;
    $('src-name').textContent = placeName(S.src); $('dst-name').textContent = placeName(S.dst);
    $('slot-src').classList.toggle('on', S.picking === 'src'); $('slot-dst').classList.toggle('on', S.picking === 'dst');
    if ($('sp-sub')) $('sp-sub').textContent = t('sp', { t: num(Math.round(now.temp)) });
    renderResult();
    applyStyle(); syncMarkers(); pushRoute(false);
    if (!$('brain').hidden) renderBrain();
    if (!$('marks').hidden) renderMarks();
    if (!$('algos').hidden) renderAlgos();
    $('btn-locate').setAttribute('aria-label', t('geo_me'));
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
    $('btn-cmp').innerHTML = t('cmp_btn') + ' <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>';
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
    const st = S.city.stats || { nodes: 0, edges: 0 };
    if (r) {
      const x = r.transit ? r.transit.expanded : r.safe.expanded;
      html += step(3, t('s3'), t('s3a'), io([
        ['in', t('s3in', { n: st.nodes.toLocaleString('ru-RU'), e: st.edges.toLocaleString('ru-RU') })],
        ['calc', t('s3calc', { a: a.params.alpha, b: num(a.params.beta * a.wind_k, 2) })],
        ['out', '<b>' + t('s3out', { x, y: r.expanded_short }) + '</b>'],
      ]) + '<p class="say">' + t('s3say') + '</p><button class="btn2" id="brain-cmp" style="margin-top:10px">' + t('brain_cmp') + '</button>');
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
      html += step(3, t('s3'), t('s3a'), io([['in', t('s3in', { n: st.nodes.toLocaleString('ru-RU'), e: st.edges.toLocaleString('ru-RU') })]]) + '<p class="empty">' + t('s3empty') + '</p>');
      html += step(4, t('s4'), t('s4a'), '<p class="empty">' + t('s3empty') + '</p>');
    }
    body.innerHTML = html + '<p class="assume">' + t('assume') + '</p>';
    const bc = $('brain-cmp'); if (bc) bc.onclick = () => openAlgos();
  }

  async function predictAt(lon, lat) {
    const [r0, q0] = tileKey(lon, lat).split('_').map(Number);
    const near = [];
    for (let r = r0 - 1; r <= r0 + 1; r++) for (let q = q0 - 1; q <= q0 + 1; q++) near.push(loadTile(r + '_' + q));
    let best = null, bd = Infinity;
    (await Promise.all(near)).forEach((f) => { if (f) f.mid.forEach((c, i) => { const d = ((c[0] - lon) * 0.63) ** 2 + (c[1] - lat) ** 2; if (d < bd) { bd = d; best = f[i]; } }); });
    const risk = best && S.riskTable ? S.riskTable[best.properties.m] / 100 : 0;
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
    $('m-clear').onclick = () => { S.marks = []; store.set('boran.marks', []); renderMarks(); pushMarks(); };
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
      const which = S.picking; S.picking = null;
      choose(which, { lon: +lon.toFixed(5), lat: +lat.toFixed(5) }); return;
    }
    if (S.markMode) {
      const pop = $('mark-pop');
      pop.style.left = info.x + 'px'; pop.style.top = info.y + 'px';
      const col = { ice: 'var(--bad)', packed: 'var(--warn)', dry: 'var(--ok)' };
      pop.innerHTML = ['ice', 'packed', 'dry'].map((c) => '<button data-c="' + c + '"><i style="background:' + col[c] + '"></i>' + t('m_' + c) + '</button>').join('');
      pop.hidden = false;
      pop.querySelectorAll('button').forEach((b) => { b.onclick = async () => {
        const pr = await predictAt(lon, lat);
        S.marks.push({ t: new Date().toISOString(), lon: +lon.toFixed(5), lat: +lat.toFixed(5), actual: b.dataset.c, pred: pr.pred, risk: +pr.risk.toFixed(2), scenario: S.args.scenario });
        store.set('boran.marks', S.marks); pop.hidden = true; toast(t('m_saved')); pushMarks();
        if (!$('marks').hidden) renderMarks();
      }; });
    }
  }

  function fitRoute(r) {
    const lines = r.transit ? r.transit.legs.concat([r.transit.ride]) : [r.safe.line, r.short.line];
    let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
    lines.forEach((l) => l.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
    const mobile = window.innerWidth <= 760, H = window.innerHeight;
    const padding = mobile ? { top: 170, bottom: Math.min(H * 0.56, H - 280), left: 40, right: 40 } : { top: 130, bottom: 90, left: 460, right: 120 };
    const cam = map.cameraForBounds([[x0, y0], [x1, y1]], { padding, maxZoom: 16.4, bearing: -12 });
    if (cam) map.flyTo({ center: cam.center, zoom: Math.min(16.4, cam.zoom), bearing: -12, pitch: 45, duration: 2400, essential: true });
  }

  function startSplash() {
    const sp = $('splash');
    const done = () => {
      if (S.splashDone) return; S.splashDone = true;
      sp.classList.add('out'); setTimeout(() => sp.remove(), 950);
      const c = S.args.places.find((p) => p.id === 'campus');
      map.easeTo({ bearing: 28, duration: 2600, easing: (x) => x });
      setTimeout(() => { if (!(S.wantRoute && S.args.route)) map.flyTo({ center: [c.lon, c.lat], zoom: 15.3, pitch: 60, bearing: 18, duration: 5200, essential: true }); }, 2650);
    };
    const quick = /[?&]quick/.test(location.search) || navigator.webdriver;
    sp.addEventListener('pointerdown', done);
    setTimeout(done, quick ? 50 : 3600);
  }

  const ALGO_COL = { bfs: '#7C4DFF', dfs: '#FF6D00', ucs: '#00A389', greedy: '#E6A700', astar: '#1E88E5' };
  const ALGO_NAME = { bfs: 'BFS', dfs: 'DFS', ucs: 'UCS', greedy: 'Greedy', astar: 'A*' };
  const inBox = (lon, lat) => { const [s, w, n, e] = S.city.bbox; return lon >= w && lon <= e && lat >= s && lat <= n; };

  function pushCompare() {
    if (!map || !src('b-cmp')) return;
    const c = S.cmpOpen && S.cmp ? S.cmp : null;
    if (!c) { src('b-cmp').setData(FC()); src('b-cmp-wave').setData(FC()); setRouteDim(false); return; }
    const feats = c.results.filter((r) => r.found).map((r) => ({ type: 'Feature', properties: { a: r.algo, sel: r.algo === S.cmpSel ? 1 : 0, c: ALGO_COL[r.algo] }, geometry: { type: 'LineString', coordinates: r.line } }));
    feats.sort((a, b) => a.properties.sel - b.properties.sel);
    src('b-cmp').setData(FC(feats));
    setRouteDim(true);
    S.cmpWaveT0 = performance.now(); S.cmpWaveN = -1;
  }
  function setRouteDim(on) {
    ['b-route', 'b-route-casing'].forEach((id) => setPaint(id, 'line-opacity', on ? 0.18 : 1));
    setPaint('b-route-glow', 'line-opacity', on ? 0 : (isNight() ? 0.55 : 0.28));
    setPaint('b-short', 'line-opacity', on ? 0 : 0.85);
    setPaint('b-runner', 'circle-opacity', on ? 0 : 1);
    setPaint('b-route-arrows', 'text-opacity', on || (S.drawK || 0) < 1 ? 0 : 0.95);
    setPaint('b-runner', 'circle-stroke-opacity', on ? 0 : 1);
  }
  function animateCompare(now) {
    if (!S.cmpOpen || !S.cmp || !src('b-cmp-wave')) return;
    const r = S.cmp.results.find((x) => x.algo === S.cmpSel);
    if (!r || !r.found) return;
    const k = Math.min(1, (now - S.cmpWaveT0) / 1600);
    const n = Math.ceil(r.wave.length * k);
    if (n !== S.cmpWaveN) {
      S.cmpWaveN = n;
      src('b-cmp-wave').setData(FC(r.wave.slice(0, n).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))));
      setPaint('b-cmp-wave', 'circle-color', ALGO_COL[S.cmpSel]);
    }
  }

  function renderAlgos() {
    const body = $('algos-body');
    $('t-algos-title').textContent = t('cmp_title');
    const c = S.cmp;
    if (!c) { body.innerHTML = '<p class="empty">' + (S.cmpPending ? t('cmp_wait') : t('cmp_need')) + '</p>'; return; }
    const res = c.results;
    const maxExp = Math.max(...res.filter((r) => r.found).map((r) => r.expanded));
    let html = '<p class="cmp-intro">' + t('cmp_intro') + '</p><div class="algo-list">';
    for (const r of res) {
      const sel = r.algo === S.cmpSel;
      html += '<button class="algo' + (sel ? ' sel' : '') + '" data-a="' + r.algo + '" style="--c:' + ALGO_COL[r.algo] + '">'
        + '<div class="algo-h"><i></i><b>' + ALGO_NAME[r.algo] + '</b><span>' + t('al_' + r.algo) + '</span>' + (r.best_cost ? '<em>' + t('cmp_opt') + '</em>' : '') + '</div>';
      if (!r.found) { html += '<div class="algo-m">' + t('cmp_nf') + '</div></button>'; continue; }
      html += '<div class="algo-bar"><i style="width:' + Math.max(2, (r.expanded / maxExp) * 100).toFixed(1) + '%"></i></div>'
        + '<div class="algo-m"><span><b>' + r.expanded.toLocaleString('ru') + '</b> ' + t('cmp_exp') + '</span><span><b>' + num(r.length / 1000, 1) + '</b> ' + t('km') + '</span><span>' + t('risk') + ' <b>' + num(r.fall * 100, 1) + '%</b></span><span><b>' + num(r.ms, 1) + '</b> ' + t('ms_') + '</span></div>'
        + (sel ? '<p class="algo-why">' + t('aw_' + r.algo) + '</p>' : '') + '</button>';
    }
    html += '</div><p class="assume">' + t('cmp_note') + '</p>';
    body.innerHTML = html;
    body.querySelectorAll('.algo').forEach((b) => { b.onclick = () => { S.cmpSel = b.dataset.a; renderAlgos(); pushCompare(); fitCompare(); }; });
  }

  function fitCompare() {
    if (!S.cmp || !map) return;
    const r = S.cmp.results.find((x) => x.algo === S.cmpSel && x.found);
    const pts = (r ? r.line : []).concat([S.cmp.src, S.cmp.dst]);
    const [s, w, n, e] = S.city.bbox;
    let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
    pts.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    x0 = Math.max(x0, w); x1 = Math.min(x1, e); y0 = Math.max(y0, s); y1 = Math.min(y1, n);
    const mobile = window.innerWidth <= 760, H = window.innerHeight;
    const padding = mobile ? { top: 90, bottom: H * 0.52, left: 24, right: 24 } : { top: 110, bottom: 80, left: 420, right: 460 };
    const cam = map.cameraForBounds([[x0, y0], [x1, y1]], { padding, maxZoom: 16, bearing: -12 });
    if (cam) map.flyTo({ center: cam.center, zoom: cam.zoom, bearing: -12, pitch: 40, duration: 1600, essential: true });
  }

  function openAlgos() {
    if (!S.src || !S.dst) { toast(t('need')); return; }
    $('brain').hidden = true; $('marks').hidden = true; $('algos').hidden = false;
    S.cmpOpen = true; S.cmpSel = S.cmpSel || 'astar';
    const key = JSON.stringify([S.src.lon, S.src.lat, S.dst.lon, S.dst.lat, S.scenario]);
    if (!S.cmp || S.cmpKey !== key) {
      S.cmp = null; S.cmpKey = key; S.cmpPending = true; S.wantCompare = true;
      if (!S.wantRoute) S.wantRoute = true;
      renderAlgos(); send();
    } else { renderAlgos(); pushCompare(); fitCompare(); }
    if (window.innerWidth <= 760) $('panel').classList.add('min');
  }
  function closeAlgos() { $('algos').hidden = true; S.cmpOpen = false; pushCompare(); }

  let geoTimer = null;
  async function geocode(q) {
    const [s, w, n, e] = S.city.bbox;
    const local = [];
    const ql = q.toLowerCase();
    S.args.places.forEach((p) => { const nm = p.name[S.lang] || p.name.ru; if (nm.toLowerCase().includes(ql)) local.push({ name: nm, sub: '', lon: p.lon, lat: p.lat, id: p.id }); });
    S.city.warm.forEach((m) => { if (m.name && m.name.toLowerCase().includes(ql)) local.push({ name: m.name, sub: m.kind === 'mall' ? t('mall') : t('cafe'), lon: m.lon, lat: m.lat }); });
    S.city.stops.forEach((m) => { if (m.name && m.name.toLowerCase().includes(ql)) local.push({ name: m.name, sub: t('stop'), lon: m.lon, lat: m.lat }); });
    let remote = [];
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&bounded=1&accept-language=' + (S.lang === 'en' ? 'en' : S.lang === 'kk' ? 'kk,ru' : 'ru') + '&viewbox=' + [w, n, e, s].join(',') + '&q=' + encodeURIComponent(q);
      const js = await fetch(url, { headers: { 'Accept': 'application/json' } }).then((r) => r.json());
      remote = js.map((x) => ({ name: x.name || x.display_name.split(',')[0], sub: x.display_name.split(',').slice(1, 3).join(',').trim(), lon: +x.lon, lat: +x.lat })).filter((x) => inBox(x.lon, x.lat));
    } catch (err) { remote = []; }
    const seen = new Set(), out = [];
    for (const r of local.slice(0, 6).concat(remote)) { const k = r.name + '|' + r.lon.toFixed(3) + r.lat.toFixed(3); if (!seen.has(k)) { seen.add(k); out.push(r); } }
    return out.slice(0, 10);
  }

  function choose(which, p) {
    S[which] = p; S.wantRoute = false; S.cmp = null;
    $('place-list').hidden = true; renderAll();
    if (map) map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15), duration: 1200 });
    readyPulse();
  }

  function readyPulse() {
    const b = $('btn-go');
    b.classList.remove('ready'); void b.offsetWidth;
    if (S.src && S.dst) b.classList.add('ready');
  }
  let NAV = null;
  const NAV_HIDE = /^b-(?!landmarks|heat)/;
  function navLayers(show) {
    if (!map || !map.getStyle()) return;
    map.getStyle().layers.forEach((L) => { if (NAV_HIDE.test(L.id)) map.setLayoutProperty(L.id, 'visibility', show ? 'visible' : 'none'); });
  }
  function navStart() { closeAlgos(); $('brain').hidden = true; $('marks').hidden = true; navLayers(false); }
  function navExit() { navLayers(true); const r = S.wantRoute && S.args.route; if (r) fitRoute(r); renderAll(); }
  function startWalk(r) {
    if (!NAV || !r) return;
    NAV.start(r);
  }

  function briefData() {
    const w = S.args.weather, now = w.now, h = S.args.hmm;
    const ice = Math.round(100 * ((h.now[h.states.indexOf('ice')] || 0) + 0.4 * (h.now[h.states.indexOf('packed')] || 0)));
    const feel = Math.round(now.apparent), wind = Math.round(now.wind);
    const head = feel <= -25 ? 'b_h_extreme' : feel <= -8 ? 'b_h_cold' : wind >= 9 ? 'b_h_wind' : ice >= 45 ? 'b_h_ice' : feel <= 2 ? 'b_h_cold' : 'b_h_mild';
    const items = [];
    items.push(['coat', t(feel <= -25 ? 'b_i_extreme' : feel <= -10 ? 'b_i_cold' : feel <= 0 ? 'b_i_mild' : 'b_i_light')]);
    if (ice >= 25) items.push(['ice', t('b_i_ice', { p: ice })]);
    if (wind >= 6) items.push(['wind', t('b_i_wind', { w: wind })]);
    if (now.snow > 0.05) items.push(['snow', t('b_i_snow')]);
    if (w.night) items.push(['dark', t('b_i_dark')]);
    if (feel <= -15) items.push(['phone', t('b_i_phone')]);
    return { now, feel, wind, ice, head, items };
  }
  const BRIEF_ICO = {
    coat: '<svg viewBox="0 0 24 24"><path d="M9 3l3 2 3-2 4 3-2 4-2-1v12H9V9L7 10 5 6z"/></svg>',
    ice: '<svg viewBox="0 0 24 24"><path d="M12 2v20M4 7l16 10M20 7L4 17"/></svg>',
    wind: '<svg viewBox="0 0 24 24"><path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3"/></svg>',
    snow: '<svg viewBox="0 0 24 24"><path d="M12 3v18M5 7.5l14 9M19 7.5l-14 9"/><circle cx="12" cy="12" r="2"/></svg>',
    dark: '<svg viewBox="0 0 24 24"><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    bus: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 21v-3M16 21v-3"/></svg>',
  };
  function openBrief() {
    const b = $('brief');
    clearTimeout(S.briefAuto);
    S.brief = { t0: performance.now(), route: null, key: null };
    renderBrief();
    b.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('on')));
  }
  function renderBrief() {
    if (!S.brief) return;
    const d = briefData(), r = S.brief.route, b = $('brief');
    const fmt = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
    let route = '<p class="br-route wait"><i></i>' + t('b_r_wait') + '</p>';
    if (r) {
      const tr = r.transit, s = r.safe, adv = r.mdp && r.mdp.best;
      route = tr && adv === 'transit'
        ? '<p class="br-route">' + BRIEF_ICO.bus + t('b_r_bus', { min: Math.round(tr.total_min), w: Math.round(tr.walk.minutes) }) + '</p>'
        : '<p class="br-route">' + t('b_r_walk', { min: Math.round(s.minutes), km: (s.length / 1000).toFixed(1).replace('.', S.lang === 'en' ? '.' : ','), p: (s.fall * 100).toFixed(1).replace('.', S.lang === 'en' ? '.' : ',') }) + '</p>';
      if (tr && adv === 'transit') d.items.push(['bus', t('b_i_bus')]);
    }
    b.innerHTML = '<div class="br">'
      + '<div class="br-l"><p class="br-k">' + t('b_title') + '</p><div class="br-temp">' + fmt(Math.round(d.now.temp)) + '°</div>'
      + '<p class="br-feels">' + t('b_feels', { t: fmt(d.feel) }) + '<br>' + t('b_wind', { w: d.wind, h: Math.round(d.now.hum) }) + '</p></div>'
      + '<div class="br-r"><h2 class="br-h">' + t(d.head) + '</h2><ul class="br-list">'
      + d.items.map(([k, txt], i) => '<li style="--i:' + i + '">' + BRIEF_ICO[k] + '<span>' + txt + '</span></li>').join('') + '</ul>' + route
      + '<div class="br-act"><button class="cta br-go"' + (r ? '' : ' disabled') + '><span>' + t('b_go') + '</span><i></i></button><button class="btn2 br-map">' + t('b_map') + '</button></div></div></div>';
    b.querySelector('.br-go').onclick = () => closeBrief(true);
    b.querySelector('.br-map').onclick = () => closeBrief(false);
  }
  function briefRoute(r) {
    if (!S.brief || $('brief').hidden) return;
    S.brief.route = r;
    renderBrief();
    const wait = Math.max(1800, 5200 - (performance.now() - S.brief.t0));
    const go = $('brief').querySelector('.br-go i');
    if (go) go.style.animationDuration = wait + 'ms';
    clearTimeout(S.briefAuto);
    S.briefAuto = setTimeout(() => closeBrief(true), wait);
  }
  function closeBrief(go) {
    clearTimeout(S.briefAuto);
    const b = $('brief');
    if (b.hidden) return;
    const r = S.brief && S.brief.route;
    S.brief = null;
    b.classList.remove('on');
    setTimeout(() => { b.hidden = true; b.innerHTML = ''; }, 450);
    if (go && r) startWalk(r);
    else if (r) { S.waveT0 = performance.now(); S.routeT0 = S.waveT0 + 600; S.drawK = null; S.waveN = -1; fitRoute(r); }
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('brief').hidden) closeBrief(false);
    else if (NAV && NAV.active()) NAV.stop();
  });

  let userMarker = null;
  function locate(which) {
    if (!navigator.geolocation) { toast(t('geo_no')); return; }
    toast(t('geo_wait'));
    navigator.geolocation.getCurrentPosition((pos) => {
      const lon = +pos.coords.longitude.toFixed(5), lat = +pos.coords.latitude.toFixed(5);
      if (!userMarker) userMarker = new ML.Marker({ element: el('div', 'me', '<i></i>') }).setLngLat([lon, lat]).addTo(map);
      else userMarker.setLngLat([lon, lat]);
      if (!inBox(lon, lat)) { toast(t('geo_out')); map.flyTo({ center: [lon, lat], zoom: 13, duration: 1500 }); return; }
      choose(which || 'src', { lon, lat, label: t('geo_me') });
    }, (err) => { toast(err && err.code === 1 ? t('geo_denied') : t('geo_fail')); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  function openPlaces(which) {
    S.picking = null;
    const box = $('place-list');
    if (!box.hidden && box.dataset.which === which) { box.hidden = true; renderAll(); return; }
    box.dataset.which = which; box.innerHTML = ''; box.hidden = false;
    const input = el('input', 'place-q'); input.type = 'search'; input.placeholder = t('search_ph'); input.setAttribute('aria-label', t('search_ph'));
    const list = el('div', 'place-res');
    box.append(input, list);
    const icon = { campus: '🎓', dorm: '🏠', landmark: '★', mall: '🛍' };
    const add = (ic, name, sub, fn) => { const b = el('button', '', '<i>' + ic + '</i><span>' + esc(name) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '')); b.onclick = fn; list.append(b); };
    const defaults = () => {
      list.innerHTML = '';
      add('◎', t('geo_me'), '', () => locate(which));
      add('⌖', t('pick'), '', () => { S.picking = which; box.hidden = true; toast(t('tap')); renderAll(); });
      S.args.places.forEach((p) => add(icon[p.kind] || '•', p.name[S.lang] || p.name.ru, '', () => choose(which, { id: p.id, lon: p.lon, lat: p.lat })));
      S.city.warm.filter((x) => x.kind === 'mall' && x.name).slice(0, 8).forEach((m) => add(icon.mall, m.name, t('mall'), () => choose(which, { lon: m.lon, lat: m.lat, label: m.name })));
    };
    defaults();
    input.addEventListener('input', () => {
      clearTimeout(geoTimer);
      const q = input.value.trim();
      if (q.length < 2) { defaults(); return; }
      geoTimer = setTimeout(async () => {
        list.innerHTML = '<p class="empty">' + t('searching') + '</p>';
        const res = await geocode(q);
        if (input.value.trim() !== q) return;
        list.innerHTML = '';
        if (!res.length) { list.innerHTML = '<p class="empty">' + t('notfound') + '</p>'; return; }
        res.forEach((r) => add(r.id ? (icon[S.args.places.find((p) => p.id === r.id).kind] || '•') : '•', r.name, r.sub, () => choose(which, r.id ? { id: r.id, lon: r.lon, lat: r.lat } : { lon: +r.lon.toFixed(5), lat: +r.lat.toFixed(5), label: r.name })));
      }, 380);
    });
    setTimeout(() => { if (window.innerWidth > 760) input.focus(); }, 60);
    $('slot-' + which).classList.add('on'); $('slot-' + (which === 'src' ? 'dst' : 'src')).classList.remove('on');
  }

  $('slot-src').onclick = () => openPlaces('src');
  $('slot-dst').onclick = () => openPlaces('dst');
  $('btn-swap').onclick = () => { const a = S.src; S.src = S.dst; S.dst = a; S.wantRoute = false; S.cmp = null; renderAll(); readyPulse(); };
  $('btn-go').onclick = () => {
    if (!S.src || !S.dst) { toast(t('need')); return; }
    $('place-list').hidden = true; S.picking = null;
    if (S.cmpOpen) { S.wantCompare = true; S.cmp = null; S.cmpPending = true; renderAlgos(); }
    S.wantRoute = true; S.pendingRoute = true; S.routeKey = null; $('btn-go').classList.add('busy'); $('btn-go').classList.remove('ready');
    if (NAV && NAV.active()) NAV.stop(true);
    openBrief();
    send();
    clearTimeout(S.retry1); clearTimeout(S.retry2);
    S.retry1 = setTimeout(() => { if (S.pendingRoute) { toast(t('slow')); send(); } }, 9000);
    S.retry2 = setTimeout(() => { if (S.pendingRoute) { S.pendingRoute = false; $('btn-go').classList.remove('busy'); toast(t('noanswer')); if (S.brief) closeBrief(false); } }, 26000);
  };
  $('btn-walk').onclick = () => { const r = S.wantRoute && S.args.route; if (r) startWalk(r); };
  $('btn-why').onclick = () => { $('marks').hidden = true; closeAlgos(); $('brain').hidden = false; renderBrain(); };
  $('btn-cmp').onclick = () => openAlgos();
  $('algos-x').onclick = () => closeAlgos();
  $('btn-locate').onclick = () => locate('src');
  $('btn-brain').onclick = () => { const b = $('brain'); $('marks').hidden = true; closeAlgos(); b.hidden = !b.hidden; if (!b.hidden) renderBrain(); };
  $('brain-x').onclick = () => { $('brain').hidden = true; };
  $('marks-x').onclick = () => { $('marks').hidden = true; };
  $('btn-lang').onclick = () => { S.lang = LANGS[(LANGS.indexOf(S.lang) + 1) % LANGS.length]; store.set('boran.lang', S.lang); renderAll(); };
  $('btn-theme').onclick = () => { S.themeForce = isNight() ? 'day' : 'night'; document.body.classList.toggle('night', isNight()); document.body.classList.toggle('day', !isNight()); renderAll(); };
  $('btn-ice').onclick = () => {
    S.markMode = !S.markMode; $('btn-ice').setAttribute('aria-pressed', String(S.markMode)); $('mark-pop').hidden = true;
    if (S.markMode) { $('brain').hidden = true; closeAlgos(); $('marks').hidden = false; renderMarks(); toast(t('m_hint')); $('panel').classList.add('min'); } else { $('marks').hidden = true; toast(t('m_off')); }
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
      b.onclick = () => { m.hidden = true; S.scenario = k; S.routeKey = null; send(); };
      m.append(b);
    });
    m.hidden = false;
  };
  $('panel-handle').onclick = () => $('panel').classList.toggle('min');
  $('wx').onclick = () => $('wx').classList.toggle('open');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('brain').hidden = true; closeAlgos(); $('marks').hidden = true; $('scn-menu').hidden = true; $('place-list').hidden = true; S.picking = null; if (S.args) renderAll(); } });
  window.__boran = S;
})();
