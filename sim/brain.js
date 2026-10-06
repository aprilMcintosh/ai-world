// The villagers' minds. This file turns a villager's situation into a prompt,
// sends it to the model, and turns the answer into something the simulation
// can act on. If no model is reachable, a simple "instinct" brain steps in so
// the world keeps turning.

import { STRUCT, CARRY, costText, affinityWord, EFFECTS, SHAPES, COLORS, LEVELS, RAW, LANDMARKS } from './sim.js';

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['gather', 'fish', 'hunt', 'build', 'store', 'eat', 'sleep', 'talk', 'give', 'invent', 'call', 'propose', 'together', 'part', 'tend', 'shelter', 'take', 'fight', 'kill', 'explore', 'make', 'activity', 'wander'] },
    target: { type: 'string' },
    near: { type: 'string' },
    to: { type: 'string' },
    say: { type: 'string' },
    label: { type: 'string' },
    thought: { type: 'string' },
  },
  required: ['action', 'thought'],
};
const REPLY_SCHEMA = {
  type: 'object',
  properties: { say: { type: 'string' }, feeling: { type: 'string', enum: ['warmer', 'same', 'colder'] }, view: { type: 'string' } },
  required: ['say', 'feeling', 'view'],
};
const obj = (name) => ({ type: 'object', properties: { [name]: { type: 'string' } }, required: [name] });

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// The opening of every question, the same for everyone, word for word. A model that has just read it for one person
// does not have to read it again for the next, which is the cheapest speed there is.
// The age they live in is said in the opening, so a Stone Age person and an Iron Age person are told different worlds.
const WORLD = (sim) => `You live in a world where everything has to be made by hand from what the earth gives, and where hunger, winter, wolves and old age are real. ${sim.ageLine()} People here talk about what they can see, touch, eat, fear and love, in short plain words.`;
const HUMAN = 'You are a real human being living a real life. You are not a character in a story, not a helper, and nobody is watching. Act the way people in real life act. You have a body, and it wants things: food, sleep, warmth, sex, to win, to be looked up to. Real people are selfish as often as they are kind. They get jealous, bored, lustful, lazy, proud and angry. They hold grudges, gossip, shirk, show off, lie when it suits, take what is not theirs, and now and then hurt each other. They also love hard, laugh, and stick by their own. You are no better and no worse than that. Your mood follows your life: content when you are fed and rested, short-tempered when you are hungry or worn out, frightened when there is danger, heartbroken when someone dies.';
const WAYS = `WHAT A PERSON CAN DO HERE, AND WHAT COMES OF IT. Which of these are open to you at a given moment is listed at the end of each question.
- gather: collect by hand what the valley gives: wood, stone, food, clay and reeds at the water, and whatever else people here have found. target is which.
- fish: catch fish at the water's edge. A pond can be fished out.
- hunt: go after a wild animal with a spear. A deer feeds a family for days, but it may get away. Animals breed only from the ones left alive: if the last of a kind is killed, that kind is gone.
- build: put up one of the buildings your people know, or something this place has never had, that you want or that people here need. For a new thing you say what it is in your own words, and you work out how to build it from what your people have before you start. You may give what you build a name.
- make: craft a thing of your own to keep, anything you can think of: a tool, a toy, a blanket, a carving, an instrument, like "a sharp flint knife". It costs a little of what it is made of. Or make a batch of a material your people have learned to make, like bricks, rope or copper, by naming it.
- invent: work out something that does not exist yet. A new kind of building, a tool, a way of doing something, or a new material made from what you have, like turning green ore into metal or clay into bricks. Ideas come out of need and out of what is lying around: a hunger, a danger, a strange rock, a want to be remembered, a want of something beautiful. Each new thing stands on the ones before it. It takes a few tries over a few days.
- talk: sit down with someone and really talk, about what is on your mind: a worry, a want, a grudge, a memory, someone who is gone, what lies beyond the valley, anything real.
- give: hand someone some of what you carry.
- activity: anything else a person might do with their time, whatever suits you and what you want, like "watching the deer drink at the pond". Alone, or with someone.
- call: call everyone to the fire in the evening to share something with all of them at once: a story, a prayer, a song, a memory of someone, news, a plan.
- store: carry what you are holding to the shared storehouse.
- propose: ask someone to make a home and a life with you. The answer is theirs: yes, not yet, or no.
- together: spend some time alone with your partner. Couples who make time for each other grow closer, and are more likely to have a child.
- explore: leave the valley to see what lies beyond. You are gone a day or two. It is dangerous, more so in winter, and not everyone comes back.
- eat and sleep are what they say.`;

const energyWord = (n) => (n < 15 ? 'exhausted' : n < 35 ? 'tired' : n < 70 ? 'fine' : 'rested');
const hungerWord = (n) => (n < 15 ? 'starving' : n < 35 ? 'hungry' : n < 65 ? 'could eat' : 'well fed');
const socialWord = (n) => (n < 20 ? 'lonely' : n < 45 ? 'missing company' : 'content');

// Does this describe something other than the plain building its words point at? What is left after taking out
// the building's own word, filler, people's names and places decides it.
const FILLER = new Set('a an the new small big large little another second third my our own your sturdy simple proper better bigger good strong wooden wood stone clay for us me you them near by here at in on of to with and next beside behind home pond forest campfire fire water one some more just now up out'.split(' '));
function somethingElse(text, st, sim) {
  const hit = BUILD_WORDS.find(([k]) => k === st);
  const names = new Set(sim.villagers.map((v) => v.name.toLowerCase()));
  const rest = String(text).toLowerCase().replace(st, ' ').replace(hit ? new RegExp(hit[1].source, 'g') : / /, ' ')
    .split(/[^a-z]+/).filter((w) => w.length > 2 && !FILLER.has(w) && !names.has(w) && !FILLER.has(w.replace(/s$/, '')) && !STRUCT[w] && !STRUCT[w.replace(/s$/, '')]);
  return rest.join('').length >= 4;
}
const BUILD_WORDS = [
  ['campfire', /camp ?fire|fire ?pit|bonfire|\bfire\b/],
  ['shelter', /shelter|lean|hut|tent/],
  ['house', /house|home|cabin|cottage/],
  ['farm', /farm|field|crop|plot/],
  ['garden', /garden|flower/],
  ['bench', /bench|seat/],
  ['path', /path|road|trail/],
  ['well', /\bwell\b/],
  ['lantern', /lantern|lamp|torch|light/],
  ['workshop', /workshop|forge|smith|tool/],
  ['statue', /statue|monument|sculpt/],
  ['market', /market|stall|shop|store/],
  ['chapel', /chapel|church|temple|altar/],
  ['storehouse', /store ?house|stock ?pile|barn|shed|granary|storage/],
  ['coop', /coop|chicken|hen/],
  ['pen', /\bpen\b|sheep|fold|corral/],
];

let resourceSim = null;
function resourceFrom(text) {
  const t = String(text || '').toLowerCase();
  if (resourceSim) { const m = resourceSim.materialFrom(t); if (m && (resourceSim.gatherable(m) || !/wood|stone|food/.test(t))) return m; }
  if (/\bore\b|copper|tin|iron|green streak|red streak|rust/.test(t) && resourceSim && resourceSim.knows('ore')) return /red|rust|iron/.test(t) ? 'red ore' : /grey|gray|tin|heavy/.test(t) ? 'grey ore' : 'green ore';
  if (/\bclay\b|mud/.test(t)) return 'clay';
  if (/reed|rush|straw|thatch/.test(t)) return 'reeds';
  if (/wood|tree|log|timber|chop|lumber|branch/.test(t)) return 'wood';
  if (/stone|rock|mine|quarr/.test(t)) return 'stone';
  if (/food|berr|fruit|crop|farm|forag|harvest|eat|egg|milk|fish/.test(t)) return 'food';
  return null;
}

export class Brain {
  constructor(sim, llm) {
    this.sim = sim;
    this.llm = llm;
    resourceSim = sim;
  }

  // ---------- who am I ----------

  // talk: true leaves out the glossary of actions, which only the choosing needs. When the talking is done by a second
  // model, its questions never carry it, so that model has less to read and its own shared opening stays shared.
  system(v, talk = false) {
    const sim = this.sim;
    if (v.stage === 'child') {
      const parents = v.parents.map((id) => sim.person(id)?.name).filter(Boolean).join(' and ');
      const yrs = sim.years(v), kid = v.gender === 'm' ? 'boy' : 'girl';
      const voice = yrs < 5 ? `a very small ${kid}, ${yrs < 2 ? 'barely talking yet' : `${yrs} years old`}. You talk the way a toddler does: a few words at a time, about whatever is right in front of you`
        : yrs < 11 ? `a ${kid} of ${yrs}. You talk like a real kid: short, curious, blunt, sometimes silly`
        : `a ${kid} of ${yrs}, nearly grown. You talk like someone that age: your own opinions, impatient to be treated as grown, still unsure of a lot`;
      const born = v.nature ? ` This is the nature you were born with, and it shows in everything you say: ${v.nature.temperament}. Your fault: ${v.nature.flaw}.${v.nature.humor ? ` What makes you laugh: ${v.nature.humor}.` : ''}${v.nature.voice ? ` How you talk: ${v.nature.voice}.` : ''}` : '';
      return `${WORLD(sim)}

You are ${v.name}, ${voice}. You are the child of ${parents}.${born} You use small plain words. Always answer with a single JSON object and nothing else.`;
    }
    // Everything that is the same for every grown person comes first, word for word, so the model only has to read
    // it once and can pick up from there each time. Who this one person is comes after.
    const n = v.nature;
    const self = n ? `
What you were born with, as much a part of you as the color of your eyes: ${n.temperament}.
Your fault, which other people notice more than you do: ${n.flaw}. It is real. You act on it. It shows in what you choose and in what you say, and it sometimes costs you.
${n.humor ? `What makes you laugh: ${n.humor}.\n` : ''}${n.voice ? `How you talk: ${n.voice}. Nobody else here talks quite like you.\n` : ''}${n.drawn ? `What you are drawn to: ${n.drawn}.\n` : ''}` : '\n';
    return `${WORLD(sim)} ${HUMAN}
${talk && this.llm.two ? '' : `
${WAYS}
`}
Always answer with a single JSON object and nothing else.

${this.commons()}

You are ${v.name}${v.calling ? `, known here as ${v.calling}` : ''}, ${v.gender === 'm' ? 'a man' : 'a woman'}, ${sim.ageWord(v)}. ${v.personality}${self}${sim.isOld(v) ? '' : 'Like every living thing, you want a mate to lie with and children of your own. That want is as much a part of you as hunger is.'}`;
  }

  // What everyone here knows, the same for whoever is asked: what has been worked out and invented, what is known of
  // the land beyond, who is buried, what has been built. It comes straight after the shared opening and before the
  // person, ordered from what changes least to what changes most, so that as much of it as possible is still fresh in
  // the model's mind from the last person it answered for.
  commons() {
    const sim = this.sim;
    const out = [`Skills people here have worked out: ${sim.worldState().discoveries.join(', ')}.`];
    out.push(`WHAT THE VALLEY GIVES: ${sim.raws().map((r) => `${r} (${RAW[r].where})`).join('; ')}.${sim.knows('ore') ? '' : ' Some of the rocks are streaked green or stained red, which nobody has looked into.'}`);
    if ((sim.materials || []).length) out.push(`WHAT YOUR PEOPLE HAVE LEARNED TO MAKE:\n${sim.materials.slice(-8).map((m) => `- ${m.name}: from ${costText(m.from)}${m.at ? `, at the ${sim.typeName(m.at)}` : ''} (${m.by})`).join('\n')}`);
    const made = sim.inventions.slice(-6);
    if (sim.inventions.length) {
      out.push(`THE LATEST THINGS YOUR PEOPLE HAVE INVENTED (${sim.inventions.length} in all):\n${made.map((i) => `- the ${i.name} (${i.kind === 'knowhow' ? 'know-how' : i.kind}, thought of by ${i.by}): ${i.what} It ${EFFECTS[i.effect]}.`).join('\n')}`);
      const done = sim.coveredNeeds();
      if (done.length) out.push(done.map((c) => `For ${c.need} your people already have ${c.names.slice(-3).join(', ')}. One more thing for that is yours to make, but it would not add to it.`).join('\n'));
    }
    out.push(sim.lore.length ? `WHAT IS KNOWN OF THE LAND BEYOND THE VALLEY:\n${sim.lore.slice(-3).map((l) => `- ${l.who}, day ${l.day}: ${l.text}`).join('\n')}` : 'Nobody has ever come back from beyond the valley to say what is out there.');
    if (sim.dead.length) out.push(`${sim.dead.length} ${sim.dead.length === 1 ? 'person is' : 'people are'} buried here. The latest: ${sim.dead.slice(-4).map((d) => d.name).join(', ')}.`);
    const ways = sim.waysText(); if (ways) out.push(ways);
    out.push(`THE PLACE: ${this.place()}`);
    return out.join('\n\n');
  }

  family(v) {
    const sim = this.sim;
    const bits = [];
    if (v.partner) bits.push(`your partner is ${sim.byId(v.partner).name}${sim.byId(v.partner).away ? ', who is away beyond the valley' : ''}`);
    const kids = sim.childrenOf(v);
    if (kids.length) bits.push(`your children: ${kids.map((k) => `${k.name}${k.stage === 'child' ? ' (still small)' : ''}`).join(', ')}`);
    const parents = v.parents.map((id) => { const p = sim.person(id); return p ? p.name + (sim.byId(id) ? '' : ', who has died') : null; }).filter(Boolean);
    if (parents.length) bits.push(`your parents are ${parents.join(' and ')}`);
    const elders = [...sim.lineage(v)].filter(([, d]) => d === 2).map(([id]) => { const p = sim.person(id); return p ? p.name + (sim.byId(id) ? '' : ', who has died') : null; }).filter(Boolean);
    if (elders.length) bits.push(`your grandparents are ${elders.join(' and ')}`);
    const grandkids = sim.villagers.filter((o) => sim.lineage(o).get(v.id) === 2);
    if (grandkids.length) bits.push(`your grandchildren: ${grandkids.map((k) => k.name).join(', ')}`);
    if (!v.partner && v.stage === 'adult') bits.push('you have no partner');
    return bits.join('; ');
  }

  people(v, limit = 10) {
    const sim = this.sim;
    const others = sim.villagers.filter((o) => o !== v).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y)).slice(0, limit);
    if (!others.length) return 'Nobody else is here.';
    return others.map((o) => {
      const steps = Math.round(Math.hypot(o.x - v.x, o.y - v.y));
      const feel = affinityWord(sim.getAffinity(v, o));
      const kid = o.stage === 'child' ? `, a small child${o.needs.hunger < 30 ? ', hungry' : ''}` : sim.isOld(o) ? ', old now' : '';
      const ill = o.sick ? `, sick with ${o.sick.name}` : '';
      const w = (v.wrongs || {})[o.id];
      const note = (w ? ` You have not forgiven ${o.gender === 'm' ? 'him' : 'her'}: ${o.gender === 'm' ? 'he' : 'she'} ${w.what}.` : '') + ((v.views || {})[o.id] ? ` Your own note on ${o.gender === 'm' ? 'him' : 'her'}: "${v.views[o.id]}"` : '');
      const known = o.calling ? `, known as ${o.calling}` : '';
      if (o.away) return `- ${o.name}${known} (your ${sim.relation(v, o)}; you feel ${feel} toward them): away beyond the valley, nobody knows for how long.${note}`;
      return `- ${o.name}${known} (your ${sim.relation(v, o)}${kid}${ill}; you feel ${feel} toward them): ${sim.actLabel(o)}, ${steps} steps away.${note}`;
    }).join('\n');
  }

  place() {
    const sim = this.sim;
    const done = sim.structures.filter((s) => s.p >= 1);
    if (!done.length && !sim.paths.size) return 'Nothing has been built yet. It is all wild land: trees, rocks, berry bushes, a pond, and wild rabbits, deer, sheep and chickens.';
    const counts = {};
    for (const s of done) counts[s.type] = (counts[s.type] || 0) + 1;
    const parts = Object.entries(counts).map(([t, n]) => { const nm = sim.typeName(t); return `${n} ${nm}${n > 1 ? (nm.endsWith('ch') ? 'es' : 's') : ''}`; });
    if (sim.paths.size) parts.push('some stone paths');
    const named = done.filter((s) => s.label).slice(-4).map((s) => `the ${sim.typeName(s.type)} "${s.label}"`);
    return `Built so far: ${parts.join(', ')}.${named.length ? ' Named places: ' + named.join(', ') + '.' : ''}`;
  }

  // Something for them to notice, different every time, so their thoughts do not go in circles.
  notice(v) {
    const sim = this.sim;
    const t = sim.time;
    const out = [];
    const near = (o, r) => Math.hypot(o.x - v.x, o.y - v.y) < r;
    const beast = sim.animals.filter((a) => a.kind !== 'wolf' && near(a, 7));
    if (beast.length) {
      const a = pick(beast);
      out.push(a.pen ? pick([`The ${a.kind === 'sheep' ? 'sheep are' : 'chickens are'} making a racket in their pen.`, `One of the ${a.kind === 'sheep' ? 'sheep' : 'chickens'} is watching you.`])
        : pick({ deer: ['A deer is grazing not far off.', 'A deer lifts its head and looks right at you.'], rabbit: ['A rabbit darts through the grass.', 'A rabbit is nibbling something nearby.'], sheep: ['A wild sheep is wandering nearby.', 'A sheep bleats somewhere close.'], chicken: ['A wild chicken is scratching in the dirt nearby.', 'A chicken struts past as if it owns the place.'] }[a.kind]));
    }
    const kids = sim.villagers.filter((o) => o.stage === 'child' && !o.sleeping && near(o, 8));
    if (kids.length) { const k = pick(kids); out.push(`${k.name} is nearby, ${sim.actLabel(k)}${k.needs.hunger < 30 ? ' and looking hungry' : ''}.`); }
    const wolf = sim.wolves().find((w) => near(w, 10));
    if (wolf) out.push(pick(['You hear a wolf howl, close.', 'Yellow eyes are watching from the dark.', 'Something large is moving out there in the dark.']));
    const season = sim.season();
    if (Math.random() < 0.5) out.push(pick({
      spring: ['Everything smells of wet earth and new growth.', 'Buds are opening on the bushes.'],
      summer: ['The air is thick and warm.', 'Insects hum in the long grass.'],
      autumn: ['Leaves are coming down in the wind.', 'The air has a bite to it. Winter is not far off.'],
      winter: ['Snow creaks under your feet.', 'Your breath hangs in the air.', 'The cold gets into your bones.', 'The pond is rimmed with ice.'],
    }[season]));
    const lost = sim.dead[sim.dead.length - 1];
    if (lost && sim.day - lost.diedDay <= 3 && Math.random() < 0.6) out.push(`${lost.name} died ${sim.day === lost.diedDay ? 'today' : sim.day - lost.diedDay === 1 ? 'yesterday' : 'a few days ago'}. The grave is still fresh.`);
    const partner = sim.byId(v.partner);
    if (partner && partner.away) out.push(`${partner.name} is still away beyond the valley.`);
    else if (partner && !partner.sleeping) {
      if (partner.needs.energy < 30) out.push(`${partner.name} looks worn out.`);
      else if (partner.needs.hunger < 30) out.push(`${partner.name} looks hungry.`);
      else if (near(partner, 5)) out.push(`${partner.name} is close by, ${sim.actLabel(partner)}.`);
    }
    out.push(t < 0.1 ? 'Dew is still on the grass.' : t < 0.3 ? 'The morning air is cool and clear.' : t < 0.5 ? 'The sun is high and warm.' : t < 0.68 ? 'The afternoon is quiet.' : t < 0.8 ? 'The light is turning gold.' : 'The stars are out.');
    // Only things that are physically there. What they make of them is their own business.
    out.push(pick([
      'A breeze moves through the trees.', 'The pond is as still as glass.', 'Birds are arguing in the trees.',
      'Clouds are moving in from beyond the hills.', 'The grass is bent where something walked through it.', 'Smoke from the fire drifts low.',
      'A fish jumps in the pond.', 'The wind has changed direction.',
    ]));
    // two of them, in random order
    const chosen = out.sort(() => Math.random() - 0.5).slice(0, 2);
    if (wolf && !chosen.some((c) => /wolf|eyes|large/.test(c))) chosen[0] = 'You hear a wolf howl, close.';
    return chosen.join(' ');
  }

  // ---------- what they need, from the ground up ----------

  // The five levels in plain words. A level going unmet drowns out the ones above it, the way hunger drowns out everything.
  // This is what they feel, not what they must do.
  needs(v) {
    const m = this.sim.maslow(v);
    const sentence = (list) => { const t = list.join(', '); return t ? ` ${t[0].toUpperCase()}${t.slice(1)}.` : ''; };
    const shown = m.state === 'unmet' ? m.at + 1 : LEVELS.length;
    const rows = LEVELS.slice(0, shown).map((l, i) => {
      const sc = m.scores[i];
      return `${i + 1}. ${l.name} (${l.what}): ${sc >= (i === 0 ? 50 : 65) ? 'met.' : sc >= 40 ? `partly met.${sentence(m.why[i])}` : `NOT MET.${sentence(m.why[i])}`}`;
    });
    if (shown < LEVELS.length) rows.push(`${LEVELS.slice(shown).map((l) => l.name).join(', ')}: these are above it. You cannot give them much thought while a need below goes unmet.`);
    const why = m.why[m.at].join(', ');
    const press = m.state === 'met' ? 'Every need you have is met. You are as whole as a person gets, and what you do with that is your own affair.'
      : [
        `Your body comes before everything else${why ? `: ${why}` : ''}.`,
        `What weighs on you most is not being safe${why ? `: ${why}` : ''}.`,
        `Your body is looked after and you are safe. What you feel the lack of now is people of your own${why ? `: ${why}` : ''}.`,
        `You are fed, safe and not alone. What gnaws at you now is your standing here${why ? `: ${why}` : ''}. People earn regard here by what they build, what they think up, what they bring in, and what they do for the others.`,
        `You are fed, safe, among your own people and respected. What is missing is something that is yours alone${why ? `: ${why}` : ''}. This is when a person makes a thing nobody asked for, works out a new idea, goes to see what is past the hills, teaches a child, or follows what they are drawn to.`,
      ][m.at];
    return { m, block: rows.join('\n'), press, why };
  }

  // ---------- deciding what to do ----------

  decisionPrompt(v) {
    const sim = this.sim;
    const n = v.needs, inv = v.inv;
    const home = sim.structById(v.home);
    const owner = home ? sim.byId(home.owner) : null;
    const homeLine = !home ? 'none yet'
      : owner === v || (owner && owner.id === v.partner) ? `a ${home.type}${home.label ? ` called "${home.label}"` : ''}`
        : `you still live in ${owner ? owner.name + "'s" : 'your family'} ${home.type}`;

    // What is worth building comes first: what this place lacks, then the things that do real work. A long list of
    // everything anyone ever thought up would bury the choice, so the rest are only named.
    const open = sim.unlocked().filter((t) => STRUCT[t] && !sim.buildBlock(v, t));
    // a new kind of building nobody has put up yet comes near the top: it is the thing this place has just learned
    const rankOf = (t) => (STRUCT[t].home ? 0 : STRUCT[t].custom && !sim.count(t) && !sim.structures.some((st) => st.type === t) ? 0.5 : ['farm', 'storehouse', 'coop', 'pen', 'well', 'workshop', 'campfire'].includes(t) ? 1 : STRUCT[t].custom ? (sim.idleKind(t) ? 5 : 4) : 3) + Math.random() * 0.9;
    const ranked = open.map((t) => [t, rankOf(t)]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
    const builds = ranked.slice(0, 5).map((t) => {
      const miss = sim.missing(v, t);
      const lacking = Object.entries(miss).map(([k, x]) => `${x} more ${k}`).join(' and ');
      return `   - ${sim.typeName(t)}: costs ${costText(STRUCT[t].cost)}. ${STRUCT[t].desc}. ${lacking ? `[you need ${lacking}]` : '[you have enough right now]'}`;
    });
    if (ranked.length > 5) builds.push(`   - also known here: ${ranked.slice(5, 13).map((t) => sim.typeName(t)).join(', ')}${ranked.length > 13 ? ', and more' : ''}`);

    const raws = sim.raws().filter((r) => sim.gatherable(r));
    const room = raws.filter((r) => (inv[r] || 0) < CARRY);
    const full = Object.keys(inv).filter((r) => inv[r] >= CARRY - 1);
    const storehouse = sim.storehouse();
    const foodInReach = inv.food + sim.stored('food');

    // The body, in plain words. Only what is true, and a met need is said to be met.
    const body = [];
    if (n.hunger < 12) body.push('You are starving.');
    else if (n.hunger < 35) body.push('You are hungry.');
    else if (n.hunger < 60) body.push('You could eat, but it is not pressing.');
    else body.push('You are well fed. Food is not on your mind.');
    if (n.energy < 15) body.push('You can barely keep your eyes open.');
    else if (n.energy < 35) body.push('You are tired.');
    else if (n.energy >= 70) body.push('You are rested.');
    if (n.social < 20) body.push('You are lonely.');
    else if (n.social < 45) body.push('You would like some company.');
    if (v.sick) body.push(`You are sick with ${v.sick.name}. Rest and food help a body fight it. Pushing on makes it worse.`);
    if (v.health < 60) body.push(`You are ${v.health < 30 ? 'badly hurt and close to death' : 'hurt and weak'}. Food and rest are what mend a body.`);
    if (sim.age(v) >= v.lifespan * 0.9) body.push('You are very old. You do not have many days left.');

    // Only the facts of who is free and how they feel. Whether to do anything about it is theirs.
    const matches = sim.adults().filter((o) => sim.canPair(v, o));
    const mate = sim.byId(v.partner);
    const heart = [];
    const alone = Math.max(0, sim.day - (v.singleSince ?? v.adultDay ?? sim.day));
    const ache = sim.isOld(v) ? '' : alone >= 8 ? ` You have been grown and alone for ${alone} years, and your body aches for someone of your own the way it aches for food when it is hungry.` : alone >= 2 ? ' You are grown and alone, and some nights your body feels it.' : '';
    if (!v.partner && matches.length) heart.push(`You have no partner.${ache} Those who could make a home with you: ${matches.map((o) => `${o.name} (you feel ${affinityWord(sim.getAffinity(v, o))} toward ${o.gender === 'm' ? 'him' : 'her'})`).join(', ')}.`);
    else if (!v.partner && !sim.isOld(v)) {
      const gone = sim.adults().filter((o) => o.away && sim.canPair(v, o, true));
      heart.push(gone.length ? `You have no partner. The only ones you could make a home with are away beyond the valley: ${gone.map((o) => `${o.name} (you feel ${affinityWord(sim.getAffinity(v, o))} toward ${o.gender === 'm' ? 'him' : 'her'})`).join(', ')}.` : 'You have no partner, and there is nobody here you could make a home with.');
    }
    if (mate && !sim.childrenOf(v).length && !sim.isOld(v)) heart.push(`You and ${mate.name} have no child yet.`);
    const grudges = sim.grudges(v);
    if (grudges.length) heart.push(`What you have not forgiven: ${grudges.slice(0, 3).map((x) => `${x.o.name} ${x.w.what}${x.w.weight >= 3 ? ', and that is blood' : ''}`).join('; ')}.`);

    // Supplies and the season: facts, stated once and calmly.
    const people = sim.here();
    const perDay = people.filter((o) => o.stage === 'adult').length * 1.9 + people.filter((o) => o.stage === 'child').length * 1.2;
    const allFood = sim.stored('food') + people.reduce((sum, o) => sum + o.inv.food, 0);
    const supplies = [];
    if (storehouse) supplies.push(`The shared storehouse holds ${Object.entries(sim.store).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'}. Anyone can build with it or eat from it.`);
    supplies.push(`All the food on hand would feed everyone for about ${Math.max(0, Math.floor(allFood / Math.max(1, perDay)))} days.`);
    const toWinter = sim.daysToWinter();
    const homes = sim.structures.filter((s) => STRUCT[s.type].home && s.p >= 1 && people.some((o) => o.home === s.id)).length;
    const nights = homes ? Math.floor((sim.stored('wood') + people.reduce((sum, o) => sum + o.inv.wood, 0)) / (homes * 2)) : 0;
    const y = sim.yearDays(), toSpring = y - ((sim.day - 1) % y);
    if (sim.isWinter()) supplies.push(`It is winter, ${toSpring} day${toSpring === 1 ? '' : 's'} until spring. Nothing grows: food comes from stores, the coop and pen, fishing and hunting. Each home burns 2 wood a night, and the wood on hand covers about ${nights} nights. Sleeping outside in this cold can kill.`);
    else if (toWinter <= 3) supplies.push(`Winter is ${toWinter} day${toWinter === 1 ? '' : 's'} away. In winter nothing grows, and each home burns 2 wood a night. The wood on hand would cover about ${nights} nights.`);

    // Only what truly needs attention this minute.
    const urgent = [];
    if (v.lastFail) urgent.push(v.lastFail + ' Do something different.');
    if (n.hunger < 35) {
      if (foodInReach > 0) urgent.push(`You have food within reach (${inv.food} on you${storehouse ? `, ${sim.store.food} in the storehouse` : ''}). Eating would settle it.`);
      else urgent.push(`You have no food. Berry bushes${sim.count('farm') ? ', farms' : ''}${sim.count('coop') ? ', the coop' : ''}${sim.count('pen') ? ', the sheep pen' : ''}${sim.knows('fishing') ? ' and the pond' : ''} have food${sim.isWinter() ? ', though the bushes and farms are bare in winter' : ''}.`);
    }
    const hungryKids = sim.childrenOf(v).filter((c) => c.stage === 'child' && c.needs.hunger < 40);
    if (hungryKids.length) urgent.push(`${hungryKids.map((c) => c.name).join(' and ')} ${hungryKids.length > 1 ? 'are' : 'is'} hungry${hungryKids.some((c) => c.needs.hunger < 15) ? ' and getting weak' : ''}. Children eat from the food you carry when you are near them, or from the storehouse. If nobody feeds them, they will die.`);
    const wolves = sim.wolves();
    if (wolves.length) urgent.push(`Wolves are prowling tonight${wolves.some((w) => Math.hypot(w.x - v.x, w.y - v.y) < 9) ? ', and one is close' : ''}. They fear firelight and lantern light, and they cannot get into a home. Anyone caught outside in the dark is in danger, and so are animals in a pen with no light near it.`);
    const sky = sim.weatherNow(), dz = sim.disaster;
    const roofed = v.inside;
    if (sky === 'storm') urgent.push(`A storm is right overhead. Lightning is striking and branches are coming down.${roofed ? ' You are under a roof.' : ' You are out in it. Under a roof is the only safe place.'}`);
    if (sky === 'blizzard') urgent.push(`A blizzard is blowing. Anyone out in it for long will die of cold.${roofed ? ' You are under a roof.' : ' You are out in it.'} The fires eat more wood than usual.`);
    if (sky === 'bitter') urgent.push('The cold today is the kind that kills. A house with no fire tonight is a grave.');
    const blaze = sim.nearestFire(v);
    if (blaze) {
      const dx = blaze.f.x - v.x, dy = blaze.f.y - v.y;
      const where = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
      urgent.push(`Fire is burning ${Math.round(blaze.d)} steps to the ${where}. It runs through trees, bushes and wooden walls, and stops at water, stone and bare ground. ${blaze.d < 8 ? 'It is close.' : ''}`);
    }
    if (dz && dz.kind === 'drought') urgent.push(`There has been no rain for ${sim.day - dz.since + 1} days. The farms and the bushes have stopped bearing. What is in the storehouse, the pond, the animals and the hunt are all there is.`);
    if (dz && dz.kind === 'flood') urgent.push('The pond has flooded. The low ground by the water is under it, and the fishing is too dangerous.');
    if (dz && dz.kind === 'plague') urgent.push(`${dz.name[0].toUpperCase() + dz.name.slice(1)} is going from house to house. It passes between people who are close to each other, and it kills. ${people.filter((o) => o.sick && o.sick.deadly).length} here have it now.`);
    const sickKin = people.filter((o) => o !== v && o.sick && (o.partner === v.id || o.parents.includes(v.id) || v.parents.includes(o.id) || (o.home && o.home === v.home)));
    const untended = sickKin.filter((o) => o.sick.tended !== sim.day);
    if (untended.length) urgent.push(`${untended.map((o) => o.name).join(' and ')} ${untended.length > 1 ? 'are' : 'is'} sick, and nobody has sat with ${untended.length > 1 ? 'them' : untended[0].gender === 'm' ? 'him' : 'her'} today. Someone tending them helps them through it, though sickness can spread to those who come close.`);
    if (sim.isWinter() && homes && nights < 1) urgent.push('There is no firewood for tonight.');
    if (sim.isNight() && n.energy < 60) urgent.push('It is night and you are tired.');
    if (!home && sim.unlocked().includes('shelter')) urgent.push('You have no home. Sleeping on the bare ground is poor rest.');
    if (full.length && !room.length) urgent.push(`Your arms are full. You cannot gather anything until you ${storehouse ? 'store some of it or build with it' : 'build with it'}.`);
    const enemies = people.filter((o) => o !== v && o.stage === 'adult' && (sim.getAffinity(v, o) < 32 || (v.wrongs || {})[o.id]));
    const mortal = enemies.filter((o) => sim.getAffinity(v, o) < 15 || ((v.wrongs || {})[o.id] || {}).weight >= 3);
    // A want that goes unanswered for years stops being a quiet one. It presses the way hunger does. What they do about it is still theirs.
    if (!v.partner && matches.length && !sim.isOld(v) && alone >= 2) urgent.push(`You have been grown and alone for ${alone} years, and the want of a mate and children of your own has grown hard to carry.${sim.villagers.some((o) => o.stage === 'child') ? '' : ' There is not one child in this place.'} ${matches.length === 1 ? `${matches[0].name} is the one person here` : `${matches.map((o) => o.name).join(', ')} are the people here`} you could ask to make a home with you.`);
    const need = this.needs(v);
    if (need.m.at > 0 || need.m.state === 'met' || !urgent.length) urgent.push(need.press);

    const tools = sim.inventions.filter((i) => i.kind === 'tool');
    const mine = tools.filter((i) => (v.items || []).some((it) => it.inv === i.id)).map((i) => `the ${i.name}`);
    const owned = tools.length ? `\nOf the tools your people have invented, you have ${mine.length ? mine.join(', ') : 'none yet'}.\n` : '';
    const project = v.project ? `\nYOUR OWN IDEA, STILL UNFINISHED: ${v.project.idea} (${Math.min(3, v.project.progress)} of 3 tries so far)${v.inventDay === sim.day ? '. You have worked on it today already.' : '.'}\n` : '';
    const doneToday = v.today.slice(-7).filter((t) => /^I (spent|made|built|laid|caught|hunted|talked|gathered|put)/.test(t)).map((t) => t.replace(/^I talked with (\w+)\..*$/, 'I talked with $1.').slice(0, 90));
    const done = doneToday.length ? `\nALREADY DONE TODAY (doing the same again adds nothing):\n${[...new Set(doneToday)].map((t) => `- ${t}`).join('\n')}\n` : '';
    const lastThoughts = (v.thoughts || []).slice(-3);
    const stale = lastThoughts.length ? `\nYOUR LAST THOUGHTS (do not repeat these or their subject, let your mind move on):\n${lastThoughts.map((t) => `- ${t}`).join('\n')}\n` : '';
    const seen = this.notice(v);
    // asked while their hands are still at something: the choice is for when that is done
    const busy = v.plan && !v.plan.filler ? sim.actLabel(v) : '';

    const wants = (v.wants || []).length ? `\nWHAT YOU WANT (you wrote this yourself last night):\n${v.wants.map((w) => `- ${w}`).join('\n')}\n` : '';
    const anySick = people.some((o) => o !== v && o.sick && !sim.satWith(v, o));
    const desperate = n.hunger < 30 && foodInReach < 1;
    const extras = [];
    if ((sim.dangerOutside() || sim.wolves().length) && !v.inside && sim.structures.some((st) => st.p >= 1 && STRUCT[st.type].home)) extras.push('shelter: get under a roof and stay there until it passes.');
    if (anySick) extras.push('tend: sit with someone who is sick and look after them for a good while. to is their name.');
    if (mate && sim.getAffinity(v, mate) < 35) extras.push(`part: tell ${mate.name} it is over between you, and live apart from now on.`);
    if (enemies.length || desperate) extras.push('take: steal from someone. to is their name, target is what you take. They may see you, and they will not forget it.');
    if (enemies.length) extras.push(`fight: go and hit someone you have had enough of (${enemies.slice(0, 3).map((o) => o.name).join(', ')}). to is their name, say is what you shout. Both of you will be hurt, and people have died this way.`);
    if (mortal.length && sim.cfg.violence !== false) extras.push(`kill: go after ${mortal.slice(0, 2).map((o) => o.name).join(' or ')} meaning to end it. to is their name. If you are seen, nobody here will ever look at you the same, and their family will not forgive it.`);
    const little = sim.childrenOf(v).filter((c) => c.stage === 'child');
    if ((v.restUntil || 0) <= sim.day) extras.push(`explore: you need at least 4 food for the road.${little.length ? ` ${little.map((c) => c.name).join(' and ')} would be left behind without you.` : ''}`);

    const mem = v.memory.slice(-7).map((m) => `- Day ${m.d}: ${m.text}`).join('\n') || '- Nothing yet. Everything is new.';
    const diary = v.diary.length ? `\nYOUR DIARY:\n${v.diary.slice(-2).map((d) => `- Day ${d.d}: ${d.text}`).join('\n')}\n` : '';

    const age = sim.years(v);
    const known = (v.calling ? ` People here know you as ${v.calling}.` : '') + (sim.leader === v.id ? ` People here look to you as ${sim.leaderTitle || 'the one who settles things'}: quarrels and broken ways are brought to you.` : '') + ((v.shunnedUntil || 0) > sim.day ? ' You are shunned: nobody will speak to you until the season turns.' : '');
    const ageLine = `You are ${age} years old${sim.isOld(v) ? ', which is old' : age < 25 ? ', which is young' : ''}. People here live to about ${Math.round(sim.yearsFromDays(sim.cfg.lifespanDays ?? 80) / 5) * 5}.`;

    // The choices, shuffled every time so nothing wins just by being listed first.
    const plenty = raws.filter((r) => r !== 'food' && sim.stored(r) >= 100);
    if (allFood / Math.max(1, perDay) >= 10) plenty.push('food');
    const options = [];
    const worth = room.filter((r) => !plenty.includes(r));
    if (worth.length) options.push(`gather: target is one of ${worth.join(', ')}.${plenty.length ? ` (There is already plenty of ${plenty.join(' and ')}.)` : ''}`);
    const foodPlenty = plenty.includes('food');
    if (sim.knows('fishing') && !foodPlenty) options.push(`fish: ${sim.fishShare() > 0.7 ? 'The pond is full of fish.' : sim.fishShare() > 0.35 ? 'The pond has been fished a good deal, and the catches are getting smaller.' : 'The pond is nearly fished out. What is taken now will be a long time coming back.'}`);
    if (sim.knows('hunting') && !foodPlenty) options.push(`hunt: target is deer, rabbit, sheep or chicken. In the valley now: ${sim.wildWords()}.`);
    options.push(`build: target is ${builds.length ? `one of these:\n${builds.join('\n')}\n   Or it is` : ''} something this place has never had, said in your own words.\n   near is one of: here, home, campfire, pond, forest, or a person's name. You may add a "label" to give what you build a name.`);
    options.push(`make: target is what you make.${tools.length ? ` Tools your people know how to make: ${tools.map((i) => i.name).join(', ')}.` : ''}${(sim.materials || []).length ? ` Materials your people know how to make: ${sim.materials.map((m) => m.name).join(', ')}.` : ''}`);
    if (v.inventDay !== sim.day) options.push(v.project && v.project.progress > 0
      ? `invent: keep working on your unfinished idea (${v.project.idea}).`
      : `invent: target is what you are trying to work out.${need.m.state !== 'met' && need.why ? ` What you feel the lack of yourself: ${need.why}.` : ''}`);
    if (n.hunger <= 80 && foodInReach > 0) options.push(`eat: you have ${inv.food} food on you.`);
    options.push('sleep');
    options.push('talk: to is their name. target is what is on your mind to talk about. say is how you begin.');
    options.push('give: to is a person\'s name. target is what you give them, from what you carry.');
    options.push('activity: target is what you do, a short phrase starting with an -ing verb. near is where. to is someone to do it with, if you want company.');
    const fireLit = sim.structures.some((st) => st.type === 'campfire' && st.p >= 1);
    if (fireLit && sim.gatherDay !== sim.day && (sim.time >= 0.6 || sim.isNight()) && people.filter((o) => o !== v && !o.sleeping).length >= 2) options.push(`call: this evening. target is what you bring to the fire: a story, a memory, a song, news, a plan, a rule you want everyone to live by, something you hold true${sim.leader === v.id && (v.cases || []).length ? ', or a judgment on what has been done' : ''}.`);
    if (storehouse && Object.keys(inv).some((k) => inv[k] > sim.keepBack(k))) options.push('store: carry what you are holding to the storehouse.');
    if (matches.length) options.push('propose: to is their name, say is how you ask.');
    if (mate && !mate.away && !mate.sleeping && v.closeDay !== sim.day) options.push(`together: some time alone with ${mate.name}.`);
    for (const e of extras) options.push(e);
    const menu = options.sort(() => Math.random() - 0.5).map((o) => `- ${o}`).join('\n');
    const acts = options.map((o) => o.split(':')[0].trim()).join(' | ');

    return `It is Day ${sim.day}, ${sim.timeWord()}, in ${sim.season()}. The sky: ${sim.weatherWord()}. ${sim.villagers.length} people live here.

${ageLine}${known}
YOUR BODY: ${body.join(' ')}${heart.length ? `\nYOUR HEART: ${heart.join(' ')}` : ''}
Carrying: ${Object.entries(inv).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'} (you can carry ${CARRY} of each thing).
Your own things: ${(v.items || []).length ? v.items.map((it) => sim.itemName(it)).join(', ') : 'nothing yet'}.
Home: ${homeLine}.
Family: ${this.family(v) || 'none'}.

WHAT YOU NEED, from the ground up. A need lower down that goes unmet drowns out the ones above it:
${need.block}

${supplies.join(' ')}

PEOPLE:
${this.people(v, 6)}

RECENT MEMORIES:
${mem}
${diary}${wants}${owned}${project}${done}${stale}
AROUND YOU: ${seen}
RIGHT NOW: ${busy ? `You are busy: ${busy}. ` : ''}${urgent.join(' ')}

WHAT YOU CAN DO (choose exactly one, in no particular order):
${menu}

${v.nature ? `You are ${v.name}: ${v.nature.temperament}. Your fault: ${v.nature.flaw}. Choose as that person would in real life, not as a sensible or a good person would.\n` : ''}${busy ? `You are in the middle of something (${busy}). Choose what you will do next, once that is done, then say why.` : 'Choose what to do first, then say why.'}
Fill in what your action needs and leave the rest empty.
Answer as JSON: {"action": "${acts}", "target": "what the action is aimed at: wood, a deer, a house, the thing you make, what you do", "near": "where", "to": "who", "say": "your words, if you talk", "label": "a name for what you build", "thought": "one plain sentence in your own voice about what you are about to do and why. Do not begin it with the word This"}`;
  }

  normalize(v, raw) {
    const sim = this.sim;
    // a small model sometimes copies the hint text out of the answer template; treat that as blank
    for (const [k, re] of [['target', /^what the action/i], ['near', /^where$/i], ['to', /^who$/i], ['say', /^your words/i], ['label', /^a name for/i]]) if (re.test(String(raw[k] || '').trim())) raw[k] = '';
    const actionText = clip(raw.action, 60).toLowerCase();
    const targetText = clip(raw.target, 60).toLowerCase();
    const all = `${actionText} ${targetText}`;
    const d = { thought: clip(raw.thought, 220), near: clip(raw.near, 40), to: clip(raw.to, 40), say: clip(raw.say, 220), label: clip(raw.label, 40).replace(/^["']|["']$/g, '') };

    const structFrom = (text) => {
      if (STRUCT[text]) return text;
      // a standard building named outright, as a whole word ("a storehouse" is a storehouse, not a house)
      const named = Object.keys(STRUCT).filter((k) => !STRUCT[k].custom && k !== 'grave' && new RegExp(`\\b${k}s?\\b`).test(text)).sort((a, b) => b.length - a.length)[0];
      if (named) return named;
      const made = sim.inventions.find((i) => i.kind === 'building' && text.includes(i.name));
      if (made) return made.key;
      const hit = BUILD_WORDS.find(([, re]) => re.test(text));
      if (!hit) return null;
      if (hit[0] === 'house' && !sim.unlocked().includes('house')) return 'shelter';
      return hit[0];
    };

    const named = sim.byName(d.to) || sim.byName(targetText);
    if (/^invent|devise|figure out|work out|experiment|^discover|^think up/.test(actionText)) {
      d.action = 'invent';
      d.target = clip(raw.target, 90);
    } else if (/^call\b|^summon|gather everyone|^assemble/.test(actionText)) {
      d.action = 'call';
      d.target = clip(raw.target, 40);
    } else if (/^propose|marry|court|woo|\bwed\b/.test(actionText) && named && named !== v) {
      d.action = 'propose';
      d.to = named.name;
    } else if (/^together|^be with|^spend time with/.test(actionText) && v.partner) {
      d.action = 'together';
    } else if (/^part\b|^leave (him|her|my)|separate|break (up|with)|end (it|things)/.test(actionText) && v.partner) {
      d.action = 'part';
    } else if (/^tend|nurse|care for|look after|heal/.test(actionText)) {
      // if they did not say who, it is whoever is sick: their own family first
      const ill = named && named.sick ? named : sim.here().filter((o) => o !== v && o.sick && !sim.satWith(v, o)).sort((a, b) => (sim.kinship(v, b) > 0) - (sim.kinship(v, a) > 0))[0];
      if (!ill) return null;
      d.action = 'tend';
      d.to = ill.name;
    } else if (/steal|\brob\b|^take/.test(actionText) && named && named !== v) {
      d.action = 'take';
      d.to = named.name;
      d.target = resourceFrom(targetText) || resourceFrom(clip(raw.item, 30).toLowerCase()) || 'food';
    } else if (/^kill|murder|slay|end (him|her)/.test(actionText) && named && named !== v && named.stage === 'adult') {
      d.action = 'kill';
      d.to = named.name;
    } else if (/fight|attack|\bhit\b|punch|strike/.test(actionText) && named && named !== v) {
      d.action = 'fight';
      d.to = named.name;
    } else if (/^shelter$|^take shelter|take cover|^go inside|^get inside|^hide\b/.test(actionText)) {
      d.action = 'shelter';
    } else if (/^explore|expedition|leave the valley|journey|set out|travel/.test(actionText)) {
      d.action = 'explore';
    } else if (/build|construct|make|craft|carve|weave|sew|forge|whittle|lay|raise|plant/.test(actionText)) {
      // "make a lantern" is building; "make a warm blanket" is a thing of their own
      const making = /^(make|craft|carve|weave|sew|forge|whittle)/.test(actionText);
      const st = structFrom(targetText) || (making ? null : structFrom(actionText) || structFrom(d.label.toLowerCase()));
      // "a house" is a house. "a bathhouse" is something nobody here has built before.
      const novel = !making && targetText && (!st || (!(STRUCT[st] && STRUCT[st].custom) && somethingElse(targetText, st, sim)));
      if (novel) {
        d.action = 'build'; d.target = ''; d.idea = clip(raw.target, 70);
      } else if (st && (!making || targetText.split(' ').length <= 2 || (STRUCT[st] && STRUCT[st].custom))) {
        d.action = 'build'; d.target = st;
        const other = sim.inventions.find((i) => i.key !== st && d.label.toLowerCase().includes(i.name));
        if (other) d.label = '';
      }
      else {
        const thing = clip(raw.target, 50) || clip(raw.label, 50);
        if (!thing) return null;
        d.action = 'make';
        d.target = thing;
      }
    } else if (/hunt|stalk|spear|kill|slay/.test(actionText) && sim.knows('hunting')) {
      d.action = 'hunt';
      d.target = (/rabbit|deer|sheep|chicken|wolf/.exec(all) || [''])[0];
    } else if (/fish|angl/.test(all) && sim.knows('fishing')) {
      d.action = 'fish';
    } else if (/gather|collect|chop|cut|mine|forag|harvest|pick|hunt|fish|\bget\b|milk|egg/.test(actionText)) {
      d.action = 'gather';
      // if they did not say what, their own thought usually does
      const said = d.thought.toLowerCase();
      const first = ['food', 'wood', 'stone'].map((r) => [r, said.search({ food: /food|berr|fruit|egg|milk|eat|hungr|stomach/, wood: /wood|timber|log|kindling|tree/, stone: /stone|rock|flint/ }[r])]).filter((x) => x[1] >= 0).sort((a, c) => a[1] - c[1])[0];
      d.target = resourceFrom(targetText) || resourceFrom(actionText) || (first && first[0]) || ['wood', 'stone', 'food'].sort((a, b) => (v.inv[a] || 0) - (v.inv[b] || 0))[0];
      if (!sim.gatherable(d.target)) { if (sim.materialByName(d.target)) d.action = 'make'; else d.target = ['wood', 'stone', 'food'].sort((a, b) => (v.inv[a] || 0) - (v.inv[b] || 0))[0]; } // a thing that has to be made is made, not gathered
    } else if (/^store|deposit|stockpile|stash|drop off/.test(actionText)) d.action = 'store';
    else if (/^eat|\beat\b/.test(actionText)) d.action = 'eat';
    else if (/sleep|\bnap\b|go to bed/.test(actionText)) d.action = 'sleep';
    else if (/give|share|offer|gift|hand/.test(actionText)) {
      d.action = 'give';
      d.target = resourceFrom(targetText) || resourceFrom(clip(raw.item, 30).toLowerCase()) || 'food';
      if (!sim.byName(d.to)) d.to = clip(raw.near, 40);
    } else if (/talk|speak|chat|say|ask|tell|greet|visit/.test(actionText)) {
      d.action = 'talk';
      d.target = clip(raw.target, 80);
      const who = sim.byName(d.to) || sim.byName(targetText) || sim.byName(d.near);
      if (!who || who === v) {
        const awake = sim.here().filter((o) => o !== v && !o.sleeping).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0];
        if (!awake) return null;
        d.to = awake.name;
      } else d.to = who.name;
    } else {
      // Anything else is them spending their time their own way.
      // if they did not say what they are doing, their thought usually opens with it ("Watching Lyra play will...")
      const lead = (d.thought.match(/^([A-Z][a-z]+ing\b[^,.;]*?)(?:\s+(?:will|would|should|might|may|helps?|keeps?|is|feels|settles|clears)\b|[,.;]|$)/) || [])[1];
      const what = clip(raw.target, 70) || (lead && lead.length > 8 ? clip(lead, 70) : '') || (/activity|wander|rest/.test(actionText) || DECISION_SCHEMA.properties.action.enum.includes(actionText) ? '' : clip(raw.action, 70));
      if (what && what.length > 3 && !['wood', 'stone', 'food'].includes(what.toLowerCase())) { d.action = 'activity'; d.target = what; }
      else d.action = 'wander';
    }
    return d;
  }

  // Ask what this person does next. They may be asked while still busy with something (ahead), so the answer is
  // ready when they finish: people think about what comes next while their hands are at work.
  // Their own last few lines, shown back so the next one is not the same line again. A person who has already
  // been asked something today is reminded of it, so the second answer is a real second answer.
  fresh(v) {
    const lines = (v.said || []).slice(-3);
    return lines.length ? `\nTHINGS YOU HAVE SAID LATELY (do not say them again, and do not start the same way; real people do not repeat themselves):\n${lines.map((l) => `- "${l}"`).join('\n')}\n` : '';
  }
  // whether this person's words and choices come from the model at all
  quiet(v) { return !this.llm.online || (v && !this.sim.inLight(v)); }

  decide(v, ahead = false) {
    const sim = this.sim;
    if (!this.tally) this.tally = { model: 0, instinct: 0, unreadable: 0, background: 0 };
    const ask = v.askId = (v.askId || 0) + 1;
    const mine = () => sim.villagers.includes(v) && v.askId === ask;
    const useInstinct = () => { this.tally.instinct++; v.failStreak = 0; setTimeout(() => { if (mine()) sim.deliver(v, this.instinct(v)); }, 500 + Math.random() * 900); };
    // Everyone gets heard. Rather than act on instinct when the line is long, a person waits their turn. Only if the
    // line is absurdly long does instinct step in. Nobody falls back on instinct for a choice that is not due yet.
    // someone in the background lives by instinct, and is not counted against the model
    if (this.llm.online && !sim.inLight(v)) { if (ahead) return false; this.tally.background++; v.asking = true; v.failStreak = 0; setTimeout(() => { if (mine()) sim.deliver(v, this.instinct(v)); }, 500 + Math.random() * 900); return true; }
    const lost = !this.llm.online || v.failStreak >= 3 || this.llm.waiting('small', 2) >= (this.llm.cfg.maxWaiting || Math.max(8, sim.adults().length + 4));
    if (lost && ahead) return false;
    v.asking = true;
    if (lost) { useInstinct(); return true; }
    const since = sim.clock;
    // The question is put together when their turn comes, not when they joined the line, so they decide about the
    // moment they are actually in. If the moment has passed (they fell asleep, got pulled into a talk), nothing is asked.
    const build = () => (mine() && v.asking && sim.canDecide(v) ? [{ role: 'system', content: this.system(v) }, { role: 'user', content: this.decisionPrompt(v) }] : null);
    // If the model's answer cannot be read, ask once more before falling back on instinct.
    const attempt = (left) => this.llm.ask(2, build, DECISION_SCHEMA, 420, { mind: 'small' }).then((raw) => {
      if (!mine()) return; // they have moved on to something else since
      if (raw && raw.__skip) { v.asking = false; return; } // they will ask again when they are free to
      const d = raw ? this.normalize(v, raw) : null;
      if (d) { this.tally.model++; sim.noteWait(sim.clock - since); return sim.deliver(v, d); }
      this.tally.unreadable++;
      if (left > 0 && this.llm.online) return attempt(left - 1);
      if (v.plan) { v.asking = false; return; } // still busy: they will simply think again when they are done
      this.tally.instinct++;
      sim.deliver(v, this.instinct(v));
    });
    attempt(1);
    return true;
  }

  // ---------- conversation ----------

  async reply(speaker, listener, lines, last, topic = '') {
    const sim = this.sim;
    const canned = () => ({ say: pick(speaker.stage === 'child' ? KID_LINES : CANNED_REPLIES), feeling: pick(['warmer', 'same', 'same']) });
    if (this.quiet(speaker) && this.quiet(listener)) { await new Promise((r) => setTimeout(r, 1200)); return canned(); }
    const child = speaker.stage === 'child';
    const mood = child ? '' : `You are ${energyWord(speaker.needs.energy)} and ${hungerWord(speaker.needs.hunger)}. `;
    const mind = speaker.memory.slice(-4).map((m) => `- ${m.text.slice(0, 200)}`).join('\n');
    const wants = !child && (speaker.wants || []).length ? `\nWhat you want from life right now:\n${speaker.wants.map((w) => `- ${w}`).join('\n')}\n` : '';
    const lost = sim.dead.slice(-3).map((d) => `${d.name} (${d.cause})`).join(', ');
    const convo = lines.map((l) => `${l.who === speaker.name ? 'You' : l.who}: "${l.text}"`).join('\n');
    const prompt = `It is Day ${sim.day}, ${sim.timeWord()}, in ${sim.season()}. The sky: ${sim.weatherWord()}. ${mood}
You are talking with ${listener.name}${listener.calling ? `, known as ${listener.calling}` : ''} (your ${sim.relation(speaker, listener)}; you feel ${affinityWord(sim.getAffinity(speaker, listener))} toward them).${topic ? `\nWhat this talk is about: ${topic}.` : ''}
${(speaker.views || {})[listener.id] ? `Your own note on ${listener.name}, from before: "${speaker.views[listener.id]}"\n` : ''}${mind ? `\nOn your mind lately:\n${mind}\n` : ''}${wants}${lost ? `\nThe dead: ${lost}.\n` : ''}
The conversation so far:
${convo}

${this.fresh(speaker)}Say your next line out loud, in your own voice${speaker.nature && speaker.nature.voice ? ` (${speaker.nature.voice})` : ''}. Say as much or as little as you would really say. This is a real conversation, not small talk. Answer what was actually said. You can ask something you truly want to know, admit something, disagree, tease, remember something, or say what you want. You do not have to be agreeable. ${last ? 'This is the last thing said, so bring it to a close the way people do.' : ''}
"feeling" is what this talk is doing to how you feel about ${listener.name}: "same" when nothing has changed, which is most talks; "colder" if ${listener.gender === 'm' ? 'he' : 'she'} has annoyed you, brushed you off, hurt you or let you down; "warmer" only if something said here truly drew you closer.
"view" is your private note to yourself about ${listener.name}, one honest sentence, for the next time you deal with ${listener.gender === 'm' ? 'him' : 'her'}.
Answer as JSON: {"say": "...", "feeling": "warmer | same | colder", "view": "..."}`;
    const r = await this.llm.ask(1, [{ role: 'system', content: this.system(speaker, true) }, { role: 'user', content: prompt }], REPLY_SCHEMA, 400);
    if (!r || !r.say) return canned();
    return { say: clip(r.say, 700), feeling: /warm/i.test(r.feeling) ? 'warmer' : /cold/i.test(r.feeling) ? 'colder' : 'same', view: clip(r.view, 160) };
  }

  // Speaking to everyone at the fire.
  async address(v, kind, guests) {
    const sim = this.sim;
    if (this.quiet(v)) return { say: pick(['When we came here there was nothing. Look around you now. Every wall and every row was somebody\'s tired hands. Remember that when the work feels endless.', 'I want to give thanks. For the fire, for the food put by, for each of you still here. That is all I have to say.']) };
    const mem = v.memory.slice(-6).map((m) => `- Day ${m.d}: ${m.text.slice(0, 180)}`).join('\n');
    const lost = sim.dead.slice(-4).map((d) => `${d.name}, who died of ${d.cause}`).join('; ');
    const grudges = sim.grudges(v).slice(0, 3).map((x) => `${x.o.name} ${x.w.what}`).join('; ');
    const leader = sim.leader === v.id;
    const prompt = `It is the evening of Day ${sim.day}, in ${sim.season()}. You have called everyone to the fire: ${guests.map((g) => g.name).join(', ')} have come and are listening.${leader ? ` People here look to you as ${sim.leaderTitle || 'the one who settles things'}.` : ''}
You said you would share ${kind}.

What you have lived lately:
${mem}
${(v.wants || []).length ? `\nWhat you want: ${v.wants.join(' ')}\n` : ''}${lost ? `\nThe dead: ${lost}.\n` : ''}${grudges ? `\nWhat you hold against people here: ${grudges}.\n` : ''}${v.tale ? `\nWhat you saw beyond the valley: ${v.tale}\n` : ''}
${this.fresh(v)}Now say it, out loud, to all of them, in your own voice, for as long as you have something to say. Make it yours: drawn from what you have actually lived, seen, lost or hoped for in this place.

This is also the one place where the people decide things together. If what you have to say is really a rule you want everyone here to live by from now on ("nobody takes from another's store", "the catch is shared", "a killer leaves the valley"), say it plainly as one sentence in "rule", and the people will answer yes or no. If it is something you believe is true about the world, the dead, the sky or what made all this, and you want it held true by everyone, put it in "belief". Most evenings there is no rule and no belief, and both are left empty. Never invent one to fill the space.
"about" is what a rule concerns: ${['stealing', 'killing', 'fighting', 'food and the store', 'work', 'marriage and beds', 'the dead', 'the fire', 'strangers and the land beyond', 'children', 'other'].join(', ')}.
Answer as JSON: {"say": "...", "rule": "", "belief": "", "about": "other"}`;
    return this.llm.ask(1, [{ role: 'system', content: this.system(v, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { say: { type: 'string' }, rule: { type: 'string' }, belief: { type: 'string' }, about: { type: 'string', enum: ['stealing', 'killing', 'fighting', 'food and the store', 'work', 'marriage and beds', 'the dead', 'the fire', 'strangers and the land beyond', 'children', 'other'] } }, required: ['say', 'rule', 'belief', 'about'] }, 600);
  }

  // Someone at the fire has put a rule or a belief to everyone. This person answers for themselves.
  async vote(o, v, way) {
    const sim = this.sim;
    const gut = () => {
      // without words of their own: the warm agree with people they like, the sly with what suits them, the honest with what is plainly right
      let p = 0.45 + (sim.getAffinity(o, v) - 50) / 120 + 0.08 * sim.gene(o, 'warmth') + (way.kind === 'rule' && ['stealing', 'killing', 'fighting'].includes(way.about) ? 0.12 * sim.gene(o, 'honest') : 0) + (way.kind === 'rule' && way.about === 'work' ? -0.12 * -sim.gene(o, 'drive') : 0);
      if (way.kind === 'rule' && ['stealing', 'killing', 'fighting'].includes(way.about) && (o.killed || Object.values(o.wrongs || {}).length)) p -= 0.05;
      return { yes: Math.random() < Math.max(0.1, Math.min(0.9, p)), say: '' };
    };
    if (this.quiet(o)) { await new Promise((r) => setTimeout(r, 600 + Math.random() * 800)); return gut(); }
    const prompt = `It is the evening of Day ${sim.day}. Everyone is at the fire. ${v.name} (your ${sim.relation(o, v)}; you feel ${affinityWord(sim.getAffinity(o, v))} toward ${v.gender === 'm' ? 'him' : 'her'}) has just stood up and said that from now on ${way.kind === 'rule' ? 'everyone here should live by this' : 'everyone here should hold this true'}:
"${way.text}"
${(o.views || {})[v.id] ? `Your own note on ${v.name}: "${o.views[v.id]}"\n` : ''}${sim.grudges(o).some((x) => x.o === v) ? `You have not forgiven ${v.name}: ${sim.grudges(o).find((x) => x.o === v).w.what}.\n` : ''}${way.kind === 'rule' && ['stealing', 'fighting', 'killing', 'marriage and beds'].includes(way.about) ? `Think about whether this would fall on you, or on your own people.\n` : ''}
Everyone answers in turn, out loud, yes or no. Answer as the person you are, not as a sensible one: for what it does for you and yours, for whether you trust ${v.name}, for what you believe. Say it in your own voice, in one short line.
Answer as JSON: {"say": "...", "answer": "yes | no"}`;
    const r = await this.llm.ask(2, [{ role: 'system', content: this.system(o, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { say: { type: 'string' }, answer: { type: 'string', enum: ['yes', 'no'] } }, required: ['say', 'answer'] }, 120);
    if (!r || !r.answer) return gut();
    return { yes: /yes/i.test(String(r.answer)), say: clip(r.say, 220) };
  }

  // The one people look to hears a case at the fire and says what is to be done.
  async judge(L, who, way, by, what) {
    const sim = this.sim;
    const options = ['warned', 'must give back', 'shunned for a season', 'driven out', 'nothing'];
    if (this.quiet(L)) { await new Promise((r) => setTimeout(r, 1200)); return { say: `${who.name}. You know what you did. Do not let it happen again.`, penalty: way && way.about === 'killing' ? 'driven out' : 'warned' }; }
    const prompt = `It is the evening of Day ${sim.day}. Everyone is at the fire, and they have brought a case to you, because you are ${sim.leaderTitle || 'the one people look to'}.
${who.name} (your ${sim.relation(L, who)}; you feel ${affinityWord(sim.getAffinity(L, who))} toward ${who.gender === 'm' ? 'him' : 'her'})${who.calling ? `, known as ${who.calling}` : ''}, ${sim.years(who)} years old, ${what ? `${what}` : 'broke a way of this place'}.${way ? ` The way the people agreed on: "${way.text}"${way.broken > 1 ? ` It has been broken ${way.broken} times now.` : ''}` : ''}${by ? ` ${by.name} (your ${sim.relation(L, by)}) is the one wronged, and is standing here.` : ''}
${(L.views || {})[who.id] ? `Your own note on ${who.name}: "${L.views[who.id]}"\n` : ''}${who.shunnedUntil > sim.day ? `${who.name} is already shunned.\n` : ''}${Object.values(who.wrongs || {}).length || who.killed ? `${who.name} has been in trouble before.` : `This is the first time ${who.name} has been before you.`}
What is done to ${who.name} is yours to say, and everyone will remember it, and judge you by it: "warned", in front of all; "must give back" what was taken, to the one wronged; "shunned for a season", so nobody speaks to ${who.gender === 'm' ? 'him' : 'her'} and ${who.gender === 'm' ? 'he' : 'she'} eats alone; "driven out" of the valley for good, which is as near to death as a judgment comes; or "nothing".
${this.fresh(L)}Speak to ${who.name} and to everyone, in your own voice. Then the judgment.
Answer as JSON: {"say": "...", "penalty": "${options.join(' | ')}"}`;
    const r = await this.llm.ask(1, [{ role: 'system', content: this.system(L, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { say: { type: 'string' }, penalty: { type: 'string', enum: options } }, required: ['say', 'penalty'] }, 400);
    return r && r.penalty ? { say: clip(r.say, 600), penalty: r.penalty } : null;
  }

  // What the people call the one they look to. Theirs to name.
  async title(v) {
    if (this.quiet(v)) return { title: pick(['the elder', 'the headman', 'the one who settles things']) };
    const sim = this.sim;
    const prompt = `People in this village have started to look to ${v.name}${v.calling ? ` (${v.calling})` : ''}, ${v.gender === 'm' ? 'a man' : 'a woman'} of ${sim.years(v)}, when there is a quarrel to settle or a thing to decide. Nobody chose it; it happened. ${sim.ageLine()}
What do people here call ${v.gender === 'm' ? 'him' : 'her'} now, in two or three plain words, the way such a person would be called in a place like this: "the headman", "the old mother", "chief", "the judge", "grandfather", or whatever fits ${v.name} and these people. Start with "the" unless it is a bare title.
Answer as JSON: {"title": "..."}`;
    return this.llm.ask(3, [{ role: 'system', content: 'You name things the way plain people in a small village long ago would. Always answer with a single JSON object and nothing else.' }, { role: 'user', content: prompt }], obj('title'), 40);
  }

  // The want has become too strong to put off. They choose who to ask, and how.
  async court(v, list, alone) {
    if (this.quiet(v)) return null;
    const sim = this.sim;
    const who = list.map((o) => `- ${o.name}, ${o.gender === 'm' ? 'a man' : 'a woman'} of ${sim.years(o)}${o.calling ? `, known as ${o.calling}` : ''} (your ${sim.relation(v, o)}; you feel ${affinityWord(sim.getAffinity(v, o))} toward ${o.gender === 'm' ? 'him' : 'her'})${(v.views || {})[o.id] ? `. Your own note on ${o.gender === 'm' ? 'him' : 'her'}: "${v.views[o.id]}"` : ''}`).join('\n');
    const prompt = `It is Day ${sim.day}, ${sim.timeWord()}, in ${sim.season()}.
You have been grown and alone for ${alone} years. The want of a mate and children of your own has become stronger than anything else you want today, and you are going to ask someone to make a home and a life with you.${sim.villagers.some((o) => o.stage === 'child') ? '' : ' There is not one child in this place.'}

The people you could ask:
${who}

${this.fresh(v)}Choose who you ask. Then say what you say to them, out loud, in your own voice${v.nature && v.nature.voice ? ` (${v.nature.voice})` : ''}.
Answer as JSON: {"to": "a name from the list", "say": "your words to them", "thought": "one plain sentence, to yourself, about why this one"}`;
    const r = await this.llm.ask(1, [{ role: 'system', content: this.system(v, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { to: { type: 'string', enum: list.map((o) => o.name) }, say: { type: 'string' }, thought: { type: 'string' } }, required: ['to', 'say', 'thought'] }, 320);
    if (!r || !r.to) return null;
    return { to: clip(r.to, 20), say: clip(r.say, 600), thought: clip(r.thought, 200) };
  }

  async answer(t, v, say) {
    const sim = this.sim;
    const fallback = () => (sim.getAffinity(t, v) >= 45 ? { say: 'Yes. Let us make a home.', answer: 'yes' } : { say: 'Give me time. Not yet.', answer: 'not yet' });
    if (!this.llm.online) { await new Promise((r) => setTimeout(r, 1200)); return fallback(); }
    const others = sim.adults().filter((o) => o !== v && sim.canPair(t, o)).map((o) => o.name);
    const prompt = `It is Day ${sim.day}, ${sim.timeWord()}, in ${sim.season()}. The sky: ${sim.weatherWord()}. ${sim.villagers.length} people live here.
${v.name} (your ${sim.relation(t, v)}; you feel ${affinityWord(sim.getAffinity(t, v))} toward ${v.gender === 'm' ? 'him' : 'her'}) has come to you and asked you to make a home and a life together. ${v.gender === 'm' ? 'His' : 'Her'} words: "${say}"
${(t.views || {})[v.id] ? `Your own note on ${v.name}: "${t.views[v.id]}"\n` : ''}${others.length ? `The only others you could make a home with are ${others.join(' and ')}.` : 'There is nobody else here you could make a home with.'}
${(t.wants || []).length ? `What you want from life: ${t.wants.join(' ')}\n` : ''}
${t.partner || sim.isOld(t) ? '' : `You have been grown and alone for ${Math.max(0, sim.day - (t.singleSince ?? t.adultDay ?? sim.day))} years yourself, and your body wants a mate and children as surely as it wants food.${sim.villagers.some((o) => o.stage === 'child') ? '' : ' There is not one child in this place, and no couple left who could have one.'}\n`}${(t.askedBy || []).filter((a) => a.day === sim.day && a.who !== v.name).map((a) => `${a.who} asked you the very same thing earlier today, and you answered: "${a.said}". This is ${v.name}, not ${a.who}, and you cannot make a home with both.\n`).join('')}${this.fresh(t)}This is a serious question, and the answer is yours alone. Answer in your own voice, in your own words.
Answer as JSON: {"say": "...", "answer": "yes | not yet | no"}`;
    const r = await this.llm.ask(1, [{ role: 'system', content: this.system(t, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { say: { type: 'string' }, answer: { type: 'string', enum: ['yes', 'not yet', 'no'] } }, required: ['say', 'answer'] }, 300);
    if (!r || !r.say) return fallback();
    return { say: clip(r.say, 600), answer: String(r.answer || '') };
  }

  async kidLine(v) {
    if (this.sim.years(v) < 2) return null; // a baby has no words yet
    if (this.quiet(v)) return Math.random() < 0.5 ? { say: pick(KID_LINES) } : null;
    const prompt = `It is Day ${this.sim.day}, ${this.sim.timeWord()}. You are ${this.sim.actLabel(v)}.
${this.place()}
Nearby:
${this.people(v, 3)}

Say something out loud, the way a kid that age would. Answer as JSON: {"say": "..."}`;
    const r = await this.llm.ask(5, [{ role: 'system', content: this.system(v) }, { role: 'user', content: prompt }], obj('say'), 160, { mind: this.llm.waiting('big') < 4 ? 'big' : 'small' });
    return r && r.say ? { say: clip(r.say, 400) } : null;
  }

  // ---------- life events ----------

  async diary(v, events) {
    if (this.quiet(v)) return null;
    const prompt = `The sun is going down on Day ${this.sim.day}. Here is what happened to you today:
${events.map((e) => `- ${e}`).join('\n')}

${(v.wants || []).length ? `What you said you wanted before:\n${v.wants.map((w) => `- ${w}`).join('\n')}\n` : ''}${(() => { const nd = this.needs(v); return nd.m.state === 'met' ? 'Every need you have is met tonight.\n' : `What you feel the lack of most tonight: ${LEVELS[nd.m.at].what}${nd.why ? ` (${nd.why})` : ''}.\n`; })()}
Write today's diary entry, first person, honest about how you feel, as long or as short as the day deserves. Do not just list what you did.
Then decide what you want now. Up to three wants, each one short sentence in your own words. They are yours: keep an old one, drop it, or change your mind. They can be about anything: a person, a thing to make, a place, a fear, a grudge, a hope.
Answer as JSON: {"diary": "...", "wants": ["I want ...", "I want ..."]}`;
    return this.llm.ask(4, [{ role: 'system', content: this.system(v, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { diary: { type: 'string' }, wants: { type: 'array', items: { type: 'string' } } }, required: ['diary', 'wants'] }, 500);
  }

  async tale(v, days, find) {
    if (this.quiet(v)) return { story: `I walked ${days} day${days === 1 ? '' : 's'} past the last trees and came to ${find.place}. Out there I found ${find.text}.` };
    const known = this.sim.lore.length ? `What others have told of the land beyond:\n${this.sim.lore.map((l) => `- ${l.who}: ${l.text}`).join('\n')}\n` : 'Nobody has been out there before you.\n';
    const prompt = `You have just come home after ${days} day${days === 1 ? '' : 's'} beyond the valley, the first time you have ever left it. It is ${this.sim.season()}.
${known}
You went a way nobody has gone before. What you came to: ${find.place}.
One more thing is certain: out there you found ${find.text}.
The rest is yours to tell. What was it like to stand there? What frightened you? Tell only what you yourself saw, which is different from what the others saw. Tell it the way you would tell your family by the fire, three or four sentences, first person.
Answer as JSON: {"story": "..."}`;
    return this.llm.ask(3, [{ role: 'system', content: this.system(v, true) }, { role: 'user', content: prompt }], obj('story'), 260);
  }

  // The idea has come together. What is it, exactly? The inventor decides.
  // Someone wants a building that does not exist yet. They say what it is.
  // What everyone here has to work with, said the same way for every question about making something.
  stock(v) {
    const sim = this.sim;
    const raws = sim.raws().map((r) => `${r} (${RAW[r].where})`).join('; ');
    const made = (sim.materials || []).map((m) => `${m.name} (made from ${costText(m.from)}${m.at ? ` at the ${sim.typeName(m.at)}` : ''})`).join('; ');
    const built = [...new Set(sim.structures.filter((st) => st.p >= 1).map((st) => sim.typeName(st.type)))].join(', ');
    const known = sim.inventions.slice(-14).map((i) => `the ${i.name}${i.kind === 'knowhow' ? ' (a way of doing things)' : i.kind === 'tool' ? ' (a tool)' : ''}`).join(', ');
    return `MATERIALS THE VALLEY GIVES: ${raws}.
MATERIALS YOUR PEOPLE HAVE LEARNED TO MAKE: ${made || 'none yet'}.
WHAT STANDS IN THE VILLAGE: ${built || 'nothing yet'}.
SKILLS: ${sim.worldState().discoveries.join(', ')}. THINGS INVENTED (${sim.inventions.length} in all${sim.inventions.length > 14 ? ', the latest' : ''}): ${known || 'nothing yet'}.
${sim.ageLine()}`;
  }
  // the fields every spec shares: what it is made of, what it marks, and how it looks
  specSchema(kinds, extra = {}) {
    const sim = this.sim;
    const mats = sim.materialNames();
    const buildings = [...new Set(sim.structures.filter((st) => st.p >= 1).map((st) => sim.typeName(st.type)))];
    return {
      type: 'object',
      properties: {
        name: { type: 'string' }, kind: { type: 'string', enum: kinds }, what: { type: 'string' },
        uses: { type: 'array', items: { type: 'string', enum: mats }, maxItems: 3 },
        at: { type: 'string', enum: ['none', ...buildings] },
        ...extra,
        effect: { type: 'string', enum: Object.keys(EFFECTS) },
        tags: { type: 'array', items: { type: 'string', enum: LANDMARKS }, maxItems: 3 },
        shape: { type: 'string', enum: SHAPES }, color: { type: 'string', enum: COLORS }, size: { type: 'string', enum: ['small', 'large'] },
      },
      required: ['name', 'kind', 'what', 'uses', 'at', ...Object.keys(extra), 'effect', 'tags', 'shape', 'color', 'size'],
    };
  }
  specLines() {
    return `- uses: what it is made of or made from, up to three, chosen only from the materials listed above. A thing cannot be made of what nobody here has.
- at: the building where it is made or used, if it needs one (a kiln, a forge, a workshop), from the ones standing. Or "none".
- effect: the one real thing it does for people's bodies, work or hearts: ${Object.entries(EFFECTS).filter(([k]) => k !== 'none').map(([k, t]) => `${k} (${t})`).join('; ')}. Or "none" if it is for a reason of your own.
- tags: which of these turning points, if any, it truly is or brings: ${LANDMARKS.filter((t) => t !== 'other').join(', ')}. Most things are none of these; leave the list empty then. Say metal only for a real metal, writing only for real marks that hold words.
- shape, color, size: what it looks like. Shapes: ${SHAPES.join(', ')}.`;
  }

  async buildingSpec(v, idea) {
    if (!this.llm.online) return null;
    const sim = this.sim;
    const prompt = `You have decided this place should have something it has never had: ${idea}.

${this.stock(v)}
${(v.wants || []).length ? `\nWhat you have been wanting: ${v.wants.join(' ')}\n` : ''}
Say exactly what it is. It is your idea, so it is yours to name and to say what it is for. It must be something hands could really build from the materials your people have, standing on what they already know.

- name: what people will call it, two or three plain words.
- what: one sentence saying what it is and what people do there.
${this.specLines()}

Answer as JSON: {"name": "...", "kind": "building", "what": "...", "uses": ["..."], "at": "none", "effect": "...", "tags": [], "shape": "...", "color": "...", "size": "small | large"}`;
    return this.llm.ask(2, [{ role: 'system', content: this.system(v, true) }, { role: 'user', content: prompt }], this.specSchema(['building']), 300);
  }

  async inventionSpec(v, idea) {
    if (!this.llm.online) return null;
    const sim = this.sim;
    const prompt = `For days you have been working at an idea: ${idea}. Today it finally came together.

${this.stock(v)}
${(v.wants || []).length ? `\nWhat you have been wanting: ${v.wants.join(' ')}\n` : ''}${(() => { const nd = this.needs(v); return nd.m.state !== 'met' && nd.why ? `What you yourself feel the lack of: ${nd.why}.\n` : ''; })()}
Now say exactly what you have worked out. It must be something hands could really make from the materials your people have, standing on what is already known: each new thing is one step past the last, the way it really went for people. It can be modest, or it can be the thing that changes everything for your grandchildren. It is yours, so name it yourself.

- name: what people will call it, two or three plain words.
- kind: "building" if it stands in the village and people use it; "tool" if each person makes one to carry and use; "knowhow" if it is a way of doing something that everyone can simply learn; "material" if it is a new stuff to make things from (a metal got out of ore, bricks fired from clay, rope twisted from reeds, cloth woven from wool), which people then make in batches.
- makes: for a material only, the one plain name of the stuff itself, like "copper" or "bricks". Otherwise leave it empty.
- what: one sentence saying what it is and how it is made or used.
${this.specLines()}

Answer as JSON: {"name": "...", "kind": "building | tool | knowhow | material", "makes": "", "what": "...", "uses": ["..."], "at": "none", "effect": "...", "tags": [], "shape": "...", "color": "...", "size": "small | large"}`;
    return this.llm.ask(3, [{ role: 'system', content: this.system(v, true) }, { role: 'user', content: prompt }], this.specSchema(['building', 'tool', 'knowhow', 'material'], { makes: { type: 'string' } }), 340);
  }

  async nameChild(mother, father, gender, taken) {
    if (!this.llm.online) return null;
    const prompt = `You and ${father.name} have just had a baby ${gender === 'm' ? 'boy' : 'girl'}. Choose a name for ${gender === 'm' ? 'him' : 'her'}.
Names already in use here, which you cannot pick: ${taken.join(', ')}.
Recent things on your mind:
${mother.memory.slice(-4).map((m) => `- ${m.text}`).join('\n')}

Answer as JSON: {"name": "a single first name", "why": "one sentence on why you chose it"}`;
    return this.llm.ask(3, [{ role: 'system', content: this.system(mother, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'why'] }, 100);
  }

  // Who a person is. Nothing here is picked for them: the model is shown who already exists and what the world was like,
  // and has to come back with somebody new.
  // The person's temperament and fault are already settled: they were born with them. The model fills in the rest.
  async nature(v, kind, circumstances = '') {
    if (!this.llm.online) return null;
    const sim = this.sim;
    const he = v.gender === 'm' ? 'he' : 'she', him = v.gender === 'm' ? 'him' : 'her', his = v.gender === 'm' ? 'his' : 'her';
    const shuffle = (list, n) => list.slice().sort(() => Math.random() - 0.5).slice(0, n).join(', ');
    const parents = (v.parents || []).map((id) => sim.person(id)).filter((p) => p && p.nature).map((p) => `- ${p.name}: ${p.nature.temperament}. Fault: ${p.nature.flaw}.`).join('\n');
    const voices = shuffle(['talks far too much', 'says almost nothing', 'jokes about everything', 'blunt to the point of rude', 'asks endless questions', 'mutters and grumbles', 'tells everything as a story', 'bossy and brisk', 'soft and roundabout', 'loud', 'dry and teasing', 'earnest, never jokes'], 4);
    const pulls = shuffle(['dogs and other animals', 'the fire', 'the pond', 'small children', 'food', 'making things by hand', 'the hunt', 'old stories', 'other people\'s business', 'climbing', 'the edge of the valley', 'fine things to wear', 'singing', 'a good fight', 'bargaining', 'growing things', 'sleeping in the sun', 'being first', 'pretty girls', 'strong drink', 'winning'], 6);
    const laughs = shuffle(['other people falling over', 'dirty jokes', 'teasing', 'pranks', 'rarely laughs', 'laughs at everything', 'someone getting caught out', 'animals doing foolish things'], 4);
    let intro, life = '';
    if (kind === 'adult') {
      const done = [v.calling ? `known here as ${v.calling}` : '', v.partner ? `partner of ${sim.byId(v.partner).name}` : 'has no partner', sim.childrenOf(v).length ? `parent of ${sim.childrenOf(v).map((c) => c.name).join(', ')}` : 'has no children'].filter(Boolean).join('; ');
      intro = `${v.name} is ${v.gender === 'm' ? 'a man' : 'a woman'} of ${sim.years(v)} in a small village of hunters and farmers, long before metal or writing.`;
      life = `\n${v.name}'s life so far: ${done}.\n`;
    } else if (kind === 'child') {
      intro = `${v.name} is a ${v.gender === 'm' ? 'boy' : 'girl'} of ${sim.years(v)} in a small village of hunters and farmers, long before metal or writing.`;
      life = (v.lessons || []).length ? `\nWhat ${his} childhood has held so far:\n${v.lessons.slice(-4).map((l) => `- ${l}`).join('\n')}\n` : '';
    } else {
      intro = `A ${v.gender === 'm' ? 'boy' : 'girl'} named ${v.name} has just been born in a small village of hunters and farmers, long before metal or writing.`;
      life = circumstances ? `\nThe world ${he} was born into: ${circumstances}\n` : '';
    }
    const prompt = `${intro}
What ${he} was born with, as settled as the color of ${his} eyes: ${v.nature.temperament}.
${his[0].toUpperCase() + his.slice(1)} fault, as the neighbors say it behind ${his} back: ${v.nature.flaw}.
${parents ? `\n${his[0].toUpperCase() + his.slice(1)} parents:\n${parents}\n` : ''}${life}
Keeping to that, fill in the rest of ${him}. Use short plain words, the kind a neighbor uses. No fine phrases, nothing dreamy, nothing a real villager would not say.
- humor: what makes ${him} laugh, six words or fewer. Something like: ${laughs}.
- voice: how ${he} talks, six words or fewer. Something like: ${voices}.
- drawn_to: the one ordinary thing ${he} cannot leave alone, four words or fewer. A thing you can see, touch, eat or do. Something like: ${pulls}.${kind === 'adult' ? `\n- personality: two plain sentences a neighbor would say about ${v.name} to a stranger, fault included, true to the life above. Do not start with the name.` : ''}
Answer as JSON: {"humor": "...", "voice": "...", "drawn_to": "..."${kind === 'adult' ? ', "personality": "..."' : ''}}`;
    const props = { humor: { type: 'string' }, voice: { type: 'string' }, drawn_to: { type: 'string' } };
    if (kind === 'adult') props.personality = { type: 'string' };
    return this.llm.ask(3, [{ role: 'system', content: 'You describe real, ordinary, flawed people in a small village long before metal, machines or writing: hunters, mothers, loafers, gossips, flirts, bullies, clowns, hotheads. You use short plain words, the kind neighbors use about each other. Always answer with a single JSON object and nothing else.' }, { role: 'user', content: prompt }],
      { type: 'object', properties: props, required: Object.keys(props) }, kind === 'adult' ? 220 : 120, { temperature: Math.min(1.1, (this.llm.cfg.temperature || 0.9) + 0.1) });
  }

  // A temper has broken. How far it goes is already settled by who they are; the words are theirs.
  async rage(v, foe, why, heat) {
    if (this.quiet(v) && this.quiet(foe)) return null;
    const sim = this.sim;
    const him = foe.gender === 'm' ? 'him' : 'her', he = foe.gender === 'm' ? 'he' : 'she';
    const doing = heat === 'shout' ? `You are going to have it out with ${him}, loud, where everyone can hear.` : heat === 'strike' ? `Your fists are already clenched. You are going to hit ${him}.` : `Something in you has gone cold and certain. You are going to go for ${him}, and you mean to end it.`;
    const prompt = `It is Day ${sim.day}, ${sim.timeWord()}. You are ${energyWord(v.needs.energy)} and ${hungerWord(v.needs.hunger)}.
${foe.name} is close by (your ${sim.relation(v, foe)}; you feel ${affinityWord(sim.getAffinity(v, foe))} toward ${him}). What you hold against ${him}: ${he} ${why}.
${(v.views || {})[foe.id] ? `Your own note on ${foe.name}: "${v.views[foe.id].slice(0, 140)}"\n` : ''}Your temper has broken. ${doing}

${this.fresh(v)}Say what you shout at ${him}, in your own voice${v.nature && v.nature.voice ? ` (${v.nature.voice})` : ''}, the way angry people really talk. Then one plain sentence of what is going through your head.
Answer as JSON: {"say": "...", "thought": "..."}`;
    const r = await this.llm.ask(1, [{ role: 'system', content: this.system(v, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { say: { type: 'string' }, thought: { type: 'string' } }, required: ['say', 'thought'] }, 260);
    return r && r.say ? { say: clip(r.say, 500), thought: clip(r.thought, 200) } : null;
  }

  // Someone has come wanting to lie with them, in secret. The answer is theirs.
  async tryst(t, v, willing, lonely) {
    if (!this.llm.online) { await new Promise((r) => setTimeout(r, 900)); return null; }
    const sim = this.sim;
    const him = v.gender === 'm' ? 'him' : 'her', he = v.gender === 'm' ? 'He' : 'She';
    const mate = sim.byId(t.partner), vMate = sim.byId(v.partner);
    const prompt = `It is Day ${sim.day}, ${sim.timeWord()}. Nobody else is near.
${v.name} (your ${sim.relation(t, v)}; you feel ${affinityWord(sim.getAffinity(t, v))} toward ${him}) has found you alone. ${he} wants to lie with you, here, now, and for nobody to know.
${mate ? `You share a home with ${mate.name} (you feel ${affinityWord(sim.getAffinity(t, mate))} toward ${mate.gender === 'm' ? 'him' : 'her'})${sim.isOld(mate) ? `, who is old now` : ''}.` : 'You have no partner.'} ${vMate ? `${v.name} shares a home with ${vMate.name}.` : `${v.name} has no partner.`}
${willing ? `Your body has already answered: you want ${him}.` : `You feel no pull toward ${him} that way.`}${lonely ? ' Your own bed has been cold for a long time.' : ''}
If it comes out, people will be hurt and somebody may not forgive it. If it does not, nobody will ever know.
${this.fresh(t)}This is yours to decide, as the person you are. Answer in your own voice, then yes or no.
Answer as JSON: {"say": "...", "answer": "yes | no"}`;
    const r = await this.llm.ask(1, [{ role: 'system', content: this.system(t, true) }, { role: 'user', content: prompt }],
      { type: 'object', properties: { say: { type: 'string' }, answer: { type: 'string', enum: ['yes', 'no'] } }, required: ['say', 'answer'] }, 240);
    return r && r.answer ? { say: clip(r.say, 500), answer: String(r.answer) } : null;
  }

  async comingOfAge(v, pa, pb) {
    if (!this.llm.online) return null;
    const sim = this.sim;
    const parents = [pa, pb].filter(Boolean).map((p) => `${p.name}${p.calling ? ` (${p.calling})` : ''}: ${p.personality}`).join('\n');
    const childhood = (v.lessons || []).length ? `\nWhat ${v.gender === 'm' ? 'his' : 'her'} childhood held:\n${v.lessons.map((l) => `- ${l}`).join('\n')}\n` : `\nNobody spent much time with ${v.gender === 'm' ? 'him' : 'her'} as a child.\n`;
    const he = v.gender === 'm' ? 'he' : 'she', him = v.gender === 'm' ? 'him' : 'her', his = v.gender === 'm' ? 'his' : 'her';
    const born = v.nature ? `\nThe nature ${he} was born with: ${sim.natureLine(v)}\n` : '';
    const others = sim.adults().filter((o) => o !== v && o.personality).slice(-10).map((o) => `- ${o.name}: ${o.personality}`).join('\n');
    const prompt = `${v.name} was born in a small village of hunters and farmers and has just grown up. ${his[0].toUpperCase() + his.slice(1)} parents:
${parents}
${born}${childhood}
The grown people already here:
${others || '- nobody else'}

Describe the adult ${v.name} has become, in two plain sentences. ${v.nature ? `Keep the nature ${he} was born with, fault and all, and let the childhood show in what became of it.` : `Give ${him} a temperament, a real fault, and something ${he} wants. Let the childhood show in who ${he} is.`} Use short plain words, the kind a neighbor would use about ${him}. Nothing dreamy. Do not start with the name.
Answer as JSON: {"personality": "..."}`;
    return this.llm.ask(3, [{ role: 'system', content: 'You describe real, ordinary, flawed people in a small village long before metal, machines or writing. You use short plain words, the kind neighbors use about each other. Always answer with a single JSON object and nothing else.' }, { role: 'user', content: prompt }], obj('personality'), 150, { temperature: Math.min(1.1, (this.llm.cfg.temperature || 0.9) + 0.1) });
  }

  // ---------- instinct: the fallback brain ----------

  instinct(v) {
    const sim = this.sim;
    const n = v.needs, inv = v.inv;
    const T = (thought, action, extra = {}) => ({ thought, action, target: '', near: '', to: '', say: '', label: '', ...extra });
    // someone in the background keeps company without the model's words: they sit with people rather than talk
    const chat = (thought, o) => sim.inLight(v) ? T(thought, 'talk', { to: o.name, say: pick(CANNED_OPENERS).replace('NAME', o.name) }) : T(thought, 'activity', { target: pick(['sitting a while', 'working side by side', 'walking a little way', 'sharing a bite']), to: o.name, near: 'here' });
    const open = (t) => !sim.buildBlock(v, t);
    const others = sim.here().filter((o) => o !== v && !o.sleeping);
    const ailing = sim.here().find((o) => o !== v && o.sick && o.sick.tended !== sim.day && (o.partner === v.id || o.parents.includes(v.id) || v.parents.includes(o.id)));
    if (ailing && !v.sick && Math.random() < 0.6) return T(`${ailing.name} is sick. I should be with ${ailing.gender === 'm' ? 'him' : 'her'}.`, 'tend', { to: ailing.name });
    if (v.sick && n.energy < 70) return T('I feel dreadful. I need to lie down.', 'sleep');

    const outside = !v.inside;
    if (sim.dangerOutside() && !v.inside && sim.structById(v.home)) return T(sim.weatherNow() === 'blizzard' ? 'Nobody lives long out in this. I am getting inside.' : 'I am not staying out in this storm.', 'shelter');
    if (sim.wolves().length && outside && sim.structById(v.home)) return T('Wolves. I am getting inside.', 'sleep');
    if (n.hunger < 45 && (inv.food > 0 || sim.stored('food') > 0)) return T(pick(['I am hungry. Time to eat.', 'My stomach has been complaining for a while. I should eat.', 'Food first, then the rest.']), 'eat');
    const kidsHungry = sim.childrenOf(v).some((c) => c.stage === 'child' && c.needs.hunger < 45);
    if (kidsHungry && inv.food < 2 && sim.stored('food') < 1) {
      if (sim.knows('hunting') && sim.anyGame() && Math.random() < 0.4) return T('The little ones are hungry. I need meat.', 'hunt', { target: sim.anyGame() });
      if (sim.knows('fishing') && (sim.isWinter() || Math.random() < 0.4)) return T('The children need to eat. The pond will have to provide.', 'fish');
      return T('The children are hungry. I need to find food.', 'gather', { target: 'food' });
    }
    if (n.hunger < 40 && inv.food < CARRY) {
      if (sim.knows('hunting') && sim.spareGame() && sim.stored('food') < 60 && Math.random() < 0.15) return T('I am hungry, and there is meat out there.', 'hunt', { target: sim.spareGame() });
      if (sim.knows('fishing') && sim.fishShare() > 0.2 && (sim.isWinter() || Math.random() < 0.3)) return T('I am hungry. Maybe the fish are biting.', 'fish');
      return T('My stomach is growling. I need to find food.', 'gather', { target: 'food' });
    }
    if (n.energy < 22) return T('I need to lie down.', 'sleep');
    if (sim.isNight() && n.energy < 80) return T('It is dark and I am tired.', 'sleep');
    if (open('campfire')) return T('We need a fire before anything else.', 'build', { target: 'campfire', near: 'here' });
    // a thing somebody here worked out and nobody has put up yet gets built, even on instinct
    const fresh = sim.unlocked().filter((t) => STRUCT[t] && STRUCT[t].custom && !sim.structures.some((st) => st.type === t) && open(t));
    if (fresh.length && Math.random() < 0.35) return T(`${sim.typeName(fresh[0])}. We worked it out, so somebody should build it.`, 'build', { target: fresh[0], near: 'campfire' });
    // the materials people have learned to make get made, so there is some to use
    const mats = (sim.materials || []).filter((m) => sim.canPay(v, m.from) && (!m.at || sim.count(m.at) > 0) && sim.stored(m.name) + sim.have(v, m.name) < 12);
    if (mats.length && Math.random() < 0.2) return T(`We could use more ${mats[0].name}.`, 'make', { target: mats[0].name });
    const home = sim.structById(v.home);
    if (!home || (home.owner !== v.id && home.owner !== v.partner)) {
      const t = open('house') && Math.random() < 0.6 ? 'house' : 'shelter';
      if (open(t)) return T('I want a roof of my own.', 'build', { target: t, near: 'campfire' });
    }
    if (n.social < 30 && others.length) {
      const o = pick(others);
      return chat(`I have not talked to anyone in a while. I will go find ${o.name}.`, o);
    }
    if ((inv.food < 4 && sim.stored('food') < 20) || (sim.daysToWinter() <= 3 && inv.food < 14 && sim.stored('food') < 100) || (sim.storehouse() && sim.store.food < sim.villagers.length * 6 && inv.food < 14)) {
      if (sim.knows('hunting') && sim.spareGame() && Math.random() < 0.12) return T('Better to lay in meat before we need it.', 'hunt', { target: sim.spareGame() });
      if (sim.knows('fishing') && sim.fishShare() > 0.35 && (sim.isWinter() || Math.random() < 0.35)) return T('Better to have food put by. I will try the pond.', 'fish');
      return T('Better to have food on hand before I need it.', 'gather', { target: 'food' });
    }
    if (sim.storehouse() && inv.food > 10 && sim.store.food < sim.storeCap() - 10) return T('This food should go in the store where everyone can reach it.', 'store');
    if (home && home.type === 'shelter' && open('house') && Math.random() < 0.5) return T('That lean-to will not do forever. Time for a real house.', 'build', { target: 'house', near: 'home' });

    // with the body and safety seen to, the lowest need still unmet is what moves them
    const m = sim.maslow(v);
    const hopeful = sim.adults().filter((o) => sim.canPair(v, o) && !o.sleeping && sim.getAffinity(v, o) >= 45);
    if (hopeful.length && Math.random() < (m.at === 2 ? 0.25 : 0.08)) return T(`I am tired of being alone. I am going to ask ${hopeful[0].name}.`, 'propose', { to: hopeful[0].name });
    const beloved = sim.byId(v.partner);
    if (beloved && sim.getAffinity(v, beloved) < 20 && Math.random() < 0.3) return T(`I cannot go on living with ${beloved.name}.`, 'part');
    if (beloved && !beloved.away && !beloved.sleeping && v.closeDay !== sim.day && sim.time > 0.55 && Math.random() < 0.12) return T(`I have hardly seen ${beloved.name} all day.`, 'together');
    if (m.at === 2 && m.state !== 'met' && others.length && Math.random() < 0.3) {
      const o = others.slice().sort((a, c) => sim.getAffinity(v, c) - sim.getAffinity(v, a))[0];
      return chat(`I do not want to be on my own today. I will go and find ${o.name}.`, o);
    }
    const wantsName = m.at === 3 && m.state !== 'met', restless = m.at === 4 && m.state !== 'met';
    if (v.inventDay !== sim.day && Math.random() < (v.project ? 0.3 : restless ? 0.4 : wantsName ? 0.25 : 0.03)) return T(v.project ? 'I keep coming back to that idea of mine.' : wantsName ? 'I want to be known for something here.' : restless ? 'I am fed and safe and loved, and still something nags at me. There is a thing I want to work out.' : 'There has to be a better way of doing this.', 'invent', { target: v.project ? v.project.idea : sim.needIdea(v) });
    if (restless && Math.random() < 0.3) return T('I want to make something that is only mine.', 'make', { target: pick(['a carved figure of a deer', 'a string of painted beads', 'a reed whistle', 'a bowl with a pattern cut into it', 'a little wooden boat', 'a woven band of dyed wool']) });
    const fire = sim.structures.some((st) => st.type === 'campfire' && st.p >= 1);
    if (fire && sim.inLight(v) && sim.gatherDay !== sim.day && sim.time >= 0.62 && sim.time < 0.8 && others.length >= 2 && Math.random() < 0.15) return T('It has been too long since we all sat down together.', 'call', { target: pick(['a story', 'a prayer of thanks', 'a song', 'a memory']) });
    const little = sim.childrenOf(v).filter((c) => c.stage === 'child' && !c.sleeping);
    if (little.length && Math.random() < 0.1) { const c = pick(little); return T(`${c.name} should learn this while I am still here to show it.`, 'activity', { target: pick([`showing ${c.name} how to set a snare`, `teaching ${c.name} the names of the plants`, `showing ${c.name} how to mend a net`, `telling ${c.name} about the first days here`]), to: c.name }); }
    const smallKids = sim.childrenOf(v).some((c) => c.stage === 'child');
    if (!sim.isWinter() && !smallKids && !sim.isOld(v) && inv.food >= 8 && n.hunger > 60 && v.health > 80 && Math.random() < 0.002) return T('I have to know what is out there.', 'explore');
    const roll = Math.random();
    if (roll < 0.12 && others.length) {
      const o = pick(others);
      return chat(`I wonder what ${o.name} is up to.`, o);
    }
    if (roll < 0.17) return T('I just want to walk a while and look at things.', 'wander');
    const options = ['storehouse', 'storehouse', 'storehouse', 'farm', 'farm', 'coop', 'coop', 'pen', 'pen', 'garden', 'bench', 'path', 'well', 'well', 'lantern', 'workshop', 'workshop', 'statue', 'market', 'market', 'chapel', 'chapel'].filter(open);
    if (options.length && roll < 0.75) {
      const t = pick(options);
      return T(`This place could use ${/^[aeiou]/.test(t) ? 'an' : 'a'} ${t}.`, 'build', { target: t, near: pick(['home', 'campfire', 'campfire', 'here']) });
    }
    if (sim.storehouse() && ((inv.wood > 14 && sim.store.wood < 390) || (inv.stone > 14 && sim.store.stone < 390))) return T('My arms are full. Off to the storehouse.', 'store');
    const res = ['wood', 'stone', 'food'].filter((r) => inv[r] < CARRY - 2 && sim.stored(r) < 100).sort((a, c) => inv[a] - inv[c])[0];
    if (res) return T(`I should stock up on ${res}.`, 'gather', { target: res });
    const needy = others.filter((o) => o.stage === 'adult').sort((a, c) => a.inv.food - c.inv.food)[0];
    if (needy && needy.inv.food < 2 && Math.random() < 0.4) return T(`I have more than I need. ${needy.name} could use some.`, 'give', { to: needy.name, target: 'food' });
    if (others.length && Math.random() < 0.5) { const o = pick(others); return T(`There is nothing that needs doing. I will see what ${o.name} is up to.`, 'talk', { to: o.name, say: pick(CANNED_OPENERS).replace('NAME', o.name) }); }
    return T('There is nothing that needs doing. I will take a walk.', 'wander');
  }
}

const CANNED_OPENERS = [
  'NAME, come look at what I have been working on.',
  'How are you holding up, NAME?',
  'NAME, I was just thinking about you.',
  'What are you working on, NAME?',
  'NAME, have you eaten today?',
];
const CANNED_REPLIES = [
  'I was just thinking the same thing.',
  'One day at a time. That is all we can do.',
  'Ask me again after I have eaten.',
  'It is good to hear a voice out here.',
  'We have come a long way from nothing, have we not?',
  'I will believe it when I see it.',
];
const KID_LINES = ['Why is the sky that color?', 'I found a bug!', 'Watch me! Are you watching?', 'I am not tired.', 'Can I help? I can carry things!', 'What is that for?'];
