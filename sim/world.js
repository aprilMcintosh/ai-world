// World generation and grid helpers.
// The map is a small grid of tiles. Ground is grass, water or sand.
// Trees, rocks and berry bushes sit on top of the ground as "objects".

// The land starts this size and can grow. W and H are live: everything that imports them sees the new size.
export const START_W = 44, START_H = 30;
export let W = START_W;
export let H = START_H;
export const setSize = (w, h) => { W = w; H = h; };
export const GRASS = 0;
export const WATER = 1;
export const SAND = 2;
export let WATER_LEVEL = 0.31;
export const setWaterLevel = (n) => { WATER_LEVEL = n; };

export const idx = (x, y) => y * W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
export const key = (x, y) => x + ',' + y;

export function hashSeed(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) {
    h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise, good enough for ponds and forests.
function makeNoise(rand, size = 64) {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const at = (x, y) => grid[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => 0.6 * sample(x, y) + 0.3 * sample(x * 2.1 + 9, y * 2.1 + 9) + 0.1 * sample(x * 4.3 + 31, y * 4.3 + 31);
}

// The same three layers of noise the first valley was cut from, so new land joins on as if it had always been there.
export function terrain(seedText) {
  const rand = mulberry32(hashSeed(seedText));
  return { elev: makeNoise(rand), forest: makeNoise(rand), stone: makeNoise(rand) };
}

// What is in a rock besides stone. Most are plain. Some are streaked green (copper), stained red (iron) or heavy and
// grey (tin), the way real hillsides are: nobody here knows what any of that is good for, until somebody finds out.
export function oreIn(rand, rich) {
  const r = rand();
  if (r > (rich ? 0.3 : 0.12)) return null;
  const k = rand();
  return k < 0.5 ? 'green' : k < 0.85 ? 'red' : 'grey';
}
// Where a tile of sand meets the water there is clay to dig, and reeds grow thick.
export function shoreThings(ground, x, y, rand) {
  if (ground[idx(x, y)] !== SAND) return null;
  if (!neighbors4(x, y).some(([nx, ny]) => inBounds(nx, ny) && ground[idx(nx, ny)] === WATER)) return null;
  const r = rand();
  if (r < 0.09) return ['clay', { left: 12 }];
  if (r < 0.24) return ['reeds', { ripe: true }];
  return null;
}

export function generateWorld(seedText) {
  const rand = mulberry32(hashSeed(seedText));
  const elev = makeNoise(rand);
  const forest = makeNoise(rand);
  const stone = makeNoise(rand);

  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  const ground = new Array(W * H).fill(GRASS);
  const objects = {}; // key -> { kind, x, y, ... }

  const distC = (x, y) => Math.hypot(x - cx, y - cy);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = elev(x / 9, y / 9);
      const d = distC(x, y);
      if (d > 5.5) {
        if (e < WATER_LEVEL) ground[idx(x, y)] = WATER;
        else if (e < WATER_LEVEL + 0.035) ground[idx(x, y)] = SAND;
      }
    }
  }

  const put = (kind, x, y, extra = {}) => {
    objects[key(x, y)] = { kind, x, y, ...extra };
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (ground[idx(x, y)] === SAND) { const sh = shoreThings(ground, x, y, rand); if (sh) put(sh[0], x, y, sh[1]); continue; }
      if (ground[idx(x, y)] !== GRASS) continue;
      const d = distC(x, y);
      if (d < 4.5) continue; // the clearing where life begins
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const f = forest(x / 6, y / 6) + (edge < 3 ? 0.12 : 0) + (d > 12 ? 0.05 : 0);
      const s = stone(x / 5, y / 5);
      const r = rand();
      if (f > 0.6 && r < 0.5) put('tree', x, y, { v: Math.floor(rand() * 3) });
      else if (s > 0.66 && r < 0.4) put('rock', x, y, { left: 6, ore: oreIn(rand, true) });
      else if (r < 0.012) put('rock', x, y, { left: 6, ore: oreIn(rand, false) });
      else if (r < 0.03) put('bush', x, y, { ripe: true });
    }
  }

  // A garden to start in: fruit bushes in a loose ring around the clearing.
  let placed = 0, guard = 0;
  while (placed < 9 && guard++ < 400) {
    const a = rand() * Math.PI * 2;
    const rr = 4.5 + rand() * 4;
    const x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy + Math.sin(a) * rr);
    if (!inBounds(x, y) || ground[idx(x, y)] !== GRASS || objects[key(x, y)]) continue;
    put('bush', x, y, { ripe: true });
    placed++;
  }

  // Make sure there is enough of everything within reach of the clearing.
  const reach = reachable(ground, objects, cx, cy);
  const count = (kind) =>
    Object.values(objects).filter((o) => o.kind === kind && neighbors4(o.x, o.y).some(([nx, ny]) => reach.has(idx(nx, ny)))).length;
  const topUp = (kind, want, extra) => {
    let have = count(kind), tries = 0;
    const open = [...reach].filter((i) => {
      const x = i % W, y = Math.floor(i / W);
      return distC(x, y) > 5 && !objects[key(x, y)];
    });
    while (have < want && tries++ < 600 && open.length) {
      const i = open[Math.floor(rand() * open.length)];
      const x = i % W, y = Math.floor(i / W);
      if (objects[key(x, y)]) continue;
      put(kind, x, y, extra());
      have++;
    }
  };
  topUp('tree', 45, () => ({ v: Math.floor(rand() * 3) }));
  topUp('rock', 16, () => ({ left: 6, ore: oreIn(rand, false) }));
  topUp('bush', 12, () => ({ ripe: true }));
  // enough streaked rock within reach that it will be noticed, and a place to dig clay and cut reeds
  if (Object.values(objects).filter((o) => o.kind === 'rock' && o.ore).length < 4) {
    for (const o of Object.values(objects).filter((o) => o.kind === 'rock' && !o.ore).sort(() => rand() - 0.5).slice(0, 4)) o.ore = rand() < 0.6 ? 'green' : 'red';
  }
  const shore = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ground[idx(x, y)] === SAND && !objects[key(x, y)] && neighbors4(x, y).some(([nx, ny]) => inBounds(nx, ny) && ground[idx(nx, ny)] === WATER)) shore.push([x, y]);
  shore.sort(() => rand() - 0.5);
  for (const kind of ['clay', 'clay', 'clay', 'reeds', 'reeds', 'reeds', 'reeds']) { const t = shore.pop(); if (t) put(kind, t[0], t[1], kind === 'clay' ? { left: 12 } : { ripe: true }); }

  return { ground, objects, spawn: { x: cx, y: cy } };
}

export function neighbors4(x, y) {
  return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => inBounds(a, b));
}

function reachable(ground, objects, sx, sy) {
  const seen = new Set([idx(sx, sy)]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [nx, ny] of neighbors4(x, y)) {
      const i = idx(nx, ny);
      if (seen.has(i) || ground[i] === WATER || objects[key(nx, ny)]) continue;
      seen.add(i);
      q.push([nx, ny]);
    }
  }
  return seen;
}
