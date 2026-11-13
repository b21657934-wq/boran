(function () {
  const EC = 40075016.686;
  const RAD = Math.PI / 180;
  const HALF = { trunk: 11, primary: 9.5, secondary: 7.5, tertiary: 6, unclassified: 3.75, residential: 3.75, living_street: 3.75, service: 2.25 };
  const TRAFFIC = { trunk: 3, primary: 2, secondary: 2, tertiary: 1 };
  const VMAX = { trunk: 16, primary: 14, secondary: 13, tertiary: 10 };
  const CAR_COLS = ['#F4F5F7', '#C9CFD6', '#2A2E35', '#1F3A5F', '#8E1B24', '#E8B22E', '#5B6B7A', '#E9EDF1', '#3B4A3F', '#B9BEC4'];
  const COATS = ['#2F3B4C', '#7A2E2E', '#2E5E4E', '#4B3F72', '#8A6D3B', '#1F2933', '#A3472E', '#36506B'];
  const BASE = 2.2;
  const WALK = 1.4;
  const BUS = 5.5;
  const CYCLE = [13, 2, 11, 2];
  const CYCLE_T = CYCLE.reduce((a, b) => a + b, 0);
  const LAMP = { red: '#FF3B30', amber: '#FFC400', green: '#2BD96B', off: '#2A3038' };

  function rng(seed) { let s = Math.floor(Math.abs(seed)) % 2147483647 || 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
  const unit = (x, y) => { const d = Math.hypot(x, y); return d > 1e-9 ? [x / d, y / d] : [0, 1]; };
  const headingOf = (v) => (Math.atan2(v[0], v[1]) / RAD + 360) % 360;

  class Frame {
    constructor(lon, lat) { this.lon0 = lon; this.lat0 = lat; this.kx = 111320 * Math.cos(lat * RAD); this.ky = 110540; }
    xy(p) { return [(p[0] - this.lon0) * this.kx, (p[1] - this.lat0) * this.ky]; }
    ll(p) { return [this.lon0 + p[0] / this.kx, this.lat0 + p[1] / this.ky]; }
  }

  class Path {
    constructor(pts) {
      const clean = [];
      for (const p of pts) if (!clean.length || Math.hypot(p[0] - clean[clean.length - 1][0], p[1] - clean[clean.length - 1][1]) > 0.05) clean.push(p);
      if (clean.length === 1) clean.push([clean[0][0] + 0.01, clean[0][1] + 0.01]);
      this.pts = clean;
      this.cum = [0];
      for (let i = 1; i < clean.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]));
      this.len = this.cum[this.cum.length - 1];
    }
    seg(s) {
      let lo = 0, hi = this.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
      return lo;
    }
    pos(s) {
      const P = this.pts;
      if (s <= 0) { const t = this.tangent(0, 0.5); return [P[0][0] + t[0] * s, P[0][1] + t[1] * s]; }
      if (s >= this.len) { const t = this.tangent(this.len, 0.5); const e = s - this.len; return [P[P.length - 1][0] + t[0] * e, P[P.length - 1][1] + t[1] * e]; }
      const i = this.seg(s), L = this.cum[i + 1] - this.cum[i], k = L > 0 ? (s - this.cum[i]) / L : 0;
      return [P[i][0] + (P[i + 1][0] - P[i][0]) * k, P[i][1] + (P[i + 1][1] - P[i][1]) * k];
    }
    tangent(s, w = 3) {
      const P = this.pts;
      if (s <= 0 && w < 1) return unit(P[1][0] - P[0][0], P[1][1] - P[0][1]);
      if (s >= this.len && w < 1) { const n = P.length; return unit(P[n - 1][0] - P[n - 2][0], P[n - 1][1] - P[n - 2][1]); }
      const a = this.pos(clamp(s - w, 0, this.len)), b = this.pos(clamp(s + w, 0, this.len));
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d < 1e-6) { const i = this.seg(clamp(s, 0, this.len)); const j = Math.min(P.length - 1, i + 1); return unit(P[j][0] - P[i][0], P[j][1] - P[i][1]); }
      return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
    }
    slice(a, b, extA = 0, extB = 0) {
      const out = [];
      if (extA > 0) { const t = this.tangent(a, 4); const p = this.pos(a); out.push([p[0] - t[0] * extA, p[1] - t[1] * extA]); }
      out.push(this.pos(a));
      for (let i = 0; i < this.pts.length; i++) if (this.cum[i] > a && this.cum[i] < b) out.push(this.pts[i]);
      out.push(this.pos(b));
      if (extB > 0) { const t = this.tangent(b, 4); const p = this.pos(b); out.push([p[0] + t[0] * extB, p[1] + t[1] * extB]); }
      return new Path(out);
    }
  }

  function rect(F, c, h, len, wid, back = 0) {
    const f = [Math.sin(h * RAD), Math.cos(h * RAD)], r = [f[1], -f[0]];
    const cx = c[0] - f[0] * back, cy = c[1] - f[1] * back, a = len / 2, b = wid / 2;
    const ring = [[a, b], [a, -b], [-a, -b], [-a, b], [a, b]].map(([u, v]) => F.ll([cx + f[0] * u - r[0] * v, cy + f[1] * u - r[1] * v]));
    return [ring];
  }
  function disc(F, c, r, n = 10) {
    const ring = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; ring.push(F.ll([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r])); }
    return [ring];
  }
  const ext = (geom, b, h, color, extra) => ({ type: 'Feature', properties: Object.assign({ b, h, c: color }, extra), geometry: { type: 'Polygon', coordinates: geom } });
  const flat = (geom, color, o = 1) => ({ type: 'Feature', properties: { c: color, o }, geometry: { type: 'Polygon', coordinates: geom } });

  function buildWalk(F, line, plan, pre = 0, post = 0) {
    const base = new Path(line.map((p) => F.xy(p)));
    const scale = plan && plan.length ? Math.max(0.5, (base.len - pre - post) / plan.length) : 1;
    const segs = (plan && plan.segs) || [];
    const hwAt = (s) => { const d = (s - pre) / scale; if (d < 0) return null; for (let i = segs.length - 1; i >= 0; i--) if (segs[i][0] <= d + 0.01) return segs[i][1]; return null; };
    const P = base.pts, n = P.length, C = base.cum;
    const offAt = (s) => { const hw = hwAt(s); return HALF[hw] ? HALF[hw] + 2.0 : 0; };
    const ahead = (i) => { let j = i + 1; while (j < n - 1 && C[j] - C[i] < 2.5) j++; return j; };
    const K = [0];
    for (let i = 1; i < n - 1; i++) {
      const last = K[K.length - 1];
      if (C[i] - C[last] < 2.5 || C[n - 1] - C[i] < 2.5) continue;
      const j = ahead(i);
      const d0 = unit(P[i][0] - P[last][0], P[i][1] - P[last][1]), d1 = unit(P[j][0] - P[i][0], P[j][1] - P[i][1]);
      const ang = Math.abs(angDiff(headingOf(d0), headingOf(d1)));
      if (ang > 6 || offAt((C[last] + C[i]) / 2) !== offAt((C[i] + C[j]) / 2)) K.push(i);
    }
    K.push(n - 1);
    const m = K.length, dirs = [], offs = [];
    for (let k = 0; k < m - 1; k++) {
      const a = P[K[k]], b = P[K[k + 1]];
      dirs.push(unit(b[0] - a[0], b[1] - a[1]));
      offs.push(offAt((C[K[k]] + C[K[k + 1]]) / 2));
    }
    const right = (d) => [d[1], -d[0]];
    const out = [];
    for (let k = 0; k < m; k++) {
      const Pk = P[K[k]];
      if (k === 0 || k === m - 1) {
        const q = k === 0 ? 0 : m - 2, r = right(dirs[q]), o = offs[q];
        out.push([Pk[0] + r[0] * o, Pk[1] + r[1] * o]);
        continue;
      }
      const tA = dirs[k - 1], tB = dirs[k], oA = offs[k - 1], oB = offs[k], nA = right(tA), nB = right(tB);
      const pA = [Pk[0] + nA[0] * oA, Pk[1] + nA[1] * oA], pB = [Pk[0] + nB[0] * oB, Pk[1] + nB[1] * oB];
      const cr = tA[0] * tB[1] - tA[1] * tB[0];
      let q = null;
      if (Math.abs(cr) > 0.1) {
        const u = ((pB[0] - pA[0]) * tB[1] - (pB[1] - pA[1]) * tB[0]) / cr;
        q = [pA[0] + tA[0] * u, pA[1] + tA[1] * u];
        if (Math.hypot(q[0] - Pk[0], q[1] - Pk[1]) > 2.5 * Math.max(oA, oB) + 4) q = null;
      }
      if (!q) q = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2];
      out.push(q);
    }
    for (let k = 1; k < m; k++) {
      const d = dirs[k - 1], v = [out[k][0] - out[k - 1][0], out[k][1] - out[k - 1][1]];
      if (v[0] * d[0] + v[1] * d[1] < 0) out[k] = out[k - 1].slice();
    }
    const wcum = [0];
    for (let k = 1; k < m; k++) wcum.push(wcum[k - 1] + Math.hypot(out[k][0] - out[k - 1][0], out[k][1] - out[k - 1][1]));
    const KC = K.map((i) => C[i]);
    const path = new Path(out);
    const toWalk = (sb) => {
      if (sb <= 0) return 0;
      if (sb >= base.len) return wcum[m - 1];
      let lo = 0, hi = m - 1;
      while (hi - lo > 1) { const md = (lo + hi) >> 1; if (KC[md] <= sb) lo = md; else hi = md; }
      const L = KC[lo + 1] - KC[lo], f = L > 0 ? (sb - KC[lo]) / L : 0;
      return wcum[lo] + (wcum[lo + 1] - wcum[lo]) * f;
    };
    const at = (d) => toWalk(pre + d * scale);
    return { base, path, scale, pre, toWalk, at, hwAt };
  }

  class Lane {
    constructor(opt) { Object.assign(this, opt); this.cars = []; this.next = 0; }
    place(s) {
      if (this.line) {
        const sp = this.dir > 0 ? s : this.line.len - s;
        const p = this.line.pos(sp), t = this.line.tangent(sp, 3), n = [-t[1], t[0]];
        return { p: [p[0] + n[0] * this.lat, p[1] + n[1] * this.lat], h: headingOf([t[0] * this.dir, t[1] * this.dir]) };
      }
      return { p: [this.o[0] + this.v[0] * s, this.o[1] + this.v[1] * s], h: this.hd };
    }
    spawn(t, rnd) {
      const last = this.cars[this.cars.length - 1];
      if (t < this.next) return;
      if (last && last.s - last.len / 2 < 6) return;
      const big = rnd() < 0.08;
      this.cars.push({ s: -3, v: this.vmax * (0.75 + rnd() * 0.2), len: big ? 6.4 : 4.4 + rnd() * 0.4, wid: big ? 2.1 : 1.82, hgt: big ? 2.2 : 1.45, c: CAR_COLS[Math.floor(rnd() * CAR_COLS.length)], ign: {} });
      this.next = t + (1.6 + rnd() * 4.5) / this.density;
    }
    step(dt, t, rnd) {
      const cars = this.cars;
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k], lead = k > 0 ? cars[k - 1] : null, front = c.s + c.len / 2;
        let room = Infinity;
        if (lead) room = lead.s - lead.len / 2 - front - 2.2;
        for (const st of this.stops) {
          const dist = st.s - front;
          if (dist < -0.3) { delete c.ign[st.id]; continue; }
          if (!st.red()) { delete c.ign[st.id]; continue; }
          if (c.ign[st.id]) continue;
          if (c.v * c.v / (2 * Math.max(0.2, dist)) > 5.5 && dist < 12) { c.ign[st.id] = 1; continue; }
          room = Math.min(room, dist - 0.4);
        }
        const vdes = Math.min(this.vmax, Math.sqrt(2 * 3.2 * Math.max(0, room)));
        c.v = vdes > c.v ? Math.min(vdes, c.v + 2.4 * dt) : Math.max(vdes, c.v - 8 * dt);
        let s = c.s + c.v * dt;
        if (lead) { const cap = lead.s - lead.len / 2 - c.len / 2 - 1.2; if (s > cap) { s = Math.max(c.s, cap); c.v = Math.min(c.v, lead.v); } }
        c.s = s;
      }
      while (cars.length && cars[0].s - cars[0].len / 2 > this.len) cars.shift();
      if (this.live) this.spawn(t, rnd);
    }
  }

  function create(ctx) {
    const map = ctx.map;
    let run = null;

    function strings() { return ctx.t; }
    function night() { return ctx.isNight(); }

    function addLayers() {
      if (!map.getStyle() || map.getSource('n-flat')) return;
      const firstBld = map.getStyle().layers.find((L) => L.id === 'building' || L.type === 'fill-extrusion');
      const before = firstBld ? firstBld.id : undefined;
      map.addSource('n-flat', { type: 'geojson', data: FC([]), maxzoom: 20 });
      map.addSource('n-walk', { type: 'geojson', data: FC([]), maxzoom: 20 });
      map.addSource('n-static', { type: 'geojson', data: FC([]), maxzoom: 20 });
      map.addSource('n-dyn', { type: 'geojson', data: FC([]), maxzoom: 20, tolerance: 0 });
      map.addSource('n-glass', { type: 'geojson', data: FC([]), maxzoom: 20 });
      map.addSource('n-labels', { type: 'geojson', data: FC([]) });
      const W = (m) => ['interpolate', ['exponential', 2], ['zoom'], 14, m * 0.2, 22, m * 51];
      map.addLayer({ id: 'n-flat', type: 'fill', source: 'n-flat', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': ['get', 'o'] } }, before);
      map.addLayer({ id: 'n-walk', type: 'line', source: 'n-walk', filter: ['==', ['get', 'k'], 'side'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': night() ? '#1F2A3D' : '#DCE3EA', 'line-width': W(2.8) } }, before);
      map.addLayer({ id: 'n-guide', type: 'line', source: 'n-walk', filter: ['==', ['get', 'k'], 'guide'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': night() ? '#7FE7F5' : '#0B9AB5', 'line-opacity': 0.9, 'line-width': W(0.7) } }, before);
      map.addLayer({ id: 'n-static', type: 'fill-extrusion', source: 'n-static', paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-vertical-gradient': false } });
      map.addLayer({ id: 'n-glass', type: 'fill-extrusion', source: 'n-glass', paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.42 } });
      map.addLayer({ id: 'n-dyn', type: 'fill-extrusion', source: 'n-dyn', paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-vertical-gradient': false } });
      map.addLayer({ id: 'n-labels', type: 'symbol', source: 'n-labels', layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, -1.2], 'text-allow-overlap': true },
        paint: { 'text-color': night() ? '#E8F0FF' : '#14324A', 'text-halo-color': night() ? '#0B1220' : '#FFFFFF', 'text-halo-width': 2 } });
      if (run) { run.staticDirty = true; run.flatDirty = true; run.walkDirty = true; }
    }
    function removeLayers() {
      ['n-labels', 'n-dyn', 'n-glass', 'n-static', 'n-guide', 'n-walk', 'n-flat'].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
      ['n-labels', 'n-dyn', 'n-glass', 'n-static', 'n-walk', 'n-flat'].forEach((id) => { if (map.getSource(id)) map.removeSource(id); });
    }
    const FC = (f) => ({ type: 'FeatureCollection', features: f });
    const setData = (id, f) => { const s = map.getSource(id); if (s) s.setData(FC(f)); };

    function crossingScene(F, walk, c, idx, rnd) {
      const C = F.xy(c.at), u = [Math.sin(c.road * RAD), Math.cos(c.road * RAD)], nL = [-u[1], u[0]];
      const sd = (p) => (p[0] - C[0]) * nL[0] + (p[1] - C[1]) * nL[1];
      const dW = walk.at(c.d);
      const edge = c.half + 0.6;
      let sIn = null, sOut = null, sMid = null, prev = null;
      for (let s = Math.max(0, dW - 50); s <= Math.min(walk.path.len, dW + 50); s += 0.5) {
        const v = sd(walk.path.pos(s));
        if (prev !== null) {
          if (sIn === null && Math.abs(prev) > edge && Math.abs(v) <= edge) sIn = s;
          if (sMid === null && prev * v <= 0) sMid = s;
          if (sMid !== null && sOut === null && Math.abs(v) > edge && Math.abs(prev) <= edge) sOut = s;
        }
        prev = v;
      }
      if (sMid === null) sMid = dW;
      if (sIn === null) sIn = Math.max(0, sMid - edge);
      if (sOut === null) sOut = Math.min(walk.path.len, sMid + edge);
      const Z = walk.path.pos(sMid), along = (Z[0] - C[0]) * u[0] + (Z[1] - C[1]) * u[1];
      const Zr = [C[0] + u[0] * along, C[1] + u[1] * along];
      const L = 220, zs = L / 2;
      const X = { id: 'x' + idx, c, u, nL, Zr, sIn, sOut, sMid, half: c.half, sig: c.sig, lanes: [], offset: rnd() * CYCLE_T, yield: false, hw: c.hw, name: c.name };
      X.carRed = () => {
        if (!X.sig) return X.yield;
        const ph = X.phase(run ? run.wt : 0);
        return ph.name !== 'x';
      };
      X.phase = (t) => {
        let q = (t + X.offset) % CYCLE_T, acc = 0;
        const names = ['x', 'c1', 'p', 'c2'];
        for (let i = 0; i < 4; i++) { if (q < acc + CYCLE[i]) return { name: names[i], left: acc + CYCLE[i] - q, i }; acc += CYCLE[i]; }
        return { name: 'x', left: CYCLE[0], i: 0 };
      };
      const lanes = TRAFFIC[c.hw] ? c.lanes : 1, med = c.median || 0;
      const stopS = zs - 4.2;
      for (let i = 0; i < lanes; i++) for (const dir of [1, -1]) {
        const lat = dir > 0 ? -(med + 1.75 + 3.5 * i) : med + 1.75 + 3.5 * i;
        const v = [u[0] * dir, u[1] * dir];
        const o = [Zr[0] - v[0] * zs + nL[0] * lat, Zr[1] - v[1] * zs + nL[1] * lat];
        X.lanes.push(new Lane({ o, v, hd: headingOf(v), len: L, lat, dir, vmax: VMAX[c.hw] || 10, density: c.hw === 'tertiary' ? 0.55 : 1, stops: [{ id: X.id, s: stopS, red: X.carRed }], live: false }));
      }
      X.width = 2 * c.half;
      return X;
    }

    function flatForCrossing(F, X) {
      const out = [], asphalt = night() ? '#1A212C' : '#5C6570', paint = night() ? '#C9D3E0' : '#F4F6F8', snow = night() ? '#2B3647' : '#F7F9FB';
      const h = headingOf(X.u), along = 220;
      out.push(flat(rect(F, X.Zr, h, along, X.width), asphalt));
      const med = X.c.median || 0, lanes = X.lanes.length / 2;
      if (med > 0.6) out.push(flat(rect(F, X.Zr, h, along, med * 2 - 0.4), snow));
      else for (const o of [-0.12, 0.12]) out.push(flat(rect(F, [X.Zr[0] + X.nL[0] * o, X.Zr[1] + X.nL[1] * o], h, along, 0.12), paint));
      for (let k = 1; k < lanes; k++) for (const sgn of [1, -1]) {
        const off = sgn * (med + 3.5 * k);
        for (let s = -along / 2 + 3; s < along / 2; s += 9) {
          if (Math.abs(s) < 6) continue;
          const c = [X.Zr[0] + X.u[0] * s + X.nL[0] * off, X.Zr[1] + X.u[1] * s + X.nL[1] * off];
          out.push(flat(rect(F, c, h, 3, 0.14), paint, 0.85));
        }
      }
      for (let w = -X.half + 0.6; w <= X.half - 0.5; w += 1.0) {
        if (med > 0.6 && Math.abs(w) < med) continue;
        const c = [X.Zr[0] + X.nL[0] * w, X.Zr[1] + X.nL[1] * w];
        out.push(flat(rect(F, c, h, 3.6, 0.5), paint, 0.95));
      }
      for (const sgn of [1, -1]) {
        const s = -sgn * 4.4, mid = sgn > 0 ? -(med + X.half) / 2 : (med + X.half) / 2;
        const c = [X.Zr[0] + X.u[0] * s + X.nL[0] * mid, X.Zr[1] + X.u[1] * s + X.nL[1] * mid];
        out.push(flat(rect(F, c, h, 0.4, X.half - med - 0.3), paint, 0.95));
      }
      return out;
    }

    function staticForCrossing(F, X) {
      const out = [], snow = night() ? '#3A475C' : '#FFFFFF', pole = night() ? '#5A6577' : '#3E4752', h = headingOf(X.u);
      for (const sgn of [1, -1]) for (const side of [1, -1]) {
        const s0 = side * 4.5, s1 = side * 110, mid = (s0 + s1) / 2, len = Math.abs(s1 - s0);
        const off = sgn * (X.half + 0.55);
        const c = [X.Zr[0] + X.u[0] * mid + X.nL[0] * off, X.Zr[1] + X.u[1] * mid + X.nL[1] * off];
        out.push(ext(rect(F, c, h, len, 1.0), 0, 0.55 + 0.1 * ((side + sgn + 2) % 3), snow));
      }
      if (X.sig) {
        X.heads = [];
        for (const sgn of [1, -1]) {
          const off = sgn * (X.half + 1.0), sAlong = -sgn * 3.2;
          const base = [X.Zr[0] + X.u[0] * sAlong + X.nL[0] * off, X.Zr[1] + X.u[1] * sAlong + X.nL[1] * off];
          out.push(ext(rect(F, base, h, 0.16, 0.16), 0, 3.4, pole));
          out.push(ext(rect(F, base, h, 0.36, 0.36, 0), 2.2, 2.95, '#1C2128'));
          X.heads.push({ kind: 'ped', at: [base[0] - X.nL[0] * sgn * 0.22, base[1] - X.nL[1] * sgn * 0.22] });
          const carBase = [X.Zr[0] - X.u[0] * sgn * 6.5 + X.nL[0] * -sgn * (X.half + 1.2), X.Zr[1] - X.u[1] * sgn * 6.5 + X.nL[1] * -sgn * (X.half + 1.2)];
          out.push(ext(rect(F, carBase, h, 0.18, 0.18), 0, 4.6, pole));
          out.push(ext(rect(F, carBase, h, 0.42, 0.42), 3.4, 4.6, '#1C2128'));
          X.heads.push({ kind: 'car', at: [carBase[0] - X.u[0] * sgn * 0.25, carBase[1] - X.u[1] * sgn * 0.25] });
        }
      }
      return out;
    }

    function stopScene(F, ridePath, atEnd, stop, rnd) {
      const s = atEnd ? ridePath.len : 0;
      const p = ridePath.pos(s), t = ridePath.tangent(s, 6), r = [t[1], -t[0]], h = headingOf(t);
      const shelter = [p[0] + r[0] * 8.2, p[1] + r[1] * 8.2];
      const spot = [p[0] + r[0] * 6.4 - t[0] * 1.5, p[1] + r[1] * 6.4 - t[1] * 1.5];
      const st = { shelter, spot, p, t, r, h, name: stop && stop.name ? stop.name : '', people: [] };
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const a = (rnd() - 0.5) * 7, b = 6.6 + rnd() * 2.6;
        st.people.push({ p: [p[0] + t[0] * a + r[0] * b, p[1] + t[1] * a + r[1] * b], coat: COATS[Math.floor(rnd() * COATS.length)], hat: rnd() < 0.7, board: rnd() < 0.75, gone: false, ph: rnd() * 6 });
      }
      return st;
    }

    function staticForStop(F, st, out, glass, labels) {
      const roof = night() ? '#46566E' : '#E9EEF3', post = night() ? '#7B889C' : '#5D6875', bench = '#8A6B4A', snow = night() ? '#3A475C' : '#FFFFFF';
      const { shelter: c, t, r, h } = st;
      for (const a of [-1.9, 1.9]) for (const b of [-0.6, 0.6]) out.push(ext(rect(F, [c[0] + t[0] * a + r[0] * b, c[1] + t[1] * a + r[1] * b], h, 0.1, 0.1), 0, 2.5, post));
      out.push(ext(rect(F, c, h, 4.4, 1.7), 2.5, 2.65, roof));
      out.push(ext(rect(F, [c[0] + r[0] * 0.25, c[1] + r[1] * 0.25], h, 3.6, 0.42), 0.42, 0.48, bench));
      out.push(ext(rect(F, [c[0] + r[0] * 0.8, c[1] + r[1] * 0.8], h, 4.0, 0.12), 2.65, 2.85, snow));
      const sign = [c[0] - t[0] * 3.2 - r[0] * 0.6, c[1] - t[1] * 3.2 - r[1] * 0.6];
      out.push(ext(rect(F, sign, h, 0.08, 0.08), 0, 2.6, post));
      out.push(ext(rect(F, sign, h, 0.08, 0.7), 2.1, 2.7, '#1F6FB8'));
      glass.push(ext(rect(F, [c[0] + r[0] * 0.82, c[1] + r[1] * 0.82], h, 4.2, 0.06), 0.1, 2.45, night() ? '#7FA6CC' : '#BFD8EC'));
      labels.push({ type: 'Feature', properties: { t: st.name ? '🚏 ' + st.name : '🚏' }, geometry: { type: 'Point', coordinates: F.ll(sign) } });
    }

    function personFeats(F, p, coat, hat, out, bob) {
      out.push(ext(disc(F, p, 0.24, 8), 0.02, 1.36 + bob, coat));
      out.push(ext(disc(F, p, 0.13, 8), 1.42 + bob, 1.68 + bob, '#E2BE9C'));
      if (hat) out.push(ext(disc(F, p, 0.15, 8), 1.62 + bob, 1.8 + bob, '#2B2F38'));
    }
    function carFeats(F, pl, car, out) {
      out.push(ext(rect(F, pl.p, pl.h, car.len, car.wid), 0.22, car.hgt > 2 ? 2.1 : 0.95, car.c));
      if (car.hgt <= 2) out.push(ext(rect(F, pl.p, pl.h, car.len * 0.52, car.wid * 0.86, car.len * 0.06), 0.95, 1.45, '#2A3340'));
      const f = [Math.sin(pl.h * RAD), Math.cos(pl.h * RAD)];
      const front = [pl.p[0] + f[0] * (car.len / 2 - 0.05), pl.p[1] + f[1] * (car.len / 2 - 0.05)];
      out.push(ext(rect(F, front, pl.h, 0.1, car.wid * 0.9), 0.55, 0.75, night() ? '#FFF6D8' : '#DDE3EA'));
    }
    function busFeats(F, pos, h, out) {
      out.push(ext(rect(F, pos, h, 12, 2.55), 0.35, 1.15, '#1C6FB8'));
      out.push(ext(rect(F, pos, h, 12, 2.55), 1.15, 2.5, '#1D2833'));
      out.push(ext(rect(F, pos, h, 12, 2.55), 2.5, 3.05, '#F2F5F8'));
      const f = [Math.sin(h * RAD), Math.cos(h * RAD)];
      out.push(ext(rect(F, [pos[0] + f[0] * 6.02, pos[1] + f[1] * 6.02], h, 0.06, 1.9), 2.6, 2.95, '#FFB000'));
    }

    function plan(route) {
      const tr = route.transit;
      const first = tr ? tr.legs[0][0] : route.safe.line[0];
      const F = new Frame(first[0], first[1]);
      const rnd = rng(Math.round(Math.abs(first[0] * 1e5 + first[1] * 1e5)));
      const phases = [];
      const addWalk = (line, navPlan, kind, prefix, suffix) => {
        let pts = line.slice();
        const first = F.xy(line[0]), last = F.xy(line[line.length - 1]);
        const pre = prefix ? Math.hypot(first[0] - prefix[0], first[1] - prefix[1]) : 0;
        const post = suffix ? Math.hypot(last[0] - suffix[0], last[1] - suffix[1]) : 0;
        if (prefix) pts = [F.ll(prefix)].concat(pts);
        if (suffix) pts = pts.concat([F.ll(suffix)]);
        const walk = buildWalk(F, pts, navPlan, pre, post);
        const crossings = ((navPlan && navPlan.cross) || []).map((c, i) => crossingScene(F, walk, c, phases.length * 10 + i, rnd));
        const turns = ((navPlan && navPlan.turns) || []).map((x) => Object.assign({}, x, { s: walk.at(x.d) }));
        const ycors = [];
        const segs = (navPlan && navPlan.segs) || [];
        let runStart = null, runHw = null;
        const close = (endD) => {
          if (runStart === null) return;
          const a = walk.pre + runStart * walk.scale, b = walk.pre + endD * walk.scale;
          if (b - a > 25) {
            const line2 = walk.base.slice(a, b, 70, 70);
            const lanes = TRAFFIC[runHw] || 1;
            const cor = { lanes: [] };
            for (let i = 0; i < lanes; i++) for (const dir of [1, -1]) {
              const lat = dir > 0 ? -(1.75 + 3.5 * i) : 1.75 + 3.5 * i;
              const stops = [];
              crossings.forEach((X) => {
                if (!X.sig) return;
                const cb = walk.pre + X.c.d * walk.scale;
                if (cb < a - 5 || cb > b + 5) return;
                const cY = cb - a + 70;
                const sY = dir > 0 ? cY - X.half - 2.5 : line2.len - cY - X.half - 2.5;
                stops.push({ id: X.id + 'y', s: sY, red: () => X.phase(run ? run.wt : 0).name !== 'p' });
              });
              cor.lanes.push(new Lane({ line: line2, dir, lat, len: line2.len, vmax: VMAX[runHw] || 10, density: runHw === 'tertiary' ? 0.4 : 0.75, stops, live: false }));
            }
            cor.a = a; cor.b = b;
            ycors.push(cor);
          }
          runStart = null;
        };
        segs.forEach(([d, hw]) => {
          if (TRAFFIC[hw]) { if (runStart === null || hw !== runHw) { close(d); runStart = d; runHw = hw; } }
          else close(d);
        });
        close(navPlan ? navPlan.length : walk.base.len / walk.scale);
        phases.push({ type: 'walk', kind, walk, crossings, turns, ycors, s: 0 });
      };
      if (!tr) {
        addWalk(route.safe.line, route.nav, 'dest');
      } else {
        const ridePts = tr.ride.map((p) => F.xy(p));
        const core = new Path(ridePts);
        const path = core.slice(0, core.len, 170, 170);
        const stA = stopScene(F, path.slice(170, path.len - 170), false, tr.stops[0], rnd);
        const stB = stopScene(F, path.slice(170, path.len - 170), true, tr.stops[1], rnd);
        addWalk(tr.legs[0], tr.nav && tr.nav.legs[0], 'stop', null, stA.spot);
        phases.push({ type: 'stop', stop: stA, path, t0: null });
        phases.push({ type: 'ride', path, start: 170, end: path.len - 170, stops: ((tr.nav && tr.nav.ride_stops) || []).map((x) => Object.assign({}, x, { s: 170 + x.d * (core.len / Math.max(1, sumLen(tr.ride, F))) })), stopB: stB });
        phases.push({ type: 'alight', stop: stB, path });
        addWalk(tr.legs[1], tr.nav && tr.nav.legs[1], 'dest', stB.spot, null);
      }
      phases.push({ type: 'done' });
      return { F, rnd, phases, route };
    }
    function sumLen(line, F) { let a = 0; for (let i = 1; i < line.length; i++) { const p = F.xy(line[i - 1]), q = F.xy(line[i]); a += Math.hypot(q[0] - p[0], q[1] - p[1]); } return a; }

    function buildStatic() {
      const F = run.F, stat = [], glass = [], flatF = [], labels = [];
      run.plan.phases.forEach((ph) => {
        if (ph.type === 'walk') ph.crossings.forEach((X) => { flatF.push(...flatForCrossing(F, X)); stat.push(...staticForCrossing(F, X)); });
        if (ph.type === 'stop' || ph.type === 'alight') staticForStop(F, ph.stop, stat, glass, labels);
      });
      setData('n-flat', flatF); setData('n-static', stat); setData('n-glass', glass); setData('n-labels', labels);
    }

    function walkLines() {
      const F = run.F, out = [];
      run.plan.phases.forEach((ph) => {
        if (ph.type !== 'walk') return;
        const gaps = ph.crossings.map((X) => [X.sIn - 0.5, X.sOut + 0.5]).sort((x, y) => x[0] - y[0]);
        let a = 0;
        const piece = (u, v) => { if (v - u < 1) return; const pts = []; for (let s = u; s < v; s += 2) pts.push(F.ll(ph.walk.path.pos(s))); pts.push(F.ll(ph.walk.path.pos(v))); out.push({ type: 'Feature', properties: { k: 'side' }, geometry: { type: 'LineString', coordinates: pts } }); };
        gaps.forEach(([u, v]) => { piece(a, Math.max(a, u)); a = Math.max(a, v); });
        piece(a, ph.walk.path.len);
      });
      const ph = run.plan.phases[run.i];
      if (ph && ph.type === 'walk') {
        const a = run.s, b = Math.min(ph.walk.path.len, run.s + 260), pts = [];
        for (let s = a; s <= b; s += 3) pts.push(F.ll(ph.walk.path.pos(s)));
        pts.push(F.ll(ph.walk.path.pos(b)));
        if (pts.length > 1) out.push({ type: 'Feature', properties: { k: 'guide' }, geometry: { type: 'LineString', coordinates: pts } });
      }
      setData('n-walk', out);
    }

    function activeCrossings(ph) {
      if (!ph || ph.type !== 'walk') return [];
      return ph.crossings.filter((X) => X.sIn - run.s < 170 && run.s - X.sOut < 60);
    }
    function activeYcors(ph) {
      if (!ph || ph.type !== 'walk') return [];
      return ph.ycors.filter((c) => c.a - 150 < run.s && run.s < c.b + 80);
    }

    function warm(lanes) {
      for (const L of lanes) {
        if (L.live) continue;
        L.live = true; L.cars = []; L.next = 0;
        for (let t = 0; t < 45; t += 0.25) L.step(0.25, run.wt - 45 + t, run.rnd);
      }
    }
    function cool(lanes) { for (const L of lanes) { L.live = false; L.cars = []; } }

    function camera(W, hd, A, theta, back) {
      const f = [Math.sin(hd * RAD), Math.cos(hd * RAD)];
      const Dh = A * Math.tan(theta * RAD), d = A / Math.cos(theta * RAD);
      const cam = [W[0] - f[0] * back, W[1] - f[1] * back];
      const look = [cam[0] + f[0] * Dh, cam[1] + f[1] * Dh];
      const ll = run.F.ll(look);
      const H = map.getCanvas().clientHeight || 800;
      const mpp = d / (1.5 * H);
      const z = Math.log2((EC * Math.cos(ll[1] * RAD)) / (512 * mpp));
      map.jumpTo({ center: ll, zoom: Math.min(23.4, z), pitch: theta, bearing: hd });
    }

    function hud() { return run.hud; }
    function setHud(main, sub, icon) {
      const h = hud();
      if (h.main.textContent !== main) h.main.textContent = main;
      if (h.sub.textContent !== (sub || '')) h.sub.textContent = sub || '';
      if (h.icon.dataset.k !== icon) { h.icon.dataset.k = icon; h.icon.innerHTML = ICONS[icon] || ICONS.straight; }
    }
    function setSig(state, text) {
      const el = hud().sig;
      if (!state) { el.hidden = true; return; }
      el.hidden = false; el.className = 'nav-sig ' + state;
      if (el.lastText !== text) { el.lastText = text; el.querySelector('span').textContent = text; }
    }

    const ICONS = {
      straight: '<svg viewBox="0 0 24 24"><path d="M12 20V5M6 11l6-6 6 6"/></svg>',
      left: '<svg viewBox="0 0 24 24"><path d="M16 20v-7a3 3 0 0 0-3-3H5M9 6l-4 4 4 4"/></svg>',
      right: '<svg viewBox="0 0 24 24"><path d="M8 20v-7a3 3 0 0 1 3-3h8M15 6l4 4-4 4"/></svg>',
      slight_left: '<svg viewBox="0 0 24 24"><path d="M15 20v-6L8 7M8 13V7h6"/></svg>',
      slight_right: '<svg viewBox="0 0 24 24"><path d="M9 20v-6l7-7M16 13V7h-6"/></svg>',
      uturn: '<svg viewBox="0 0 24 24"><path d="M8 20V9a4 4 0 0 1 8 0v4M12 10l4 4 4-4"/></svg>',
      cross: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 18h16M7 9v6M11 9v6M15 9v6M19 9v6"/></svg>',
      bus: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 21v-3M16 21v-3"/><circle cx="8.5" cy="14.5" r=".8"/><circle cx="15.5" cy="14.5" r=".8"/></svg>',
      stop: '<svg viewBox="0 0 24 24"><path d="M7 21V4h10v7H7"/><path d="M10 7.5h4"/></svg>',
      flag: '<svg viewBox="0 0 24 24"><path d="M6 21V4M6 4h11l-2 4 2 4H6"/></svg>',
    };

    function fmtM(m) {
      const en = ctx.lang && ctx.lang() === 'en';
      return m >= 1000 ? (m / 1000).toFixed(1).replace('.', en ? '.' : ',') + (en ? ' km' : ' км') : Math.max(10, Math.round(m / 10) * 10) + (en ? ' m' : ' м');
    }

    function instruction(ph) {
      const T = strings();
      const s = run.s;
      const next = ph.turns.find((x) => x.s > s + 2);
      const X = ph.crossings.find((c) => c.sOut > s + 0.5);
      const left = ph.walk.path.len - s;
      if (X && X.sIn - s < 60 && (!next || X.sIn < next.s + 5)) {
        const dist = Math.max(0, X.sIn - s);
        const what = X.sig ? T('n_cross_sig') : T('n_cross_zebra');
        return [dist > 4 ? T('n_in', { m: fmtM(dist) }) + ' — ' + what.toLowerCase() : what, X.name ? T('n_across', { name: X.name }) : '', 'cross'];
      }
      if (next) {
        const dist = next.s - s;
        const verb = T('t_' + next.turn);
        const sub = next.onto ? T('n_onto', { name: next.onto }) : (next.poi ? T('n_by', { name: next.poi }) : '');
        if (dist > 220) return [T('n_straight', { m: fmtM(dist) }), T('n_then') + ' ' + verb + (sub ? ' · ' + sub : ''), 'straight'];
        return [T('n_in', { m: fmtM(dist) }) + ' ' + verb, sub, next.turn];
      }
      if (ph.kind === 'stop') return [T('n_to_stop', { m: fmtM(left) }), run.plan.phases[run.i + 1].stop.name, 'stop'];
      return [left > 25 ? T('n_straight', { m: fmtM(left) }) : T('n_arrive'), '', left > 25 ? 'straight' : 'flag'];
    }

    function landmarkFor(turn) {
      if (turn.poiTried) return;
      turn.poiTried = true;
      try {
        const src = Object.keys(map.getStyle().sources).find((k) => map.getStyle().sources[k].type === 'vector');
        if (!src) return;
        const at = run.F.xy(turn.at);
        let best = null, bd = 55;
        for (const f of map.querySourceFeatures(src, { sourceLayer: 'poi' })) {
          const nm = f.properties['name:ru'] || f.properties.name;
          if (!nm || f.geometry.type !== 'Point') continue;
          const p = run.F.xy(f.geometry.coordinates), d = Math.hypot(p[0] - at[0], p[1] - at[1]);
          if (d < bd) { bd = d; best = nm; }
        }
        if (best) turn.poi = best;
      } catch (e) { }
    }

    function remainingMin() {
      let m = 0;
      run.plan.phases.forEach((ph, i) => {
        if (i < run.i) return;
        const cur = i === run.i;
        if (ph.type === 'walk') m += (ph.walk.path.len - (cur ? run.s : 0)) / WALK / 60;
        if (ph.type === 'stop') m += cur ? Math.max(0, 7 - (run.stopT || 0) / 1.5) : 7;
        if (ph.type === 'ride') m += (ph.end - (cur ? clamp(run.bus.s, ph.start, ph.end) : ph.start)) / BUS / 60;
      });
      return Math.max(0, Math.round(m));
    }

    function progress() {
      let tot = 0, done = 0;
      run.plan.phases.forEach((ph, i) => {
        const len = ph.type === 'walk' ? ph.walk.path.len : ph.type === 'ride' ? ph.end - ph.start : ph.type === 'stop' ? 300 : 0;
        tot += len;
        if (i < run.i) done += len;
        else if (i === run.i) done += ph.type === 'walk' ? run.s : ph.type === 'ride' ? clamp(run.bus.s - ph.start, 0, len) : ph.type === 'stop' ? Math.min(300, (run.stopT || 0) * 20) : 0;
      });
      return tot ? done / tot : 1;
    }

    function stepWalk(ph, dtw, dtW) {
      const T = strings();
      let target = run.s + WALK * BASE * dtw;
      let hold = null;
      for (const X of ph.crossings) {
        if (run.s > X.sOut) continue;
        if (X.passing) continue;
        const curb = X.sIn - 0.8;
        if (run.s < curb - 30) break;
        if (!X.sig) X.yield = run.s > curb - 26;
        let ok = false;
        const carsOnZebra = X.lanes.some((L) => L.cars.some((c) => Math.abs(c.s - L.len / 2) < c.len / 2 + 2.6));
        if (X.sig) {
          const ph2 = X.phase(run.wt);
          ok = ph2.name === 'p' && ph2.left > 3.5 && !carsOnZebra;
        } else {
          ok = !carsOnZebra && X.lanes.every((L) => L.cars.every((c) => { const front = c.s + c.len / 2; return front > L.len / 2 + 2 || front < L.len / 2 - 32 || c.v < 0.6; }));
        }
        if (target >= curb && run.s <= curb + 0.01 && !ok) { hold = X; target = Math.min(target, curb); }
        else if (target >= curb && ok) X.passing = true;
        break;
      }
      for (const X of ph.crossings) if (X.passing && run.s > X.sOut + 2) { X.passing = false; X.done = true; if (!X.sig) X.yield = false; }
      run.s = Math.min(ph.walk.path.len, target);
      run.wait = hold ? (run.wait || 0) + dtW : 0;
      if (hold) {
        if (hold.sig) {
          const p = hold.phase(run.wt);
          let toGreen = 0;
          if (p.name !== 'p') { let acc = p.left; let i = (p.i + 1) % 4; while (i !== 2) { acc += CYCLE[i]; i = (i + 1) % 4; } toGreen = acc; }
          setSig('red', T('n_red', { s: Math.max(1, Math.ceil(toGreen)) }));
        } else setSig('wait', T('n_look'));
      } else {
        const X = ph.crossings.find((c) => c.passing);
        if (X) setSig(X.sig ? 'green' : 'go', X.sig ? T('n_green') : T('n_yield')); else setSig(null);
      }
      const [main, sub, icon] = instruction(ph);
      const nextTurn = ph.turns.find((x) => x.s > run.s + 2);
      if (nextTurn && nextTurn.s - run.s < 260 && !nextTurn.onto) landmarkFor(nextTurn);
      setHud(main, sub, icon);
      const W = ph.walk.path.pos(run.s);
      let hd;
      if (hold) {
        const t = ph.walk.path.tangent(hold.sMid, 2);
        hd = headingOf(t);
        const k = run.wait;
        const look = k < 0.6 ? 0 : k < 2.4 ? -34 : k < 4.4 ? 30 : 0;
        hd += look;
      } else {
        const a = ph.walk.path.pos(run.s), b = ph.walk.path.pos(Math.min(ph.walk.path.len + 6, run.s + 14));
        hd = headingOf(unit(b[0] - a[0], b[1] - a[1]));
      }
      run.hd = run.hd == null ? hd : run.hd + angDiff(run.hd, hd) * Math.min(1, dtW * (hold ? 2.2 : 3.2));
      if (!hold) run.stepPh = (run.stepPh || 0) + (WALK * BASE * dtw / 0.75) * Math.PI;
      run.cam = { W, hd: run.hd, A: 2.3 + (hold ? 0 : Math.abs(Math.sin(run.stepPh || 0)) * 0.05), th: 79, back: 0.6 };
      if (run.s >= ph.walk.path.len - 0.05) return true;
      return false;
    }

    function stepStop(ph, dtW) {
      const T = strings(), st = ph.stop;
      run.stopT = (run.stopT || 0) + dtW;
      const t = run.stopT, bus = run.bus;
      if (!bus.on) { bus.on = true; bus.s = 0; bus.v = 11; bus.state = 'wait'; bus.appear = 3.0; }
      if (bus.state === 'wait') { setHud(T('n_wait_bus'), T('n_bus_in', { min: Math.max(1, Math.round(7 - t * 1.5)) }), 'bus'); if (t >= bus.appear) bus.state = 'come'; }
      else if (bus.state === 'come') {
        const target = 170 + 4.5;
        bus.v = Math.min(11, Math.sqrt(2 * 1.5 * Math.max(0, target - bus.s)));
        bus.s = Math.min(target, bus.s + bus.v * dtW);
        if (target - bus.s < 0.05) { bus.state = 'board'; bus.boardT = 0; }
        setHud(T('n_bus_come'), st.name, 'bus');
      } else if (bus.state === 'board') {
        bus.boardT += dtW;
        const door = ph.path.pos(170 + 4.5 - 1.5), r = st.r;
        const doorPt = [door[0] + r[0] * 5.0, door[1] + r[1] * 5.0];
        st.people.forEach((p) => {
          if (!p.board || p.gone) return;
          const d = Math.hypot(doorPt[0] - p.p[0], doorPt[1] - p.p[1]);
          if (d < 0.5) { p.gone = true; return; }
          const k = Math.min(1, (1.3 * dtW) / d);
          p.p = [p.p[0] + (doorPt[0] - p.p[0]) * k, p.p[1] + (doorPt[1] - p.p[1]) * k];
        });
        setHud(T('n_board'), st.name, 'bus');
        if (bus.boardT > 3.2) { bus.state = 'go'; return true; }
      }
      let hd;
      if (bus.state === 'board') { const d = ph.path.pos(170 + 3); hd = headingOf(unit(d[0] - st.spot[0], d[1] - st.spot[1])); }
      else if (bus.state === 'wait') hd = st.h - 120 + Math.sin(t * 0.8) * 8;
      else { const bp = ph.path.pos(bus.s - 6); hd = headingOf(unit(bp[0] - st.spot[0], bp[1] - st.spot[1])); }
      run.hd = run.hd == null ? hd : run.hd + angDiff(run.hd, hd) * Math.min(1, dtW * 2);
      run.cam = { W: st.spot, hd: run.hd, A: 2.2, th: 79, back: 0.4 };
      return false;
    }

    function stepRide(ph, dtR, dtW) {
      const T = strings(), bus = run.bus;
      const end = ph.end, f = BASE * run.speed;
      if (!bus.rideT) bus.rideT = 0;
      bus.rideT += dtW;
      const brake = 1.2 * f * f;
      const want = Math.min(BUS * f, Math.sqrt(2 * brake * Math.max(0, end - bus.s)) + 0.3);
      bus.v = bus.v < want ? Math.min(want, bus.v + brake * dtR) : want;
      bus.s = Math.min(end, bus.s + bus.v * dtR);
      const nextStop = ph.stops.find((x) => x.s > bus.s + 5);
      const left = end - bus.s;
      if (left < 120) setHud(T('n_get_off', { name: ph.stopB.name || '' }), '', 'stop');
      else setHud(T('n_ride'), nextStop ? T('n_next_stop', { name: nextStop.name }) : T('n_next_stop', { name: ph.stopB.name || '—' }), 'bus');
      const t = ph.path.tangent(bus.s + 10, 8), r = [t[1], -t[0]];
      const p = ph.path.pos(bus.s);
      const W = [p[0] + r[0] * 3.6, p[1] + r[1] * 3.6];
      const a = ph.path.pos(bus.s), b = ph.path.pos(bus.s + 20);
      const hd = headingOf(unit(b[0] - a[0], b[1] - a[1]));
      run.hd = run.hd == null ? hd : run.hd + angDiff(run.hd, hd) * Math.min(1, dtW * 2.6);
      const k = Math.min(1, bus.rideT / 1.6);
      const from = run.fromCam || { W, A: 3.2, th: 80, back: 0 };
      run.cam = { W: [from.W[0] + (W[0] - from.W[0]) * k, from.W[1] + (W[1] - from.W[1]) * k], hd: run.hd, A: from.A + (3.2 - from.A) * k, th: from.th + (80 - from.th) * k, back: from.back * (1 - k) };
      hud().frame.hidden = k < 0.6;
      return end - bus.s < 0.05;
    }

    function stepAlight(ph, dtW) {
      const T = strings(), bus = run.bus, st = ph.stop;
      run.alT = (run.alT || 0) + dtW;
      const k = Math.min(1, run.alT / 1.8);
      hud().frame.hidden = true;
      setHud(T('n_get_off', { name: st.name || '' }), '', 'stop');
      const from = run.fromCam;
      run.cam = { W: [from.W[0] + (st.spot[0] - from.W[0]) * k, from.W[1] + (st.spot[1] - from.W[1]) * k], hd: run.hd, A: from.A + (2.3 - from.A) * k, th: from.th + (79 - from.th) * k, back: 0.6 * k };
      if (run.alT > 1.2) bus.state = 'leave';
      return run.alT > 2.6;
    }

    function dynamic() {
      const F = run.F, out = [], ph = run.plan.phases[run.i];
      const lanes = [];
      if (ph && ph.type === 'walk') { activeCrossings(ph).forEach((X) => lanes.push(...X.lanes)); activeYcors(ph).forEach((c) => lanes.push(...c.lanes)); }
      lanes.forEach((L) => L.cars.forEach((c) => carFeats(F, L.place(c.s), c, out)));
      run.plan.phases.forEach((p) => {
        if (p.type === 'walk') p.crossings.forEach((X) => {
          if (!X.sig || !X.heads) return;
          const ph2 = X.phase(run.wt), h = headingOf(X.u);
          X.heads.forEach((hd) => {
            let col;
            if (hd.kind === 'ped') col = ph2.name === 'p' ? (ph2.left < 3 && Math.floor(run.wt * 3) % 2 ? LAMP.off : LAMP.green) : LAMP.red;
            else col = ph2.name === 'x' ? (ph2.left < 2.5 ? LAMP.amber : LAMP.green) : ph2.name === 'c1' ? LAMP.red : LAMP.red;
            const b0 = hd.kind === 'ped' ? 2.3 : 3.6;
            out.push(ext(rect(F, hd.at, h, 0.26, 0.26), b0, b0 + 0.5, col));
          });
        });
        if (p.type === 'stop' || p.type === 'alight') p.stop.people.forEach((q, i) => { if (!q.gone) personFeats(F, q.p, q.coat, q.hat, out, Math.sin(run.wt * 2 + q.ph) * 0.015); });
      });
      const bus = run.bus;
      const cur = run.plan.phases[run.i];
      if (bus.on && bus.path && cur && bus.state !== 'wait' && (cur.type === 'stop' || cur.type === 'alight' || (cur.type === 'walk' && bus.state === 'leave' && bus.s < bus.path.len + 5))) {
        const path = bus.path, t = path.tangent(bus.s - 6, 6), r = [t[1], -t[0]], p = path.pos(bus.s - 6);
        busFeats(F, [p[0] + r[0] * 3.6, p[1] + r[1] * 3.6], headingOf(t), out);
      }
      setData('n-dyn', out);
    }

    function tick(now) {
      if (!run) return;
      run.raf = requestAnimationFrame(tick);
      const dtR = Math.min(0.1, (now - (run.last || now)) / 1000);
      run.last = now;
      if (run.paused) { if (run.cam) camera(run.cam.W, run.cam.hd, run.cam.A, run.cam.th, run.cam.back); return; }
      const dtw = dtR * run.speed;
      const dtW = dtR * Math.min(run.speed, 2.5);
      run.wt += dtW;
      if (!map.getSource('n-flat')) addLayers();
      if (run.staticDirty && map.getSource('n-static')) { run.staticDirty = false; buildStatic(); }
      const ph = run.plan.phases[run.i];
      if (!ph) return;
      let done = false;
      if (ph.type === 'walk') {
        const act = activeCrossings(ph), lanes = [];
        act.forEach((X) => lanes.push(...X.lanes));
        activeYcors(ph).forEach((c) => lanes.push(...c.lanes));
        warm(lanes);
        run.lanes.forEach((L) => { if (!lanes.includes(L)) cool([L]); });
        run.lanes = lanes;
        lanes.forEach((L) => L.step(dtW, run.wt, run.rnd));
        done = stepWalk(ph, dtw, dtW);
        run.walkT = (run.walkT || 0) + dtR;
        if (run.walkT > 0.35 || run.walkDirty) { run.walkT = 0; run.walkDirty = false; walkLines(); }
      } else if (ph.type === 'stop') { done = stepStop(ph, dtW); setSig(null); }
      else if (ph.type === 'ride') done = stepRide(ph, dtR, dtW);
      if (run.bus.state === 'leave') { run.bus.v = Math.min(12, (run.bus.v || 0) + 2 * dtW); run.bus.s += run.bus.v * dtW; }
      else if (ph.type === 'alight') done = stepAlight(ph, dtW);
      else if (ph.type === 'done') { finish(); return; }
      if (done) next();
      if (run && run.cam) camera(run.cam.W, run.cam.hd, run.cam.A, run.cam.th, run.cam.back);
      if (run) {
        dynamic();
        run.uiT = (run.uiT || 0) + dtR;
        if (run.uiT > 0.25) { run.uiT = 0; hud().bar.style.width = (progress() * 100).toFixed(1) + '%'; hud().eta.textContent = strings()('n_left', { min: remainingMin() }); }
      }
    }

    function next() {
      const ph = run.plan.phases[run.i];
      if (ph.type === 'stop') { run.fromCam = Object.assign({}, run.cam); run.bus.rideT = 0; }
      if (ph.type === 'ride') { run.fromCam = Object.assign({}, run.cam); run.alT = 0; run.bus.v = 0; }
      if (ph.type === 'walk') { cool(run.lanes); run.lanes = []; }
      run.i += 1; run.s = 0; run.stopT = 0;
      const nx = run.plan.phases[run.i];
      if (nx && nx.type === 'walk' && run.i > 0) { run.walkDirty = true; }
      if (nx && nx.type === 'stop') { run.bus.path = nx.path; run.bus.on = false; }
    }

    function finish() {
      const T = strings();
      cancelAnimationFrame(run.raf);
      run.done = true;
      setSig(null);
      hud().frame.hidden = true;
      setHud(T('n_arrive'), '', 'flag');
      hud().bar.style.width = '100%';
      hud().fin.hidden = false;
      const r = run.plan.route, tr = r.transit;
      const min = tr ? tr.total_min : r.safe.minutes, km = ((tr ? tr.walk.length : r.safe.length) / 1000).toFixed(1).replace('.', ',');
      const fall = ((tr ? tr.walk.fall : r.safe.fall) * 100).toFixed(1).replace('.', ',');
      hud().fin.querySelector('p').textContent = T('n_done_sub', { min: Math.round(min), km, p: fall });
    }

    function buildHud() {
      const T = strings();
      const root = document.createElement('div');
      root.id = 'nav';
      root.innerHTML = '<div class="nav-top glass"><div class="nav-ico"></div><div class="nav-txt"><b></b><small></small></div></div>' +
        '<div class="nav-sig" hidden><i></i><span></span></div>' +
        '<div class="nav-frame" hidden><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i></div>' +
        '<div class="nav-bar glass"><button class="nav-play" aria-label="pause"></button><div class="nav-prog"><i></i></div><span class="nav-eta"></span>' +
        '<div class="nav-speed" role="group" aria-label="' + T('n_speed') + '">' + [1, 2, 3, 4, 5].map((k) => '<button data-k="' + k + '">' + k + '×</button>').join('') + '</div>' +
        '<button class="nav-x" aria-label="' + T('n_exit') + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="nav-fin glass" hidden><h3>' + T('n_arrive') + '</h3><p></p><div><button class="cta nav-again">' + T('n_again') + '</button><button class="btn2 nav-close">' + T('n_close') + '</button></div></div>';
      document.body.appendChild(root);
      const q = (s) => root.querySelector(s);
      const h = { root, icon: q('.nav-ico'), main: q('.nav-txt b'), sub: q('.nav-txt small'), sig: q('.nav-sig'), frame: q('.nav-frame'), bar: q('.nav-prog i'), eta: q('.nav-eta'), fin: q('.nav-fin'), play: q('.nav-play'), speed: q('.nav-speed') };
      const playIcon = () => { h.play.innerHTML = run && run.paused ? '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>'; };
      playIcon();
      h.play.onclick = () => { if (!run) return; run.paused = !run.paused; playIcon(); };
      h.speed.querySelectorAll('button').forEach((b) => { b.onclick = () => api.setSpeed(+b.dataset.k); });
      q('.nav-x').onclick = () => api.stop();
      q('.nav-close').onclick = () => api.stop();
      q('.nav-again').onclick = () => { const r = run.plan.route; api.stop(true); api.start(r); };
      q('.nav-prog').onclick = (ev) => { if (!run || run.done) return; const box = ev.currentTarget.getBoundingClientRect(); seek((ev.clientX - box.left) / box.width); };
      return h;
    }

    function seek(frac) {
      const phs = run.plan.phases;
      const lens = phs.map((ph) => (ph.type === 'walk' ? ph.walk.path.len : ph.type === 'ride' ? ph.end - ph.start : ph.type === 'stop' ? 300 : 0));
      let target = frac * lens.reduce((a, b) => a + b, 0);
      if (run.i < phs.length && phs[run.i].type === 'walk') { cool(run.lanes); run.lanes = []; }
      for (let i = 0; i < phs.length; i++) {
        if (target <= lens[i] || i === phs.length - 1) {
          run.i = i;
          const ph = phs[i];
          if (ph.type === 'walk') {
            run.s = target;
            ph.crossings.forEach((X) => { X.passing = false; X.yield = false; X.done = X.sOut < target; });
            if (i > 0 && run.i > 0) { run.bus.state = 'leave'; run.bus.s = run.bus.path ? run.bus.path.len : 0; }
          } else if (ph.type === 'ride') {
            run.bus.path = ph.path; run.bus.on = true; run.bus.state = 'go'; run.bus.s = ph.start + target; run.bus.v = BUS * BASE; run.bus.rideT = 2; run.fromCam = null; run.hd = null;
          } else if (ph.type === 'stop') { run.stopT = 0; run.bus.on = false; run.bus.path = ph.path; ph.stop.people.forEach((p) => { p.gone = false; }); }
          run.walkDirty = true; run.hd = null;
          break;
        }
        target -= lens[i];
      }
    }

    const api = {
      active: () => !!run,
      start(route) {
        if (run) api.stop(true);
        if (!route || !route.safe) return;
        const p = plan(route);
        run = { plan: p, F: p.F, rnd: p.rnd, i: 0, s: 0, wt: 0, speed: api.speed || 2, lanes: [], bus: { on: false, s: 0, v: 0 }, staticDirty: true, walkDirty: true, hd: null };
        run.hud = buildHud();
        api.setSpeed(run.speed);
        run.saved = { maxPitch: map.getMaxPitch(), maxZoom: map.getMaxZoom() };
        map.setMaxPitch(85); map.setMaxZoom(23.5);
        ['dragPan', 'dragRotate', 'scrollZoom', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom'].forEach((k) => { try { map[k].disable(); } catch (e) { } });
        addLayers();
        run.onStyle = () => { if (run && !map.getSource('n-flat')) setTimeout(() => { if (run) addLayers(); }, 0); };
        map.on('styledata', run.onStyle);
        document.body.classList.add('navmode');
        if (ctx.onStart) ctx.onStart();
        run.raf = requestAnimationFrame(tick);
      },
      stop(silent) {
        if (!run) return;
        cancelAnimationFrame(run.raf);
        map.off('styledata', run.onStyle);
        run.hud.root.remove();
        removeLayers();
        ['dragPan', 'dragRotate', 'scrollZoom', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom'].forEach((k) => { try { map[k].enable(); } catch (e) { } });
        map.setMaxZoom(run.saved.maxZoom);
        if (map.getPitch() > run.saved.maxPitch) map.jumpTo({ pitch: run.saved.maxPitch });
        map.setMaxPitch(run.saved.maxPitch);
        run = null;
        document.body.classList.remove('navmode');
        if (!silent && ctx.onExit) ctx.onExit();
      },
      setSpeed(k) {
        api.speed = k;
        if (!run) return;
        run.speed = k;
        run.hud.speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.k === k));
      },
    };
    return api;
  }

  window.BoranNav = { create, _test: { Path, Frame, buildWalk, Lane } };
})();
