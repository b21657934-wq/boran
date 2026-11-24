import { pathToFileURL } from 'node:url';
import { buildGraph, search, nearestLane, ALGOS } from '../boran/frontend/parking/ai.js';

export const GARAGE = {
  aisles: [{ x: -17.6, id: 'A' }, { x: 0, id: 'B' }, { x: 17.6, id: 'C' }],
  NB: 20,
  bayZ: (k) => 3 + 2.6 * (k + 0.5),
  rowS: -0.5,
  rowN: 62,
  rowXs: [-22, -17.6, -13.2, -8.8, -4.4, 0, 4.4, 8.8, 13.2, 17.6, 22],
  ramp: [-32, -28, -24, -20, -16, -12, -8, -4.3],
  bayOff: 6.2,
  blocked: [{ x0: -16.45, x1: -15.0, z0: 55.1, z1: 70.4 }],
};

const G = buildGraph(GARAGE);
const goal = G.nodes.find((n) => n.name === 'A-20').id;
const isFree = (n) => n.name === 'A-20';
const LABEL = { bfs: 'BFS', dfs: 'DFS', ucs: 'UCS', astar: 'A*' };
const STARTS = [['ramp (entrance)', 0.4, -29.5], ['aisle C, middle', 17.6, 30], ['north row, east', 10, 62]];
const runs = STARTS.map(([start, x, z]) => {
  const st = nearestLane(G, x, z, 0, 1);
  return {
    start,
    algos: ALGOS.map((a) => {
      const r = search(G, a, st, { isFree, goal });
      return { algo: LABEL[a], found: r.found >= 0 ? G.nodes[r.found].name : null, expanded: r.expanded, scanned: r.scanned, steps: r.steps, cost: Math.round(r.cost) };
    }),
  };
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify({ nodes: G.nodes.length, lanes: G.nodes.filter((n) => n.kind === 'lane').length, bays: G.nodes.filter((n) => n.kind === 'bay').length, runs }));
