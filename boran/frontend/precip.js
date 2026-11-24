(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (k) => k * k * (3 - 2 * k);

  function sprite(stops, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function flakeSet(night) {
    const rim = night ? 'rgba(160,190,230,0)' : 'rgba(70,95,130,0.22)';
    return {
      sharp: sprite([[0, 'rgba(255,255,255,1)'], [0.32, 'rgba(255,255,255,0.95)'], [0.55, 'rgba(250,253,255,0.55)'], [0.72, rim], [1, 'rgba(255,255,255,0)']], 64),
      soft: sprite([[0, 'rgba(255,255,255,0.9)'], [0.45, 'rgba(255,255,255,0.45)'], [0.75, night ? 'rgba(255,255,255,0.08)' : 'rgba(90,110,140,0.1)'], [1, 'rgba(255,255,255,0)']], 64),
      bokeh: sprite([[0, 'rgba(255,255,255,0.32)'], [0.55, 'rgba(255,255,255,0.2)'], [0.82, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']], 128),
    };
  }

  function drawFrost(cv) {
    const W = Math.round(window.innerWidth), H = Math.round(window.innerHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const reach = Math.min(W, H) * 0.2;
    function branch(x, y, ang, len, w, depth) {
      let px = x, py = y;
      const steps = Math.max(2, Math.round(len / 4));
      g.lineWidth = w;
      g.beginPath(); g.moveTo(px, py);
      const pts = [];
      for (let i = 0; i < steps; i++) {
        ang += (rnd() - 0.5) * 0.35;
        px += Math.cos(ang) * 4; py += Math.sin(ang) * 4;
        g.lineTo(px, py);
        pts.push([px, py, ang]);
      }
      g.stroke();
      if (depth <= 0) return;
      for (let i = 1; i < pts.length - 1; i += 2) {
        const [bx, by, ba] = pts[i];
        const k = 1 - i / pts.length;
        if (rnd() < 0.8) branch(bx, by, ba + 1.05 + (rnd() - 0.5) * 0.3, len * 0.34 * k, w * 0.7, depth - 1);
        if (rnd() < 0.8) branch(bx, by, ba - 1.05 + (rnd() - 0.5) * 0.3, len * 0.34 * k, w * 0.7, depth - 1);
      }
    }
    const seeds = Math.round((W + H) / 9);
    for (let i = 0; i < seeds; i++) {
      const side = Math.floor(rnd() * 4), u = rnd();
      const corner = Math.pow(Math.abs(u - 0.5) * 2, 3);
      const len = reach * (0.25 + 0.75 * corner) * (0.45 + rnd() * 0.75);
      let x, y, a;
      if (side === 0) { x = u * W; y = 0; a = Math.PI / 2; }
      else if (side === 1) { x = u * W; y = H; a = -Math.PI / 2; }
      else if (side === 2) { x = 0; y = u * H; a = 0; }
      else { x = W; y = u * H; a = Math.PI; }
      a += (u - 0.5) * (side < 2 ? (side === 0 ? -1 : 1) : (side === 2 ? 1 : -1)) * 1.1 + (rnd() - 0.5) * 0.6;
      g.strokeStyle = 'rgba(236,248,255,' + (0.28 + rnd() * 0.3).toFixed(2) + ')';
      branch(x, y, a, len, 1.1 + rnd() * 0.8, 2);
    }
    for (let i = 0; i < (W * H) / 900; i++) {
      const x = rnd() * W, y = rnd() * H;
      const d = Math.min(x, y, W - x, H - y) / reach;
      if (d > 1.2 || rnd() > 1.1 - d) continue;
      g.fillStyle = 'rgba(240,250,255,' + (0.25 + rnd() * 0.35).toFixed(2) + ')';
      g.fillRect(x, y, 0.8 + rnd() * 1.2, 0.8 + rnd() * 1.2);
    }
  }

  function create(ctx) {
    const cv = document.createElement('canvas');
    cv.id = 'precip';
    cv.setAttribute('aria-hidden', 'true');
    const frost = document.getElementById('frost');
    document.body.insertBefore(cv, frost || null);
    const g = cv.getContext('2d');
    let fcv = null;
    if (frost) {
      frost.querySelectorAll('i').forEach((e) => e.remove());
      fcv = document.createElement('canvas');
      fcv.className = 'frost-cv';
      frost.appendChild(fcv);
    }
    const st = { W: 0, H: 0, snow: [], rain: [], splash: [], last: 0, sI: 0, rI: 0, haze: 0, night: null, set: null, frostKey: '', t: 0 };
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      st.W = window.innerWidth; st.H = window.innerHeight;
      cv.width = st.W * dpr; cv.height = st.H * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', () => { size(); st.frostKey = ''; });
    size();

    function targets(wx) {
      const P = Math.max(0, wx.precip || 0), S = Math.max(0, wx.snow || 0), T = wx.temp;
      const tot = Math.max(P, S);
      if (tot < 0.04) return [0, 0];
      let fs = P > 0.01 ? clamp(S / P, 0, 1) : 1;
      if (T > 3) fs = Math.min(fs, 0.05);
      else if (T > 0.5) fs = Math.min(fs, (3 - T) / 2.5);
      else if (T < -1.5) fs = Math.max(fs, 0.95);
      const level = clamp(0.18 + tot / 1.7, 0, 1);
      return [level * fs, clamp(0.2 + tot / 2.6, 0, 1) * (1 - fs)];
    }

    function newFlake(fresh) {
      const z = Math.pow(Math.random(), 1.5) * 0.9 + 0.1;
      const big = z > 0.9 && Math.random() < 0.3;
      return { x: Math.random() * st.W, y: fresh ? Math.random() * st.H : -30, f: fresh ? 0 : 1, z, big, ph: Math.random() * 6.28, sw: 6 + Math.random() * 16, fr: 0.5 + Math.random() * 1.1, r: big ? 9 + Math.random() * 14 : 0.9 + 3.4 * Math.pow(z, 1.6) * (0.75 + Math.random() * 0.5), soft: Math.random() < 0.45 };
    }
    function newDrop(fresh) {
      const z = 0.25 + Math.random() * 0.75;
      return { x: Math.random() * (st.W + 200) - 100, y: fresh ? Math.random() * st.H : -60 - Math.random() * 120, z };
    }

    function wind(wx, now) {
      const m = ctx.map && ctx.map();
      const bearing = (m ? m.getBearing() : 0) * Math.PI / 180;
      const to = ((wx.wdir || 0) + 180) * Math.PI / 180 - bearing;
      const gust = 0.78 + 0.22 * Math.sin(now / 2700) + 0.14 * Math.sin(now / 1130 + 1.7) + 0.06 * Math.sin(now / 410 + 0.4);
      const w = (wx.wind || 0) * gust;
      return { x: Math.sin(to) * w, y: -Math.cos(to) * w * 0.35, w };
    }

    function drawSnow(dt, now, wd, I) {
      const area = clamp((st.W * st.H) / 1000000, 0.35, 2.2);
      const want = Math.round((70 + 980 * I * I + 260 * I) * area * (reduced ? 0.4 : 1));
      while (st.snow.length < want) st.snow.push(newFlake(true));
      if (st.snow.length > want) st.snow.length = Math.max(want, st.snow.length - 6);
      const set = st.set, storm = clamp((wd.w - 9) / 9, 0, 1);
      for (const p of st.snow) {
        const t = now / 1000;
        const vy = (26 + 100 * p.z) * (1 + 0.35 * I) + wd.y * 14 * p.z;
        const vx = wd.x * 20 * p.z + Math.cos(t * p.fr * 2 + p.ph) * p.sw * p.fr * (1 - storm * 0.6);
        p.x += vx * dt; p.y += vy * dt;
        if (p.y > st.H + 30) { Object.assign(p, newFlake(false)); }
        if (p.x > st.W + 40) p.x -= st.W + 80; else if (p.x < -40) p.x += st.W + 80;
        const r = p.r;
        if (p.f < 1) p.f = Math.min(1, p.f + dt * 1.6);
        if (p.big) {
          g.globalAlpha = 0.5 * Math.min(1, I * 2.2) * p.f;
          g.drawImage(set.bokeh, p.x - r, p.y - r, r * 2, r * 2);
          continue;
        }
        g.globalAlpha = (0.32 + 0.68 * p.z) * (0.75 + 0.25 * Math.sin(t * 1.7 + p.ph)) * p.f;
        const img = p.soft ? set.soft : set.sharp;
        if (storm > 0.05 && p.z > 0.45) {
          const sp = Math.hypot(vx, vy), k = 1 + storm * Math.min(2.6, sp / 160);
          g.save();
          g.translate(p.x, p.y);
          g.rotate(Math.atan2(vy, vx));
          g.drawImage(img, -r * k, -r, r * 2 * k, r * 2);
          g.restore();
        } else g.drawImage(img, p.x - r, p.y - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
    }

    function drawRain(dt, now, wd, I) {
      const area = clamp((st.W * st.H) / 1000000, 0.35, 2.2);
      const want = Math.round((90 + 720 * I) * area * (reduced ? 0.4 : 1));
      while (st.rain.length < want) st.rain.push(newDrop(true));
      if (st.rain.length > want) st.rain.length = Math.max(want, st.rain.length - 10);
      const night = st.night;
      const buckets = [[], [], []];
      for (const d of st.rain) {
        const vy = 820 + 760 * d.z, vx = wd.x * 46 * d.z;
        d.x += vx * dt; d.y += vy * dt;
        if (d.y > st.H + 50) {
          if (Math.random() < 0.5 && d.z > 0.45) st.splash.push({ x: d.x, y: st.H * (0.35 + Math.random() * 0.62), t: 0, s: 0.6 + d.z * 0.8 });
          Object.assign(d, newDrop(false));
        }
        if (d.x > st.W + 120) d.x -= st.W + 240; else if (d.x < -120) d.x += st.W + 240;
        buckets[d.z < 0.5 ? 0 : d.z < 0.78 ? 1 : 2].push([d, vx, vy]);
      }
      const col = night ? '200,220,245' : '120,140,165';
      const base = night ? [0.16, 0.24, 0.34] : [0.2, 0.3, 0.42];
      g.lineCap = 'round';
      buckets.forEach((B, k) => {
        if (!B.length) return;
        const len = [0.016, 0.024, 0.034][k], wdt = [0.7, 1.0, 1.4][k];
        g.strokeStyle = 'rgba(' + col + ',' + (base[k] * 0.55).toFixed(3) + ')';
        g.lineWidth = wdt;
        g.beginPath();
        for (const [d, vx, vy] of B) { g.moveTo(d.x, d.y); g.lineTo(d.x - vx * len, d.y - vy * len); }
        g.stroke();
        g.strokeStyle = 'rgba(' + (night ? '225,238,255' : '235,242,250') + ',' + base[k].toFixed(3) + ')';
        g.beginPath();
        for (const [d, vx, vy] of B) { g.moveTo(d.x, d.y); g.lineTo(d.x - vx * len * 0.4, d.y - vy * len * 0.4); }
        g.stroke();
      });
      const rate = 30 * I * (st.W * st.H) / 1000000;
      for (let i = 0; i < 3; i++) if (Math.random() < rate * dt / 3) st.splash.push({ x: Math.random() * st.W, y: st.H * (0.3 + Math.random() * 0.7), t: 0, s: 0.5 + Math.random() * 0.9 });
      g.lineWidth = 1;
      st.splash = st.splash.filter((s) => {
        s.t += dt;
        const k = s.t / 0.32;
        if (k >= 1) return false;
        const r = (1.5 + 6 * k) * s.s;
        g.strokeStyle = 'rgba(' + (night ? '210,228,250' : '240,246,252') + ',' + (0.5 * (1 - k)).toFixed(3) + ')';
        g.beginPath(); g.ellipse(s.x, s.y, r, r * 0.38, 0, 0, Math.PI * 2); g.stroke();
        return true;
      });
      if (st.splash.length > 400) st.splash.splice(0, st.splash.length - 400);
    }

    function atmosphere(sI, rI, wd) {
      const haze = clamp(sI * 0.55 + clamp((wd.w - 8) / 10, 0, 1) * sI * 0.6, 0, 0.75);
      if (haze > 0.01) {
        const gr = g.createLinearGradient(0, 0, 0, st.H);
        const c = st.night ? '190,205,230' : '245,248,252';
        gr.addColorStop(0, 'rgba(' + c + ',' + (0.32 * haze).toFixed(3) + ')');
        gr.addColorStop(0.45, 'rgba(' + c + ',' + (0.16 * haze).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(' + c + ',' + (0.06 * haze).toFixed(3) + ')');
        g.fillStyle = gr;
        g.fillRect(0, 0, st.W, st.H);
      }
      if (rI > 0.01) {
        g.fillStyle = st.night ? 'rgba(10,16,30,' + (0.12 * rI).toFixed(3) + ')' : 'rgba(55,70,92,' + (0.1 * rI).toFixed(3) + ')';
        g.fillRect(0, 0, st.W, st.H);
      }
    }

    function updateFrost(wx) {
      if (!frost || !fcv) return;
      const cold = wx.temp < 2;
      const sev = clamp((2 - wx.temp) / 30, 0, 1) * 0.55 + clamp((wx.wind || 0) / 18, 0, 1) * 0.25 + clamp((wx.snow || 0) / 2, 0, 1) * 0.2;
      frost.style.opacity = cold ? Math.min(0.95, 0.22 + sev * 0.9).toFixed(2) : '0';
      const key = st.W + 'x' + st.H;
      if (cold && st.frostKey !== key) { st.frostKey = key; drawFrost(fcv); }
    }

    let frostT = 0;
    return {
      draw(now) {
        const wx = ctx.weather();
        if (!wx) return;
        const dt = Math.min(0.05, (now - (st.last || now)) / 1000);
        st.last = now;
        if (now - frostT > 500) { frostT = now; updateFrost(wx); }
        const night = !!ctx.isNight();
        if (night !== st.night) { st.night = night; st.set = flakeSet(night); }
        const [ts, tr] = ctx.paused && ctx.paused() ? [0, 0] : targets(wx);
        const ease = Math.min(1, dt * 0.8);
        st.sI += (ts - st.sI) * ease;
        st.rI += (tr - st.rI) * ease;
        g.clearRect(0, 0, st.W, st.H);
        if (st.sI < 0.01 && st.rI < 0.01) {
          if (st.snow.length || st.rain.length) { st.snow = []; st.rain = []; st.splash = []; }
          cv.style.display = 'none';
          return;
        }
        cv.style.display = '';
        const wd = wind(wx, now);
        atmosphere(st.sI, st.rI, wd);
        if (st.rI > 0.01) drawRain(dt, now, wd, smooth(clamp(st.rI, 0, 1)));
        else if (st.rain.length) st.rain = [];
        if (st.sI > 0.01) drawSnow(dt, now, wd, smooth(clamp(st.sI, 0, 1)));
        else if (st.snow.length) st.snow = [];
      },
      kind() {
        const wx = ctx.weather();
        if (!wx) return 'none';
        const [s, r] = targets(wx);
        return s < 0.01 && r < 0.01 ? 'none' : r > s ? 'rain' : 'snow';
      },
    };
  }

  window.BoranPrecip = { create };
})();
