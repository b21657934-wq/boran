(function () {
  const SRC = 'media/expo_parking.mp4';
  const POSTER = 'media/expo_poster.jpg';
  const SPHERE = [71.41613, 51.08893];
  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
    on: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/></svg>',
    off: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  };

  function create(ctx) {
    const T = (k, v) => ctx.t(k, v);
    const st = { open: false, busy: false, url: null, loading: null, prog: 0, timers: [], hideT: 0, tagOn: false };
    const later = (ms, fn) => { const id = setTimeout(fn, ms); st.timers.push(id); return id; };
    const clear = () => { st.timers.forEach(clearTimeout); st.timers = []; };

    const tag = document.createElement('button');
    tag.id = 'expo-tag';
    tag.type = 'button';
    tag.innerHTML = '<b>P</b><span></span>';
    tag.hidden = true;
    document.body.appendChild(tag);
    tag.onclick = () => enter();

    const root = document.createElement('div');
    root.id = 'expo';
    root.hidden = true;
    root.innerHTML =
      '<div class="ex-tunnel"><div class="ex-wall l"></div><div class="ex-wall r"></div><div class="ex-ceil"></div><div class="ex-floor"></div><div class="ex-fog"></div></div>' +
      '<div class="ex-lift"><small class="ex-k"></small><div class="ex-num"><b>P</b><span class="ex-d"><i>0</i><i>−1</i></span></div><p class="ex-say"></p><div class="ex-load" hidden><i></i></div></div>' +
      '<video playsinline preload="auto" poster="' + POSTER + '"></video>' +
      '<button class="ex-big" hidden aria-label="play">' + ICON.play + '</button>' +
      '<div class="ex-ui"><button class="ex-back glass">' + ICON.up + '<span></span></button><div class="ex-title glass"><b>P −1</b><span></span></div>' +
      '<button class="ex-sound glass" hidden>' + ICON.on + '<span></span></button>' +
      '<div class="ex-bar glass"><button class="ex-play" aria-label="play"></button><div class="ex-prog"><i></i></div><span class="ex-time">0:00</span><button class="ex-mute" aria-label="sound"></button></div></div>' +
      '<div class="ex-end glass" hidden><h3></h3><p></p><div><button class="cta ex-again"></button><button class="btn2 ex-out"></button></div></div>' +
      '<div class="ex-iris"></div>';
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    const V = q('video'), ui = q('.ex-ui');

    function texts() {
      tag.querySelector('span').textContent = T('ex_tag');
      tag.title = T('ex_tag_t');
      tag.setAttribute('aria-label', T('ex_tag_t'));
      q('.ex-k').textContent = T('ex_title');
      q('.ex-back span').textContent = T('ex_back');
      q('.ex-title span').textContent = T('ex_title');
      q('.ex-sound span').textContent = T('ex_sound');
      q('.ex-end h3').textContent = T('ex_done');
      q('.ex-end p').textContent = T('ex_done_sub');
      q('.ex-again').textContent = T('ex_again');
      q('.ex-out').textContent = T('ex_back');
    }
    texts();

    function prefetch() {
      if (st.url) return Promise.resolve(st.url);
      if (st.loading) return st.loading;
      st.loading = (async () => {
        const r = await fetch(SRC);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const total = +r.headers.get('content-length') || 0;
        const parts = [];
        if (r.body && r.body.getReader) {
          const rd = r.body.getReader();
          let got = 0;
          for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            parts.push(value); got += value.length;
            st.prog = total ? Math.min(0.99, got / total) : 0;
          }
        } else parts.push(new Uint8Array(await r.arrayBuffer()));
        st.url = URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }));
        st.prog = 1;
        return st.url;
      })();
      st.loading.catch(() => { st.loading = null; });
      return st.loading;
    }

    function unlock() {
      try {
        if (st.url && V.src !== st.url) V.src = st.url;
        V.muted = false;
        const p = V.play();
        if (p && p.catch) p.catch(() => {});
        V.pause();
      } catch (e) { }
    }

    const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    function paintBar() {
      q('.ex-play').innerHTML = V.paused ? ICON.play : ICON.pause;
      q('.ex-mute').innerHTML = V.muted ? ICON.off : ICON.on;
      const d = V.duration || 60;
      q('.ex-prog i').style.width = (100 * (V.currentTime || 0) / d).toFixed(2) + '%';
      q('.ex-time').textContent = fmt(V.currentTime) + ' / ' + fmt(d);
    }
    V.addEventListener('timeupdate', paintBar);
    V.addEventListener('play', paintBar);
    V.addEventListener('pause', paintBar);
    V.addEventListener('volumechange', () => { paintBar(); if (!V.muted) q('.ex-sound').hidden = true; });
    V.addEventListener('ended', () => { q('.ex-end').hidden = false; root.classList.add('ui'); });

    function poke() {
      root.classList.add('ui');
      clearTimeout(st.hideT);
      st.hideT = setTimeout(() => { if (!V.paused && q('.ex-end').hidden) root.classList.remove('ui'); }, 2600);
    }
    root.addEventListener('mousemove', () => { if (root.classList.contains('playing')) poke(); });
    root.addEventListener('touchstart', () => { if (root.classList.contains('playing')) poke(); }, { passive: true });
    V.addEventListener('click', () => { if (!root.classList.contains('playing')) return; if (V.paused) V.play().catch(() => {}); else V.pause(); poke(); });
    q('.ex-play').onclick = () => { if (V.paused) { q('.ex-end').hidden = true; V.play().catch(() => {}); } else V.pause(); poke(); };
    q('.ex-mute').onclick = () => { V.muted = !V.muted; poke(); };
    q('.ex-sound').onclick = () => { V.muted = false; q('.ex-sound').hidden = true; poke(); };
    q('.ex-big').onclick = () => { q('.ex-big').hidden = true; V.muted = false; V.play().catch(() => { V.muted = true; V.play().catch(() => {}); q('.ex-sound').hidden = false; }); poke(); };
    q('.ex-prog').onclick = (ev) => { const b = ev.currentTarget.getBoundingClientRect(); V.currentTime = Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)) * (V.duration || 60); q('.ex-end').hidden = true; poke(); };
    q('.ex-again').onclick = () => { q('.ex-end').hidden = true; V.currentTime = 0; V.play().catch(() => {}); poke(); };
    q('.ex-back').onclick = () => leave();
    q('.ex-out').onclick = () => leave();

    function phase(name) { root.className = name; }

    async function startVideo() {
      if (!st.open) return;
      if (V.src !== st.url) V.src = st.url;
      try { V.currentTime = 0; } catch (e) { }
      V.muted = false;
      phase('playing ui');
      poke();
      try { await V.play(); } catch (e) {
        V.muted = true;
        try { await V.play(); q('.ex-sound').hidden = false; } catch (e2) { q('.ex-big').hidden = false; }
      }
      paintBar();
    }

    function waitVideo(t0) {
      if (!st.open) return;
      if (st.url && performance.now() - t0 > 3500) { startVideo(); return; }
      const load = q('.ex-load');
      if (!st.url && performance.now() - t0 > 3000) {
        load.hidden = false;
        q('.ex-say').textContent = T('ex_loading', { p: Math.round(st.prog * 100) });
        load.firstChild.style.width = (st.prog * 100).toFixed(1) + '%';
      }
      later(120, () => waitVideo(t0));
    }

    function enter() {
      if (st.open || st.busy || !ctx.canEnter()) return false;
      const m = ctx.map();
      st.open = true;
      tag.hidden = true;
      unlock();
      texts();
      if (ctx.onOpen) ctx.onOpen();
      q('.ex-end').hidden = true; q('.ex-big').hidden = true; q('.ex-sound').hidden = true; q('.ex-load').hidden = true;
      q('.ex-say').textContent = T('ex_going');
      V.removeAttribute('style');
      root.hidden = false;
      phase('dive');
      const t0 = performance.now();
      prefetch().catch(() => {
        if (!st.open) return;
        q('.ex-load').hidden = true;
        q('.ex-say').textContent = T('ex_fail');
        later(2600, () => leave());
      });
      if (m) m.flyTo({ center: SPHERE, zoom: Math.min(m.getMaxZoom(), 18.3), pitch: Math.min(m.getMaxPitch(), 68), bearing: m.getBearing(), duration: 1500, essential: true, curve: 1.2 });
      later(1450, () => phase('dive tunnel'));
      later(2050, () => phase('dive tunnel below'));
      later(2200, () => { if (st.url || st.loading) q('.ex-say').textContent = T('ex_level'); });
      later(400, () => waitVideo(t0));
      return true;
    }

    function leave() {
      if (!st.open || st.busy) return;
      st.busy = true;
      clear();
      try { V.pause(); } catch (e) { }
      q('.ex-end').hidden = true; q('.ex-big').hidden = true; q('.ex-sound').hidden = true; q('.ex-load').hidden = true;
      q('.ex-say').textContent = T('ex_up');
      phase('dive tunnel below rise');
      later(150, () => phase('dive tunnel rise'));
      later(1350, () => {
        const m = ctx.map();
        if (m) m.jumpTo({ center: SPHERE, zoom: Math.min(m.getMaxZoom(), 17.6), pitch: Math.min(m.getMaxPitch(), 62), bearing: m.getBearing() });
        phase('open');
        if (m) later(80, () => m.easeTo({ zoom: 16.4, pitch: 58, duration: 1600, essential: true }));
      });
      later(2300, () => {
        root.hidden = true; root.className = '';
        st.open = false; st.busy = false;
        if (ctx.onClose) ctx.onClose();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (!st.open) return;
      if (e.key === 'Escape') { e.stopPropagation(); leave(); }
      else if (e.key === ' ' && root.classList.contains('playing')) { e.preventDefault(); if (V.paused) V.play().catch(() => {}); else V.pause(); poke(); }
    }, true);

    function tick() {
      const m = ctx.map(), lm = ctx.lm();
      if (st.open || !m || !lm) { if (st.tagOn) { tag.hidden = true; st.tagOn = false; } return; }
      const s = lm.screen('nuralem');
      const ok = !!s && ctx.canEnter() && m.getZoom() >= 14.6 && s.x > 30 && s.x < s.W - 30 && s.top > 70 && s.y < s.H - 40 && s.r > 9;
      if (!ok) { if (st.tagOn) { tag.hidden = true; st.tagOn = false; } return; }
      if (!st.tagOn) { tag.hidden = false; st.tagOn = true; if (m.getZoom() >= 15.3) prefetch().catch(() => {}); }
      const free = (y) => { const e = document.elementFromPoint(s.x, y); return !e || e === tag || tag.contains(e) || !!e.closest('.maplibregl-canvas-container'); };
      const below = !(free(s.top - 28) && free(s.top - 44));
      tag.classList.toggle('below', below);
      tag.style.transform = below ? 'translate(' + s.x.toFixed(1) + 'px,' + (s.by + 14).toFixed(1) + 'px) translate(-50%,0)' : 'translate(' + s.x.toFixed(1) + 'px,' + (s.top - 10).toFixed(1) + 'px) translate(-50%,-100%)';
    }

    return {
      tick,
      texts,
      enter,
      leave,
      isOpen: () => st.open,
      hit: (x, y) => { const lm = ctx.lm(); return !!lm && ctx.canEnter() && lm.hit('nuralem', x, y); },
      prefetch,
    };
  }

  window.BoranExpo = { create };
})();
