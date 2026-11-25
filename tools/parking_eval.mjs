import { pathToFileURL } from 'node:url';
import { buildGraph, search, nearestLane, ALGOS } from '../boran/frontend/parking/ai.js';
import { graphConfig, FREE_BAYS, START } from '../boran/frontend/parking/layout.js';

export const G = buildGraph(graphConfig());
export const GOALS = FREE_BAYS.map((nm) => G.nodes.find((n) => n.name === nm).id);
export const OPT = { isFree: (n) => FREE_BAYS.includes(n.name), goals: GOALS };
const LABEL = { bfs: 'BFS', dfs: 'DFS', greedy: 'Greedy', ucs: 'UCS', astar: 'A*' };
const STARTS = [['ramp (entrance)', START.x, START.z], ['aisle C, south', 17.6, 8]];
const runs = STARTS.map(([start, x, z]) => {
  const st = nearestLane(G, x, z, 0, 1);
  return {
    start,
    algos: ALGOS.map((a) => {
      const r = search(G, a, st, OPT);
      return { algo: LABEL[a], found: r.found >= 0 ? G.nodes[r.found].name : null, expanded: r.expanded, scanned: r.scanned, steps: r.steps, cost: Math.round(r.cost) };
    }),
  };
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify({ nodes: G.nodes.length, lanes: G.nodes.filter((n) => n.kind === 'lane').length, bays: G.nodes.filter((n) => n.kind === 'bay').length, free: FREE_BAYS, runs }));
