// Draws the world. Every sprite is painted here with little rectangles,
// so the game needs no image files at all.

const T = 16; // pixels per tile, before scaling up

// When the land grows, every tile's number moves. The textures are keyed to where a tile was in the first valley,
// so the grass and the trees look the same after the land grows as before.
let offX = 0, offY = 0;
const raw = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000 / 1000;
const hash = (x, y) => raw(x - offX, y - offY);
const hash2 = (x, y, n) => raw((x - offX) * 7 + n * 13, (y - offY) * 11 + n * 5);

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const pix = document.createElement('canvas');
  const pc = pix.getContext('2d');
  const groundCanvas = document.createElement('canvas');
  const light = document.createElement('canvas');
  const lc = light.getContext('2d');

  let world = null;
  let ground = [];
  let view = { scale: 1, ox: 0, oy: 0 };
  // The camera. On "auto" it frames wherever people are living, and widens as the village grows.
  const cam = { z: 1, cx: 0, cy: 0, auto: true, ready: false, last: 0 };
  let colors = {}; // villager id -> shirt color, for roofs

  const R = (c, x, y, w, h, color) => { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), w, h); };
  const blob = (c, cx, cy, r, color) => {
    c.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy) + 0.3);
      c.fillRect(cx - w, cy + dy, w * 2, 1);
    }
  };

  // ---------- ground layer (redrawn only when the world changes) ----------

  let season = 'summer';
  function setWorld(w) {
    // the land grew: keep the camera on the same spot
    const nx = w.ox || 0, ny = w.oy || 0;
    if (world && (nx !== offX || ny !== offY)) { cam.cx += (nx - offX) * T; cam.cy += (ny - offY) * T; }
    offX = nx; offY = ny;
    world = w;
    season = w.season || 'summer';
    const snow = season === 'winter', fall = season === 'autumn';
    ground = w.ground.split('').map(Number);
    pix.width = groundCanvas.width = light.width = w.W * T;
    pix.height = groundCanvas.height = light.height = w.H * T;
    const g = groundCanvas.getContext('2d');
    const at = (x, y) => (x < 0 || y < 0 || x >= w.W || y >= w.H ? 0 : ground[y * w.W + x]);

    for (let y = 0; y < w.H; y++) {
      for (let x = 0; x < w.W; x++) {
        const k = at(x, y), ox = x * T, oy = y * T, h = hash(x, y);
        if (k === 1) {
          R(g, ox, oy, T, T, snow ? (h < 0.5 ? '#9cc4dc' : '#a6ccdf') : h < 0.5 ? '#4a8fc0' : '#4689ba');
          if (snow && h > 0.6) R(g, ox + 2 + Math.floor(h * 8), oy + 4 + Math.floor(hash2(x, y, 8) * 8), 5, 1, '#d7eaf4');
          if (at(x, y - 1) !== 1) R(g, ox, oy, T, 2, '#9fd0e6');
          if (at(x - 1, y) !== 1) R(g, ox, oy, 2, T, '#8ec5df');
          if (at(x + 1, y) !== 1) R(g, ox + T - 1, oy, 1, T, '#3b79a8');
          if (at(x, y + 1) !== 1) R(g, ox, oy + T - 1, T, 1, '#3b79a8');
        } else if (k === 2) {
          R(g, ox, oy, T, T, snow ? '#e9eef0' : h < 0.5 ? '#e3d29a' : '#dccb90');
          if (h > 0.6) R(g, ox + 4 + Math.floor(h * 8), oy + 5, 1, 1, '#c4b279');
          if (h < 0.3) R(g, ox + 10, oy + 11, 1, 1, '#c4b279');
        } else {
          const G = snow ? ['#eef2f4', '#f6f9fa', '#e4eaee', '#ffffff', '#d5dde3'] : fall ? ['#93a34a', '#9aa94e', '#8a9a45', '#a3b156', '#7f8f3f'] : season === 'spring' ? ['#72b256', '#77b85b', '#6cab51', '#80c063', '#63a049'] : ['#69a64e', '#6dab52', '#65a14a', '#73b158', '#5f9a45'];
          R(g, ox, oy, T, T, G[0]);
          // soft patches of lighter and darker grass, bigger than one tile so it does not look like a checkerboard
          const patch = Math.sin(x * 0.55 + Math.sin(y * 0.4) * 2) + Math.cos(y * 0.6 + Math.sin(x * 0.3) * 2);
          if (patch > 0.9) R(g, ox, oy, T, T, G[1]); else if (patch < -0.9) R(g, ox, oy, T, T, G[2]);
          for (let n = 0; n < 3; n++) R(g, ox + Math.floor(hash2(x, y, n + 30) * 15), oy + Math.floor(hash2(x, y, n + 60) * 15), 1, 1, n === 0 ? G[3] : G[4]);
          if (snow) continue;
          if (season === 'spring' && h > 0.8) { const fx = ox + 3 + Math.floor(hash2(x, y, 3) * 9), fy = oy + 4 + Math.floor(hash2(x, y, 4) * 8); R(g, fx, fy, 2, 2, ['#f4e36b', '#f2f2f2', '#e88aa8'][Math.floor(h * 30) % 3]); }
          if (h > 0.45) { const tx = ox + 2 + Math.floor(hash2(x, y, 1) * 11), ty = oy + 3 + Math.floor(hash2(x, y, 2) * 10); R(g, tx, ty, 1, 2, '#578f40'); R(g, tx + 2, ty + 1, 1, 1, '#578f40'); }
          if (h > 0.93) { const fx = ox + 3 + Math.floor(hash2(x, y, 3) * 9), fy = oy + 4 + Math.floor(hash2(x, y, 4) * 8); R(g, fx, fy, 2, 2, h > 0.965 ? '#f4e36b' : '#f2f2f2'); }
        }
      }
    }

    const paths = new Set(w.paths);
    for (const i of paths) {
      const x = i % w.W, y = Math.floor(i / w.W), ox = x * T, oy = y * T;
      R(g, ox, oy, T, T, '#c9b48a');
      R(g, ox + 1, oy + 1, T - 2, T - 2, '#d6c39a');
      for (let n = 0; n < 4; n++) R(g, ox + 2 + Math.floor(hash2(x, y, n) * 11), oy + 2 + Math.floor(hash2(x, y, n + 9) * 11), 2, 1, '#b8a379');
      if (!paths.has(i - w.W)) R(g, ox, oy, T, 1, '#a8946c');
      if (!paths.has(i + w.W)) R(g, ox, oy + T - 1, T, 1, '#a8946c');
      if (!paths.has(i - 1) || x === 0) R(g, ox, oy, 1, T, '#a8946c');
      if (!paths.has(i + 1) || x === w.W - 1) R(g, ox + T - 1, oy, 1, T, '#a8946c');
    }

    // Flat things you can walk over live on the ground layer too.
    for (const s of w.structures) {
      const ox = s.x * T, oy = s.y * T;
      if (s.type === 'farm') {
        g.globalAlpha = s.p < 1 ? 0.45 : 1;
        R(g, ox + 1, oy + 1, 30, 30, '#6f4b2c');
        for (let r = 0; r < 5; r++) R(g, ox + 2, oy + 4 + r * 6, 28, 2, '#845a36');
        if (s.p >= 1) {
          for (let r = 0; r < 5; r++) for (let cI = 0; cI < 6; cI++) {
            const sx = ox + 4 + cI * 5, sy = oy + 3 + r * 6;
            if (s.ripe) { R(g, sx, sy - 2, 2, 4, '#4f9a3c'); R(g, sx, sy - 3, 2, 2, hash2(sx, sy, 1) < 0.5 ? '#e9b53a' : '#e2733a'); }
            else R(g, sx, sy, 2, 2, '#7dbb5c');
          }
        }
        for (const [px, py] of [[0, 0], [30, 0], [0, 30], [30, 30]]) R(g, ox + px, oy + py, 2, 2, '#4a3220');
        g.globalAlpha = 1;
      } else if (s.type === 'coop' || s.type === 'pen') {
        g.globalAlpha = s.p < 1 ? 0.45 : 1;
        const coop = s.type === 'coop';
        R(g, ox + 1, oy + 1, 30, 30, coop ? '#bfa46a' : '#7bb05a');
        for (let n = 0; n < 14; n++) R(g, ox + 2 + Math.floor(hash2(s.x, s.y, n) * 27), oy + 2 + Math.floor(hash2(s.x, s.y, n + 50) * 27), 2, 1, coop ? '#a88d55' : '#6a9c4b');
        if (coop) {
          R(g, ox + 3, oy + 4, 12, 9, '#a9743f'); R(g, ox + 2, oy + 2, 14, 3, '#8f3b2e'); R(g, ox + 7, oy + 8, 4, 5, '#3b2a1a');
          if (s.ripe) for (const [ex, ey] of [[18, 8], [22, 6], [20, 11]]) R(g, ox + ex, oy + ey, 2, 2, '#fffdf2');
        } else {
          R(g, ox + 18, oy + 4, 10, 4, '#6b4a2b'); R(g, ox + 19, oy + 5, 8, 2, '#6fb0d8');
          if (s.ripe) { R(g, ox + 5, oy + 5, 4, 5, '#c9ccd4'); R(g, ox + 6, oy + 5, 2, 1, '#ffffff'); }
        }
        // fence
        R(g, ox, oy + 1, 32, 1, '#8a5a2b'); R(g, ox, oy + 3, 32, 1, '#8a5a2b');
        R(g, ox, oy + 28, 32, 1, '#8a5a2b'); R(g, ox, oy + 30, 32, 1, '#8a5a2b');
        R(g, ox, oy, 1, 31, '#8a5a2b'); R(g, ox + 31, oy, 1, 31, '#8a5a2b');
        for (const px of [0, 10, 21, 30]) { R(g, ox + px, oy, 2, 5, '#5b3b21'); R(g, ox + px, oy + 27, 2, 5, '#5b3b21'); }
        for (const py of [10, 19]) { R(g, ox, oy + py, 2, 4, '#5b3b21'); R(g, ox + 30, oy + py, 2, 4, '#5b3b21'); }
        g.globalAlpha = 1;
      } else if (s.type === 'garden') {
        g.globalAlpha = s.p < 1 ? 0.45 : 1;
        const pal = ['#e8597a', '#f4d03f', '#ffffff', '#b06fd8', '#f08a3c'];
        for (let n = 0; n < 6; n++) {
          const fx = ox + 2 + Math.floor(hash2(s.x, s.y, n) * 11), fy = oy + 3 + Math.floor(hash2(s.x, s.y, n + 20) * 10);
          R(g, fx, fy + 1, 1, 2, '#3f8a3a');
          R(g, fx - 1, fy - 1, 3, 2, pal[Math.floor(hash2(s.x, s.y, n + 40) * pal.length)]);
        }
        g.globalAlpha = 1;
      }
    }
  }

  // ---------- sprites ----------

  function tree(c, o) {
    const ox = o[1] * T, oy = o[2] * T, v = o[3];
    const snow = season === 'winter', fall = season === 'autumn';
    R(c, ox + 3, oy + 13, 10, 2, 'rgba(0,0,0,0.16)');
    R(c, ox + 7, oy + 8, 2, 6, '#6b4a2b');
    if (v === 1) {
      // pines stay green all year
      for (let i = 0; i < 3; i++) {
        const top = oy - 9 + i * 5;
        for (let r = 0; r < 7; r++) R(c, ox + 8 - Math.ceil((r + 1 + i) * 0.75), top + r, Math.ceil((r + 1 + i) * 0.75) * 2, 1, snow && r < 2 ? '#f4f8fa' : r > 4 ? '#1f5c3b' : '#2a7349');
      }
    } else if (snow) {
      // bare branches with snow on them
      R(c, ox + 7, oy - 2, 2, 10, '#6b4a2b');
      for (const [bx, by, bw] of [[3, 3, 5], [9, 1, 5], [4, -2, 4], [9, -3, 4], [6, -5, 4]]) { R(c, ox + bx, oy + by, bw, 1, '#6b4a2b'); R(c, ox + bx, oy + by - 1, bw, 1, '#f4f8fa'); }
    } else {
      const tint = hash(o[1], o[2]);
      const main = fall ? (tint < 0.35 ? '#c9732b' : tint < 0.7 ? '#b8492d' : '#d1a233') : v === 2 ? '#3c8a3a' : '#2f7d3b';
      const lite = fall ? (tint < 0.35 ? '#e08f3c' : tint < 0.7 ? '#d0613e' : '#e6bd4a') : v === 2 ? '#52a44b' : '#3f9a4b';
      blob(c, ox + 8, oy + 2, 7, main);
      blob(c, ox + 6, oy, 4, lite);
      R(c, ox + 3, oy + 7, 10, 1, fall ? '#8f4a22' : '#256a31');
      if (v === 2 && !fall) for (const [ax, ay] of [[4, 2], [10, -1], [8, 5], [12, 4]]) R(c, ox + ax, oy + ay, 2, 2, season === 'spring' ? '#f3c6d8' : '#d8413f');
    }
  }
  function rock(c, o) {
    const ox = o[1] * T, oy = o[2] * T, big = o[3] > 2, ore = o[4];
    R(c, ox + 3, oy + 13, 10, 2, 'rgba(0,0,0,0.16)');
    const body = ore === 'r' ? '#8e6a5a' : ore === 'g' ? '#555a66' : '#8b8e99';
    blob(c, ox + 8, oy + 10, big ? 5 : 3, body);
    blob(c, ox + 7, oy + 9, big ? 3 : 2, season === 'winter' ? '#f4f8fa' : ore === 'r' ? '#a98678' : ore === 'g' ? '#6e7482' : '#a4a7b1');
    R(c, ox + 5, oy + 13, 6, 1, '#6f727c');
    // the streaks that nobody has looked into yet: green for copper, rust for iron, a dull sheen for tin
    if (ore === 'g') { R(c, ox + 5, oy + 10, 3, 1, '#3fa66b'); R(c, ox + 9, oy + 12, 2, 1, '#3fa66b'); R(c, ox + 7, oy + 8, 1, 2, '#6fd19a'); }
    else if (ore === 'r') { R(c, ox + 4, oy + 11, 4, 1, '#b5522a'); R(c, ox + 9, oy + 9, 2, 2, '#c9653a'); }
    else if (ore === 'y') { R(c, ox + 6, oy + 9, 2, 1, '#d8dbe6'); R(c, ox + 9, oy + 11, 1, 1, '#eef0f6'); }
  }
  function clay(c, o) {
    const ox = o[1] * T, oy = o[2] * T;
    // a dug-out bank of wet clay
    R(c, ox + 2, oy + 6, 12, 8, '#b36b43');
    R(c, ox + 3, oy + 7, 10, 6, '#c47d52');
    R(c, ox + 5, oy + 9, 4, 2, '#8f5232'); R(c, ox + 10, oy + 11, 2, 1, '#8f5232');
    R(c, ox + 2, oy + 13, 12, 1, '#7a4628');
  }
  function reeds(c, o) {
    const ox = o[1] * T, oy = o[2] * T, ripe = o[3];
    const green = season === 'winter' ? '#8a8f6a' : ripe ? '#5d9a3a' : '#7f9a5a';
    for (const [x, h] of [[3, 9], [6, 12], [9, 10], [12, 11], [7, 7]]) { R(c, ox + x, oy + 14 - h, 1, h, green); if (ripe && h > 9) R(c, ox + x, oy + 14 - h - 2, 1, 3, '#7a5a2b'); }
    R(c, ox + 2, oy + 13, 12, 1, 'rgba(0,0,0,0.12)');
  }
  function bush(c, o) {
    const ox = o[1] * T, oy = o[2] * T;
    R(c, ox + 3, oy + 13, 10, 2, 'rgba(0,0,0,0.14)');
    const snow = season === 'winter';
    blob(c, ox + 8, oy + 10, 5, snow ? '#7d8a6a' : season === 'autumn' ? '#7f8a3c' : '#3d8b40');
    blob(c, ox + 7, oy + 8, 3, snow ? '#f4f8fa' : season === 'autumn' ? '#98a348' : '#4ea24f');
    if (o[3]) for (const [bx, by] of [[5, 8], [9, 7], [11, 11], [6, 12]]) R(c, ox + bx, oy + by, 2, 2, '#c8324a');
  }

  const SPRITES = {
    campfire(c, ox, oy, s, t) {
      for (const [x, y] of [[3, 11], [5, 13], [9, 13], [11, 11], [4, 9], [10, 9]]) R(c, ox + x, oy + y, 2, 2, '#8b8e99');
      R(c, ox + 4, oy + 11, 8, 2, '#5b3b21');
      R(c, ox + 6, oy + 10, 4, 2, '#6b4a2b');
      const f = Math.floor(t * 9) % 3;
      R(c, ox + 6, oy + 5 - (f === 1 ? 1 : 0), 4, 6, '#f08a2c');
      R(c, ox + 5, oy + 8, 6, 3, '#f08a2c');
      R(c, ox + 7, oy + 7 - (f === 2 ? 1 : 0), 2, 4, '#ffd75a');
      R(c, ox + 6 + f, oy + 2 - f, 1, 1, '#ffb347');
    },
    shelter(c, ox, oy) {
      R(c, ox + 1, oy + 13, 14, 2, 'rgba(0,0,0,0.18)');
      for (let r = 0; r < 13; r++) R(c, ox + 8 - Math.ceil(r * 0.55) - 1, oy + 1 + r, Math.ceil(r * 0.55) * 2 + 2, 1, r % 3 === 0 ? '#b08f4a' : '#c9a55c');
      for (let r = 0; r < 7; r++) R(c, ox + 8 - Math.ceil(r * 0.35) - 1, oy + 7 + r, Math.ceil(r * 0.35) * 2 + 2, 1, '#3b2a1a');
      R(c, ox + 7, oy - 1, 2, 3, '#6b4a2b');
    },
    house(c, ox, oy, s, t, dark) {
      const roof = colors[s.owner] || '#b5542f';
      R(c, ox + 2, oy + 29, 28, 2, 'rgba(0,0,0,0.2)');
      R(c, ox + 3, oy + 13, 26, 17, '#e8d9b5');
      R(c, ox + 3, oy + 28, 26, 2, '#b9a57a');
      R(c, ox + 3, oy + 13, 1, 17, '#9c8a63');
      R(c, ox + 28, oy + 13, 1, 17, '#9c8a63');
      for (let r = 0; r < 13; r++) R(c, ox + 9 - Math.ceil(r * 0.6) - 1, oy + 1 + r, 16 + Math.ceil(r * 0.6) * 2, 1, r % 4 === 3 ? shade(roof, -0.12) : roof);
      R(c, ox + 1, oy + 13, 30, 1, shade(roof, -0.2));
      R(c, ox + 22, oy - 2, 4, 6, '#8a6f5a');
      R(c, ox + 13, oy + 20, 6, 10, '#6b4a2b');
      R(c, ox + 17, oy + 25, 1, 1, '#e0b84a');
      const win = dark > 0.25 ? '#ffd76a' : '#9cc7dd';
      if (s.warm) for (let i = 0; i < 3; i++) { const ph = (t * 0.5 + i / 3) % 1; c.globalAlpha = (1 - ph) * 0.7; R(c, ox + 23 + Math.sin(ph * 5 + i) * 2, oy - 4 - ph * 14, 2 + Math.round(ph * 2), 2, '#e9edf0'); c.globalAlpha = 1; }
      R(c, ox + 6, oy + 18, 5, 5, win); R(c, ox + 21, oy + 18, 5, 5, win);
      R(c, ox + 8, oy + 18, 1, 5, '#8a7650'); R(c, ox + 23, oy + 18, 1, 5, '#8a7650');
    },
    bench(c, ox, oy) {
      R(c, ox + 2, oy + 13, 12, 1, 'rgba(0,0,0,0.16)');
      R(c, ox + 3, oy + 5, 10, 2, '#a06a35'); R(c, ox + 3, oy + 9, 10, 2, '#8a5a2b');
      R(c, ox + 3, oy + 5, 1, 9, '#6b4423'); R(c, ox + 12, oy + 5, 1, 9, '#6b4423');
    },
    well(c, ox, oy) {
      R(c, ox + 2, oy + 14, 12, 1, 'rgba(0,0,0,0.18)');
      blob(c, ox + 8, oy + 10, 5, '#9a9ca6'); blob(c, ox + 8, oy + 10, 3, '#2f5d86');
      R(c, ox + 3, oy + 12, 10, 2, '#7d808a');
      R(c, ox + 3, oy, 1, 10, '#6b4a2b'); R(c, ox + 12, oy, 1, 10, '#6b4a2b');
      R(c, ox + 2, oy - 2, 12, 3, '#8a5a2b'); R(c, ox + 7, oy + 1, 1, 5, '#cfc7b0');
    },
    lantern(c, ox, oy, s, t, dark) {
      R(c, ox + 6, oy + 14, 4, 1, 'rgba(0,0,0,0.18)');
      R(c, ox + 7, oy + 5, 2, 10, '#4a3a2a');
      R(c, ox + 5, oy, 6, 6, '#4a3a2a');
      R(c, ox + 6, oy + 1, 4, 4, dark > 0.25 ? '#ffe07a' : '#d9c68a');
      R(c, ox + 6, oy - 1, 4, 1, '#2f251a');
    },
    statue(c, ox, oy) {
      R(c, ox + 3, oy + 14, 10, 1, 'rgba(0,0,0,0.18)');
      R(c, ox + 4, oy + 10, 8, 5, '#8b8e99'); R(c, ox + 4, oy + 10, 8, 1, '#a4a7b1');
      R(c, ox + 6, oy + 1, 4, 9, '#b3b5bd'); R(c, ox + 6, oy - 3, 4, 4, '#c3c5cc');
      R(c, ox + 10, oy - 1, 2, 2, '#b3b5bd'); R(c, ox + 11, oy - 4, 1, 4, '#b3b5bd');
    },
    workshop(c, ox, oy) {
      R(c, ox + 2, oy + 29, 28, 2, 'rgba(0,0,0,0.2)');
      R(c, ox + 2, oy + 12, 28, 18, '#a9743f');
      for (let x = 5; x < 30; x += 5) R(c, ox + x, oy + 12, 1, 18, '#8f5f31');
      for (let r = 0; r < 10; r++) R(c, ox + 1, oy + 3 + r, 30 - r, 1, r % 3 === 2 ? '#5f6470' : '#737885');
      R(c, ox + 11, oy + 18, 10, 12, '#4a3220');
      R(c, ox + 24, oy - 3, 4, 8, '#6f727c');
      R(c, ox + 4, oy + 17, 5, 1, '#3b3b44'); R(c, ox + 6, oy + 18, 1, 5, '#8a5a2b');
    },
    market(c, ox, oy) {
      R(c, ox + 2, oy + 29, 28, 2, 'rgba(0,0,0,0.2)');
      R(c, ox + 3, oy + 8, 2, 22, '#6b4a2b'); R(c, ox + 27, oy + 8, 2, 22, '#6b4a2b');
      for (let i = 0; i < 7; i++) R(c, ox + 2 + i * 4, oy + 4, 4, 8, i % 2 ? '#f2efe6' : '#c8433c');
      R(c, ox + 2, oy + 12, 28, 1, '#8f2f2a');
      R(c, ox + 3, oy + 20, 26, 10, '#a9743f'); R(c, ox + 3, oy + 20, 26, 2, '#c08a4f');
      for (const [x, col] of [[6, '#e2733a'], [11, '#c8324a'], [16, '#e9b53a'], [21, '#5f9a48']]) R(c, ox + x, oy + 17, 4, 3, col);
    },
    grave(c, ox, oy) {
      R(c, ox + 4, oy + 12, 9, 3, season === 'winter' ? '#dfe6ea' : '#6f5a3c');
      R(c, ox + 5, oy + 3, 6, 10, '#9a9ca6'); R(c, ox + 6, oy + 2, 4, 1, '#9a9ca6'); R(c, ox + 5, oy + 3, 1, 10, '#b3b5bd');
      R(c, ox + 7, oy + 5, 2, 5, '#6f727c'); R(c, ox + 6, oy + 6, 4, 1, '#6f727c');
    },
    storehouse(c, ox, oy) {
      R(c, ox + 2, oy + 29, 28, 2, 'rgba(0,0,0,0.2)');
      R(c, ox + 3, oy + 11, 26, 19, '#9c4a3a');
      for (let x = 7; x < 28; x += 4) R(c, ox + x, oy + 11, 1, 19, '#863e31');
      for (let r = 0; r < 6; r++) R(c, ox + 10 - r * 1.6, oy - 1 + r, 12 + r * 3.2, 1, '#5a4636');
      for (let r = 0; r < 7; r++) R(c, ox + 1, oy + 5 + r, 30, 1, r % 3 === 2 ? '#4d3b2d' : '#5a4636');
      R(c, ox + 10, oy + 17, 12, 13, '#5b2f25');
      R(c, ox + 10, oy + 17, 12, 1, '#f2efe6'); R(c, ox + 10, oy + 17, 1, 13, '#f2efe6'); R(c, ox + 21, oy + 17, 1, 13, '#f2efe6'); R(c, ox + 15, oy + 17, 2, 13, '#f2efe6');
      R(c, ox + 13, oy + 7, 6, 4, '#e9c95a'); R(c, ox + 13, oy + 7, 6, 1, '#f2efe6');
    },
    chapel(c, ox, oy, s, t, dark) {
      R(c, ox + 2, oy + 29, 28, 2, 'rgba(0,0,0,0.2)');
      R(c, ox + 4, oy + 12, 24, 18, '#f2efe6'); R(c, ox + 4, oy + 28, 24, 2, '#cfcabb');
      for (let r = 0; r < 14; r++) R(c, ox + 16 - r - 1, oy - 2 + r, (r + 1) * 2, 1, r % 4 === 3 ? '#693e30' : '#7a4b3a');
      R(c, ox + 13, oy - 10, 6, 10, '#f2efe6'); R(c, ox + 12, oy - 12, 8, 3, '#7a4b3a');
      R(c, ox + 15, oy - 18, 2, 7, '#e0b84a'); R(c, ox + 13, oy - 16, 6, 2, '#e0b84a');
      R(c, ox + 13, oy + 20, 6, 10, '#6b4a2b'); R(c, ox + 14, oy + 19, 4, 1, '#6b4a2b');
      blob(c, ox + 16, oy + 15, 2, dark > 0.25 ? '#ffd76a' : '#9cc7dd');
    },
  };

  // Things the villagers invented have no hand-drawn sprite. They are put together
  // from what the inventor said they look like: a shape, a material and a color.
  const MAT = { wood: ['#a9743f', '#8f5f31'], stone: ['#9a9ca6', '#7d808a'], clay: ['#c97a4a', '#a85f36'], thatch: ['#c9a55c', '#b08f4a'], hide: ['#b89472', '#96765a'], brick: ['#b4553a', '#8f3f2b'], copper: ['#c2763e', '#8f5428'], bronze: ['#b08a3e', '#7f6128'], iron: ['#5e626c', '#3e414a'], metal: ['#8d939e', '#5e636d'], glass: ['#bfe3ef', '#7fb6cc'], cloth: ['#c9b6d9', '#9c84b3'] };
  const TINT = { brown: '#7a4b2a', gray: '#70737d', red: '#c8433c', orange: '#e2733a', yellow: '#e9b53a', green: '#5f9a48', blue: '#4a8fc0', white: '#f2efe6', black: '#33343d', purple: '#8a67c7' };
  function invented(c, ox, oy, s, t, dark) {
    const look = s.look || {};
    const [m1, m2] = MAT[look.material] || MAT.wood;
    const tint = TINT[look.color] || TINT.brown;
    const W2 = s.w * T, H2 = s.h * T, cx = ox + W2 / 2, base = oy + H2 - 2;
    R(c, ox + 2, base, W2 - 4, 2, 'rgba(0,0,0,0.2)');
    const glow = dark > 0.25 ? '#ffd76a' : '#3b2a1a';
    switch (look.shape) {
      case 'tower': {
        const w = W2 * 0.5;
        R(c, cx - w / 2, oy - H2 * 0.7, w, H2 * 1.7 - 2, m1);
        for (let y = oy - H2 * 0.7 + 4; y < base; y += 5) R(c, cx - w / 2, y, w, 1, m2);
        R(c, cx - w / 2 - 2, oy - H2 * 0.7 - 3, w + 4, 4, tint);
        R(c, cx - 1, oy - H2 * 0.7 - 7, 2, 4, '#f08a2c'); R(c, cx - 2, base - 6, 4, 6, '#3b2a1a');
        break;
      }
      case 'dome': {
        const rad = Math.floor(W2 / 2) - 2;
        for (let dy = -rad; dy <= 0; dy++) { const w = Math.floor(Math.sqrt(rad * rad - dy * dy)); R(c, cx - w, base + dy - 1, w * 2, 1, dy % 3 === 0 ? m2 : m1); }
        R(c, cx - 2, base - 5, 4, 4, glow); R(c, cx - 1, base - rad - 3, 2, 3, tint);
        break;
      }
      case 'frame': {
        R(c, ox + 2, oy - 2, 2, H2, m2); R(c, ox + W2 - 4, oy - 2, 2, H2, m2);
        R(c, ox + 1, oy - 3, W2 - 2, 2, m1); R(c, ox + 2, oy + Math.floor(H2 / 2) - 2, W2 - 4, 1, m1);
        for (let x = ox + 5; x < ox + W2 - 4; x += 3) R(c, x, oy, 1, Math.floor(H2 / 2) + 2, tint);
        break;
      }
      case 'pit': {
        const rad = Math.floor(W2 / 2) - 2;
        for (let dy = -Math.floor(rad / 2); dy <= Math.floor(rad / 2); dy++) { const w = Math.floor(Math.sqrt(rad * rad - dy * dy * 4)); R(c, cx - w, base - rad / 2 + dy - 2, w * 2, 1, Math.abs(dy) === Math.floor(rad / 2) ? m1 : '#2a211a'); }
        R(c, cx - rad, base - rad / 2 - 2, 1, 2, m2); R(c, cx + rad - 1, base - rad / 2 - 2, 1, 2, m2); R(c, cx - 1, base - rad / 2 - 3, 3, 2, tint);
        break;
      }
      case 'table': {
        R(c, ox + 2, base - 7, W2 - 4, 3, m1); R(c, ox + 3, base - 4, 1, 4, m2); R(c, ox + W2 - 4, base - 4, 1, 4, m2);
        for (let x = ox + 4; x < ox + W2 - 4; x += 4) R(c, x, base - 10, 3, 3, x % 8 < 4 ? tint : '#e9b53a');
        break;
      }
      case 'pool': {
        const rad = Math.floor(W2 / 2) - 2;
        for (let dy = -Math.floor(rad / 2); dy <= Math.floor(rad / 2); dy++) { const w = Math.floor(Math.sqrt(rad * rad - dy * dy * 4)); R(c, cx - w - 1, base - rad / 2 + dy - 2, w * 2 + 2, 1, m2); R(c, cx - w + 1, base - rad / 2 + dy - 2, Math.max(0, w * 2 - 2), 1, '#5aa0cc'); }
        R(c, cx - 2 + Math.round(Math.sin(t * 2) * 2), base - rad / 2 - 2, 3, 1, 'rgba(255,255,255,0.5)');
        break;
      }
      case 'pillar': {
        for (const dx of W2 > T ? [-8, 0, 8] : [0]) { R(c, cx + dx - 2, base - 13 - (dx === 0 ? 4 : 0), 4, 13 + (dx === 0 ? 4 : 0), m1); R(c, cx + dx - 2, base - 13 - (dx === 0 ? 4 : 0), 1, 13, m2); R(c, cx + dx - 2, base - 10, 4, 1, tint); }
        break;
      }
      case 'wheel': {
        const rad = Math.floor(W2 / 2) - 3, wy = base - rad - 1, a0 = t * 0.8;
        for (let i = 0; i < 12; i++) { const a = a0 + (i * Math.PI) / 6; R(c, cx + Math.cos(a) * rad - 1, wy + Math.sin(a) * rad - 1, 2, 2, m1); }
        for (let i = 0; i < 4; i++) { const a = a0 + (i * Math.PI) / 2; line(c, cx, wy, cx + Math.cos(a) * rad, wy + Math.sin(a) * rad, m2); }
        R(c, cx - 1, wy - 1, 3, 3, tint); R(c, cx - 1, wy, 2, rad + 2, m2);
        break;
      }
      case 'field': {
        R(c, ox + 1, oy + 1, W2 - 2, H2 - 3, '#6f4b2c');
        for (let y = oy + 3; y < base - 1; y += 4) for (let x = ox + 3; x < ox + W2 - 2; x += 4) { R(c, x, y, 1, 2, '#4f9a3c'); R(c, x, y - 1, 2, 1, tint); }
        R(c, ox, oy, W2, 1, m2); R(c, ox, base, W2, 1, m2);
        break;
      }
      case 'furnace': {
        // a squat body with a chimney and a mouth that glows
        const w = W2 - 6;
        R(c, cx - w / 2, base - H2 * 0.7, w, H2 * 0.7, m1);
        for (let y = base - H2 * 0.7 + 3; y < base; y += 4) R(c, cx - w / 2, y, w, 1, m2);
        R(c, cx + w / 2 - 5, base - H2 * 0.7 - 9, 4, 10, m2); R(c, cx + w / 2 - 6, base - H2 * 0.7 - 10, 6, 2, tint);
        const fire = Math.sin(t * 6) > 0 ? '#ff9a2c' : '#ffc45a';
        R(c, cx - 4, base - 7, 7, 6, '#2a1a12'); R(c, cx - 3, base - 6, 5, 4, fire);
        if (dark > 0.2) { c.fillStyle = 'rgba(255,150,60,0.25)'; c.fillRect(cx - 8, base - 10, 15, 10); }
        for (let i = 0; i < 3; i++) { const sm = (t * 10 + i * 7) % 20; R(c, cx + w / 2 - 4 + Math.sin(t + i) * 2, base - H2 * 0.7 - 10 - sm, 2, 2, `rgba(120,120,130,${0.5 - sm / 40})`); }
        break;
      }
      case 'mill': {
        const wallTop = oy + Math.floor(H2 * 0.4);
        R(c, cx - W2 * 0.3, wallTop, W2 * 0.6, base - wallTop, m1);
        for (let x = cx - W2 * 0.3 + 3; x < cx + W2 * 0.3; x += 4) R(c, x, wallTop, 1, base - wallTop, m2);
        const rise = Math.floor(H2 * 0.4);
        for (let i = 0; i < rise; i++) { const half = Math.ceil(((i + 1) / rise) * (W2 * 0.35)); R(c, cx - half, wallTop - rise + i, half * 2, 1, tint); }
        // sails turning
        const hub = { x: cx + W2 * 0.3 + 2, y: wallTop - 2 }, rad = Math.max(8, W2 * 0.45), a0 = t * 0.6;
        for (let i = 0; i < 4; i++) { const a = a0 + (i * Math.PI) / 2; line(c, hub.x, hub.y, hub.x + Math.cos(a) * rad, hub.y + Math.sin(a) * rad, m2); const bx = hub.x + Math.cos(a) * rad * 0.55, by = hub.y + Math.sin(a) * rad * 0.55; R(c, bx - 1, by - 1, 3, 3, '#f2efe6'); }
        R(c, hub.x - 1, hub.y - 1, 3, 3, tint);
        R(c, cx - 2, base - 6, 4, 6, '#3b2a1a');
        break;
      }
      case 'machine': {
        R(c, ox + 2, base - H2 * 0.6, W2 - 4, H2 * 0.6, m1);
        R(c, ox + 2, base - H2 * 0.6, W2 - 4, 2, m2);
        const g1 = { x: ox + W2 * 0.35, y: base - H2 * 0.3 }, g2 = { x: ox + W2 * 0.7, y: base - H2 * 0.35 };
        for (const [g, rad, dir] of [[g1, 4, 1], [g2, 3, -1]]) { for (let i = 0; i < 8; i++) { const a = t * 2 * dir + (i * Math.PI) / 4; R(c, g.x + Math.cos(a) * rad - 1, g.y + Math.sin(a) * rad - 1, 2, 2, tint); } R(c, g.x - 1, g.y - 1, 3, 3, m2); }
        R(c, ox + W2 - 6, base - H2 * 0.6 - 6, 3, 7, m2);
        for (let i = 0; i < 2; i++) { const sm = (t * 8 + i * 9) % 18; R(c, ox + W2 - 6 + Math.sin(t + i), base - H2 * 0.6 - 7 - sm, 2, 2, `rgba(200,200,210,${0.5 - sm / 36})`); }
        break;
      }
      case 'wall': {
        R(c, ox, base - H2 * 0.55, W2, H2 * 0.55, m1);
        for (let y = base - H2 * 0.55 + 2; y < base; y += 4) for (let x = ox + ((y / 4) % 2 ? 0 : 3); x < ox + W2; x += 6) R(c, x, y, 5, 1, m2);
        for (let x = ox; x < ox + W2; x += 6) R(c, x, base - H2 * 0.55 - 3, 3, 3, tint);
        break;
      }
      case 'boat': {
        // a hull drawn up on the bank
        const w = W2 - 4;
        for (let i = 0; i < 5; i++) R(c, cx - w / 2 + i, base - 2 - i, w - i * 2, 1, i % 2 ? m2 : m1);
        R(c, cx - 1, base - 16, 2, 10, m2); R(c, cx + 1, base - 15, 6, 7, tint);
        break;
      }
      default: { // hut
        const wallTop = oy + Math.floor(H2 * 0.45);
        R(c, ox + 2, wallTop, W2 - 4, base - wallTop, m1);
        for (let x = ox + 5; x < ox + W2 - 3; x += 4) R(c, x, wallTop, 1, base - wallTop, m2);
        const rise = Math.floor(H2 * 0.6);
        for (let i = 0; i < rise; i++) { const half = Math.ceil(((i + 1) / rise) * (W2 / 2)); R(c, cx - half, wallTop - rise + i, half * 2, 1, i % 3 === 2 ? shade(tint, -0.12) : tint); }
        R(c, cx - 2, base - 6, 4, 6, '#3b2a1a');
        if (W2 > T) R(c, ox + 5, wallTop + 3, 4, 4, dark > 0.25 ? '#ffd76a' : '#9cc7dd');
      }
    }
  }

  function structure(c, s, t, dark) {
    const draw = SPRITES[s.type] || (s.look ? invented : null);
    if (!draw) return;
    const ox = s.x * T, oy = s.y * T;
    if (s.p >= 1) return draw(c, ox, oy, s, t, dark);
    // Under construction: a ghost of the finished thing, filled in from the ground up.
    const top = oy - 20, bottom = oy + s.h * T + 2, full = bottom - top;
    c.save();
    c.globalAlpha = 0.25;
    draw(c, ox, oy, s, t, dark);
    c.globalAlpha = 1;
    c.beginPath();
    c.rect(ox - 4, bottom - full * s.p, s.w * T + 8, full * s.p);
    c.clip();
    draw(c, ox, oy, s, t, dark);
    c.restore();
    R(c, ox, oy + s.h * T - 1, s.w * T, 1, '#8a6a3a');
    R(c, ox, oy + s.h * T - 6, 1, 6, '#8a6a3a'); R(c, ox + s.w * T - 1, oy + s.h * T - 6, 1, 6, '#8a6a3a');
  }

  function person(c, p, t, selected) {
    const v = p.old ? { ...p, hair: '#c9c9cf' } : p;
    const px = Math.round(v.rx * T), py = Math.round(v.ry * T) + 4;
    const kid = v.st === 'child';
    if (selected) { c.strokeStyle = '#fff3b0'; c.lineWidth = 1; c.strokeRect(px - 6.5, py - 2.5, 13, 5); }
    R(c, px - 3, py, 6, 2, 'rgba(0,0,0,0.22)');

    if (v.sleeping) {
      R(c, px - 4, py - 3, 8, 3, v.shirt);
      R(c, px - 7, py - 4, 4, 4, v.skin);
      R(c, px - 8, py - 4, 2, 4, v.hair);
      return;
    }
    const step = v.moving ? Math.floor(t * 8 + v.id) % 2 : 0;
    const bob = v.working ? Math.floor(t * 5 + v.id) % 2 : step;
    const girl = v.g === 'f';
    if (kid) {
      const bx = px - 3, by = py - 9 - bob;
      R(c, bx + 1, py - 2, 1, 2 - step, '#4a3a2a'); R(c, bx + 3, py - 2, 1, 1 + step, '#4a3a2a');
      R(c, bx, by + 4, 5, girl ? 5 : 4, v.shirt);
      R(c, bx, by, 5, 4, v.skin);
      R(c, bx, by - 1, 5, 2, v.hair);
      if (girl) { R(c, bx - 1, by, 1, 4, v.hair); R(c, bx + 5, by, 1, 4, v.hair); }
      R(c, bx + (v.dir > 0 ? 2 : 1), by + 2, 1, 1, '#2a2019'); R(c, bx + (v.dir > 0 ? 4 : 3), by + 2, 1, 1, '#2a2019');
      return;
    }
    const bx = px - 4, by = py - 13 - bob;
    R(c, bx + 2, py - 3, 2, 3 - step, '#4a3a2a'); R(c, bx + 4, py - 3, 2, 2 + step, '#4a3a2a');
    R(c, bx + 1, by + 5, 6, girl ? 7 : 6, v.shirt);
    R(c, bx + 1, by + 10, 6, 1, shade(v.shirt, -0.15));
    R(c, bx, by + 6, 1, 3, v.skin); R(c, bx + 7, by + 6, 1, 3, v.skin);
    R(c, bx + 1, by, 6, 5, v.skin);
    R(c, bx + 1, by - 1, 6, 2, v.hair);
    if (girl) { R(c, bx, by, 1, 6, v.hair); R(c, bx + 7, by, 1, 6, v.hair); }
    else R(c, v.dir > 0 ? bx + 1 : bx + 6, by + 1, 1, 2, v.hair);
    R(c, bx + (v.dir > 0 ? 3 : 2), by + 2, 1, 1, '#2a2019'); R(c, bx + (v.dir > 0 ? 6 : 5), by + 2, 1, 1, '#2a2019');
    if (v.spear) {
      const hx = px + v.dir * 5;
      line(c, hx - v.dir * 2, py - 3, hx + v.dir * 4, py - 15, '#6b4a2b');
      R(c, hx + v.dir * 4, py - 16, 1, 2, '#c9ccd4');
    }
    if (v.hp < 45 && !v.sleeping) R(c, px + 2, py - 9, 2, 2, '#b8322a');
    if (v.sick) { R(c, px - 1, py - 18, 3, 1, '#7ed957'); R(c, px, py - 19, 1, 3, '#7ed957'); }
    if (v.cast) {
      // a fishing rod, a line, and a bobber riding the water
      const hx = px + (v.cast[0] || v.dir) * 4, hy = py - 7;
      const tipX = hx + v.cast[0] * 6, tipY = hy - 6 + v.cast[1] * 3;
      const bobX = px + v.cast[0] * 14, bobY = py - 3 + v.cast[1] * 13 + Math.round(Math.sin(t * 3 + v.id));
      line(c, hx, hy, tipX, tipY, '#6b4a2b');
      line(c, tipX, tipY, bobX, bobY, 'rgba(255,255,255,0.75)');
      R(c, bobX - 1, bobY, 2, 2, '#d8413f');
    }
  }

  function line(c, x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    c.fillStyle = color;
    for (let i = 0; i < 80; i++) {
      c.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  function animal(c, a, t) {
    const px = Math.round(a.rx * T), py = Math.round(a.ry * T) + 3, d = a.dir > 0 ? 1 : -1;
    const step = a.moving ? Math.floor(t * 8 + a.id) % 2 : 0;
    if (a.k === 'r') {
      const hop = a.moving ? Math.round(Math.abs(Math.sin(t * 11 + a.id)) * 2) : 0;
      R(c, px - 2, py, 4, 1, 'rgba(0,0,0,0.18)');
      R(c, px - 2, py - 3 - hop, 4, 3, '#b59a7a');
      R(c, px + (d > 0 ? 1 : -3), py - 5 - hop, 2, 2, '#b59a7a');
      R(c, px + (d > 0 ? 2 : -3), py - 7 - hop, 1, 2, '#a08566');
      R(c, px + (d > 0 ? -3 : 2), py - 3 - hop, 1, 1, '#ffffff');
    } else if (a.k === 'd') {
      R(c, px - 4, py, 8, 1, 'rgba(0,0,0,0.18)');
      R(c, px - 3, py - 3, 1, 3 - step, '#7a4f28'); R(c, px - 1, py - 3, 1, 2 + step, '#7a4f28');
      R(c, px + 1, py - 3, 1, 3 - step, '#7a4f28'); R(c, px + 3, py - 3, 1, 2 + step, '#7a4f28');
      R(c, px - 4, py - 7, 8, 4, '#a9743f'); R(c, px - 3, py - 4, 6, 1, '#c79a66');
      R(c, px - 2, py - 6, 1, 1, '#e6cfa6'); R(c, px + 1, py - 7, 1, 1, '#e6cfa6');
      R(c, px + (d > 0 ? 3 : -5), py - 10, 2, 4, '#a9743f');
      R(c, px + (d > 0 ? 4 : -7), py - 11, 3, 2, '#a9743f');
      R(c, px + (d > 0 ? 4 : -5), py - 13, 1, 2, '#e0d2b4'); R(c, px + (d > 0 ? 6 : -7), py - 13, 1, 2, '#e0d2b4');
      R(c, px + (d > 0 ? -5 : 4), py - 7, 1, 2, '#ffffff');
    } else if (a.k === 'w') {
      R(c, px - 5, py, 10, 1, 'rgba(0,0,0,0.25)');
      R(c, px - 4, py - 3, 1, 3 - step, '#4b4e57'); R(c, px - 2, py - 3, 1, 2 + step, '#4b4e57');
      R(c, px + 1, py - 3, 1, 3 - step, '#4b4e57'); R(c, px + 3, py - 3, 1, 2 + step, '#4b4e57');
      R(c, px - 5, py - 7, 9, 4, '#6a6e79'); R(c, px - 4, py - 4, 7, 1, '#8b8f9a');
      R(c, px + (d > 0 ? 3 : -6), py - 9, 3, 4, '#6a6e79'); R(c, px + (d > 0 ? 6 : -8), py - 7, 2, 2, '#6a6e79');
      R(c, px + (d > 0 ? 3 : -4), py - 10, 1, 1, '#4b4e57'); R(c, px + (d > 0 ? 5 : -6), py - 10, 1, 1, '#4b4e57');
      R(c, px + (d > 0 ? 5 : -6), py - 8, 1, 1, '#ffe14a');
      R(c, px + (d > 0 ? -7 : 5), py - 7, 2, 1, '#4b4e57');
    } else if (a.k === 's') {
      R(c, px - 4, py, 8, 1, 'rgba(0,0,0,0.18)');
      R(c, px - 3, py - 2, 1, 2, '#3a3330'); R(c, px + 2, py - 2, 1, 2, '#3a3330');
      R(c, px - 4, py - 6, 8, 5, '#f1eee6'); R(c, px - 3, py - 7, 6, 1, '#f1eee6'); R(c, px - 3, py - 2, 6, 1, '#d9d5ca');
      R(c, px + (d > 0 ? 3 : -5), py - 6 + (!a.moving && Math.floor(t + a.id) % 5 === 0 ? 2 : 0), 2, 3, '#3a3330');
    } else {
      const peck = !a.moving && Math.floor(t * 2 + a.id) % 4 === 0 ? 2 : 0;
      R(c, px - 2, py, 4, 1, 'rgba(0,0,0,0.16)');
      R(c, px - 1, py - 1, 1, 1, '#e9b53a'); R(c, px + 1, py - 1, 1, 1, '#e9b53a');
      R(c, px - 2, py - 4, 4, 3, '#f5f0e6'); R(c, px + (d > 0 ? -3 : 2), py - 5, 1, 2, '#e3ddcf');
      R(c, px + (d > 0 ? 1 : -2), py - 6 + peck, 2, 2, '#f5f0e6');
      R(c, px + (d > 0 ? 1 : -1), py - 7 + peck, 1, 1, '#d8413f');
      R(c, px + (d > 0 ? 3 : -3), py - 5 + peck, 1, 1, '#e9b53a');
    }
  }

  // A tile on fire: three licks of flame and a thread of smoke.
  function flame(c, f, t) {
    const ox = f[0] * T, oy = f[1] * T;
    for (let i = 0; i < 3; i++) {
      const ph = t * 9 + i * 2.1 + hash(f[0], f[1]) * 6;
      const h = 6 + Math.floor((Math.sin(ph) + 1) * 3) + (i === 1 ? 3 : 0);
      const x = ox + 2 + i * 4;
      R(c, x, oy + T - h, 4, h, '#e2531c');
      R(c, x + 1, oy + T - h + 2, 2, Math.max(1, h - 3), '#f6a623');
      if (h > 7) R(c, x + 1, oy + T - h + 4, 1, h - 6, '#ffe58a');
    }
    for (let i = 0; i < 3; i++) {
      const rise = (t * 14 + i * 9 + hash(f[0], f[1]) * 20) % 26;
      R(c, ox + 5 + Math.round(Math.sin(t * 2 + i) * 3), oy - 2 - Math.floor(rise), 3, 3, `rgba(70,66,62,${0.5 - rise / 60})`);
    }
  }

  // Birds are just for show: they hop between treetops and sleep at night.
  const birds = [];
  function updateBirds(t, dt, dark) {
    const trees = world.objects.filter((o) => o[0] === 't');
    if (!trees.length) return;
    const perch = () => { const o = trees[Math.floor(Math.random() * trees.length)]; return [o[1] * T + 4 + Math.random() * 8, o[2] * T - 4 + Math.random() * 6]; };
    while (birds.length < 7) { const [x, y] = perch(); birds.push({ x, y, tx: x, ty: y, sx: x, sy: y, fly: 0, wait: Math.random() * 12, color: ['#33343d', '#c8433c', '#3d6fb5', '#33343d'][birds.length % 4] }); }
    for (const b of birds) {
      if (b.fly > 0) {
        const dist = Math.hypot(b.tx - b.sx, b.ty - b.sy) || 1;
        b.fly = Math.max(0, b.fly - (dt * 75) / dist);
        const k = 1 - b.fly;
        b.x = b.sx + (b.tx - b.sx) * k;
        b.y = b.sy + (b.ty - b.sy) * k - Math.sin(k * Math.PI) * Math.min(22, dist * 0.2);
        const flap = Math.floor(t * 12) % 2;
        R(pc, b.x - 3, b.y - (flap ? 2 : 0), 2, 1, b.color); R(pc, b.x + 1, b.y - (flap ? 2 : 0), 2, 1, b.color);
        R(pc, b.x - 1, b.y - 1, 2, 2, b.color);
      } else {
        R(pc, b.x - 1, b.y - 1, 2, 2, b.color); R(pc, b.x + (b.tx >= b.sx ? 1 : -2), b.y - 1, 1, 1, '#e9b53a');
        b.wait -= dt;
        if (b.wait <= 0 && dark < 0.3) { [b.tx, b.ty] = perch(); b.sx = b.x; b.sy = b.y; b.fly = 1; b.wait = 4 + Math.random() * 16; }
      }
    }
  }

  // ---------- light ----------

  function darkness(t) {
    if (t < 0.03) return 0.62;
    if (t < 0.09) return 0.62 * (1 - (t - 0.03) / 0.06);
    if (t < 0.72) return 0;
    if (t < 0.82) return (0.62 * (t - 0.72)) / 0.1;
    return 0.62;
  }

  function nightfall(state, t, dark) {
    const time = state.time;
    const warm = time > 0.64 && time < 0.8 ? Math.sin(((time - 0.64) / 0.16) * Math.PI) * 0.14 : time < 0.12 ? Math.sin((time / 0.12) * Math.PI) * 0.1 : 0;
    if (warm > 0.005) { pc.fillStyle = `rgba(255,150,70,${warm})`; pc.fillRect(0, 0, pix.width, pix.height); }
    if (dark <= 0.01) return;
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, light.width, light.height);
    lc.fillStyle = `rgba(10,16,48,${dark})`;
    lc.fillRect(0, 0, light.width, light.height);
    lc.globalCompositeOperation = 'destination-out';
    const glow = (x, y, r, strength = 1) => {
      const g = lc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const f of state.fire || []) glow(f[0] * T + 8, f[1] * T + 6, 40 + Math.sin(t * 13 + f[0]) * 4, 0.9);
    for (const s of world.structures) {
      if (s.p < 1) continue;
      const cx = (s.x + s.w / 2) * T, cy = (s.y + s.h / 2) * T;
      if (s.type === 'campfire') glow(cx, cy, 58 + Math.sin(t * 11) * 3, 0.95);
      else if (s.type === 'lantern') glow(cx, cy - 6, 34, 0.9);
      else if (s.type === 'house') glow(cx, cy + 4, 30, 0.7);
      else if (s.type === 'chapel') glow(cx, cy, 34, 0.7);
      else if (s.type === 'market' || s.type === 'workshop') glow(cx, cy, 22, 0.4);
    }
    pc.drawImage(light, 0, 0);
  }

  // ---------- one frame ----------

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return dpr;
  }

  function wrap(text, max) {
    const words = String(text).split(/\s+/), lines = [];
    let line = '';
    for (const w of words) {
      if (ctx.measureText(line + ' ' + w).width > max && line) { lines.push(line); line = w; }
      else line = line ? line + ' ' + w : w;
    }
    if (line) lines.push(line);
    if (lines.length > 11) { lines.length = 11; lines[10] = lines[10].replace(/.{0,3}$/, '...'); }
    return lines;
  }

  function draw(state, t, selectedId) {
    const dpr = resize();
    ctx.fillStyle = '#17201b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!world || !state) return;

    colors = {};
    for (const v of state.v) colors[v.id] = v.shirt;
    const progress = new Map(state.b || []);
    const dark = darkness(state.time);

    pc.imageSmoothingEnabled = false;
    pc.drawImage(groundCanvas, 0, 0);

    // water shimmer
    for (let i = 0; i < ground.length; i++) {
      if (ground[i] !== 1) continue;
      const x = i % world.W, y = Math.floor(i / world.W);
      const ph = Math.floor(t * 1.5 + hash(x, y) * 6) % 6;
      if (ph < 2) R(pc, x * T + 3 + ph * 4, y * T + 5 + Math.floor(hash2(x, y, 5) * 6), 4, 1, 'rgba(255,255,255,0.22)');
    }

    // burned ground
    for (const [bx, by] of world.scorched || []) {
      R(pc, bx * T, by * T, T, T, 'rgba(28,22,18,0.62)');
      if (hash(bx, by) > 0.5) R(pc, bx * T + 4 + Math.floor(hash2(bx, by, 2) * 7), by * T + 9, 2, 5, 'rgba(15,12,10,0.8)');
    }
    // flood water over the low ground
    if (state.dz && state.dz[0] === 'flood') {
      for (let i = 0; i < ground.length; i++) {
        if (ground[i] === 1) continue;
        const x = i % world.W, y = Math.floor(i / world.W);
        let near = 9;
        for (let dy = -3; dy <= 3 && near > 1; dy++) for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= world.W || yy >= world.H) continue;
          if (ground[yy * world.W + xx] === 1) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
        }
        if (near > 3) continue;
        R(pc, x * T, y * T, T, T, `rgba(86,124,150,${near === 1 ? 0.78 : near === 2 ? 0.6 : 0.38})`);
        if (Math.floor(t * 1.2 + hash(x, y) * 6) % 6 < 2) R(pc, x * T + 3, y * T + 6 + Math.floor(hash2(x, y, 5) * 5), 5, 1, 'rgba(255,255,255,0.2)');
      }
    }

    // everything that stands up, sorted so nearer things overlap farther ones
    const things = [];
    for (const o of world.objects) things.push({ y: o[2] + 1, o });
    for (const s of world.structures) {
      if (s.type === 'farm' || s.type === 'garden' || s.type === 'coop' || s.type === 'pen') continue;
      const p = progress.has(s.id) ? progress.get(s.id) : s.p;
      things.push({ y: s.y + s.h, s: { ...s, p } });
    }
    for (const v of state.v) if (!v.inside && !v.away) things.push({ y: v.ry + 0.3, v });
    for (const a of state.an || []) things.push({ y: a.ry + 0.25, a });
    for (const f of state.fire || []) things.push({ y: f[1] + 1.05, f });
    things.sort((a, b) => a.y - b.y);
    for (const th of things) {
      if (th.o) ({ t: tree, r: rock, c: clay, g: reeds }[th.o[0]] || bush)(pc, th.o);
      else if (th.s) structure(pc, th.s, t, dark);
      else if (th.a) {
        if (th.a.young) {
          // the young are drawn smaller, standing on the same spot
          const ax = Math.round(th.a.rx * T), ay = Math.round(th.a.ry * T) + 3;
          pc.save(); pc.translate(ax, ay); pc.scale(0.66, 0.66); pc.translate(-ax, -ay);
          animal(pc, th.a, t);
          pc.restore();
        } else animal(pc, th.a, t);
      }
      else if (th.f) flame(pc, th.f, t);
      else person(pc, th.v, t, th.v.id === selectedId);
    }
    updateBirds(t, Math.min(0.1, Math.max(0, t - cam.last)), dark);

    nightfall(state, t, dark);
    // wolf eyes show through the dark
    if (dark > 0.2) for (const a of state.an || []) if (a.k === 'w') { const d = a.dir > 0 ? 1 : -1; R(pc, Math.round(a.rx * T) + (d > 0 ? 5 : -6), Math.round(a.ry * T) + 3 - 8, 1, 1, '#ffe14a'); }
    const wx = state.wx || '';
    if ((state.fire || []).length) { pc.fillStyle = 'rgba(190,80,20,0.07)'; pc.fillRect(0, 0, pix.width, pix.height); }
    if (state.dz && state.dz[0] === 'drought') { pc.fillStyle = 'rgba(214,170,70,0.16)'; pc.fillRect(0, 0, pix.width, pix.height); }
    if (wx === 'hot') { pc.fillStyle = 'rgba(255,190,90,0.10)'; pc.fillRect(0, 0, pix.width, pix.height); }
    if (wx === 'rain' || wx === 'storm') {
      pc.fillStyle = wx === 'storm' ? 'rgba(18,24,44,0.34)' : 'rgba(40,52,74,0.16)';
      pc.fillRect(0, 0, pix.width, pix.height);
      const area = (pix.width * pix.height) / (704 * 480);
      const n = Math.round((wx === 'storm' ? 230 : 120) * area), slant = wx === 'storm' ? 5 : 2, speed = wx === 'storm' ? 230 : 150;
      for (let i = 0; i < n; i++) {
        const x0 = (hash(i, 5) * (pix.width + 60) + t * speed * 0.35) % (pix.width + 60) - 30;
        const y0 = (hash(i, 9) * pix.height + t * speed * (0.8 + hash(i, 2) * 0.5)) % pix.height;
        for (let k = 0; k < 4; k++) R(pc, Math.round(x0 + (k * slant) / 4), Math.round(y0 + k), 1, 1, 'rgba(190,210,235,0.55)');
      }
      // lightning: a rare white flash
      if (wx === 'storm' && Math.sin(t * 0.9) > 0.985 && Math.sin(t * 37) > 0.2) { pc.fillStyle = 'rgba(255,255,255,0.5)'; pc.fillRect(0, 0, pix.width, pix.height); }
    }
    if (wx === 'fog') {
      pc.fillStyle = 'rgba(226,230,232,0.34)';
      pc.fillRect(0, 0, pix.width, pix.height);
      for (let i = 0; i < Math.round(9 * (pix.width * pix.height) / (704 * 480)); i++) {
        const fx = ((hash(i, 21) * pix.width + t * (3 + hash(i, 4) * 5)) % (pix.width + 160)) - 80, fy = hash(i, 23) * pix.height;
        R(pc, fx, fy, 120 + hash(i, 6) * 80, 10 + hash(i, 8) * 10, 'rgba(240,243,245,0.20)');
      }
    }
    if (season === 'winter' || wx === 'snow' || wx === 'blizzard') {
      const bl = wx === 'blizzard';
      if (bl) { pc.fillStyle = 'rgba(236,241,245,0.42)'; pc.fillRect(0, 0, pix.width, pix.height); }
      const n = Math.round((bl ? 420 : wx === 'snow' ? 150 : 28) * (pix.width * pix.height) / (704 * 480)), drift = bl ? 90 : 4;
      for (let i = 0; i < n; i++) {
        const sx0 = (hash(i, 7) * pix.width + Math.sin(t * 0.7 + i) * 6 + t * drift) % pix.width;
        const sy0 = (hash(i, 13) * pix.height + t * (14 + hash(i, 3) * 18) * (bl ? 2.2 : 1)) % pix.height;
        R(pc, sx0, sy0, bl && i % 3 === 0 ? 2 : 1, 1, 'rgba(255,255,255,0.85)');
      }
    }

    // scale the little picture up to fill the window, keeping the pixels crisp
    const fit = Math.min(canvas.width / pix.width, canvas.height / pix.height);
    const dtc = Math.min(0.1, Math.max(0, t - cam.last));
    cam.last = t;
    if (cam.auto) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const grow = (ax, ay, bx, by) => { x0 = Math.min(x0, ax); y0 = Math.min(y0, ay); x1 = Math.max(x1, bx); y1 = Math.max(y1, by); };
      const focus = state.v.find((v) => v.id === selectedId && !v.away);
      if (focus) grow(focus.rx - 6, focus.ry - 4.5, focus.rx + 6, focus.ry + 4.5);
      else {
        for (const v of state.v) if (!v.away) grow(v.rx - 5, v.ry - 5, v.rx + 5, v.ry + 4);
        for (const s of world.structures) grow(s.x - 3, s.y - 4, s.x + s.w + 3, s.y + s.h + 3);
      }
      const bw = Math.max(8, x1 - x0) * T, bh = Math.max(6, y1 - y0) * T;
      const zt = Math.max(1, Math.min((3.4 * dpr) / fit, Math.min(canvas.width / (bw * fit), canvas.height / (bh * fit))));
      const tx = ((x0 + x1) / 2) * T, ty = ((y0 + y1) / 2) * T;
      if (!cam.ready) { cam.z = zt; cam.cx = tx; cam.cy = ty; cam.ready = true; }
      const k = Math.min(1, dtc * 1.6);
      cam.z += (zt - cam.z) * k; cam.cx += (tx - cam.cx) * k; cam.cy += (ty - cam.cy) * k;
    }
    const scale = fit * cam.z;
    // keep the camera inside the world
    const halfW = canvas.width / scale / 2, halfH = canvas.height / scale / 2;
    cam.cx = halfW * 2 >= pix.width ? pix.width / 2 : Math.max(halfW, Math.min(pix.width - halfW, cam.cx));
    cam.cy = halfH * 2 >= pix.height ? pix.height / 2 : Math.max(halfH, Math.min(pix.height - halfH, cam.cy));
    const ox = Math.round(canvas.width / 2 - cam.cx * scale), oy = Math.round(canvas.height / 2 - cam.cy * scale);
    view = { scale: scale / dpr, ox: ox / dpr, oy: oy / dpr };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pix, ox, oy, pix.width * scale, pix.height * scale);

    // names, speech and little status marks, drawn sharp at full resolution
    const sx = (x) => ox + x * T * scale, sy = (y) => oy + y * T * scale;
    const fs = Math.max(10, Math.round(11 * dpr));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const homes = {};
    for (const v of state.v) if (v.inside && v.home) homes[v.home] = (homes[v.home] || 0) + 1;
    for (const s of world.structures) {
      if (!homes[s.id]) continue;
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const drift = (t * 0.6) % 1;
      ctx.globalAlpha = 1 - drift;
      ctx.fillText('z', sx(s.x + s.w / 2 + 0.6), sy(s.y - 0.9 - drift * 0.8));
      ctx.globalAlpha = 1;
    }

    const placed = [];
    for (const v of state.v) {
      if (v.inside || v.away) continue;
      const x = sx(v.rx), top = sy(v.ry) - (v.st === 'child' ? 8 : 12) * scale;
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(20,24,20,0.85)';
      ctx.strokeText(v.name, x, sy(v.ry) + 9 * scale);
      ctx.fillStyle = v.id === selectedId ? '#fff3b0' : '#ffffff';
      ctx.fillText(v.name, x, sy(v.ry) + 9 * scale);

      if (v.bubble) {
        ctx.font = `${Math.round(12 * dpr)}px system-ui, sans-serif`;
        const lines = wrap(v.bubble, (v.bubble.length > 400 ? 360 : v.bubble.length > 240 ? 300 : v.bubble.length > 120 ? 230 : 190) * dpr);
        const lh = 15 * dpr, pad = 7 * dpr;
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2, bh = lines.length * lh + pad * 1.6;
        let bx = Math.max(4, Math.min(canvas.width - bw - 4, x - bw / 2));
        let by = top - bh - 8 * dpr;
        // if two people are talking side by side, lift one bubble above the other
        for (const p of placed) if (bx < p.x + p.w && bx + bw > p.x && by < p.y + p.h && by + bh > p.y) by = p.y - bh - 4 * dpr;
        if (by < 4) by = sy(v.ry) + 18 * scale;
        placed.push({ x: bx, y: by, w: bw, h: bh });
        ctx.fillStyle = 'rgba(255,253,244,0.97)';
        ctx.strokeStyle = '#3b2f20';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 7 * dpr);
        ctx.fill(); ctx.stroke();
        if (by < top) {
          const tipY = Math.min(by + bh + 6 * dpr, top - 2 * dpr) < by + bh ? by + bh + 6 * dpr : top - 2 * dpr;
          ctx.beginPath(); ctx.moveTo(x - 5 * dpr, by + bh - 1); ctx.lineTo(x, tipY); ctx.lineTo(x + 5 * dpr, by + bh - 1);
          ctx.fillStyle = 'rgba(255,253,244,0.97)'; ctx.fill(); ctx.stroke();
          ctx.fillRect(x - 5 * dpr + 1, by + bh - 2 * dpr, 10 * dpr - 2, 2.5 * dpr);
        }
        ctx.fillStyle = '#2a2019';
        lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, by + pad * 0.8 + lh * (i + 0.5)));
      } else if (v.doing) {
        ctx.font = `italic ${Math.round(11 * dpr)}px Georgia, serif`;
        const text = v.doing.length > 44 ? v.doing.slice(0, 42) + '...' : v.doing;
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = 'rgba(20,24,20,0.8)';
        ctx.strokeText(text, x, top - 7 * dpr);
        ctx.fillStyle = '#fff6d6';
        ctx.fillText(text, x, top - 7 * dpr);
      } else if (v.sleeping) {
        ctx.font = `700 ${fs}px system-ui, sans-serif`;
        const drift = (t * 0.6 + v.id * 0.3) % 1;
        ctx.globalAlpha = 1 - drift;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('z', x + 8 * scale, sy(v.ry) - (4 + drift * 10) * scale);
        ctx.globalAlpha = 1;
      } else if (v.thinking) {
        const n = Math.floor(t * 3) % 3;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x + (i - 1) * 5 * dpr, top - 6 * dpr, (i === n ? 2.4 : 1.6) * dpr, 0, Math.PI * 2);
          ctx.fillStyle = i === n ? '#ffffff' : 'rgba(255,255,255,0.6)';
          ctx.fill();
        }
      }
    }
  }

  // Turn a mouse position into a place in the world.
  function toTile(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - view.ox) / (T * view.scale), y: (clientY - r.top - view.oy) / (T * view.scale) };
  }

  // Manual camera: zooming or dragging takes over from the automatic framing.
  function zoomAt(clientX, clientY, factor) {
    const before = toTile(clientX, clientY);
    cam.auto = false;
    cam.z = Math.max(1, Math.min(6, cam.z * factor));
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.min(canvas.width / pix.width, canvas.height / pix.height);
    const scale = (fit * cam.z) / dpr;
    cam.cx = before.x * T - (clientX - r.left - r.width / 2) / scale;
    cam.cy = before.y * T - (clientY - r.top - r.height / 2) / scale;
  }
  function panBy(dx, dy) {
    cam.auto = false;
    cam.cx -= dx / view.scale;
    cam.cy -= dy / view.scale;
  }
  function setAuto(on) { cam.auto = on; }

  return { setWorld, draw, toTile, zoomAt, panBy, setAuto, get auto() { return cam.auto; }, get world() { return world; } };
}
