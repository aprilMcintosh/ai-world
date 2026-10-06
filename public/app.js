// The watching side. It listens to the server, keeps the sidebar up to date,
// and hands the latest state to the renderer every frame.

import { createRenderer } from './render.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#view');
const renderer = createRenderer(canvas);

let state = null;        // latest tick from the server
let selected = null;     // villager id
const smooth = new Map(); // id -> { rx, ry } positions eased toward the real ones
let chronicle = [];
let lastBrain = '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- connection ----------

const events = new EventSource('/events');
events.onopen = () => { $('#offline').hidden = true; };
events.onerror = () => { $('#offline').hidden = false; };

events.addEventListener('world', (e) => { const w = JSON.parse(e.data); renderer.setWorld(w); drawKnown(w); drawFamily(w); });

// ---------- the family tree ----------

// A drawn tree: one row per generation, a card per person, lines from each couple down to their children.
// Everyone descends from the first two and kin marry kin, so a person can belong in two places at once.
// Each person gets one main card, under their parents. Beside the elder partner of a couple there is a
// second, dashed card for the other one, and that couple's children hang beneath the pair.
const CW = 128, CH = 56, SG = 22, HG = 16, VG = 60;
let famScale = 1, famSize = [0, 0], famRoot = 0;

function drawFamily(w) {
  const fam = w.family;
  if (!fam) return;
  const P = new Map(fam.people.map((p) => [p.id, p]));
  const ck = (a, b) => (a < b ? `${a}+${b}` : `${b}+${a}`);
  const kids = new Map();
  const put = (k, c) => { if (!kids.has(k)) kids.set(k, []); kids.get(k).push(c); };
  for (const p of fam.people) if (p.parents.length === 2) put(ck(p.parents[0], p.parents[1]), p);
  for (const st of fam.still || []) if (st.parents.length === 2) put(ck(st.parents[0], st.parents[1]), { still: true, g: st.gender, born: st.day });
  for (const list of kids.values()) list.sort((a, b) => a.born - b.born || (a.id || 0) - (b.id || 0));
  const mates = new Map();
  for (const [a, b, bToA, aToB, together] of fam.couples || []) {
    for (const [x, y, rel] of [[a, b, bToA], [b, a, aToB]]) { if (!mates.has(x)) mates.set(x, []); mates.get(x).push({ id: y, rel, together }); }
  }

  // ----- build the tree of family units
  const placed = new Set();
  // a child already drawn beside a brother or sister does not get a second place in the row
  const buildKids = (list, depth) => {
    const out = [];
    for (const c of list) { if (c.still || !placed.has(c.id)) out.push(build(c, depth)); }
    return out;
  };
  const build = (p, depth) => {
    const node = { p, depth, spouses: [], elsewhere: [], w: CW, unitW: CW };
    if (p.still) return node;
    placed.add(p.id);
    const list = (mates.get(p.id) || []).slice().sort((x, y) => ((kids.get(ck(p.id, x.id)) || [{ born: 1e9 }])[0].born) - ((kids.get(ck(p.id, y.id)) || [{ born: 1e9 }])[0].born));
    for (const mt of list) {
      const m = P.get(mt.id);
      if (!m) continue;
      if (p.id < m.id || !m.parents.length) {
        if (!m.parents.length) placed.add(m.id);
        // a brother and sister who pair are drawn once, side by side, each with a line up to their parents
        const sibling = m.parents.length === 2 && p.parents.length === 2 && ck(m.parents[0], m.parents[1]) === ck(p.parents[0], p.parents[1]) && (mates.get(m.id) || []).length === 1;
        if (sibling) placed.add(m.id);
        node.spouses.push({ m, rel: mt.rel, merged: sibling, parted: p.alive && m.alive && !mt.together, kids: buildKids(kids.get(ck(p.id, m.id)) || [], depth + 1) });
      } else node.elsewhere.push(m);
    }
    node.unitW = CW + node.spouses.length * (CW + SG);
    const all = node.spouses.flatMap((s) => s.kids);
    node.kidsW = all.reduce((n, k) => n + k.w, 0) + Math.max(0, all.length - 1) * HG;
    node.w = Math.max(node.unitW, node.kidsW);
    return node;
  };
  const roots = fam.people.filter((p) => !p.parents.length).sort((a, b) => (b.founder ? 1 : 0) - (a.founder ? 1 : 0) || a.id - b.id);
  const trees = [], loners = [];
  for (const r of roots) {
    if (placed.has(r.id)) continue;
    if (r.founder || (mates.get(r.id) || []).length) trees.push(build(r, 0)); else { placed.add(r.id); loners.push(r); }
  }

  // ----- place and draw
  const cards = [], lines = [];
  let maxDepth = 0;
  const yrs = (d) => (d < 1 ? '' : `Year ${d}`);
  const card = (p, x, y, opts = {}) => {
    if (p.still) return cards.push(`<div class="pc still" style="left:${x + 18}px;top:${y + 8}px;width:${CW - 36}px"><i>born still</i><small>Year ${p.born}</small></div>`);
    const sex = p.g === 'f' ? 'F' : 'M';
    const l2 = p.alive ? `${sex} ${p.yrs}${p.child ? ' · child' : ''}${p.away ? ' · away' : ''}` : p.born < 1 || p.founder ? `died Year ${p.died}, age ${p.yrs}` : `Year ${p.born}–${p.died}, age ${p.yrs}`;
    const l3 = p.alive ? (p.title || '') : (p.cause === 'childbirth' ? 'in childbirth' : p.cause || '');
    const tip = p.alive ? `${p.name}, ${p.g === 'f' ? 'woman' : 'man'}, ${p.yrs}` : `${p.name} died in Year ${p.died}, aged ${p.yrs}, ${p.cause === 'childbirth' ? 'in childbirth' : 'of ' + p.cause}`;
    cards.push(`<div class="pc ${p.alive ? 'alive' : 'dead'} ${p.g === 'f' ? 'f' : 'm'} ${opts.again ? 'again' : ''}" data-id="${p.id}" ${opts.again ? `data-jump="${p.id}"` : `id="pc${p.id}"`} title="${esc(tip)}" style="left:${x}px;top:${y}px;width:${CW}px;height:${CH}px"><b>${esc(p.name)}${p.alive ? '' : ' <span class="x">&dagger;</span>'}</b><small>${esc(l2)}</small><em>${esc(l3)}</em></div>`);
    if (opts.caption) cards.push(`<div class="cap" style="left:${x - 8}px;top:${y + CH + 2}px;width:${CW + 16}px">${esc(opts.caption)}</div>`);
  };
  const place = (node, x0, y0) => {
    maxDepth = Math.max(maxDepth, node.depth);
    const y = y0 + node.depth * (CH + VG);
    const ux = x0 + (node.w - node.unitW) / 2;
    card(node.p, ux, y, { caption: node.elsewhere.length ? `with ${node.elsewhere.map((m) => m.name).join(', ')}` : '' });
    node.cx = ux + CW / 2;
    let kx = x0 + (node.w - (node.kidsW || 0)) / 2;
    node.spouses.forEach((s, i) => {
      const sx = ux + (i + 1) * (CW + SG);
      const again = s.m.parents.length > 0 && !s.merged;
      if (s.merged) (node.also = node.also || []).push(sx + CW / 2);
      card(s.m, sx, y, { again, caption: `${s.rel ? `${node.p.g === 'f' ? 'her' : 'his'} ${s.rel}` : ''}${s.parted ? `${s.rel ? ', ' : ''}parted` : ''}` });
      // the bond between the two
      const bx = sx - SG, by = y + CH / 2;
      lines.push(`<line x1="${bx}" y1="${by}" x2="${sx}" y2="${by}" class="bond${s.parted ? ' parted' : ''}"/>`);
      if (!s.kids.length) return;
      const mid = bx + SG / 2, barY = y + CH + VG - 18;
      const xs = [];
      for (const k of s.kids) { place(k, kx, y0); xs.push(k.cx, ...(k.also || [])); kx += k.w + HG; }
      lines.push(`<path d="M${mid} ${by} V${barY} M${Math.min(mid, xs[0])} ${barY} H${Math.max(mid, xs[xs.length - 1])}" class="desc"/>`);
      for (const cx of xs) lines.push(`<path d="M${cx} ${barY} V${y + CH + VG}" class="desc"/>`);
    });
  };
  const GUT = 132;
  let x = GUT;
  for (const t of trees) { place(t, x, 24); x += t.w + 60; }
  const W = Math.max(320, x - 60 + 24);
  famRoot = trees.length ? trees[0].cx : W / 2;
  let H = 24 + (maxDepth + 1) * (CH + VG);
  let extra = '';
  if (loners.length) {
    extra = `<div class="rowlabel" style="left:${GUT}px;top:${H}px">Others who lived here</div>`;
    loners.forEach((p, i) => card(p, GUT + i * (CW + HG), H + 22));
    H += 22 + CH + 24;
  }
  for (let d = 0; d <= maxDepth; d++) extra += `<div class="gen" style="top:${24 + d * (CH + VG) + CH / 2 - 7}px">${['The first two', 'Their children', 'Grandchildren', 'Great-grandchildren'][d] || `${'Great-'.repeat(d - 2)}grandchildren`}</div>`;
  famSize = [W, H];
  $('#treeSizer').innerHTML = `<div id="treeInner" style="width:${W}px;height:${H}px"><svg width="${W}" height="${H}">${lines.join('')}</svg>${extra}${cards.join('')}</div>`;
  applyFamScale();

  // ----- the sidebar: a short summary and the roll of the dead
  const living = fam.people.filter((p) => p.alive), dead = fam.people.filter((p) => !p.alive).sort((a, b) => b.died - a.died);
  const first = roots.filter((r) => r.founder).map((r) => r.name).join(' and ');
  $('#family').innerHTML = `
    <div class="daymark">The family of ${esc(first || 'the first two')}</div>
    <p class="famnote">${living.length} living, ${dead.length} gone, ${maxDepth + 1} generation${maxDepth ? 's' : ''}${(fam.still || []).length ? `, ${fam.still.length} born still` : ''}.</p>
    <p class="famnote">The tree is drawn over the map while this tab is open. Scroll or drag to move around it. Click a living person to open them.</p>
    <div class="legend"><span class="pc alive key">living</span><span class="pc dead key">died &dagger;</span><span class="pc alive again key">shown again beside a partner</span></div>
    <div class="daymark">Those who have died</div>
    ${dead.length ? dead.map((p) => `<div class="gone"><b>${esc(p.name)}</b> <small>Year ${p.died}, aged ${p.yrs}</small><br><span>${p.cause === 'childbirth' ? 'in childbirth' : esc(p.cause)}</span></div>`).join('') : '<div class="empty">Nobody yet.</div>'}`;
}

function fitFam() {
  const box = $('#treeBody');
  return Math.max(0.45, Math.min(1, (box.clientWidth - 8) / (famSize[0] || 1)));
}
function applyFamScale() {
  const inner = $('#treeInner');
  if (!inner) return;
  inner.style.transform = `scale(${famScale})`;
  $('#treeSizer').style.width = `${famSize[0] * famScale}px`;
  $('#treeSizer').style.height = `${famSize[1] * famScale}px`;
}
function showTree(on) {
  $('#tree').hidden = !on;
  if (on) {
    // open readable, with the first two in view; Fit shows the whole thing
    famScale = Math.max(0.8, fitFam());
    applyFamScale();
    const box = $('#treeBody');
    box.scrollTop = 0;
    box.scrollLeft = Math.max(0, famRoot * famScale - box.clientWidth / 2);
  }
}
$('#treeOut').addEventListener('click', () => { famScale = Math.max(0.35, famScale / 1.2); applyFamScale(); });
$('#treeIn').addEventListener('click', () => { famScale = Math.min(1.6, famScale * 1.2); applyFamScale(); });
$('#treeFit').addEventListener('click', () => { famScale = fitFam(); applyFamScale(); });
$('#treeClose').addEventListener('click', () => showTab('live'));
{
  // drag to pan
  const box = $('#treeBody');
  let drag = null;
  box.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop, moved: false }; });
  window.addEventListener('mousemove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; box.scrollLeft = drag.l - dx; box.scrollTop = drag.t - dy; });
  window.addEventListener('mouseup', () => { setTimeout(() => { drag = null; }, 0); });
  box.addEventListener('click', (e) => {
    if (drag && drag.moved) return;
    const c = e.target.closest('.pc');
    if (!c) return;
    if (c.dataset.jump) {
      // a second appearance: go to where this person sits in their own right
      const main = document.getElementById('pc' + c.dataset.jump);
      if (main) { main.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); main.classList.add('flash'); setTimeout(() => main.classList.remove('flash'), 1400); }
      return;
    }
    if (c.classList.contains('alive') && c.dataset.id) { const id = Number(c.dataset.id); if (selected === id) showTab('people'); else select(id); }
  });
}

// ---------- what they know ----------

function drawKnown(w) {
  const el = $('#known');
  const inv = (w.inventions || []).slice().reverse();
  const mats = (w.materials || []).slice().reverse();
  el.innerHTML = `
    <div class="age"><b>${esc(w.age || 'The Stone Age')}</b><p>${esc(w.ageLine || '')}</p></div>
    ${w.leader || (w.ways || []).length ? `<div class="daymark">The ways of this place</div>
    ${w.leader ? `<div class="known lead"><b>${esc(w.leader.name)}</b> <small>${esc(w.leader.title)}</small><p>Quarrels and broken ways are brought to ${esc(w.leader.name)}.</p></div>` : ''}
    ${(w.ways || []).filter((x) => x.kind === 'rule').slice().reverse().map((x) => `<div class="known way"><b>${esc(x.text)}</b><p class="does">Agreed ${x.yes} to ${x.no} in year ${x.day}, put by ${esc(x.by)}.${x.broken ? ` Broken ${x.broken} time${x.broken === 1 ? '' : 's'}.` : ''}</p></div>`).join('')}
    ${(w.ways || []).filter((x) => x.kind === 'belief').slice().reverse().map((x) => `<div class="known belief"><b>${esc(x.text)}</b><p class="does">Held true since year ${x.day}, first said by ${esc(x.by)}.</p></div>`).join('')}` : ''}
    <div class="daymark">What the valley gives</div>
    <div class="known"><p>${esc((w.raws || ['wood', 'stone', 'food']).join(', '))}</p></div>
    <div class="daymark">Materials they have learned to make</div>
    ${mats.length ? mats.map((m) => `<div class="known mat"><b>${esc(m.name[0].toUpperCase() + m.name.slice(1))}</b> <small>${esc(m.by)}, year ${m.day}</small><p>Made from ${esc(m.from)}${m.at ? ` at the ${esc(m.at)}` : ''}.</p>${m.what ? `<p class="does">${esc(m.what)}</p>` : ''}</div>`).join('') : '<div class="empty">Nothing yet. Everything is still made of what the valley gives as it is.</div>'}
    <div class="daymark">Invented here</div>
    ${inv.length ? inv.map((i) => `<div class="known inv"><b>The ${esc(i.name)}</b> <small>${i.kind === 'knowhow' ? 'know-how' : esc(i.kind)}, ${esc(i.by)}, year ${i.day}</small><p>${esc(i.what)}</p><p class="does">${i.uses ? `Made of ${esc(i.uses)}. ` : ''}${i.does && !/because someone wanted/.test(i.does) ? `It ${esc(i.does)}.` : ''}${i.tags ? ` <em>${esc(i.tags)}</em>` : ''}${i.built === null ? '' : i.kind === 'building' ? ` Built so far: ${i.built}.` : i.kind === 'tool' ? ` People who have one: ${i.built}.` : ''}</p></div>`).join('') : '<div class="empty">Nothing yet. An idea takes a few days of tries before it comes together.</div>'}
    <div class="daymark">Worked out along the way</div>
    ${(w.known || []).map((k) => `<div class="known"><b>${esc(k.name[0].toUpperCase() + k.name.slice(1))}</b>${k.gives ? `<p>${esc(/^Now/.test(k.gives) ? k.gives : 'Lets them build: ' + k.gives + '.')}</p>` : ''}</div>`).join('')}`;
}

events.addEventListener('history', (e) => {
  const h = JSON.parse(e.data);
  $('#live').innerHTML = '';
  talks.clear();
  for (const item of h.feed) addFeed(item, false);
  chronicle = h.chronicle;
  drawChronicle();
});

events.addEventListener('feed', (e) => addFeed(JSON.parse(e.data), true));
events.addEventListener('chronicle', (e) => { chronicle.push(JSON.parse(e.data)); drawChronicle(); });

events.addEventListener('tick', (e) => {
  state = JSON.parse(e.data);
  for (const v of state.v) {
    const s = smooth.get(v.id);
    if (!s || Math.hypot(s.rx - v.x, s.ry - v.y) > 4) smooth.set(v.id, { rx: v.x, ry: v.y });
  }
  const kinds = { r: 'r', d: 'd', s: 's', c: 'c', w: 'w' };
  state.an = (state.a || []).map(([id, k, x, y, dir, moving, young]) => {
    const key = 'a' + id;
    const s = smooth.get(key);
    if (!s || Math.hypot(s.rx - x, s.ry - y) > 4) smooth.set(key, { rx: x, ry: y });
    return { id, k: kinds[k], x, y, dir, moving, young: !!young };
  });
  updateHud();
  updateRoster();
});

// ---------- top bar ----------

function updateHud() {
  $('#day').textContent = `Year ${state.day}`;
  const SKY = { rain: 'rain', storm: 'storm', fog: 'fog', hot: 'fierce heat', snow: 'snow', bitter: 'killing cold', blizzard: 'blizzard' };
  $('#when').textContent = `${state.word}, ${state.season}${SKY[state.wx] ? ', ' + SKY[state.wx] : ''}`;
  const dz = state.dz, fire = (state.fire || []).length;
  const DZ = { drought: 'Drought', flood: 'Flood', plague: 'Sickness', blizzard: 'Blizzard', wildfire: 'Wildfire' };
  $('#danger').hidden = !dz && !fire;
  if (dz || fire) $('#danger').textContent = fire ? 'Fire' : dz[0] === 'plague' && dz[1] ? dz[1][0].toUpperCase() + dz[1].slice(1) : DZ[dz[0]] || dz[0];
  $('#ended').hidden = !state.ended;
  $('#era').textContent = state.era;
  $('#pop').textContent = `${state.v.length} ${state.v.length === 1 ? 'person' : 'people'}`;
  $('#store').hidden = !state.store;
  if (state.store) $('#store').textContent = `Storehouse: ${Object.entries(state.store).map(([k, n]) => `${n} ${k}`).join(', ') || 'empty'}`;
  $('#pause').textContent = state.paused ? 'Resume' : 'Pause';
  $('#pause').classList.toggle('on', state.paused);
  document.querySelectorAll('.speed').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === state.speed));

  const b = state.brain;
  // how many of their decisions the model actually made, against the simple fallback
  const tl = b.tally, all = tl ? tl.model + tl.instinct : 0;
  $('#share').hidden = !(b.status === 'online' && all >= 5);
  if (all >= 5) {
    // one line per mind: how fast it is answering, and where its seconds go
    const pace = (m, what) => `${m.settled ? `${m.model} (${what}) is answering about ${m.perMin} a minute` : `${m.model} (${what}) is still being timed`}${m.timing ? `, about ${m.timing.total.toFixed(1)}s an answer` : ''}${m.queue ? `, ${m.queue} waiting` : ''}.`;
    const speed = b.status !== 'online' ? '' : b.small ? ` ${pace({ ...b, queue: b.queue - b.small.queue }, 'talk and diaries')} ${pace(b.small, 'everyday choices')} The two take turns.`
      : `${b.settled && b.perMin ? ` The model is answering about ${b.perMin} a minute, ${b.lanes} at a time.` : ` Finding out how many answers at once this machine handles best (trying ${b.lanes || 1}).`}${b.timing ? ` Each answer takes about ${b.timing.total.toFixed(1)}s: ${b.timing.read.toFixed(1)}s reading the question, ${b.timing.write.toFixed(1)}s writing the reply.` : ''}`;
    const cast = state.cast && state.cast[0] < state.cast[1] ? ` The model follows ${state.cast[0]} of ${state.cast[1]} grown people closely today, whoever has the most going on; the rest live quietly in the background and step forward when something happens to them.` : '';
    $('#share').textContent = `${Math.round((tl.model / all) * 100)}% of decisions since the last restart came from the model. The rest fell back on instinct${tl.unreadable ? ` (${tl.unreadable} answers could not be read)` : ''}.${speed}${cast}${b.aside ? ` ${b.aside}` : ''}`;
  }
  const key = `${b.status}|${b.model}|${b.small ? b.small.model : ''}|${b.error}`;
  if (key === lastBrain) return;
  lastBrain = key;
  const pill = $('#brain'), note = $('#brainNote');
  if (b.status === 'online') {
    pill.className = 'pill online';
    pill.textContent = b.small ? `Thinking with ${b.model} + ${b.small.model}` : `Thinking with ${b.model}`;
    note.hidden = true;
  } else {
    pill.className = 'pill offline';
    pill.textContent = 'Instinct mode';
    note.hidden = false;
    note.innerHTML = `They are living on instinct, with no real thoughts or conversations yet. ${esc(b.error).replace(/(ollama pull [\w.:-]+)/, '<code>$1</code>')} This checks again every 20 seconds.`;
  }
}

function control(body) {
  fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
$('#pause').addEventListener('click', () => control({ paused: !(state && state.paused) }));
document.querySelectorAll('.speed').forEach((b) => b.addEventListener('click', () => control({ speed: Number(b.dataset.speed) })));

// ---------- tabs ----------

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $('#feedBar').hidden = name !== 'live';
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.id === name));
  showTree(name === 'family');
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---------- live feed ----------

function clockWord(t) {
  if (t < 0.1) return 'dawn';
  if (t < 0.3) return 'morning';
  if (t < 0.5) return 'midday';
  if (t < 0.68) return 'afternoon';
  if (t < 0.8) return 'evening';
  return 'night';
}

// Which kinds of entries the feed shows. Talk is shown as whole exchanges, not scattered lines.
const HAPPENINGS = ['event', 'build', 'discovery', 'birth', 'death', 'danger'];
let feedShow = 'all';
try { feedShow = localStorage.getItem('feedShow') || 'all'; } catch {}
const talks = new Map(); // exchange id -> its block in the feed
function setFeedShow(show) {
  feedShow = show;
  $('#live').dataset.show = show;
  document.querySelectorAll('#feedBar .flt').forEach((b) => b.classList.toggle('on', b.dataset.show === show));
  try { localStorage.setItem('feedShow', show); } catch {}
}
document.querySelectorAll('#feedBar .flt').forEach((b) => b.addEventListener('click', () => setFeedShow(b.dataset.show)));
setFeedShow(feedShow);

const TALK_TITLES = { talk: (a, b) => `${a} and ${b}`, child: (a, b) => `${a} and ${b}`, propose: (a, b) => `${a} asks ${b}`, quarrel: (a, b) => `${a} has it out with ${b}`, fight: (a, b) => `${a} goes for ${b}`, tryst: (a, b) => `${a} and ${b}, alone`, fire: (a) => `${a}, at the fire` };

function addFeed(item, animate) {
  const live = $('#live');
  if (!animate) live.classList.add('still');
  if (item.type === 'event' && /^Day \d+ begins\.$/.test(item.text)) item = { ...item, text: item.text.replace('Day', 'Year') }; // entries saved before the calendar counted years
  const meta = `<span class="meta">Year ${item.day}, ${clockWord(item.time)}</span>`;
  const who = item.who ? `<span class="who" data-id="${item.wid}">${esc(item.who)}</span>` : '';
  if (item.type === 'say' && item.talk) {
    // one block per exchange; a new line joins its block and brings the block back to the top
    let block = talks.get(item.talk);
    if (!block) {
      block = document.createElement('div');
      block.className = `item talk ${item.kind || 'talk'}`;
      const title = (TALK_TITLES[item.kind] || TALK_TITLES.talk)(item.who, item.to);
      block.innerHTML = `${meta}<div class="talkhead">${esc(title)}</div><div class="lines"></div>`;
      talks.set(item.talk, block);
      if (talks.size > 60) { const oldest = talks.keys().next().value; talks.delete(oldest); }
    }
    const line = document.createElement('div');
    line.className = 'line';
    line.innerHTML = `${who} <span class="text">&ldquo;${esc(item.text)}&rdquo;</span>`;
    block.querySelector('.lines').appendChild(line);
    live.prepend(block);
    if (!animate) live.classList.remove('still');
    return;
  }
  const el = document.createElement('div');
  el.className = `item ${item.type}${HAPPENINGS.includes(item.type) ? ' happening' : ''}`;
  if (item.type === 'thought') {
    el.innerHTML = item.text
      ? `${meta}${who} <span class="text">thinks, &ldquo;${esc(item.text)}&rdquo;</span><span class="act">${esc(item.who)} ${esc(item.act || '')}.</span>`
      : `${meta}${who} <span class="act" style="display:inline;font-size:inherit">${esc(item.act || '')}.</span>`;
  } else if (item.type === 'say') {
    el.innerHTML = `${meta}${who}: <span class="text">&ldquo;${esc(item.text)}&rdquo;</span>`;
  } else {
    el.innerHTML = `${meta}<span class="text">${esc(item.text)}</span>`;
  }
  live.prepend(el);
  if (!animate) live.classList.remove('still');
  while (live.children.length > 150) { const last = live.lastChild; for (const [k, v] of talks) if (v === last) talks.delete(k); last.remove(); }
}

$('#live').addEventListener('click', (e) => {
  const who = e.target.closest('.who');
  if (who) select(Number(who.dataset.id));
});

// ---------- chronicle ----------

function drawChronicle() {
  const el = $('#chronicle');
  if (!chronicle.length) { el.innerHTML = '<div class="empty">Nothing written yet.</div>'; return; }
  const days = {};
  for (const c of chronicle) (days[c.day] = days[c.day] || []).push(c);
  el.innerHTML = Object.keys(days).map(Number).sort((a, b) => b - a).map((d) =>
    `<div class="daymark">Year ${d}</div>` + days[d].map((c) =>
      c.type === 'diary' || c.type === 'tale' || c.type === 'fire'
        ? `<div class="chron diary ${c.type}"><b>${esc(c.who)}${c.type === 'tale' ? ' tells what lies beyond the valley' : c.type === 'fire' ? `, at the fire, shares ${esc(c.kind || 'something')}` : "'s diary"}</b>${esc(c.text)}</div>`
        : `<div class="chron ${c.type}">${esc(c.text)}</div>`).join('')).join('');
}

// ---------- people ----------

const bar = (cls, n) => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, n))}%"></i></div>`;

function face(v) {
  return `<div class="face" style="background:${v.skin}"><i style="top:0;height:9px;background:${v.hair}"></i><i style="bottom:0;height:9px;background:${v.shirt}"></i></div>`;
}

const NEED_NAMES = ['body', 'safety', 'belonging', 'standing', 'purpose'];
// The five levels as a pyramid, body at the bottom. The outlined row is the one they feel loudest.
function pyramid(lv) {
  if (!lv) return '';
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
  const rows = lv.rows.map((r, i) => `<div class="lv ${r.score < 40 ? 'bad' : r.score < (i === 0 ? 50 : 65) ? 'low' : ''} ${i === lv.at && lv.state !== 'met' ? 'at' : ''} ${lv.state === 'unmet' && i > lv.at ? 'mute' : ''}" style="width:${100 - i * 13}%" title="${esc(r.what)}"><i style="width:${r.score}%"></i><span>${esc(r.name)} ${r.score}</span></div>`).reverse().join('');
  const now = lv.rows[lv.at];
  const note = lv.state === 'met' ? 'Every need is met.' : `${lv.state === 'unmet' ? 'Going unmet' : 'Could be better'}: <b>${esc(now.name)}</b> (${esc(now.what)}).${now.why.length ? ` ${esc(cap(now.why.join(', ')))}.` : ''}`;
  return `<h3>What they need</h3><div class="pyr">${rows}</div><p class="pyrnote">${note}</p>`;
}

let rosterKey = '';
function updateRoster() {
  const key = state.v.map((v) => `${v.id}${v.st}${v.yr}${v.old ? 'o' : ''}${v.title}${v.role || ''}${v.sick ? 's' : ''}${v.away ? 'a' : ''}`).join(',') + '|' + selected;
  const el = $('#roster');
  if (key !== rosterKey) {
    rosterKey = key;
    el.innerHTML = state.v.map((v) =>
      `<button class="person ${v.id === selected ? 'on' : ''}" data-id="${v.id}">${face(v)}<div>
        <div class="name">${esc(v.name)}${v.role ? ` <em class="role">${esc(v.role)}</em>` : v.title ? ` <em>${esc(v.title)}</em>` : ''}<small>${[`${v.g === 'f' ? 'F' : 'M'} ${v.yr}`, v.st === 'child' ? 'child' : v.old ? 'elder' : '', v.sick ? 'sick' : '', v.away ? 'away' : ''].filter(Boolean).join(', ')}</small></div>
        <div class="doing"></div>
        <div class="need"></div>
        <div class="bars">${bar('health', 0)}${bar('energy', 0)}${bar('hunger', 0)}${bar('social', 0)}</div>
      </div></button>`).join('');
  }
  state.v.forEach((v, i) => {
    const row = el.children[i];
    if (!row) return;
    row.querySelector('.doing').textContent = v.act;
    row.classList.toggle('dim', v.lit === false && v.st === 'adult');
    const nd = row.querySelector('.need');
    if (nd && v.m) { nd.textContent = v.m[1] ? `${v.m[1] === 2 ? 'Lacks' : 'Wants'}: ${NEED_NAMES[v.m[0]]}` : 'All needs met'; nd.className = `need s${v.m[1]}`; }
    const vals = [v.hp, v.n[0], v.n[1], v.n[2]];
    row.querySelectorAll('.bar i').forEach((b, k) => { b.style.width = vals[k] + '%'; });
  });
}

$('#roster').addEventListener('click', (e) => {
  const p = e.target.closest('.person');
  if (p) select(Number(p.dataset.id));
});

function select(id) {
  selected = selected === id ? null : id;
  rosterKey = '';
  if (selected) { showTab('people'); loadDetail(); }
  else $('#detail').hidden = true;
}

async function loadDetail() {
  if (!selected) return;
  let d;
  try { d = await (await fetch(`/api/villager?id=${selected}`)).json(); } catch { return; }
  if (!d.id || d.id !== selected) return;
  const el = $('#detail');
  el.hidden = false;
  const kin = [];
  if (d.partner) kin.push(`Partner: ${esc(d.partner)}`);
  if (d.parents.length) kin.push(`Parents: ${esc(d.parents.join(' and '))}`);
  if (d.children.length) kin.push(`Children: ${esc(d.children.join(', '))}`);
  for (const line of d.kin || []) kin.push(esc(line));
  const stat = (label, cls, n) => `<div class="stat"><span>${label}</span>${bar(cls, n)}<span>${Math.round(n)}</span></div>`;
  el.innerHTML = `
    <h2>${esc(d.name)}${d.title ? ` <em>${esc(d.title)}</em>` : ''}</h2>
    <div class="sub">${d.gender === 'f' ? (d.stage === 'child' ? 'Girl' : 'Woman') : d.stage === 'child' ? 'Boy' : 'Man'}, ${d.age} ${d.age === 1 ? 'year' : 'years'} old. ${esc(d.about[0].toUpperCase() + d.about.slice(1))}. Now: ${esc(d.act)}.</div>
    ${d.thought ? `<p class="thought">&ldquo;${esc(d.thought)}&rdquo;</p>` : ''}
    ${d.sick ? `<p><b>Sick with ${esc(d.sick)}.</b></p>` : ''}
    ${pyramid(d.levels)}
    ${d.personality || d.nature ? `<h3>Who they are</h3>${d.personality ? `<p>${esc(d.personality)}</p>` : ''}${d.nature ? `<ul class="nature"><li><small>Born</small> ${esc(d.nature.temperament)}</li><li><small>Fault</small> ${esc(d.nature.flaw)}</li>${d.nature.humor ? `<li><small>Laughs at</small> ${esc(d.nature.humor)}</li>` : ''}${d.nature.voice ? `<li><small>Talks</small> ${esc(d.nature.voice)}</li>` : ''}${d.nature.drawn ? `<li><small>Drawn to</small> ${esc(d.nature.drawn)}</li>` : ''}</ul>` : ''}` : ''}
    ${(d.grudges || []).length ? `<h3>What they have not forgiven</h3><ul>${d.grudges.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${d.killed ? `<p><b>Has killed ${d.killed === 1 ? 'a person' : d.killed + ' people'}.</b></p>` : ''}
    ${d.wants.length ? `<h3>What they want (their own words)</h3><ul>${d.wants.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${d.stage === 'child' && d.lessons.length ? `<h3>What this childhood holds</h3><ul>${d.lessons.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${d.project ? `<h3>An idea they are working on</h3><p>${esc(d.project)}</p>` : ''}
    ${d.items.length ? `<h3>Their things</h3><ul>${d.items.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${d.tale ? `<h3>What they saw beyond the valley</h3><p class="thought">${esc(d.tale)}</p>` : ''}
    <h3>Body</h3>${stat('Health', 'health', d.health)}${stat('Fullness', 'hunger', d.needs.hunger)}${d.stage === 'adult' ? `${stat('Energy', 'energy', d.needs.energy)}${stat('Company', 'social', d.needs.social)}
    <h3>Carrying</h3><div class="carry">${Object.entries(d.inv).filter(([, n]) => n > 0).map(([k, n]) => `<span>${n} ${esc(k)}</span>`).join('') || '<span>nothing</span>'}</div>` : ''}
    <h3>Home and family</h3><p>Home: ${esc(d.home)}</p>${kin.map((k) => `<p>${k}</p>`).join('')}
    ${d.people.length ? `<h3>How they feel about others</h3><ul>${d.people.map((p) => `<li>${esc(p.name)} <small>(${esc(p.rel)})</small>: ${esc(p.word)}${p.view ? `<br><small>&ldquo;${esc(p.view)}&rdquo;</small>` : ''}</li>`).join('')}</ul>` : ''}
    ${d.diary.length ? `<h3>Diary</h3><ul>${d.diary.map((m) => `<li><small>Year ${m.d}</small> ${esc(m.text)}</li>`).join('')}</ul>` : ''}
    ${d.memory.length ? `<h3>Recent memories</h3><ul>${d.memory.map((m) => `<li><small>Year ${m.d}</small> ${esc(m.text)}</li>`).join('')}</ul>` : ''}`;
}
setInterval(loadDetail, 2000);

// ---------- clicking and hovering on the world ----------

// Scroll to zoom, drag to look around. "Auto view" hands the camera back.
let drag = null, dragged = false;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  syncAuto();
}, { passive: false });
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; dragged = false; });
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragged && Math.hypot(dx, dy) < 5) return;
  dragged = true;
  renderer.panBy(dx, dy);
  drag = { x: e.clientX, y: e.clientY };
  syncAuto();
});
window.addEventListener('pointerup', () => { drag = null; });
function syncAuto() { $('#auto').classList.toggle('on', renderer.auto); }
$('#auto').addEventListener('click', () => { renderer.setAuto(!renderer.auto); syncAuto(); });

canvas.addEventListener('click', (e) => {
  if (!state || dragged) return;
  const p = renderer.toTile(e.clientX, e.clientY);
  let best = null, bd = 1.3;
  for (const v of state.v) {
    if (v.inside || v.away) continue;
    const s = smooth.get(v.id);
    const d = Math.hypot(s.rx - p.x, s.ry - 0.4 - p.y);
    if (d < bd) { bd = d; best = v; }
  }
  if (best) select(best.id);
  else if (selected) select(selected);
});

canvas.addEventListener('mousemove', (e) => {
  const tip = $('#tip'), w = renderer.world;
  if (!w || !state) return;
  const p = renderer.toTile(e.clientX, e.clientY);
  const tx = Math.floor(p.x), ty = Math.floor(p.y);
  const s = w.structures.find((s) => tx >= s.x && tx < s.x + s.w && ty >= s.y && ty < s.y + s.h);
  if (!s) { tip.hidden = true; return; }
  const owner = state.v.find((v) => v.id === s.owner);
  const inside = state.v.filter((v) => v.inside && v.home === s.id).map((v) => v.name);
  tip.textContent = `${s.label ? `"${s.label}", ` : ''}${s.name || s.type}${owner ? `, built by ${owner.name}` : ''}${s.p < 1 ? ' (being built)' : ''}${inside.length ? `. Asleep inside: ${inside.join(', ')}` : ''}`;
  const r = canvas.getBoundingClientRect();
  tip.style.left = e.clientX - r.left + 'px';
  tip.style.top = e.clientY - r.top + 'px';
  tip.hidden = false;
});
canvas.addEventListener('mouseleave', () => { $('#tip').hidden = true; });

// ---------- animation loop ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state) {
    for (const v of state.v) {
      const s = smooth.get(v.id);
      const k = Math.min(1, dt * 10);
      s.rx += (v.x - s.rx) * k;
      s.ry += (v.y - s.ry) * k;
      v.rx = s.rx;
      v.ry = s.ry;
    }
    for (const an of state.an) {
      const s = smooth.get('a' + an.id);
      const k = Math.min(1, dt * 10);
      s.rx += (an.x - s.rx) * k;
      s.ry += (an.y - s.ry) * k;
      an.rx = s.rx;
      an.ry = s.ry;
    }
  }
  renderer.draw(state, now / 1000, selected);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
