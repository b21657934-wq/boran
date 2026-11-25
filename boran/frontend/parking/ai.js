export const ALGOS = ['bfs', 'dfs', 'greedy', 'ucs', 'astar'];

export function buildGraph(cfg) {
  const nodes = [], byKey = new Map(), adj = [];
  const key = (x, z) => x.toFixed(2) + ',' + z.toFixed(2);
  function add(x, z, kind, extra) {
    const k = key(x, z);
    if (byKey.has(k)) return byKey.get(k);
    const id = nodes.length;
    nodes.push(Object.assign({ id, x, z, kind }, extra || {}));
    adj.push([]);
    byKey.set(k, id);
    return id;
  }
  const blocked = (a, b) => cfg.blocked.some((B) => {
    const x0 = Math.min(nodes[a].x, nodes[b].x), x1 = Math.max(nodes[a].x, nodes[b].x);
    const z0 = Math.min(nodes[a].z, nodes[b].z), z1 = Math.max(nodes[a].z, nodes[b].z);
    return x1 >= B.x0 && x0 <= B.x1 && z1 >= B.z0 && z0 <= B.z1;
  });
  function link(a, b) {
    if (a === b || blocked(a, b)) return;
    const w = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
    if (!adj[a].some((e) => e.to === b)) adj[a].push({ to: b, w });
    if (!adj[b].some((e) => e.to === a)) adj[b].push({ to: a, w });
  }
  const chain = (ids) => { for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]); };
  chain(cfg.ramp.map((z) => add(0, z, 'lane')).concat([add(0, cfg.rowS, 'lane')]));
  chain(cfg.rowXs.map((x) => add(x, cfg.rowS, 'lane')));
  chain(cfg.rowXs.map((x) => add(x, cfg.rowN, 'lane')));
  const gap = cfg.gap || (() => false);
  for (const A of cfg.aisles) {
    const ids = [add(A.x, cfg.rowS, 'lane')];
    for (let k = 0; k < cfg.NB; k++) ids.push(add(A.x, cfg.bayZ(k), 'lane'));
    ids.push(add(A.x, cfg.rowN, 'lane'));
    chain(ids);
    for (let k = 0; k < cfg.NB; k++) for (const sd of [-1, 1]) {
      if (gap(A.id, sd, k)) continue;
      const num = sd < 0 ? k + 1 : k + 21;
      const b = add(A.x + sd * cfg.bayOff, cfg.bayZ(k), 'bay', { aisle: A.id, sd, k, name: A.id + '-' + String(num).padStart(2, '0') });
      link(ids[k + 1], b);
    }
  }
  for (const P of cfg.passages || []) {
    const a = cfg.aisles.find((x) => x.id === P.a), b = cfg.aisles.find((x) => x.id === P.b), z = cfg.bayZ(P.k);
    const ids = [add(a.x, z, 'lane')];
    const st = cfg.passStep || 4.4;
    for (let x = a.x + st; x < b.x - 1; x += st) ids.push(add(x, z, 'lane', { passage: true }));
    ids.push(add(b.x, z, 'lane'));
    chain(ids);
  }
  return { nodes, adj, blocked: cfg.blocked, dfsOrder: cfg.dfsOrder };
}

export function nearestLane(G, x, z, hx, hz) {
  const cut = (n) => (G.blocked || []).some((B) => Math.max(x, n.x) >= B.x0 && Math.min(x, n.x) <= B.x1 && Math.max(z, n.z) >= B.z0 && Math.min(z, n.z) <= B.z1);
  for (const strict of [true, false]) {
    let best = -1, bd = Infinity;
    for (const n of G.nodes) {
      if (n.kind !== 'lane') continue;
      if (strict && cut(n)) continue;
      const dx = n.x - x, dz = n.z - z;
      let d = Math.hypot(dx, dz);
      if (hx != null && (dx * hx + dz * hz) < -1.5) d += 6;
      if (d < bd) { bd = d; best = n.id; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

class Heap {
  constructor() { this.a = []; }
  push(p, v) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

function ordered(G, id, deep, order) {
  const n = G.nodes[id];
  const rank = (e) => {
    const m = G.nodes[e.to];
    if (m.kind === 'bay') return 0;
    const dx = m.x - n.x, dz = m.z - n.z;
    if (deep) { const dir = Math.abs(dz) >= Math.abs(dx) ? (dz > 0 ? 'N' : 'S') : (dx > 0 ? 'E' : 'W'); return 1 + (order || 'NEWS').indexOf(dir); }
    if (Math.abs(dz) >= Math.abs(dx)) return dz < 0 ? 1 : 4;
    return dx < 0 ? 2 : 3;
  };
  return G.adj[id].slice().sort((a, b) => rank(a) - rank(b));
}

export function search(G, algo, start, opt) {
  const isFree = opt.isFree;
  const goals = opt.goals || (opt.goal != null ? [opt.goal] : []);
  const N = G.nodes, ev = [];
  const parent = new Map([[start, -1]]), g = new Map([[start, 0]]);
  const seenBay = new Set();
  let expanded = 0, scanned = 0, found = -1, maxFront = 1;
  const dist = (id) => { let m = Infinity; for (const t of goals) m = Math.min(m, Math.hypot(N[id].x - N[t].x, N[id].z - N[t].z)); return goals.length ? m : 0; };
  const h = (id) => (algo === 'astar' || algo === 'greedy' ? dist(id) : 0);
  const prio = (gv, id) => (algo === 'greedy' ? h(id) : gv + h(id));
  const scanBay = (bay, from) => {
    if (seenBay.has(bay)) return null;
    seenBay.add(bay); scanned++;
    const free = !!isFree(N[bay]);
    ev.push(['scan', bay, free, from]);
    return free;
  };
  if (algo === 'dfs') {
    const st = [[start, -1]], done = new Set();
    ev.push(['gen', start, -1]);
    while (st.length && found < 0) {
      const [id, p] = st.pop();
      if (done.has(id)) continue;
      done.add(id); parent.set(id, p); if (p >= 0) g.set(id, g.get(p) + Math.hypot(N[id].x - N[p].x, N[id].z - N[p].z));
      expanded++;
      ev.push(['exp', id, st.length, p]);
      const nb = ordered(G, id, true, opt.dfsOrder || G.dfsOrder);
      for (const e of nb) {
        if (N[e.to].kind !== 'bay') continue;
        const free = scanBay(e.to, id);
        if (free) { parent.set(e.to, id); g.set(e.to, g.get(id) + e.w); found = e.to; break; }
      }
      if (found >= 0) break;
      for (const e of nb.slice().reverse()) {
        if (N[e.to].kind === 'bay' || done.has(e.to)) continue;
        st.push([e.to, id]);
        ev.push(['gen', e.to, id]);
      }
      maxFront = Math.max(maxFront, st.length);
    }
  } else if (algo === 'bfs') {
    const fr = [start];
    ev.push(['gen', start, -1]);
    while (fr.length && found < 0) {
      const id = fr.shift();
      expanded++;
      ev.push(['exp', id, fr.length]);
      const nb = ordered(G, id);
      for (const e of nb) {
        if (N[e.to].kind === 'bay') {
          const free = scanBay(e.to, id);
          if (free) { parent.set(e.to, id); g.set(e.to, g.get(id) + e.w); found = e.to; break; }
          continue;
        }
        if (parent.has(e.to)) continue;
        parent.set(e.to, id); g.set(e.to, g.get(id) + e.w);
        fr.push(e.to);
        ev.push(['gen', e.to, id]);
      }
      maxFront = Math.max(maxFront, fr.length);
    }
  } else if (algo === 'greedy') {
    const pq = new Heap();
    pq.push(h(start), start);
    ev.push(['gen', start, -1]);
    const closed = new Set();
    while (pq.size) {
      const [, id] = pq.pop();
      if (closed.has(id)) continue;
      closed.add(id);
      expanded++;
      ev.push(['exp', id, pq.size]);
      if (N[id].kind === 'bay') { found = id; break; }
      for (const e of ordered(G, id)) {
        if (closed.has(e.to) || parent.has(e.to)) continue;
        if (N[e.to].kind === 'bay' && !scanBay(e.to, id)) continue;
        parent.set(e.to, id); g.set(e.to, g.get(id) + e.w);
        pq.push(h(e.to), e.to);
        ev.push(['gen', e.to, id]);
      }
      maxFront = Math.max(maxFront, pq.size);
    }
  } else {
    const pq = new Heap();
    pq.push(prio(0, start), start);
    ev.push(['gen', start, -1]);
    const closed = new Set();
    while (pq.size) {
      const [, id] = pq.pop();
      if (closed.has(id)) continue;
      closed.add(id);
      expanded++;
      ev.push(['exp', id, pq.size]);
      if (N[id].kind === 'bay') { found = id; break; }
      for (const e of ordered(G, id)) {
        if (closed.has(e.to)) continue;
        if (N[e.to].kind === 'bay') {
          const free = scanBay(e.to, id);
          if (!free) continue;
        }
        const ng = g.get(id) + e.w;
        if (!g.has(e.to) || ng < g.get(e.to) - 1e-9) {
          g.set(e.to, ng); parent.set(e.to, id);
          pq.push(prio(ng, e.to), e.to);
          ev.push(['gen', e.to, id]);
        }
      }
      maxFront = Math.max(maxFront, pq.size);
    }
  }
  const path = [];
  if (found >= 0) { let c = found; while (c !== -1) { path.push(c); c = parent.get(c); } path.reverse(); }
  let cost = 0;
  for (let i = 1; i < path.length; i++) cost += Math.hypot(N[path[i]].x - N[path[i - 1]].x, N[path[i]].z - N[path[i - 1]].z);
  ev.push(['done', found]);
  return { algo, events: ev, path, found, expanded, scanned, cost, steps: Math.max(0, path.length - 1), maxFront };
}
