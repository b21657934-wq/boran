import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, search, nearestLane, ALGOS } from '../../boran/frontend/parking/ai.js';
import { graphConfig, FREE_BAYS, START, PASSAGES, WALLS, passageZ, aisleX, wallRect } from '../../boran/frontend/parking/layout.js';

const G = buildGraph(graphConfig());
const GOALS = FREE_BAYS.map((nm) => G.nodes.find((n) => n.name === nm).id);
const opt = { isFree: (n) => FREE_BAYS.includes(n.name), goals: GOALS };
const start = (x, z) => nearestLane(G, x, z, 0, 1);
const lane = (x, z) => G.nodes.find((n) => n.kind === 'lane' && Math.abs(n.x - x) < 1e-6 && Math.abs(n.z - z) < 1e-6);
const linked = (a, b) => G.adj[a.id].some((e) => e.to === b.id);
const STARTS = [[START.x, START.z], [17.6, 8], [0, 30], [-17.6, 45], [20, 62]];

test('passages remove 3 bays on each side and leave 96 bays', () => {
  assert.equal(G.nodes.filter((n) => n.kind === 'bay').length, 120 - PASSAGES.length * 6);
  for (const P of PASSAGES) assert.ok(linked(lane(aisleX(P.a), passageZ(P)), lane(aisleX(P.b), passageZ(P))));
});

test('walls cut the graph: no edge crosses a closed aisle or lane', () => {
  for (const w of WALLS) {
    const R = wallRect(w);
    for (const n of G.nodes) for (const e of G.adj[n.id]) {
      const m = G.nodes[e.to];
      const hit = Math.max(n.x, m.x) >= R.x0 && Math.min(n.x, m.x) <= R.x1 && Math.max(n.z, m.z) >= R.z0 && Math.min(n.z, m.z) <= R.z1;
      assert.ok(!hit, `${n.x},${n.z} -> ${m.x},${m.z}`);
    }
  }
});

test('every algorithm reaches one of the free bays from every start', () => {
  for (const [x, z] of STARTS) for (const a of ALGOS) {
    const r = search(G, a, start(x, z), opt);
    assert.ok(FREE_BAYS.includes(G.nodes[r.found].name), a);
    assert.equal(r.path[r.path.length - 1], r.found);
  }
});

test('paths only use existing edges and never pass through a parked car', () => {
  for (const [x, z] of STARTS) for (const a of ALGOS) {
    const r = search(G, a, start(x, z), opt);
    for (let i = 1; i < r.path.length; i++) assert.ok(G.adj[r.path[i - 1]].some((e) => e.to === r.path[i]), a);
    assert.ok(r.path.slice(0, -1).every((id) => G.nodes[id].kind === 'lane'));
  }
});

test('UCS and A* return the same optimal cost; BFS has the fewest steps; nothing beats UCS', () => {
  for (const [x, z] of STARTS) {
    const s = start(x, z);
    const R = Object.fromEntries(ALGOS.map((a) => [a, search(G, a, s, opt)]));
    assert.ok(Math.abs(R.ucs.cost - R.astar.cost) < 1e-9);
    for (const a of ALGOS) assert.ok(R[a].cost >= R.ucs.cost - 1e-9, a);
    for (const a of ALGOS) assert.ok(R.bfs.steps <= R[a].steps, a);
  }
});

test('A* never expands more nodes than UCS (consistent straight-line heuristic)', () => {
  for (const [x, z] of STARTS) {
    const s = start(x, z);
    assert.ok(search(G, 'astar', s, opt).expanded <= search(G, 'ucs', s, opt).expanded);
  }
});

test('from the entrance the five algorithms behave differently in the maze', () => {
  const s = start(START.x, START.z);
  const R = Object.fromEntries(ALGOS.map((a) => [a, search(G, a, s, opt)]));
  const bay = (a) => G.nodes[R[a].found].name;
  assert.equal(bay('ucs'), 'B-17');
  assert.equal(bay('astar'), 'B-17');
  assert.equal(bay('bfs'), 'C-28');
  assert.equal(bay('greedy'), 'C-14');
  assert.equal(bay('dfs'), 'A-20');
  assert.ok(R.bfs.steps < R.ucs.steps && R.bfs.cost > R.ucs.cost);
  assert.ok(R.greedy.expanded < R.astar.expanded && R.astar.expanded < R.ucs.expanded);
  assert.ok(R.greedy.cost > R.ucs.cost * 1.2);
  assert.ok(R.dfs.cost > R.ucs.cost * 1.5);
});

test('the starting node is never taken from behind a wall', () => {
  const s = G.nodes[nearestLane(G, 10, 62, 0, 1)];
  assert.equal(s.x, 17.6);
});

test('search events replay correctly: every expanded node was generated first', () => {
  for (const a of ALGOS) {
    const r = search(G, a, start(START.x, START.z), opt);
    const gen = new Set();
    for (const e of r.events) {
      if (e[0] === 'gen') gen.add(e[1]);
      if (e[0] === 'exp') assert.ok(gen.has(e[1]), a);
    }
    assert.equal(r.events[r.events.length - 1][0], 'done');
  }
});
