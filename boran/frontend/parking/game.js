import * as THREE from './three.module.min.js';
import { EffectComposer } from './EffectComposer.js';
import { RenderPass } from './RenderPass.js';
import { UnrealBloomPass } from './UnrealBloomPass.js';
import { OutputPass } from './OutputPass.js';
import { RoomEnvironment } from './RoomEnvironment.js';
import { mergeGeometries } from './BufferGeometryUtils.js';

const FALLBACK = {
  pg_obj_gate: 'Drive up to the barrier', pg_obj_gate_s: 'Your plate is read automatically',
  pg_gate_open: 'Plate 777 ABC 01 recognised · welcome', pg_obj_find: 'Find the free bay',
  pg_obj_find_s: 'Smart Parking: one bay is free — A-20, aisle A, far corner', pg_closed: 'Passage closed for repairs — go round through aisle A from the south',
  pg_obj_park: 'Pull into A-20 and stop', pg_obj_park_s: 'Tip: press C for the top view', pg_crooked: 'Straighten up: the whole car must be inside the lines',
  pg_hits: 'bumps: {n}', pg_cam_chase: 'Behind', pg_cam_cockpit: 'Driver', pg_cam_top: 'Top', pg_video: 'Watch the finished video', pg_back: 'Back up to the map',
  pg_k_gas: 'gas', pg_k_brake: 'brake · reverse', pg_k_steer: 'steer', pg_k_boost: 'boost', pg_k_hand: 'handbrake', pg_k_cam: 'camera', pg_k_reset: 'restart', pg_k_hide: 'hide tips',
  pg_win: 'Parked!', pg_win_sub: 'Bay A-20 · {time} · bumps: {hits} · accuracy {acc}%', pg_again: 'Play again', pg_kmh: 'km/h', pg_start: 'Press W or ↑ to drive', pg_space: 'Space',
};

const rndSeed = { s: 23 };
const rnd = () => (rndSeed.s = (rndSeed.s * 16807) % 2147483647) / 2147483647;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const lerp = (a, b, k) => a + (b - a) * k;
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

const AISLES = [{ x: -17.6, id: 'A', col: '#c8463c' }, { x: 0, id: 'B', col: '#2d8a9e' }, { x: 17.6, id: 'C', col: '#3f9a5b' }];
const XA = -17.6;
const BAY = 2.6, Z0 = 3.0, NB = 20, CEIL = 2.9;
const WX = 26.8, ZS = -4.3, ZN = 69.4, ZROW = Z0 + BAY * NB, ZR0 = -35;
const bayZ = (k) => Z0 + BAY * (k + 0.5);
const FREE = { x: XA - 6.15, z: bayZ(19), led: XA - 3.78 };
const BAYRECT = { x0: XA - 8.8, x1: XA - 3.6, z0: Z0 + BAY * 19, z1: Z0 + BAY * 20 };
const BARRIER_X = -16.2, GATE_Z = -20;
const rampY = (z) => (z < -18 ? 2.8 : z > -4.3 ? 0 : 2.8 * sstep(0, 1, (-4.3 - z) / 13.7));
const onRamp = (x, z) => z < ZS + 0.3 && Math.abs(x) < 3.4;
const floorY = (x, z) => (onRamp(x, z) ? rampY(z) : 0);

export function createGame(host, opts) {
  const T = (k, v) => { let s = opts && opts.t ? opts.t(k, v) : null; if (!s || s === k) { s = FALLBACK[k] || k; if (v) for (const a in v) s = s.split('{' + a + '}').join(v[a]); } return s; };
  rndSeed.s = 23;

  const canvas = document.createElement('canvas');
  canvas.className = 'pg-canvas';
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let pr = Math.min(1.25, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#121418');
  scene.fog = new THREE.Fog('#24272c', 26, 100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight('#eef2f7', '#4a4740', 1.15));
  const sun = new THREE.DirectionalLight('#fff6ea', 0.35); sun.position.set(0.3, 1, 0.2); scene.add(sun);
  const hi = new THREE.Group(); scene.add(hi);

  function ctex(w, h, draw, rep) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    t.userData.g = g; t.userData.c = c;
    return t;
  }
  function noiseFill(g, w, h, n, a, rmax) {
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, r = 1 + rnd() * rmax, v = rnd() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${v},${v},${v},${a * rnd()})`;
      g.beginPath(); g.ellipse(x, y, r, r * (0.4 + rnd()), rnd() * 3, 0, 7); g.fill();
    }
  }
  const LO = { concrete: [], dark: [], yellow: [], white: [], orange: [] };
  const HI = { ceiling: [], dark: [], red: [], tube: [], housing: [], steel: [] };
  function boxAt(list, sx, sy, sz, x, y, z, ry = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, -z);
    list.push(g);
  }

  // ---------- garage ----------
  const LIGHTS = [];
  for (const A of AISLES) {
    for (let z = -1.5; z < ZN - 1; z += 5.2) LIGHTS.push({ x: A.x - 1.6, z }, { x: A.x + 1.6, z });
    for (let z = 4.3; z < ZROW; z += 5.2) LIGHTS.push({ x: A.x - 6.2, z }, { x: A.x + 6.2, z });
  }
  for (let x = -24; x <= 24; x += 6) { if (Math.abs(x) > 4) LIGHTS.push({ x, z: -1.0, rot: true }); LIGHTS.push({ x, z: 59.5, rot: true }, { x, z: 65.0, rot: true }); }
  for (const z of [-33, -29.5, -26, -22.5, -19, -15.5, -12, -8.5]) LIGHTS.push({ x: 0, z, ramp: true });

  const PX = 30;
  const fw = Math.round(2 * WX * PX), fh = Math.round((ZN - ZS) * PX);
  const U = (x) => (x + WX) * PX, V = (z) => (ZN - z) * PX;
  function arrow(g, x, z, rot, s = 1) {
    g.save(); g.translate(U(x), V(z)); g.rotate(rot); g.scale(s, s);
    g.beginPath(); g.moveTo(0, -40); g.lineTo(16, -15); g.lineTo(6, -15); g.lineTo(6, 34); g.lineTo(-6, 34); g.lineTo(-6, -15); g.lineTo(-16, -15); g.closePath(); g.fill(); g.restore();
  }
  const floorTex = ctex(fw, fh, (g) => {
    g.fillStyle = '#76797d'; g.fillRect(0, 0, fw, fh);
    noiseFill(g, fw, fh, 9000, 0.05, 20);
    for (let i = 0; i < 140; i++) { const x = U((rnd() - 0.5) * 50), z = V(ZS + rnd() * (ZN - ZS)); g.fillStyle = `rgba(10,10,10,${0.04 + rnd() * 0.06})`; g.beginPath(); g.ellipse(x, z, 10 + rnd() * 38, 6 + rnd() * 18, rnd() * 3, 0, 7); g.fill(); }
    for (const L of LIGHTS) {
      if (L.ramp) continue;
      const gr = g.createRadialGradient(U(L.x), V(L.z), 0, U(L.x), V(L.z), 3.3 * PX);
      gr.addColorStop(0, 'rgba(255,253,245,.22)'); gr.addColorStop(1, 'rgba(255,253,245,0)');
      g.fillStyle = gr; g.fillRect(U(L.x) - 3.3 * PX, V(L.z) - 3.3 * PX, 6.6 * PX, 6.6 * PX);
    }
    g.fillStyle = '#ecebe6';
    for (const A of AISLES) for (const sd of [-1, 1]) {
      const xa = A.x + sd * 3.6, xb = A.x + sd * 8.8;
      for (let k = 0; k <= NB; k++) { const z = Z0 + BAY * k; g.fillRect(U(Math.min(xa, xb)), V(z) - 2, Math.abs(xb - xa) * PX, 4); }
      g.save(); g.font = '800 22px Inter, sans-serif'; g.fillStyle = 'rgba(236,235,230,.9)'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 0; k < NB; k++) {
        const num = sd < 0 ? k + 1 : k + 21;
        g.save(); g.translate(U(A.x + sd * 8.1), V(bayZ(k))); g.rotate(sd > 0 ? Math.PI / 2 : -Math.PI / 2);
        g.fillText(A.id + ' ' + String(num).padStart(2, '0'), 0, 0); g.restore();
      }
      g.restore();
    }
    g.fillStyle = 'rgba(236,235,230,.85)';
    for (const A of AISLES) for (let z = 9; z < 52; z += 13) { arrow(g, A.x + 1.3, z, 0); arrow(g, A.x - 1.6, z + 6, Math.PI); }
    for (let x = -22; x <= 22; x += 11) { if (Math.abs(x) < 4) continue; arrow(g, x, -0.5, -Math.PI / 2, 0.9); arrow(g, x + 4, 62, Math.PI / 2, 0.9); }
    g.save(); g.translate(U(1.3), V(-2.4)); g.font = '800 38px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('SLOW', 0, 0); g.restore();
    g.strokeStyle = 'rgba(236,235,230,.7)'; g.lineWidth = 4; g.setLineDash([24, 20]);
    for (const A of AISLES) { g.beginPath(); g.moveTo(U(A.x), V(3.5)); g.lineTo(U(A.x), V(ZROW - 0.5)); g.stroke(); }
    g.setLineDash([]);
    g.save(); g.beginPath(); g.rect(U(BARRIER_X - 1.2), V(ZN), 2.4 * PX, (ZN - ZROW) * PX); g.clip();
    g.strokeStyle = 'rgba(232,190,40,.85)'; g.lineWidth = 9;
    for (let k = -30; k < 30; k++) { g.beginPath(); g.moveTo(U(BARRIER_X - 1.2) + k * 22, V(ZN)); g.lineTo(U(BARRIER_X - 1.2) + k * 22 + 120, V(ZROW)); g.stroke(); }
    g.restore();
    g.font = '800 42px Inter, sans-serif'; g.fillStyle = 'rgba(236,235,230,.92)';
    g.save(); g.translate(U(FREE.x + 1.2), V(FREE.z)); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A 20', 0, 0); g.restore();
  });
  floorTex.anisotropy = 16;
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * WX, ZN - ZS), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, metalness: 0.0, envMapIntensity: 0.9 }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0, -(ZS + ZN) / 2); scene.add(m);
  }
  // ramp
  {
    const pos = [], uv = [], idx = [];
    const zs = []; for (let z = ZR0; z <= ZS - 0.0001; z += 0.25) zs.push(z); zs.push(ZS);
    zs.forEach((z, i) => { const y = rampY(z); pos.push(-3.2, y, -z, 3.2, y, -z); uv.push(0, (z - ZR0) / 3, 1, (z - ZR0) / 3); if (i) { const a = 2 * (i - 1); idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const tex = ctex(256, 128, (c, w, h) => {
      c.fillStyle = '#6e7174'; c.fillRect(0, 0, w, h); noiseFill(c, w, h, 900, 0.06, 6);
      c.strokeStyle = 'rgba(30,30,30,.35)'; c.lineWidth = 3; for (let y = 8; y < h; y += 16) { c.beginPath(); c.moveTo(18, y); c.lineTo(w - 18, y); c.stroke(); }
      for (let y = 0; y < h; y += 32) { c.fillStyle = '#e2b52a'; c.fillRect(0, y, 14, 16); c.fillRect(w - 14, y + 16, 14, 16); c.fillStyle = '#1c1c1c'; c.fillRect(0, y + 16, 14, 16); c.fillRect(w - 14, y, 14, 16); }
    }, [1, 1]);
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })));
    const cpos = [], cidx = [];
    zs.forEach((z, i) => { const y = rampY(z) + 3.05; cpos.push(-3.2, y, -z, 3.2, y, -z); if (i) { const a = 2 * (i - 1); cidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3)); cg.setIndex(cidx); cg.computeVertexNormals();
    HI.ceiling.push(cg);
    for (const sx of [-1, 1]) boxAt(LO.concrete, 0.3, 6.4, ZS - ZR0 + 0.4, sx * 3.35, 2.0, (ZS + ZR0) / 2);
    boxAt(HI.ceiling, 6.4, 0.3, 1.0, 0, 3.1, ZS - 0.3);
    boxAt(LO.concrete, 6.8, 6.4, 0.3, 0, 3.0, ZR0 - 0.2);
  }
  // walls
  const wallTex = ctex(1024, 256, (g, w, h) => {
    g.fillStyle = '#c9c7c1'; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 2500, 0.05, 10);
    g.fillStyle = '#2e6f77'; g.fillRect(0, h * 0.58, w, h * 0.42);
    g.fillStyle = '#e8c23a'; g.fillRect(0, h * 0.56, w, 7);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '800 64px Inter, sans-serif'; g.fillText('P-1', 60, h * 0.88); g.fillText('P-1', 560, h * 0.88);
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; for (let x = 0; x < w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  }, [12, 1]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
  for (const sg of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ZN - ZS, CEIL), wallMat);
    m.rotation.y = sg > 0 ? -Math.PI / 2 : Math.PI / 2; m.position.set(sg * WX, CEIL / 2, -(ZS + ZN) / 2); scene.add(m);
  }
  {
    const endTex = ctex(2048, 192, (g, w, h) => {
      g.fillStyle = '#c9c7c1'; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 3000, 0.05, 10);
      g.fillStyle = '#2e6f77'; g.fillRect(0, h * 0.58, w, h * 0.42); g.fillStyle = '#e8c23a'; g.fillRect(0, h * 0.56, w, 6);
      g.fillStyle = '#16323a'; g.font = '800 54px Inter, sans-serif'; g.textAlign = 'center';
      for (const A of AISLES) g.fillText(A.id === 'B' ? 'EXPO · P-1' : 'AISLE ' + A.id, w * (A.x + WX) / (2 * WX), h * 0.4);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * WX, CEIL), new THREE.MeshStandardMaterial({ map: endTex, roughness: 0.85 }));
    m.position.set(0, CEIL / 2, -ZN); scene.add(m);
    boxAt(LO.concrete, WX - 3.2, CEIL, 0.3, -(WX + 3.2) / 2, CEIL / 2, ZS + 0.16);
    boxAt(LO.concrete, WX - 3.2, CEIL, 0.3, (WX + 3.2) / 2, CEIL / 2, ZS + 0.16);
    boxAt(LO.concrete, 4.0, CEIL, 5.0, 24.8, CEIL / 2, 66.9);
  }
  const ceilTex = ctex(512, 512, (g, w, h) => { g.fillStyle = '#4a4d52'; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 3000, 0.06, 12); }, [26, 36]);
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * WX, ZN - ZS), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95 }));
    m.rotation.x = Math.PI / 2; m.position.set(0, CEIL, -(ZS + ZN) / 2); hi.add(m);
  }
  for (let k = 0; k <= 7; k++) boxAt(HI.ceiling, 2 * WX, 0.34, 0.5, 0, CEIL - 0.17, Z0 + BAY * 3 * k);
  for (const z of [62.0, 67.0]) boxAt(HI.ceiling, 2 * WX, 0.34, 0.5, 0, CEIL - 0.17, z);
  for (const A of AISLES) for (const sg of [-1, 1]) {
    const pipe = new THREE.CylinderGeometry(0.04, 0.04, ZN - ZS, 8); pipe.rotateX(Math.PI / 2); pipe.translate(A.x + sg * 2.6, 2.8, -(ZS + ZN) / 2); HI.red.push(pipe);
  }
  for (const x of [-8.8, 8.8]) { const duct = new THREE.BoxGeometry(0.9, 0.42, ZROW - 2); duct.translate(x, 2.45, -(ZROW + 2) / 2); HI.steel.push(duct); }
  for (const A of AISLES) boxAt(HI.steel, 0.32, 0.06, ZN - ZS - 1, A.x, 2.78, (ZN + ZS) / 2);
  for (const L of LIGHTS) {
    const y = L.ramp ? rampY(L.z) + 2.98 : 2.8;
    const ry = L.ramp || L.rot ? Math.PI / 2 : 0;
    boxAt(HI.housing, 1.32, 0.07, 0.2, L.x, y + 0.04, L.z, ry);
    boxAt(HI.tube, 1.22, 0.035, 0.11, L.x, y, L.z, ry);
  }
  // pillars
  function pillarTex(label, col) {
    return ctex(128, 512, (g, w, h) => {
      g.fillStyle = '#e4e2dc'; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 250, 0.05, 6);
      g.fillStyle = col; g.fillRect(0, h * 0.2, w, h * 0.2);
      g.fillStyle = '#fff'; g.font = '800 56px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, h * 0.3);
      for (let y = h * 0.68; y < h; y += 20) { g.fillStyle = '#e3b425'; g.fillRect(0, y, w, 10); g.fillStyle = '#1d1d1d'; g.fillRect(0, y + 10, w, 10); }
    });
  }
  const pillarGeo = new THREE.BoxGeometry(0.6, CEIL, 0.6);
  const PILLARS = [];
  for (const A of AISLES) for (let k = 0; k <= 6; k++) {
    const mat = new THREE.MeshStandardMaterial({ map: pillarTex(A.id + (k + 1), A.col), roughness: 0.8 });
    for (const sg of [-1, 1]) {
      const m = new THREE.Mesh(pillarGeo, mat); m.position.set(A.x + sg * 3.9, CEIL / 2, -(Z0 + BAY * 3 * k)); scene.add(m);
      PILLARS.push({ x: A.x + sg * 3.9, z: Z0 + BAY * 3 * k });
    }
  }
  for (const A of AISLES) for (const sd of [-1, 1]) for (let k = 0; k < NB; k++) boxAt(LO.yellow, 0.15, 0.12, 1.5, A.x + sd * 8.35, 0.06, bayZ(k));

  // ---------- cars ----------
  const BODY_COLS = ['#f2f2f0', '#e9e9e7', '#c9cdd1', '#a7acb2', '#2b2e33', '#15171a', '#7d1d22', '#1f3d6b', '#5d6066', '#c9b89a', '#ffffff', '#3b4b5e'];
  const profileShape = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; };
  function extrude(pts, width, bevel) {
    const g = new THREE.ExtrudeGeometry(profileShape(pts), { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
    g.rotateY(Math.PI / 2); g.translate(-(width - 2 * bevel) / 2, 0, 0);
    return g;
  }
  const CAR_TYPES = {
    sedan: { L: 4.65, Wd: 1.82, body: [[-2.32, 0.3], [2.3, 0.3], [2.34, 0.56], [2.22, 0.74], [1.85, 0.82], [1.0, 0.9], [-1.75, 0.94], [-2.25, 0.9], [-2.34, 0.66]], glass: [[0.98, 0.88], [0.2, 1.34], [-0.95, 1.36], [-1.78, 0.93]], roof: [[0.18, 1.31], [-0.93, 1.33], [-0.93, 1.40], [0.18, 1.38]] },
    suv: { L: 4.6, Wd: 1.88, body: [[-2.28, 0.38], [2.28, 0.38], [2.32, 0.66], [2.22, 0.92], [1.6, 1.02], [1.05, 1.06], [-2.2, 1.08], [-2.3, 0.8]], glass: [[1.06, 1.04], [0.38, 1.58], [-1.95, 1.6], [-2.16, 1.06]], roof: [[0.34, 1.55], [-1.95, 1.57], [-1.95, 1.65], [0.34, 1.63]] },
    hatch: { L: 4.1, Wd: 1.78, body: [[-2.03, 0.3], [2.03, 0.3], [2.07, 0.56], [1.95, 0.74], [1.55, 0.82], [0.85, 0.9], [-1.95, 0.95], [-2.07, 0.62]], glass: [[0.85, 0.88], [0.1, 1.36], [-1.6, 1.38], [-1.98, 0.95]], roof: [[0.08, 1.33], [-1.6, 1.35], [-1.6, 1.42], [0.08, 1.40]] },
  };
  function carParts(type) {
    const Tt = CAR_TYPES[type];
    const body = extrude(Tt.body, Tt.Wd, 0.06), glass = extrude(Tt.glass, Tt.Wd - 0.18, 0.04), roof = extrude(Tt.roof, Tt.Wd - 0.22, 0.02);
    const wheels = [], rims = [];
    const wz = Tt.L / 2 - 0.8;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16); w.rotateZ(Math.PI / 2); w.translate(sx * (Tt.Wd / 2 - 0.12), 0.34, sz * wz); wheels.push(w);
      const r = new THREE.CylinderGeometry(0.2, 0.2, 0.245, 12); r.rotateZ(Math.PI / 2); r.translate(sx * (Tt.Wd / 2 - 0.12), 0.34, sz * wz); rims.push(r);
    }
    const bump = new THREE.BoxGeometry(Tt.Wd - 0.06, 0.16, 0.1);
    const fb = bump.clone(); fb.translate(0, 0.38, -Tt.L / 2 - 0.02);
    const rb = bump.clone(); rb.translate(0, 0.4, Tt.L / 2 + 0.02);
    const hl = [], tl = [];
    for (const sx of [-1, 1]) {
      const h = new THREE.BoxGeometry(0.38, 0.08, 0.06); h.translate(sx * (Tt.Wd / 2 - 0.3), type === 'suv' ? 0.84 : 0.66, -Tt.L / 2 - 0.01); hl.push(h);
      const t = new THREE.BoxGeometry(0.34, 0.09, 0.06); t.translate(sx * (Tt.Wd / 2 - 0.27), type === 'suv' ? 0.9 : 0.78, Tt.L / 2 + 0.01); tl.push(t);
    }
    const plate = new THREE.BoxGeometry(0.52, 0.12, 0.03); const pf = plate.clone(); pf.translate(0, 0.5, -Tt.L / 2 - 0.08); const prr = plate.clone(); prr.translate(0, 0.6, Tt.L / 2 + 0.08);
    return { T: Tt, body: mergeGeometries([body, roof]), glass, wheels: mergeGeometries(wheels), rims: mergeGeometries(rims), black: mergeGeometries([fb, rb]), hl: mergeGeometries(hl), tl: mergeGeometries(tl), plate: mergeGeometries([pf, prr]) };
  }
  const PARTS = { sedan: carParts('sedan'), suv: carParts('suv'), hatch: carParts('hatch') };
  const carBuf = { body: [], glass: [], wheels: [], rims: [], black: [], hl: [], tl: [], plate: [] };
  const OBST = [];
  function placeCar(type, color, x, z, yaw) {
    const P = PARTS[type];
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, -z);
    for (const k of Object.keys(carBuf)) {
      const g = P[k].clone().applyMatrix4(m);
      if (k === 'body') {
        const c = new THREE.Color(color); const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[3 * i] = c.r; arr[3 * i + 1] = c.g; arr[3 * i + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      }
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      carBuf[k].push(g.index ? g.toNonIndexed() : g);
    }
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const hx = (P.T.L / 2) * s + (P.T.Wd / 2) * c, hz = (P.T.L / 2) * c + (P.T.Wd / 2) * s;
    OBST.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, k: 'car' });
  }
  const TYPES = ['sedan', 'sedan', 'suv', 'hatch', 'sedan', 'suv'];
  const MAPCARS = [];
  for (const A of AISLES) for (const sd of [-1, 1]) for (let k = 0; k < NB; k++) {
    if (A.id === 'A' && sd < 0 && k === 19) continue;
    const type = TYPES[Math.floor(rnd() * TYPES.length)];
    const col = BODY_COLS[Math.floor(rnd() * BODY_COLS.length)];
    const nose = rnd() < 0.62;
    const yaw = (sd > 0 ? -Math.PI / 2 : Math.PI / 2) + (nose ? 0 : Math.PI) + (rnd() - 0.5) * 0.06;
    const x = A.x + sd * (6.0 + (rnd() - 0.5) * 0.3), z = bayZ(k) + (rnd() - 0.5) * 0.25;
    placeCar(type, col, x, z, yaw);
    MAPCARS.push({ x, z, col });
  }
  const envMats = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.28, envMapIntensity: 1.3 }),
    glass: new THREE.MeshStandardMaterial({ color: '#141a22', metalness: 0.7, roughness: 0.08, envMapIntensity: 1.6 }),
    wheels: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.85 }),
    rims: new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.8, roughness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.6 }),
    hl: new THREE.MeshStandardMaterial({ color: '#dfe6ea', metalness: 0.4, roughness: 0.15, emissive: '#3a3f44' }),
    tl: new THREE.MeshStandardMaterial({ color: '#6d0f15', roughness: 0.3, emissive: '#2a0003' }),
    plate: new THREE.MeshStandardMaterial({ color: '#f0f0ea', roughness: 0.5 }),
  };
  for (const k of Object.keys(carBuf)) scene.add(new THREE.Mesh(mergeGeometries(carBuf[k]), envMats[k]));

  // ---------- signs, LEDs, gate, closure ----------
  function ledSign(lines, w, h, col = '#36ff7a') {
    return ctex(w, h, (g) => {
      g.fillStyle = '#060807'; g.fillRect(0, 0, w, h);
      const off = document.createElement('canvas'); off.width = w; off.height = h; const o = off.getContext('2d');
      o.fillStyle = col; o.textAlign = 'center'; o.textBaseline = 'middle';
      lines.forEach((ln) => { o.font = `800 ${ln.s}px Inter, sans-serif`; o.fillText(ln.t, w / 2 + (ln.dx || 0), ln.y); });
      const d = o.getImageData(0, 0, w, h).data; const step = 5;
      for (let y = 2; y < h; y += step) for (let x = 2; x < w; x += step) {
        const i = (y * w + x) * 4; const on = d[i + 3] > 90;
        g.fillStyle = on ? col : 'rgba(80,90,85,.18)'; g.beginPath(); g.arc(x, y, on ? 1.9 : 1.2, 0, 7); g.fill();
      }
    });
  }
  function hangSign(tex, sw, sh, x, y, z, ry = 0, glow = 1.6) {
    const mat = new THREE.MeshBasicMaterial({ map: tex }); mat.color.setScalar(glow);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
    m.position.set(x, y, -z); m.rotation.y = ry; hi.add(m);
    const back = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.06, sh + 0.06, 0.08), new THREE.MeshStandardMaterial({ color: '#1a1c1f', roughness: 0.5 }));
    back.position.set(x - 0.05 * Math.sin(ry), y, -z - 0.05 * Math.cos(ry)); back.rotation.y = ry; hi.add(back);
    for (const sx of [-1, 1]) { const r = new THREE.CylinderGeometry(0.01, 0.01, CEIL - y - sh / 2, 4); r.translate(x + sx * sw * 0.4, (CEIL + y + sh / 2) / 2, -z + 0.05); HI.dark.push(r); }
    return m;
  }
  const ledGeo = [], ledGreen = [];
  for (const A of AISLES) for (const sd of [-1, 1]) for (let k = 0; k < NB; k++) {
    const x = A.x + sd * 3.78;
    const g = new THREE.BoxGeometry(0.14, 0.1, 0.14); g.translate(x, 2.6, -bayZ(k));
    const st = new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5); st.translate(x, 2.75, -bayZ(k)); HI.dark.push(st);
    if (A.id === 'A' && sd < 0 && k === 19) ledGreen.push(g); else ledGeo.push(g);
  }
  hi.add(new THREE.Mesh(mergeGeometries(ledGeo), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a2a').multiplyScalar(2.6) })));
  hi.add(new THREE.Mesh(mergeGeometries(ledGreen), new THREE.MeshBasicMaterial({ color: new THREE.Color('#2bff6a').multiplyScalar(3.2) })));
  const glowTex = ctex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const freeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#38ff7c', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  freeGlow.position.set(FREE.led, 2.6, -FREE.z); freeGlow.scale.set(1.3, 1.3, 1); hi.add(freeGlow);
  hangSign(ledSign([{ t: 'WELCOME  ·  777 ABC 01', s: 44, y: 38 }, { t: 'SMART PARKING   FREE: 1', s: 44, y: 98 }], 900, 136), 3.2, 0.48, 0, 2.8 + 2.0, -19.6, 0, 1.4);
  hangSign(ledSign([{ t: 'P-1  FREE  1', s: 58, y: 48 }, { t: '◀  A-20', s: 42, y: 104 }], 640, 140), 2.3, 0.5, 0, 2.3, 18, 0, 1.5);
  hangSign(ledSign([{ t: 'A-20 FREE  ◀', s: 58, y: 70 }], 640, 140), 2.3, 0.5, 0, 2.3, 40, 0, 1.5);
  hangSign(ledSign([{ t: 'A-20  FREE  ▲', s: 58, y: 70 }], 640, 140), 2.3, 0.5, XA, 2.3, 28, 0, 1.5);
  hangSign(ledSign([{ t: '◀ A-20 via AISLE A', s: 50, y: 70 }], 640, 140, '#ffb02e'), 2.3, 0.5, 8, 2.3, 1.0, 0, 1.5);
  for (const A of AISLES) hangSign(ctex(256, 256, (g, w, h) => { g.fillStyle = A.col; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '800 190px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(A.id, w / 2, h / 2 + 10); }), 0.7, 0.7, A.x, 2.3, 4.0, 0, 1.2);
  hangSign(ctex(768, 200, (g, w, h) => { g.fillStyle = '#1c3d8f'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '800 120px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P-1', w / 2, h / 2 + 6); }), 1.6, 0.42, 0, 2.55, -2.6, 0, 1.25);
  hangSign(ctex(512, 160, (g, w, h) => { g.fillStyle = '#0f8a4b'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '800 92px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT ▶', w / 2, h / 2 + 4); }), 1.2, 0.38, 22.6, 2.35, 64.0, Math.PI / 2, 1.3);
  {
    const bar = ctex(512, 64, (g, w, h) => { for (let x = 0; x < w; x += 64) { g.fillStyle = '#e8bd27'; g.fillRect(x, 0, 32, h); g.fillStyle = '#151515'; g.fillRect(x + 32, 0, 32, h); } g.fillStyle = '#fff'; g.fillRect(w / 2 - 70, 6, 140, 52); g.fillStyle = '#c21d1d'; g.font = '800 40px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('2.2 m', w / 2, 34); });
    const m = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.22, 0.12), new THREE.MeshStandardMaterial({ map: bar, roughness: 0.5 }));
    m.position.set(0, 2.55, -(ZS + 0.5)); hi.add(m);
  }
  const gate = new THREE.Group();
  {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.05, 0.34), new THREE.MeshStandardMaterial({ color: '#d6d9dc', roughness: 0.4, metalness: 0.3 }));
    post.position.set(2.95, 2.8 + 0.52, -GATE_Z); scene.add(post);
    const at = ctex(512, 32, (g, w, h) => { for (let x = 0; x < w; x += 64) { g.fillStyle = '#d81e1e'; g.fillRect(x, 0, 32, h); g.fillStyle = '#f4f4f4'; g.fillRect(x + 32, 0, 32, h); } });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.09, 0.06), new THREE.MeshStandardMaterial({ map: at, roughness: 0.4 }));
    arm.position.set(-1.75, 0, 0); gate.add(arm);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3030').multiplyScalar(3) }));
    lamp.position.set(-3.45, 0.07, 0); gate.add(lamp);
    gate.userData.lamp = lamp;
    gate.position.set(2.85, 2.8 + 0.98, -GATE_Z); scene.add(gate);
  }
  const stripeTex = ctex(512, 64, (g, w, h) => { for (let x = -64; x < w + 64; x += 64) { g.fillStyle = '#e02424'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 64, h); g.lineTo(x + 32, h); g.fill(); g.fillStyle = '#f6f6f2'; g.beginPath(); g.moveTo(x + 32, 0); g.lineTo(x + 64, 0); g.lineTo(x + 96, h); g.lineTo(x + 64, h); g.fill(); } });
  const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.45 });
  const BEACONS = [];
  for (const zc of [57.0, 61.6, 66.2]) {
    for (const y of [0.55, 0.95]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 3.8), stripeMat); b.position.set(BARRIER_X, y, -zc); scene.add(b); }
    for (const dz of [-1.75, 1.75]) for (const dx of [-0.32, 0.32]) {
      const leg = new THREE.CylinderGeometry(0.025, 0.03, 1.15, 6); leg.rotateZ(dx > 0 ? -0.28 : 0.28); leg.translate(BARRIER_X + dx * 0.5, 0.56, -(zc + dz)); LO.white.push(leg);
    }
    const bcn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffa21a').multiplyScalar(3) }));
    bcn.position.set(BARRIER_X, 1.15, -zc); scene.add(bcn);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffa21a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
    sp.position.copy(bcn.position); sp.scale.set(1.1, 1.1, 1); scene.add(sp);
    BEACONS.push({ m: bcn, sp, ph: zc });
  }
  for (let z = 55.6; z < 69.0; z += 0.9) {
    const cone = new THREE.ConeGeometry(0.17, 0.62, 14); cone.translate(BARRIER_X + 1.0, 0.33, -z); LO.orange.push(cone);
    const band = new THREE.CylinderGeometry(0.105, 0.125, 0.09, 14); band.translate(BARRIER_X + 1.0, 0.36, -z); LO.white.push(band);
    const base = new THREE.BoxGeometry(0.4, 0.04, 0.4); base.translate(BARRIER_X + 1.0, 0.02, -z); LO.orange.push(base);
  }
  {
    const tx = ctex(640, 300, (g, w, h) => { g.fillStyle = '#d71f26'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 12; g.strokeRect(14, 14, w - 28, h - 28); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 104px Inter, sans-serif'; g.fillText('CLOSED', w / 2, 118); g.font = '800 46px Inter, sans-serif'; g.fillText('MAINTENANCE · AISLE A', w / 2, 216); });
    for (const ry of [Math.PI / 2, -Math.PI / 2]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.7), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.5, emissive: '#ffffff', emissiveMap: tx, emissiveIntensity: 0.35 }));
      m.position.set(BARRIER_X + (ry > 0 ? 0.05 : -0.05), 1.55, -61.6); m.rotation.y = ry; scene.add(m);
    }
    const p1 = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6); p1.translate(BARRIER_X, 0.6, -61.6); LO.dark.push(p1);
  }
  const MATS = {
    concrete: new THREE.MeshStandardMaterial({ color: '#8f8d88', roughness: 0.92 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#43464b', roughness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ color: '#222429', roughness: 0.6 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#d9ae22', roughness: 0.6 }),
    red: new THREE.MeshStandardMaterial({ color: '#b3201e', roughness: 0.45, metalness: 0.2 }),
    white: new THREE.MeshStandardMaterial({ color: '#eeeeea', roughness: 0.5 }),
    tube: new THREE.MeshBasicMaterial({ color: new THREE.Color('#fffaf0').multiplyScalar(3.4) }),
    housing: new THREE.MeshStandardMaterial({ color: '#c8c9cb', roughness: 0.4, metalness: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: '#9ea4aa', roughness: 0.35, metalness: 0.7 }),
    orange: new THREE.MeshStandardMaterial({ color: '#ff6a10', roughness: 0.5, emissive: '#5a1d00' }),
  };
  const mergeInto = (lists, parent) => {
    for (const k of Object.keys(lists)) if (lists[k].length) {
      const gs = lists[k].map((g) => { const q = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(a)) q.deleteAttribute(a); if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); if (!q.attributes.normal) q.computeVertexNormals(); return q; });
      parent.add(new THREE.Mesh(mergeGeometries(gs), MATS[k]));
    }
  };
  mergeInto(LO, scene);
  mergeInto(HI, hi);

  // free bay highlight
  const outlineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#33ff88').multiplyScalar(1.8), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  {
    const gs = [];
    const x0 = BAYRECT.x0 + 0.05, x1 = BAYRECT.x1, z0 = BAYRECT.z0 + 0.12, z1 = BAYRECT.z1 - 0.12;
    const seg = (ax, az, bx, bz) => { const L = Math.hypot(bx - ax, bz - az); const g = new THREE.PlaneGeometry(L, 0.09); g.rotateX(-Math.PI / 2); g.rotateY(-Math.atan2(-(bz - az), bx - ax)); g.translate((ax + bx) / 2, 0.02, -(az + bz) / 2); gs.push(g); };
    seg(x0, z0, x1, z0); seg(x1, z0, x1, z1); seg(x1, z1, x0, z1); seg(x0, z1, x0, z0);
    scene.add(new THREE.Mesh(mergeGeometries(gs), outlineMat));
  }
  const bayFill = new THREE.Mesh(new THREE.PlaneGeometry(5.1, BAY - 0.3), new THREE.MeshBasicMaterial({ color: '#2bff7a', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  bayFill.rotation.x = -Math.PI / 2; bayFill.position.set((BAYRECT.x0 + BAYRECT.x1) / 2, 0.015, -FREE.z); scene.add(bayFill);

  // ---------- obstacles ----------
  const box = (x0, x1, z0, z1, k = 'wall') => OBST.push({ x0, x1, z0, z1, k });
  box(-WX - 2, -WX, ZS - 2, ZN + 2); box(WX, WX + 2, ZS - 2, ZN + 2); box(-WX - 2, WX + 2, ZN, ZN + 2);
  box(-WX - 2, -3.2, ZS - 2, ZS + 0.31); box(3.2, WX + 2, ZS - 2, ZS + 0.31);
  box(-3.6, -3.2, ZR0 - 1, ZS + 0.31); box(3.2, 3.6, ZR0 - 1, ZS + 0.31); box(-3.6, 3.6, ZR0 - 2, ZR0 - 0.05);
  box(22.8, WX, 64.4, ZN);
  for (const p of PILLARS) box(p.x - 0.3, p.x + 0.3, p.z - 0.3, p.z + 0.3, 'pillar');
  box(BARRIER_X - 0.45, BARRIER_X + 1.2, 55.1, ZN, 'cone');
  box(2.78, 3.12, GATE_Z - 0.17, GATE_Z + 0.17, 'post');
  const GATEBOX = { x0: -3.2, x1: 3.0, z0: GATE_Z - 0.06, z1: GATE_Z + 0.06, k: 'gate', on: true };
  OBST.push(GATEBOX);

  // ---------- player car ----------
  const car = new THREE.Group(); scene.add(car);
  const ext = new THREE.Group(); car.add(ext);
  const PT = CAR_TYPES.sedan, PP = PARTS.sedan;
  const paint = new THREE.MeshStandardMaterial({ color: '#16a3b8', metalness: 0.6, roughness: 0.25, envMapIntensity: 1.5 });
  ext.add(new THREE.Mesh(PP.body, paint));
  ext.add(new THREE.Mesh(PP.glass, new THREE.MeshStandardMaterial({ color: '#101820', metalness: 0.4, roughness: 0.35, envMapIntensity: 0.7 })));
  ext.add(new THREE.Mesh(PP.black, envMats.black));
  ext.add(new THREE.Mesh(PP.plate, envMats.plate));
  const hlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4f8ff').multiplyScalar(2.6) });
  ext.add(new THREE.Mesh(PP.hl, hlMat));
  const tlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2020').multiplyScalar(1.2) });
  ext.add(new THREE.Mesh(PP.tl, tlMat));
  const revMat = new THREE.MeshBasicMaterial({ color: '#3a3a3a' });
  for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(0.16, 0.06, 0.05); g.translate(sx * 0.42, 0.62, PT.L / 2 + 0.02); ext.add(new THREE.Mesh(g, revMat)); }
  const WHEELS = [];
  const tyreGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 22); tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.25, 6); rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.255, 0.36, 0.05);
  const WZ = PT.L / 2 - 0.8;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * (PT.Wd / 2 - 0.12), 0.34, sz * WZ);
    const spin = new THREE.Group(); pivot.add(spin);
    spin.add(new THREE.Mesh(tyreGeo, envMats.wheels));
    spin.add(new THREE.Mesh(rimGeo, envMats.rims));
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) { const s = new THREE.Mesh(spokeGeo, envMats.rims); s.rotation.x = a; spin.add(s); }
    ext.add(pivot);
    WHEELS.push({ pivot, spin, front: sz < 0 });
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.0), new THREE.MeshBasicMaterial({ map: ctex(64, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, h / 2); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; car.add(shadow);
  const head = new THREE.SpotLight('#fff1dc', 14, 30, 0.6, 0.85, 1.4);
  head.position.set(0, 0.7, -2.3); head.target.position.set(0, 0.1, -14); car.add(head); car.add(head.target);

  // cockpit
  const cockpit = new THREE.Group(); cockpit.position.set(-0.37, 1.17, 0.12); car.add(cockpit);
  const eye = new THREE.Object3D(); cockpit.add(eye);
  const dashMat = new THREE.MeshStandardMaterial({ color: '#0e0f11', roughness: 0.78, envMapIntensity: 0.25 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#25282c', roughness: 0.5, metalness: 0.2 });
  {
    const dash = new THREE.Shape();
    dash.moveTo(-1.1, -0.9); dash.lineTo(1.7, -0.9); dash.lineTo(1.7, -0.4); dash.bezierCurveTo(0.9, -0.33, -0.3, -0.33, -1.1, -0.39); dash.closePath();
    const dg = new THREE.ExtrudeGeometry(dash, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3 });
    dg.translate(0, 0, -1.12);
    cockpit.add(new THREE.Mesh(dg, dashMat));
    const hood = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.8), new THREE.MeshStandardMaterial({ color: '#0f6f7e', metalness: 0.6, roughness: 0.25, envMapIntensity: 1.4 }));
    hood.rotation.x = -Math.PI / 2 + 0.06; hood.position.set(0.37, -0.6, -1.9); hood.scale.set(1.25, 1, 1); cockpit.add(hood);
    const pillar = (a, b, w) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const L = A.distanceTo(B); const m = new THREE.Mesh(new THREE.BoxGeometry(w, L, 0.08), trimMat); m.position.copy(A.clone().add(B).multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); cockpit.add(m); };
    pillar([-0.74, -0.36, -1.0], [-0.58, 0.36, -0.42], 0.075);
    pillar([1.42, -0.36, -1.0], [1.26, 0.36, -0.42], 0.12);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.0), new THREE.MeshStandardMaterial({ color: '#2b2c2f', roughness: 0.95, side: THREE.DoubleSide }));
    roof.rotation.x = Math.PI / 2 - 0.18; roof.position.set(0.37, 0.36, -0.15); cockpit.add(roof);
  }
  const wheelG = new THREE.Group();
  {
    const leather = new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.55 });
    wheelG.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.024, 12, 48), leather));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 20), leather); hub.rotation.x = Math.PI / 2; wheelG.add(hub);
    for (const a of [0, 1, -1]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.13, 0.018), leather); if (a === 0) sp.position.set(0, -0.12, 0); else { sp.position.set(a * 0.12, 0.01, 0); sp.rotation.z = a * 1.15; } wheelG.add(sp); }
    const wg = new THREE.Group(); wg.add(wheelG); wg.position.set(0, -0.405, -0.5); wg.rotation.x = 0.36; cockpit.add(wg);
  }
  const clusterTex = ctex(512, 180, () => {});
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.116), new THREE.MeshBasicMaterial({ map: clusterTex }));
    m.position.set(0, -0.28, -0.72); m.rotation.x = 0.2; cockpit.add(m);
    const hc = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.16), dashMat); hc.position.set(0, -0.205, -0.69); cockpit.add(hc);
  }
  const mirrorRT = new THREE.WebGLRenderTarget(320, 100);
  const mirrorCam = new THREE.PerspectiveCamera(26, 320 / 100, 0.1, 80);
  {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.04), trimMat); fr.position.set(0.37, 0.205, -0.62); fr.rotation.y = 0.18; cockpit.add(fr);
    const mm = new THREE.MeshBasicMaterial({ map: mirrorRT.texture }); mm.map.repeat.set(-1, 1); mm.map.offset.set(1, 0); mm.map.wrapS = THREE.RepeatWrapping;
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.075), mm); gl.position.set(0.37, 0.205, -0.598); gl.rotation.y = 0.18; cockpit.add(gl);
  }
  const mirrorEye = new THREE.Object3D(); mirrorEye.position.set(0.37, 0.05, 0.4); mirrorEye.rotation.y = Math.PI; cockpit.add(mirrorEye);

  // ---------- camera, composer ----------
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 160);
  scene.add(camera);
  const rt = new THREE.WebGLRenderTarget(16, 16, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let useBloom = true;

  // ---------- HUD ----------
  const hud = document.createElement('div');
  hud.className = 'pg-hud';
  hud.innerHTML =
    '<div class="pg-top"><button class="pg-btn pg-back"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span></span></button>' +
    '<div class="pg-obj"><b></b><span></span></div>' +
    '<div class="pg-right"><button class="pg-btn pg-cam" title="C"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg><span></span></button>' +
    '<button class="pg-btn pg-snd" aria-label="sound"></button>' +
    '<button class="pg-btn pg-video"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg><span></span></button></div></div>' +
    '<div class="pg-stat"><span class="pg-time">0:00</span><span class="pg-hits"></span></div>' +
    '<canvas class="pg-map"></canvas>' +
    '<div class="pg-speed"><b>0</b><small></small><i>D</i></div>' +
    '<div class="pg-sensor" hidden><div class="f"></div><div class="r"></div><span></span></div>' +
    '<div class="pg-keys"></div>' +
    '<div class="pg-toast" hidden></div>' +
    '<div class="pg-touch"><div class="l"><button data-k="left">◀</button><button data-k="right">▶</button></div><div class="r"><button data-k="hand">P</button><button data-k="down">▼</button><button data-k="up">▲</button></div></div>' +
    '<div class="pg-win" hidden><div class="pg-stars"></div><h3></h3><p></p><div class="pg-row"><button class="pg-cta pg-again"></button><button class="pg-btn2 pg-wvideo"></button><button class="pg-btn2 pg-wback"></button></div></div>';
  host.appendChild(hud);
  const q = (s) => hud.querySelector(s);
  const mapCv = q('.pg-map'), mapG = mapCv.getContext('2d');
  const KEYS = [['W', '↑', 'pg_k_gas'], ['S', '↓', 'pg_k_brake'], ['A D', '← →', 'pg_k_steer'], ['Shift', '', 'pg_k_boost'], ['pg_space', '', 'pg_k_hand'], ['C', '', 'pg_k_cam'], ['R', '', 'pg_k_reset'], ['H', '', 'pg_k_hide']];
  function texts() {
    q('.pg-back span').textContent = T('pg_back');
    q('.pg-video span').textContent = T('pg_video');
    q('.pg-speed small').textContent = T('pg_kmh');
    q('.pg-again').textContent = T('pg_again');
    q('.pg-wvideo').textContent = T('pg_video');
    q('.pg-wback').textContent = T('pg_back');
    q('.pg-keys').innerHTML = KEYS.map(([a, b, k]) => '<div><span>' + (a.startsWith('pg_') ? T(a) : a).split(' ').map((x) => '<kbd>' + x + '</kbd>').join('') + (b ? b.split(' ').map((x) => '<kbd>' + x + '</kbd>').join('') : '') + '</span><em>' + T(k) + '</em></div>').join('');
  }
  texts();

  // ---------- state ----------
  const S = { x: 0.4, z: -29.5, h: 0, v: 0, vl: 0, yr: 0, steer: 0, y: 2.8, pitch: 0, roll: 0, spin: 0, t: 0, run: false, paused: false, done: false, hits: 0, stage: 'gate', gateA: 0, cam: 'chase', camInit: false, still: 0, toastT: 0, closedSaid: false, parkSaid: false, shake: 0, hideKeys: false, keysT: 0, sens: 9, beepT: 0, started: false, startT: 0 };
  const keys = {};
  const touch = {};
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

  function reset() {
    Object.assign(S, { x: 0.4, z: -29.5, h: 0, v: 0, vl: 0, yr: 0, steer: 0, y: 2.8, t: 0, done: false, hits: 0, stage: 'gate', gateA: 0, camInit: false, still: 0, closedSaid: false, parkSaid: false, shake: 0, started: false });
    GATEBOX.on = true;
    q('.pg-hits').textContent = T('pg_hits', { n: 0 });
    q('.pg-win').hidden = true;
    hud.classList.remove('won');
    objective();
  }
  function objective() {
    const o = q('.pg-obj');
    const set = (a, b) => { o.querySelector('b').textContent = a; o.querySelector('span').textContent = b; };
    if (S.stage === 'gate' || S.stage === 'gate_open') set(T('pg_obj_gate'), S.stage === 'gate_open' ? T('pg_gate_open') : S.started ? T('pg_obj_gate_s') : T('pg_start'));
    else if (S.stage === 'find') set(T('pg_obj_find'), T('pg_obj_find_s'));
    else if (S.stage === 'park') set(T('pg_obj_park'), T('pg_obj_park_s'));
    else set(T('pg_win'), '');
  }
  function toast(msg, ms = 3200) { const el = q('.pg-toast'); el.textContent = msg; el.hidden = false; S.toastT = ms / 1000; }
  const camNames = { chase: 'pg_cam_chase', cockpit: 'pg_cam_cockpit', top: 'pg_cam_top' };
  function setCam(c) {
    S.cam = c; S.camInit = false;
    q('.pg-cam span').textContent = T(camNames[c]);
    cockpit.visible = c === 'cockpit';
    ext.visible = c !== 'cockpit';
    hi.visible = c !== 'top';
    camera.fov = c === 'cockpit' ? 64 : c === 'top' ? 50 : 60;
    camera.updateProjectionMatrix();
  }
  function cycleCam() { setCam(S.cam === 'chase' ? 'cockpit' : S.cam === 'cockpit' ? 'top' : 'chase'); }
  setCam('chase');
  objective();

  // ---------- audio ----------
  const AU = { ctx: null, on: true };
  function audioInit() {
    if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = AU.ctx = new AC();
    AU.master = c.createGain(); AU.master.gain.value = AU.on ? 0.9 : 0; AU.master.connect(c.destination);
    AU.lp = c.createBiquadFilter(); AU.lp.type = 'lowpass'; AU.lp.frequency.value = 500; AU.lp.Q.value = 2;
    AU.eg = c.createGain(); AU.eg.gain.value = 0.0;
    AU.o1 = c.createOscillator(); AU.o1.type = 'sawtooth'; AU.o2 = c.createOscillator(); AU.o2.type = 'square';
    AU.o1.connect(AU.lp); const g2 = c.createGain(); g2.gain.value = 0.45; AU.o2.connect(g2); g2.connect(AU.lp);
    AU.lp.connect(AU.eg); AU.eg.connect(AU.master);
    AU.o1.start(); AU.o2.start();
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    AU.noise = nb;
    const n = c.createBufferSource(); n.buffer = nb; n.loop = true;
    AU.bp = c.createBiquadFilter(); AU.bp.type = 'bandpass'; AU.bp.frequency.value = 1100; AU.bp.Q.value = 6;
    AU.sq = c.createGain(); AU.sq.gain.value = 0;
    n.connect(AU.bp); AU.bp.connect(AU.sq); AU.sq.connect(AU.master); n.start();
  }
  function blip(f, dur, vol, type = 'sine', when = 0) {
    if (!AU.ctx) return;
    const c = AU.ctx, t0 = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    o.connect(g); g.connect(AU.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function thump(k) {
    if (!AU.ctx) return;
    const c = AU.ctx, t0 = c.currentTime;
    const s = c.createBufferSource(); s.buffer = AU.noise;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = c.createGain(); g.gain.setValueAtTime(0.5 * k, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    s.connect(f); f.connect(g); g.connect(AU.master); s.start(t0); s.stop(t0 + 0.4);
    blip(70, 0.3, 0.5 * k, 'sine');
  }
  function sndIcon() { q('.pg-snd').innerHTML = AU.on ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7"/></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>'; }
  function toggleSound() { AU.on = !AU.on; if (AU.master) AU.master.gain.value = AU.on ? 0.9 : 0; sndIcon(); }
  sndIcon();

  // ---------- input ----------
  const KMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'hand' };
  function onKey(e, down) {
    if (!S.run || S.paused) return;
    const k = KMAP[e.code];
    if (k) { keys[k] = down; e.preventDefault(); e.stopPropagation(); audioInit(); if (down && (k === 'up' || k === 'down') && !S.started) { S.started = true; S.startT = S.t; objective(); } return; }
    if (!down) return;
    if (e.code === 'KeyC') { cycleCam(); e.preventDefault(); }
    else if (e.code === 'KeyR') { reset(); e.preventDefault(); }
    else if (e.code === 'KeyH') { S.hideKeys = !S.hideKeys; q('.pg-keys').classList.toggle('off', S.hideKeys); }
    else if (e.code === 'KeyM') toggleSound();
  }
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener('keydown', kd, true);
  window.addEventListener('keyup', ku, true);
  const blur = () => { for (const k in keys) keys[k] = false; };
  window.addEventListener('blur', blur);
  hud.querySelectorAll('.pg-touch button').forEach((b) => {
    const k = b.dataset.k;
    const on = (e) => { e.preventDefault(); touch[k] = true; audioInit(); if ((k === 'up' || k === 'down') && !S.started) { S.started = true; objective(); } };
    const off = (e) => { e.preventDefault(); touch[k] = false; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
  });
  q('.pg-back').onclick = () => opts.onExit && opts.onExit();
  q('.pg-wback').onclick = () => opts.onExit && opts.onExit();
  q('.pg-video').onclick = () => opts.onVideo && opts.onVideo();
  q('.pg-wvideo').onclick = () => opts.onVideo && opts.onVideo();
  q('.pg-again').onclick = () => reset();
  q('.pg-cam').onclick = () => cycleCam();
  q('.pg-snd').onclick = () => { audioInit(); toggleSound(); };

  // ---------- physics ----------
  const HL = PT.L / 2, HW = PT.Wd / 2;
  function collide() {
    const fx = Math.sin(S.h), fz = Math.cos(S.h), rx = Math.cos(S.h), rz = -Math.sin(S.h);
    let hit = 0;
    for (let iter = 0; iter < 3; iter++) {
      let best = null;
      for (const o of OBST) {
        if (o.k === 'gate' && !o.on) continue;
        if (o.x1 < S.x - 3 || o.x0 > S.x + 3 || o.z1 < S.z - 3 || o.z0 > S.z + 3) continue;
        const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, ex = (o.x1 - o.x0) / 2, ez = (o.z1 - o.z0) / 2;
        const dx = cx - S.x, dz = cz - S.z;
        const axes = [[1, 0], [0, 1], [fx, fz], [rx, rz]];
        let minO = Infinity, nx = 0, nz = 0;
        for (const [ax, az] of axes) {
          const rA = HL * Math.abs(fx * ax + fz * az) + HW * Math.abs(rx * ax + rz * az);
          const rB = ex * Math.abs(ax) + ez * Math.abs(az);
          const d = dx * ax + dz * az;
          const ov = rA + rB - Math.abs(d);
          if (ov <= 0) { minO = -1; break; }
          if (ov < minO) { minO = ov; const s = d > 0 ? -1 : 1; nx = ax * s; nz = az * s; }
        }
        if (minO > 0 && (!best || minO > best.o)) best = { o: minO, nx, nz, k: o.k };
      }
      if (!best) break;
      S.x += best.nx * (best.o + 0.002); S.z += best.nz * (best.o + 0.002);
      const vx = fx * S.v + rx * S.vl, vz = fz * S.v + rz * S.vl;
      const vn = vx * best.nx + vz * best.nz;
      if (vn < 0) {
        hit = Math.max(hit, -vn);
        const nvx = vx - (1.3) * vn * best.nx, nvz = vz - (1.3) * vn * best.nz;
        S.v = (nvx * fx + nvz * fz) * 0.82; S.vl = (nvx * rx + nvz * rz) * 0.5;
        S.yr *= 0.6;
      }
    }
    if (hit > 1.1 && S.t - (S.lastHit || -9) > 0.6) {
      S.lastHit = S.t; S.hits++; S.shake = Math.min(0.6, hit * 0.08);
      thump(Math.min(1, hit / 6));
      q('.pg-hits').textContent = T('pg_hits', { n: S.hits });
    }
  }
  function sensors() {
    const fx = Math.sin(S.h), fz = Math.cos(S.h);
    const probe = (sgn) => {
      const px = S.x + fx * HL * sgn, pz = S.z + fz * HL * sgn;
      let best = 9;
      for (const o of OBST) {
        if (o.k === 'gate' && !o.on) continue;
        if (o.k === 'wall' && (o.x1 - o.x0 > 40 || o.z1 - o.z0 > 40) && false) continue;
        const dx = Math.max(o.x0 - px, 0, px - o.x1), dz = Math.max(o.z0 - pz, 0, pz - o.z1);
        const d = Math.hypot(dx, dz);
        if (d < best) {
          const ax = (clamp(px, o.x0, o.x1) - px), az = (clamp(pz, o.z0, o.z1) - pz);
          const ahead = (ax * fx + az * fz) * sgn;
          if (ahead > -0.4 || d < 0.3) best = d;
        }
      }
      return best;
    };
    return [probe(1), probe(-1)];
  }
  function step(dt) {
    if (!(dt > 0)) return;
    const up = keys.up || touch.up, down = keys.down || touch.down, left = keys.left || touch.left, right = keys.right || touch.right;
    const hand = keys.hand || touch.hand, boost = keys.boost;
    const vmax = boost ? 14 : 8.5;
    let acc = 0;
    if (S.done) { acc = -Math.sign(S.v) * Math.min(Math.abs(S.v) / dt, 6); }
    else if (up && !down) acc = S.v < -0.25 ? 9 : (S.v < vmax ? (boost ? 6.2 : 4.0) * (1 - Math.max(0, S.v) / (vmax * 1.08)) + 0.4 : -1.5);
    else if (down && !up) acc = S.v > 0.25 ? -9 : (S.v > -3.6 ? -2.6 : 0);
    else acc = -Math.sign(S.v) * Math.min(Math.abs(S.v) / dt, 0.9 + 0.03 * S.v * S.v);
    if (hand) acc -= Math.sign(S.v) * Math.min(Math.abs(S.v) / dt, 4.5);
    if (onRamp(S.x, S.z) && S.z > -18) acc += 9.81 * 0.2 * Math.cos(S.h) * 0.25 * (hand || up || down ? 0.3 : 1);
    S.v += acc * dt;
    if (Math.abs(S.v) < 0.03 && !up && !down) S.v = 0;
    const sp = Math.abs(S.v);
    const maxSt = lerp(0.62, 0.2, clamp((sp - 2) / 10, 0, 1));
    const want = (left ? -1 : 0) + (right ? 1 : 0);
    if (want) S.steer += clamp(want * maxSt - S.steer, -2.6 * dt, 2.6 * dt);
    else S.steer += clamp(-S.steer, -3.4 * dt, 3.4 * dt);
    S.steer = clamp(S.steer, -maxSt, maxSt);
    const wb = 2.75;
    let target = S.v / wb * Math.tan(S.steer);
    const drifting = hand && sp > 3.5;
    if (drifting) target *= 1.55;
    S.yr += (target - S.yr) * Math.min(1, dt * (drifting ? 3.5 : 12));
    S.h += S.yr * dt;
    if (drifting) S.vl += -S.v * S.yr * 0.42 * dt * 1.0;
    S.vl *= Math.exp(-(drifting ? 1.1 : 8) * dt);
    const fx = Math.sin(S.h), fz = Math.cos(S.h), rx = Math.cos(S.h), rz = -Math.sin(S.h);
    S.x += (fx * S.v + rx * S.vl) * dt;
    S.z += (fz * S.v + rz * S.vl) * dt;
    collide();
    // gate
    if (S.stage === 'gate' && S.z > GATE_Z - 5.4 && Math.abs(S.x) < 3.4) { S.stage = 'gate_open'; objective(); toast(T('pg_gate_open')); blip(880, 0.25, 0.25); blip(1320, 0.35, 0.22, 'sine', 0.12); }
    if (S.stage === 'gate_open') { S.gateA = Math.min(1, S.gateA + dt / 1.3); if (S.gateA > 0.55) GATEBOX.on = false; if (S.z > GATE_Z + 2.5) { S.stage = 'find'; objective(); } }
    else if (S.stage !== 'gate' && S.gateA > 0 && S.z > GATE_Z + 6) { S.gateA = Math.max(0, S.gateA - dt / 1.6); if (S.gateA < 0.5) GATEBOX.on = true; }
    gate.rotation.z = -1.42 * sstep(0, 1, S.gateA);
    if (S.stage === 'find' && !S.closedSaid && S.z > 52 && S.x > BARRIER_X - 0.5 && S.x < -6) { S.closedSaid = true; toast(T('pg_closed'), 4200); blip(520, 0.2, 0.25, 'triangle'); blip(390, 0.3, 0.25, 'triangle', 0.18); }
    if (S.stage === 'find' && Math.hypot(S.x - FREE.x, S.z - FREE.z) < 12 && S.x < BARRIER_X - 0.5) { S.stage = 'park'; objective(); }
    // parked?
    if (S.stage === 'park' && !S.done) {
      const inside = corners().every(([cx, cz]) => cx > BAYRECT.x0 - 0.05 && cx < BAYRECT.x1 + 0.18 && cz > BAYRECT.z0 - 0.06 && cz < BAYRECT.z1 + 0.06);
      const ang = Math.min(Math.abs(angDiff(S.h, -Math.PI / 2)), Math.abs(angDiff(S.h, Math.PI / 2)));
      if (inside && sp < 0.25 && ang < 0.26) { S.still += dt; if (S.still > 0.8) win(ang); }
      else { S.still = 0; if (sp < 0.2 && !inside && Math.abs(S.x - FREE.x) < 3 && Math.abs(S.z - FREE.z) < 2 && !S.parkSaid) { S.parkSaid = true; toast(T('pg_crooked')); } }
      if (sp > 1) S.parkSaid = false;
    }
    S.spin += S.v * dt / 0.34;
    const fy = floorY(S.x, S.z);
    S.y += (fy - S.y) * Math.min(1, dt * 14);
    const ahead = floorY(S.x + fx * 1.4, S.z + fz * 1.4), behind = floorY(S.x - fx * 1.4, S.z - fz * 1.4);
    const pitch = Math.atan2(ahead - behind, 2.8);
    S.pitch += (pitch - S.pitch) * Math.min(1, dt * 10);
    S.roll += ((-S.yr * S.v * 0.012) - S.roll) * Math.min(1, dt * 6);
    // audio
    if (AU.ctx) {
      const thr = up || down ? 1 : 0;
      const rpm = 32 + Math.abs(S.v) * 7.5 % 38 + Math.min(Math.abs(S.v), 14) * 3 + thr * 6 + (boost ? 8 : 0);
      AU.o1.frequency.setTargetAtTime(rpm, AU.ctx.currentTime, 0.05);
      AU.o2.frequency.setTargetAtTime(rpm * 0.5, AU.ctx.currentTime, 0.05);
      AU.lp.frequency.setTargetAtTime(260 + thr * 700 + sp * 40, AU.ctx.currentTime, 0.08);
      AU.eg.gain.setTargetAtTime(S.paused ? 0 : 0.05 + thr * 0.05 + Math.min(sp, 12) * 0.004, AU.ctx.currentTime, 0.08);
      const slip = clamp(Math.abs(S.vl) / 3 + (hand && sp > 2 ? 0.5 : 0) + (Math.abs(S.yr * S.v) > 7 ? 0.4 : 0), 0, 1);
      AU.sq.gain.setTargetAtTime(S.paused ? 0 : slip * 0.11, AU.ctx.currentTime, 0.05);
    }
  }
  function corners() {
    const fx = Math.sin(S.h), fz = Math.cos(S.h), rx = Math.cos(S.h), rz = -Math.sin(S.h);
    return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [S.x + fx * HL * a + rx * HW * b, S.z + fz * HL * a + rz * HW * b]);
  }
  function win(ang) {
    S.done = true; S.stage = 'done'; objective();
    const off = Math.abs(S.z - FREE.z) / 0.39, aerr = ang / 0.26;
    const acc = Math.round(clamp(100 - off * 22 - aerr * 22, 40, 100));
    const tm = S.t - (S.startT || 0);
    const stars = 1 + (acc >= 75 ? 1 : 0) + (S.hits === 0 && acc >= 85 ? 1 : 0);
    const w = q('.pg-win');
    w.querySelector('.pg-stars').innerHTML = [0, 1, 2].map((i) => '<i class="' + (i < stars ? 'on' : '') + '">★</i>').join('');
    w.querySelector('h3').textContent = T('pg_win');
    w.querySelector('p').textContent = T('pg_win_sub', { time: fmt(tm), hits: S.hits, acc });
    w.hidden = false; hud.classList.add('won');
    [784, 988, 1175, 1568].forEach((f, i) => blip(f, 0.5, 0.22, 'sine', i * 0.11));
    if (opts.onWin) opts.onWin({ time: tm, hits: S.hits, acc });
  }
  const fmt = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ---------- minimap ----------
  const MAPB = { x0: -28, x1: 28, z0: -36, z1: 70.5 };
  let mapStatic = null, mapScale = 1;
  function mapSize() {
    const w = mapCv.clientWidth || 150, h = mapCv.clientHeight || 270, d = Math.min(2, window.devicePixelRatio || 1);
    mapCv.width = w * d; mapCv.height = h * d;
    mapScale = Math.min(w / (MAPB.x1 - MAPB.x0), h / (MAPB.z1 - MAPB.z0));
    const c = document.createElement('canvas'); c.width = mapCv.width; c.height = mapCv.height;
    const g = c.getContext('2d'); g.scale(d, d);
    const ox = (w - (MAPB.x1 - MAPB.x0) * mapScale) / 2, oy = (h - (MAPB.z1 - MAPB.z0) * mapScale) / 2;
    const P = (x, z) => [ox + (x - MAPB.x0) * mapScale, oy + (MAPB.z1 - z) * mapScale];
    const R = (x0, z0, x1, z1) => { const [a, b] = P(x0, z1), [c2, d2] = P(x1, z0); return [a, b, c2 - a, d2 - b]; };
    g.fillStyle = '#2a2e35'; g.fillRect(...R(-WX, ZS, WX, ZN)); g.fillRect(...R(-3.2, ZR0, 3.2, ZS));
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.strokeRect(...R(-WX, ZS, WX, ZN));
    for (const A of AISLES) for (const sd of [-1, 1]) for (let k = 0; k <= NB; k++) {
      const z = Z0 + BAY * k, xa = A.x + sd * 3.6, xb = A.x + sd * 8.8;
      const [p0x, p0y] = P(Math.min(xa, xb), z), [p1x] = P(Math.max(xa, xb), z);
      g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(p0x, p0y, p1x - p0x, 0.8);
    }
    for (const c2 of MAPCARS) { g.fillStyle = 'rgba(150,158,170,.85)'; const r = R(c2.x - 2.2, c2.z - 0.85, c2.x + 2.2, c2.z + 0.85); g.fillRect(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1); }
    g.fillStyle = '#e8e6df'; for (const p of PILLARS) g.fillRect(...R(p.x - 0.4, p.z - 0.4, p.x + 0.4, p.z + 0.4));
    g.fillStyle = '#ff4d4f'; g.fillRect(...R(BARRIER_X - 0.4, 55.1, BARRIER_X + 1.2, ZN));
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '800 ' + Math.round(mapScale * 3.2) + 'px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const A of AISLES) { const [ax, ay] = P(A.x, -1.8); g.fillText(A.id, ax, ay); }
    const [rx, ry] = P(0, -27); g.fillText('▲', rx, ry);
    mapStatic = { c, P, d };
  }
  function drawMap(now) {
    if (!mapStatic) mapSize();
    const { c, P, d } = mapStatic;
    mapG.setTransform(1, 0, 0, 1, 0, 0);
    mapG.clearRect(0, 0, mapCv.width, mapCv.height);
    mapG.drawImage(c, 0, 0);
    mapG.setTransform(d, 0, 0, d, 0, 0);
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const [bx0, by0] = P(BAYRECT.x0, BAYRECT.z1), [bx1, by1] = P(BAYRECT.x1, BAYRECT.z0);
    mapG.fillStyle = 'rgba(52,255,130,' + (0.35 + 0.4 * pulse).toFixed(2) + ')'; mapG.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    mapG.strokeStyle = 'rgba(52,255,130,' + (0.9 - 0.6 * pulse).toFixed(2) + ')'; mapG.lineWidth = 1.5;
    mapG.beginPath(); mapG.arc((bx0 + bx1) / 2, (by0 + by1) / 2, 6 + 10 * pulse, 0, 7); mapG.stroke();
    const [cx, cy] = P(S.x, S.z);
    mapG.save(); mapG.translate(cx, cy); mapG.rotate(S.h);
    mapG.fillStyle = '#3FD0E0'; mapG.strokeStyle = '#fff'; mapG.lineWidth = 1.5;
    mapG.beginPath(); mapG.moveTo(0, -7); mapG.lineTo(5, 6); mapG.lineTo(0, 3.5); mapG.lineTo(-5, 6); mapG.closePath(); mapG.fill(); mapG.stroke();
    mapG.restore();
  }

  // ---------- render loop ----------
  function resize() {
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr); composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    mapStatic = null;
  }
  window.addEventListener('resize', resize);
  resize();

  let raf = 0, last = 0, ft = [], cl = 0, frameN = 0;
  function updateCamera(dt) {
    const fx = Math.sin(S.h), fz = Math.cos(S.h);
    if (S.cam === 'cockpit') {
      car.updateMatrixWorld(true);
      eye.getWorldPosition(camera.position);
      eye.getWorldQuaternion(camera.quaternion);
      camera.rotateY(-S.steer * 0.12);
      camera.up.set(0, 1, 0);
      return;
    }
    if (S.cam === 'top') {
      const k = S.camInit ? 1 - Math.exp(-dt * 5) : 1;
      camPos.lerp(tmpV.set(S.x, S.y + 17, -S.z), k);
      camera.position.copy(camPos);
      camera.up.set(fx, 0, -fz);
      camera.lookAt(S.x, S.y, -S.z);
      S.camInit = true;
      return;
    }
    const back = 6.6 + Math.abs(S.v) * 0.12, height = 2.05;
    const tx = S.x - fx * back, tz = S.z - fz * back;
    const ty = Math.min(floorY(tx, tz) + height, floorY(tx, tz) + 2.55);
    const want = tmpV.set(clamp(tx, -WX + 0.5, WX - 0.5), ty, -clamp(tz, ZR0 + 0.5, ZN - 0.5));
    if (onRamp(S.x, S.z)) want.x = clamp(want.x, -2.9, 2.9);
    const k = S.camInit ? 1 - Math.exp(-dt * 5.5) : 1;
    camPos.lerp(want, k);
    camLook.lerp(new THREE.Vector3(S.x + fx * 4, S.y + 0.7, -(S.z + fz * 4)), S.camInit ? 1 - Math.exp(-dt * 9) : 1);
    S.camInit = true;
    camera.position.copy(camPos);
    if (S.shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake * 0.5, 0));
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook);
  }
  function drawCluster() {
    const g = clusterTex.userData.g, w = 512, h = 180;
    g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#eaf6ff'; g.font = '800 92px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(Math.round(Math.abs(S.v) * 3.6)), w / 2, h / 2 + 4);
    g.font = '600 24px Inter, sans-serif'; g.fillStyle = '#7fe7f5'; g.fillText(T('pg_kmh'), w / 2, h - 22);
    g.font = '800 44px Inter, sans-serif'; g.fillStyle = S.v < -0.1 ? '#ffb547' : '#4be3a0'; g.fillText(S.v < -0.1 ? 'R' : 'D', 60, h / 2);
    clusterTex.needsUpdate = true;
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
    if (S.paused || !(dt > 0)) return;
    S.t += dt;
    if (!S.done || Math.abs(S.v) > 0.01) {
      const n = Math.max(1, Math.ceil(dt / 0.0085));
      for (let i = 0; i < n; i++) step(dt / n);
    } else step(dt);
    S.shake = Math.max(0, S.shake - dt * 1.6);
    car.position.set(S.x, S.y, -S.z);
    car.rotation.set(S.pitch, -S.h, S.roll, 'YXZ');
    for (const W of WHEELS) { W.spin.rotation.x = -S.spin; if (W.front) W.pivot.rotation.y = -S.steer; }
    wheelG.rotation.z = -S.steer * 2.6;
    const braking = (keys.down || touch.down) && S.v > 0.3 || (keys.up || touch.up) && S.v < -0.3 || keys.hand || touch.hand;
    tlMat.color.setRGB(1, 0.13, 0.13).multiplyScalar(braking ? 3.2 : 1.1);
    revMat.color.set(S.v < -0.1 ? '#ffffff' : '#3a3a3a'); if (S.v < -0.1) revMat.color.multiplyScalar(2.2);
    for (const B of BEACONS) { const k = Math.max(0, Math.sin(S.t * 6 + B.ph)); B.m.material.color.setRGB(1, 0.62, 0.1).multiplyScalar(0.6 + 2.6 * k); B.sp.material.opacity = 0.2 + 0.75 * k; }
    const pul = 0.5 + 0.5 * Math.sin(S.t * 3.2);
    bayFill.material.opacity = S.done ? 0.25 : 0.06 + 0.12 * pul;
    outlineMat.opacity = S.done ? 0.9 : 0.35 + 0.45 * pul;
    freeGlow.material.opacity = 0.6 + 0.35 * pul;
    gate.userData.lamp.material.color.setRGB(S.gateA > 0.5 ? 0.2 : 1, S.gateA > 0.5 ? 1 : 0.2, 0.2).multiplyScalar(3);
    updateCamera(dt);
    if (S.toastT > 0) { S.toastT -= dt; if (S.toastT <= 0) q('.pg-toast').hidden = true; }
    // HUD
    if ((cl += dt) > 0.1) {
      cl = 0;
      q('.pg-speed b').textContent = Math.round(Math.abs(S.v) * 3.6);
      q('.pg-speed i').textContent = S.v < -0.1 ? 'R' : Math.abs(S.v) < 0.05 && !(keys.up || keys.down) ? 'N' : 'D';
      q('.pg-time').textContent = fmt(S.started ? S.t - (S.startT || 0) : 0);
      if (S.cam === 'cockpit') drawCluster();
      const [f, r] = sensors();
      const near = Math.min(f, r);
      const sens = q('.pg-sensor');
      if (Math.abs(S.v) < 3.2 && near < 1.6 && S.started) {
        sens.hidden = false;
        const bars = (d) => [0, 1, 2, 3].map((i) => '<i class="' + (d < 1.6 - i * 0.35 ? (i >= 3 ? 'r' : i >= 2 ? 'o' : 'g') : '') + '"></i>').join('');
        sens.querySelector('.f').innerHTML = bars(f);
        sens.querySelector('.r').innerHTML = bars(r);
        sens.querySelector('span').textContent = near.toFixed(1) + ' m';
        S.sens = near;
      } else { sens.hidden = true; S.sens = 9; }
    }
    if (S.sens < 1.6 && AU.ctx && !S.done) {
      S.beepT -= dt;
      if (S.beepT <= 0) { blip(1500, 0.07, 0.12); S.beepT = S.sens < 0.35 ? 0.09 : 0.12 + S.sens * 0.32; }
    }
    drawMap(now);
    if (S.cam === 'cockpit' && (frameN++ & 1)) {
      cockpit.updateMatrixWorld(true);
      mirrorEye.getWorldPosition(mirrorCam.position); mirrorEye.getWorldQuaternion(mirrorCam.quaternion);
      cockpit.visible = false;
      renderer.setRenderTarget(mirrorRT); renderer.render(scene, mirrorCam); renderer.setRenderTarget(null);
      cockpit.visible = true;
    }
    if (useBloom) composer.render(); else renderer.render(scene, camera);
    ft.push(dt);
    if (ft.length >= 90) {
      const avg = ft.reduce((a, b) => a + b, 0) / ft.length; ft = [];
      if (avg > 0.034 && !document.hidden) {
        if (pr > 1) { pr = 1; renderer.setPixelRatio(pr); resize(); }
        else if (useBloom) useBloom = false;
      }
    }
  }

  return {
    start() { S.run = true; S.paused = false; last = 0; mapStatic = null; resize(); q('.pg-hits').textContent = T('pg_hits', { n: S.hits }); if (!raf) raf = requestAnimationFrame(frame); objective(); },
    pause() { S.paused = true; for (const k in keys) keys[k] = false; if (AU.ctx) AU.eg.gain.setTargetAtTime(0, AU.ctx.currentTime, 0.05); if (AU.sq) AU.sq.gain.setTargetAtTime(0, AU.ctx.currentTime, 0.05); },
    resume() { S.paused = false; last = 0; },
    texts() { texts(); objective(); setCam(S.cam); },
    audio: audioInit,
    destroy() {
      cancelAnimationFrame(raf); raf = 0; S.run = false;
      window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true);
      window.removeEventListener('blur', blur); window.removeEventListener('resize', resize);
      try { if (AU.ctx) AU.ctx.close(); } catch (e) { }
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } });
      rt.dispose(); mirrorRT.dispose(); composer.dispose && composer.dispose(); pmrem.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { }
      canvas.remove(); hud.remove();
    },
    debug: () => S,
  };
}
