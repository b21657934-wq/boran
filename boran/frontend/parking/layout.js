export const AISLES = [{ x: -17.6, id: 'A', col: '#c8463c' }, { x: 0, id: 'B', col: '#2d8a9e' }, { x: 17.6, id: 'C', col: '#3f9a5b' }];
export const BAY = 2.6, Z0 = 3.0, NB = 20, BAY_OFF = 6.2;
export const WX = 26.8, ZS = -4.3, ZN = 69.4, ZROW = Z0 + BAY * NB;
export const ROW_S = -0.5, ROW_N = 62;
export const ROW_XS = [-22, -17.6, 0, 17.6, 22];
export const RAMP = [-32, -28, -24, -20, -16, -12, -8, -4.3];
export const START = { x: 0.4, z: -29.5 };
export const bayZ = (k) => Z0 + BAY * (k + 0.5);

export const PASSAGES = [
  { a: 'B', b: 'C', j: 1 },
  { a: 'A', b: 'B', j: 2 },
  { a: 'B', b: 'C', j: 3 },
  { a: 'A', b: 'B', j: 4 },
];

export const WALLS = [
  { t: 'aisle', x: 17.6, z: 18.6 },
  { t: 'aisle', x: -17.6, z: 29.0 },
  { t: 'lane', x: -8.8, z: ROW_N },
  { t: 'lane', x: 8.8, z: ROW_N },
];

export const FREE_BAYS = ['A-20', 'B-17', 'C-14', 'C-17', 'C-28'];
export const DFS_ORDER = 'WNES';

export const passageZ = (P) => bayZ(3 * P.j + 1);
export const passageSpan = (P) => [Z0 + BAY * 3 * P.j, Z0 + BAY * (3 * P.j + 3)];
export const aisleX = (id) => AISLES.find((a) => a.id === id).x;

export function inGap(aid, sd, k) {
  return PASSAGES.some((P) => k >= 3 * P.j && k <= 3 * P.j + 2 && ((aid === P.a && sd > 0) || (aid === P.b && sd < 0)));
}

export function bayName(aid, sd, k) {
  return aid + '-' + String(sd < 0 ? k + 1 : k + 21).padStart(2, '0');
}

export function wallRect(w) {
  if (w.t === 'aisle') return { x0: w.x - 3.6, x1: w.x + 3.6, z0: w.z - 0.3, z1: w.z + 0.3 };
  return w.z < 20 ? { x0: w.x - 0.3, x1: w.x + 0.3, z0: ZS, z1: Z0 } : { x0: w.x - 0.3, x1: w.x + 0.3, z0: ZROW, z1: ZN };
}

export function graphConfig() {
  return {
    aisles: AISLES, NB, bayZ, rowS: ROW_S, rowN: ROW_N, rowXs: ROW_XS, ramp: RAMP, bayOff: BAY_OFF,
    blocked: WALLS.map(wallRect), gap: inGap, passStep: 99, dfsOrder: DFS_ORDER,
    passages: PASSAGES.map((P) => ({ a: P.a, b: P.b, k: 3 * P.j + 1 })),
  };
}
