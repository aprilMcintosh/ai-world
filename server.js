// AI World server. No dependencies: just Node.
//
//   node server.js         start (or resume) the world
//   node server.js --new   wipe the saved world and begin again
//
// The world runs here, not in the browser, so it keeps living whether or not
// anyone is watching. Open the page from any browser to look in on it.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Sim } from './sim/sim.js';
import { LLM } from './sim/llm.js';
import { Brain } from './sim/brain.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const SAVE = path.join(DATA, 'world.json');

// ---------- config ----------

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  }
  return out;
}
const readJSON = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

let config = readJSON(path.join(ROOT, 'config.json'));
if (!config) { console.error('config.json is missing or is not valid JSON.'); process.exit(1); }
config = merge(config, readJSON(path.join(ROOT, 'config.local.json')) || {});
if (process.env.PORT) config.port = Number(process.env.PORT);

// ---------- world ----------

const fresh = process.argv.includes('--new');
const saved = fresh ? null : readJSON(SAVE);
const sim = new Sim(config, saved);
const llm = new LLM(config.llm);
const brain = new Brain(sim, llm);
sim.brain = brain;

function save() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const tmp = SAVE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(sim.toJSON()));
    fs.renameSync(tmp, SAVE);
  } catch (e) {
    console.error('Could not save the world:', e.message);
  }
}

// ---------- live updates to browsers ----------

const clients = new Set();
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (event, data) => { for (const res of clients) send(res, event, data); };
sim.onFeed = (event, item) => broadcast(event, item);

let sentVersion = 0;
setInterval(() => {
  // One bad moment should never end the world: log it and keep going.
  try { sim.tick(0.1); } catch (e) { console.error('Something went wrong in the world, carrying on:', e); }
}, 100);
process.on('unhandledRejection', (e) => console.error('Something went wrong in a thought, carrying on:', e));
setInterval(() => {
  if (!clients.size) return;
  if (sim.worldVersion !== sentVersion) { sentVersion = sim.worldVersion; broadcast('world', sim.worldState()); }
  broadcast('tick', { ...sim.tickState(), brain: { ...llm.info(), tally: brain.tally || null } });
}, 200);
setInterval(() => { if (!llm.online) llm.probe(); }, 20000);
setInterval(save, 30000);

// ---------- http ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    send(res, 'world', sim.worldState());
    send(res, 'history', { feed: sim.feed.slice(-80), chronicle: sim.chronicle });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/villager') {
    const d = sim.detail(Number(url.searchParams.get('id')));
    res.writeHead(d ? 200 : 404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(d || {}));
  }

  if (url.pathname === '/api/control' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.paused === 'boolean') sim.paused = body.paused;
    if ([1, 2, 3].includes(body.speed)) sim.speed = body.speed;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ paused: sim.paused, speed: sim.speed }));
  }

  // static files
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${config.port} is already in use. Is AI World already running? Otherwise change "port" in config.json.`);
  else console.error(e.message);
  process.exit(1);
});

await llm.probe();

server.listen(config.port, config.host, () => {
  console.log('');
  console.log('  AI World is running.');
  console.log(`  Watch it here:  http://localhost:${config.port}`);
  if (config.host === '0.0.0.0') {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) console.log(`  From another device on your wifi:  http://${lan.address}:${config.port}`);
  }
  console.log('');
  console.log(saved ? `  Resumed the saved world on day ${sim.day}.` : '  A new world has begun.');
  if (llm.online) {
    if (llm.two) console.log(`  Minds: ${llm.big.model} for talk, speeches, diaries and ideas. ${llm.small.model}${llm.small.baseUrl ? ` on ${llm.small.baseUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, '')}` : ''} for everyday choices. (${config.llm.provider})`);
    else console.log(`  Minds: ${llm.model} (${config.llm.provider})`);
    if (llm.aside) console.log(`  ${llm.aside}`);
  } else {
    console.log('  Minds: instinct mode. They will live and build, but not really think or talk yet.');
    console.log(`  Why: ${llm.error}`);
  }
  console.log('');
  console.log('  Press Ctrl+C to stop. The world is saved automatically.');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { save(); console.log('\n  World saved. Goodbye.\n'); process.exit(0); });
}
