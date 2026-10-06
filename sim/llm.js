// Talks to whatever language model is giving the villagers their minds.
// There can be two of them: a big one that does the talking (conversations, speeches, diaries, ideas), and a small
// quick one for the everyday "what do I do next". Each has its own line, so a slow speech never holds up the
// people waiting to choose, and each is timed on its own to find how many answers at once it handles best.

const PREFER = ['gemma4', 'gemma', 'qwen', 'llama', 'phi', 'mistral'];

export function parseJSON(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch {}
  }
  // An answer that ran out of room mid-sentence: close what was left open and keep what was said.
  if (a >= 0) {
    let u = t.slice(a).replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
    let inStr = false, esc = false, depth = 0;
    for (const ch of u) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      else if (!inStr && ch === '{') depth++;
      else if (!inStr && ch === '}') depth--;
    }
    if (inStr) u += '"';
    u = u.replace(/,\s*"[^"]*"\s*$/, '').replace(/:\s*$/, ': ""');
    for (let i = 0; i < depth; i++) u += '}';
    try { const o = JSON.parse(u); if (o && typeof o === 'object' && Object.keys(o).length) return o; } catch {}
  }
  return null;
}

// One model and its line of questions.
const newMind = (key) => ({ key, model: null, queue: [], active: 0, lanes: 1, calls: 0, perMin: 0, lastStart: 0, tuning: null, timing: null, bench: null, seen: 0, used: 0, done: [] });

export class LLM {
  constructor(cfg) {
    this.cfg = cfg;
    this.status = 'starting'; // starting | online | offline
    this.error = '';
    this.fails = 0;
    this.lastEnd = 0;
    this.sendThink = true;
    this.sendFormat = true;
    this.big = newMind('big');
    this.small = this.big; // until a second, smaller model turns up, the one mind does everything
    this.aside = '';
  }

  get online() { return this.status === 'online'; }
  get two() { return this.small !== this.big; }
  get busy() { return this.big.active + (this.two ? this.small.active : 0) > 0; }
  // Two models on one machine take turns. Run at the same moment they fight over the same chip and both crawl:
  // measured on a 24 GB MacBook Pro, the small one fell from 25 answers a minute to 4. (llm.together true undoes this.)
  get shared() { return this.two && this.cfg.together !== true && !this.small.baseUrl; }
  // where a mind lives: the second one can be on another computer (llm.smallBaseUrl), and then both truly run at once
  base(m) { return (m.baseUrl || this.cfg.baseUrl).replace(/\/$/, ''); }
  get model() { return this.big.model; }
  get calls() { return this.big.calls + (this.two ? this.small.calls : 0); }
  get queue() { return this.two ? [...this.big.queue, ...this.small.queue] : this.big.queue; }
  mind(name) { return name === 'small' ? this.small : this.big; }
  // how many are in line for one of the minds (at one priority, if given)
  waiting(name, priority) { return this.mind(name).queue.filter((q) => priority == null || q.priority === priority).length; }

  info() {
    const lately = (m) => m.done.filter((t) => Date.now() - t < 120000).length / 2;
    const one = (m) => ({ model: m.model, queue: m.queue.length, calls: m.calls, lanes: this.shared ? 1 : m.lanes || 1, perMin: this.shared ? Math.round(lately(m)) : m.perMin || 0, settled: this.shared ? m.calls >= 4 : !!(m.tuning && m.tuning.holdUntil),
      bench: m.bench && !m.bench.running ? m.bench : null,
      timing: m.timing && m.timing.n >= 5 ? { read: +m.timing.read.toFixed(2), write: +m.timing.write.toFixed(2), total: +m.timing.total.toFixed(2), inTok: Math.round(m.timing.inTok), outTok: Math.round(m.timing.outTok), n: m.timing.n } : null });
    return { status: this.status, provider: this.cfg.provider, error: this.error, busy: this.busy, ...one(this.big), queue: this.queue.length, calls: this.calls,
      small: this.two ? one(this.small) : null, aside: this.aside };
  }

  setOffline(why) {
    this.status = 'offline';
    this.error = why;
    for (const m of new Set([this.big, this.small])) for (const item of m.queue.splice(0)) item.resolve(null);
  }

  // Everything goes back to the one model. Used when a machine turns out not to have room for both at once.
  oneMind(why) {
    if (!this.two) return;
    const s = this.small;
    this.small = this.big;
    this.single = true;
    this.aside = why;
    for (const item of s.queue.splice(0)) this.big.queue.push(item);
    console.log(`  ${why}`);
    if (this.cfg.provider === 'ollama') fetch(this.base(s) + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: s.model, keep_alive: 0 }) }).catch(() => {});
    this.pump(this.big);
  }

  // Find out whether a model is actually reachable, and which one to use.
  async probe() {
    const { provider, baseUrl, model } = this.cfg;
    const second = this.cfg.smallModel ?? 'auto';
    if (provider === 'none') return this.setOffline('Instinct mode is switched on in config.json (provider is "none").');

    if (provider === 'openai') {
      if (!model || model === 'auto') return this.setOffline('Set llm.model in config.local.json for this provider.');
      this.big.model = model;
      if (second && !['auto', 'none'].includes(second) && second !== model && !this.single) { if (!this.two) this.small = newMind('small'); this.small.model = second; }
      this.status = 'online';
      this.error = '';
      this.fails = 0;
      return;
    }

    try {
      const res = await fetch(baseUrl.replace(/\/$/, '') + '/api/tags', { signal: AbortSignal.timeout(4000) });
      const found = ((await res.json()).models || []).filter((m) => !/embed/i.test(m.name));
      const sizeOf = Object.fromEntries(found.map((m) => [m.name, m.size || 0]));
      // how big a mind is: by its count of parameters when Ollama says ("12.2B"), since file sizes of a small and a
      // big model can sit closer together than the models really are; by file size otherwise
      const params = (m) => { const x = /([\d.]+)\s*([BM])/i.exec((m.details && m.details.parameter_size) || ''); return x ? Number(x[1]) * (x[2].toUpperCase() === 'M' ? 0.001 : 1) : 0; };
      const weigh = found.every((m) => params(m) > 0) ? Object.fromEntries(found.map((m) => [m.name, params(m)])) : sizeOf;
      const names = found.map((m) => m.name);
      if (!names.length) return this.setOffline('Ollama is running but has no models yet. Run: ollama pull gemma4:e2b');
      const named = (want) => names.find((n) => n === want) || names.find((n) => n.startsWith(want + ':') || n.split(':')[0] === want);
      let chosen = null;
      if (model && model !== 'auto') {
        chosen = named(model);
        if (!chosen) return this.setOffline(`The model "${model}" is not downloaded. Run: ollama pull ${model}`);
      } else {
        // Each computer uses the biggest mind it has been given. Whoever downloaded a bigger one meant it to be used,
        // and a machine that only has the small one carries on with that.
        for (const p of PREFER) { chosen = names.filter((n) => n.startsWith(p)).sort((a, b) => sizeOf[b] - sizeOf[a])[0]; if (chosen) break; }
        chosen = chosen || names[0];
      }
      // The second mind on another computer: whatever is there (llm.smallModel names one, or the smallest).
      const elsewhere = this.cfg.smallBaseUrl && this.cfg.smallBaseUrl.replace(/\/$/, '') !== baseUrl.replace(/\/$/, '') ? this.cfg.smallBaseUrl.replace(/\/$/, '') : null;
      if (elsewhere && !this.single) {
        try {
          const r2 = await fetch(elsewhere + '/api/tags', { signal: AbortSignal.timeout(4000) });
          const there = ((await r2.json()).models || []).filter((m) => !/embed/i.test(m.name));
          const pickThere = second && second !== 'auto' ? there.find((m) => m.name === second || m.name.startsWith(second + ':') || m.name.split(':')[0] === second) : there.filter((m) => PREFER.some((p) => m.name.startsWith(p))).sort((a, b) => (a.size || 0) - (b.size || 0))[0] || there[0];
          if (!pickThere) this.aside = `The other computer at ${elsewhere} has no model to use, so ${chosen} is doing everything.`;
          else {
            this.big.model = chosen;
            if (!this.two) this.small = newMind('small');
            this.small.model = pickThere.name; this.small.baseUrl = elsewhere;
            this.status = 'online'; this.error = ''; this.fails = 0; this.aside = '';
            if (!this.big.bench) this.selfTest();
            return;
          }
        } catch { this.aside = `Could not reach the other computer at ${elsewhere}, so ${chosen} is doing everything here.`; }
      }
      // The second mind: the smallest model here that is clearly smaller than the first. With only one model
      // downloaded, or llm.smallModel set to "none", the one mind does everything as before.
      let quick = null;
      if (this.single || !second || second === 'none') quick = null;
      else if (second !== 'auto') { quick = named(second); if (!quick) this.aside = `The second model "${second}" is not downloaded (ollama pull ${second}), so ${chosen} is doing everything.`; }
      else quick = names.filter((n) => n !== chosen && PREFER.some((p) => n.startsWith(p)) && weigh[n] > 0 && weigh[n] < weigh[chosen] * 0.85).sort((a, b) => weigh[a] - weigh[b])[0] || null;
      if (quick === chosen) quick = null;
      this.big.model = chosen;
      if (quick) { if (!this.two) this.small = newMind('small'); this.small.model = quick; if (!this.aside || /second model/.test(this.aside)) this.aside = ''; }
      else if (this.two) { const s = this.small; this.small = this.big; for (const item of s.queue.splice(0)) this.big.queue.push(item); }
      if (this.two) this.small.baseUrl = null;
      this.status = 'online';
      this.error = '';
      this.fails = 0;
      if (!this.big.bench) this.selfTest(); // once, and the first answers wait for it so the numbers are clean
    } catch {
      this.setOffline(`Could not reach Ollama at ${baseUrl}. Is it running?`);
    }
  }

  // What this machine can actually do, measured before anything else is asked of it: how fast each model reads, how
  // fast it writes, and whether a question that opens with words it has just read gets read any quicker. Three small
  // questions each, a few seconds in all.
  async selfTest() {
    this.testing = true;
    const { baseUrl } = this.cfg;
    for (const m of new Set([this.big, this.small])) {
      m.bench = { running: true };
      // each run uses openings nobody has seen before, so nothing left in the model's head from last time can flatter the result
      const tag = Math.random().toString(36).slice(2, 8);
      const lines = (word) => Array.from({ length: 110 }, (_, i) => `${word} ${i}: the river runs past the old stones and the smoke goes up from the fire.`).join('\n');
      const ask = async (opening, tail, n) => {
        const res = await fetch(this.base(m) + '/api/chat', {
          method: 'POST', signal: AbortSignal.timeout(180000), headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.model, stream: false, keep_alive: '30m', messages: [{ role: 'system', content: opening }, { role: 'user', content: tail }], options: { temperature: 0, num_predict: n, num_ctx: this.cfg.contextTokens || 8192 } }),
        });
        return res.json();
      };
      try {
        await ask(lines(`alder ${tag}`), 'Say the word yes.', 4); // wakes the model up
        const same = await ask(lines(`alder ${tag}`), 'Count from one to thirty in words.', 60); // opens the way the last one did
        const fresh = await ask(lines(`birch ${tag}`), 'Count from one to thirty in words.', 60); // opens differently, same length
        const sec = (ns) => (ns || 0) / 1e9;
        if (!fresh.prompt_eval_count || !fresh.prompt_eval_duration) throw new Error(fresh.error || 'the model gave no timings');
        const read = fresh.prompt_eval_count / Math.max(0.001, sec(fresh.prompt_eval_duration));
        const write = fresh.eval_count / Math.max(0.001, sec(fresh.eval_duration));
        const saved = 1 - sec(same.prompt_eval_duration) / Math.max(0.001, sec(fresh.prompt_eval_duration));
        m.bench = { read: Math.round(read), write: Math.round(write), reuse: saved > 0.4, saved: Math.round(saved * 100), freshRead: +sec(fresh.prompt_eval_duration).toFixed(2), sameRead: +sec(same.prompt_eval_duration).toFixed(2), tokens: fresh.prompt_eval_count, sameTokens: same.prompt_eval_count };
        console.log(`  ${m.model}${m.baseUrl ? ` on ${m.baseUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, '')}` : ''} reads about ${m.bench.read} word-pieces a second and writes about ${m.bench.write}.`);
        console.log(m.bench.reuse ? `  A question that opens the same way as the last one is read ${m.bench.saved}% faster, so the shared opening is paying off.` : `  A question that opens the same way as the last one is not read any faster here (${m.bench.saved}%).`);
      } catch (e) {
        m.bench = { error: String(e.message || e).slice(0, 120) };
      }
    }
    this.testing = false;
    this.pump(this.big);
    if (this.two) this.pump(this.small);
  }

  // The longer something waits, the more it matters, so a busy village cannot starve the slow things
  // (a child's name, a diary) by always having one more decision to make. The talking mind is more patient about
  // it: a conversation going on now comes before last night's diary for a good while longer.
  rank(m, item) { return item.priority - Math.floor((Date.now() - item.at) / (this.two && m === this.big ? 60000 : 20000)); }

  // Ask for a JSON answer. Lower priority number goes first. Resolves to an object, or null.
  // opts.mind "small" sends it to the quick model when there is one.
  ask(priority, messages, schema, maxTokens = 220, opts = {}) {
    if (!this.online) return Promise.resolve(null);
    return new Promise((resolve) => {
      const m = this.mind(opts.mind);
      m.queue.push({ priority, messages, schema, maxTokens, opts, resolve, at: Date.now() });
      if (m.queue.length > (this.cfg.maxQueue || 600)) {
        m.queue.sort((a, b) => this.rank(m, a) - this.rank(m, b) || a.at - b.at);
        m.queue.pop().resolve(null);
      }
      this.pump(m);
    });
  }

  // How many answers at once a machine really handles best is found by trying, not by guessing. One at a time is
  // tried first, then two, then three (up to llm.parallel), a dozen answers each, timing every one. Whichever gets
  // the most answers out per minute is kept for half an hour, and then it is tried again, since a warm laptop is
  // not the machine it was when it was cool.
  note(m, ms) {
    const max = Math.max(1, Math.min(4, Number(this.cfg.parallel) || 3));
    if (!m.tuning) m.tuning = { sum: 0, n: 0, rates: {}, holdUntil: 0 };
    const T = m.tuning;
    if (T.holdUntil) {
      if (Date.now() < T.holdUntil) return;
      m.tuning = { sum: 0, n: 0, rates: {}, holdUntil: 0 };
      m.lanes = 1;
      return;
    }
    T.sum += ms; T.n++;
    if (T.n < 12) return;
    T.rates[m.lanes] = m.lanes / (T.sum / T.n / 1000);
    T.sum = 0; T.n = 0;
    if (m.lanes < max) { m.lanes++; return; }
    // more at once only counts if it really gets more done
    let best = 1;
    for (let k = 2; k <= max; k++) if (T.rates[k] > T.rates[best] * 1.1) best = k;
    m.lanes = best;
    m.perMin = Math.round(T.rates[best] * 60);
    T.holdUntil = Date.now() + 30 * 60000;
    console.log(`  ${m.model} answers fastest ${best} at a time on this machine: about ${m.perMin} a minute (${Object.entries(T.rates).map(([k, r]) => `${k} at a time: ${Math.round(r * 60)}`).join(', ')}).`);
  }

  // Taking turns: one answer at a time across both models. Whichever has had less than its share of the machine
  // lately goes next, so a long speech cannot shut out the people waiting to choose, and a crowd of choosers cannot
  // shut out the talk. llm.talkShare is the talking model's share of the time (0.6 unless set). When one of them
  // has nothing to do, as at night when nobody is choosing anything, the other gets the whole machine.
  async turn() {
    if (!this.shared) return this.pump(this.big);
    if (this.testing || this.running || !this.online) return;
    const share = Math.max(0.1, Math.min(0.9, Number(this.cfg.talkShare) || 0.6));
    const owed = (m) => m.used / (m === this.big ? share : 1 - share);
    let m = [this.big, this.small].filter((x) => x.queue.length).sort((a, b) => owed(a) - owed(b))[0];
    if (!m) return;
    // Somebody standing there waiting for an answer (the next line of a talk, a proposal, a quarrel) is not kept
    // waiting for the sake of a fair share, up to two turns in a row.
    if (this.big.queue.some((q) => q.priority <= 1) && (this.bigRun || 0) < 2) m = this.big;
    this.bigRun = m === this.big ? (this.bigRun || 0) + 1 : 0;
    this.running = true;
    m.active++;
    const wait = (this.lastStart || 0) + (this.cfg.minGapMs ?? 200) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastStart = Date.now();
    m.queue.sort((a, b) => this.rank(m, a) - this.rank(m, b) || a.at - b.at);
    const item = m.queue.shift();
    const began = Date.now();
    if (item) await this.answer(m, item);
    const took = Date.now() - began;
    for (const x of [this.big, this.small]) x.used *= 0.97; // what happened a while ago counts for less
    m.used += took;
    if (took > 300) { m.done.push(Date.now()); if (m.done.length > 80) m.done.shift(); }
    m.active--;
    this.running = false;
    if (this.shared) this.turn(); else { this.pump(this.big); }
  }

  // Put one question to a model and hand back its answer. Returns false if there turned out to be nothing to ask.
  async answer(m, item) {
    // A question can be handed over as a function, so it is put together at the moment it is asked rather than
    // when it joined the line. If the moment has passed by then, nothing is asked at all.
    let messages = item.messages;
    if (typeof messages === 'function') { try { messages = messages(); } catch (e) { console.error('Could not put a thought together:', e.message); messages = null; } }
    if (!messages) { item.resolve({ __skip: true }); return false; }
    try {
      const text = await this.call(m, messages, item.schema, item.maxTokens, item.opts || {});
      m.calls++;
      const obj = parseJSON(text);
      if (!obj) throw new Error('The model answered, but not in JSON.');
      this.fails = 0;
      item.resolve(obj);
    } catch (e) {
      this.fails++;
      this.error = String(e.message || e).slice(0, 200);
      item.resolve(null);
      if (this.fails >= 4) this.setOffline(this.error);
    }
    this.lastEnd = Date.now();
    return true;
  }

  async pump(m = this.big) {
    if (this.shared) return this.turn();
    if (!m.lanes) m.lanes = 1;
    if (this.testing || this.running || m.active >= m.lanes || !m.queue.length) return;
    m.active++;
    const full = m.active >= m.lanes;
    const wait = (m.lastStart || 0) + (this.cfg.minGapMs ?? 200) - Date.now();
    m.lastStart = Date.now() + Math.max(0, wait);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    m.queue.sort((a, b) => this.rank(m, a) - this.rank(m, b) || a.at - b.at);
    const item = m.queue.shift();
    if (!item) { m.active--; return; }
    if (m.queue.length) setTimeout(() => this.pump(m), 0);
    const began = Date.now();
    const asked = await this.answer(m, item);
    if (asked && full) this.note(m, Date.now() - began);
    m.active--;
    this.pump(m);
    // if the two minds were folded into one while this was out, the line it came from may have moved
    if (m !== this.big && !this.two) this.pump(this.big);
  }

  async call(m, messages, schema, maxTokens, opts = {}) {
    const { provider, apiKey, timeoutMs } = this.cfg;
    const temperature = opts.temperature ?? this.cfg.temperature;
    const base = this.base(m);
    const signal = AbortSignal.timeout(timeoutMs);

    if (provider === 'openai') {
      const body = { model: m.model, messages, temperature, max_tokens: maxTokens };
      if (this.sendFormat) body.response_format = { type: 'json_object' };
      const res = await fetch(base + '/chat/completions', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        if (this.sendFormat && res.status === 400 && /response_format/i.test(text)) { this.sendFormat = false; return this.call(m, messages, schema, maxTokens, opts); }
        throw new Error(`${res.status} from the model: ${text.slice(0, 140)}`);
      }
      const j = await res.json();
      return j.choices?.[0]?.message?.content || '';
    }

    const body = {
      model: m.model, messages, stream: false, format: schema || 'json', keep_alive: '30m',
      options: { temperature, num_predict: maxTokens, num_ctx: this.cfg.contextTokens || 8192 },
    };
    if (this.sendThink) body.think = false;
    const res = await fetch(base + '/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text();
      if (this.sendThink && /think/i.test(text)) { this.sendThink = false; return this.call(m, messages, schema, maxTokens, opts); }
      throw new Error(`${res.status} from Ollama: ${text.slice(0, 140)}`);
    }
    const j = await res.json();
    // Ollama says how long it spent reading the question and how long writing the answer. Keep a running average,
    // so it is plain where the seconds go on this machine.
    if (j.total_duration) {
      const T = m.timing || (m.timing = { n: 0, read: 0, write: 0, total: 0, inTok: 0, outTok: 0 });
      const k = T.n < 20 ? 1 / (T.n + 1) : 0.05;
      const mix = (key, val) => { T[key] += ((val || 0) - T[key]) * k; };
      mix('read', (j.prompt_eval_duration || 0) / 1e9); mix('write', (j.eval_duration || 0) / 1e9); mix('total', j.total_duration / 1e9);
      mix('inTok', j.prompt_eval_count || 0); mix('outTok', j.eval_count || 0);
      T.n++;
    }
    // Two models only help if both stay in memory. A machine without room for both throws one out to load the
    // other, every time, and each of those reloads costs seconds. If that keeps happening, go back to one.
    if (this.two && !this.small.baseUrl) {
      m.seen++;
      if (m.seen > 2 && (j.load_duration || 0) > 1.5e9) {
        const now = Date.now();
        this.reloads = (this.reloads || []).filter((t) => now - t < 10 * 60000);
        this.reloads.push(now);
        if (this.reloads.length >= 4) this.oneMind(`This computer does not have room to keep ${this.big.model} and ${this.small.model} loaded together, so ${this.big.model} is doing everything again.`);
      }
    }
    return j.message?.content || '';
  }
}
