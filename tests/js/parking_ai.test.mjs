import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, search, nearestLane, ALGOS } from '../../boran/frontend/parking/ai.js';
import { GARAGE } from '../../tools/parking_eval.mjs';

const G = buildGraph(GARAGE);
const free = G.nodes.find((n) => n.name === 'A-20');
const opt = { isFree: (n) => n.name === 'A-20', goal: free.id };
const start = (x, z) => nearestLane(G, x, z, 0, 1);

test('graph has 3 aisles × 40 bays and the lanes between them', () => {
  assert.equal(G.nodes.filter((n) => n.kind === 'bay').length, 120);
  assert.ok(G.nodes.filter((n) => n.kind === 'lane').length > 80);
});

test('closed passage removes the north-row edge next to aisle A', () => {
  const a = G.nodes.find((n) => n.kind === 'lane' && n.x === -17.6 && n.z === 62);
  const b = G.nodes.find((n) => n.kind === 'lane' && n.x === -13.2 && n.z === 62);
  assert.ok(!G.adj[a.id].some((e) => e.to === b.id));
});

test('every algorithm finds the only free bay from every start', () => {
  for (const [x, z] of [[0.4, -29.5], [17.6, 30], [10, 62], [-17.6, 20]]) {
    for (const a of ALGOS) {
      const r = search(G, a, start(x, z), opt);
      assert.equal(G.nodes[r.found].name, 'A-20', a);
      assert.equal(r.path[r.path.length - 1], free.id);
    }
  }
});

test('paths only use existing edges and never pass through an occupied bay', () => {
  for (const a of ALGOS) {
    const r = search(G, a, start(17.6, 30), opt);
    for (let i = 1; i < r.path.length; i++) assert.ok(G.adj[r.path[i - 1]].some((e) => e.to === r.path[i]), a);
    assert.ok(r.path.slice(0, -1).every((id) => G.nodes[id].kind === 'lane'));
  }
});

test('UCS and A* return the optimal cost; BFS matches it here; DFS can be longer', () => {
  const s = start(17.6, 30);
  const c = Object.fromEntries(ALGOS.map((a) => [a, search(G, a, s, opt).cost]));
  assert.ok(Math.abs(c.ucs - c.astar) < 1e-9);
  assert.ok(c.bfs >= c.ucs - 1e-9);
  assert.ok(c.dfs > c.ucs + 10);
});

test('A* never expands more nodes than UCS (consistent straight-line heuristic)', () => {
  for (const [x, z] of [[0.4, -29.5], [17.6, 30], [10, 62], [-17.6, 20], [0, 40]]) {
    const s = start(x, z);
    assert.ok(search(G, 'astar', s, opt).expanded <= search(G, 'ucs', s, opt).expanded);
  }
});

test('search events replay correctly: every expanded node was generated first', () => {
  for (const a of ALGOS) {
    const r = search(G, a, start(0.4, -29.5), opt);
    const gen = new Set();
    for (const e of r.events) {
      if (e[0] === 'gen') gen.add(e[1]);
      if (e[0] === 'exp') assert.ok(gen.has(e[1]), a);
    }
    assert.equal(r.events[r.events.length - 1][0], 'done');
  }
});
