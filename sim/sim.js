// The simulation. It owns the world, moves the bodies, and carries out
// whatever each villager's brain decides. It never decides for them
// (except when someone is about to collapse from exhaustion).

import { W, H, START_W, START_H, WATER, GRASS, SAND, WATER_LEVEL, idx, inBounds, key, generateWorld, neighbors4, setSize, terrain, oreIn, shoreThings } from './world.js';

export const CARRY = 20;

// What the valley itself gives, and where. This is the real earth: wood and stone, but also clay and reeds at the
// water, hides and bone from the hunt, wool from the sheep, and rock streaked with what nobody here has a name for yet.
// Everything else people have, they work out how to make from these.
export const RAW = {
  wood: { from: 'tree', each: 3, where: 'the trees', craft: 'wood' },
  stone: { from: 'rock', each: 3, where: 'the rocks', craft: 'stone' },
  food: { from: 'bush', each: 2, where: 'the bushes, the farms and the water', craft: 'forage' },
  clay: { from: 'clay', each: 3, where: 'the pond bank, dug out wet', craft: 'stone' },
  reeds: { from: 'reeds', each: 3, where: 'the water\'s edge', craft: 'forage' },
  'green ore': { from: 'rock', ore: 'green', each: 2, where: 'rocks with green streaks in them', needs: 'ore', craft: 'stone' },
  'red ore': { from: 'rock', ore: 'red', each: 2, where: 'rocks stained rusty red', needs: 'ore', craft: 'stone' },
  'grey ore': { from: 'rock', ore: 'grey', each: 2, where: 'heavy grey-black rocks', needs: 'ore', craft: 'stone' },
  hide: { from: 'hunt', where: 'the hunt' },
  bone: { from: 'hunt', where: 'the hunt' },
  wool: { from: 'pen', where: 'the sheep in the pen' },
};
// The turning points the game can recognize in what people invent. The ages are named from these, after the fact,
// the way history books do it. Nothing here is a goal anyone is given.
export const LANDMARKS = ['metal', 'bronze', 'iron', 'steel', 'pottery', 'kiln', 'brick', 'glass', 'weaving', 'rope', 'wheel', 'plough', 'sail', 'boat', 'writing', 'counting', 'money', 'medicine', 'mill', 'gear', 'steam', 'engine', 'electricity', 'printing', 'gunpowder', 'machine', 'vehicle', 'flight', 'other'];
const AGES = [
  ['The Age of Flight', (k) => k.has('flight'), 'Your people have engines, electricity and machines that fly.'],
  ['The Modern Age', (k) => k.has('electricity'), 'Your people have iron, engines and electricity.'],
  ['The Industrial Age', (k) => k.has('steam') || k.has('engine'), 'Your people have iron, writing, mills and now engines. There is no electricity.'],
  ['The Age of Printing', (k) => k.has('printing'), 'Your people have iron, writing, mills and printing. There are no engines and no electricity.'],
  ['The Middle Ages', (k) => k.has('steel') || (k.has('mill') && k.has('plough')) || (k.has('iron') && k.has('mill')), 'Your people have iron, the wheel and mills. There is no printing, no engine, no electricity.'],
  ['The Classical Age', (k) => k.has('writing') && (k.has('iron') || k.has('money')), 'Your people have metal and writing. There are no mills, no engines, nothing that moves but by muscle, wind or water.'],
  ['The Iron Age', (k) => k.has('iron'), 'Your people can make iron. There is no writing yet, and no machine of any kind.'],
  ['The Bronze Age', (k) => k.has('bronze'), 'Your people can make copper and bronze. There is no iron, no writing, no machine of any kind.'],
  ['The Copper Age', (k) => k.has('metal'), 'Your people have found the first metal. There is no bronze, no iron, no writing, no wheel.'],
  ['The Late Stone Age', (k) => k.has('pottery') || k.has('weaving') || k.has('kiln'), 'This is a time before metal, machines, writing and numbers. Your people have fire, pots and cloth.'],
  ['The Stone Age', () => true, 'This is a time before metal, machines, writing and numbers. Nothing is made but by hand, of wood, stone, clay, reeds, hide and bone.'],
];
const DUSK = 0.76;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Everything that can be built. "block" means you cannot walk through it.
export const STRUCT = {
  campfire: { w: 1, h: 1, cost: { wood: 3, stone: 2 }, time: 6, block: true, max: 1, desc: 'a fire to gather around and sleep beside. Wolves will not come near it' },
  shelter: { w: 1, h: 1, cost: { wood: 6 }, time: 8, block: true, home: true, desc: 'a simple lean-to, a first home' },
  farm: { w: 2, h: 2, cost: { wood: 4 }, time: 10, block: false, desc: 'a plot that grows food again and again' },
  garden: { w: 1, h: 1, cost: { wood: 1, food: 1 }, time: 5, block: false, desc: 'flowers, for no reason but beauty' },
  house: { w: 2, h: 2, cost: { wood: 10, stone: 4 }, time: 18, block: true, home: true, desc: 'a proper home, the best sleep there is' },
  bench: { w: 1, h: 1, cost: { wood: 3 }, time: 5, block: true, desc: 'a place to sit' },
  path: { w: 1, h: 1, cost: { stone: 2 }, time: 5, block: false, desc: 'a stone path, faster to walk on' },
  well: { w: 1, h: 1, cost: { stone: 8 }, time: 12, block: true, max: 2, desc: 'fresh water, everyone tires more slowly' },
  lantern: { w: 1, h: 1, cost: { wood: 2, stone: 1 }, time: 4, block: true, desc: 'light against the night. Wolves will not come near it, so it protects whatever stands close by' },
  workshop: { w: 2, h: 2, cost: { wood: 12, stone: 8 }, time: 20, block: true, max: 1, desc: 'better tools, everyone gathers more' },
  statue: { w: 1, h: 1, cost: { stone: 10 }, time: 14, block: true, desc: 'a monument to whatever you like' },
  market: { w: 2, h: 2, cost: { wood: 8, stone: 2 }, time: 14, block: true, max: 1, desc: 'a stall where people meet and trade' },
  chapel: { w: 2, h: 2, cost: { wood: 16, stone: 12 }, time: 26, block: true, max: 1, desc: 'a place to gather and give thanks, lifts every spirit' },
  storehouse: { w: 2, h: 2, cost: { wood: 8 }, time: 14, block: true, max: 1, desc: 'a shared store. Anyone can drop off what they carry, and anyone can build or eat using what is inside' },
  grave: { w: 1, h: 1, cost: {}, time: 0, block: false, desc: 'where one of the dead is buried' },
  coop: { w: 2, h: 2, cost: { wood: 8 }, time: 12, block: false, desc: 'a fenced yard for chickens, which lay eggs you can gather as food' },
  pen: { w: 2, h: 2, cost: { wood: 10 }, time: 14, block: false, desc: 'a fenced pen for sheep, which give milk to gather as food and wool so everyone sleeps warmer' },
};

// Built things that produce food again and again. "regrow" is in days.
const FOOD_SOURCES = {
  farm: { amount: 4, regrow: 0.6, what: 'from the farm' },
  coop: { amount: 3, regrow: 0.4, what: 'in eggs from the coop', animal: 'chicken' },
  pen: { amount: 3, regrow: 0.6, what: 'in milk from the sheep pen', animal: 'sheep' },
};

// The animals. "wild" is how many roam free; "flee" means they bolt from people.
const ANIMALS = {
  rabbit: { speed: 3.4, roam: 4, flee: true, wild: 4 },
  deer: { speed: 2.6, roam: 7, flee: true, wild: 3 },
  sheep: { speed: 1.2, roam: 4, flee: false, wild: 3 },
  chicken: { speed: 1.6, roam: 3, flee: false, wild: 4 },
  wolf: { speed: 3.6, roam: 6, flee: false, wild: 0 },
};
// How each wild kind lives: how long (a day here is a year of a life), how soon it can breed, how readily, and how many young at once.
// They breed far less in winter, and less as the land fills up.
const WILDLIFE = {
  rabbit: { life: 7, grown: 1, breed: 0.85, litter: 2, grazer: true },
  deer: { life: 14, grown: 2, breed: 0.7, litter: 1, grazer: true },
  sheep: { life: 11, grown: 2, breed: 0.7, litter: 1, grazer: true },
  chicken: { life: 7, grown: 1, breed: 0.8, litter: 2, grazer: false },
};
const GAME = { rabbit: 3, deer: 8, sheep: 6, chicken: 2, wolf: 2 }; // food from a kill
const SPEAR = { rabbit: 0.45, deer: 0.55, sheep: 0.75, chicken: 0.7, wolf: 0.4 }; // chance a throw lands

// Knowledge the family picks up as they go. Each one unlocks new things to build.
export const DISCOVERIES = [
  { id: 'fire', name: 'fire', unlocks: ['campfire', 'shelter'], test: () => true },
  { id: 'farming', name: 'farming', unlocks: ['farm', 'garden'], test: (s) => s.stats.food >= 24 },
  { id: 'fishing', name: 'fishing', unlocks: [], note: 'Now anyone can fish at the water\'s edge.', test: (s) => s.stats.food >= 12 && s.day >= 2 },
  { id: 'hunting', name: 'hunting', unlocks: [], note: 'Now anyone can hunt the wild animals for food.', test: (s) => s.knows('fishing') && s.stats.food >= 90 },
  { id: 'herding', name: 'herding', unlocks: ['coop', 'pen'], test: (s) => s.knows('farming') && s.count('farm') >= 1 && s.stats.food >= 50 },
  { id: 'carpentry', name: 'carpentry', unlocks: ['house', 'bench', 'storehouse'], test: (s) => s.stats.wood >= 60 && s.count('shelter') >= 1 },
  { id: 'masonry', name: 'masonry', unlocks: ['path', 'well'], test: (s) => s.stats.stone >= 40 },
  { id: 'lighting', name: 'lantern making', unlocks: ['lantern'], test: (s) => s.count('house') >= 1 && s.knows('masonry') },
  { id: 'craft', name: 'craftsmanship', unlocks: ['workshop', 'statue'], test: (s) => s.villagers.length >= 5 && s.count('house') >= 2 },
  { id: 'community', name: 'community', unlocks: ['market', 'chapel'], test: (s) => s.villagers.length >= 8 && s.count('well') >= 1 && s.count('workshop') >= 1 },
  { id: 'ore', name: 'strange rock', unlocks: [], note: 'People have noticed that some rocks are streaked green, some stained red, and some heavy and grey-black. Nobody knows what any of it is good for.', test: (s) => s.stats.stone >= 40 && s.day >= 6 && Object.values(s.objects).some((o) => o.kind === 'rock' && o.ore) },
];


const KID_SHIRTS = ['#d98c3f', '#5a9bd4', '#c9575e', '#7a67c7', '#4fae8a', '#d4b13f', '#c56fb0', '#5fb7c4'];
const HAIRS = ['#3a2a1e', '#5b3a22', '#8a5a2b', '#1f1a17', '#a6522c', '#c9a15a'];
const SKINS = ['#f0c9a0', '#e2b085', '#c98f62', '#a8703f', '#f4d6b6'];

const BOY_NAMES = ['Silas', 'Jonah', 'Ezra', 'Micah', 'Levi', 'Asher', 'Tobias', 'Caleb', 'Reuben', 'Enoch', 'Amos', 'Gideon', 'Josiah', 'Nathan', 'Eli', 'Boaz', 'Simeon', 'Jude', 'Abel', 'Seth', 'Noah', 'Isaac', 'Joel', 'Malachi', 'Jared', 'Cyrus', 'Hiram', 'Lemuel', 'Obed', 'Zeke', 'Aaron', 'Barak', 'Dan', 'Ephraim', 'Felix', 'Hosea', 'Ira', 'Kenan', 'Linus', 'Titus'];
const GIRL_NAMES = ['Naomi', 'Miriam', 'Ada', 'Leah', 'Tamar', 'Selah', 'Ruth', 'Esther', 'Junia', 'Mara', 'Hannah', 'Lydia', 'Dinah', 'Abigail', 'Rachel', 'Susanna', 'Phoebe', 'Tirzah', 'Keziah', 'Adah', 'Zillah', 'Rhoda', 'Orpah', 'Eden', 'Iris', 'Sarai', 'Martha', 'Anna', 'Delia', 'Hester', 'Bethany', 'Chloe', 'Elisha', 'Hadassah', 'Jemima', 'Lois', 'Noa', 'Priscilla', 'Shiloh', 'Vashti'];

const TRAVELERS = [
  { name: 'Silas', gender: 'm', personality: 'A wandering carpenter with a dry sense of humor. Has seen a lot of road and is tired of it.' },
  { name: 'Naomi', gender: 'f', personality: 'A sharp, cheerful forager who talks to plants and remembers every kindness.' },
  { name: 'Jonah', gender: 'm', personality: 'A restless dreamer who tells tall tales and always wants to build something bigger.' },
  { name: 'Miriam', gender: 'f', personality: 'A patient stoneworker who hums while she works and hates leaving things unfinished.' },
  { name: 'Ezra', gender: 'm', personality: 'A quiet, careful man who counts everything twice and worries about winter.' },
  { name: 'Tamar', gender: 'f', personality: 'Bold and funny, quick to argue and quicker to forgive. Loves a good fire and good company.' },
  { name: 'Levi', gender: 'm', personality: 'A gentle giant who would rather garden than talk, but listens well.' },
  { name: 'Selah', gender: 'f', personality: 'A thoughtful singer who asks big questions and notices small things.' },
];

// What someone might bring home from beyond the valley.
const FINDS = [
  { short: 'better seed', text: 'a valley where the grain grows thick, and brought back seed from it', apply: (s) => { s.stats.farmBonus = Math.min(2, (s.stats.farmBonus || 0) + 1); } },
  { short: 'two wild sheep', text: 'a flock grazing on a far hillside, and drove two of them home', apply: (s, v) => { for (let i = 0; i < 2; i++) s.addAnimal('sheep', Math.floor(v.x), Math.floor(v.y)); } },
  { short: 'two wild fowl', text: 'birds nesting in the reeds of a far marsh, and carried two home', apply: (s, v) => { for (let i = 0; i < 2; i++) s.addAnimal('chicken', Math.floor(v.x), Math.floor(v.y)); } },
  { short: 'a sack of salt', text: 'a white salt flat, and brought back a sack of salt to keep food from spoiling', apply: (s) => { s.stats.salt = true; } },
  { short: 'a load of good stone', text: 'a cliff of clean hard stone, and carried back what I could', apply: (s, v) => { v.inv.stone = Math.min(CARRY, v.inv.stone + 10); } },
  { short: 'wild honey', text: 'a hollow tree full of honey, and brought back all I could carry', apply: (s, v) => { v.inv.food = Math.min(CARRY, v.inv.food + 10); } },
  { short: 'nothing but what was seen', text: 'no end to the land, only more hills and a great water at the edge of it', apply: () => {} },
];

// Every invention does one real thing in the world. These are the things it can do.
export const EFFECTS = {
  more_food: 'gives food',
  keeps_food: 'keeps stored food from spoiling',
  warmth: 'keeps people warm and saves firewood',
  safety: 'keeps wolves away',
  health: 'helps the sick and the hurt to mend',
  better_tools: 'makes gathering wood and stone easier',
  better_hunting: 'makes hunting and fishing surer',
  comfort: 'makes rest deeper and the days easier',
  knowledge: 'helps new ideas come faster',
  travel: 'makes journeys beyond the valley safer',
  water: 'brings water where it is wanted, so the farms still bear a little in a drought',
  fire_guard: 'keeps fire from spreading',
  safer_work: 'makes dangerous work safer',
  birth: 'helps mothers and babies live through a birth',
  herding: 'helps the penned animals breed and thrive',
  gathering: 'brings people together, so fewer are left lonely',
  honor: 'marks what people have done, so they are looked up to and remembered',
  meaning: 'feeds the part of a person that food cannot: music, play, pictures, stories',
  none: 'is there because someone wanted it to be',
};
// Words that give away which need an idea is aimed at. Only used to tell someone their people already have that need met.
const EFFECT_WORDS = [
  ['water', /drought|irrigat|ditch|cistern|no rain|water to the (field|farm|crop)|carry(ing)? water/],
  ['fire_guard', /stop(ping)? (a |the )?(wild)?fire|put(ting)? out|firebreak|wildfire|fire from spreading/],
  ['birth', /birth|midwi|newborn|\blabor\b/],
  ['herding', /\bpen\b|flock|herd|tame|lamb|shear/],
  ['safer_work', /safer|accident|falling tree|rockfall|without getting hurt/],
  ['gathering', /sit together|eat together|feast|gathering place|meeting place|everyone .*together|bring(ing)? (people|everyone) together/],
  ['honor', /honor|who did what|remembered|in memory|tribute|the dead/],
  ['meaning', /music|\bsong|drum|flute|\bpipe\b|danc|paint|picture|\bgame\b|\bplay\b|\btoy|story|stories/],
  ['keeps_food', /spoil|preserv|smok|salt|cellar|keep(ing)? (the )?(food|meat|fish)|dry(ing)? (the )?(food|meat|fish)/],
  ['warmth', /warm|heat|hearth|insulat|\bcold\b|ember|chill|frost|draft|fire/],
  ['safety', /wolf|wolves|fence|palisade|guard|watch ?tower/],
  ['health', /sick|heal|medicin|herb|fever|wound|poultice/],
  ['travel', /journey|travel|beyond the valley|pack|boat|raft/],
  ['knowledge', /count|record|tally|writing|teach|remember/],
];
const NEED_WORDS = { more_food: 'getting more food', keeps_food: 'keeping food from spoiling', warmth: 'keeping warm', safety: 'keeping the wolves off', health: 'mending the sick', better_tools: 'gathering wood and stone', better_hunting: 'hunting and fishing', comfort: 'resting easy', knowledge: 'working out new ideas', travel: 'journeys beyond the valley', water: 'getting through a drought', fire_guard: 'stopping fire', safer_work: 'working without getting hurt', birth: 'bringing children safely into the world', herding: 'keeping animals', gathering: 'bringing people together', honor: 'honoring what people have done', meaning: 'music, play and stories' };
// What a person is born with. Each runs from -2 to 2 and comes from the parents, give or take, the way a nose does.
// These are not labels: each one changes what the person does. The hot-tempered lose their temper, the lazy skip the work.
export const TRAITS = {
  temper: ['slow to anger', 'even-tempered', '', 'short-tempered', 'hot-tempered'],
  drive: ['lazy', 'easygoing', '', 'hard-working', 'never stops working'],
  warmth: ['selfish', 'tight-fisted', '', 'kind', 'open-handed'],
  nerve: ['timid', 'careful', '', 'bold', 'reckless'],
  social: ['a loner', 'quiet', '', 'friendly', 'a talker'],
  honest: ['sly', 'bends the truth', '', 'straight', 'blunt'],
  pride: ['meek', 'modest', '', 'proud', 'vain'],
};
// The fault each extreme brings, the way a neighbor would say it behind their back.
const FAULTS = {
  temper: { 2: ['quick with the fists', 'flies into rages'], 1: ['snaps at people', 'has a short fuse'], '-2': ['lets people walk all over'] },
  drive: { '-2': ['lazy, lets others do the work', 'never lifts a hand'], '-1': ['slacks off when nobody is looking'], 2: ['works everyone else into the ground'] },
  warmth: { '-2': ['selfish, takes the best first', 'greedy'], '-1': ['tight-fisted', 'keeps count of every favor'], 2: ['gives away what the family needs'] },
  nerve: { '-2': ['a coward'], 1: ['takes fool chances'], 2: ['reckless, will get someone killed'] },
  social: { '-2': ['cold with people'], 2: ['a gossip, cannot keep a secret', 'never shuts up'] },
  honest: { '-2': ['a liar', 'takes without asking'], '-1': ['bends the truth when it suits'], 2: ['blunt to the point of cruel'] },
  pride: { '-2': ['a doormat'], 1: ['proud, holds a grudge'], 2: ['vain, has to be the best', 'cannot stand to be wrong'] },
};
const PLAIN_FAULTS = ['stubborn as a rock', 'sulks for days', 'complains about everything', 'never finishes anything', 'needs to be right', 'a show-off', 'careless with other people\'s things'];
const PLAIN_HUMOR = ['other people falling over', 'dirty jokes', 'her own jokes', 'teasing the children', 'rarely laughs', 'anything, laughs too loud', 'someone else getting caught out', 'animals doing foolish things', 'dry little remarks', 'pulling pranks'];
const PLAIN_DRAWN = ['animals', 'the fire', 'the pond', 'small children', 'food and cooking', 'making things by hand', 'the hunt', 'old stories', 'other people\'s business', 'climbing high places', 'the edge of the valley', 'fine things to wear', 'singing', 'a good fight', 'bargaining', 'growing things', 'sleeping in the sun', 'being first'];

// What a person needs, from the ground up. The lowest one going unmet is the one they feel loudest.
export const LEVELS = [
  { key: 'body', name: 'Body', what: 'food, sleep, health' },
  { key: 'safety', name: 'Safety', what: 'a roof, food put by, no danger near' },
  { key: 'belonging', name: 'Belonging', what: 'a mate, family, people who are yours' },
  { key: 'esteem', name: 'Standing', what: 'to be someone here, known for something' },
  { key: 'purpose', name: 'Purpose', what: 'something that is yours alone to do' },
];
const WEATHER = { clear: 'clear skies', rain: 'steady rain', storm: 'a thunderstorm, with lightning and a hard wind', fog: 'thick fog', hot: 'fierce heat', cold: 'cold and still', snow: 'snow falling', bitter: 'a killing cold', blizzard: 'a blizzard' };
export const SHAPES = ['hut', 'tower', 'dome', 'frame', 'pit', 'table', 'pool', 'pillar', 'wheel', 'field', 'furnace', 'mill', 'machine', 'wall', 'boat'];
export const MATERIALS = ['wood', 'stone', 'clay', 'thatch', 'hide', 'brick', 'copper', 'bronze', 'iron', 'glass', 'cloth', 'metal'];
export const COLORS = ['brown', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'white', 'black', 'purple'];
// Used when there is no model to ask, or its answer cannot be used.
const FALLBACK_INVENTIONS = [
  { name: 'smoking rack', kind: 'building', what: 'A wooden rack over a low fire, where meat and fish are dried in the smoke so they keep.', effect: 'keeps_food', shape: 'frame', material: 'wood', color: 'brown', size: 'small' },
  { name: 'clay oven', kind: 'building', what: 'A dome of baked clay that holds heat, for baking grain into bread.', effect: 'more_food', shape: 'dome', material: 'clay', color: 'orange', size: 'small' },
  { name: 'fishing net', kind: 'tool', what: 'Twine knotted into a net, to take many fish at once.', effect: 'better_hunting', shape: 'frame', material: 'hide', color: 'brown', size: 'small' },
  { name: 'stone axe', kind: 'tool', what: 'A ground stone head lashed to a handle, for felling trees faster.', effect: 'better_tools', shape: 'pillar', material: 'stone', color: 'gray', size: 'small' },
  { name: 'herb lore', kind: 'knowhow', what: 'Knowing which plants ease a fever and which close a wound.', effect: 'health', shape: 'field', material: 'thatch', color: 'green', size: 'small' },
  { name: 'wool cloaks', kind: 'knowhow', what: 'Spinning wool and weaving it into cloaks that hold the warmth in.', effect: 'warmth', shape: 'frame', material: 'hide', color: 'white', size: 'small' },
  { name: 'watchtower', kind: 'building', what: 'A tall platform with a fire basket on top, to see wolves coming and keep them off.', effect: 'safety', shape: 'tower', material: 'wood', color: 'brown', size: 'small' },
  { name: 'tally stones', kind: 'knowhow', what: 'Marks scratched on flat stones to count stores and days, so nothing has to be held in the head.', effect: 'knowledge', shape: 'pillar', material: 'stone', color: 'gray', size: 'small' },
  { name: 'sleeping mats', kind: 'knowhow', what: 'Reeds woven into thick mats, so nobody sleeps on the bare ground.', effect: 'comfort', shape: 'table', material: 'thatch', color: 'yellow', size: 'small' },
  { name: 'walking packs', kind: 'tool', what: 'A hide pack on a wooden frame, to carry food and water on a long road.', effect: 'travel', shape: 'frame', material: 'hide', color: 'brown', size: 'small' },
  { name: 'water ditch', kind: 'building', what: 'A ditch dug from the pond to the fields, so the crops can drink when no rain comes.', effect: 'water', shape: 'pool', material: 'clay', color: 'blue', size: 'small' },
  { name: 'bare strip', kind: 'knowhow', what: 'Clearing a wide strip of bare ground around the houses, so a fire has nothing to cross on.', effect: 'fire_guard', shape: 'field', material: 'clay', color: 'brown', size: 'small' },
  { name: 'birthing ways', kind: 'knowhow', what: 'What the women who have borne children know, taught to those who will sit with a mother.', effect: 'birth', shape: 'hut', material: 'hide', color: 'white', size: 'small' },
  { name: 'long table', kind: 'building', what: 'One long table of split logs where everyone can eat together.', effect: 'gathering', shape: 'table', material: 'wood', color: 'brown', size: 'large' },
  { name: 'memory post', kind: 'building', what: 'A tall post carved with a mark for each person and what they did, so it is not forgotten.', effect: 'honor', shape: 'pillar', material: 'wood', color: 'red', size: 'small' },
  { name: 'bone flute', kind: 'tool', what: 'A hollow bone with holes cut in it, to make music with.', effect: 'meaning', shape: 'pillar', material: 'hide', color: 'white', size: 'small' },
  { name: 'rope lines', kind: 'knowhow', what: 'Tying off with twisted rope before felling a tree or climbing, so a slip is not a fall.', effect: 'safer_work', shape: 'frame', material: 'hide', color: 'brown', size: 'small' },
  { name: 'lambing shed', kind: 'building', what: 'A low dry shed where the ewes and hens can bear their young out of the weather.', effect: 'herding', shape: 'hut', material: 'thatch', color: 'yellow', size: 'small' },
];

// What people become known for, once they have done enough of it.
const CALLINGS = { hunt: 'the hunter', fish: 'the fisher', build: 'the builder', forage: 'the forager', wood: 'the woodcutter', stone: 'the stonecutter', heal: 'the healer', make: 'the maker', tell: 'the storyteller', roam: 'the wanderer', invent: 'the inventor' };

// Where an expedition might lead. Each is told about once, in the traveler's own words.
const SIGHTS = [
  'a forest of trees so wide that ten people could not link arms around one, where it is dusk at midday',
  'a shore of black sand, and a water with no far side that rises and falls as if it were breathing',
  'a canyon so deep the river at the bottom looks like a thread, with birds turning in circles below your feet',
  'a plain of grass taller than a person, moving like water, with great slow herds of animals in it',
  'pools of hot water steaming out of bare rock, stinking of rot, the ground warm underfoot',
  'a mountain with snow on it in summer, and a wind coming off it cold enough to burn',
  'a marsh full of reeds and biting flies, where the ground itself floats and the frogs are loud as shouting',
  'a hill of red stone worn full of caves, with the bones of some huge animal in the largest one',
  'a waterfall higher than twenty trees, loud enough that you feel it in your chest before you see it',
  'a burned land, black trunks standing for a whole day of walking, with green shoots already coming up through the ash',
  'a field of flowers of a color there is no name for, and bees enough to hear from a hill away',
  'a dry riverbed of white stones, and a single tree standing in the middle of it with fruit nobody has tasted',
];

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
// plans that mean walking up to a person, wherever they have got to
const CHASES = ['talk', 'give', 'tend', 'take', 'fight', 'kill', 'quarrel', 'tryst', 'propose', 'together'];
// the ordinary work a person can think past: what comes next can be settled while their hands are busy with these
const AHEAD = ['gather', 'fish', 'hunt', 'build', 'design', 'store', 'make', 'invent', 'activity', 'wander', 'eat', 'give'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function affinityWord(n) {
  if (n < 12) return 'bitter';
  if (n < 25) return 'cold';
  if (n < 35) return 'distant';
  if (n < 55) return 'friendly';
  if (n < 75) return 'close';
  return 'devoted';
}

export function costText(cost) {
  return Object.entries(cost).map(([k, n]) => `${n} ${k}`).join(', ');
}

export class Sim {
  constructor(config, saved) {
    this.cfg = config.world;
    this.brain = null; // attached by the server
    this.onFeed = null;
    this.speed = 1;
    this.paused = false;
    this.feed = [];
    this.chronicle = [];
    if (saved && saved.v === 1) this.load(saved);
    else this.fresh();
    this.rebuildGrids();
    if (saved && !saved.techModel) { this.shoreUp(); this.rebuildGrids(); }
    if (!this.epoch) this.epoch = this.ageName();
    this.recast();
  }

  // ---------- setup ----------

  fresh() {
    setSize(START_W, START_H);
    this.origin = { x: 0, y: 0 };
    const world = generateWorld(this.cfg.seed);
    this.ground = world.ground;
    this.objects = world.objects;
    this.spawn = world.spawn;
    this.structures = [];
    this.paths = new Set();
    this.villagers = [];
    this.day = 1;
    this.time = 0.06;
    this.clock = 0;
    this.stats = { wood: 0, stone: 0, food: 0, built: 0 };
    this.discoveries = ['fire'];
    this.nextId = 1;
    this.worldVersion = 1;
    this.pendingBirths = 0;
    this.animals = [];
    this.store = { wood: 0, stone: 0, food: 0 };
    this.dead = [];
    this.inventions = [];
    this.lore = [];
    this.ended = false;
    this.rebuildGrids();
    this.seedWildlife();
    this.ecoModel = 1;

    const [a, b] = this.cfg.founders;
    const adam = this.makeVillager({ ...a, x: this.spawn.x - 0.5, y: this.spawn.y + 0.5 });
    const eve = this.makeVillager({ ...b, x: this.spawn.x + 1.5, y: this.spawn.y + 0.5 });
    adam.partner = eve.id;
    eve.partner = adam.id;
    adam.affinity[eve.id] = 70;
    eve.affinity[adam.id] = 70;
    adam.founder = eve.founder = true;
    adam.nature = a.nature || null;
    eve.nature = b.nature || null;
    this.addFeed('event', null, 'In the beginning there were two, and a world with nothing built in it.');
    this.addChronicle('event', null, `${adam.name} and ${eve.name} woke in an untouched world.`);
  }

  makeVillager(o) {
    const v = {
      id: this.nextId++,
      name: o.name,
      gender: o.gender,
      stage: o.stage || 'adult',
      bornDay: o.bornDay ?? this.day,
      adultDay: o.stage === 'child' ? null : this.day,
      parents: o.parents || [],
      partner: null,
      personality: o.personality || '',
      nature: o.nature || null, // who they were born as: temperament, fault, humor, voice, what draws them
      genes: o.genes || null,   // what they were born with, from their parents: see TRAITS
      shirt: o.shirt || pick(KID_SHIRTS),
      hair: o.hair || pick(HAIRS),
      skin: o.skin || pick(SKINS),
      x: o.x, y: o.y, dir: 1,
      path: [],
      needs: { energy: 90, hunger: 75, social: 70 },
      health: 100,
      lifespan: this.newLifespan(),
      inv: { wood: 0, stone: 0, food: o.food ?? 0 },
      home: o.home ?? null,
      plan: null,
      thinking: false,
      sleeping: false,
      inside: false,
      holdUntil: 0,
      thought: '',
      bubble: null,
      memory: [],
      today: [],
      diary: [],
      affinity: {},
      nextThinkAt: 0,
      failStreak: 0,
      lastFail: '',
      thoughts: [],
      wants: [],      // what they care about, in their own words
      views: {},      // their own notes on other people, by id
      sick: null,
      away: null,
      items: [],      // things they have made or been left
      idle: 0,
      nextLineAt: 60 + Math.random() * 60,
      traveler: !!o.traveler,
      lastBirthDay: 0,
    };
    if (!v.genes) v.genes = this.newGenes(null, null);
    if (!v.nature) v.nature = this.plainNature(v);
    else v.natureFull = true; // written out by hand
    this.villagers.push(v);
    return v;
  }

  // ---------- lookups ----------

  byId(id) { return this.villagers.find((v) => v.id === id) || null; }
  // The living or the dead. Family trees need both.
  person(id) { return this.byId(id) || this.dead.find((d) => d.id === id) || null; }
  // Most people who are spared everything else reach old age. Some bodies simply give out sooner.
  newLifespan() {
    const r = Math.random(), base = this.cfg.lifespanDays ?? 80;
    const f = r < 0.06 ? 0.38 + Math.random() * 0.22 : r < 0.2 ? 0.6 + Math.random() * 0.22 : 0.82 + Math.random() * 0.36;
    return Math.round(base * f);
  }
  age(v) { return this.day - v.bornDay; }
  // Ages are shown in years. Children grow fast (they reach 16 on the day they come of age);
  // after that, one game day is one year of life.
  yearsFromDays(d) {
    const grown = this.cfg.daysToAdult;
    return Math.max(0, Math.round(d <= grown ? d * (16 / grown) : 16 + (d - grown)));
  }
  years(v) { return this.yearsFromDays(this.age(v)); }
  isOld(v) { return this.age(v) >= v.lifespan * 0.75; }
  // A woman can bear children through this age (in years).
  canBear(v) { return v.gender === 'f' && v.stage === 'adult' && this.years(v) <= (this.cfg.fertileUntilAge ?? 55); }
  yearDays() { return this.cfg.yearDays ?? 12; }
  seasonOf(day) { return ['spring', 'summer', 'autumn', 'winter'][Math.floor((((day - 1) % this.yearDays()) / this.yearDays()) * 4)]; }
  season() { return this.seasonOf(this.day); }
  isWinter() { return this.season() === 'winter'; }
  daysToWinter() {
    const y = this.yearDays(), pos = (this.day - 1) % y, start = y * 0.75;
    return pos >= start ? 0 : Math.ceil(start - pos);
  }
  wolves() { return this.animals.filter((a) => a.kind === 'wolf'); }
  here() { return this.villagers.filter((v) => !v.away); }
  // Someone to act on by name: present, and not yourself.
  findOther(v, name, want) {
    const t = this.byName(name);
    if (!t || t === v) return { fail: { ok: false, want, why: 'there was nobody by that name' } };
    if (t.away) return { fail: { ok: false, want, why: `${t.name} is away beyond the valley` } };
    return { t };
  }
  byName(name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    return this.villagers.find((v) => v.name.toLowerCase() === n) || this.villagers.find((v) => n.includes(v.name.toLowerCase())) || null;
  }
  structById(id) { return this.structures.find((s) => s.id === id) || null; }
  count(type) { return this.structures.filter((s) => s.type === type && s.p >= 1).length; }
  knows(id) { return this.discoveries.includes(id); }
  unlocked() { return [...DISCOVERIES.filter((d) => this.knows(d.id)).flatMap((d) => d.unlocks), ...this.inventions.filter((i) => i.kind === 'building').map((i) => i.key)]; }
  typeName(type) { return (STRUCT[type] && STRUCT[type].name) || type; }

  // ---------- the ways of this place ----------

  // Rules and beliefs are not written in by anyone. Somebody says one out loud at the fire; the people there agree or
  // refuse, each as the person they are; what carries becomes a way of this place and goes into everyone's head.
  // Breaking a way is a wrong the whole village holds. When enough people look to one person, that person judges.
  heldWays(kind = null) { return (this.ways || []).filter((w) => w.held && (!kind || w.kind === kind)); }
  wayAbout(about) { return this.heldWays('rule').find((w) => w.about === about) || null; }
  waysText() {
    const rules = this.heldWays('rule'), beliefs = this.heldWays('belief');
    const out = [];
    if (rules.length) out.push(`THE WAYS OF THIS PLACE, agreed by the people at the fire:\n${rules.slice(-8).map((w) => `- ${w.text} (since Year ${w.day}, said first by ${w.by}${w.broken ? `, broken ${w.broken} time${w.broken === 1 ? '' : 's'}` : ''})`).join('\n')}`);
    if (beliefs.length) out.push(`WHAT PEOPLE HERE HOLD TRUE:\n${beliefs.slice(-6).map((w) => `- ${w.text} (${w.by}, Year ${w.day})`).join('\n')}`);
    const L = this.byId(this.leader);
    if (L) out.push(`${L.name} is ${this.leaderTitle || 'the one people look to'}: quarrels and broken ways are brought to ${L.gender === 'm' ? 'him' : 'her'}.`);
    return out.join('\n\n');
  }
  // Someone has said a rule or a belief out loud to everyone at the fire. Those present answer, one by one.
  async propose(v, text, kind, about, guests) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (clean.length < 8) return;
    const voters = guests.filter((o) => o !== v && o.stage === 'adult' && this.villagers.includes(o) && Math.hypot(o.x - v.x, o.y - v.y) < 9);
    if (!voters.length) return;
    // a way the people already keep is not put to them again; it is only said again
    const words = (t) => new Set(String(t).toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter((w) => w.length > 3));
    const same = this.heldWays(kind).find((w) => { const a = words(w.text), b = words(clean); const both = [...a].filter((x) => b.has(x)).length; return both / Math.max(1, Math.min(a.size, b.size)) >= 0.6 || (kind === 'rule' && w.about === about && about !== 'other' && both >= 2); });
    if (same) { this.remember(v, `I said again at the fire what we already keep: ${same.text}`); this.addFeed('event', v, `${v.name} reminded everyone of a way of this place: "${same.text}"`); return; }
    const way = { id: this.nextId++, text: clean, kind, about: kind === 'rule' ? about || 'other' : 'belief', by: v.name, byId: v.id, day: this.day, yes: 0, no: 0, held: false, broken: 0 };
    this.addFeed('event', v, `${v.name} put ${kind === 'rule' ? 'a rule' : 'a belief'} to everyone at the fire: "${clean}"`);
    const answers = await Promise.all(voters.map((o) => this.brain.vote(o, v, way)));
    const said = [];
    answers.forEach((a, i) => {
      const o = voters[i];
      if (!this.villagers.includes(o)) return;
      if (a.yes) way.yes++; else way.no++;
      if (a.say && said.length < 3 && this.inLight(o)) { said.push(o); this.say(o, a.say, 700, false, { id: this.nextTalk, to: v.name, kind: 'fire' }); }
      this.shiftAffinity(v, o, a.yes ? 2 : -4);
      this.remember(o, `At the fire ${v.name} said we should ${kind === 'rule' ? 'live by this' : 'hold this true'}: "${clean}". I said ${a.yes ? 'yes' : 'no'}.`);
    });
    way.held = way.yes > way.no;
    if (!this.ways) this.ways = [];
    this.ways.push(way);
    if (way.held) {
      this.lift(v, 8, 6);
      for (const o of this.adults()) this.remember(o, kind === 'rule' ? `The people agreed at the fire, ${way.yes} to ${way.no}: ${clean} It is a way of this place now.` : `The people agreed at the fire: ${clean} It is what we hold true now.`);
      this.addFeed('discovery', v, `The people agreed, ${way.yes} to ${way.no}. ${kind === 'rule' ? 'A new way of this place' : 'Something held true from now on'}: "${clean}"`);
      this.addChronicle('way', null, `${kind === 'rule' ? 'A rule' : 'A belief'} was agreed at the fire, ${way.yes} to ${way.no}, put by ${v.name}: "${clean}"`);
    } else {
      this.lift(v, -5, 0);
      this.remember(v, `I put it to everyone at the fire and they would not have it, ${way.no} to ${way.yes}: ${clean}`);
      this.addFeed('event', v, `The people would not have it, ${way.no} to ${way.yes}.`);
    }
    this.changed();
    this.wantSave = true;
  }
  // Someone has done a thing a way of this place forbids, in front of people. It is remembered against them.
  breach(v, about, what, witnesses = null) {
    const way = this.wayAbout(about);
    if (!way || !v || v.stage !== 'adult') return null;
    way.broken++;
    const saw = (witnesses || this.here().filter((o) => o !== v && o.stage === 'adult' && !o.sleeping && Math.hypot(o.x - v.x, o.y - v.y) < 10));
    for (const o of saw) { if (o !== v && o.stage === 'adult') { this.wrong(o, v, `broke the way we agreed on, "${way.text.slice(0, 60)}", when ${v.gender === 'm' ? 'he' : 'she'} ${what}`, 1, 6); } }
    this.remember(v, `I broke the way we agreed on at the fire: "${way.text}" People saw.`);
    this.addFeed('event', v, `${v.name} broke a way of this place: "${way.text}"`);
    this.lift(v, -6, 0);
    const L = this.byId(this.leader);
    if (L && L !== v) { if (!L.cases) L.cases = []; L.cases.push({ who: v.id, wayId: way.id, what, day: this.day }); this.light(L, 300); }
    return way;
  }
  // A grievance brought to the one people look to, instead of settled with fists.
  bring(v, foe, what) {
    const L = this.byId(this.leader);
    if (!L || L === v || L === foe) return false;
    if (!L.cases) L.cases = [];
    if (L.cases.some((c) => c.who === foe.id && c.by === v.id)) return false;
    L.cases.push({ who: foe.id, by: v.id, what, day: this.day });
    this.light(L, 300);
    v.thought = `I will not raise my hand. I will bring ${foe.name} before ${L.name}.`;
    this.remember(v, `I brought my grievance against ${foe.name} to ${L.name}: ${foe.gender === 'm' ? 'he' : 'she'} ${what}.`);
    this.addFeed('thought', v, v.thought, { act: `brings a grievance against ${foe.name} to ${L.name}` });
    return true;
  }
  // The regard a person is held in: how the other grown people feel about them, on average.
  regard(v) { const grown = this.adults().filter((o) => o !== v && !o.away); return grown.length ? grown.reduce((sum, o) => sum + this.getAffinity(o, v), 0) / grown.length : 55; }
  // After a gathering, people may find they have started looking to someone. Nobody is appointed.
  acclaim(guests) {
    if (this.leader && this.byId(this.leader)) return;
    const adults = this.adults().filter((o) => !o.away && !o.sick && this.years(o) >= 25);
    if (adults.length < 8 || guests.filter((g) => g.stage === 'adult').length < 4) return;
    const ranked = adults.map((o) => [o, this.regard(o) + (o.calling ? 5 : 0) + (this.isOld(o) ? 4 : 0) + (o.killed ? -30 : 0)]).sort((a, b) => b[1] - a[1]);
    const [who, score] = ranked[0];
    if (score < 50 || (ranked[1] && ranked[1][1] > score - 2)) return; // nobody stands clear of the rest
    this.leader = who.id;
    this.leaderTitle = '';
    this.light(who, 600);
    this.brain.title(who).then((t) => { this.leaderTitle = (t && t.title ? String(t.title).toLowerCase().replace(/[^a-z' -]/g, '').trim().slice(0, 24) : '') || 'the one people look to'; this.changed(); });
    for (const o of this.adults()) this.remember(o, o === who ? 'People have started bringing their quarrels to me, and listening when I speak. I did not ask for it.' : `When there is a quarrel now, people look to ${who.name}.`);
    this.addFeed('discovery', who, `People have started to look to ${who.name}. Quarrels are brought to ${who.gender === 'm' ? 'him' : 'her'} now.`);
    this.addChronicle('way', null, `The people began to look to ${who.name} to settle things.`);
    this.lift(who, 12, 10);
    this.changed();
  }
  // Each dawn: does the one people look to still have their regard?
  leadership() {
    const L = this.byId(this.leader);
    if (!L) { if (this.leader) { this.leader = null; this.changed(); } return; }
    const r = this.regard(L);
    if (r < 34 || L.away) {
      for (const o of this.adults()) this.remember(o, o === L ? 'Nobody listens to me anymore. They have turned away.' : `Nobody looks to ${L.name} anymore.`);
      this.addFeed('event', L, `Nobody looks to ${L.name} anymore.`);
      this.addChronicle('way', null, `The people stopped looking to ${L.name}.`);
      this.leader = null;
      this.lift(L, -15, -10);
      this.changed();
    }
  }
  // The one people look to has cases to hear. They are heard at the fire, in front of everyone.
  judgments(L, p, guests) {
    const cases = (L.cases || []).filter((c) => this.byId(c.who)).slice(0, 2);
    L.cases = (L.cases || []).filter((c) => !cases.includes(c));
    const run = async () => {
      for (const c of cases) {
        const who = this.byId(c.who);
        if (!who || !this.villagers.includes(L)) continue;
        const way = c.wayId ? (this.ways || []).find((w) => w.id === c.wayId) : null;
        const by = c.by ? this.byId(c.by) : null;
        const r = await this.brain.judge(L, who, way, by, c.what);
        if (!this.villagers.includes(who) || !this.villagers.includes(L)) continue;
        const penalty = r && ['warned', 'must give back', 'shunned for a season', 'driven out', 'nothing'].includes(r.penalty) ? r.penalty : 'warned';
        const said = (r && r.say) || `${who.name}. You know what you did. Let it not happen again.`;
        this.say(L, said, 700, false, { id: p.talk, to: who.name, kind: 'fire' });
        this.remember(who, `${L.name} judged me in front of everyone for ${c.what ? 'how I ' + c.what : 'breaking a way of this place'}: "${said.slice(0, 120)}" The judgment: ${penalty}.`);
        for (const o of guests) if (o !== who && o.stage === 'adult' && this.villagers.includes(o)) this.remember(o, `${L.name} judged ${who.name} at the fire for ${c.what ? 'how ' + (who.gender === 'm' ? 'he' : 'she') + ' ' + c.what : 'breaking a way of this place'}. The judgment: ${penalty}.`);
        this.addFeed('event', L, `${L.name} judged ${who.name} before everyone: ${penalty}.`);
        this.addChronicle('way', null, `${L.name} judged ${who.name} at the fire${way ? ` for breaking "${way.text.slice(0, 50)}"` : c.what ? ` for how ${who.gender === 'm' ? 'he' : 'she'} ${c.what}` : ''}: ${penalty}.`);
        if (penalty === 'must give back') { const to = by || this.storehouse() ? by : null; for (const k of ['food', 'wood', 'stone']) { const n = Math.min(4, this.have(who, k)); if (n > 0) { who.inv[k] -= n; if (to) this.give(to, k, n); else this.store[k] = (this.store[k] || 0) + n; } } this.remember(who, `I had to give back what I had.`); }
        if (penalty === 'shunned for a season') { who.shunnedUntil = this.day + 12; for (const o of this.adults()) if (o !== who) this.shiftAffinity(o, who, -8); this.lift(who, -15, -5); }
        if (penalty === 'driven out') { this.exile(who, L); }
        if (penalty === 'warned') { this.lift(who, -5, 0); for (const o of guests) if (o !== who && o.stage === 'adult') this.shiftAffinity(o, who, -2); }
        if (by && penalty !== 'nothing') { if (by.wrongs && by.wrongs[who.id] && by.wrongs[who.id].weight <= 2) { delete by.wrongs[who.id]; this.remember(by, `${L.name} judged ${who.name} for what ${who.gender === 'm' ? 'he' : 'she'} did to me. I can let it lie now.`); } }
        this.lift(L, 4, 3);
        await new Promise((res) => setTimeout(res, 4000));
      }
    };
    return run();
  }
  // Driven out of the valley for good.
  exile(v, by) {
    if (!this.villagers.includes(v)) return;
    this.endPlan(v);
    this.dropAsk(v);
    const kin = this.villagers.filter((o) => o !== v && o.stage === 'adult');
    this.villagers = this.villagers.filter((x) => x !== v);
    this.dead.push({ id: v.id, name: v.name, gender: v.gender, parents: v.parents, bornDay: v.bornDay, diedDay: this.day, cause: 'being driven out of the valley', years: this.years(v), partner: v.partner || null, calling: v.calling || '', founder: !!v.founder, exiled: true });
    for (const o of kin) { if (o.partner === v.id) { o.partner = null; o.singleSince = this.day; } if (this.closeKin(o, v)) { this.wrong(o, by, `drove out ${v.name}, my ${this.relation(o, v)}`, 2, 20); } this.remember(o, `${v.name} was driven out of the valley by ${by.name}'s judgment, and will not be back.`); }
    this.addFeed('death', v, `${v.name} was driven out of the valley.`);
    this.addChronicle('death', null, `${v.name} was driven out of the valley, by ${by.name}'s judgment.`);
    this.changed();
    this.wantSave = true;
  }

  // ---------- the cast ----------

  // A model can think for twenty or thirty people. Past that, a village becomes a people: most live in the background,
  // working, marrying, dying and being counted, while the model gives its full mind to whoever has something going on
  // in their life just now. Who that is changes every morning. Nobody is ever written out: a quiet person who gets
  // into a quarrel, falls ill, comes of age or falls in love steps into the light.
  castSize() { return Math.max(4, Number(this.cfg.castSize) || 24); }
  inLight(v) {
    if (!v) return false;
    if (v.stage !== 'adult') return v.parents.some((id) => { const p = this.byId(id); return p && this.inLight(p); });
    if (this.adults().length <= this.castSize()) return true;
    return v.lit !== false || (v.litUntil || 0) > this.clock;
  }
  // something has happened to this person: they are heard for a while whatever the roster says
  light(v, secs = 90) { if (v && v.stage === 'adult') v.litUntil = Math.max(v.litUntil || 0, this.clock + secs); }
  // how much is going on in a life, as the thing that decides who the model follows
  drama(v) {
    let n = 1 + Math.random() * 2;
    if (v.lit !== false) n += 2.5; // a life being followed is not dropped on a whim
    if (v.project) n += 4;
    if (this.inventions.some((i) => i.free && i.byId === v.id && !this.structures.some((st) => st.type === i.key))) n += 3;
    const alone = this.day - (v.singleSince ?? v.adultDay ?? this.day);
    if (!v.partner && !this.isOld(v) && alone >= 2) n += 3;
    const grudge = Object.values(v.wrongs || {}).reduce((a, w) => a + w.weight, 0);
    n += Math.min(6, grudge * 1.5);
    if (v.sick) n += 2;
    if (this.villagers.some((o) => o !== v && o.sick && (o.partner === v.id || o.parents.includes(v.id) || v.parents.includes(o.id)))) n += 2;
    if (v.partner && !this.childrenOf(v).length && !this.isOld(v)) n += 2;
    if (v.calling) n += 1.5;
    if (this.day - (v.adultDay || 0) <= 2) n += 3; // just grown
    if (this.childrenOf(v).some((c) => c.bornDay >= this.day - 1)) n += 2;
    if (v.carrying) n += 2;
    if (v.wants && v.wants.length) n += 1;
    if ((v.lastSpoke || 0) >= this.day - 1) n += 1.5; // was in a conversation lately
    if (this.day - (v.litDay || 0) > 6) n += 2; // nobody is left in the dark forever
    return n;
  }
  recast() {
    const adults = this.adults();
    const size = this.castSize();
    if (adults.length <= size) { for (const v of adults) { v.lit = true; v.litDay = this.day; } return; }
    const ranked = adults.map((v) => [v, this.drama(v)]).sort((a, b) => b[1] - a[1]);
    ranked.forEach(([v], i) => { const now = i < size; if (now && v.lit === false) this.remember(v, 'People have started to notice me again.'); v.lit = now; if (now) v.litDay = this.day; });
  }

  // ---------- materials ----------

  have(v, k) { return v.inv[k] || 0; }
  give(v, k, n) { v.inv[k] = Math.min(CARRY, (v.inv[k] || 0) + n); return v.inv[k]; }
  // the raw materials the valley gives that people here know how to get
  raws() {
    return Object.keys(RAW).filter((k) => {
      const r = RAW[k];
      if (r.needs && !this.knows(r.needs)) return false;
      if (r.from === 'hunt') return this.knows('hunting');
      if (r.from === 'pen') return this.count('pen') > 0;
      return true;
    });
  }
  // what can be gathered by hand out there right now
  gatherable(res) { const r = RAW[res]; return !!r && ['tree', 'rock', 'bush', 'clay', 'reeds'].includes(r.from) && (!r.needs || this.knows(r.needs)); }
  // every material people here have a name for: what the valley gives, and what they have learned to make
  materialNames() { return [...this.raws(), ...(this.materials || []).map((m) => m.name)]; }
  materialByName(name) { const n = String(name || '').toLowerCase().trim(); return (this.materials || []).find((m) => m.name === n) || null; }
  materialFrom(text) {
    const t = String(text || '').toLowerCase();
    const names = this.materialNames().sort((a, b) => b.length - a.length);
    return names.find((n) => new RegExp(`\\b${n.replace(/[^a-z ]/g, '')}s?\\b`).test(t)) || null;
  }
  // how a material looks when something is built or made of it
  lookOf(name) {
    const m = this.materialByName(name);
    const n = String(name || '').toLowerCase();
    if (/brick|tile|adobe/.test(n)) return 'brick';
    if (/copper/.test(n)) return 'copper';
    if (/bronze|brass/.test(n)) return 'bronze';
    if (/iron|steel/.test(n)) return 'iron';
    if (/glass/.test(n)) return 'glass';
    if (/cloth|linen|wool|felt|textile|canvas/.test(n)) return 'cloth';
    if (m && (m.tags || []).some((t) => ['metal', 'bronze', 'iron', 'steel'].includes(t))) return 'metal';
    if (n === 'reeds' || /thatch|straw|grass/.test(n)) return 'thatch';
    if (n === 'hide' || n === 'bone' || /leather|fur/.test(n)) return 'hide';
    if (n === 'clay') return 'clay';
    if (n === 'stone' || /stone|rock|marble|slate/.test(n)) return 'stone';
    return 'wood';
  }
  isMetal(name) { const m = this.materialByName(name); return !!m && (m.tags || []).some((t) => ['metal', 'bronze', 'iron', 'steel'].includes(t)); }
  // the turning points people here have reached
  knownTags() {
    const k = new Set();
    for (const i of this.inventions) for (const t of i.tags || []) k.add(t);
    for (const m of this.materials || []) for (const t of m.tags || []) k.add(t);
    if (k.has('bronze') || k.has('iron') || k.has('steel')) k.add('metal');
    if (k.has('steel')) k.add('iron');
    return k;
  }
  ageOf() { const k = this.knownTags(); return AGES.find(([, test]) => test(k)); }
  ageName() { return this.ageOf()[0]; }
  ageLine() { return `It is ${this.ageName()}. ${this.ageOf()[2]}`; }
  // Something new has been worked out: has it carried the people into a new age?
  checkAge(by) {
    const now = this.ageName();
    if (!this.epoch) { this.epoch = now; return; }
    if (now === this.epoch) return;
    const idx0 = AGES.findIndex((a) => a[0] === this.epoch), idx1 = AGES.findIndex((a) => a[0] === now);
    if (idx1 > idx0) return; // ages do not go backwards
    this.epoch = now;
    for (const o of this.adults()) this.remember(o, `Something has changed for good. The old people say we live in a new age now: ${now}.`);
    this.addFeed('discovery', by || null, `${now} begins. ${this.ageOf()[2]}`);
    this.addChronicle('age', null, `${now} begins, in Year ${this.day}.${by ? ` It was ${by.name}'s doing.` : ''}`);
    this.changed();
  }

  // How far an invented advantage reaches: built buildings and shared know-how help everyone, a tool helps whoever owns one.
  effectLevel(effect, v = null) {
    let n = 0;
    for (const inv of this.inventions) {
      if (inv.effect !== effect) continue;
      if (inv.kind === 'knowhow') n++;
      else if (inv.kind === 'building') { if (this.structures.some((st) => st.type === inv.key && st.p >= 1)) n++; }
      else if (v && (v.items || []).some((it) => it.inv === inv.id)) n += (inv.uses || []).some((u) => this.isMetal(u)) ? 2 : 1;
    }
    const k = this.knownTags();
    return Math.min(3 + (k.has('metal') ? 1 : 0) + (k.has('iron') ? 1 : 0) + (k.has('machine') || k.has('engine') ? 1 : 0), n);
  }

  // ---------- what a person needs, from the ground up ----------

  // Five levels: the body, then safety, then belonging, then standing among the others, then a purpose of one's own.
  // Each is worked out from what is true of that person's life. Nothing here makes anyone do anything:
  // it is what they feel, and the lowest level going unmet is the one they feel loudest.
  foodDays() {
    const people = this.here();
    const perDay = people.filter((o) => o.stage === 'adult').length * 1.9 + people.filter((o) => o.stage === 'child').length * 1.2;
    return (this.stored('food') + people.reduce((sum, o) => sum + o.inv.food, 0)) / Math.max(1, perDay);
  }
  woodNights() {
    const people = this.here();
    const homes = this.structures.filter((s) => STRUCT[s.type].home && s.p >= 1 && people.some((o) => o.home === s.id)).length;
    return homes ? (this.stored('wood') + people.reduce((sum, o) => sum + o.inv.wood, 0)) / (homes * 2) : 99;
  }
  maslow(v) {
    if (!this.needCache) this.needCache = new WeakMap();
    const hit = this.needCache.get(v);
    const stamp = Math.floor(this.clock * 2);
    if (hit && hit.stamp === stamp) return hit.m;
    const m = this.maslowNow(v);
    this.needCache.set(v, { stamp, m });
    return m;
  }
  maslowNow(v) {
    const n = v.needs, adult = v.stage === 'adult', old = adult && this.isOld(v);
    const why = [[], [], [], [], []];

    // 1. the body
    const parts = adult ? [n.hunger, n.energy, v.health] : [n.hunger, v.health];
    let body = 0.7 * Math.min(...parts) + 0.3 * (parts.reduce((a, b) => a + b, 0) / parts.length);
    if (v.sick) { body -= 20; why[0].push(`you are sick with ${v.sick.name}`); }
    if (n.hunger < 50) why[0].push(n.hunger < 12 ? 'you are starving' : n.hunger < 35 ? 'you are hungry' : 'you could do with a meal');
    if (adult && n.energy < 45) why[0].push(n.energy < 15 ? 'you can barely stand' : n.energy < 35 ? 'you are worn out' : 'you are getting tired');
    if (v.health < 60) why[0].push('you are hurt');

    // 2. safety
    let safe = 100;
    const home = this.structById(v.home);
    if (adult && !home) { safe -= 35; why[1].push('you have no roof to sleep under'); }
    else if (adult && home.owner !== v.id && home.owner !== v.partner) safe -= 8;
    const days = this.foodDays();
    if (days < 2) { safe -= 35; why[1].push('there is almost no food put by'); }
    else if (days < 5) { safe -= 20; why[1].push('there is little food put by'); }
    else if (days < 9) safe -= 6;
    const nights = this.woodNights();
    if (this.isWinter() && nights < 2) { safe -= 20; why[1].push('the firewood is nearly gone'); }
    else if (this.daysToWinter() <= 3 && nights < 3) { safe -= 10; why[1].push('winter is close and there is little firewood'); }
    const sky = this.weatherNow();
    if (this.dangerOutside()) { safe -= v.inside ? 10 : 40; why[1].push(sky === 'blizzard' ? 'a blizzard is blowing' : 'a storm is overhead'); }
    if (sky === 'bitter') safe -= 10;
    if (this.wolves().length) { safe -= v.inside ? 8 : 30; why[1].push('wolves are about'); }
    const blaze = this.nearestFire(v);
    if (blaze && blaze.d < 14) { safe -= 40; why[1].push('fire is close'); }
    const dz = this.disaster;
    if (dz) {
      const cost = { drought: 15, flood: 12, plague: 30, wildfire: 15 }[dz.kind] || 0;
      safe -= cost;
      if (cost) why[1].push({ drought: 'the rain has not come', flood: 'the water has risen', plague: 'a sickness is going from house to house', wildfire: 'the land is burning' }[dz.kind]);
    }

    // 3. belonging
    const others = this.villagers.filter((o) => o !== v && !o.away);
    const close = others.filter((o) => this.getAffinity(v, o) >= 60).length;
    let belong;
    if (!adult) {
      const folks = v.parents.filter((id) => this.byId(id)).length;
      belong = 30 + folks * 25 + Math.min(2, close) * 10;
      if (!folks) why[2].push('you have no mother or father left');
    } else {
      const mate = this.byId(v.partner);
      belong = 0.35 * n.social + Math.min(3, close) * 9 + (this.childrenOf(v).length ? 8 : 0) + 4 * this.effectLevel('gathering', v);
      if (mate) {
        const a = this.getAffinity(v, mate);
        belong += Math.min(30, a * 0.4);
        if (a < 35) why[2].push(`things have gone cold between you and ${mate.name}`);
      } else if (old) belong += 14;
      else {
        const alone = Math.max(0, this.day - (v.singleSince ?? v.adultDay ?? this.day));
        belong -= Math.min(10, alone) * 2;
        why[2].push(alone >= 2 ? 'you have no mate, and you have been alone a long time' : 'you have no mate');
      }
      if (n.social < 30) why[2].push('you have hardly spoken to anyone');
      if (!close && others.length) why[2].push('there is nobody here you are close to');
    }

    // 4. standing: how the others see them, and what they have to show for themselves
    let esteem = 72;
    if (adult) {
      const grown = this.adults().filter((o) => o !== v);
      const regard = grown.length ? grown.reduce((sum, o) => sum + this.getAffinity(o, v), 0) / grown.length : 55;
      const works = this.structures.filter((s) => s.owner === v.id && s.p >= 1 && s.type !== 'grave').length;
      const ideas = this.inventions.filter((i) => (i.byId ? i.byId === v.id : i.by === v.name)).length;
      esteem = clamp(22 + (regard - 30) * 0.6, 0, 46) + (v.calling ? 14 : 0) + Math.min(4, works) * 3 + Math.min(3, ideas) * 5
        + Math.min(3, this.childrenOf(v).length) * 2 + (v.pride || 0) + 4 * this.effectLevel('honor', v);
      if (regard < 38 && grown.length) why[3].push('the others think little of you');
      if (!v.calling && !works && !ideas) why[3].push('you have made nothing here that bears your name');
      else if (!v.calling) why[3].push('nobody here knows you for any one thing yet');
      if ((v.pride || 0) <= -8) why[3].push('your pride has taken a blow lately');
    }

    // 5. a purpose of their own
    let purpose = 70;
    if (adult) {
      purpose = this.purposeOf(v);
      if (purpose < 65) why[4].push(purpose < 40 ? 'the days go by all alike, and nothing in them is your own' : 'you have done little lately that was for its own sake');
      if (purpose < 65 && v.nature && v.nature.drawn) why[4].push(`you are drawn to ${String(v.nature.drawn).replace(/\.$/, '')}, and you have not gone after it`);
    }

    const scores = [body, safe, belong, esteem, purpose].map((x) => Math.round(clamp(x)));
    // a body is never perfectly topped up, so it only counts as wanting when it really is
    let at = scores.findIndex((x) => x < 40), state = 'unmet';
    if (at < 0) { at = scores.findIndex((x, i) => x < (i === 0 ? 50 : 65)); state = 'wanting'; }
    if (at < 0) { at = 4; state = 'met'; }
    return { scores, at, state, why, level: LEVELS[at].key };
  }
  // Doing things changes how a person stands with themselves: pride is what others can see, purpose is what only they can feel.
  lift(v, pride = 0, purpose = 0) {
    if (!v || v.stage !== 'adult') return;
    if (pride) v.pride = clamp((v.pride || 0) + pride, -30, 30);
    if (purpose) v.purpose = clamp(this.purposeOf(v) + purpose);
  }
  purposeOf(v) { return v.purpose ?? (v.calling ? 72 : 56); }
  // What this place most lacks an answer to, as an idea someone might work on. Need is where ideas come from.
  needIdea(v) {
    const m = this.maslow(v), ideas = [];
    const add = (effect, text) => { if (!this.covered(effect)) ideas.push(text); };
    if (this.foodDays() < 6) add('more_food', 'a way to get more food out of the land');
    if ((this.disaster && this.disaster.kind === 'drought') || this.dry()) add('water', 'a way to bring water to the fields when no rain comes');
    if (Object.keys(this.fires || {}).length || this.burned) add('fire_guard', 'a way to stop a fire before it reaches the houses');
    if (this.wolves().length) add('safety', 'a way to keep the wolves off');
    if (this.isWinter() || this.daysToWinter() <= 3) add('warmth', 'a way to stay warm at night');
    if (this.villagers.some((o) => o.sick)) add('health', 'a way to help the sick mend');
    if ((this.stillborn || []).length || this.dead.some((d) => d.cause === 'childbirth')) add('birth', 'a way to help a mother through a birth');
    if (this.dead.some((d) => /tree|rockfall|fall|drowning|antlers/.test(d.cause || ''))) add('safer_work', 'a way to work without getting hurt, safer than before');
    if (ideas.length && m.at <= 1) return pick(ideas);
    if (m.at === 2) add('gathering', 'a place where everyone can sit together and eat together');
    if (m.at === 3) add('honor', 'a way to mark who did what, so it is remembered');
    if (m.at === 4) add('meaning', 'a thing to make music with');
    if (!ideas.length) {
      add('keeps_food', 'a way to keep food from spoiling'); add('better_hunting', 'a better way to catch fish'); add('better_tools', 'a tool for felling trees faster');
      add('comfort', 'a softer place to sleep'); add('herding', 'a better way to keep the flock in the pen'); add('meaning', 'a game to play by the fire');
      add('honor', 'a way to honor the dead'); add('gathering', 'a meeting place for everyone'); add('knowledge', 'a way to count the days');
    }
    return ideas.length ? pick(ideas) : 'a thing nobody here has thought of yet';
  }

  // ---------- what a person is born with ----------

  newGenes(pa, pb) {
    const g = {};
    const bell = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2.15; // most land near the middle, a few far out
    for (const k of Object.keys(TRAITS)) {
      const a = pa && pa.genes ? pa.genes[k] : null, b = pb && pb.genes ? pb.genes[k] : null;
      const base = a != null && b != null ? (a + b) / 2 : a ?? b ?? 0;
      g[k] = Math.max(-2, Math.min(2, Math.round(base * 0.6 + bell())));
    }
    // nobody is middling in everything
    if (Object.values(g).filter((x) => x !== 0).length < 2) { const k = pick(Object.keys(TRAITS)); g[k] = Math.random() < 0.5 ? -2 : 2; }
    return g;
  }
  gene(v, k) { return (v.genes && v.genes[k]) || 0; }
  // The person in plain words, straight from what they were born with. True whether or not a model ever adds to it.
  plainNature(v) {
    const g = v.genes || {};
    const keys = Object.keys(TRAITS).sort((a, b) => Math.abs(g[b] || 0) - Math.abs(g[a] || 0) || Math.random() - 0.5);
    const words = keys.filter((k) => g[k]).slice(0, 3).map((k) => TRAITS[k][g[k] + 2]);
    let flaw = '';
    for (const k of keys) { const f = (FAULTS[k] || {})[g[k]]; if (f) { flaw = pick(f); break; } }
    if (!flaw) flaw = pick(PLAIN_FAULTS);
    const voice = g.social >= 2 ? 'talks far too much' : g.social <= -2 ? 'says almost nothing' : g.honest >= 2 ? 'blunt to the point of rude' : g.temper >= 1 ? 'loud' : g.honest <= -1 ? 'soft and roundabout' : g.pride >= 1 ? 'bossy and brisk'
      : pick(['jokes about everything', 'asks endless questions', 'mutters and grumbles', 'tells everything as a story', 'dry and teasing', 'earnest, never jokes', 'plain and slow']);
    const humor = pick(PLAIN_HUMOR).replace('her own', v.gender === 'm' ? 'his own' : 'her own');
    return { temperament: words.length ? words.join(', ') : 'steady, middling in most things', flaw, humor, voice, drawn: pick(PLAIN_DRAWN) };
  }

  // ---------- grudges ----------

  // Something done to a person that they do not forgive. weight: 1 a slight, 2 a real wrong, 3 blood.
  // While it stands, their feeling for the one who did it does not mend on its own.
  wrong(v, by, what, weight = 1, hit = 0) {
    if (!v || !by || v === by || v.stage !== 'adult' || !this.villagers.includes(v)) return;
    this.light(v, 240); this.light(by, 240); // a wrong done is a story worth following
    if (!v.wrongs) v.wrongs = {};
    const had = v.wrongs[by.id];
    if (!had || weight >= had.weight) v.wrongs[by.id] = { day: this.day, what, weight };
    if (hit) v.affinity[by.id] = clamp(this.getAffinity(v, by) - hit);
    if (v.vented) delete v.vented[by.id];
  }
  grudges(v) {
    return Object.entries(v.wrongs || {}).map(([id, w]) => ({ o: this.byId(Number(id)), w })).filter((x) => x.o && !x.o.away);
  }
  closeKin(a, b) { return a.partner === b.id || a.parents.includes(b.id) || b.parents.includes(a.id) || this.kinship(a, b) === 2; }

  // People who work while others sit come to resent it, and more so when the store is running low.
  resentIdlers() {
    if (this.foodDays() >= 6) return;
    const able = this.adults().filter((v) => !v.away && !v.sick && !this.isOld(v) && this.day - (v.adultDay ?? 0) >= 1);
    // one slow day is nobody's business; day after day of it, in a hungry season, is everybody's
    const idle = able.filter((v) => (v.worked ?? v.adultDay ?? 0) < this.day - 3);
    if (able.length < 5 || !idle.length || idle.length > able.length / 2) return;
    for (const o of able) {
      if (idle.includes(o)) continue;
      for (const i of idle) {
        if (o.partner === i.id || (this.closeKin(o, i) && Math.random() < 0.5)) continue; // people make excuses for their own
        this.shiftAffinity(o, i, -3);
        if (!o.idleSeen) o.idleSeen = {};
        o.idleSeen[i.id] = (o.idleSeen[i.id] || 0) + 1;
        if (o.idleSeen[i.id] >= 3) {
          o.idleSeen[i.id] = 0;
          this.wrong(o, i, 'eats from the store and brings nothing in', this.wayAbout('work') ? 2 : 1);
          if (this.wayAbout('work')) this.breach(i, 'work', 'ate from the store and brought nothing in', [o]);
          this.remember(o, `${i.name} eats what the rest of us bring in and does not lift a hand. I am sick of it.`);
        }
      }
    }
  }

  // A temper breaks when it breaks: nobody chooses the moment. How far it goes depends on who they are,
  // how badly they were wronged and how worn they are. What they say is their own.
  flare(v) {
    if (this.cfg.violence === false || v.sick || this.isNight() || this.dangerOutside()) return false;
    if ((v.flareDay ?? -99) > this.day - 3) return false; // a spent temper takes time to build again
    const temper = this.gene(v, 'temper'), nerve = this.gene(v, 'nerve');
    let foe = null, score = 0;
    for (const o of this.adults()) {
      if (o === v || o.away || o.inside || o.sleeping || dist(v, o) > 16) continue;
      const w = (v.wrongs || {})[o.id], a = this.getAffinity(v, o);
      if (!w && a >= 30) continue;
      if (((v.vented || {})[o.id] ?? -99) > this.day - 9) continue; // having had it out, a person lets it lie a good while
      const sc = (w ? w.weight * 2 : 0) + (a < 15 ? 3 : a < 30 ? 1.5 : 0.5);
      if (sc > score) { score = sc; foe = o; }
    }
    if (!foe) return false;
    const worn = v.needs.hunger < 30 || v.needs.energy < 25;
    if (Math.random() > 0.0045 * [0.3, 0.6, 1, 1.8, 3][temper + 2] * score * (worn ? 1.6 : 1)) return false;
    const w = (v.wrongs || {})[foe.id], hate = this.getAffinity(v, foe);
    // where there is someone to bring it to, most people do, unless they are the hot-headed kind or it is blood
    if (w && this.leader && this.leader !== v.id && this.leader !== foe.id && temper <= 1 && w.weight < 3 && this.getAffinity(v, this.byId(this.leader)) >= 40 && Math.random() < 0.7) { if (this.bring(v, foe, w.what)) { v.flareDay = this.day; return true; } }
    let strike = 0.06 + 0.1 * temper + 0.06 * nerve + (w ? 0.1 * (w.weight - 1) : 0) + (hate < 15 ? 0.15 : 0) + (worn ? 0.05 : 0);
    if (nerve <= -2) strike = 0; // the timid shout, or swallow it
    let heat = Math.random() < Math.max(0, Math.min(0.8, strike)) ? 'strike' : 'shout';
    if (heat === 'strike' && Math.random() < (w && w.weight >= 3 ? 0.15 : hate < 10 ? 0.07 : 0.012) * (temper >= 2 ? 1.5 : 1)) heat = 'kill';
    v.flareDay = this.day;
    if (!v.vented) v.vented = {};
    v.vented[foe.id] = this.day;
    this.dropAsk(v);
    v.thinking = true;
    v.brood = heat === 'shout' ? `glaring at ${foe.name}` : `seething at ${foe.name}`;
    const why = w ? w.what : 'you cannot stand the sight of them';
    this.brain.rage(v, foe, why, heat).then((r) => {
      v.thinking = false;
      if (!this.villagers.includes(v) || !this.villagers.includes(foe) || v.plan || v.away || foe.away) return;
      const say = (r && r.say) || pick(heat === 'shout' ? [`I have had enough of you, ${foe.name}.`, `Do not think I have forgotten, ${foe.name}.`, `${foe.name}! You know what you did.`] : [`${foe.name}!`, `You had this coming, ${foe.name}.`]);
      v.thought = (r && r.thought) || (heat === 'shout' ? `I cannot hold my tongue with ${foe.name} any longer.` : `I am going to make ${foe.name} pay.`);
      if (heat === 'shout') {
        const res = this.startChase(v, { to: foe.name, say }, 'quarrel');
        if (res.ok) this.addFeed('thought', v, v.thought, { act: res.summary });
        return;
      }
      const res = this.startChase(v, { to: foe.name, say }, heat === 'kill' ? 'kill' : 'fight');
      if (res.ok) this.addFeed('thought', v, v.thought, { act: res.summary });
    });
    return true;
  }
  // Hard words, in front of whoever is near.
  finishQuarrel(v, p) {
    const t = this.byId(p.to);
    if (!t || t.sleeping) return this.endPlan(v);
    v.dir = t.x < v.x ? -1 : 1;
    this.say(v, p.say, 700, false, { id: p.talk, to: t.name, kind: 'quarrel' });
    this.shiftAffinity(v, t, -4);
    this.shiftAffinity(t, v, -8);
    this.lift(t, -3);
    this.remember(v, `I had it out with ${t.name}, loud enough for everyone to hear. I said: "${String(p.say).slice(0, 110)}"`);
    this.remember(t, `${v.name} shouted at me in front of everyone: "${String(p.say).slice(0, 110)}"`);
    if (this.gene(t, 'pride') >= 1 || this.gene(t, 'temper') >= 1) this.wrong(t, v, 'shamed me in front of everyone', 1);
    this.addFeed('event', v, `${v.name} shouted at ${t.name} where everyone could hear.`);
    v.needs.social = clamp(v.needs.social + 10);
    this.endPlan(v, 1.5);
  }
  // Blood. Everyone who knows of it remembers, and the dead one's family does not forgive.
  killing(killer, victim, meant, witnesses) {
    const known = !meant || witnesses.length > 0; // a brawl is loud; a blade in the dark may go unseen
    // a killer struck down by the dead one's family got what most people think was coming
    const answered = !!victim.killed || Object.values(killer.wrongs || {}).some((w) => w.weight >= 3);
    const rels = this.adults().filter((o) => o !== killer && o !== victim).map((o) => [o, (o.partner === victim.id || o.parents.includes(victim.id) || victim.parents.includes(o.id) || (this.kinship(o, victim) === 2 && Math.random() < 0.5)) && !(answered && Math.random() < 0.7), this.relation(o, victim)]);
    const yrs = this.years(victim);
    if (!this.killings) this.killings = [];
    this.killings.push({ day: this.day, killer: killer.name, victim: victim.name, meant, known });
    this.die(victim, known ? `a blow from ${killer.name}` : 'a blow in the dark', {
      line: known ? `${killer.name} killed ${victim.name}${meant ? '' : ' in a fight that went too far'}. ${victim.gender === 'm' ? 'He' : 'She'} was ${yrs}.` : `${victim.name} was found dead, struck down, aged ${yrs}. Nobody saw who did it.`,
    });
    killer.killed = (killer.killed || 0) + 1;
    this.lift(killer, -20, -10);
    if (known) this.breach(killer, 'killing', `killed ${victim.name}`, this.adults().filter((o) => o !== killer));
    this.remember(killer, meant ? `I killed ${victim.name}. It is done, and it cannot be undone.${known ? '' : ' Nobody saw.'}` : `I killed ${victim.name}. I did not mean to. It went too far.`);
    for (const [o, close, rel] of rels) {
      if (!known) { this.remember(o, `${victim.name} was found dead, struck down. Nobody saw who did it.`); continue; }
      if (close) { this.wrong(o, killer, `killed ${victim.name}, my ${rel}`, 3, 45); this.remember(o, `${killer.name} killed ${victim.name}, my ${rel}. I will not forget it as long as I live.`); }
      else { this.shiftAffinity(o, killer, answered ? -6 : this.closeKin(o, killer) ? -10 : meant ? -25 : -14); this.remember(o, `${killer.name} killed ${victim.name}${meant ? '' : ' in a fight'}.`); }
    }
    this.wantSave = true;
  }

  // ---------- the daily round ----------

  // Nobody thinks about whether to bring in the harvest when the store is low. It is simply what a morning is for.
  // How much of the morning a person gives to it depends on who they are.
  chore(v) {
    if (this.cfg.chores === false || v.sick || v.health < 50) return false;
    if (this.time < 0.1 || this.time > 0.62 || this.dangerOutside() || this.wolves().length) return false;
    const days = this.foodDays();
    const lean = days < (this.isWinter() ? 6 : this.season() === 'autumn' ? 16 : 9);
    const cold = (this.isWinter() || this.daysToWinter() <= 3) && this.woodNights() < 4;
    if (!lean && !cold) return false;
    if (v.choreDay !== this.day) { v.choreDay = this.day; v.chores = 0; }
    const quota = [0, 1, 2, 2, 3][this.gene(v, 'drive') + 2] + (days < 3 ? 1 : 0) - (this.isOld(v) ? 1 : 0);
    if (v.chores >= quota) return false;
    let res = null, line = '';
    const store = this.storehouse();
    // with nowhere to put food by, nothing else can be made safe
    if (!store && this.villagers.length >= 4 && !this.buildBlock(v, 'storehouse') && !this.structures.some((s) => s.type === 'storehouse') && !Object.keys(this.missing(v, 'storehouse')).length) { res = this.startBuild(v, { target: 'storehouse', near: 'campfire' }); line = 'We need somewhere to put food by.'; }
    if (store && (v.inv.food >= 14 || v.inv.wood >= 16)) { res = this.startStore(v); line = 'This belongs in the store.'; }
    if ((!res || !res.ok) && lean && v.inv.food < CARRY - 2) {
      const ripe = this.structures.some((s) => FOOD_SOURCES[s.type] && s.p >= 1 && s.ripe && !s.res);
      const bold = this.is(v, 'hunt') || this.gene(v, 'nerve') >= 1 || days < 3; // hunger makes hunters of everyone
      if (ripe) { res = this.startGather(v, 'food'); line = 'The crop will not bring itself in.'; }
      else if (bold && this.knows('hunting') && this.spareGame() && Math.random() < 0.5) { res = this.startHunt(v, { target: this.spareGame() }); line = 'There is meat out there, and we need it.'; }
      else if (this.knows('fishing') && this.fishShare() > 0.35 && (this.is(v, 'fish') || this.isWinter() || Math.random() < 0.4)) { res = this.startFish(v); line = 'The pond will have to feed us today.'; }
      else if (!this.isWinter()) { res = this.startGather(v, 'food'); line = 'There is food to find, and mouths waiting on it.'; }
      if ((!res || !res.ok) && this.knows('fishing') && this.fishShare() > 0.2) { res = this.startFish(v); line = 'The pond will have to feed us today.'; }
      // not enough ground under the plough for this many mouths
      if ((!res || !res.ok) && !this.isWinter() && !this.buildBlock(v, 'farm') && !Object.keys(this.missing(v, 'farm')).length) { res = this.startBuild(v, { target: 'farm', near: 'home' }); line = 'We need more ground under crops than this.'; }
    }
    if ((!res || !res.ok) && cold && v.inv.wood < CARRY - 2) { res = this.startGather(v, 'wood'); line = 'The woodpile will not last the cold as it stands.'; }
    if (!res || !res.ok) { v.chores = 99; return false; } // nothing to be done this morning; do not keep trying
    v.chores++;
    if (v.plan) v.plan.chore = true;
    v.thought = line;
    this.addFeed('thought', v, '', { act: res.summary });
    return true;
  }

  // ---------- desire ----------

  // Couples who can stand each other end up in the same bed most nights without anyone deciding it.
  nightTogether() {
    if (this.cfg.matingDrive === false) return;
    for (const m of this.adults()) {
      if (m.gender !== 'f' || !m.partner) continue;
      const f = this.byId(m.partner);
      if (!f || m.away || f.away || m.sick || f.sick) continue;
      if (Math.min(this.getAffinity(m, f), this.getAffinity(f, m)) < 40) continue;
      if (m.needs.hunger < 20 || f.needs.hunger < 20) continue;
      const age = Math.max(this.years(m), this.years(f));
      if (Math.random() < (age < 30 ? 0.9 : age < 45 ? 0.7 : age < 60 ? 0.4 : 0.12)) m.bedDay = f.bedDay = this.day;
    }
  }
  // a child every three or four years while a woman is young, fewer as she ages: six or eight in a life, as it was before anyone counted
  fertility(m) { const y = this.years(m); return y < 30 ? 0.6 : y < 38 ? 0.5 : y < 45 ? 0.25 : y < 50 ? 0.08 : 0.02; }
  // Want does not stop at who a person is promised to. Someone whose own bed is cold may go looking, quietly.
  // Whether the other one says yes is theirs. What comes of it, if it comes out, is everyone's.
  tryst(v) {
    if (this.cfg.affairs === false || this.cfg.matingDrive === false || v.sick || this.isOld(v)) return false;
    if ((v.lustDay || 0) >= this.day || this.time < 0.3 || this.time > 0.78 || this.dangerOutside()) return false;
    if (v.needs.hunger < 35 || v.needs.energy < 35) return false;
    const mate = this.byId(v.partner);
    const coldBed = mate ? (mate.away || this.isOld(mate) || this.getAffinity(v, mate) < 45)
      : (this.day - (v.singleSince ?? v.adultDay ?? this.day) >= 2 && !this.suitable(v).length);
    if (!coldBed) return false;
    v.lustDay = this.day; // it crosses a mind once a day at most
    if (Math.random() > 0.07 * [0.4, 0.7, 1, 1.4, 2][this.gene(v, 'nerve') + 2] * [2, 1.4, 1, 0.6, 0.3][this.gene(v, 'honest') + 2]) return false;
    const pool = this.adults().filter((o) => o !== v && o.gender !== v.gender && !o.away && !o.sleeping && !o.sick && !this.isOld(o) && o.partner !== v.id
      && this.kinship(v, o) < 2 && (o.partner || v.partner) && this.getAffinity(v, o) >= 50 && ((v.spurned || {})[o.id] ?? -99) < this.day - 10);
    if (!pool.length) return false;
    const t = pool.sort((a, b) => this.getAffinity(v, b) - this.getAffinity(v, a))[0];
    const res = this.startChase(v, { to: t.name }, 'tryst');
    if (!res.ok) return false;
    this.dropAsk(v);
    v.thought = `I keep looking at ${t.name}. I know I should not.`;
    this.addFeed('thought', v, v.thought, { act: res.summary });
    return true;
  }
  beginTryst(v, p) {
    const t = this.byId(p.to);
    if (!t || t.sleeping || this.inConversation(t)) return this.failPlan(v, `${t ? t.name : 'they'} could not be got alone`);
    v.dir = t.x < v.x ? -1 : 1;
    t.dir = v.x < t.x ? -1 : 1;
    t.holdUntil = Date.now() + 30000;
    p.phase = 'converse';
    p.waiting = true;
    p.deadline = Date.now() + 90000;
    const tMate = this.byId(t.partner);
    const lonely = !tMate || tMate.away || this.isOld(tMate) || this.getAffinity(t, tMate) < 50;
    // what their body says, before their head has a say
    const pull = Math.max(0.03, Math.min(0.7, 0.1 + (this.getAffinity(t, v) - 50) / 80 + (lonely ? 0.25 : 0) - 0.1 * this.gene(t, 'honest')));
    const willing = Math.random() < pull;
    this.brain.tryst(t, v, willing, lonely).then((r) => {
      if (v.plan !== p) return;
      const yes = r ? /yes/i.test(String(r.answer)) : willing;
      if (r && r.say) this.say(t, r.say, 700, false, { id: p.talk, to: v.name, kind: 'tryst' });
      const [w, man] = v.gender === 'f' ? [v, t] : [t, v];
      const spouses = [[v, this.byId(v.partner)], [t, tMate]].filter(([, sp]) => sp && sp !== v && sp !== t);
      if (yes) {
        this.changeAffinity(v, t, 8);
        v.needs.social = clamp(v.needs.social + 30); t.needs.social = clamp(t.needs.social + 30);
        this.remember(v, `${t.name} and I lay together in secret.`);
        this.remember(t, `${v.name} and I lay together in secret.`);
        if (this.canBear(w) && !w.carrying && this.day - (w.lastBirthDay || 0) >= Math.max(2, this.cfg.birthGapDays) && Math.random() < this.fertility(w) * 0.5) w.carrying = { by: man.id, day: this.day };
        if (Math.random() < 0.3) {
          for (const [cheat, sp] of spouses) {
            const other = cheat === v ? t : v;
            this.wrong(sp, other, `lay with my ${cheat.gender === 'f' ? 'wife' : 'husband'}`, 3, 40);
            this.wrong(sp, cheat, `lay with ${other.name} behind my back`, 2, 30);
            this.remember(sp, `I found out that ${cheat.name} has been lying with ${other.name}.`);
            this.breach(cheat, 'marriage and beds', `lay with ${other.name} behind ${sp.name}'s back`, [sp]);
            this.addFeed('event', sp, `${sp.name} has found out that ${cheat.name} has been lying with ${other.name}.`);
            this.addChronicle('event', null, `${sp.name} found out that ${cheat.name} had been lying with ${other.name}.`);
          }
        }
      } else {
        if (!v.spurned) v.spurned = {};
        v.spurned[t.id] = this.day;
        this.shiftAffinity(v, t, -5);
        this.lift(v, -6);
        this.remember(v, `I went to ${t.name} wanting to lie with ${t.gender === 'm' ? 'him' : 'her'}. ${t.gender === 'm' ? 'He' : 'She'} sent me away.`);
        this.remember(t, `${v.name} came to me wanting to lie with me. I sent ${v.gender === 'm' ? 'him' : 'her'} away.`);
        if (tMate && !tMate.away && Math.random() < 0.4) {
          this.wrong(tMate, v, `tried to take my ${t.gender === 'f' ? 'wife' : 'husband'} to bed`, 2, 25);
          this.remember(tMate, `${t.name} told me that ${v.name} came to ${t.gender === 'm' ? 'him' : 'her'} wanting to lie with ${t.gender === 'm' ? 'him' : 'her'}.`);
          this.addFeed('event', tMate, `${tMate.name} has heard that ${v.name} went after ${t.name}.`);
        }
      }
      p.waiting = false;
      p.timer = yes ? 9 : 3;
      t.holdUntil = Date.now() + (yes ? 9000 : 3000);
    });
  }

  // ---------- things nobody keeps up ----------

  // A built thing that does nothing for anyone lasts only as long as someone cares to mend it. A village keeps a few
  // such things. The rest go back to the ground, and in time nobody remembers how they were made.
  idleKind(type) {
    const def = STRUCT[type];
    if (!def || !def.custom) return false;
    if (def.effect === 'none') return true;
    const first3 = this.inventionsFor(def.effect).slice(0, 3).map((i) => i.key);
    return !first3.includes(type);
  }
  ruin() {
    if (this.cfg.ruin !== true) return; // by default everything they build stands for good
    const idle = this.structures.filter((s) => s.p >= 1 && this.idleKind(s.type));
    const keep = 3 + Math.floor(this.villagers.length / 5);
    if (idle.length > keep) {
      const old = idle.filter((s) => this.day - (s.day || 0) > 8).sort((a, b) => (a.day || 0) - (b.day || 0));
      const gone = [];
      for (const s of old) {
        if (idle.length - gone.length <= keep || gone.length >= 6) break;
        if (Math.random() < 0.3) gone.push(s);
      }
      if (gone.length) {
        this.structures = this.structures.filter((s) => !gone.includes(s));
        this.rebuildGrids();
        const names = [...new Set(gone.map((s) => `the ${this.typeName(s.type)}`))];
        this.addFeed('event', null, `${gone.length === 1 ? 'An old thing' : `${gone.length} old things`} nobody kept up ${gone.length === 1 ? 'has' : 'have'} fallen to ruin: ${this.listNames(names.slice(0, 4))}${names.length > 4 ? ' and more' : ''}.`);
        this.changed();
      }
    }
  }
  cleanLabel(t) { return String(t || '').replace(/["\n]/g, '').trim().slice(0, 40); } // whatever they call it is what it is called

  // ---------- who people are ----------

  // What is plainly true of the world on a given day. A child born into a hungry winter is not the child of an easy summer.
  circumstances(mother) {
    const out = [`It is ${this.season()} of year ${this.day}. ${this.villagers.length} people live here.`];
    const per = (this.stored('food') + this.villagers.reduce((n, v) => n + v.inv.food, 0)) / Math.max(1, this.villagers.length);
    out.push(per > 25 ? 'There is plenty of food put by.' : per > 8 ? 'There is enough food, with some care.' : per > 2 ? 'Food is thin, and everyone knows it.' : 'There is almost nothing to eat.');
    if (this.isWinter()) out.push('Snow is on the ground and the nights are bitter.');
    if (this.wolves().length) out.push('Wolves are close tonight.');
    const sick = this.villagers.filter((v) => v.sick).map((v) => v.name);
    if (sick.length) out.push(`${this.listNames(sick)} ${sick.length > 1 ? 'are' : 'is'} sick.`);
    const gone = this.dead.filter((d) => this.day - d.diedDay <= 3).map((d) => `${d.name} (${d.cause})`);
    if (gone.length) out.push(`The family has just buried ${this.listNames(gone)}.`);
    if (mother) {
      const n = this.childrenOf(mother).length;
      out.push(n <= 1 ? `This is ${mother.name}'s first child.` : `${mother.name} has ${n - 1} other ${n - 1 === 1 ? 'child' : 'children'} already.`);
    }
    return out.join(' ');
  }
  // Words that already describe two or more people here. A new person described with them would be nobody new.
  wornWords() {
    const stop = new Set('about their there which would could should while where often always never being thing things habit possesses possessing though every everything something anything nothing someone anyone wants loves still other others people village valley world place cannot leave alone makes wrong right years rarely instead saying really little quite almost first until after before again since having getting comes going taking gives holds keeps mostly words making hands whatever missing answer questions easily finds often sense expense names speak plain everything someone things thing people other'.split(' '));
    const count = {};
    for (const v of this.villagers) {
      const text = (v.nature ? Object.values(v.nature).join(' ') : v.personality || '').toLowerCase();
      for (const w of new Set(text.split(/[^a-z]+/).filter((x) => x.length > 4 && !stop.has(x)))) count[w] = (count[w] || 0) + 1;
    }
    return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w);
  }
  // What a person is like comes from what they were born with. The model is asked only to fill in the rest of them:
  // what makes them laugh, how they talk, what they cannot leave alone. kind: 'birth', 'child' or 'adult'.
  giveNature(v, kind) {
    if (v.natureAsked === this.day) return;
    v.natureAsked = this.day;
    if (!v.genes) v.genes = this.newGenes(...(v.parents || []).map((id) => this.byId(id)));
    if (!v.nature) v.nature = this.plainNature(v);
    const mother = this.byId((v.parents || [])[0]);
    this.brain.nature(v, kind, kind === 'birth' ? this.circumstances(mother) : '').then((r) => {
      if (!r || !this.villagers.includes(v)) return;
      const tidy = (t, n) => String(t || '').replace(/\s+/g, ' ').replace(/^["']|["'.]+$/g, '').trim().slice(0, n);
      const good = (t) => t.length >= 3;
      const humor = tidy(r.humor, 70), voice = tidy(r.voice, 70), drawn = tidy(r.drawn_to, 60);
      if (good(humor)) v.nature.humor = humor;
      if (good(voice)) v.nature.voice = voice;
      if (good(drawn)) v.nature.drawn = drawn;
      v.natureFull = true;
      if (kind === 'adult') {
        const text = String(r.personality || '').replace(/\s+/g, ' ').trim().slice(0, 320);
        if (text.length > 20) v.personality = text;
      }
      this.wantSave = true;
    });
  }
  // Anyone the model has not yet filled in is asked, one at a time, grown people first.
  catchUpNatures() {
    const v = this.villagers.filter((x) => !x.natureFull && x.natureAsked !== this.day).sort((a, b) => (a.stage === 'adult' ? 0 : 1) - (b.stage === 'adult' ? 0 : 1))[0];
    if (v) this.giveNature(v, v.stage === 'child' ? 'child' : 'adult');
  }
  natureLine(v) {
    const n = v.nature;
    if (!n) return '';
    return `By nature: ${n.temperament}. Fault: ${n.flaw}.${n.humor ? ` Laughs at: ${n.humor}.` : ''}${n.voice ? ` Talks: ${n.voice}.` : ''}${n.drawn ? ` Drawn to: ${n.drawn}.` : ''}`;
  }

  // A need is covered once three inventions already meet it: a fourth changes nothing in the world (see effectLevel).
  inventionsFor(effect) { return this.inventions.filter((i) => i.effect === effect); }
  covered(effect) { return effect !== 'none' && this.inventionsFor(effect).length >= 3; }
  coveredNeeds() { return Object.keys(EFFECTS).filter((e) => e !== 'none' && this.covered(e)).map((e) => ({ effect: e, need: NEED_WORDS[e], names: this.inventionsFor(e).map((i) => `the ${i.name}`) })); }
  aimOf(idea) { const t = String(idea || '').toLowerCase(); const hit = EFFECT_WORDS.find(([, re]) => re.test(t)); return hit ? hit[0] : null; }
  listNames(names) { return names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join(' and '); }

  // A building named in plain words ("the kiln", "clay kiln", "workshop") to its key, or null.
  structKeyFrom(text) {
    const t = String(text || '').toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
    if (!t || t === 'none') return null;
    if (STRUCT[t]) return t;
    const byName = Object.keys(STRUCT).find((k) => this.typeName(k).toLowerCase() === t);
    if (byName) return byName;
    return Object.keys(STRUCT).find((k) => STRUCT[k].custom && (t.includes(this.typeName(k).toLowerCase()) || this.typeName(k).toLowerCase().includes(t))) || null;
  }
  // The materials a thing is made of, kept to ones people here actually have a name for.
  usesFrom(spec) {
    const known = this.materialNames();
    const list = Array.isArray(spec.uses) ? spec.uses : typeof spec.uses === 'string' ? spec.uses.split(/,|\band\b/) : [];
    const out = [];
    for (const u of list) { const n = this.materialFrom(u) || (known.includes(String(u).toLowerCase().trim()) ? String(u).toLowerCase().trim() : null); if (n && !out.includes(n)) out.push(n); }
    return out.slice(0, 3);
  }
  tagsFrom(spec) {
    const list = Array.isArray(spec.tags) ? spec.tags : typeof spec.tags === 'string' ? spec.tags.split(/[,\s]+/) : [];
    return [...new Set(list.map((t) => String(t).toLowerCase().trim()).filter((t) => LANDMARKS.includes(t) && t !== 'other'))];
  }
  // Make an invention real: buildings join the list of things that can be built.
  // What a thing costs to build or make follows from what it is made of: the first material named is most of it.
  costOf(inv) {
    const uses = (inv.uses || []).filter((u) => u !== 'food').slice(0, 3);
    const big = inv.size === 'large';
    if (inv.kind === 'building') {
      if (!uses.length) return big ? { wood: 12, stone: 4 } : { wood: 6 };
      const cost = { [uses[0]]: big ? 8 : 5 };
      if (uses[1]) cost[uses[1]] = (cost[uses[1]] || 0) + (big ? 4 : 2);
      if (uses[2]) cost[uses[2]] = (cost[uses[2]] || 0) + 1;
      return cost;
    }
    if (!uses.length) return { [inv.material === 'stone' ? 'stone' : 'wood']: 3 };
    const cost = { [uses[0]]: 2 };
    if (uses[1]) cost[uses[1]] = (cost[uses[1]] || 0) + 1;
    return cost;
  }
  registerInvention(inv) {
    if (inv.kind !== 'building') return;
    const big = inv.size === 'large';
    STRUCT[inv.key] = { w: big ? 2 : 1, h: big ? 2 : 1, cost: this.costOf(inv), time: big ? 18 : 10, block: true, custom: true, name: inv.name, effect: inv.effect, desc: `${inv.what.replace(/\.$/, '')}. It ${EFFECTS[inv.effect]}`, look: { shape: inv.shape, material: inv.material, color: inv.color } };
    if (inv.effect === 'more_food') FOOD_SOURCES[inv.key] = { amount: 4, regrow: 0.6, what: `from the ${inv.name}` };
  }
  // A material people have learned to make. Inputs are what it is made from; "at" is the building it needs, if any.
  registerMaterial(inv) {
    if (!inv.makes) return null;
    const name = inv.makes;
    if (this.materialByName(name) || RAW[name]) return this.materialByName(name);
    const inputs = {};
    for (const u of (inv.uses || []).filter((u) => u !== 'food' && u !== name).slice(0, 3)) inputs[u] = Object.keys(inputs).length ? 1 : 2;
    if (!Object.keys(inputs).length) inputs[this.raws().includes('clay') ? 'clay' : 'stone'] = 2;
    const m = { id: inv.id, name, from: inputs, makes: 2, at: inv.at && STRUCT[inv.at] && this.structures.some((st) => st.type === inv.at) ? inv.at : null, tags: inv.tags || [], by: inv.by, byId: inv.byId, day: inv.day, what: inv.what, inv: inv.id };
    if (!this.materials) this.materials = [];
    this.materials.push(m);
    return m;
  }
  adults() { return this.villagers.filter((v) => v.stage === 'adult'); }
  childrenOf(v) { return this.villagers.filter((c) => c.parents.includes(v.id)); }
  settlement() {
    if (this.knows('community')) return 'Town';
    if (this.knows('craft')) return 'Village';
    if (this.knows('masonry') || this.knows('lighting')) return 'Hamlet';
    if (this.knows('farming') || this.knows('carpentry')) return 'Homestead';
    return 'The Beginning';
  }
  era() { return `${this.ageName()}. ${this.settlement()}`; }
  isNight() { return this.time >= 0.8 || this.time < 0.03; }
  dayFloat() { return this.day + this.time; }
  timeWord() {
    const t = this.time;
    if (t < 0.03) return 'the last of the night';
    if (t < 0.1) return 'dawn';
    if (t < 0.3) return 'morning';
    if (t < 0.5) return 'midday';
    if (t < 0.68) return 'afternoon';
    if (t < 0.8) return 'evening';
    return 'night';
  }
  ageWord(v) {
    const days = this.day - v.bornDay;
    if (v.stage === 'child') return this.years(v) < 6 ? 'a small child' : this.years(v) < 12 ? 'a growing child' : 'nearly grown';
    if (this.isOld(v)) return v.founder ? 'one of the first two people, now old and gray' : 'old and gray now, born in this place';
    return v.founder ? 'one of the first two people' : v.traveler ? 'a traveler who settled here' : 'grown, born in this place';
  }

  ancestors(v, out = new Set()) {
    for (const pid of v.parents) {
      if (out.has(pid)) continue;
      out.add(pid);
      const p = this.person(pid);
      if (p) this.ancestors(p, out);
    }
    return out;
  }
  related(a, b) {
    const aa = this.ancestors(a), bb = this.ancestors(b);
    if (aa.has(b.id) || bb.has(a.id)) return true;
    for (const x of aa) if (bb.has(x)) return true;
    return false;
  }
  // Every ancestor with how many generations up they are (1 = parent, 2 = grandparent...). The dead count too.
  lineage(v, depth = 1, out = new Map()) {
    for (const pid of v.parents) {
      if (out.has(pid) && out.get(pid) <= depth) continue;
      out.set(pid, depth);
      const p = this.person(pid);
      if (p && depth < 12) this.lineage(p, depth + 1, out);
    }
    return out;
  }
  // What o is to v, in family words. When kin have paired, more than one is true, so the closest wins.
  relation(v, o, blood = false) {
    const she = o.gender === 'f';
    if (!blood && v.partner === o.id) return 'partner';
    const up = this.lineage(v), down = this.lineage(o);
    const greats = (n) => 'great-'.repeat(Math.max(0, n - 2)) + (n >= 2 ? 'grand' : '');
    if (up.has(o.id)) return greats(up.get(o.id)) + (she ? 'mother' : 'father');
    if (down.has(v.id)) return greats(down.get(v.id)) + (she ? 'daughter' : 'son');
    // the nearest ancestor the two share: a steps above v, b steps above o
    let a = 0, b = 0;
    for (const [id, da] of up) {
      const db = down.get(id);
      if (!db) continue;
      if (!a || da + db < a + b || (da + db === a + b && Math.min(da, db) < Math.min(a, b))) { a = da; b = db; }
    }
    if (a === 1 && b === 1) return she ? 'sister' : 'brother';
    if (b === 1 && a >= 2) return 'great-'.repeat(a - 2) + (she ? 'aunt' : 'uncle');
    if (a === 1 && b >= 2) return 'great-'.repeat(b - 2) + (she ? 'niece' : 'nephew');
    if (a === 2 && b === 2) return 'cousin';
    // family by a partner rather than by blood
    const mate = v.partner ? this.byId(v.partner) : null, theirs = o.partner ? this.byId(o.partner) : null;
    const sib = (x, y) => x && y && x !== y && x.parents.length && x.parents.some((p) => y.parents.includes(p));
    if (!a && blood) return '';
    if (!a) {
      if (mate && mate.parents.includes(o.id)) return she ? 'mother-in-law' : 'father-in-law';
      if (theirs && theirs.parents.includes(v.id)) return she ? 'daughter-in-law' : 'son-in-law';
      if (sib(mate, o) || sib(v, theirs)) return she ? 'sister-in-law' : 'brother-in-law';
      if (theirs && v.parents.some((pid) => sib(this.person(pid), theirs))) return she ? 'aunt' : 'uncle'; // married in
      if (mate && o.parents.some((pid) => sib(this.person(pid), mate))) return she ? 'niece' : 'nephew';
      return 'neighbor';
    }
    return a + b <= 5 ? 'cousin' : 'distant cousin';
  }

  // ---------- grids and pathfinding ----------

  rebuildGrids() {
    this.blocked = new Uint8Array(W * H);
    this.structGrid = new Array(W * H).fill(null);
    for (const o of Object.values(this.objects)) this.blocked[idx(o.x, o.y)] = 1;
    for (const s of this.structures) {
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) {
          this.structGrid[idx(x, y)] = s;
          if (STRUCT[s.type].block) this.blocked[idx(x, y)] = 1;
        }
      }
    }
  }

  changed() { this.rebuildGrids(); this.worldVersion++; }

  // Is this tile within firelight or lantern light? Wolves will not step into it.
  lit(x, y) {
    for (const s of this.structures) {
      if (s.p < 1) continue;
      const r = s.type === 'campfire' ? 4.6 : s.type === 'lantern' ? 3.3 : STRUCT[s.type].effect === 'safety' ? 5 : 0;
      if (r && Math.hypot(s.x - x, s.y - y) <= r) return true;
    }
    return false;
  }

  walkable(x, y) {
    return inBounds(x, y) && this.ground[idx(x, y)] !== WATER && !this.blocked[idx(x, y)];
  }

  // Breadth-first search from a tile to the nearest tile that satisfies goal().
  // Returns the list of tiles to walk (not including the start), or null.
  bfs(sx, sy, goal, allow = null) {
    const start = idx(sx, sy);
    const prev = new Int32Array(W * H).fill(-2);
    prev[start] = -1;
    const q = [start];
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const x = cur % W, y = (cur / W) | 0;
      if (goal(x, y)) {
        const out = [];
        let c = cur;
        while (c !== start) { out.push([c % W, (c / W) | 0]); c = prev[c]; }
        return out.reverse();
      }
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (prev[ni] !== -2 || !this.walkable(nx, ny)) continue;
        if (allow && !allow(nx, ny)) continue;
        if (dx && dy && (!this.walkable(x + dx, y) || !this.walkable(x, y + dy))) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    return null;
  }

  tileOf(v) { return [Math.floor(v.x), Math.floor(v.y)]; }

  pathNear(v, tx, ty, range = 1) {
    const [sx, sy] = this.tileOf(v);
    return this.bfs(sx, sy, (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= range);
  }

  adjacentTiles(s) {
    const out = [];
    for (let x = s.x; x < s.x + s.w; x++) out.push([x, s.y + s.h]);
    for (let y = s.y; y < s.y + s.h; y++) { out.push([s.x - 1, y]); out.push([s.x + s.w, y]); }
    for (let x = s.x; x < s.x + s.w; x++) out.push([x, s.y - 1]);
    return out.filter(([x, y]) => inBounds(x, y));
  }

  pathToStruct(v, s) {
    const adj = new Set(this.adjacentTiles(s).map(([x, y]) => idx(x, y)));
    const [sx, sy] = this.tileOf(v);
    const inside = (x, y) => !STRUCT[s.type].block && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
    return this.bfs(sx, sy, (x, y) => adj.has(idx(x, y)) || inside(x, y));
  }

  // Step along the current path. Returns true on arrival, 'blocked' if something got in the way.
  moveAlong(v, dt, mult = 1) {
    if (!v.path || !v.path.length) return true;
    const [tx, ty] = v.path[0];
    if (!this.walkable(tx, ty)) return 'blocked';
    const cx = tx + 0.5, cy = ty + 0.5;
    const dx = cx - v.x, dy = cy - v.y;
    const d = Math.hypot(dx, dy);
    const [mx, my] = this.tileOf(v);
    const onPath = this.paths.has(idx(mx, my));
    const tired = v.stage === 'adult' && (v.needs.hunger < 10 || v.needs.energy < 10 || v.health < 35);
    const sp = (onPath ? 4 : 3) * (tired ? 0.6 : 1) * (v.stage === 'adult' && this.isOld(v) ? 0.75 : 1) * mult * dt;
    if (Math.abs(dx) > 0.05) v.dir = dx < 0 ? -1 : 1;
    if (d <= sp) { v.x = cx; v.y = cy; v.path.shift(); }
    else { v.x += (dx / d) * sp; v.y += (dy / d) * sp; }
    return v.path.length === 0;
  }

  // ---------- small helpers ----------

  remember(v, text) {
    // the same thing happening again is not a new memory
    if (v.memory.slice(-3).some((m) => m.text === text)) return;
    v.memory.push({ d: this.day, text });
    if (v.memory.length > 30) v.memory.shift();
    v.today.push(text);
    if (v.today.length > 16) v.today.shift();
  }

  addFeed(type, who, text, extra = {}) {
    const item = { id: Date.now() + Math.random(), day: this.day, time: this.time, type, who: who ? who.name : null, wid: who ? who.id : null, text, ...extra };
    this.feed.push(item);
    if (this.feed.length > 200) this.feed.shift();
    if (this.onFeed) this.onFeed('feed', item);
  }

  addChronicle(type, who, text) {
    const item = { day: this.day, type, who: who ? who.name : null, text };
    this.chronicle.push(item);
    // the turning of an age is never dropped from the record
    if (this.chronicle.length > 400) { const i = this.chronicle.findIndex((c) => c.type !== 'age'); if (i >= 0) this.chronicle.splice(i, 1); }
    if (this.onFeed) this.onFeed('chronicle', item);
  }

  // What they say is as long as they made it. A bubble stays up long enough to be read.
  say(v, text, max = 700, hold = false, talk = null) {
    const t = String(text || '').slice(0, max);
    // long enough to read, then gone; a line waiting on its answer stays a little longer, but not forever
    v.bubble = { text: t, until: Date.now() + (hold ? 30000 : Math.min(9000, 2500 + t.length * 30)) };
    // what they have said lately is shown to them next time, so they find new words instead of the same ones
    if (v.stage === 'adult' && t.length > 12) { if (!v.said) v.said = []; v.said.push(t.slice(0, 160)); if (v.said.length > 4) v.said.shift(); }
    this.addFeed('say', v, t, talk ? { talk: talk.id, to: talk.to, kind: talk.kind } : {});
  }

  changeAffinity(a, b, n) {
    // the closer two people already are, the less one more kindness adds; a slight always lands in full
    const eased = (cur) => (n > 0 ? n * (cur >= 85 ? 0.25 : cur >= 70 ? 0.5 : 1) : n);
    const ab = a.affinity[b.id] ?? this.baseAffinity(a, b), ba = b.affinity[a.id] ?? this.baseAffinity(b, a);
    a.affinity[b.id] = clamp(ab + eased(ab));
    b.affinity[a.id] = clamp(ba + eased(ba));
    this.maybePair(a, b);
  }
  // one person's feeling about another moving on its own
  shiftAffinity(a, b, n) {
    const cur = a.affinity[b.id] ?? this.baseAffinity(a, b);
    a.affinity[b.id] = clamp(cur + (n > 0 ? n * (cur >= 85 ? 0.25 : cur >= 70 ? 0.5 : 1) : n));
  }
  baseAffinity(a, b) { return this.related(a, b) ? 55 : 30; }
  getAffinity(a, b) { return a.affinity[b.id] ?? this.baseAffinity(a, b); }

  // 9 = parent and child (never), 2 = brother and sister, 1 = more distant kin, 0 = no shared blood
  kinship(a, b) {
    const aa = this.ancestors(a), bb = this.ancestors(b);
    if (aa.has(b.id) || bb.has(a.id)) return 9;
    if (a.parents.some((p) => b.parents.includes(p))) return 2;
    for (const x of aa) if (bb.has(x)) return 1;
    return 0;
  }

  // With everyone descended from the first two, kin must pair. They take the most distant match there is.
  canPair(a, b, evenIfAway = false) {
    if (a === b || a.stage !== 'adult' || b.stage !== 'adult' || a.partner || b.partner || a.gender === b.gender) return false;
    if (!evenIfAway && (a.away || b.away)) return false;
    const k = this.kinship(a, b);
    if (k >= 9) return false;
    if (this.cfg.travelers) return k === 0;
    // A more distant match only counts if the two can actually stand each other.
    const closerExists = (x, y) => this.adults().some((c) => c !== x && c !== y && !c.partner && !c.away && c.gender !== x.gender && this.kinship(x, c) < k
      && this.getAffinity(x, c) >= 35 && this.getAffinity(c, x) >= 35);
    return !closerExists(a, b) && !closerExists(b, a);
  }

  // Nobody is paired off by the game. A couple exists only because one of them asked and the other said yes.
  maybePair(a, b, agreed = false) {
    if (!agreed || !this.canPair(a, b)) return;
    a.affinity[b.id] = Math.max(this.getAffinity(a, b), 64);
    b.affinity[a.id] = Math.max(this.getAffinity(b, a), 64);
    a.partner = b.id;
    b.partner = a.id;
    if (!a.home && b.home) a.home = b.home;
    if (!b.home && a.home) b.home = a.home;
    // someone else may have hoped for one of them
    for (const c of this.adults()) {
      if (c === a || c === b || c.partner) continue;
      const chosen = c.gender !== a.gender ? a : b, rival = chosen === a ? b : a;
      if (this.kinship(c, chosen) >= 9 || this.getAffinity(c, chosen) < 58) continue;
      this.remember(c, `${chosen.name} chose ${rival.name} and not me.`);
      c.affinity[rival.id] = clamp(this.getAffinity(c, rival) - 14);
      this.wrong(c, rival, `took ${chosen.name}, who I wanted`, this.getAffinity(c, chosen) >= 70 ? 2 : 1);
    }
    // someone lately left for this
    for (const [x, y] of [[a, b], [b, a]]) {
      const ex = x.ex && this.day - x.ex.day <= 4 ? this.byId(x.ex.id) : null;
      if (ex && ex !== y && ex.ex && ex.ex.left) { this.wrong(ex, y, `took ${x.name} from me`, 2, 20); this.remember(ex, `${x.name} left me, and now shares a home with ${y.name}.`); }
    }
    this.remember(a, `${b.name} and I have decided to share our lives.`);
    this.remember(b, `${a.name} and I have decided to share our lives.`);
    this.worldVersion++;
    this.addFeed('event', null, `${a.name} and ${b.name} are now a couple.`);
    this.addChronicle('event', null, `${a.name} and ${b.name} joined their lives together.`);
  }

  // ---------- the main loop ----------

  tick(dtReal) {
    if (this.paused) return;
    const dt = dtReal * this.speed;
    const before = this.time;
    this.time += dt / this.cfg.dayLengthSec;
    this.clock += dt;
    if (this.clock - (this.natureAt || 0) > 40) { this.natureAt = this.clock; if (this.brain && this.brain.llm && this.brain.llm.online) this.catchUpNatures(); }
    if (before < DUSK && this.time >= DUSK) this.onDusk();
    if (before < 0.8 && this.time >= 0.8) this.onNight();
    if (this.time >= 1) { this.time -= 1; this.day++; this.onDawn(); }

    this.regrowTimer = (this.regrowTimer || 0) - dt;
    if (this.regrowTimer <= 0) { this.regrowTimer = 3; this.regrow(); this.weatherTick(); }

    for (const v of [...this.villagers]) this.updateVillager(v, dt);
    for (const a of [...this.animals]) this.updateAnimal(a, dt);
    if (this.animals.some((a) => a.gone)) this.animals = this.animals.filter((a) => !a.gone);
  }

  regrow() {
    const now = this.dayFloat();
    let dirty = false;
    const winter = this.isWinter();
    const parched = !!this.disaster && this.disaster.kind === 'drought';
    for (const o of Object.values(this.objects)) {
      if ((o.kind === 'bush' || o.kind === 'reeds') && !o.ripe && !winter && !(parched && o.kind === 'bush') && now >= o.regrowAt) { o.ripe = true; dirty = true; }
      if (o.kind === 'bush' && o.ripe && winter) { o.ripe = false; dirty = true; } // nothing fruits in the snow
    }
    for (const s of this.structures) {
      const src = FOOD_SOURCES[s.type];
      if (!src || s.p < 1 || s.ripe || now < s.regrowAt) continue;
      if (winter && s.type === 'farm') continue; // nothing grows in frozen ground
      if (parched && s.type === 'farm') { const wet = this.effectLevel('water'); if (!wet || now < s.regrowAt + (4 - wet) * 0.8) continue; } // or in dust, unless water is brought to it, and then slowly
      if (src.animal && !this.animals.some((a) => a.pen === s.id && !a.herd)) continue; // an empty coop lays no eggs
      s.ripe = true;
      dirty = true;
    }
    if (dirty) this.worldVersion++;
  }

  updateVillager(v, dt) {
    const perDay = dt / this.cfg.dayLengthSec;
    if (v.bubble && Date.now() > v.bubble.until) v.bubble = null;

    if (v.stage === 'child') return this.updateChild(v, dt);
    if (v.away) { if (this.dayFloat() >= v.away.until) this.comeBack(v); return; }

    const n = v.needs;
    const well = this.count('well') > 0, chapel = this.count('chapel') > 0;
    const winter = this.isWinter(), cold = winter ? 1.15 : 1;
    const sky = this.weatherNow(), out = !v.inside;
    // weather costs a body: heat, rain and wind wear on anyone out in them
    const toll = !out ? 1 : sky === 'storm' ? 1.3 : sky === 'blizzard' ? 1.6 : sky === 'hot' ? (well ? 1.15 : 1.35) : sky === 'rain' ? 1.1 : sky === 'bitter' ? 1.25 : 1;
    // standing in line to be heard is not living: a body does not run down at full speed while its mind is elsewhere
    const idle = (v.thinking && !v.plan) || (v.plan && v.plan.filler) ? 0.35 : 1;
    n.hunger = clamp(n.hunger - (v.sleeping ? 30 : 62) * perDay * cold * idle);
    const ease = this.effectLevel('comfort', v);
    if (v.sleeping) n.energy = clamp(n.energy + (v.inside ? 520 : 380) * perDay * (this.count('pen') > 0 ? 1.15 : 1) * (1 + 0.1 * ease));
    else n.energy = clamp(n.energy - 100 * perDay * (well ? 0.85 : 1) * cold * (v.sick ? 1.4 : 1) * toll * idle);
    // loners can go a long while without company; talkers cannot
    if (!v.sleeping) n.social = clamp(n.social - 55 * perDay * (chapel ? 0.6 : 1) * (1 - 0.15 * ease) * (1 - 0.1 * this.effectLevel('gathering', v)) * idle * [0.55, 0.8, 1, 1.15, 1.3][this.gene(v, 'social') + 2]);

    // The body keeps score. Starving, freezing and old age wear it down; food and rest mend it.
    let wear = 0, cause = v.lastHurt || 'wounds';
    if (n.hunger <= 0) { wear -= 60; cause = 'hunger'; }
    if (winter && v.sleeping && !v.inside && !this.lit(Math.floor(v.x), Math.floor(v.y))) { wear -= 30; if (n.hunger > 0) cause = 'the cold'; }
    const house = this.structById(v.home);
    const killing = sky === 'bitter' || sky === 'blizzard';
    if (winter && v.sleeping && v.inside && house && !house.warm && this.isNight()) { wear -= (killing ? 34 : 18) * (this.effectLevel('warmth', v) > 0 ? 0.5 : 1); if (n.hunger > 0) cause = 'the cold'; }
    // a blizzard kills anyone it catches in the open, awake or not
    if (sky === 'blizzard' && out && !this.lit(Math.floor(v.x), Math.floor(v.y))) { wear -= 55; if (n.hunger > 0) cause = 'the blizzard'; }
    const mend = this.effectLevel('health', v);
    if (v.sick) { wear -= (v.sick.deadly ? 54 : v.sick.slow ? 24 : v.sick.harsh ? 30 : 12) * (v.sleeping || v.sick.tended === this.day ? 0.5 : 1) * (1 - 0.25 * mend); if (n.hunger > 0) cause = v.sick.name; }
    if (this.age(v) >= v.lifespan) { wear -= 35; if (n.hunger > 0) cause = this.years(v) < 62 ? (v.endCause || (v.endCause = pick(['a weak heart', 'a sudden sickness', 'a sickness that would not lift']))) : 'old age'; }
    if (wear === 0 && n.hunger > 40 && n.energy > 20) wear = 25;
    v.health = clamp(v.health + wear * perDay);
    if (v.health >= 99) v.lastHurt = '';
    if (v.health <= 0) return this.die(v, cause);

    // nobody stands still with fire at their back
    if (this.fires && (!v.plan || v.plan.action !== 'flee') && this.fireNear(v, 2.6)) this.flee(v);

    if (Date.now() < v.holdUntil) return;
    if (v.plan) { this.thinkAhead(v); return this.runPlan(v, dt); }

    // The body does not wait to be asked. Eating when hungry and sleeping when it is dark and one is tired
    // are not decisions, and they happen even to someone lost in thought.
    const calm = !this.dangerOutside() && !this.wolves().length;
    const wake = () => { if (v.thinking) { v.thinking = false; v.path = []; } this.dropAsk(v); }; // whatever they were turning over can wait
    if (n.hunger < (calm ? 35 : 15) && (v.inv.food > 0 || this.stored('food') > 0) && this.startEat(v).ok) {
      v.thinking = false;
      if (n.hunger < 15) this.addFeed('thought', v, '', { act: 'is too hungry to think of anything but eating' });
      return;
    }
    // night is for sleeping: anyone not already rested goes to bed when it is dark, unless there is danger about
    if (n.energy >= 6 && (n.energy < 11 || (this.isNight() && n.energy < 85 && n.hunger > 20 && !this.nearestFire(v)))) {
      wake();
      if (n.energy < 18) this.addFeed('thought', v, '', { act: 'is too tired to go on, and heads for bed' });
      this.startSleep(v, false);
      return;
    }
    if (n.energy < 6) {
      wake();
      this.remember(v, 'I pushed too hard and collapsed where I stood.');
      this.addFeed('event', v, `${v.name} collapsed from exhaustion.`);
      v.thought = 'I cannot keep my eyes open.';
      this.startSleep(v, true);
      return;
    }
    if (v.thinking && !v.asking) return this.mull(v, dt); // waiting on words of their own: a quarrel, a proposal
    if (this.clock < v.nextThinkAt) return;
    // These are rolled once each time a person comes free, not every moment they stand waiting.
    if (!v.checked) {
      v.checked = true;
      // The morning's work, when the store is low, is not a decision either.
      if (this.chore(v)) return;
      // The one people look to has cases to hear: that is what the evening fire is for.
      if (this.leader === v.id && (v.cases || []).length && this.time >= 0.6 && this.gatherDay !== this.day && !this.isNight()) { const r = this.startCall(v, { target: 'a judgment' }); if (r.ok) { this.addFeed('thought', v, '', { act: r.summary }); return; } }
      // A temper breaks when it breaks.
      if (this.flare(v)) return;
      // The want of a mate is of the body too. Left unanswered, it stops waiting to be chosen.
      if (this.courting(v)) return;
      if (this.tryst(v)) return;
    }
    // What they settled on while their hands were busy, if the moment it was meant for has not gone by.
    if (v.next) {
      const nx = v.next;
      v.next = null;
      if (this.clock - nx.at <= 90 && nx.night === this.isNight() && !this.dangerOutside() && !this.wolves().length) return this.applyDecision(v, nx.d);
    }
    // Still making up their mind: nobody stands like a post while they do. They catch their breath, look over
    // what they made, stroll a little. The moment the answer comes, they get on with it.
    if (v.asking) {
      v.thinking = false;
      if (this.clock - v.nextThinkAt > 1.5 && this.breather(v)) return; // a moment's thought is just a moment's thought
      v.thinking = true;
      return this.mull(v, dt);
    }
    v.thinking = true;
    v.brood = '';
    this.brain.decide(v);
  }

  // ---------- thinking while working ----------

  // A person does not finish a job and then stand still to wonder what is next. They turn it over while their hands
  // are busy. The question goes to the model during the work, timed so the answer is ready about when the work is.
  thinkAhead(v) {
    const p = v.plan;
    if (p.at == null) p.at = this.clock;
    if (v.asking || v.next || p.asked || p.filler || !AHEAD.includes(p.action) || p.phase === 'converse' || v.sleeping) return;
    if (!this.brain || !this.brain.llm.online) return;
    if (this.clock - p.at < Math.max(0, (this.planAvg ?? 20) - (this.waitAvg || 0) - 2)) return;
    p.asked = true;
    this.brain.decide(v, true);
  }
  // whether this is a moment a person could sensibly be asked what they do next
  canDecide(v) {
    if (v.stage !== 'adult' || v.sleeping || v.away || Date.now() < v.holdUntil) return false;
    const p = v.plan;
    return !p || p.filler || (AHEAD.includes(p.action) && p.phase !== 'converse');
  }
  // The brain hands back a choice. If they are free it starts now; if their hands are still busy it waits for them.
  deliver(v, d) {
    v.asking = false;
    if (!this.villagers.includes(v) || v.stage !== 'adult' || v.away) return;
    if (v.plan && v.plan.filler) this.endPlan(v, 0); // they were only passing the time
    if (v.plan || v.sleeping || Date.now() < v.holdUntil) { v.next = { d, at: this.clock, night: this.isNight() }; return; }
    this.applyDecision(v, d);
  }
  // whatever they were turning over no longer fits the moment
  dropAsk(v) { v.askId = (v.askId || 0) + 1; v.asking = false; v.next = null; }
  // Something small to do with the minutes between one thing and the next.
  breather(v) {
    if (this.isNight() || this.dangerOutside() || this.wolves().length) return false;
    if (Math.random() < 0.4) {
      const r = this.startWander(v);
      if (r.ok && v.plan) { v.plan.filler = true; v.plan.timer = Math.min(v.plan.timer, 6); return true; }
    }
    const after = { build: ['looking over the work', 'brushing off the dust'], gather: ['stretching a sore back', 'catching a breath'], store: ['catching a breath'], fish: ['watching the water'], hunt: ['catching a breath', 'checking the spear'],
      make: ['turning it over in both hands'], invent: ['staring at nothing, thinking'], talk: ['thinking over what was said'], eat: ['sitting a moment longer'] }[v.lastAct] || [];
    v.plan = { action: 'pause', phase: 'rest', timer: 4 + Math.random() * 5, what: pick([...after, ...after, 'taking a breather', 'looking around', 'having a drink of water', 'sitting a moment']), filler: true };
    v.path = [];
    return true;
  }

  // Work keeps pace with the model. A person thinks about what is next while they work, so a job is made to last
  // about as long as an answer takes to come: quick answers, short jobs and many choices in a day; slow answers, a
  // whole morning of the same thing. waitAvg is how long, in seconds of this world, an answer has lately taken.
  noteWait(sec) { if (sec >= 0 && sec < 600) this.waitAvg = (this.waitAvg || 0) + (sec - (this.waitAvg || 0)) * 0.12; }
  stretch() { return Math.max(1, Math.min(6, (this.waitAvg || 0) / 10)); }
  // whether someone in the middle of a spell of work should carry on with it
  keepAt(v, p) {
    if (p.chore) return (p.round || 0) < 2;
    return v.asking && !v.next && (p.round || 0) < 9 && v.needs.hunger > 35 && v.needs.energy > 25 && !this.isNight() && !this.dangerOutside() && !this.wolves().length;
  }

  // Someone turning a thing over does not stand like a post. They pace, a few steps this way and that.
  mull(v, dt) {
    if (v.path.length) { if (this.moveAlong(v, dt, 0.45) === 'blocked') v.path = []; return; }
    if (Math.random() > dt * 0.25) return;
    const [x, y] = this.tileOf(v);
    const tx = x + Math.floor(Math.random() * 7) - 3, ty = y + Math.floor(Math.random() * 7) - 3;
    if (!inBounds(tx, ty) || !this.walkable(tx, ty)) return;
    const path = this.pathNear(v, tx, ty, 0);
    if (path && path.length && path.length <= 6) v.path = path;
  }

  // Who this person could ask today: free, awake, not someone who has just turned them down.
  suitable(v) {
    const now = this.day;
    return this.adults().filter((o) => this.canPair(v, o) && !o.sleeping && !o.away
      && !((v.refused || {})[o.id] > now - 8) && !((v.waitFor || {})[o.id] > now - 2));
  }
  // Like hunger, the drive to find a mate acts on its own once it has gone unanswered long enough. Who they ask and
  // what they say is still theirs, and so is the other person's answer.
  courting(v) {
    if (this.cfg.matingDrive === false || v.partner || v.sick || this.isOld(v)) return false;
    const alone = this.day - (v.singleSince ?? v.adultDay ?? this.day);
    if (alone < 1 || (v.askedDay || 0) >= this.day) return false;
    if (this.time < 0.12 || this.time > 0.7 || this.dangerOutside() || v.needs.hunger < 30 || v.needs.energy < 30) return false;
    if (Math.random() > 0.4) return false;
    const list = this.suitable(v);
    if (!list.length) return false;
    v.askedDay = this.day;
    this.dropAsk(v);
    v.thinking = true;
    v.brood = 'working up the nerve to ask someone';
    // with no word from the model, they go to whoever they feel most for, a pairing that could have children first
    const fruitful = (o) => (this.canBear(v.gender === 'f' ? v : o) ? 1 : 0);
    const best = list.slice().sort((a, b) => fruitful(b) - fruitful(a) || this.getAffinity(v, b) - this.getAffinity(v, a))[0];
    this.brain.court(v, list, alone).then((r) => {
      v.thinking = false;
      if (!this.villagers.includes(v) || v.plan || v.partner || v.away) return;
      const named = r && r.to ? this.byName(r.to) : null;
      const t = named && list.includes(named) && this.canPair(v, named) ? named : best;
      if (!t || !this.canPair(v, t)) return;
      const res = this.startChase(v, { to: t.name, say: (r && r.say) || '' }, 'propose');
      if (!res.ok) { v.nextThinkAt = this.clock + 1; return; }
      v.thought = (r && r.thought) || `I cannot go on alone. I am going to ask ${t.name}.`;
      this.addFeed('thought', v, v.thought, { act: res.summary });
    });
    return true;
  }

  // Called by the brain when a decision comes back.
  applyDecision(v, d) {
    v.thinking = false;
    if (!this.villagers.includes(v) || v.plan || v.stage !== 'adult') return;
    v.path = []; // done pacing
    if (d.action !== 'build' && d.action !== 'gather' && d.action !== 'make' && d.action !== 'store') v.goal = null; // they have moved on
    v.thought = d.thought || '';
    if (!v.thoughts) v.thoughts = [];
    if (v.thought) { v.thoughts.push(v.thought); if (v.thoughts.length > 4) v.thoughts.shift(); }
    const res = this.startPlan(v, d);
    if (res.ok) {
      v.failStreak = 0;
      v.lastFail = '';
      v.lastAct = d.action;
      const key = (t) => String(t).toLowerCase().replace(/[^a-z ]/g, '').slice(0, 34);
      const repeat = v.thought && v.thoughts.slice(0, -1).some((t) => key(t) === key(v.thought));
      this.addFeed('thought', v, repeat ? '' : v.thought, { act: res.summary });
    } else {
      // A plan that cannot work is not announced to the world. They are told why and think again.
      v.failStreak++;
      v.lastFail = `You just tried to ${res.want}, but ${res.why.replace(/\bI am\b/g, 'you are').replace(/\bI was\b/g, 'you were').replace(/\bmy\b/g, 'your').replace(/\bI\b/g, 'you').replace(/\bme\b/g, 'you').replace(/\bwe\b/g, 'you')}.`;
      v.nextThinkAt = this.clock + 0.5;
    }
  }

  endPlan(v, cooldown = 0.6) {
    const p = v.plan;
    if (p && p.objKey && this.objects[p.objKey] && this.objects[p.objKey].res === v.id) delete this.objects[p.objKey].res;
    if (p && p.farmId) { const f = this.structById(p.farmId); if (f && f.res === v.id) delete f.res; }
    if (p && p.prey) { const a = this.animals.find((x) => x.id === p.prey); if (a && a.hunter === v.id) a.hunter = null; }
    if (p && p.at != null && !p.filler && AHEAD.includes(p.action)) { const took = this.clock - p.at; if (took > 0 && took < 400) this.planAvg = (this.planAvg ?? 20) + (took - (this.planAvg ?? 20)) * 0.1; }
    if (!(p && p.filler)) v.checked = false;
    v.plan = null;
    v.path = [];
    v.nextThinkAt = this.clock + (p && p.filler ? -2 : cooldown); // one breather runs straight into the next
  }

  failPlan(v, why) {
    const p = v.plan;
    if (p && p.action === 'build' && p.sid) {
      const s = this.structById(p.sid);
      if (s && s.p < 1) {
        this.structures = this.structures.filter((x) => x !== s);
        for (const [k, nn] of Object.entries(STRUCT[s.type].cost)) this.give(v, k, nn);
        this.changed();
      }
    }
    if (why) this.remember(v, `I gave up on what I was doing because ${why}.`);
    this.endPlan(v, 1);
  }

  // ---------- callings ----------

  practice(v, key, weight = 1) {
    // work that is seen earns standing; work a person is called to feeds them in a way plain labor does not
    const own = v.craft === key ? 1.6 : 1;
    const [pride, purpose] = { invent: [0.5, 1.5], make: [0.2, 2], tell: [0.4, 1.5], roam: [0.4, 4], heal: [0.5, 1.5], build: [0.35, 0.8], hunt: [0.4, 0.4] }[key] || [0.03, 0.12];
    this.lift(v, pride * weight, purpose * weight * own);
    if (!['invent', 'make', 'tell', 'roam'].includes(key)) v.worked = this.day; // work the others can see and eat
    if (!v.skill) v.skill = {};
    v.skill[key] = (v.skill[key] || 0) + weight;
    const ranked = Object.entries(v.skill).sort((a, b) => b[1] - a[1]);
    const [top, n] = ranked[0];
    const second = ranked[1] ? ranked[1][1] : 0;
    if (n < 9 || n < second * 1.35 || v.calling === CALLINGS[top]) return;
    const had = v.calling;
    v.calling = CALLINGS[top];
    v.craft = top;
    this.remember(v, had ? `People used to call me ${had}. Now they call me ${v.calling}.` : `People here have started calling me ${v.calling}.`);
    this.addFeed('discovery', v, `${v.name} has become known as ${v.calling}.`);
    this.addChronicle('event', null, `${v.name} became known as ${v.calling}.`);
  }
  is(v, craft) { return v.craft === craft; }
  // maxPopulation 0 (or missing) means no limit: food, firewood and room to build are what hold a village back.
  popCap() { return this.cfg.maxPopulation > 0 ? this.cfg.maxPopulation : Infinity; }
  satWith(v, t) { return !!(t.sick && t.sick.by && t.sick.by[v.id] === this.day); }

  // ---------- death ----------

  die(v, cause, opts = {}) {
    if (!this.villagers.includes(v)) return;
    if (this.leader === v.id) { this.leader = null; for (const o of this.adults()) if (o !== v) this.remember(o, `${v.name}, who we all looked to, is gone. There is nobody to settle things now.`); }
    const age = this.age(v);
    const p = v.plan;
    if (p && p.action === 'build' && p.sid) this.structures = this.structures.filter((x) => !(x.id === p.sid && x.p < 1));
    this.endPlan(v);
    const kin = this.villagers.filter((o) => o !== v).map((o) => [o, this.relation(o, v), this.getAffinity(o, v)]);
    this.villagers = this.villagers.filter((x) => x !== v);
    const years = this.years(v);
    this.dead.push({ id: v.id, name: v.name, gender: v.gender, parents: v.parents, bornDay: v.bornDay, diedDay: this.day, cause, years, partner: v.partner || null, calling: v.calling || '', founder: !!v.founder });
    for (const a of this.animals) if (a.hunter === v.id) a.hunter = null;

    const him = v.gender === 'm' ? 'him' : 'her';
    const how = cause === 'childbirth' ? 'in childbirth' : `of ${cause}`;
    for (const [o, rel, aff] of kin) {
      if (o.partner === v.id) { o.partner = null; o.singleSince = this.day; }
      if (o.stage !== 'adult') continue;
      if (opts.noGrave) { this.remember(o, `${v.name} never came back from beyond the valley. There is not even a grave.`); o.needs.social = clamp(o.needs.social - 20); continue; }
      if (rel === 'neighbor' && aff < 55) { this.remember(o, `${v.name} died ${how}.`); continue; }
      const what = rel === 'neighbor' ? 'friend' : rel;
      this.remember(o, `${v.name}, my ${what}, died ${how}.`);
      o.needs.social = clamp(o.needs.social - 30);
      o.thoughts = [];
    }

    // what they made passes to the people they leave behind
    if ((v.items || []).length && !opts.noGrave) {
      const partner = kin.map((k) => k[0]).find((o) => o.stage === 'adult' && v.partner === o.id);
      const children = this.villagers.filter((o) => o.parents.includes(v.id) && o.stage === 'adult');
      const heirs = partner ? [partner] : children;
      v.items.forEach((it, i) => {
        const heir = heirs.length ? heirs[i % heirs.length] : null;
        if (!heir || heir.items.length >= 10) return;
        const kept = { name: it.name, day: it.day, from: it.from || v.name };
        heir.items.push(kept);
        this.remember(heir, `I have ${this.itemName(kept)} now. ${v.gender === 'm' ? 'He' : 'She'} made it.`);
      });
    }

    // whoever shared the home keeps it
    for (const st of this.structures) {
      if (st.owner !== v.id || !STRUCT[st.type].home) continue;
      const heir = this.villagers.find((o) => o.home === st.id && o.stage === 'adult') || this.villagers.find((o) => o.home === st.id);
      if (heir) st.owner = heir.id;
    }

    // a grave, near the chapel if there is one, otherwise near home
    const chapel = this.structures.find((st) => st.type === 'chapel' && st.p >= 1);
    const home = this.structById(v.home);
    const anchor = chapel ? [chapel.x, chapel.y + 2] : home ? [home.x + 2, home.y + 1] : this.tileOf(v);
    this.rebuildGrids();
    const site = opts.noGrave ? null : this.findSite('grave', anchor[0], anchor[1], v);
    if (site) this.structures.push({ id: this.nextId++, type: 'grave', x: site[0], y: site[1], w: 1, h: 1, p: 1, owner: null, label: `${v.name}, who lived ${years} year${years === 1 ? '' : 's'}`, day: this.day });

    const line = opts.line || `${v.name} died ${how}, ${v.stage === 'child' ? `only ${years} year${years === 1 ? '' : 's'} old` : `aged ${years}`}.`;
    this.addFeed('death', null, line);
    this.addChronicle('death', null, line);
    this.changed();

    if (!this.villagers.length) {
      this.ended = true;
      this.addFeed('death', null, 'The last of them is gone. The world is quiet now.');
      this.addChronicle('death', null, `The line that began with ${this.cfg.founders.map((f) => f.name).join(' and ')} ended in Year ${this.day}.`);
      this.wantSave = true;
    }
  }

  // ---------- starting plans ----------

  startPlan(v, d) {
    switch (d.action) {
      case 'gather': return this.startGather(v, d.target);
      case 'fish': return this.startFish(v);
      case 'hunt': return this.startHunt(v, d);
      case 'propose': return this.startChase(v, d, 'propose');
      case 'together': return this.startChase(v, { ...d, to: (this.byId(v.partner) || {}).name }, 'together');
      case 'tend': return this.startChase(v, d, 'tend');
      case 'shelter': return this.startShelter(v);
      case 'part': return this.partWays(v);
      case 'take': return this.startChase(v, d, 'take');
      case 'fight': return this.startChase(v, d, 'fight');
      case 'kill': return this.startChase(v, d, 'kill');
      case 'explore': return this.startExplore(v);
      case 'store': return this.startStore(v);
      case 'make': return this.startMake(v, d);
      case 'invent': return this.startInvent(v, d);
      case 'call': return this.startCall(v, d);
      case 'activity': return this.startActivity(v, d);
      case 'build': return d.idea && !STRUCT[d.target] ? this.startDesign(v, d) : this.startBuild(v, d);
      case 'eat': return this.startEat(v);
      case 'sleep': return this.startSleep(v, false);
      case 'talk': return this.startTalk(v, d);
      case 'give': return this.startGive(v, d);
      default: return this.startWander(v);
    }
  }

  startGather(v, res, note) {
    if (!this.gatherable(res)) res = 'wood';
    if (this.have(v, res) >= CARRY) {
      const st = this.startStore(v);
      if (st.ok) return { ok: true, summary: `has arms full of ${res}, so carries it to the storehouse` };
      return { ok: false, want: `gather ${res}`, why: `I cannot carry any more ${res}` };
    }
    const raw = RAW[res], kind = raw.from;
    const free = (o) => o && o.kind === kind && (!o.res || o.res === v.id) && (!raw.ore || o.ore === raw.ore) && (kind === 'rock' && !raw.ore ? !o.ore : true) && ((kind !== 'bush' && kind !== 'reeds') || o.ripe);
    const farmAt = (x, y) => {
      const s = inBounds(x, y) ? this.structGrid[idx(x, y)] : null;
      return s && FOOD_SOURCES[s.type] && s.p >= 1 && s.ripe && (!s.res || s.res === v.id) ? s : null;
    };
    const farmBeside = (x, y) => farmAt(x, y) || neighbors4(x, y).map(([ax, ay]) => farmAt(ax, ay)).find(Boolean) || null;
    const [sx, sy] = this.tileOf(v);
    const goal = (x, y) => {
      if (res === 'food' && farmBeside(x, y)) return true;
      return neighbors4(x, y).some(([nx, ny]) => free(this.objects[key(nx, ny)]));
    };
    const path = this.bfs(sx, sy, goal);
    if (!path) {
      if (res === 'food' && this.knows('fishing')) {
        const f = this.startFish(v);
        if (f.ok) return { ok: true, summary: 'finds nothing ripe to pick, so goes fishing instead' };
      }
      return { ok: false, want: `gather ${res}`, why: `I could not find any ${res === 'food' ? 'ripe food' : res} within reach${raw.ore ? ' (it comes from ' + raw.where + ')' : ''}` };
    }
    const [ex, ey] = path.length ? path[path.length - 1] : [sx, sy];
    const plan = { action: 'gather', res, phase: 'walk', timer: 7 };
    const farm = res === 'food' ? farmBeside(ex, ey) : null;
    if (farm) { plan.farmId = farm.id; farm.res = v.id; }
    else {
      const [ox, oy] = neighbors4(ex, ey).find(([nx, ny]) => free(this.objects[key(nx, ny)]));
      plan.objKey = key(ox, oy);
      this.objects[plan.objKey].res = v.id;
    }
    v.plan = plan;
    v.path = path;
    return { ok: true, summary: note || `goes to gather ${res}` };
  }

  startFish(v) {
    if (!this.knows('fishing')) return { ok: false, want: 'go fishing', why: 'nobody here has worked out how to fish yet' };
    if (v.inv.food >= CARRY) return { ok: false, want: 'go fishing', why: 'I cannot carry any more food' };
    if (this.disaster && this.disaster.kind === 'flood') return { ok: false, want: 'go fishing', why: 'the pond is a brown torrent and would take me with it' };
    const [sx, sy] = this.tileOf(v);
    const wet = (x, y) => neighbors4(x, y).find(([nx, ny]) => this.ground[idx(nx, ny)] === WATER);
    const path = this.bfs(sx, sy, (x, y) => !!wet(x, y));
    if (!path) return { ok: false, want: 'go fishing', why: 'I could not get to the water' };
    const [ex, ey] = path.length ? path[path.length - 1] : [sx, sy];
    const [wx, wy] = wet(ex, ey);
    v.plan = { action: 'fish', phase: 'walk', timer: 10, cast: [wx - ex, wy - ey] };
    v.path = path;
    return { ok: true, summary: 'heads to the water to fish' };
  }

  // How many of each thing a settlement this size can sensibly keep up.
  limitFor(type) {
    const pop = this.villagers.length;
    if (STRUCT[type].max) return STRUCT[type].max;
    // one of a thing somebody simply wanted is enough; a thing that does real work can be built twice in a big village
    if (STRUCT[type].custom) return STRUCT[type].effect === 'none' ? 1 : pop >= 12 ? 2 : 1;
    return { farm: Math.ceil(pop * 0.7) + 2, garden: pop + 2, bench: Math.ceil(pop / 2) + 1, lantern: pop + 2, statue: 1 + Math.floor(pop / 4), coop: 1 + Math.floor(pop / 6), pen: 1 + Math.floor(pop / 6) }[type] ?? Infinity;
  }

  // A reason this villager cannot start this build (materials aside), or null if they can.
  buildBlock(v, type) {
    if (!this.unlocked().includes(type)) return 'nobody here knows how to make one yet';
    if (this.structures.filter((s) => s.type === type).length >= this.limitFor(type)) return type === 'farm' ? 'we already have as many farms as we can tend' : 'we already have enough of those';
    if (type === 'path' && (this.pathFailDay === this.day || this.paths.size >= 20 + this.villagers.length * 6)) return 'every path worth laying is already laid';
    if (STRUCT[type].home) {
      const cur = this.structById(v.home);
      const mine = cur && (cur.owner === v.id || cur.owner === v.partner);
      if (mine && (cur.type === 'house' || type === 'shelter')) return `we already have a ${cur.type} of our own`;
      const partner = this.byId(v.partner);
      if (partner && this.structures.some((s) => STRUCT[s.type].home && s.p < 1 && s.owner === partner.id)) return `${partner.name} is already building us a home`;
    }
    return null;
  }

  startHunt(v, d) {
    if (!this.knows('hunting')) return { ok: false, want: 'go hunting', why: 'nobody here knows how to hunt yet' };
    if (v.inv.food >= CARRY && !this.storehouse()) return { ok: false, want: 'go hunting', why: 'I cannot carry any more food' };
    const m = /rabbit|deer|sheep|chicken|wolf/.exec(String(d.target || '').toLowerCase());
    const want = m ? m[0] : null;
    const prey = this.animals.filter((a) => !a.pen && !a.hunter && (want ? a.kind === want : a.kind !== 'wolf'))
      .sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y)).slice(0, 5);
    for (const a of prey) {
      const path = this.pathNear(v, Math.floor(a.x), Math.floor(a.y), 2);
      if (!path) continue;
      a.hunter = v.id;
      v.plan = { action: 'hunt', prey: a.id, kind: a.kind, phase: 'walk', chase: 0.6, timeout: 35 };
      v.path = path;
      return { ok: true, summary: `takes up a spear and goes after a ${a.kind}` };
    }
    const none = want && want !== 'wolf' && this.wildCount(want) === 0;
    return { ok: false, want: `hunt${want ? ' a ' + want : ''}`, why: none ? `there are no ${want === 'sheep' ? 'wild sheep' : want === 'deer' ? 'deer' : want + 's'} left in the valley` : `there was no ${want || 'game'} to be found` };
  }

  storehouse() { return this.structures.find((s) => s.type === 'storehouse' && s.p >= 1) || null; }
  stored(k) { return this.storehouse() ? this.store[k] || 0 : 0; }
  // a bigger village keeps a bigger store: room for two weeks of food, and never less than the first storehouse held
  storeCap() { return Math.max(400, Math.round(this.villagers.length * 1.8 * 14)); }

  // What this villager still lacks for a build, counting what is in the shared storehouse.
  missing(v, type) {
    const out = {};
    for (const [k, n] of Object.entries(STRUCT[type].cost)) if (this.have(v, k) + this.stored(k) < n) out[k] = n - this.have(v, k) - this.stored(k);
    return out;
  }

  canPay(v, cost) { return Object.entries(cost).every(([k, n]) => this.have(v, k) + this.stored(k) >= n); }
  pay(v, cost) {
    for (const [k, n] of Object.entries(cost)) {
      const mine = Math.min(this.have(v, k), n);
      v.inv[k] = this.have(v, k) - mine;
      if (n - mine > 0) this.store[k] = Math.max(0, (this.store[k] || 0) - (n - mine));
    }
  }

  // Working on an idea for something that does not exist yet. It takes a few tries over a few days.
  startInvent(v, d) {
    let idea = String(d.target || '').replace(/["\n]/g, '').replace(/[.!]+$/, '').trim().slice(0, 90);
    const hollow = (t) => /new kind of building|better way of doing something|born from what you|trying to work out|does not exist yet/i.test(t);
    if (hollow(idea)) idea = '';
    if (v.project && hollow(v.project.idea)) v.project = null;
    if (v.project && v.project.progress > 0) idea = v.project.idea; // finish what was started
    if (idea.length < 4) idea = v.project ? v.project.idea : '';
    if (idea.length < 4) return { ok: false, want: 'work on an idea', why: 'I had nothing clear in mind to work on' };
    if (v.inventDay === this.day) return { ok: false, want: 'work on my idea', why: 'I have turned it over enough for one day, and it needs sleeping on' };
    if (!v.project || v.project.progress === 0) v.project = { idea, progress: 0 };
    const shop = this.structures.find((st) => st.type === 'workshop' && st.p >= 1) || this.structById(v.home);
    const path = shop ? this.pathToStruct(v, shop) : [];
    v.plan = { action: 'invent', phase: 'walk', timer: 12 * Math.min(3, this.stretch()) };
    v.path = path || [];
    return { ok: true, summary: `works on an idea: ${v.project.idea}` };
  }

  // Someone wants a building this place has never had. They work out what it is, and then they build it.
  startDesign(v, d) {
    const idea = String(d.idea || '').replace(/["\n]/g, '').replace(/[.!]+$/, '').trim().slice(0, 70);
    if (idea.length < 4) return { ok: false, want: 'build something new', why: 'I had nothing clear in mind' };
    const plain = idea.toLowerCase().replace(/^(the|a|an)\s+/, '');
    const have = this.inventions.find((i) => i.kind === 'building' && (plain === i.name || plain.includes(i.name)));
    if (have) return this.startBuild(v, { ...d, target: have.key });
    const pending = this.inventions.find((i) => i.free && i.byId === v.id && !this.structures.some((st) => st.type === i.key));
    if (pending) return { ok: false, want: `work out how to build ${idea}`, why: `I have not built my ${pending.name} yet. One new thing at a time` };
    if (v.designDay === this.day) return { ok: false, want: `work out how to build ${idea}`, why: 'I have already dreamed up one new thing today, and the next needs sleeping on' };
    v.designDay = this.day;
    const p = { action: 'design', phase: 'work', timer: 14, idea, near: d.near, label: d.label, asked: Date.now() };
    v.plan = p;
    v.path = [];
    this.brain.buildingSpec(v, idea).then((spec) => { if (v.plan === p) p.spec = spec || false; });
    return { ok: true, summary: `works out how to build something new: ${idea}` };
  }

  finishDesign(v, p) {
    if (p.spec === undefined && Date.now() - p.asked < 90000) { p.timer = 2; return; } // still turning it over
    this.endPlan(v);
    const kind = this.addBuildingKind(v, p.spec, p.idea);
    if (!kind) return;
    const res = this.startBuild(v, { target: kind.key, near: p.near, label: p.label });
    if (res.ok) this.addFeed('thought', v, '', { act: res.summary });
    else if (res.why) v.lastFail = `You worked out how to build the ${kind.name || this.typeName(kind.key)}, but ${res.why.replace(/\bI\b/g, 'you').replace(/\bmy\b/g, 'your')}.`;
  }

  addBuildingKind(v, raw, idea) {
    const spec = raw && typeof raw === 'object' ? raw : {};
    const clean = (t) => String(t || '').toLowerCase().replace(/[^a-z' -]/g, '').replace(/^(the|a|an)\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 28);
    const name = clean(spec.name).length >= 3 ? clean(spec.name) : clean(idea);
    if (name.length < 3) return null;
    if (STRUCT[name]) return { key: name };
    const same = this.inventions.find((i) => i.kind === 'building' && i.name === name);
    if (same) return same;
    const effect = EFFECTS[spec.effect] ? spec.effect : 'none';
    const uses = this.usesFrom(spec);
    const inv = {
      id: this.nextId++, name, key: 'x_' + name.replace(/[^a-z]+/g, '_'), kind: 'building',
      what: String(spec.what || `${idea[0].toUpperCase()}${idea.slice(1)}.`).replace(/\s+/g, ' ').trim().slice(0, 200), effect,
      uses, tags: this.tagsFrom(spec),
      shape: SHAPES.includes(spec.shape) ? spec.shape : 'hut', material: this.lookOf(uses[0] || spec.material),
      color: COLORS.includes(spec.color) ? spec.color : 'brown', size: spec.size === 'large' ? 'large' : 'small',
      by: v.name, byId: v.id, day: this.day, idea, free: true,
    };
    if (STRUCT[inv.key]) return { key: inv.key };
    this.inventions.push(inv);
    this.registerInvention(inv);
    this.checkAge(v);
    for (const o of this.adults()) this.remember(o, o === v ? `I worked out how to build something this place has never had: the ${inv.name}. ${inv.what}` : `${v.name} thought up something new to build: the ${inv.name}. ${inv.what}`);
    this.addFeed('discovery', v, `${v.name} thought up the ${inv.name}. ${inv.what} It ${EFFECTS[inv.effect]}. Anyone can build one now.`);
    this.addChronicle('discovery', null, `${v.name} thought up the ${inv.name}: ${inv.what}`);
    this.practice(v, 'invent', 3);
    this.changed();
    this.wantSave = true;
    return inv;
  }

  addInvention(v, raw, idea) {
    const used = new Set(this.inventions.map((i) => i.name));
    let spec = raw && typeof raw === 'object' ? raw : null;
    let name = spec ? String(spec.name || '').toLowerCase().replace(/[^a-z' -]/g, '').replace(/^(the|a|an)\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 28) : '';
    if (!spec || name.length < 3 || used.has(name) || STRUCT[name]) {
      const aimed = this.aimOf(idea);
      spec = FALLBACK_INVENTIONS.find((f) => !used.has(f.name) && f.effect === aimed && !this.covered(f.effect)) || FALLBACK_INVENTIONS.find((f) => !used.has(f.name) && !this.covered(f.effect)) || FALLBACK_INVENTIONS.find((f) => !used.has(f.name)) || { name: `${idea.split(' ').slice(-2).join(' ')}`.toLowerCase().replace(/[^a-z ]/g, '').trim() || 'new way', kind: 'knowhow', what: `A way of ${idea}.`, effect: 'comfort' };
      name = spec.name;
      if (used.has(name)) return null;
    }
    // Anything is allowed. "none" is a real answer: a thing can exist for its own sake. Only a word that is not an
    // effect at all gets read as that.
    const effect = EFFECTS[spec.effect] ? spec.effect : 'none';
    const uses = this.usesFrom(spec);
    let kind = ['building', 'tool', 'knowhow', 'material'].includes(spec.kind) ? spec.kind : 'knowhow';
    let makes = kind === 'material' ? String(spec.makes || name).toLowerCase().replace(/[^a-z' -]/g, '').replace(/^(the|a|an|some)\s+/, '').trim().slice(0, 24) : '';
    if (kind === 'material' && (makes.length < 2 || RAW[makes] || this.materialByName(makes))) makes = name;
    if (kind === 'material' && (RAW[makes] || this.materialByName(makes))) return null; // they already have that
    // a material has to be made out of something people here have; with nothing named, it is only a way of doing things
    if (kind === 'material' && !uses.filter((u) => u !== 'food' && u !== makes).length) { kind = 'knowhow'; makes = ''; }
    const inv = {
      id: this.nextId++, name, key: 'x_' + name.replace(/[^a-z]+/g, '_'),
      kind,
      what: String(spec.what || `A way of ${idea}.`).replace(/\s+/g, ' ').trim().slice(0, 200),
      effect, uses, tags: this.tagsFrom(spec), makes,
      at: this.structKeyFrom(spec.at),
      shape: SHAPES.includes(spec.shape) ? spec.shape : 'hut',
      material: this.lookOf(uses[0] || spec.material),
      color: COLORS.includes(spec.color) ? spec.color : 'brown',
      size: spec.size === 'large' ? 'large' : 'small',
      by: v.name, byId: v.id, day: this.day, idea,
    };
    this.inventions.push(inv);
    this.registerInvention(inv);
    const mat = this.registerMaterial(inv);
    if (inv.kind === 'tool') { if (!v.items) v.items = []; v.items.push({ name: `a ${inv.name}`, day: this.day, from: null, inv: inv.id }); } // the first one is the one they made working it out
    if (inv.kind === 'knowhow' && inv.effect === 'more_food') this.stats.farmBonus = Math.min(3, (this.stats.farmBonus || 0) + 1);
    if (mat) this.give(v, mat.name, mat.makes); // the first batch, from the working out
    const recipe = mat ? ` It is made from ${costText(mat.from)}${mat.at ? `, at the ${this.typeName(mat.at)}` : ''}.` : '';
    const use = inv.kind === 'building' ? 'Anyone can build one now.' : inv.kind === 'tool' ? 'Anyone can make one for themselves now.' : inv.kind === 'material' ? `Anyone can make ${mat ? mat.name : 'it'} now.` : 'Everyone does it this way now.';
    const did = inv.kind === 'material' ? `worked out how to make ${mat ? mat.name : inv.name}` : `invented the ${inv.name}`;
    for (const o of this.adults()) this.remember(o, o === v ? `I did it. I ${did}. ${inv.what}${recipe}` : `${v.name} ${did}. ${inv.what}${recipe}`);
    this.addFeed('discovery', v, `${v.name} ${did}. ${inv.what}${recipe}${inv.effect !== 'none' ? ` It ${EFFECTS[inv.effect]}.` : ''} ${use}`);
    this.addChronicle('discovery', null, `${v.name} ${did}: ${inv.what}`);
    this.checkAge(v);
    this.practice(v, 'invent', 6);
    this.changed();
    this.wantSave = true;
    return inv;
  }

  // Calling everyone to the fire in the evening, to share a story, a prayer, a song, or news.
  startCall(v, d) {
    const fire = this.structures.find((s) => s.type === 'campfire' && s.p >= 1);
    if (!fire) return { ok: false, want: 'call everyone together', why: 'there is no fire to gather around' };
    if (this.gatherDay === this.day) return { ok: false, want: 'call everyone to the fire', why: 'we have already gathered today' };
    if (this.time < 0.6 && !this.isNight()) return { ok: false, want: 'call everyone to the fire', why: 'that is for the evening, when the work is done' };
    if (this.here().filter((o) => o !== v && !o.sleeping).length < 2) return { ok: false, want: 'call everyone to the fire', why: 'there is hardly anyone awake to call' };
    const path = this.pathToStruct(v, fire);
    if (!path) return { ok: false, want: 'call everyone to the fire', why: 'I could not get to the fire' };
    let kind = String(d.target || '').replace(/["\n]/g, '').replace(/[.!]+$/, '').trim().toLowerCase().slice(0, 40);
    if (kind.length < 3) kind = 'a story';
    if (!/^(a|an|the|some|my|news|word)\b/.test(kind)) kind = (/^[aeiou]/.test(kind) ? 'an ' : 'a ') + kind;
    v.plan = { action: 'call', kind, phase: 'walk', timer: 1 };
    v.path = path;
    return { ok: true, summary: `calls everyone to the fire for ${kind}` };
  }

  beginGathering(v, p) {
    const fire = this.structures.find((s) => s.type === 'campfire' && s.p >= 1);
    if (!fire) return this.endPlan(v);
    this.gatherDay = this.day;
    const guests = [];
    // everyone gets their own spot in a ring around the fire
    const seats = [];
    for (let y = fire.y - 2; y <= fire.y + 2; y++) for (let x = fire.x - 2; x <= fire.x + 2; x++) {
      if ((x === fire.x && y === fire.y) || !this.walkable(x, y)) continue;
      if (Math.floor(v.x) === x && Math.floor(v.y) === y) continue;
      seats.push([x, y]);
    }
    seats.sort(() => Math.random() - 0.5);
    for (const o of this.here()) {
      if (o === v || o.sleeping || this.inConversation(o)) continue;
      if (o.stage === 'adult' && this.getAffinity(o, v) < 25) { this.remember(o, `${v.name} called everyone to the fire. I did not go.`); continue; }
      const seat = seats.pop();
      const [ox, oy] = this.tileOf(o);
      const path = seat ? this.bfs(ox, oy, (x, y) => x === seat[0] && y === seat[1]) : this.pathToStruct(o, fire);
      if (!path || path.length > 50) continue;
      if (o.stage === 'child') { o.path = path; o.goSleep = false; o.doing = 'at the fire, listening'; o.withUntil = this.clock + 70; o.idle = 60; }
      else {
        if (o.plan && ['sleep', 'explore', 'converse'].includes(o.plan.action)) continue;
        if (o.plan) this.endPlan(o);
        o.plan = { action: 'attend', host: v.id, phase: 'walk', timer: 170 };
        o.path = path;
      }
      guests.push(o);
    }
    if (!guests.length) return this.failPlan(v, 'nobody came');
    this.addFeed('event', v, `${v.name} called everyone to the fire.`);
    p.phase = 'converse';
    p.waiting = true;
    p.deadline = Date.now() + 420000;

    const done = (text) => {
      if (v.plan !== p) return;
      for (const o of guests) {
        if (!this.villagers.includes(o)) continue;
        if (Math.hypot(o.x - v.x, o.y - v.y) < 9) {
          o.needs.social = clamp(o.needs.social + (this.is(v, 'tell') ? 42 : 30));
          o.affinity[v.id] = clamp(this.getAffinity(o, v) + 4);
          if (o.stage === 'adult') this.remember(o, `At the fire, ${v.name} shared ${p.kind}: "${text.slice(0, 160)}"`);
          else { if (!o.lessons) o.lessons = []; o.lessons.push(`heard ${v.name} share ${p.kind} at the fire`); if (o.lessons.length > 8) o.lessons.shift(); }
        }
        if (o.plan && o.plan.action === 'attend' && o.plan.host === v.id) this.endPlan(o);
      }
      v.needs.social = clamp(v.needs.social + 35);
      this.remember(v, `I called everyone to the fire and shared ${p.kind}.`);
      this.practice(v, 'tell', 4);
      this.acclaim(guests);
      p.waiting = false;
      p.timer = 4;
    };

    // give people a moment to walk over, then speak
    setTimeout(() => {
      if (v.plan !== p) return;
      // a judgment is its own kind of evening: the one people look to hears the cases, and that is the gathering
      if (p.kind === 'a judgment' && this.leader === v.id && (v.cases || []).length) {
        p.talk = this.nextTalk = (this.nextTalk || 0) + 1;
        this.addChronicle('fire', v, `${v.name} called everyone to the fire to judge what had been done.`);
        return this.judgments(v, p, guests).then(() => { if (v.plan === p) done('a judgment'); });
      }
      this.brain.address(v, p.kind, guests).then(async (r) => {
        if (v.plan !== p) return;
        const text = String((r && r.say) || 'We are still here. That is worth saying out loud.').slice(0, 700);
        this.say(v, text, 700, false, { id: p.talk = this.nextTalk = (this.nextTalk || 0) + 1, to: 'everyone', kind: 'fire' });
        this.chronicle.push({ day: this.day, type: 'fire', who: v.name, text, kind: p.kind });
        if (this.onFeed) this.onFeed('chronicle', { day: this.day, type: 'fire', who: v.name, text, kind: p.kind });
        // a rule or a belief said out loud is put to everyone there
        const rule = r && String(r.rule || '').trim(), belief = r && String(r.belief || '').trim();
        if (rule && rule.length >= 8 && !/^(none|no|nothing|-)\.?$/i.test(rule)) { await new Promise((res) => setTimeout(res, 4000)); if (v.plan !== p) return; await this.propose(v, rule, 'rule', r.about, guests); if (v.plan !== p) return; }
        else if (belief && belief.length >= 8 && !/^(none|no|nothing|-)\.?$/i.test(belief)) { await new Promise((res) => setTimeout(res, 4000)); if (v.plan !== p) return; await this.propose(v, belief, 'belief', 'belief', guests); if (v.plan !== p) return; }
        const voice = guests.filter((o) => o.stage === 'adult' && this.villagers.includes(o) && Math.hypot(o.x - v.x, o.y - v.y) < 9);
        if (!voice.length) return setTimeout(() => done(text), 6000);
        const one = pick(voice);
        setTimeout(() => {
          if (v.plan !== p) return;
          this.brain.reply(one, v, [{ who: v.name, text }], true, `${p.kind} ${v.name} just shared with everyone at the fire`).then((r2) => {
            if (v.plan !== p) return;
            if (r2 && r2.say) this.say(one, r2.say, 700, false, { id: p.talk, to: v.name, kind: 'fire' });
            setTimeout(() => done(text), 5000);
          });
        }, 7000);
      });
    }, 8000);
  }

  // A thing of their own invention, to keep. The world only charges for the material.
  itemName(it) { return it.from ? `${it.from}'s ${it.name.replace(/^(a|an|the|my|some)\s+/i, '')}` : it.name; }

  startMake(v, d) {
    let what = String(d.target || '').replace(/["\n]/g, '').replace(/[.!]+$/, '').trim().slice(0, 50);
    if (what.length < 3) return { ok: false, want: 'make something', why: 'I was not sure what' };
    what = what[0].toLowerCase() + what.slice(1);
    // Making a material people have learned to make: copper from green ore at the furnace, bricks from clay, rope from reeds.
    const mat = this.materialByName(what.replace(/^(a|an|the|some|my)\s+/i, '')) || this.materialByName(this.materialFrom(what) || '');
    if (mat && !RAW[mat.name]) {
      if (!this.canPay(v, mat.from)) return { ok: false, want: `make ${mat.name}`, why: `I would need ${costText(mat.from)} for it` };
      if (this.have(v, mat.name) >= CARRY - 1) return { ok: false, want: `make ${mat.name}`, why: `I cannot carry any more ${mat.name}` };
      let path = [];
      if (mat.at) {
        const at = this.structures.find((st) => st.type === mat.at && st.p >= 1);
        if (!at) return { ok: false, want: `make ${mat.name}`, why: `it needs a ${this.typeName(mat.at)}, and there is none built` };
        path = this.pathToStruct(v, at);
        if (!path) return { ok: false, want: `make ${mat.name}`, why: `I could not get to the ${this.typeName(mat.at)}` };
      }
      this.pay(v, mat.from);
      v.plan = { action: 'make', material: mat.name, what: `${mat.makes} ${mat.name}`, phase: path.length ? 'walk' : 'work', timer: 9 * Math.min(3, this.stretch()) };
      v.path = path;
      return { ok: true, summary: `sets about making ${mat.name}${mat.at ? ` at the ${this.typeName(mat.at)}` : ''}` };
    }
    if (!/^(a|an|the|some|my)\s/i.test(what)) what = (/^[aeiou]/i.test(what) ? 'an ' : 'a ') + what;
    // a thing people have invented is made of what the inventor made it of; anything else is wood, or stone if it sounds like it
    const known = this.inventions.find((i) => i.kind === 'tool' && what.toLowerCase().includes(i.name));
    const named = this.materialFrom(what);
    const cost = known ? this.costOf(known) : named && named !== 'food' ? { [named]: 3 } : { [/stone|flint|rock|slate/.test(what) ? 'stone' : 'wood']: 3 };
    if (!this.canPay(v, cost)) return { ok: false, want: `make ${what}`, why: `I would need ${costText(cost)} for it` };
    const bare = (t) => String(t).toLowerCase().replace(/^(a|an|the|some|my)\s+/, '').replace(/\b(simple|new|sharp|sturdy|small|little|good|proper|warm)\b/g, '').replace(/\s+/g, ' ').trim();
    if ((v.items || []).some((it) => bare(it.name) === bare(what))) return { ok: false, want: `make ${what}`, why: 'I already have one, and one is enough' };
    if (v.madeDay === this.day) return { ok: false, want: `make ${what}`, why: 'I have already made something today, and my hands need a rest from it' };
    if ((v.items || []).length >= 8) return { ok: false, want: `make ${what}`, why: 'I already have more things than I can keep track of' };
    this.pay(v, cost);
    v.plan = { action: 'make', what, phase: 'work', timer: 10 * Math.min(3, this.stretch()) };
    v.path = [];
    return { ok: true, summary: `sits down to make ${what}` };
  }

  // how much of a thing a person keeps on them when they empty their arms into the store
  keepBack(k) { return k === 'food' ? 4 : k === 'wood' || k === 'stone' ? 2 : 0; }
  startStore(v) {
    const s = this.storehouse();
    if (!s) return { ok: false, want: 'store my things', why: 'there is no storehouse yet' };
    const room = (k, keep) => Math.max(0, Math.min(this.have(v, k) - keep, this.storeCap() - (this.store[k] || 0)));
    const total = Object.keys(v.inv).reduce((n, k) => n + room(k, this.keepBack(k)), 0);
    if (total < 1) return { ok: false, want: 'store my things', why: Object.values(v.inv).reduce((a, b) => a + b, 0) > 10 ? 'the storehouse has no room for what I carry' : 'I am not carrying enough to bother' };
    const path = this.pathToStruct(v, s);
    if (!path) return { ok: false, want: 'store my things', why: 'I could not reach the storehouse' };
    v.plan = { action: 'store', phase: 'walk', timer: 3 };
    v.path = path;
    return { ok: true, summary: 'carries a load to the storehouse' };
  }

  // Anything a person might do with their time. The villager makes it up; the world just gives them room to do it.
  startActivity(v, d) {
    let what = String(d.target || '').replace(/["\n]/g, '').replace(/^(i am|i'm|to)\s+/i, '').replace(/[.!]+$/, '').trim().slice(0, 70);
    if (what.length < 3) what = 'resting a while';
    what = what[0].toLowerCase() + what.slice(1);
    const sig = what.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((w) => w.length > 3).slice(0, 3).join(' ');
    if (!v.doneToday || v.doneDay !== this.day) { v.doneToday = []; v.doneDay = this.day; }
    if (v.doneToday.includes(sig)) return { ok: false, want: `spend time ${what}`, why: 'I have already done that today, and doing it again changes nothing' };
    v.doneToday.push(sig);
    const [ax, ay] = this.anchorFor(v, d.near || 'here');
    const path = this.pathNear(v, ax, ay, 2) || [];
    const timer = (9 + Math.random() * 6) * this.stretch();

    // Company: whoever they asked along, or whoever the plan itself names.
    const named = (o) => new RegExp(`\\b${o.name}\\b`, 'i').test(what);
    let buddy = d.to ? this.byName(d.to) : null;
    if (!buddy || buddy === v) buddy = this.here().find((o) => o !== v && named(o)) || null;
    let joined = false;
    if (buddy && buddy !== v && !buddy.away && !buddy.sleeping && !this.inConversation(buddy)) {
      const free = buddy.stage === 'child' || !buddy.plan || ['gather', 'wander', 'activity', 'store', 'fish', 'pause'].includes(buddy.plan.action);
      const willing = buddy.stage === 'child' || this.getAffinity(buddy, v) >= 35;
      if (!willing) {
        this.remember(v, `I asked ${buddy.name} to join me, and ${buddy.gender === 'm' ? 'he' : 'she'} would not.`);
        this.remember(buddy, `${v.name} asked me along, and I said no.`);
      } else if (free) {
        joined = true;
        const theirs = this.pathNear(buddy, ax, ay, 2) || [];
        if (buddy.stage === 'child') {
          buddy.path = theirs.length < 40 ? theirs : [];
          buddy.goSleep = false;
          buddy.doing = `with ${v.name}, ${what}`.slice(0, 70);
          buddy.withUntil = this.clock + timer + 12;
          buddy.idle = timer + 8;
        } else {
          if (buddy.plan) this.endPlan(buddy);
          buddy.plan = { action: 'activity', what: named(buddy) ? `with ${v.name}, ${what}` : `${what}, with ${v.name}`, guest: v.id, phase: 'walk', timer: timer + 4 };
          buddy.path = theirs.length < 40 ? theirs : [];
        }
      }
    }
    v.plan = { action: 'activity', what, with: joined ? buddy.id : null, phase: 'walk', timer };
    v.path = path.length < 40 ? path : [];
    return { ok: true, summary: `${/^\w+ing\b/.test(what) ? 'spends a while' : 'takes some time for'} ${what}${joined && !named(buddy) ? `, with ${buddy.name}` : ''}` };
  }

  anchorFor(v, near) {
    const n = String(near || 'here').toLowerCase();
    const fire = this.structures.find((s) => s.type === 'campfire');
    const center = fire ? [fire.x, fire.y] : [this.spawn.x, this.spawn.y];
    if (n.includes('home')) {
      const h = this.structById(v.home);
      return h ? [h.x, h.y] : center;
    }
    if (n.includes('fire') || n.includes('center') || n.includes('camp')) return center;
    if (n.includes('pond') || n.includes('water') || n.includes('lake') || n.includes('river')) return this.nearestGround(v, WATER) || center;
    if (n.includes('forest') || n.includes('tree') || n.includes('wood')) return this.nearestObject(v, 'tree') || center;
    const other = this.byName(n);
    if (other && other !== v) {
      const h = this.structById(other.home);
      return h ? [h.x, h.y] : this.tileOf(other);
    }
    return this.tileOf(v);
  }

  nearestGround(v, type) {
    let best = null, bd = 1e9;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (this.ground[idx(x, y)] !== type) continue;
      const d = Math.hypot(x - v.x, y - v.y);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best;
  }
  nearestObject(v, kind) {
    let best = null, bd = 1e9;
    for (const o of Object.values(this.objects)) {
      if (o.kind !== kind) continue;
      const d = Math.hypot(o.x - v.x, o.y - v.y);
      if (d < bd) { bd = d; best = [o.x, o.y]; }
    }
    return best;
  }

  // Every tile this villager can walk to from where they stand.
  flood(v) {
    const [sx, sy] = this.tileOf(v);
    const seen = new Uint8Array(W * H);
    seen[idx(sx, sy)] = 1;
    const q = [[sx, sy]];
    let head = 0;
    while (head < q.length) {
      const [x, y] = q[head++];
      for (const [nx, ny] of neighbors4(x, y)) {
        if (seen[idx(nx, ny)] || !this.walkable(nx, ny)) continue;
        seen[idx(nx, ny)] = 1;
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  findSite(type, ax, ay, v) {
    const def = STRUCT[type];
    const reach = this.flood(v);
    const occupied = new Set(this.villagers.map((o) => idx(Math.floor(o.x), Math.floor(o.y))));
    const free = (x, y) => inBounds(x, y) && this.ground[idx(x, y)] !== WATER && !this.objects[key(x, y)] && !this.structGrid[idx(x, y)] && !this.paths.has(idx(x, y));
    const clearOfBlockers = (x, y) => {
      if (!inBounds(x, y)) return true;
      const s = this.structGrid[idx(x, y)];
      return !(s && STRUCT[s.type].block);
    };
    const cands = [];
    for (let y = 1; y < H - def.h; y++) {
      for (let x = 1; x < W - def.w; x++) {
        const d = Math.hypot(x + def.w / 2 - (ax + 0.5), y + def.h / 2 - (ay + 0.5));
        if (d < 1.2) continue;
        cands.push([d + Math.random() * 1.5, x, y]);
      }
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [, x, y] of cands) {
      let ok = true;
      for (let yy = y; yy < y + def.h && ok; yy++) for (let xx = x; xx < x + def.w && ok; xx++) if (!free(xx, yy)) ok = false;
      if (ok && def.block) {
        for (let yy = y - 1; yy <= y + def.h && ok; yy++) for (let xx = x - 1; xx <= x + def.w && ok; xx++) if (!clearOfBlockers(xx, yy)) ok = false;
        for (let yy = y; yy < y + def.h && ok; yy++) for (let xx = x; xx < x + def.w && ok; xx++) if (occupied.has(idx(xx, yy))) ok = false;
      }
      if (ok) {
        const around = this.adjacentTiles({ x, y, w: def.w, h: def.h });
        ok = around.some(([xx, yy]) => reach[idx(xx, yy)]);
      }
      if (ok) return [x, y];
    }
    return null;
  }

  // Someone who went for materials with a building in mind comes back to the building.
  pursueGoal(v) {
    const g = v.goal;
    if (!g) return false;
    if (this.day > g.until || !STRUCT[g.type] || this.buildBlock(v, g.type)) { v.goal = null; return false; }
    const miss = this.missing(v, g.type);
    if (Object.keys(miss).length) {
      const res = Object.keys(miss).sort((x, y) => miss[y] - miss[x])[0];
      if (this.gatherable(res) && this.have(v, res) < CARRY) { const r = this.startGather(v, res, `still needs ${miss[res]} more ${res} for the ${this.typeName(g.type)}, goes for more`); if (r.ok) { this.dropAsk(v); return true; } }
      else if (this.materialByName(res)) { const r = this.startMake(v, { target: res }); if (r.ok) { this.dropAsk(v); this.addFeed('thought', v, '', { act: `still needs ${res} for the ${this.typeName(g.type)}, so makes some` }); return true; } }
      v.goal = null;
      return false;
    }
    const r = this.startBuild(v, { target: g.type, near: g.near, label: g.label });
    v.goal = null;
    if (r.ok) { this.dropAsk(v); this.addFeed('thought', v, '', { act: `has what the ${this.typeName(g.type)} needs, and ${r.summary}` }); return true; }
    return false;
  }

  startBuild(v, d) {
    const type = d.target;
    if (!STRUCT[type]) return { ok: false, want: 'build something', why: 'I was not sure what' };
    const shown = this.typeName(type);
    const a = /^[aeiou]/.test(shown) ? 'an' : 'a';
    const want = `build ${a} ${shown}`;
    const block = this.buildBlock(v, type);
    if (block) return { ok: false, want, why: block };
    const def = STRUCT[type];

    const miss = this.missing(v, type);
    const lacking = Object.keys(miss);
    if (lacking.length) {
      lacking.sort((x, y) => miss[y] - miss[x]);
      const res = lacking[0];
      const need = Object.entries(miss).map(([k, n]) => `${n} more ${k}`).join(' and ');
      this.remember(v, `I want to ${want} but still need ${need}.`);
      // they mean to come back to it: the gathering or making done, the building starts
      if (!v.goal || v.goal.type !== type) v.goal = { type, near: d.near, label: d.label, until: this.day + 2 };
      // what the valley gives, they go and get; what has to be made, they set about making
      if (this.gatherable(res)) {
        const g = this.startGather(v, res, `wants to ${want}, needs ${need}, goes for ${res}`);
        return g.ok ? g : { ok: false, want, why: `I need ${need} and could not find any` };
      }
      const mat = this.materialByName(res);
      if (mat) {
        const m = this.startMake(v, { target: mat.name });
        return m.ok ? { ok: true, summary: `wants to ${want}, needs ${need}, so sets about making ${mat.name}` } : { ok: false, want, why: `I need ${need}, and ${m.why}` };
      }
      return { ok: false, want, why: `I need ${need}, and ${res} is not a thing anyone here can get` };
    }

    if (type === 'path') return this.startPath(v, d);

    const [ax, ay] = this.anchorFor(v, d.near);
    const site = this.findSite(type, ax, ay, v);
    if (!site) return { ok: false, want, why: 'there was no room near there' };
    if (v.goal && v.goal.type === type) v.goal = null; // this is the building they were working toward
    const s = { id: this.nextId++, type, x: site[0], y: site[1], w: def.w, h: def.h, p: 0, owner: v.id, label: this.cleanLabel(d.label), day: this.day };
    this.structures.push(s);
    this.rebuildGrids();
    const path = this.pathToStruct(v, s);
    if (!path) {
      this.structures.pop();
      this.rebuildGrids();
      return { ok: false, want, why: 'I could not get to the spot I picked' };
    }
    this.pay(v, def.cost);
    this.worldVersion++;
    const pace = this.is(v, 'build') ? 0.7 : 1;
    v.plan = { action: 'build', sid: s.id, phase: 'walk', timer: def.time * pace, total: def.time * pace };
    v.path = path;
    return { ok: true, summary: `starts building ${a} ${shown}${s.label ? ` called "${s.label}"` : ''}` };
  }

  startPath(v, d) {
    const home = this.structById(v.home);
    const [sx, sy] = this.tileOf(v);
    let from = home ? this.adjacentTiles(home).find(([x, y]) => this.walkable(x, y)) : [sx, sy];
    if (!from) from = [sx, sy];

    // Where should the path lead? Somewhere named if they said so, otherwise
    // toward the fire or any other place worth walking to.
    const dests = [];
    if (d.near && !/here|home/i.test(d.near)) dests.push(this.anchorFor(v, d.near));
    dests.push(this.anchorFor(v, 'campfire'));
    const places = this.structures.filter((s) => s.p >= 1 && s.id !== v.home && s.type !== 'garden' && s.type !== 'lantern');
    for (let i = 0; i < 4 && places.length; i++) { const s = pick(places); dests.push([s.x, s.y]); }

    const fire = this.anchorFor(v, 'campfire');
    const starts = [from, [fire[0], fire[1] + 1]];
    let tiles = [];
    for (const st of starts) {
      if (!this.walkable(st[0], st[1])) continue;
      for (const [tx, ty] of dests) {
        const route = this.bfs(st[0], st[1], (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= 1);
        if (!route) continue;
        tiles = [st, ...route].filter(([x, y]) => !this.paths.has(idx(x, y)) && !this.structGrid[idx(x, y)]).slice(0, 7);
        if (tiles.length) break;
      }
      if (tiles.length) break;
    }
    if (!tiles.length) {
      this.pathFailDay = this.day;
      return { ok: false, want: 'lay a path', why: 'the paths I had in mind are already laid' };
    }
    const walk = this.bfs(sx, sy, (x, y) => x === tiles[0][0] && y === tiles[0][1]);
    if (!walk) return { ok: false, want: 'lay a path', why: 'I could not reach where it should start' };
    this.pay(v, STRUCT.path.cost);
    v.plan = { action: 'build', pathTiles: tiles, phase: 'walk', timer: STRUCT.path.time, total: STRUCT.path.time };
    v.path = walk;
    return { ok: true, summary: 'starts laying a stone path' };
  }

  startEat(v) {
    if (v.needs.hunger > 80) return { ok: false, want: 'eat', why: 'I am full and not hungry at all' };
    if (v.inv.food < 1 && this.stored('food') >= 1) { this.store.food--; v.inv.food++; }
    if (v.inv.food < 1) return { ok: false, want: 'eat', why: 'I have no food on me' };
    v.plan = { action: 'eat', phase: 'work', timer: 2.5 };
    v.path = [];
    return { ok: true, summary: 'sits down to eat' };
  }

  startSleep(v, here) {
    const home = this.structById(v.home);
    const fire = this.structures.find((s) => s.type === 'campfire' && s.p >= 1);
    let path = [], where = 'on the ground';
    if (!here) {
      const target = home && home.p >= 1 ? home : fire;
      if (target) {
        const p = this.pathToStruct(v, target);
        if (p) { path = p; where = target === home ? 'at home' : 'by the fire'; }
      }
    }
    v.plan = { action: 'sleep', phase: 'walk', where, elapsed: 0 };
    v.path = path;
    return { ok: true, summary: `goes to sleep ${where}` };
  }

  startTalk(v, d) {
    const found = this.findOther(v, d.to, 'talk to someone');
    if (found.fail) return found.fail;
    const t = found.t;
    if (t.sleeping) return { ok: false, want: `talk to ${t.name}`, why: `${t.name} is asleep` };
    if (this.inConversation(t)) return { ok: false, want: `talk to ${t.name}`, why: `${t.name} is already deep in conversation with someone` };
    if ((v.shunnedUntil || 0) > this.day && !this.closeKin(v, t)) return { ok: false, want: `talk to ${t.name}`, why: `I am shunned, and ${t.name} turned away from me` };
    const say = (d.say || '').trim() || `${t.name}, how are you holding up?`;
    let topic = String(d.target || '').replace(/["\n]/g, '').replace(/[.!]+$/, '').trim().slice(0, 80);
    if (topic.length < 4 || /^(wood|stone|food|clay|reeds|hide|bone|wool)$/i.test(topic) || this.byName(topic) === t) topic = '';
    v.plan = { action: 'talk', to: t.id, say, topic, phase: 'walk', chase: 0, timeout: 30, talk: this.nextTalk = (this.nextTalk || 0) + 1 };
    v.path = [];
    this.light(t); v.lastSpoke = t.lastSpoke = this.day;
    return { ok: true, summary: `goes to talk to ${t.name}${topic ? ` about ${topic}` : ''}` };
  }

  startGive(v, d) {
    const item = this.materialNames().includes(d.target) ? d.target : this.materialFrom(d.target) || 'food';
    const found = this.findOther(v, d.to, `give away some ${item}`);
    if (found.fail) return found.fail;
    const t = found.t;
    if (this.have(v, item) < 1) return { ok: false, want: `give ${t.name} some ${item}`, why: `I have no ${item}` };
    if (t.stage === 'child') return { ok: false, want: `give ${t.name} some ${item}`, why: 'little ones have no use for it yet' };
    v.plan = { action: 'give', to: t.id, item, phase: 'walk', chase: 0, timeout: 30 };
    v.path = [];
    return { ok: true, summary: `goes to give ${t.name} some ${item}` };
  }

  // Tending the sick, stealing and fighting all begin the same way: go and find the person.
  startChase(v, d, action) {
    const want = { tend: 'look after someone', take: 'take something from someone', fight: 'fight someone', kill: 'kill someone', quarrel: 'have it out with someone', tryst: 'get someone alone', propose: 'ask someone to make a home with me', together: 'spend time with my partner' }[action];
    if (action === 'together' && !v.partner) return { ok: false, want, why: 'I have no partner' };
    const found = this.findOther(v, d.to, want);
    if (found.fail) return found.fail;
    const t = found.t;
    const plan = { action, to: t.id, phase: 'walk', chase: 0, timeout: 30, talk: this.nextTalk = (this.nextTalk || 0) + 1 };
    if (['propose', 'quarrel', 'fight', 'kill', 'tryst', 'take'].includes(action)) { this.light(v, 120); this.light(t, 120); }
    if (action === 'propose') {
      if (!this.canPair(v, t)) return { ok: false, want: `ask ${t.name} to make a home with me`, why: v.partner ? 'I already have a partner' : t.partner ? `${t.name} already has a partner` : t.stage === 'child' ? `${t.name} is a child` : 'that could never be' };
      if (t.sleeping) return { ok: false, want: `ask ${t.name} to make a home with me`, why: `${t.name} is asleep` };
      plan.say = (d.say || '').trim() || `${t.name}, would you make a home and a life with me?`;
      v.plan = plan;
      v.path = [];
      return { ok: true, summary: `goes to ask ${t.name} something that matters` };
    }
    if (action === 'together') {
      if (v.closeDay === this.day) return { ok: false, want: `spend time with ${t.name}`, why: 'we have already had our time together today' };
      if (t.sleeping) return { ok: false, want: `spend time with ${t.name}`, why: `${t.name} is asleep` };
      v.plan = plan;
      v.path = [];
      return { ok: true, summary: `goes to find ${t.name}, to have some time together` };
    }
    if (action === 'tend') {
      if (!t.sick) return { ok: false, want: `look after ${t.name}`, why: `${t.name} is not sick` };
      if (this.satWith(v, t)) return { ok: false, want: `look after ${t.name}`, why: `I have already sat with ${t.gender === 'm' ? 'him' : 'her'} today, and what ${t.gender === 'm' ? 'he' : 'she'} needs now is rest` };
      v.plan = plan;
      v.path = [];
      return { ok: true, summary: `goes to look after ${t.name}` };
    }
    if (t.stage === 'child') return { ok: false, want: action === 'take' ? `take from ${t.name}` : `fight ${t.name}`, why: 'I could never do that to a child' };
    if (action === 'quarrel') { plan.say = (d.say || '').trim() || `I have had enough of you, ${t.name}.`; v.plan = plan; v.path = []; return { ok: true, summary: `goes to have it out with ${t.name}` }; }
    if (action === 'tryst') { if (t.sleeping) return { ok: false, want, why: `${t.name} is asleep` }; v.plan = plan; v.path = []; return { ok: true, summary: `goes looking for ${t.name}, alone` }; }
    if (action === 'kill') {
      if (this.cfg.violence === false) return { ok: false, want: `kill ${t.name}`, why: 'I could not bring myself to it' };
      plan.say = (d.say || '').trim();
      plan.timeout = 45;
      v.plan = plan; v.path = [];
      return { ok: true, summary: `goes after ${t.name}, and means to finish it` };
    }
    if (action === 'fight') plan.say = (d.say || '').trim();
    if (action === 'take') {
      plan.item = this.materialNames().includes(d.target) ? d.target : this.materialFrom(d.target) || 'food';
      if (this.have(t, plan.item) < 1) return { ok: false, want: `take ${plan.item} from ${t.name}`, why: `${t.name} has no ${plan.item} to take` };
      if (this.have(v, plan.item) >= CARRY) return { ok: false, want: `take ${plan.item} from ${t.name}`, why: `I cannot carry any more ${plan.item}` };
      v.plan = plan;
      v.path = [];
      return { ok: true, summary: `goes after ${t.name}'s ${plan.item}` };
    }
    v.plan = plan;
    v.path = [];
    return { ok: true, summary: `goes looking for ${t.name}, furious` };
  }

  finishTend(v, p) {
    const t = this.byId(p.to);
    if (!t || !t.sick) return this.endPlan(v);
    if (t.sick.tended !== this.day) t.health = clamp(t.health + (this.is(v, 'heal') ? 22 : 10)); // care helps once a day, however many sit there
    t.sick.tended = this.day;
    if (!t.sick.by) t.sick.by = {};
    t.sick.by[v.id] = this.day;
    this.practice(v, 'heal', 3);
    v.exposed = true;
    this.changeAffinity(v, t, 8);
    this.remember(v, `I sat with ${t.name} and looked after ${t.gender === 'm' ? 'him' : 'her'} through ${t.sick.name}.`);
    if (t.stage === 'adult') this.remember(t, `${v.name} looked after me while I was sick.`);
    this.addFeed('event', v, `${v.name} is looking after ${t.name}, who has ${t.sick.name}.`);
    p.phase = 'work';
    p.timer = 22;
  }

  // One person asks another to make a home together. The answer is the other person's to give.
  beginPropose(v, p) {
    const t = this.byId(p.to);
    if (!t || t.sleeping || this.inConversation(t)) {
      // not the moment: they keep the question for later in the day instead of giving up on it
      if (!v.askFail || v.askFail.day !== this.day) v.askFail = { day: this.day, n: 0 };
      if (++v.askFail.n <= 3) v.askedDay = this.day - 1;
      this.endPlan(v, 6);
      return;
    }
    v.dir = t.x < v.x ? -1 : 1;
    t.dir = v.x < t.x ? -1 : 1;
    t.holdUntil = Date.now() + 30000;
    t.bubble = null;
    this.say(v, p.say, 700, true, { id: p.talk, to: t.name, kind: 'propose' });
    p.phase = 'converse';
    p.waiting = true;
    p.deadline = Date.now() + 90000;
    this.brain.answer(t, v, p.say).then((r) => {
      if (v.plan !== p) return;
      const answer = r && /yes/i.test(r.answer) ? 'yes' : r && /^no\b/i.test(String(r.answer).trim()) ? 'no' : 'not yet';
      v.bubble = null;
      const said = (r && r.say) || { yes: 'Yes.', no: 'No.', 'not yet': 'Not yet.' }[answer];
      if (!t.askedBy) t.askedBy = []; t.askedBy.push({ who: v.name, day: this.day, said: String(said).slice(0, 120), answer }); if (t.askedBy.length > 4) t.askedBy.shift();
      this.say(t, said, 700, false, { id: p.talk, to: v.name, kind: 'propose' });
      const him = t.gender === 'm' ? 'He' : 'She';
      if (answer === 'yes') {
        this.remember(v, `I asked ${t.name} to make a home with me. ${him} said yes.`);
        this.remember(t, `${v.name} asked me to make a home together. I said yes.`);
        this.lift(v, 10); this.lift(t, 6);
        this.maybePair(v, t, true);
      } else if (answer === 'no') {
        v.affinity[t.id] = clamp(this.getAffinity(v, t) - 8);
        if (!v.refused) v.refused = {};
        v.refused[t.id] = this.day;
        this.lift(v, -10);
        if (this.gene(v, 'pride') >= 1) this.wrong(v, t, 'turned me down', 1, 6);
        this.remember(v, `I asked ${t.name} to make a home with me. ${him} said no.`);
        this.remember(t, `${v.name} asked me to make a home together. I said no.`);
        this.addFeed('event', v, `${v.name} asked ${t.name} to make a home together. ${t.name} said no.`);
      } else {
        this.changeAffinity(v, t, 4);
        if (!v.waitFor) v.waitFor = {};
        v.waitFor[t.id] = this.day;
        this.remember(v, `I asked ${t.name} to make a home with me. ${him} said not yet.`);
        this.remember(t, `${v.name} asked me to make a home together. I said not yet.`);
        this.addFeed('event', v, `${v.name} asked ${t.name} to make a home together. ${t.name} said not yet.`);
      }
      p.waiting = false;
      p.timer = 5;
      t.holdUntil = Date.now() + 4000;
    });
  }

  finishTogether(v, p) {
    const t = this.byId(p.to);
    if (!t || t.sleeping) return this.failPlan(v, `${t ? t.name : 'they'} had gone to sleep`);
    v.dir = t.x < v.x ? -1 : 1;
    t.dir = v.x < t.x ? -1 : 1;
    if (t.plan && t.plan.action !== 'sleep') this.endPlan(t);
    t.holdUntil = Date.now() + 5000;
    v.closeDay = t.closeDay = this.day;
    this.changeAffinity(v, t, 6);
    v.needs.social = clamp(v.needs.social + 35);
    t.needs.social = clamp(t.needs.social + 35);
    this.remember(v, `${t.name} and I had some time together, just the two of us.`);
    this.remember(t, `${v.name} and I had some time together, just the two of us.`);
    this.addFeed('event', v, `${v.name} and ${t.name} spent some time together, just the two of them.`);
    p.phase = 'work';
    p.timer = 9;
  }

  finishTake(v, p) {
    const t = this.byId(p.to);
    if (!t) return this.endPlan(v);
    const n = Math.max(0, Math.min(4, this.have(t, p.item), CARRY - this.have(v, p.item)));
    if (n < 1) return this.failPlan(v, `${t.name} had nothing left to take`);
    t.inv[p.item] = this.have(t, p.item) - n;
    this.give(v, p.item, n);
    const seen = Math.random() < (t.sleeping ? 0.2 : 0.65);
    const he = t.gender === 'm' ? 'he' : 'she';
    if (seen) {
      t.affinity[v.id] = clamp(this.getAffinity(t, v) - 30);
      v.affinity[t.id] = clamp(this.getAffinity(v, t) - 10);
      this.remember(v, `I took ${n} ${p.item} from ${t.name}, and ${he} saw me do it.`);
      this.remember(t, `${v.name} stole ${n} ${p.item} from me. I saw it happen.`);
      this.lift(t, -5); this.lift(v, -8);
      this.wrong(t, v, `stole ${p.item} from me`, 2);
      this.addFeed('event', v, `${v.name} stole ${n} ${p.item} from ${t.name}, and was seen.`);
      this.breach(v, 'stealing', `stole from ${t.name}`);
    } else {
      this.remember(v, `I took ${n} ${p.item} from ${t.name} while ${he} was not looking.`);
      this.remember(t, `Some of my ${p.item} has gone missing.`);
      this.addFeed('event', v, `${v.name} quietly took ${n} ${p.item} from ${t.name}.`);
    }
    this.endPlan(v);
  }

  // Two people come to blows. Most fights end with bruises. Some go too far, and a few were meant to.
  finishFight(v, p) {
    const t = this.byId(p.to);
    if (!t) return this.endPlan(v);
    const meant = p.action === 'kill';
    v.dir = t.x < v.x ? -1 : 1;
    if (p.say) this.say(v, p.say, 700, false, { id: p.talk, to: t.name, kind: 'fight' });
    const armed = (x) => ((x.items || []).some((it) => /knife|spear|axe|club|blade|edge/.test(it.name)) ? 1.15 : 1);
    const might = (x) => Math.max(5, x.health) * (this.isOld(x) ? 0.65 : 1) * (x.sleeping ? 0.3 : 1) * (1 + 0.08 * this.gene(x, 'nerve')) * armed(x) * (0.6 + Math.random() * 0.8);
    const surprise = meant && (t.sleeping || Math.random() < 0.35);
    const [winner, loser] = surprise || might(v) >= might(t) ? [v, t] : [t, v];
    let lHurt = 18 + Math.random() * 18, tooFar = false;
    if (meant && winner === v) lHurt = (surprise ? 80 : 55) + Math.random() * 60;
    else if (meant) lHurt = 30 + Math.random() * 35; // the one who came to kill got the worst of it
    else if (Math.random() < 0.05) { tooFar = true; lHurt += 40 + Math.random() * 40; }
    const witnesses = this.adults().filter((o) => o !== v && o !== t && !o.away && !o.sleeping && !o.inside && Math.hypot(o.x - v.x, o.y - v.y) <= 8);
    if (t.sleeping) { t.sleeping = false; t.inside = false; }
    if (t.plan) this.endPlan(t);
    winner.health = clamp(winner.health - (5 + Math.random() * 8));
    loser.health = clamp(loser.health - lHurt);
    winner.lastHurt = `a fight with ${loser.name}`;
    loser.lastHurt = `a fight with ${winner.name}`;
    this.endPlan(v, 2);
    if (loser.health <= 0) return this.killing(winner, loser, meant && winner === v, witnesses);

    v.affinity[t.id] = clamp(this.getAffinity(v, t) - 15);
    this.wrong(t, v, meant ? 'came at me meaning to kill me' : 'attacked me', meant ? 3 : 2, 40);
    if (this.villagers.includes(v) && this.villagers.includes(t)) this.breach(v, 'fighting', `attacked ${t.name}`);
    this.remember(v, `I ${meant ? 'went for' : 'attacked'} ${t.name}${meant ? ', meaning to end it' : ''}. ${winner === v ? 'I got the better of it.' : 'I got the worst of it.'}`);
    this.remember(t, `${v.name} ${meant ? 'came at me meaning to kill me' : 'attacked me'}. ${winner === t ? 'I got the better of it.' : 'I got the worst of it.'}`);
    this.lift(winner, 4); this.lift(loser, -8);
    for (const o of this.adults()) {
      if (o === v || o === t || o.away) continue;
      const saw = witnesses.includes(o);
      const near = o.partner === t.id || o.parents.includes(t.id) || t.parents.includes(o.id);
      if (near && (meant || saw || Math.random() < 0.5)) { this.wrong(o, v, `${meant ? 'tried to kill' : 'beat'} ${t.name}`, meant ? 2 : 1, 12); this.remember(o, `${v.name} ${meant ? 'tried to kill' : 'attacked'} ${t.name}.`); }
      else if (saw) { this.remember(o, `I saw ${v.name} ${meant ? 'go for' : 'attack'} ${t.name}.`); o.affinity[v.id] = clamp(this.getAffinity(o, v) - (meant ? 18 : 10)); }
    }
    if (lHurt >= 25 && !loser.sick && Math.random() < 0.22) {
      loser.sick = { name: 'a festering wound', until: this.day + 3 + Math.floor(Math.random() * 3), harsh: true, tended: 0 };
      this.addFeed('event', loser, `${loser.name}'s wound has gone bad.`);
      this.remember(loser, 'The wound is hot and swollen. It has gone bad.');
    }
    const line = `${v.name} ${meant ? 'tried to kill' : 'attacked'} ${t.name}. ${loser.name} got the worst of it${tooFar ? ', and badly' : ''}.`;
    this.addFeed('death', null, line);
    this.addChronicle('event', null, line);
  }

  // ---------- leaving the valley ----------

  startExplore(v) {
    if ((v.restUntil || 0) > this.day) return { ok: false, want: 'leave the valley again', why: 'my legs have not recovered from the last journey' };
    if (v.inv.food < 4) return { ok: false, want: 'leave the valley and see what lies beyond', why: 'I would need at least 4 food for the road' };
    if (this.weatherNow() === 'blizzard' || this.weatherNow() === 'storm') return { ok: false, want: 'leave the valley and see what lies beyond', why: 'nobody could travel in this weather' };
    if (this.villagers.filter((o) => o.away).length >= 2) return { ok: false, want: 'leave the valley and see what lies beyond', why: 'too many are already away' };
    const [sx, sy] = this.tileOf(v);
    const path = this.bfs(sx, sy, (x, y) => Math.min(x, y, W - 1 - x, H - 1 - y) <= 0);
    if (!path) return { ok: false, want: 'leave the valley and see what lies beyond', why: 'I could not find a way out' };
    v.plan = { action: 'explore', phase: 'walk', timer: 1 };
    v.path = path;
    return { ok: true, summary: 'sets out to see what lies beyond the valley' };
  }

  depart(v) {
    v.inv.food -= 4;
    let risk = (this.is(v, 'roam') ? 0.03 : 0.07) * (1 - 0.3 * this.effectLevel('travel', v));
    if (this.isWinter()) risk += 0.25;
    if (this.isOld(v)) risk += 0.1;
    if (v.health < 60 || v.sick) risk += 0.15;
    v.away = { until: this.dayFloat() + 1 + Math.random() * 1.2, since: this.day, lost: Math.random() < risk };
    v.inside = true; // off the map: nothing in the valley can reach them
    v.sleeping = false;
    v.plan = null;
    v.path = [];
    const he = v.gender === 'm' ? 'he' : 'she';
    this.addFeed('event', v, `${v.name} walked out of the valley to see what lies beyond.`);
    this.addChronicle('event', null, `${v.name} left the valley to see what lies beyond.`);
    for (const o of this.adults()) if (o !== v) this.remember(o, `${v.name} has left the valley to see what lies beyond. Nobody knows when ${he} will be back.`);
  }

  comeBack(v) {
    const days = Math.max(1, this.day - v.away.since);
    if (v.away.lost) {
      v.inside = false;
      return this.die(v, 'the wilds beyond the valley', { noGrave: true, line: `${v.name} never came back from beyond the valley.` });
    }
    v.away = null;
    v.inside = false;
    v.needs.hunger = Math.min(v.needs.hunger, 40);
    v.needs.energy = Math.min(v.needs.energy, 45);
    const base = pick(FINDS);
    if (!this.seen) this.seen = [];
    const fresh = SIGHTS.filter((x) => !this.seen.includes(x));
    const place = pick(fresh.length ? fresh : SIGHTS);
    this.seen.push(place);
    const find = { ...base, place };
    base.apply(this, v);
    v.restUntil = this.day + 3; // a long road takes it out of a person
    this.practice(v, 'roam', 5);
    this.remember(v, `I was gone ${days} day${days === 1 ? '' : 's'} beyond the valley and made it home. Out there I found ${find.text}.`);
    this.addFeed('event', v, `${v.name} came back from beyond the valley with ${find.short}.`);
    this.addChronicle('event', null, `${v.name} came home from beyond the valley with ${find.short}.`);
    for (const o of this.adults()) if (o !== v) { this.remember(o, `${v.name} came home safe from beyond the valley.`); o.affinity[v.id] = clamp(this.getAffinity(o, v) + 4); }
    // home at last: if someone has been waiting for them, this is when it happens
    for (const o of this.adults()) if (o !== v) this.maybePair(v, o);
    const day = this.day;
    this.brain.tale(v, days, find).then((r) => {
      if (!r || !r.story) return;
      const text = String(r.story).slice(0, 420);
      v.tale = text;
      this.remember(v, `What I saw out there: ${text}`);
      this.lore.push({ day, who: v.name, text: text.slice(0, 260) });
      if (this.lore.length > 5) this.lore.shift();
      this.chronicle.push({ day, type: 'tale', who: v.name, text });
      if (this.onFeed) this.onFeed('chronicle', { day, type: 'tale', who: v.name, text });
    });
    this.changed();
  }

  startWander(v) {
    const [sx, sy] = this.tileOf(v);
    for (let i = 0; i < 12; i++) {
      const tx = sx + Math.floor(Math.random() * 15) - 7, ty = sy + Math.floor(Math.random() * 15) - 7;
      if (!this.walkable(tx, ty)) continue;
      const path = this.bfs(sx, sy, (x, y) => x === tx && y === ty);
      if (path && path.length < 16) {
        v.plan = { action: 'wander', phase: 'walk', timer: 2.5 * this.stretch() };
        v.path = path;
        return { ok: true, summary: 'wanders off for a look around' };
      }
    }
    v.plan = { action: 'wander', phase: 'work', timer: 3 * this.stretch() };
    return { ok: true, summary: 'stays put and looks around' };
  }

  // ---------- running plans ----------

  runPlan(v, dt) {
    const p = v.plan;

    if (p.phase === 'walk') {
      if (CHASES.includes(p.action)) {
        const t = this.byId(p.to);
        if (!t || t.away) return this.failPlan(v, 'they were gone');
        p.chase -= dt;
        p.timeout -= dt;
        if (dist(v, t) <= 1.8) { v.path = []; return this.arrive(v, p); }
        if (p.timeout <= 0) return this.failPlan(v, `I could not catch up with ${t.name}`);
        if (p.chase <= 0 || !v.path.length) {
          p.chase = 0.8;
          const [tx, ty] = this.tileOf(t);
          const path = this.pathNear(v, tx, ty);
          if (!path) return this.failPlan(v, `I could not reach ${t.name}`);
          v.path = path;
        }
      }
      if (p.action === 'hunt') {
        const a = this.animals.find((x) => x.id === p.prey);
        if (!a) return this.failPlan(v, 'the animal was gone');
        p.chase -= dt;
        p.timeout -= dt;
        if (Math.hypot(a.x - v.x, a.y - v.y) <= 3.2) { v.path = []; v.dir = a.x < v.x ? -1 : 1; p.phase = 'work'; p.timer = 1.6; return; }
        if (p.timeout <= 0) return this.failPlan(v, `the ${a.kind} kept its distance all day`);
        if (p.chase <= 0 || !v.path.length) {
          p.chase = 0.6;
          const path = this.pathNear(v, Math.floor(a.x), Math.floor(a.y), 2);
          if (!path) return this.failPlan(v, `I lost the ${a.kind} in the brush`);
          v.path = path;
        }
        const hr = this.moveAlong(v, dt, 0.8);
        if (hr === 'blocked') v.path = [];
        return;
      }
      const r = this.moveAlong(v, dt);
      if (r === 'blocked') return this.failPlan(v, 'the way was blocked');
      if (r === true && !CHASES.includes(p.action)) return this.arrive(v, p);
      return;
    }

    if (p.phase === 'converse') {
      if (p.waiting) {
        if (Date.now() > p.deadline) { p.waiting = false; this.endPlan(v); }
        return;
      }
      p.timer -= dt;
      if (p.timer <= 0) this.endPlan(v);
      return;
    }

    if (p.action === 'sleep') {
      p.elapsed += dt / this.cfg.dayLengthSec;
      const rested = v.needs.energy >= 97 && !this.isNight();
      const starving = v.needs.hunger < 8 && v.needs.energy > 45;
      if (rested || starving || p.elapsed > 0.6) {
        v.sleeping = false;
        v.inside = false;
        this.remember(v, `I slept ${p.where}${starving ? ' but woke hungry' : ''}.`);
        this.endPlan(v);
      }
      return;
    }

    if (p.action === 'shelter') {
      // stay in until it passes, unless hunger drives them out
      if ((this.dangerOutside() || this.wolves().length) && v.needs.hunger > 18 && this.structById(p.roof)) return;
      v.inside = false;
      this.remember(v, 'I stayed under a roof until it passed.');
      return this.endPlan(v);
    }
    p.timer -= dt;
    if (p.action === 'build' && p.sid) {
      const s = this.structById(p.sid);
      if (!s) return this.endPlan(v);
      s.p = Math.min(0.99, 1 - p.timer / p.total);
    }
    if (p.timer <= 0) this.finish(v, p);
  }

  arrive(v, p) {
    p.phase = 'work';
    if (p.action === 'sleep') {
      const home = this.structById(v.home);
      v.sleeping = true;
      v.inside = p.where === 'at home' && !!home;
      return;
    }
    if (p.action === 'talk') return this.beginTalk(v, p);
    if (p.action === 'give') return this.finishGive(v, p);
    if (p.action === 'call') return this.beginGathering(v, p);
    if (p.action === 'propose') return this.beginPropose(v, p);
    if (p.action === 'together') return this.finishTogether(v, p);
    if (p.action === 'tend') return this.finishTend(v, p);
    if (p.action === 'take') return this.finishTake(v, p);
    if (p.action === 'fight' || p.action === 'kill') return this.finishFight(v, p);
    if (p.action === 'quarrel') return this.finishQuarrel(v, p);
    if (p.action === 'tryst') return this.beginTryst(v, p);
    if (p.action === 'explore') return this.depart(v);
    if (p.action === 'flee') return this.endPlan(v, 0.3);
    if (p.action === 'shelter') { v.inside = true; p.timer = 4; return; }
    if (p.action === 'fish' && p.cast[0]) v.dir = p.cast[0];
  }

  inConversation(t) {
    return Date.now() < t.holdUntil || (!!t.plan && t.plan.phase === 'converse');
  }

  beginTalk(v, p) {
    const t = this.byId(p.to);
    if (!t || t.sleeping) return this.failPlan(v, `${t ? t.name : 'they'} had fallen asleep`);
    if (this.inConversation(t)) return this.failPlan(v, `${t.name} was busy talking with someone else`);
    v.dir = t.x < v.x ? -1 : 1;
    t.dir = v.x < t.x ? -1 : 1;
    t.holdUntil = Date.now() + 30000;
    t.path = t.stage === 'child' ? [] : t.path;
    t.bubble = null;
    this.say(v, p.say, 700, true, { id: p.talk, to: t.name, kind: 'talk' });
    p.phase = 'converse';
    p.waiting = true;
    p.deadline = Date.now() + 90000;

    // A real back-and-forth: they take turns until the lines run out.
    const total = Math.max(2, this.cfg.talkLines || 6);
    const lines = [{ who: v.name, text: p.say }];
    // each of them comes away with their own feeling about the other; it need not be shared
    const felt = { [v.id]: 0, [t.id]: 0 };

    const wrapUp = () => {
      this.shiftAffinity(v, t, Math.max(-14, Math.min(10, felt[v.id])));
      this.shiftAffinity(t, v, Math.max(-14, Math.min(10, felt[t.id])));
      // a talk that went badly, and not for the first time, is remembered
      for (const [x, y] of [[v, t], [t, v]]) {
        if (x.stage !== 'adult' || y.stage !== 'adult') continue;
        if (!x.sour) x.sour = {};
        if (felt[x.id] <= -7) { x.sour[y.id] = (x.sour[y.id] || 0) + 1; if (x.sour[y.id] >= 2) { x.sour[y.id] = 0; this.wrong(x, y, 'said things to me I will not forget', 1); } }
        else if (felt[x.id] > 0) { x.sour[y.id] = 0; const w = (x.wrongs || {})[y.id]; if (w && w.weight === 1 && felt[x.id] >= 5) { delete x.wrongs[y.id]; this.remember(x, `${y.name} and I talked it through. I have let it go.`); } }
      }
      if (v.sick) t.exposed = true;
      if (t.sick) v.exposed = true;
      v.needs.social = clamp(v.needs.social + 40);
      if (t.stage === 'adult') t.needs.social = clamp(t.needs.social + 40);
      // a long talk is remembered by how it began and how it ended
      const kept = lines.length > 4 ? [lines[0], lines[1], ...lines.slice(-2)] : lines;
      const gist = (me) => kept.map((l) => `${l.who === me.name ? 'Me' : l.who}: "${l.text.slice(0, 100)}"`).join(' ');
      const about = p.topic ? ` about ${p.topic}` : '';
      this.remember(v, `I talked with ${t.name}${about}. ${gist(v)}`);
      if (t.stage === 'adult') this.remember(t, `${v.name} came to talk with me${about}. ${gist(t)}`);
      p.waiting = false;
      p.timer = 5;
      t.holdUntil = Date.now() + 4000;
      for (const x of [v, t]) if (x.bubble && x.bubble.until > Date.now() + 9000) x.bubble.until = Date.now() + Math.min(9000, 2500 + x.bubble.text.length * 30);
    };

    const turn = (speaker, listener) => {
      const last = lines.length >= total - 1;
      this.brain.reply(speaker, listener, lines, last, p.topic).then((r) => {
        if (v.plan !== p) return;
        const line = (r && r.say) || '...';
        listener.bubble = null;
        this.say(speaker, line, 700, lines.length + 1 < total, { id: p.talk, to: listener.name, kind: 'talk' });
        lines.push({ who: speaker.name, text: line });
        felt[speaker.id] += { warmer: 5, same: 0, colder: -7 }[r && r.feeling] ?? 0;
        // a hungry, worn-out or short-tempered person takes things worse than they were meant
        if (speaker.stage === 'adult' && (speaker.needs.hunger < 30 || speaker.needs.energy < 20) && Math.random() < 0.35 + 0.1 * this.gene(speaker, 'temper')) felt[speaker.id] -= 3;
        if (r && r.view && speaker.stage === 'adult') speaker.views[listener.id] = String(r.view).slice(0, 160);
        t.holdUntil = Date.now() + 30000;
        p.deadline = Date.now() + 90000;
        if (lines.length >= total) return wrapUp();
        setTimeout(() => { if (v.plan === p) turn(listener, speaker); }, 2600);
      });
    };
    turn(t, v);
  }

  finishGive(v, p) {
    const t = this.byId(p.to);
    const room = CARRY - this.have(t, p.item);
    const n = Math.max(0, Math.min(room, Math.max(1, Math.min(5, Math.ceil(this.have(v, p.item) / 2)))));
    if (n < 1) return this.failPlan(v, `${t.name} could not carry any more ${p.item}`);
    v.inv[p.item] = this.have(v, p.item) - n;
    this.give(t, p.item, n);
    this.changeAffinity(v, t, 12);
    this.remember(v, `I gave ${t.name} ${n} ${p.item}.`);
    this.remember(t, `${v.name} gave me ${n} ${p.item}.`);
    this.addFeed('event', v, `${v.name} gave ${t.name} ${n} ${p.item}.`);
    v.needs.social = clamp(v.needs.social + 15);
    this.endPlan(v);
  }

  finish(v, p) {
    if (p.action === 'gather') {
      const bonus = this.count('workshop') > 0 ? 1 : 0;
      let got = (RAW[p.res] ? RAW[p.res].each : 3) + bonus;
      let what = '';
      const extra = {};
      if (p.farmId) {
        const f = this.structById(p.farmId);
        const src = f ? FOOD_SOURCES[f.type] : FOOD_SOURCES.farm;
        if (f) { f.ripe = false; f.regrowAt = this.dayFloat() + src.regrow * (this.isWinter() ? 2 : 1); }
        got = src.amount + bonus + (f && f.type === 'farm' ? this.stats.farmBonus || 0 : 0);
        what = ' ' + src.what;
        if (f && src.animal === 'sheep') extra.wool = 1; // the sheep give wool as well as milk
      } else {
        const o = this.objects[p.objKey];
        if (o) {
          if (o.kind === 'tree') delete this.objects[p.objKey];
          else if (o.kind === 'rock' || o.kind === 'clay') { o.left--; if (o.left <= 0) delete this.objects[p.objKey]; }
          else { o.ripe = false; o.regrowAt = this.dayFloat() + (o.kind === 'reeds' ? 2 : 1); }
        }
      }
      const craft = (RAW[p.res] && RAW[p.res].craft) || 'forage';
      if (this.is(v, craft)) got += 1;
      if (p.res !== 'food') got += Math.min(2, this.effectLevel('better_tools', v));
      this.practice(v, craft);
      got = Math.min(got, CARRY - this.have(v, p.res));
      this.give(v, p.res, got);
      this.stats[p.res] = (this.stats[p.res] || 0) + got;
      for (const [k, n] of Object.entries(extra)) { this.give(v, k, n); this.stats[k] = (this.stats[k] || 0) + n; }
      this.remember(v, `I gathered ${got} ${p.res}${what}${extra.wool ? ', and some wool' : ''}.`);
      this.changed();
      this.endPlan(v);
      if (this.pursueGoal(v)) return;
      // a morning in the fields is more than one basket
      if (this.keepAt(v, p) && this.have(v, p.res) <= CARRY - 4 && (!p.chore || this.time < 0.66)) {
        const again = this.startGather(v, p.res);
        if (again.ok && v.plan && v.plan.action === 'gather') { v.plan.chore = !!p.chore; v.plan.round = (p.round || 0) + 1; }
      }
      if (!p.farmId && p.res !== 'food') this.mishap(v, RAW[p.res] && RAW[p.res].from === 'rock' ? 'stone' : p.res === 'wood' ? 'wood' : 'dig');
      this.checkDiscoveries(v);
      return;
    }

    if (p.action === 'fish') {
      this.practice(v, 'fish');
      // the fewer fish there are, the more often the line comes up empty
      const share = this.fishShare();
      const blank = Math.min(0.95, (this.isWinter() ? 0.35 : 0.2) * (this.is(v, 'fish') ? 0.4 : 1) + (1 - share) * 0.55);
      if (Math.random() < blank || (this.fish ?? 1) < 1) this.remember(v, share < 0.25 ? 'I fished a long while and caught nothing. The pond is nearly empty.' : this.isWinter() ? 'I fished through the ice a good while, but nothing was biting.' : 'I fished a good while, but nothing was biting.');
      else {
        const got = Math.max(1, Math.min(CARRY - v.inv.food, Math.floor(this.fish ?? 99), 2 + Math.floor(Math.random() * 3) + (this.count('workshop') > 0 ? 1 : 0) + (this.is(v, 'fish') ? 1 : 0) + (this.effectLevel('better_hunting', v) > 0 ? 1 : 0)));
        if (this.fish != null) this.fish = Math.max(0, this.fish - got);
        v.inv.food += got;
        this.stats.food += got;
        this.remember(v, `I caught ${got} fish.`);
      }
      this.endPlan(v);
      if (this.keepAt(v, p) && !p.chore && v.inv.food <= CARRY - 4 && this.fishShare() > 0.2) {
        const again = this.startFish(v);
        if (again.ok && v.plan) v.plan.round = (p.round || 0) + 1;
      }
      this.mishap(v, 'fish');
      this.checkDiscoveries(v);
      return;
    }

    if (p.action === 'build') {
      if (p.pathTiles) {
        for (const [x, y] of p.pathTiles) this.paths.add(idx(x, y));
        this.remember(v, 'I laid a stretch of stone path.');
        this.addFeed('build', v, `${v.name} laid a stone path.`);
      } else {
        const s = this.structById(p.sid);
        if (s) this.completeStructure(v, s);
      }
      this.stats.built++;
      this.practice(v, 'build', 2);
      this.changed();
      this.endPlan(v);
      if (!p.pathTiles) this.mishap(v, 'build');
      this.checkDiscoveries(v);
      return;
    }

    if (p.action === 'hunt') {
      const a = this.animals.find((x) => x.id === p.prey);
      if (!a) return this.endPlan(v);
      this.practice(v, 'hunt', 1.5);
      const odds = SPEAR[a.kind] - (this.weatherNow() === 'fog' ? 0.15 : 0) + (this.count('workshop') > 0 ? 0.15 : 0) + (this.is(v, 'hunt') ? 0.2 : 0) + 0.12 * this.effectLevel('better_hunting', v);
      if (Math.random() < odds) {
        this.animals = this.animals.filter((x) => x !== a);
        const got = this.isYoung(a) ? Math.ceil(GAME[a.kind] / 2) : GAME[a.kind];
        const carried = Math.min(got, CARRY - v.inv.food);
        v.inv.food += carried;
        if (got > carried && this.storehouse()) this.store.food += got - carried;
        this.stats.food += got;
        this.stats.kills = (this.stats.kills || 0) + 1;
        // a kill is more than meat
        const parts = { deer: { hide: 1, bone: 1 }, sheep: { hide: 1, bone: 1 }, rabbit: Math.random() < 0.4 ? { hide: 1 } : {}, wolf: { hide: 1 }, chicken: {} }[a.kind] || {};
        for (const [k, n] of Object.entries(parts)) { this.give(v, k, n); this.stats[k] = (this.stats[k] || 0) + n; }
        this.remember(v, `I hunted a ${a.kind} and brought back ${got} food${parts.hide ? ', the hide' : ''}${parts.bone ? ' and the bones' : ''}.`);
        this.addFeed('event', v, `${v.name} killed a ${a.kind} with a spear.`);
      } else {
        a.hunter = null;
        a.scared = 0;
        if (a.kind === 'wolf') {
          v.health = clamp(v.health - 25);
          v.lastHurt = 'a wolf bite';
          this.remember(v, 'I went after a wolf and it bit me before it ran.');
          this.addFeed('event', v, `${v.name} went after a wolf and was bitten.`);
        } else this.remember(v, `I threw my spear at a ${a.kind} and missed. It got away.`);
        this.spook(a, v);
        if (a.kind === 'deer') { this.endPlan(v); this.mishap(v, 'hunt'); this.checkDiscoveries(v); return; }
      }
      this.endPlan(v);
      this.checkDiscoveries(v);
      return;
    }

    if (p.action === 'store') {
      const put = [];
      for (const k of Object.keys(v.inv)) {
        const n = Math.max(0, Math.min(this.have(v, k) - this.keepBack(k), this.storeCap() - (this.store[k] || 0)));
        if (n > 0) { v.inv[k] -= n; this.store[k] = (this.store[k] || 0) + n; put.push(`${n} ${k}`); }
      }
      if (put.length) {
        this.remember(v, `I put ${put.join(', ')} in the storehouse.`);
        this.addFeed('event', v, `${v.name} put ${put.join(', ')} in the storehouse.`);
      }
      return this.endPlan(v);
    }

    if (p.action === 'design') return this.finishDesign(v, p);
    if (p.action === 'invent') {
      v.inventDay = this.day;
      const pr = v.project;
      if (!pr) return this.endPlan(v);
      pr.progress += 1 + (this.effectLevel('knowledge', v) > 0 ? 1 : 0);
      this.practice(v, 'invent', 2);
      if (pr.progress >= 3 && this.inventedDay !== this.day) {
        this.inventedDay = this.day;
        v.project = null;
        this.remember(v, `Something finally came together in my idea about ${pr.idea}.`);
        this.brain.inventionSpec(v, pr.idea).then((spec) => this.addInvention(v, spec, pr.idea));
      } else {
        this.remember(v, `I worked on my idea about ${pr.idea}. It is ${pr.progress >= 3 ? 'nearly there' : pr.progress === 2 ? 'getting closer' : 'not there yet'}.`);
      }
      return this.endPlan(v);
    }

    if (p.action === 'make' && p.material) {
      const mat = this.materialByName(p.material);
      const n = mat ? mat.makes : 2;
      this.give(v, p.material, n);
      this.stats[p.material] = (this.stats[p.material] || 0) + n;
      this.practice(v, 'make', 2);
      this.remember(v, `I made ${n} ${p.material}.`);
      this.addFeed('event', v, `${v.name} made ${n} ${p.material}.`);
      this.checkDiscoveries(v);
      this.endPlan(v);
      this.pursueGoal(v);
      return;
    }
    if (p.action === 'make') {
      const known = this.inventions.find((i) => i.kind === 'tool' && p.what.toLowerCase().includes(i.name));
      v.items.push({ name: known ? `a ${known.name}` : p.what, day: this.day, from: null, ...(known ? { inv: known.id } : {}) });
      v.madeDay = this.day;
      this.practice(v, 'make', 3);
      this.remember(v, `I made ${p.what}. It is mine.`);
      this.addFeed('build', v, `${v.name} made ${p.what}.`);
      return this.endPlan(v);
    }

    if (p.action === 'activity') {
      v.needs.energy = clamp(v.needs.energy + 4);
      if (p.guest) {
        // they came along at someone else's asking
        const host = this.byId(p.guest);
        v.needs.social = clamp(v.needs.social + 22);
        if (host) this.remember(v, `${host.name} asked me along, and we spent a while together: ${p.what.replace(/^with \w+, /, '').replace(/, with \w+$/, '')}.`);
        return this.endPlan(v);
      }
      const buddy = p.with ? this.byId(p.with) : null;
      if (buddy) {
        const named = new RegExp(`\\b${buddy.name}\\b`, 'i').test(p.what);
        this.changeAffinity(v, buddy, 5);
        v.needs.social = clamp(v.needs.social + 22);
        this.remember(v, `I spent a while ${p.what}${named ? '' : `, with ${buddy.name}`}.`);
        if (buddy.stage === 'child') {
          // what a child is shown stays with them
          if (!buddy.lessons) buddy.lessons = [];
          buddy.lessons.push(`${v.name} spent time with ${buddy.gender === 'm' ? 'him' : 'her'} ${p.what}`.slice(0, 110));
          if (buddy.lessons.length > 8) buddy.lessons.shift();
          buddy.affinity[v.id] = clamp((buddy.affinity[v.id] ?? 55) + 6);
        }
        return this.endPlan(v);
      }
      const company = this.villagers.some((o) => o !== v && !o.sleeping && Math.hypot(o.x - v.x, o.y - v.y) < 3.5);
      v.needs.social = clamp(v.needs.social + (company ? 14 : 3));
      this.lift(v, 0, 3); // time spent on something of their own choosing
      this.remember(v, `I spent a while ${p.what}.`);
      return this.endPlan(v);
    }

    if (p.action === 'eat') {
      v.inv.food -= 1;
      v.needs.hunger = clamp(v.needs.hunger + 35);
      this.remember(v, 'I ate.');
      return this.endPlan(v);
    }

    this.endPlan(v);
  }

  completeStructure(v, s) {
    s.p = 1;
    this.pathFailDay = 0;
    const def = STRUCT[s.type];
    const shown = this.typeName(s.type);
    const a = /^[aeiou]/.test(shown) ? 'an' : 'a';
    const named = s.label ? ` and called it "${s.label}"` : '';
    if (FOOD_SOURCES[s.type]) { s.ripe = false; s.regrowAt = this.dayFloat() + 0.35; }
    if (FOOD_SOURCES[s.type] && FOOD_SOURCES[s.type].animal) this.stockPen(v, s);
    if (def.home) {
      const old = this.structById(v.home);
      const upgrade = !old || old.owner !== v.id || (old.type === 'shelter' && s.type === 'house');
      if (upgrade) {
        const movers = [v, this.byId(v.partner), ...this.childrenOf(v).filter((c) => c.stage === 'child')].filter(Boolean);
        for (const m of movers) m.home = s.id;
        // The old lean-to comes down once nobody lives in it.
        if (old && old.type === 'shelter' && !this.villagers.some((o) => o.home === old.id)) this.structures = this.structures.filter((x) => x !== old);
        const partner = this.byId(v.partner);
        if (partner) this.remember(partner, `${v.name} built us ${a} ${s.type} to live in.`);
      }
    }
    this.remember(v, `I built ${a} ${shown}${named}.`);
    this.addFeed('build', v, `${v.name} built ${a} ${shown}${named}.`);
    if (def.custom || ['campfire', 'shelter', 'house', 'farm', 'well', 'workshop', 'statue', 'market', 'chapel', 'coop', 'pen', 'storehouse'].includes(s.type)) {
      const first = this.count(s.type) === 1;
      this.addChronicle('event', null, `${v.name} built ${first ? 'the first' : a} ${shown}${named}.`);
    }
  }

  checkDiscoveries(by) {
    for (const d of DISCOVERIES) {
      if (this.knows(d.id) || !d.test(this)) continue;
      this.discoveries.push(d.id);
      const who = by ? by.name : 'The family';
      const gain = d.note || `Now we can build: ${d.unlocks.join(' and ')}.`;
      for (const v of this.adults()) this.remember(v, v === by ? `I worked out ${d.name}! ${gain}` : `${who} worked out ${d.name}. ${gain}`);
      this.addFeed('discovery', by, `${who} discovered ${d.name}. ${gain}`);
      this.addChronicle('discovery', null, `${who} discovered ${d.name}.`);
      this.worldVersion++;
    }
  }

  // ---------- animals ----------

  addAnimal(kind, x, y, pen = null, opts = {}) {
    const a = { id: this.nextId++, kind, x: x + 0.5, y: y + 0.5, dir: 1, path: [], idle: Math.random() * 5, pen, herd: !!pen, scared: 0 };
    const wl = WILDLIFE[kind];
    if (wl) {
      // whichever sex there are fewer of, so a newcomer is never a third lonely male
      const same = this.animals.filter((o) => o.kind === kind && !!o.pen === !!pen);
      const males = same.filter((o) => o.sex === 'm').length;
      a.sex = opts.sex || (males * 2 < same.length ? 'm' : males * 2 > same.length ? 'f' : Math.random() < 0.5 ? 'm' : 'f');
      a.born = opts.born ?? this.day - wl.grown - Math.floor(Math.random() * wl.life * 0.4);
      a.life = Math.round(wl.life * (0.8 + Math.random() * 0.4));
    }
    this.animals.push(a);
    return a;
  }

  wildSpot(edgeOnly) {
    for (let i = 0; i < 200; i++) {
      const x = 1 + Math.floor(Math.random() * (W - 2)), y = 1 + Math.floor(Math.random() * (H - 2));
      if (!this.walkable(x, y) || this.structGrid[idx(x, y)] || this.paths.has(idx(x, y))) continue;
      if (edgeOnly ? Math.min(x, y, W - 1 - x, H - 1 - y) > 3 : Math.hypot(x - this.spawn.x, y - this.spawn.y) < 7) continue;
      return [x, y];
    }
    return null;
  }

  seedWildlife() {
    for (const [kind, def] of Object.entries(ANIMALS)) {
      if (!WILDLIFE[kind]) continue;
      const want = Math.round(this.wildCap(kind) * 0.6);
      for (let i = this.wildCount(kind); i < want; i++) { const t = this.wildSpot(false) || this.wildSpot(true); if (t) this.addAnimal(kind, t[0], t[1], null, { sex: i % 2 ? 'm' : 'f' }); }
    }
    this.fish = this.fishCap();
  }

  // When a coop or pen is finished, the builder herds nearby wild animals into it.
  stockPen(v, s) {
    const kind = FOOD_SOURCES[s.type].animal;
    const cx = s.x + 1, cy = s.y + 1;
    // only what is really out there can be herded in: a male and a female if there is one of each
    const near = this.animals.filter((a) => a.kind === kind && !a.pen).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const first = near[0], second = first ? near.find((a) => a !== first && a.sex !== first.sex) || near[1] : null;
    const wild = [first, second].filter(Boolean);
    for (const a of wild) { a.pen = s.id; a.herd = true; a.path = []; }
    const name = kind === 'sheep' ? 'sheep' : 'chickens';
    if (!wild.length) {
      this.remember(v, `The ${s.type} is built, but there are no wild ${name} left in the valley to put in it.`);
      this.addFeed('event', v, `${v.name}'s new ${s.type} stands empty. There are no wild ${name} left to herd into it.`);
      return;
    }
    const n = wild.length === 1 ? 'one' : 'two';
    this.remember(v, `I herded ${n} ${name} into the new ${s.type}.${wild.length === 1 ? ' One alone will not breed.' : ''}`);
    this.addFeed('event', v, `${v.name} herded ${n} ${name} into the new ${s.type}.`);
  }

  stepAnimal(a, dt, speed) {
    if (!a.path.length) return true;
    const [tx, ty] = a.path[0];
    const dx = tx + 0.5 - a.x, dy = ty + 0.5 - a.y, d = Math.hypot(dx, dy), sp = speed * dt;
    if (Math.abs(dx) > 0.05) a.dir = dx < 0 ? -1 : 1;
    if (d <= sp) { a.x = tx + 0.5; a.y = ty + 0.5; a.path.shift(); }
    else { a.x += (dx / d) * sp; a.y += (dy / d) * sp; }
    return a.path.length === 0;
  }

  updateAnimal(a, dt) {
    if (a.kind === 'wolf') return this.updateWolf(a, dt);
    const def = ANIMALS[a.kind];
    const tile = [Math.floor(a.x), Math.floor(a.y)];

    if (a.pen) {
      const s = this.structById(a.pen);
      if (!s) { a.pen = null; a.herd = false; return; }
      const inside = (x, y) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
      if (a.herd) {
        if (inside(tile[0], tile[1])) { a.herd = false; a.path = []; return; }
        if (!a.path.length) {
          a.path = this.bfs(tile[0], tile[1], inside) || [];
          if (!a.path.length) { a.x = s.x + 1; a.y = s.y + 1; a.herd = false; return; }
        }
        this.stepAnimal(a, dt, def.speed * 1.6);
        return;
      }
      // potter about inside the fence
      if (a.goal) {
        const dx = a.goal[0] - a.x, dy = a.goal[1] - a.y, d = Math.hypot(dx, dy), sp = def.speed * 0.5 * dt;
        if (Math.abs(dx) > 0.05) a.dir = dx < 0 ? -1 : 1;
        if (d <= sp) { a.goal = null; a.idle = 1 + Math.random() * 5; }
        else { a.x += (dx / d) * sp; a.y += (dy / d) * sp; }
        return;
      }
      a.idle -= dt;
      if (a.idle <= 0) a.goal = [s.x + 0.35 + Math.random() * (s.w - 0.7), s.y + 0.45 + Math.random() * (s.h - 0.7)];
      return;
    }

    // wild
    if (a.scared > 0) a.scared -= dt;
    if (def.flee && a.scared <= 0) {
      // a hunter creeping up is not noticed until the spear is in the air
      const near = this.villagers.find((v) => !v.inside && v.id !== a.hunter && Math.hypot(v.x - a.x, v.y - a.y) < 2.6)
        || this.wolves().find((w) => Math.hypot(w.x - a.x, w.y - a.y) < 4);
      if (near) this.spook(a, near);
    }
    if (a.path.length) {
      const [nx, ny] = a.path[0];
      if (!this.walkable(nx, ny)) { a.path = []; return; }
      this.stepAnimal(a, dt, def.speed * (a.scared > 0 ? 1.7 : 1));
      return;
    }
    a.idle -= dt;
    if (a.idle > 0) return;
    a.idle = 2 + Math.random() * 7;
    const tx = tile[0] + Math.floor(Math.random() * (def.roam * 2 + 1)) - def.roam, ty = tile[1] + Math.floor(Math.random() * (def.roam * 2 + 1)) - def.roam;
    if (!this.walkable(tx, ty) || this.structGrid[idx(tx, ty)] || this.paths.has(idx(tx, ty))) return;
    const p = this.bfs(tile[0], tile[1], (x, y) => x === tx && y === ty);
    if (p && p.length <= def.roam * 2 + 2) a.path = p;
  }

  spook(a, from) {
    const tile = [Math.floor(a.x), Math.floor(a.y)];
    const ang = Math.atan2(a.y - from.y, a.x - from.x) + (Math.random() - 0.5);
    for (let r = 6; r >= 3; r--) {
      const tx = Math.round(a.x + Math.cos(ang) * r), ty = Math.round(a.y + Math.sin(ang) * r);
      if (!this.walkable(tx, ty)) continue;
      const p = this.bfs(tile[0], tile[1], (x, y) => x === tx && y === ty);
      if (p && p.length < 14) { a.path = p; a.scared = 2.5; return; }
    }
  }

  // ---------- wolves ----------

  // In winter every home burns wood through the night. No wood, no warmth.
  burnFirewood() {
    for (const h of this.structures) {
      if (!STRUCT[h.type].home || h.p < 1) continue;
      const people = this.here().filter((v) => v.home === h.id);
      if (!people.length) { h.warm = false; continue; }
      let need = (this.effectLevel('warmth') > 0 ? 1 : 2) + (['bitter', 'blizzard'].includes(this.weatherNow()) ? 1 : 0);
      const fromStore = Math.min(need, this.stored('wood'));
      this.store.wood -= fromStore;
      need -= fromStore;
      for (const p of people) { const take = Math.min(need, p.inv.wood); p.inv.wood -= take; need -= take; }
      h.warm = need <= 0;
      if (!h.warm) {
        for (const p of people) if (p.stage === 'adult') this.remember(p, 'There was no firewood tonight. The house is freezing.');
        this.addFeed('event', null, `No firewood tonight at the ${h.type} where ${people.map((p) => p.name).slice(0, 3).join(', ')} sleep${people.length === 1 ? 's' : ''}.`);
      }
    }
    this.worldVersion++;
  }

  onNight() {
    if (!this.ended) this.nightTogether();
    if (this.isWinter() && !this.ended) this.burnFirewood();
    if (this.cfg.wolves === false || this.day < 4 || this.ended) return;
    const winter = this.isWinter();
    const blizzard = this.weatherNow() === 'blizzard';
    if (blizzard) {
      let lost = 0;
      for (const a of this.animals) if (a.pen && Math.random() < 0.15) { a.gone = true; lost++; }
      if (lost) this.addFeed('event', null, `${lost} of the animals froze in the night.`);
    }
    const herds = Object.keys(WILDLIFE).reduce((n, k) => n + this.wildCount(k), 0), room = Object.keys(WILDLIFE).reduce((n, k) => n + this.wildCap(k), 0);
    const hungry = herds < room * 0.3 ? 1.3 : 1; // with little left to hunt, wolves turn to the village
    if (Math.random() > (blizzard ? 1 : winter ? 0.85 : 0.45) * hungry * (1 - 0.25 * this.effectLevel('safety'))) return;
    const n = 1 + Math.floor(Math.random() * (winter ? 3 : 2));
    for (let i = 0; i < n; i++) {
      const t = this.wildSpot(true);
      if (t && !this.lit(t[0], t[1])) { const w = this.addAnimal('wolf', t[0], t[1]); w.think = 0; }
    }
    if (this.wolves().length) this.addFeed('event', null, n > 1 ? 'Wolves are howling at the edge of the wild.' : 'A wolf is howling at the edge of the wild.');
    // wolves hunt the wild herds before they bother with people
    if (this.wolves().length && Math.random() < 0.18) {
      const prey = this.animals.filter((a) => WILDLIFE[a.kind] && !a.pen && !a.gone);
      if (prey.length) pick(prey).gone = true;
    }
  }

  wolfLeaves(a) {
    const tile = [Math.floor(a.x), Math.floor(a.y)];
    a.fleeing = true;
    a.path = this.bfs(tile[0], tile[1], (x, y) => Math.min(x, y, W - 1 - x, H - 1 - y) <= 0) || [];
    if (!a.path.length) a.gone = true;
  }

  updateWolf(a, dt) {
    const dark = (x, y) => !this.lit(x, y);
    const tile = [Math.floor(a.x), Math.floor(a.y)];
    if (a.fleeing) {
      if (this.stepAnimal(a, dt, 4.4)) a.gone = true;
      return;
    }
    // two people awake and close is too much trouble
    const awake = this.villagers.filter((v) => v.stage === 'adult' && !v.sleeping && !v.inside && Math.hypot(v.x - a.x, v.y - a.y) < 4);
    if (awake.length >= 2) return this.wolfLeaves(a);

    a.think -= dt;
    if (a.think <= 0) {
      a.think = 1.5;
      const prey = [];
      for (const o of this.animals) if (o.kind === 'sheep' || o.kind === 'chicken' || o.kind === 'rabbit') prey.push({ o, x: o.x, y: o.y, w: o.pen ? 0 : 3 });
      for (const v of this.villagers) if (!v.inside) prey.push({ v, x: v.x, y: v.y, w: v.sleeping || v.stage === 'child' ? 1 : 6 });
      const open = prey.filter((p) => dark(Math.floor(p.x), Math.floor(p.y))).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) + p.w - (Math.hypot(q.x - a.x, q.y - a.y) + q.w));
      a.target = null;
      for (const p of open.slice(0, 4)) {
        const tx = Math.floor(p.x), ty = Math.floor(p.y);
        const path = this.bfs(tile[0], tile[1], (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= 1, dark);
        if (path) { a.path = path; a.target = p.o ? { animal: p.o.id } : { person: p.v.id }; break; }
      }
      if (!a.target && !a.path.length) {
        const tx = tile[0] + Math.floor(Math.random() * 11) - 5, ty = tile[1] + Math.floor(Math.random() * 11) - 5;
        if (this.walkable(tx, ty) && dark(tx, ty)) a.path = this.bfs(tile[0], tile[1], (x, y) => x === tx && y === ty, dark) || [];
      }
    }
    if (a.path.length) {
      const [nx, ny] = a.path[0];
      if (!this.walkable(nx, ny) || !dark(nx, ny)) a.path = [];
      else this.stepAnimal(a, dt, ANIMALS.wolf.speed);
    }
    if (!a.target) return;
    if (a.target.animal) {
      const o = this.animals.find((x) => x.id === a.target.animal);
      if (!o) { a.target = null; return; }
      if (Math.hypot(o.x - a.x, o.y - a.y) < 1.5) {
        this.animals = this.animals.filter((x) => x !== o);
        if (o.pen) {
          const s = this.structById(o.pen);
          this.addFeed('event', null, `A wolf took a ${o.kind} from the ${s ? s.type : 'pen'} in the night.`);
          const owner = s ? this.byId(s.owner) : null;
          if (owner) this.remember(owner, `A wolf took one of my ${o.kind === 'sheep' ? 'sheep' : 'chickens'} in the night.`);
        }
        this.wolfLeaves(a);
      }
    } else {
      const v = this.byId(a.target.person);
      if (!v || v.inside) { a.target = null; return; }
      if (Math.hypot(v.x - a.x, v.y - a.y) < 1.5) {
        v.health = clamp(v.health - (v.stage === 'child' ? 45 : 32));
        v.lastHurt = 'a wolf attack';
        if (v.stage === 'adult' && v.sleeping) { v.sleeping = false; this.endPlan(v); }
        this.remember(v, 'A wolf attacked me in the dark.');
        this.addFeed('death', v, `A wolf attacked ${v.name}.`);
        for (const o of this.adults()) if (o !== v && (o.partner === v.id || v.parents.includes(o.id))) this.remember(o, `A wolf attacked ${v.name} in the night.`);
        if (v.health <= 0) this.die(v, 'a wolf attack');
        this.wolfLeaves(a);
      }
    }
  }

  animalsAtDawn() {
    // wolves slink off with the light
    this.animals = this.animals.filter((a) => a.kind !== 'wolf');
    this.wildlifeAtDawn();
    this.fishAtDawn();
  }

  // A kind with animals to spare: enough that taking one leaves the herd able to breed.
  spareGame() { const k = Object.keys(WILDLIFE).filter((x) => this.wildCount(x) >= 4).sort((a, b) => this.wildCount(b) - this.wildCount(a))[0]; return k || null; }
  anyGame() { const k = Object.keys(WILDLIFE).filter((x) => this.wildCount(x) >= 1).sort((a, b) => this.wildCount(b) - this.wildCount(a))[0]; return k || null; }
  // How many of a wild kind the land can feed.
  wildCap(kind) { return Math.round(ANIMALS[kind].wild * 3.2 * Math.min(4, this.landScale())); }
  wildCount(kind) { return this.animals.filter((a) => a.kind === kind && !a.pen && !a.gone).length; }
  isYoung(a) { const wl = WILDLIFE[a.kind]; return !!wl && a.born != null && this.day - a.born < wl.grown; }
  // What is out there, in words, for anyone thinking about hunting.
  wildWords() {
    return Object.keys(WILDLIFE).map((k) => { const n = this.wildCount(k); const name = k === 'sheep' ? 'wild sheep' : k === 'chicken' ? `wild chicken${n === 1 ? '' : 's'}` : k === 'deer' ? 'deer' : `rabbit${n === 1 ? '' : 's'}`; return n ? `${n} ${name}` : `no ${k === 'sheep' ? 'wild sheep' : k === 'chicken' ? 'wild chickens' : k === 'deer' ? 'deer' : 'rabbits'}`; }).join(', ');
  }

  // Wild herds and penned flocks live real lives: they are born from the ones alive, they grow old, they starve in a
  // hard winter or a drought, and a kind that is hunted out is gone until a few drift in from far away, years later.
  wildlifeAtDawn() {
    // The first morning under these rules, the herds are set to the size the land would really carry.
    if (!this.ecoModel) { this.ecoModel = 1; for (const a of this.animals) if (WILDLIFE[a.kind] && a.sex == null) { const wl = WILDLIFE[a.kind]; a.sex = Math.random() < 0.5 ? 'm' : 'f'; a.born = this.day - wl.grown - Math.floor(Math.random() * wl.life * 0.5); a.life = Math.round(wl.life * (0.8 + Math.random() * 0.4)); } this.seedWildlife(); return; }
    const season = this.season(), sky = this.weatherNow();
    const drought = !!this.disaster && this.disaster.kind === 'drought';
    if (!this.goneKinds) this.goneKinds = {};
    for (const [kind, wl] of Object.entries(WILDLIFE)) {
      const all = this.animals.filter((a) => a.kind === kind && !a.gone);
      for (const a of all) { if (a.sex == null) { a.sex = Math.random() < 0.5 ? 'm' : 'f'; a.born = this.day - wl.grown - Math.floor(Math.random() * wl.life * 0.5); a.life = Math.round(wl.life * (0.8 + Math.random() * 0.4)); } }
      const wild = all.filter((a) => !a.pen), cap = this.wildCap(kind);
      // death: age, hunger and cold
      for (const a of all) {
        let p = this.day - a.born >= a.life ? 0.4 : 0;
        if (!a.pen) {
          if (season === 'winter') p += sky === 'blizzard' ? 0.09 : sky === 'bitter' ? 0.04 : 0.012;
          if (drought && wl.grazer) p += 0.07;
          if (wild.length > cap) p += 0.07; // more mouths than the land can feed
        } else if (drought && wl.grazer) p += 0.03;
        if (Math.random() < p) a.gone = true;
      }
      const left = wild.filter((a) => !a.gone);
      // birth: from grown females, if there is a grown male, in the right season, and less readily as the land fills
      if (!drought) {
        const lean = season === 'winter' ? 0.4 : 1;
        const grown = left.filter((a) => !this.isYoung(a));
        const males = grown.some((a) => a.sex === 'm');
        const room = Math.max(0, 1 - left.length / cap);
        if (males) for (const f of grown.filter((a) => a.sex === 'f')) {
          if (Math.random() > wl.breed * lean * (0.25 + 0.75 * room)) continue;
          const n = wl.litter > 1 && Math.random() < 0.5 ? 2 : 1;
          for (let i = 0; i < n; i++) { const b = this.addAnimal(kind, Math.floor(f.x), Math.floor(f.y), null, { born: this.day }); b.x = f.x; b.y = f.y; }
        }
      }
      // gone from the valley, and the long wait for a few to wander back
      const now = this.wildCount(kind);
      const name = kind === 'sheep' ? 'wild sheep' : kind === 'chicken' ? 'wild chickens' : kind === 'deer' ? 'deer' : 'rabbits';
      if (now === 0 && !this.goneKinds[kind]) {
        this.goneKinds[kind] = this.day;
        const line = `The last of the ${name} are gone from the valley.`;
        this.addFeed('event', null, line); this.addChronicle('event', null, line);
        for (const v of this.adults()) if (!v.away) this.remember(v, `There are no ${name} left in the valley. Nobody has seen one.`);
      }
      // The valley is not sealed off. Animals drift in from the country around it: slowly, and less as it fills.
      // A kind that has been wiped out takes years to show itself again, and longer to become a herd.
      if (Math.random() < 0.09 * Math.max(0, 1 - now / (cap * 0.6))) {
        const here = this.animals.filter((a) => a.kind === kind && !a.pen && !a.gone);
        const males = here.filter((a) => a.sex === 'm').length;
        const t = this.wildSpot(true);
        if (t) this.addAnimal(kind, t[0], t[1], null, { sex: males * 2 > here.length ? 'f' : males * 2 < here.length ? 'm' : Math.random() < 0.5 ? 'm' : 'f' });
        if (now === 0 && this.goneKinds[kind]) {
          const since = this.day - this.goneKinds[kind];
          const line = `${name[0].toUpperCase() + name.slice(1)} have been seen in the valley again${since > 1 ? `, ${since} years after the last one` : ''}.`;
          this.addFeed('event', null, line); this.addChronicle('event', null, line);
        }
      }
      if (this.wildCount(kind) > 0) delete this.goneKinds[kind];
    }
    // penned flocks: young come only from a pair, in season, and a pen holds four
    for (const s of this.structures) {
      const src = FOOD_SOURCES[s.type];
      if (!src || !src.animal || s.p < 1) continue;
      const wl = WILDLIFE[src.animal];
      const flock = this.animals.filter((a) => a.pen === s.id && !a.gone);
      const grown = flock.filter((a) => !this.isYoung(a));
      const pair = grown.some((a) => a.sex === 'm') && grown.some((a) => a.sex === 'f');
      const kept = this.effectLevel('herding');
      if (pair && flock.length < 4 + Math.min(2, kept) && Math.random() < Math.min(0.9, (season === 'winter' ? 0.15 : 0.5) * (1 + 0.25 * kept))) {
        const a = this.addAnimal(src.animal, s.x, s.y, s.id, { born: this.day });
        a.herd = false;
        this.addFeed('event', null, src.animal === 'sheep' ? 'A lamb was born in the sheep pen.' : 'A chick hatched in the coop.');
      }
    }
    // a pen that has emptied gets restocked from the wild by whoever keeps it, if the wild has animals to spare
    for (const s of this.structures) {
      const src = FOOD_SOURCES[s.type];
      if (!src || !src.animal || s.p < 1) continue;
      const flock = this.animals.filter((a) => a.pen === s.id && !a.gone);
      if (flock.length >= 2 || this.wildCount(src.animal) < 3 || Math.random() > 0.35) continue;
      const keeper = this.byId(s.owner) || this.adults().find((v) => !v.away);
      if (!keeper || keeper.away) continue;
      const need = flock.length === 1 ? (flock[0].sex === 'm' ? 'f' : 'm') : null;
      const wild = this.animals.filter((a) => a.kind === src.animal && !a.pen && !a.gone && !this.isYoung(a));
      const a = wild.find((x) => !need || x.sex === need) || wild[0];
      if (!a) continue;
      a.pen = s.id; a.herd = true; a.path = [];
      const name = src.animal === 'sheep' ? 'a wild sheep' : 'a wild chicken';
      this.remember(keeper, `I drove ${name} into the ${s.type}.`);
      this.addFeed('event', keeper, `${keeper.name} drove ${name} into the ${s.type}.`);
    }
    this.animals = this.animals.filter((a) => !a.gone);
  }

  // The pond holds only so many fish, and they come back only as fast as fish breed.
  fishCap() { let w = 0; for (let i = 0; i < W * H; i++) if (this.ground[i] === WATER) w++; return Math.max(12, Math.round(w * 0.8 * (this.disaster && this.disaster.kind === 'drought' ? 0.6 : 1))); }
  fishShare() { return Math.max(0, Math.min(1, (this.fish ?? this.fishCap()) / this.fishCap())); }
  fishAtDawn() {
    const cap = this.fishCap();
    if (this.fish == null) this.fish = cap;
    const r = this.isWinter() ? 0.12 : 0.4;
    this.fish = Math.min(cap, this.fish + r * this.fish * (1 - this.fish / cap) + (this.fish < 4 ? 1 : 0)); // a few always come down the streams
    if (this.fish > cap) this.fish = cap;
    const low = this.fishShare() < 0.2;
    if (low && !this.fishedOut) { this.fishedOut = true; const line = 'The pond is nearly fished out.'; this.addFeed('event', null, line); this.addChronicle('event', null, line); for (const v of this.adults()) if (!v.away) this.remember(v, 'The pond is nearly fished out. There is almost nothing left to catch.'); }
    if (!low && this.fishShare() > 0.5) this.fishedOut = false;
  }

  // ---------- the land grows with the family ----------

  // How much bigger the land is than the valley they started in. Forests and herds are sized to match.
  landScale() { return (W * H) / (START_W * START_H); }

  // Does the family need more room? Either there are too many people for the land, or too much of it is built on.
  crowded() {
    if (this.cfg.growLand === false || W >= 124) return false;
    let grass = 0, built = this.paths.size;
    for (let i = 0; i < W * H; i++) if (this.ground[i] === GRASS) grass++;
    for (const s of this.structures) built += s.w * s.h;
    return this.villagers.length * 85 > W * H || built > grass * 0.24;
  }

  // Add a band of new land on every side. Everything already here keeps its place; only the numbers that say where it is move.
  growLand(g = 5) {
    const oldW = W, oldH = H, nW = oldW + 2 * g, nH = oldH + 2 * g;
    const old = this.ground;
    const pathTiles = [...this.paths].map((i) => [i % oldW, Math.floor(i / oldW)]);
    setSize(nW, nH);
    if (!this.origin) this.origin = { x: 0, y: 0 };
    this.origin.x += g; this.origin.y += g;
    const { elev, forest, stone } = terrain(this.cfg.seed);
    const ground = new Array(nW * nH).fill(GRASS);
    const objects = {};
    for (const o of Object.values(this.objects)) { o.x += g; o.y += g; objects[key(o.x, o.y)] = o; }
    for (let y = 0; y < nH; y++) for (let x = 0; x < nW; x++) {
      const ox = x - g, oy = y - g;
      if (ox >= 0 && oy >= 0 && ox < oldW && oy < oldH) { ground[idx(x, y)] = old[oy * oldW + ox]; continue; }
      // new land, read from the same noise at its place in the wider world
      const wx = x - this.origin.x, wy = y - this.origin.y;
      const e = elev(wx / 9, wy / 9);
      if (e < WATER_LEVEL) { ground[idx(x, y)] = WATER; continue; }
      if (e < WATER_LEVEL + 0.035) { ground[idx(x, y)] = SAND; continue; }
      const edge = Math.min(x, y, nW - 1 - x, nH - 1 - y);
      const f = forest(wx / 6, wy / 6) + (edge < 2 ? 0.1 : 0), st = stone(wx / 5, wy / 5), r = Math.random();
      if (f > 0.6 && r < 0.42) objects[key(x, y)] = { kind: 'tree', x, y, v: Math.floor(Math.random() * 3) };
      else if (st > 0.66 && r < 0.4) objects[key(x, y)] = { kind: 'rock', x, y, left: 6, ore: oreIn(Math.random, true) };
      else if (r < 0.012) objects[key(x, y)] = { kind: 'rock', x, y, left: 6, ore: oreIn(Math.random, false) };
      else if (r < 0.03) objects[key(x, y)] = { kind: 'bush', x, y, ripe: !this.isWinter(), regrowAt: 0 };
    }
    this.ground = ground;
    this.objects = objects;
    this.paths = new Set(pathTiles.map(([x, y]) => idx(x + g, y + g)));
    for (const s of this.structures) { s.x += g; s.y += g; }
    this.spawn = { x: this.spawn.x + g, y: this.spawn.y + g };
    const shift = (list) => (list || []).map(([x, y]) => [x + g, y + g]);
    const rekey = (k) => { const [x, y] = String(k).split(',').map(Number); return key(x + g, y + g); };
    for (const v of this.villagers) {
      v.x += g; v.y += g;
      v.path = shift(v.path);
      const p = v.plan;
      if (p && p.objKey) p.objKey = rekey(p.objKey);
      if (p && p.pathTiles) p.pathTiles = shift(p.pathTiles);
    }
    for (const a of this.animals) { a.x += g; a.y += g; a.path = shift(a.path); if (a.goal) a.goal = [a.goal[0] + g, a.goal[1] + g]; }
    const moved = (map, f) => { const out = {}; for (const [k, val] of Object.entries(map || {})) out[rekey(k)] = f ? f(val) : val; return out; };
    this.fires = moved(this.fires, (f) => ({ ...f, x: f.x + g, y: f.y + g }));
    this.scorched = moved(this.scorched);
    this.waterDist = null;
    this.changed();
    const first = oldW === START_W;
    const line = first ? 'The family has outgrown the valley it started in. People are pushing out past its old edges, and there is new land on every side.' : 'The settled land has spread again. There is new country past the old edges on every side.';
    this.addFeed('discovery', null, line);
    this.addChronicle('event', null, line);
    for (const v of this.adults()) if (!v.away) this.remember(v, 'There is new land now, out past the old edges of the valley: more forest, more stone, more water.');
    this.wantSave = true;
  }

  // ---------- weather, disasters, and the ways a life gets cut short ----------

  // What the sky is doing right now. A storm only rages for part of its day; the rest is rain.
  weatherNow() {
    const w = this.weather;
    if (!w || this.cfg.weather === false) return this.isWinter() ? 'cold' : 'clear';
    if (w.kind === 'storm' && (this.time < w.from || this.time > w.to)) return 'rain';
    return w.kind;
  }
  weatherWord(kind = this.weatherNow()) { return WEATHER[kind] || 'clear skies'; }
  // Is it dangerous simply to be out of doors?
  dangerOutside() { const k = this.weatherNow(); return k === 'storm' || k === 'blizzard'; }
  dry() { return (this.disaster && this.disaster.kind === 'drought') || (this.rainless || 0) >= 4; }

  rollWeather() {
    const s = this.season(), d = this.disaster;
    const table = {
      spring: [['clear', 42], ['rain', 30], ['fog', 14], ['storm', 14]],
      summer: [['clear', 46], ['hot', 22], ['rain', 15], ['storm', 17]],
      autumn: [['clear', 38], ['rain', 28], ['fog', 18], ['storm', 16]],
      winter: [['cold', 42], ['snow', 38], ['bitter', 20]],
    }[s];
    let roll = Math.random() * table.reduce((n, t) => n + t[1], 0), kind = table[0][0];
    for (const [k, wgt] of table) { if (roll < wgt) { kind = k; break; } roll -= wgt; }
    if (d && d.kind === 'drought') kind = s === 'summer' && Math.random() < 0.6 ? 'hot' : 'clear';
    if (d && d.kind === 'blizzard') kind = 'blizzard';
    if (d && d.kind === 'flood') kind = 'rain';
    const from = 0.2 + Math.random() * 0.4;
    this.weather = { kind, day: this.day, from, to: from + 0.22 + Math.random() * 0.2, wind: false };
    const wet = ['rain', 'storm', 'snow', 'blizzard'].includes(kind);
    this.rainless = wet ? 0 : (this.rainless || 0) + 1;
    if (kind === 'rain' || kind === 'storm') {
      // rain brings the crops and the bushes on
      for (const o of Object.values(this.objects)) if (o.kind === 'bush' && !o.ripe) o.regrowAt -= 0.3;
      for (const st of this.structures) if ((st.type === 'farm' || st.type === 'garden') && !st.ripe && st.regrowAt) st.regrowAt -= 0.3;
    }
    if (kind !== 'clear' && kind !== 'cold') this.addFeed('event', null, { rain: 'It is raining.', storm: 'The sky is heavy. A storm is coming today.', fog: 'Fog lies thick over the valley.', hot: 'The day is fiercely hot.', snow: 'Snow is falling.', bitter: 'The cold today is the kind that kills.', blizzard: 'The blizzard is still blowing.' }[kind]);
  }

  // How far each tile is from open water, for floods.
  waterDistance(x, y) {
    if (!this.waterDist) {
      const d = new Int16Array(W * H).fill(999), q = [];
      for (let i = 0; i < W * H; i++) if (this.ground[i] === WATER) { d[i] = 0; q.push(i); }
      for (let h = 0; h < q.length; h++) {
        const i = q[h], cx = i % W, cy = Math.floor(i / W);
        for (const [nx, ny] of neighbors4(cx, cy)) { if (!inBounds(nx, ny)) continue; const j = idx(nx, ny); if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); } }
      }
      this.waterDist = d;
    }
    return inBounds(x, y) ? this.waterDist[idx(x, y)] : 999;
  }

  // Hurt someone. Returns true if it killed them.
  hurt(v, amount, cause, mine, line) {
    if (!this.villagers.includes(v) || v.away) return false;
    v.health = clamp(v.health - amount);
    v.lastHurt = cause;
    if (line) this.addFeed('event', v, line);
    if (v.health <= 0) { this.die(v, cause); return true; }
    if (mine && v.stage === 'adult') this.remember(v, mine);
    // a bad wound can turn
    if (amount >= 25 && !v.sick && Math.random() < 0.22) {
      v.sick = { name: 'a festering wound', until: this.day + 3 + Math.floor(Math.random() * 3), harsh: true, tended: 0 };
      this.addFeed('event', v, `${v.name}'s wound has gone bad.`);
      if (v.stage === 'adult') this.remember(v, 'The wound is hot and swollen. It has gone bad.');
    }
    return false;
  }

  // Work has always had its dangers. Most days nothing happens.
  mishap(v, kind) {
    if (this.cfg.accidents === false) return false;
    const storm = this.weatherNow() === 'storm', flood = this.disaster && this.disaster.kind === 'flood';
    const odds = { wood: 0.009 * (storm ? 3 : 1), stone: 0.008, dig: 0.003, build: 0.007, fish: (storm || flood ? 0.05 : 0.004), hunt: 0.05 }[kind] || 0;
    if (Math.random() > odds * (this.isOld(v) ? 1.6 : 1) * (1 - 0.25 * this.effectLevel('safer_work', v))) return false;
    const grave = Math.random() < 0.16;
    const amount = grave ? 65 + Math.random() * 50 : 15 + Math.random() * 25;
    const [cause, mine, line] = {
      wood: ['a falling tree', 'The tree came down the wrong way and caught me.', `A falling tree caught ${v.name}.`],
      stone: ['a rockfall', 'The rock gave way and came down on me.', `Rock came down on ${v.name}.`],
      build: ['a fall', 'I fell from where I was working.', `${v.name} fell while building.`],
      fish: ['drowning', 'I went into the water and nearly did not come out.', `${v.name} went into the water.`],
      hunt: ['a stag\'s antlers', 'The animal turned on me.', `The animal turned on ${v.name}.`],
      dig: ['a cave-in', 'The bank came down on me while I was digging.', `The bank gave way on ${v.name}.`],
    }[kind];
    return this.hurt(v, amount, cause, mine, grave ? `${line} It is bad.` : line) || true;
  }

  flammable(s) {
    const def = STRUCT[s.type];
    if (!def || ['campfire', 'well', 'statue', 'grave', 'path'].includes(s.type)) return 0;
    if (def.custom) return def.look && (def.look.material === 'stone' || def.look.material === 'clay') ? 0.2 : 1;
    return { house: 0.3, chapel: 0.25, storehouse: 0.35, market: 0.6, workshop: 0.5 }[s.type] || 1;
  }

  ignite(x, y) {
    if (!inBounds(x, y)) return false;
    if (!this.fires) this.fires = {};
    const k = key(x, y);
    if (this.fires[k] || (this.scorched && this.scorched[k] !== undefined)) return false;
    const o = this.objects[k], s = this.structGrid[idx(x, y)];
    const fuel = (o && (o.kind === 'tree' || o.kind === 'bush' || o.kind === 'reeds')) || (s && s.p >= 1 && this.flammable(s) > 0);
    const grass = !fuel && !o && !s && this.ground[idx(x, y)] === GRASS && !this.paths.has(idx(x, y)) && !this.isWinter() && (this.dry() || (this.disaster && this.disaster.kind === 'wildfire'));
    if (!fuel && !grass) return false;
    this.fires[k] = { x, y, left: grass ? 2 : 3 + Math.floor(Math.random() * 3), grass };
    return true;
  }

  // A building is gone: burned, washed away or blown down.
  destroyStructure(s, how) {
    if (!this.structures.includes(s)) return;
    this.structures = this.structures.filter((x) => x !== s);
    const name = this.typeName(s.type), owner = this.byId(s.owner);
    if (STRUCT[s.type].home) {
      for (const v of this.villagers) {
        if (v.home !== s.id) continue;
        v.home = null;
        if (v.inside && !v.away) { v.inside = false; v.sleeping = false; if (v.plan && v.plan.action === 'sleep') this.endPlan(v); }
        if (v.stage === 'adult') this.remember(v, `My home ${how}. I have nowhere to sleep.`);
      }
    }
    if (s.type === 'storehouse' && !this.storehouse()) {
      const lost = Math.round(this.store.food * 0.6);
      this.store.food -= lost; this.store.wood = Math.round(this.store.wood * 0.4);
      this.addFeed('event', null, `Most of what was in the storehouse was lost with it: ${lost} food gone.`);
    }
    for (const a of this.animals) if (a.pen === s.id) { a.pen = null; a.herd = false; if (Math.random() < 0.5) a.gone = true; }
    const whose = owner && (STRUCT[s.type].home || s.label) ? `${owner.name}'s ${name}` : `${/^[aeiou]/.test(name) ? 'An' : 'A'} ${name}`;
    const line = `${whose}${s.label ? ` "${s.label}"` : ''} ${how}.`;
    this.addFeed('event', null, line);
    if (STRUCT[s.type].home || ['storehouse', 'chapel', 'market', 'workshop'].includes(s.type) || STRUCT[s.type].custom) this.addChronicle('event', null, line);
    this.changed();
  }

  // Runs every few moments: lightning, wind, and fire moving through whatever will burn.
  weatherTick() {
    if (this.ended) return;
    const now = this.weatherNow();
    if (now === 'storm') {
      const w = this.weather;
      if (!w.broke) {
        w.broke = true;
        this.addFeed('event', null, 'The storm has broken. Thunder, and a hard wind.');
        for (const v of this.adults()) if (!v.away) this.remember(v, 'A storm broke over the valley.');
      }
      if (Math.random() < 0.07) this.lightning();
      if (!w.wind && Math.random() < 0.05) {
        w.wind = true;
        const farms = this.structures.filter((s) => s.type === 'farm' && s.ripe);
        if (farms.length && Math.random() < 0.6) { const f = pick(farms); f.ripe = false; f.regrowAt = this.dayFloat() + 1; this.addFeed('event', null, 'The wind flattened a field of ripe crops.'); this.worldVersion++; }
        const weak = this.structures.filter((s) => s.p >= 1 && (s.type === 'shelter' || s.type === 'lantern' || s.type === 'bench'));
        if (weak.length && Math.random() < 0.3) this.destroyStructure(pick(weak), 'was torn down by the wind');
      }
    }
    const fires = Object.values(this.fires || {});
    if (!fires.length) return;
    const raining = ['rain', 'storm', 'snow', 'blizzard'].includes(now);
    if (!this.scorched) this.scorched = {};
    const spread = (raining ? 0.02 : this.dry() || (this.disaster && this.disaster.kind === 'wildfire') ? 0.26 : 0.13) * (1 - 0.22 * this.effectLevel('fire_guard'));
    this.burned = (this.burned || 0);
    for (const f of fires) {
      f.left -= raining ? 2 : 1;
      if (!raining && this.burned < 150) {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const far = Math.max(Math.abs(dx), Math.abs(dy)) === 2;
          const x = f.x + dx, y = f.y + dy;
          if (!inBounds(x, y)) continue;
          const s = this.structGrid[idx(x, y)], o = this.objects[key(x, y)];
          const bare = !s && !o;
          if (bare && far) continue; // embers jump to trees and roofs, not to grass
          const p = spread * (far ? 0.3 : 1) * (s ? this.flammable(s) : bare ? 0.42 : 1);
          if (Math.random() < p) this.ignite(x, y);
        }
      }
      for (const v of this.villagers) {
        if (v.away) continue;
        const d = Math.hypot(v.x - (f.x + 0.5), v.y - (f.y + 0.5));
        if (d < 1.6 && !v.burnTick) { v.burnTick = true; }
      }
      if (f.left <= 0) {
        const k = key(f.x, f.y);
        delete this.fires[k];
        this.scorched[k] = this.day;
        this.burned++;
        const o = this.objects[k];
        if (o && (o.kind === 'tree' || o.kind === 'bush' || o.kind === 'reeds')) delete this.objects[k];
        const s = this.structGrid[idx(f.x, f.y)];
        if (s && this.structures.includes(s)) {
          if (s.type === 'farm' || s.type === 'garden') { s.ripe = false; s.regrowAt = this.dayFloat() + 2; }
          else this.destroyStructure(s, 'burned down');
        }
      }
    }
    for (const v of [...this.villagers]) {
      if (!v.burnTick) continue;
      v.burnTick = false;
      const first = v.burnDay !== this.day;
      v.burnDay = this.day;
      this.hurt(v, 7 + Math.random() * 6, 'the fire', first ? 'The fire reached me. I am burned.' : null, first ? `${v.name} is caught in the fire.` : null);
      if (this.villagers.includes(v)) this.flee(v);
    }
    this.changed();
    if (!Object.keys(this.fires).length) {
      const n = this.burned; this.burned = 0;
      const line = `The fire has burned itself out${raining ? ' in the rain' : ''}. ${n > 40 ? 'A great stretch of the valley is black.' : n > 12 ? 'A good piece of the forest is gone.' : 'It did not get far.'}`;
      this.addFeed('event', null, line);
      if (n > 12) this.addChronicle('event', null, line);
      if (this.disaster && this.disaster.kind === 'wildfire') this.endDisaster();
    }
  }

  fireNear(v, r) { return Object.values(this.fires || {}).some((f) => Math.hypot(v.x - (f.x + 0.5), v.y - (f.y + 0.5)) < r); }
  nearestFire(v) {
    let best = null;
    for (const f of Object.values(this.fires || {})) { const d = Math.hypot(v.x - f.x, v.y - f.y); if (!best || d < best.d) best = { d, f }; }
    return best;
  }
  // The body does not ask before it runs from fire.
  flee(v) {
    if (v.away) return;
    const [sx, sy] = this.tileOf(v);
    const safe = (x, y) => !Object.values(this.fires || {}).some((f) => Math.hypot(x - f.x, y - f.y) < 6);
    const path = this.bfs(sx, sy, safe);
    if (!path || !path.length) return;
    v.sleeping = false; v.inside = false;
    if (v.stage === 'adult') { if (v.plan) this.endPlan(v, 0); v.plan = { action: 'flee', phase: 'walk', timer: 1 }; v.thinking = false; this.dropAsk(v); }
    v.path = path.slice(0, 30);
  }

  lightning() {
    const roll = Math.random();
    const out = this.here().filter((v) => !v.inside && !v.sleeping);
    if (roll < 0.05 && out.length) {
      const v = pick(out);
      if (this.lit(Math.floor(v.x), Math.floor(v.y)) && Math.random() < 0.5) return; // close to the fire and the houses is safer than open ground
      this.addChronicle('event', null, `Lightning struck ${v.name} in the storm.`);
      this.hurt(v, 55 + Math.random() * 75, 'lightning', 'Lightning struck me. I do not know how I am alive.', `Lightning struck ${v.name}.`);
      return;
    }
    const trees = Object.values(this.objects).filter((o) => o.kind === 'tree');
    if (roll < 0.75 && trees.length) {
      const t = pick(trees);
      if (this.dry() && this.ignite(t.x, t.y)) { this.addFeed('event', null, 'Lightning struck a tree, and the dry wood caught.'); this.changed(); }
      else { delete this.objects[key(t.x, t.y)]; if (!this.scorched) this.scorched = {}; this.scorched[key(t.x, t.y)] = this.day; this.addFeed('event', null, 'Lightning split a tree at the edge of the valley.'); this.changed(); }
    }
  }

  rollDisaster() {
    if (this.cfg.disasters === false || this.ended) return;
    if (this.disaster) { if (this.day >= this.disaster.until) this.endDisaster(); return; }
    // The longer the quiet has lasted, the likelier it is to end. No valley gets forty calm years.
    const quiet = this.day - (this.lastDisasterDay || 0);
    if (this.day < 20 || quiet < 6) return; // a new family gets a few years to find its feet
    if (Math.random() > Math.min(0.3, 0.05 + 0.012 * (quiet - 6))) return;
    const options = { spring: ['flood', 'flood', 'plague'], summer: ['drought', 'drought', 'wildfire', 'plague'], autumn: ['flood', 'wildfire', 'plague'], winter: ['blizzard', 'blizzard', 'plague'] }[this.season()];
    this.startDisaster(pick(options));
  }

  startDisaster(kind) {
    const tell = (line, mine) => {
      this.addFeed('danger', null, line);
      this.addChronicle('danger', null, line);
      for (const v of this.adults()) if (!v.away) this.remember(v, mine);
    };
    this.lastDisasterDay = this.day;
    if (kind === 'drought') {
      this.disaster = { kind, since: this.day, until: this.day + 3 + Math.floor(Math.random() * 3) };
      for (const o of Object.values(this.objects)) if (o.kind === 'bush') o.ripe = false;
      tell('A drought has set in. The sky is empty and the ground is cracking. Nothing will grow until the rain comes back.', 'A drought has set in. The farms and the bushes have stopped bearing.');
    } else if (kind === 'blizzard') {
      this.disaster = { kind, since: this.day, until: this.day + 2 + Math.floor(Math.random() * 2) };
      this.weather = { kind: 'blizzard', day: this.day, from: 0, to: 1 };
      tell('A blizzard has come down on the valley. Nobody can see ten steps, and the cold is deadly.', 'A blizzard has come. It is death to be caught outside in it, and the fires eat wood twice as fast.');
    } else if (kind === 'plague') {
      const name = pick(['the red fever', 'the sweating sickness', 'the choking cough', 'the spotted sickness']);
      this.disaster = { kind, name, since: this.day, until: this.day + 4 + Math.floor(Math.random() * 3) };
      tell(`A sickness nobody has seen before is going from house to house. People are calling it ${name}.`, `A new sickness is going around: ${name}. It passes between people who are close, and it kills.`);
      const first = this.here().filter((v) => !v.sick);
      if (first.length) this.fallSick(pick(first));
    } else if (kind === 'wildfire') {
      const trees = Object.values(this.objects).filter((o) => o.kind === 'tree' && Math.hypot(o.x - this.spawn.x, o.y - this.spawn.y) > 8);
      if (!trees.length) { this.lastDisasterDay = this.day - 5; return; }
      const start = pick(trees);
      this.disaster = { kind, since: this.day, until: this.day + 2 };
      this.burned = 0;
      for (const o of trees) if (Math.hypot(o.x - start.x, o.y - start.y) < 3.5) this.ignite(o.x, o.y);
      this.ignite(start.x, start.y);
      const dx = start.x - this.spawn.x, dy = start.y - this.spawn.y;
      const where = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
      tell(`Fire. The forest to the ${where} is burning.`, `The forest to the ${where} has caught fire. Fire runs through trees, bushes and wooden walls, and stops at water, stone and bare ground.`);
      this.changed();
    } else if (kind === 'flood') {
      this.disaster = { kind, since: this.day, until: this.day + 1 + Math.floor(Math.random() * 2) };
      tell('The water is rising. The pond has burst its banks and the low ground is under water.', 'The pond has flooded. Everything near the water is under it.');
      for (const s of [...this.structures]) {
        if (s.p < 1) continue;
        const d = this.waterDistance(s.x, s.y);
        if ((s.type === 'farm' || s.type === 'garden') && d <= 4) { s.ripe = false; s.regrowAt = this.dayFloat() + 2; }
        if (['shelter', 'bench', 'lantern', 'coop', 'pen'].includes(s.type) && d <= 2 && Math.random() < 0.4) this.destroyStructure(s, 'was washed away');
      }
      const store = this.storehouse();
      if (store && this.store.food > 0) {
        const near = this.waterDistance(store.x, store.y) <= 4;
        const lost = Math.round(this.store.food * (near ? 0.35 : 0.08));
        this.store.food -= lost;
        if (lost > 0) this.addFeed('event', null, `${lost} food in the storehouse was ruined by the water.`);
      }
      for (const v of this.here()) {
        if (this.waterDistance(Math.floor(v.x), Math.floor(v.y)) > 2 || (v.inside && this.waterDistance(Math.floor(v.x), Math.floor(v.y)) > 1)) continue;
        if (Math.random() < 0.5) this.hurt(v, 25 + Math.random() * 60, 'the flood', 'The water took me off my feet. I nearly drowned.', `The flood swept ${v.name} away.`);
      }
      for (const a of this.animals) if (!a.pen && this.waterDistance(Math.floor(a.x), Math.floor(a.y)) <= 2 && Math.random() < 0.5) a.gone = true;
      this.changed();
    }
  }

  endDisaster() {
    const d = this.disaster;
    if (!d) return;
    this.disaster = null;
    this.lastDisasterDay = this.day;
    const line = { drought: 'The drought has broken. Rain at last.', blizzard: 'The blizzard has blown itself out.', plague: `${d.name ? d.name[0].toUpperCase() + d.name.slice(1) : 'The sickness'} has run its course.`, flood: 'The water has gone back down.', wildfire: '' }[d.kind];
    if (line) { this.addFeed('event', null, line); this.addChronicle('event', null, line); for (const v of this.adults()) if (!v.away) this.remember(v, line); }
    if (d.kind === 'drought') { this.rainless = 0; this.weather = { kind: 'rain', day: this.day, from: 0, to: 1 }; }
    this.changed();
  }

  // Getting under a roof and staying there until the sky is done.
  startShelter(v) {
    const home = this.structById(v.home);
    const roof = home && home.p >= 1 ? home : this.structures.find((s) => s.p >= 1 && (STRUCT[s.type].home || ['chapel', 'storehouse', 'workshop', 'market'].includes(s.type)));
    if (!roof) return { ok: false, want: 'get under a roof', why: 'there is no roof anywhere to get under' };
    if (!this.dangerOutside() && !this.wolves().length) return { ok: false, want: 'take shelter', why: 'there is nothing to shelter from right now' };
    const path = this.pathToStruct(v, roof);
    if (!path) return { ok: false, want: 'get under a roof', why: 'I could not reach it' };
    v.plan = { action: 'shelter', phase: 'walk', timer: 6, roof: roof.id };
    v.path = path;
    return { ok: true, summary: roof === home ? 'gets inside, out of the weather' : `takes shelter in the ${this.typeName(roof.type)}` };
  }

  // ---------- sickness and strife ----------

  sicknessAtDawn() {
    for (const v of this.here()) {
      if (v.sick) {
        if (this.day >= v.sick.until) {
          this.addFeed('event', v, `${v.name} has recovered from ${v.sick.name}.`);
          if (v.stage === 'adult') this.remember(v, `${v.sick.name[0].toUpperCase() + v.sick.name.slice(1)} finally left me. I feel like myself again.`);
          v.sick = null;
          v.immuneUntil = this.day + 8;
        }
        continue;
      }
      if ((v.immuneUntil || 0) > this.day) continue;
      const plague = this.disaster && this.disaster.kind === 'plague';
      let chance = this.isWinter() ? 0.04 : 0.015;
      if (plague) chance += 0.07;
      if (v.stage === 'child' && this.years(v) < 5) chance += 0.02; // the very young are easily taken
      if (v.needs.hunger < 30) chance += 0.05;
      if (v.health < 60) chance += 0.04;
      if (v.stage === 'adult' && this.isOld(v)) chance += 0.03;
      if (this.here().some((o) => o !== v && o.sick && !o.sick.slow && o.sick.name !== 'a festering wound' && o.home && o.home === v.home)) chance += plague ? 0.4 : 0.25;
      if (v.exposed) chance += 0.12;
      v.exposed = false;
      if (Math.random() < chance) { this.fallSick(v); continue; }
      // a sickness that is nobody's fault and passes to nobody: it comes on in the middle of life and takes a long time
      if (v.stage === 'adult' && this.years(v) >= 38 && Math.random() < 0.0035) {
        v.sick = { name: 'a wasting sickness', until: this.day + 6 + Math.floor(Math.random() * 4), harsh: true, slow: true, tended: 0 };
        this.addFeed('event', v, `${v.name} has a wasting sickness. It will be a long one.`);
        this.remember(v, 'Something is wrong in me. I am losing flesh and strength, and it is not passing.');
        for (const o of this.adults()) if (o !== v && !o.away && (o.partner === v.id || v.parents.includes(o.id) || o.parents.includes(v.id) || o.home === v.home)) this.remember(o, `${v.name} has a wasting sickness. Without someone sitting with ${v.gender === 'm' ? 'him' : 'her'} every day, ${v.gender === 'm' ? 'he' : 'she'} may not live.`);
      }
    }
  }

  fallSick(v) {
    const plague = this.disaster && this.disaster.kind === 'plague' && Math.random() < 0.8;
    const harsh = plague || Math.random() < 0.4;
    v.sick = plague ? { name: this.disaster.name, until: this.day + 3 + Math.floor(Math.random() * 3), harsh: true, deadly: true, tended: 0 }
      : { name: harsh ? 'a fever' : 'a bad cough', until: this.day + 2 + Math.floor(Math.random() * 3), harsh, tended: 0 };
    this.addFeed('event', v, `${v.name} has come down with ${v.sick.name}.`);
    if (v.stage === 'adult') this.remember(v, `I woke up with ${v.sick.name}. Everything aches.`);
    for (const o of this.adults()) {
      if (o === v || o.away) continue;
      if (o.partner === v.id || v.parents.includes(o.id) || o.parents.includes(v.id) || o.home === v.home) this.remember(o, `${v.name} is sick with ${v.sick.name}.`);
    }
  }

  // Two people who have come to despise each other do not stay together.
  // A couple ends when one of them decides it has. v is the one who walks away.
  partWays(v) {
    const t = this.byId(v.partner);
    if (!t) return { ok: false, want: 'part from my partner', why: 'I have no partner' };
    v.partner = null;
    t.partner = null;
    v.singleSince = t.singleSince = this.day;
    v.ex = { id: t.id, day: this.day }; t.ex = { id: v.id, day: this.day, left: true };
    if (this.gene(t, 'pride') >= 0) this.wrong(t, v, 'walked out on me', 1);
    const home = this.structById(v.home);
    if (home && v.home === t.home) { const leaver = home.owner === v.id ? t : v; leaver.home = null; this.remember(leaver, 'I have nowhere to sleep now. I will have to build a place of my own.'); }
    t.affinity[v.id] = clamp(this.getAffinity(t, v) - 15);
    this.remember(v, `I told ${t.name} that it is over between us. We live apart now.`);
    this.remember(t, `${v.name} told me it is over between us. We live apart now.`);
    this.worldVersion++;
    this.addFeed('event', null, `${v.name} has left ${t.name}.`);
    this.addChronicle('event', null, `${v.name} and ${t.name} separated. It was ${v.name}'s choice.`);
    v.nextThinkAt = this.clock + 2;
    return { ok: true, summary: `tells ${t.name} it is over` };
  }

  // ---------- children ----------

  feedChild(c) {
    if (this.stored('food') >= 1) { this.store.food--; c.needs.hunger = clamp(c.needs.hunger + 40); return true; }
    const parents = c.parents.map((id) => this.byId(id)).filter(Boolean);
    const carers = (parents.some((p) => !p.away) ? parents : this.adults()).filter((o) => !o.away && o.inv.food >= 1 && (Math.hypot(o.x - c.x, o.y - c.y) < 6 || (o.home && o.home === c.home && o.inside && c.inside)));
    const carer = carers[0];
    if (!carer) return false;
    carer.inv.food--;
    c.needs.hunger = clamp(c.needs.hunger + 40);
    this.remember(carer, `I fed ${c.name}.`);
    return true;
  }

  updateChild(v, dt) {
    // Children get hungry too, and they depend on the grown-ups to do something about it.
    const perDay = dt / this.cfg.dayLengthSec;
    const n = v.needs;
    n.hunger = clamp(n.hunger - (v.sleeping ? 22 : 45) * perDay * (this.isWinter() ? 1.15 : 1));
    const nest = this.structById(v.home);
    const freezing = (this.isWinter() && this.isNight() && v.sleeping && (!v.inside || (nest && !nest.warm))) || (this.weatherNow() === 'blizzard' && !v.inside && !this.lit(Math.floor(v.x), Math.floor(v.y)));
    if (n.hunger <= 0) { v.health = clamp(v.health - 60 * perDay); v.lastHurt = ''; }
    else if (v.sick) v.health = clamp(v.health - (v.sick.deadly ? 40 : v.sick.harsh ? (this.years(v) < 5 ? 34 : 22) : 9) * (v.sick.tended === this.day ? 0.5 : 1) * perDay);
    else if (freezing) v.health = clamp(v.health - 18 * perDay);
    else if (n.hunger > 40) v.health = clamp(v.health + 25 * perDay);
    if (v.health <= 0) return this.die(v, n.hunger <= 0 ? 'hunger' : v.sick ? v.sick.name : freezing ? 'the cold' : v.lastHurt || 'wounds');
    v.feedTimer = (v.feedTimer || 0) - dt;
    if (v.feedTimer <= 0) {
      v.feedTimer = 4;
      if (n.hunger < 55 && !this.feedChild(v) && n.hunger < 25 && !v.sleeping && this.clock >= (v.nextWhine || 0)) {
        v.nextWhine = this.clock + 70;
        this.say(v, pick(['I am hungry.', 'My tummy hurts.', 'Is there any food?', 'I am so hungry.']));
      }
    }

    if (this.fires && this.fireNear(v, 2.6) && !v.path.length) this.flee(v);
    if (Date.now() < v.holdUntil) return;
    const night = this.isNight() || this.dangerOutside(); // children are kept in when the sky turns dangerous
    if (v.sleeping) {
      if (!night) { v.sleeping = false; v.inside = false; v.idle = 1; }
      return;
    }
    if (v.path.length) {
      const r = this.moveAlong(v, dt, 0.85);
      if (r === 'blocked') v.path = [];
      if (!v.path.length && v.goSleep) { v.goSleep = false; v.sleeping = true; v.inside = !!this.structById(v.home); }
      return;
    }
    v.idle -= dt;
    if (v.idle > 0) return;
    v.idle = 1.5 + Math.random() * 4;
    const home = this.structById(v.home);
    if (night) {
      const p = home ? this.pathToStruct(v, home) : null;
      if (p && p.length) { v.path = p; v.goSleep = true; v.doing = 'heading to bed'; }
      else { v.sleeping = true; v.inside = !!home && !!p; }
      return;
    }
    const parents = v.parents.map((id) => this.byId(id)).filter((p) => p && !p.sleeping && !p.away);
    if (parents.length && Math.random() < 0.55) {
      const par = pick(parents);
      const [tx, ty] = this.tileOf(par);
      const p = this.pathNear(v, tx, ty, 1);
      if (p && p.length < 40) { v.path = p; v.doing = `following ${par.name}`; }
    } else {
      const [sx, sy] = this.tileOf(v);
      const tx = sx + Math.floor(Math.random() * 9) - 4, ty = sy + Math.floor(Math.random() * 9) - 4;
      if (this.walkable(tx, ty)) {
        const p = this.bfs(sx, sy, (x, y) => x === tx && y === ty);
        if (p && p.length < 12) { v.path = p; v.doing = 'playing'; }
      }
    }
    if (this.clock >= v.nextLineAt) {
      v.nextLineAt = this.clock + 300 + Math.random() * 400;
      // a child talks to whoever is near, and a parent or any grown-up close by who is not busy answers
      const near = this.villagers.filter((o) => o !== v && !o.sleeping && !o.away && Math.hypot(o.x - v.x, o.y - v.y) < 5);
      if (!near.length) return;
      const free = (o) => o.stage === 'adult' && !this.inConversation(o) && (!o.plan || o.plan.filler || ['gather', 'wander', 'activity', 'store', 'fish', 'pause'].includes(o.plan.action));
      const folks = near.filter((o) => free(o) && v.parents.includes(o.id)), grown = near.filter(free);
      const ear = folks[0] || (Math.random() < 0.5 ? grown[0] : null);
      this.brain.kidLine(v).then((r) => {
        if (!r || !r.say || v.stage !== 'child' || v.sleeping) return;
        const talk = ear ? { id: this.nextTalk = (this.nextTalk || 0) + 1, to: ear.name, kind: 'child' } : null;
        this.say(v, r.say, 700, !!ear, talk);
        if (!ear || !this.villagers.includes(ear) || ear.sleeping || this.inConversation(ear)) return;
        ear.holdUntil = Date.now() + 30000;
        this.brain.reply(ear, v, [{ who: v.name, text: r.say }], true, '').then((a) => {
          if (v.bubble && v.bubble.until > Date.now() + 9000) v.bubble.until = Date.now() + 5000;
          if (!a || !a.say || !this.villagers.includes(ear) || ear.sleeping) return;
          this.say(ear, a.say, 700, false, { ...talk, to: v.name });
          ear.holdUntil = Date.now() + 2000;
          ear.needs.social = clamp(ear.needs.social + 8);
          if (!v.lessons) v.lessons = [];
          v.lessons.push(`${ear.name} answered when ${v.gender === 'm' ? 'he' : 'she'} said "${r.say.slice(0, 60)}": "${a.say.slice(0, 80)}"`.slice(0, 160));
          if (v.lessons.length > 8) v.lessons.shift();
        });
      });
    }
  }

  spawnChild(mother, father, name, gender) {
    const home = this.structById(mother.home);
    let x = mother.x, y = mother.y;
    if (home) {
      const t = this.adjacentTiles(home).find(([ax, ay]) => this.walkable(ax, ay));
      if (t) { x = t[0] + 0.5; y = t[1] + 0.5; }
    }
    const taken = new Set(this.villagers.map((v) => v.name.toLowerCase()));
    if (!name || taken.has(name.toLowerCase())) {
      name = (gender === 'm' ? BOY_NAMES : GIRL_NAMES).find((n) => !taken.has(n.toLowerCase())) || `Child ${this.nextId}`;
    }
    const c = this.makeVillager({
      name, gender, stage: 'child', parents: [mother.id, father.id], home: mother.home, x, y, genes: this.newGenes(mother, father),
      hair: Math.random() < 0.5 ? mother.hair : father.hair,
      skin: Math.random() < 0.5 ? mother.skin : father.skin,
    });
    for (const p of [mother, father]) {
      p.lastBirthDay = this.day;
      p.affinity[c.id] = 85;
      c.affinity[p.id] = 85;
      this.remember(p, `Our ${gender === 'm' ? 'son' : 'daughter'} ${name} was born.`);
    }
    this.worldVersion++;
    this.addFeed('birth', null, `${mother.name} and ${father.name} had a ${gender === 'm' ? 'son' : 'daughter'}. They named ${gender === 'm' ? 'him' : 'her'} ${name}.`);
    this.addChronicle('birth', null, `${name} was born to ${mother.name} and ${father.name}.`);
    this.checkDiscoveries(null);
    return c;
  }

  comeOfAge(v) {
    v.stage = 'adult';
    v.adultDay = this.day;
    v.sleeping = false;
    v.inside = false;
    v.path = [];
    v.needs = { energy: 85, hunger: 70, social: 70 };
    v.inv = { wood: 0, stone: 0, food: 2 };
    v.memory = [{ d: this.day, text: 'I am grown now. Time to make something of my own.' }];
    const [pa, pb] = v.parents.map((id) => this.byId(id));
    v.personality = `Grew up watching ${pa ? pa.name : 'their parents'}${pb ? ' and ' + pb.name : ''} build this place from nothing. Eager to prove themselves.`;
    this.addFeed('event', null, `${v.name} has grown up.`);
    this.addChronicle('event', null, `${v.name} came of age.`);
    if (v.nature) v.personality = '';
    this.brain.comingOfAge(v, pa, pb).then((r) => {
      const text = r && r.personality ? String(r.personality).replace(/\s+/g, ' ').trim().slice(0, 320) : '';
      if (text.length > 20) v.personality = text;
    });
  }

  // ---------- day and night ----------

  onDusk() {
    // In a big village not everyone can write every night: the model has only so many hours.
    // Those who have waited longest write tonight, and the rest carry their day over to their next entry.
    const due = this.adults().filter((v) => !v.away && v.today.length && this.inLight(v)).sort((a, b) => (a.diaryDay || 0) - (b.diaryDay || 0));
    const tonight = new Set(due); // everyone who lived a day writes about it
    for (const v of this.adults()) {
      if (v.away) continue;
      if (!tonight.has(v)) { if (v.today.length > 24) v.today = v.today.slice(-24); continue; }
      const events = v.today.slice();
      v.today = [];
      v.diaryDay = this.day;
      const day = this.day;
      this.brain.diary(v, events).then((r) => {
        if (!r || !r.diary) return;
        const text = String(r.diary).slice(0, 400);
        if (Array.isArray(r.wants)) {
          const wants = r.wants.map((w) => String(w || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter((w) => w.length > 5).slice(0, 3);
          if (wants.length) v.wants = wants;
        }
        v.diary.push({ d: day, text });
        if (v.diary.length > 5) v.diary.shift();
        this.chronicle.push({ day, type: 'diary', who: v.name, text });
        if (this.onFeed) this.onFeed('chronicle', { day, type: 'diary', who: v.name, text });
      });
    }
  }

  // Clay and reeds come back at the water's edge as fast as they are taken.
  shoreUp() {
    const have = (k) => Object.values(this.objects).filter((o) => o.kind === k).length;
    const want = Math.round(3 * this.landScale());
    if (have('clay') >= want && have('reeds') >= want * 2) return;
    const shore = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (this.ground[idx(x, y)] === SAND && !this.objects[key(x, y)] && !this.structGrid[idx(x, y)] && neighbors4(x, y).some(([nx, ny]) => this.ground[idx(nx, ny)] === WATER)) shore.push([x, y]);
    shore.sort(() => Math.random() - 0.5);
    while (have('clay') < want && shore.length) { const [x, y] = shore.pop(); this.objects[key(x, y)] = { kind: 'clay', x, y, left: 12 }; }
    while (have('reeds') < want * 2 && shore.length) { const [x, y] = shore.pop(); this.objects[key(x, y)] = { kind: 'reeds', x, y, ripe: !this.isWinter(), regrowAt: 0 }; }
  }

  onDawn() {
    this.recast();
    this.leadership();
    // Feelings settle. Devotion has to be kept up, and grudges fade slowly.
    for (const v of this.villagers) for (const id of Object.keys(v.affinity)) {
      const o = this.byId(Number(id));
      if (!o) continue;
      const rest = v.partner === o.id ? 78 : v.parents.includes(o.id) || o.parents.includes(v.id) ? 72 : this.related(v, o) ? 58 : 40;
      const a = v.affinity[id];
      // a wrong that has not been forgiven keeps the wound open; small ones are let go in time, blood never is
      const w = v.wrongs && v.wrongs[id];
      if (w && w.weight < 3 && this.day - w.day > 7 * w.weight) delete v.wrongs[id];
      const sore = w && (w.weight >= 3 || this.day - w.day < 5 * w.weight);
      if (a > rest + 1) v.affinity[id] = a - 1.5;
      else if (a < rest - 12 && !sore) v.affinity[id] = a + 0.5;
    }
    this.resentIdlers();
    this.ruin();
    // Yesterday's glory and yesterday's shame both fade, and a purpose has to be kept fed.
    const spirit = this.effectLevel('meaning');
    for (const v of this.adults()) {
      if (v.pride) v.pride = Math.abs(v.pride) < 0.5 ? 0 : +(v.pride * 0.88).toFixed(2);
      // the fuller it is, the faster it drains: nobody stays fulfilled by what they did last year
      const have = this.purposeOf(v);
      v.purpose = +clamp(have - (1 + have * 0.1) * (this.isOld(v) ? 0.6 : 1) + spirit).toFixed(1);
    }
    // The wild grows back a little every morning.
    const all = Object.values(this.objects);
    const trees = all.filter((o) => o.kind === 'tree').length;
    const rocks = all.filter((o) => o.kind === 'rock').length;
    const sprout = (kind, n, extra) => {
      for (let i = 0, tries = 0; i < n && tries < 80 + n * 12; tries++) {
        const x = 1 + Math.floor(Math.random() * (W - 2)), y = 1 + Math.floor(Math.random() * (H - 2));
        if (this.ground[idx(x, y)] !== GRASS || this.objects[key(x, y)] || this.structGrid[idx(x, y)] || this.paths.has(idx(x, y))) continue;
        if (Math.hypot(x - this.spawn.x, y - this.spawn.y) < 7) continue;
        if (this.villagers.some((v) => Math.floor(v.x) === x && Math.floor(v.y) === y)) continue;
        let near = false;
        for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (inBounds(xx, yy) && this.structGrid[idx(xx, yy)]) near = true;
        if (near) continue;
        this.objects[key(x, y)] = { kind, x, y, ...extra() };
        i++;
      }
    };
    const big = this.landScale();
    if (trees < 85 * big) sprout('tree', Math.round(7 * big), () => ({ v: Math.floor(Math.random() * 3) }));
    if (rocks < 12 * big) sprout('rock', Math.round(3 * big), () => ({ left: 6, ore: oreIn(Math.random, false) }));
    // the hills hold more streaked rock than is ever dug; a worked-out seam is replaced by another somewhere
    const ores = all.filter((o) => o.kind === 'rock' && o.ore).length;
    if (ores < 5 * big) sprout('rock', 2, () => ({ left: 6, ore: Math.random() < 0.5 ? 'green' : Math.random() < 0.7 ? 'red' : 'grey' }));
    this.shoreUp();
    this.changed();

    for (const v of this.villagers) {
      if (v.stage === 'child' && this.day - v.bornDay >= this.cfg.daysToAdult) this.comeOfAge(v);
    }

    // stored food does not keep forever, though the cold helps
    if (this.store.food > 0) {
      const lost = Math.floor(this.store.food * (this.isWinter() ? 0.02 : 0.08) * (this.stats.salt ? 0.5 : 1) * Math.pow(0.65, this.effectLevel('keeps_food')));
      this.store.food -= lost;
      if (lost >= 3) this.addFeed('event', null, `${lost} food in the storehouse spoiled overnight.`);
    }

    // the turning of the year
    const was = this.seasonOf(this.day - 1), now = this.season();
    if (was !== now) {
      const year = Math.floor((this.day - 1) / this.yearDays()) + 1;
      const text = { spring: 'Spring came. The ground softened and the bushes budded.', summer: 'Summer came. The days grew long.', autumn: 'Autumn came. The leaves turned, and winter is next.', winter: 'Winter came. Snow covered everything, and nothing will grow until spring.' }[now];
      this.addFeed('event', null, text);
      this.addChronicle('event', null, text);
      for (const o of Object.values(this.objects)) {
        if (o.kind !== 'bush') continue;
        if (now === 'winter') o.ripe = false;
        if (now === 'spring') o.regrowAt = this.dayFloat() + Math.random() * 0.5;
      }
      for (const v of this.adults()) this.remember(v, now === 'winter' ? 'Winter has come. The bushes are bare and the farms are frozen.' : `${now[0].toUpperCase() + now.slice(1)} has come.`);
      this.changed();
    }

    // growing old
    for (const v of this.adults()) {
      if (this.isOld(v) && !v.oldNoted) { v.oldNoted = true; this.remember(v, 'I am getting old. My hair has gone gray and my legs are slower.'); }
      if (this.age(v) === v.lifespan) this.remember(v, 'I can feel that my time is nearly done.');
    }
    // children with no grown-ups left have to grow up fast
    if (!this.adults().length) for (const c of this.villagers) if (this.age(c) >= 1) this.comeOfAge(c);

    for (const h of this.structures) if (h.warm) h.warm = false; // the fires burn down by morning
    if (this.crowded()) this.growLand(5);
    this.rollDisaster();
    this.rollWeather();
    // burned ground greens over in time
    if (this.scorched) { for (const k of Object.keys(this.scorched)) if (this.day - this.scorched[k] > 8) delete this.scorched[k]; }
    this.sicknessAtDawn();
    this.animalsAtDawn();
    this.births();
    this.travelers();
    for (const a of this.adults()) for (const b of this.adults()) if (a.id < b.id) this.maybePair(a, b);
    this.checkDiscoveries(null);
    this.addFeed('event', null, `Year ${this.day} begins.`);
    this.wantSave = true;
  }

  births() {
    for (const m of this.adults()) {
      if (m.gender !== 'f' || m.away || !this.canBear(m)) continue; // away, or past childbearing
      // a child got in secret comes whether or not anyone is ready for it
      const lover = m.carrying ? this.byId(m.carrying.by) : null;
      if (m.carrying) delete m.carrying;
      const f = lover || this.byId(m.partner);
      if (!f || f.stage !== 'adult' || (!lover && f.away)) continue;

      const home = this.structById(m.home);
      if (!lover && (!home || home.p < 1)) continue;
      const pop = this.villagers.length + this.pendingBirths, cap = this.popCap(); // Infinity when there is no limit
      // A full village still makes room for a couple's first child, so there is always a next generation.
      // A village with no children in it at all is a village with no future, so the next birth comes quickly.
      const noChildren = !this.villagers.some((o) => o.stage === 'child') && !this.pendingBirths;
      // The cap is only there to spare the computer, so it must never be what ends the family:
      // a village with no children in it always has room for one, however full it is.
      if (!lover) {
        if (pop >= cap && !noChildren && !(this.childrenOf(m).length === 0 && pop < cap + 3)) continue;
        // when people are few, families grow faster
        const few = this.villagers.length < (cap === Infinity ? 6 : cap / 2) || noChildren;
        if (this.day - m.lastBirthDay < Math.max(2, this.cfg.birthGapDays)) continue; // a body needs time between children
        // age is what ends childbearing; a count only applies if one is set in config (0 = none)
        if (this.cfg.maxChildrenPerCouple > 0 && this.childrenOf(m).length >= this.cfg.maxChildrenPerCouple + (few ? 2 : 0)) continue;
        // A child comes of a shared bed, and far more readily to the young. Nobody decides it.
        const bed = (m.bedDay && this.day - m.bedDay <= 1) || (m.closeDay && this.day - m.closeDay <= 2);
        if (this.foodDays() < 2 && !few) continue; // a starving body does not carry a child
        let odds = this.fertility(m) * (bed ? 1 : 0.2) * (pop >= cap * 0.75 ? 0.5 : 1);
        if (few) odds = Math.max(odds, 0.5);
        if (Math.random() > odds) continue; // not every year brings a child
        if (m.needs.hunger < 25 || f.needs.hunger < 25) continue;
      }
      const gender = Math.random() < 0.5 ? 'm' : 'f'; // a coin flip, whatever it means for the family line
      this.pendingBirths++;
      m.lastBirthDay = f.lastBirthDay = this.day;
      const taken = this.villagers.map((v) => v.name);
      this.brain.nameChild(m, f, gender, taken).then((r) => {
        this.pendingBirths--;
        if (!this.villagers.includes(m)) return;
        const name = r && r.name ? String(r.name).replace(/[^\p{L}' -]/gu, '').trim().split(/\s+/)[0].slice(0, 14) : '';
        // Birth is dangerous, for both of them.
        const risky = this.cfg.accidents !== false;
        const weak = m.health < 60 || this.years(m) > 44 || m.needs.hunger < 35 || !!m.sick;
        const midwife = 1 - 0.25 * this.effectLevel('birth', m);
        const motherDies = risky && Math.random() < (weak ? 0.07 : 0.025) * (1 - 0.25 * this.effectLevel('health', m)) * midwife;
        const stillborn = risky && Math.random() < (motherDies ? 0.45 : weak ? 0.1 : 0.05) * midwife;
        if (stillborn) {
          const line = `${m.name} and ${f ? f.name : 'her partner'}'s child was born still.`;
          this.addFeed('death', null, line);
          this.addChronicle('death', null, line);
          m.lastBirthDay = this.day;
          if (!this.stillborn) this.stillborn = [];
          this.stillborn.push({ parents: [m.id, f ? f.id : null].filter(Boolean), gender, day: this.day });
          this.worldVersion++;
          for (const o of [m, this.byId(m.partner)].filter(Boolean)) { this.remember(o, `Our child was born still. ${gender === 'm' ? 'He' : 'She'} never drew breath.`); o.needs.social = clamp(o.needs.social - 30); o.thoughts = []; }
          if (motherDies) this.die(m, 'childbirth');
          return;
        }
        const c = this.spawnChild(m, f, name, gender);
        this.giveNature(c, 'birth');
        // a child that is plainly another man's
        const husband = this.byId(m.partner);
        if (husband && husband !== f) {
          this.wrong(husband, f, `fathered ${c.name} on my wife`, 3, 40);
          this.wrong(husband, m, `bore ${f.name}'s child`, 2, 30);
          this.remember(husband, `${m.name} has borne a child, ${c.name}, and ${gender === 'm' ? 'he' : 'she'} is ${f.name}'s, not mine. Everyone can see it.`);
          this.addFeed('event', null, `${c.name} is ${f.name}'s child, not ${husband.name}'s, and everyone can see it.`);
          this.addChronicle('event', null, `${c.name}'s father is ${f.name}, not ${m.name}'s husband ${husband.name}.`);
        }
        if (motherDies) {
          this.die(m, 'childbirth', { line: `${m.name} died giving birth to ${c.name}, aged ${this.years(m)}.` });
          const father = this.byId(c.parents[1]);
          if (father) this.remember(father, `${m.name} died bringing ${c.name} into the world.`);
          return;
        }
        if (r && r.why && c.name === name) this.remember(m, `I chose the name ${c.name}. ${String(r.why).slice(0, 160)}`);
      });
    }
  }

  travelers() {
    if (!this.cfg.travelers || this.villagers.length >= this.popCap()) return;
    const adults = this.adults();
    const lonely = adults.find((a) => !a.partner && !a.traveler && this.day - a.adultDay >= 1 &&
      !adults.some((b) => b !== a && !b.partner && b.gender !== a.gender && !this.related(a, b)));
    if (!lonely) return;
    const taken = new Set(this.villagers.map((v) => v.name.toLowerCase()));
    const want = lonely.gender === 'm' ? 'f' : 'm';
    const t = TRAVELERS.find((x) => x.gender === want && !taken.has(x.name.toLowerCase()));
    if (!t) return;
    const edge = [];
    const seen = new Set();
    const q = [[this.spawn.x, this.spawn.y]];
    seen.add(idx(this.spawn.x, this.spawn.y));
    while (q.length) {
      const [x, y] = q.shift();
      if (Math.min(x, y, W - 1 - x, H - 1 - y) <= 1) edge.push([x, y]);
      for (const [nx, ny] of neighbors4(x, y)) {
        if (seen.has(idx(nx, ny)) || !this.walkable(nx, ny)) continue;
        seen.add(idx(nx, ny));
        q.push([nx, ny]);
      }
    }
    if (!edge.length) return;
    const [x, y] = pick(edge);
    const v = this.makeVillager({ ...t, x: x + 0.5, y: y + 0.5, traveler: true, food: 3 });
    this.remember(v, 'I walked a long way and found people living here. I think I will stay.');
    this.addFeed('event', null, `A traveler named ${v.name} walked out of the wild and decided to stay.`);
    this.addChronicle('event', null, `${v.name}, a traveler, arrived and settled.`);
    this.checkDiscoveries(null);
  }

  // ---------- what the screen needs ----------

  actLabel(v) {
    if (v.away) return 'away beyond the valley';
    if (v.stage === 'child') return v.sleeping ? 'asleep' : v.sick ? `sick with ${v.sick.name}` : this.clock < (v.withUntil || 0) ? v.doing : v.path.length ? v.doing || 'playing' : 'playing';
    if (v.sleeping) return 'asleep';
    if (Date.now() < v.holdUntil && !v.plan) return 'listening';
    const p = v.plan;
    if (!p) return v.thinking ? (!v.asking && v.brood) || 'thinking' : 'idle';
    const walking = p.phase === 'walk' && v.path.length;
    const t = p.to ? this.byId(p.to) : null;
    switch (p.action) {
      case 'gather': return walking ? `off to gather ${p.res}` : `gathering ${p.res}`;
      case 'build': {
        const what = p.pathTiles ? 'a path' : this.typeName((this.structById(p.sid) || {}).type || 'something');
        return walking ? `off to build ${what}` : `building ${what}`;
      }
      case 'shelter': return walking ? 'running for shelter' : 'sheltering inside';
      case 'flee': return 'running from the fire';
      case 'design': return `working out how to build ${p.idea}`.slice(0, 70);
      case 'fish': return walking ? 'off to fish' : 'fishing';
      case 'propose': return p.phase === 'converse' ? `asking ${t ? t.name : 'someone'} to make a home together` : `looking for ${t ? t.name : 'someone'}`;
      case 'together': return `spending time with ${t ? t.name : 'someone'}`;
      case 'tend': return p.phase === 'work' ? `looking after ${t ? t.name : 'someone'}` : `going to look after ${t ? t.name : 'someone'}`;
      case 'take': return `sneaking up on ${t ? t.name : 'someone'}`;
      case 'fight': case 'kill': case 'quarrel': return `going after ${t ? t.name : 'someone'}`;
      case 'tryst': return p.phase === 'converse' ? `alone with ${t ? t.name : 'someone'}` : `looking for ${t ? t.name : 'someone'}`;
      case 'explore': return 'heading out of the valley';
      case 'hunt': return p.phase === 'work' ? `taking aim at a ${p.kind}` : `stalking a ${p.kind}`;
      case 'make': return `making ${p.what}`;
      case 'invent': return `working on an idea: ${v.project ? v.project.idea : '...'}`.slice(0, 70);
      case 'call': return p.phase === 'converse' ? 'speaking to everyone at the fire' : 'calling everyone to the fire';
      case 'attend': { const h = this.byId(p.host); return `at the fire, listening to ${h ? h.name : 'someone'}`; }
      case 'store': return 'carrying a load to the storehouse';
      case 'activity': case 'pause': return p.what;
      case 'eat': return 'eating';
      case 'sleep': return 'heading to bed';
      case 'talk': return p.phase === 'converse' ? `talking with ${t ? t.name : 'someone'}` : `looking for ${t ? t.name : 'someone'}`;
      case 'give': return `bringing ${p.item} to ${t ? t.name : 'someone'}`;
      default: return 'wandering';
    }
  }

  tickState() {
    return {
      day: this.day, time: +this.time.toFixed(4), speed: this.speed, paused: this.paused,
      wx: this.weatherNow(), dz: this.disaster ? [this.disaster.kind, this.disaster.name || '', Math.max(0, this.disaster.until - this.day)] : null, fire: Object.values(this.fires || {}).map((f) => [f.x, f.y]),
      era: this.era() + (this.inventions.length ? `, ${this.inventions.length} invention${this.inventions.length === 1 ? '' : 's'}` : ''), word: this.timeWord(), wv: this.worldVersion, season: this.season(), ended: this.ended,
      store: this.storehouse() ? Object.fromEntries(Object.entries(this.store).filter(([, n]) => n > 0)) : null,
      wait: Math.round(this.waitAvg || 0), cast: [this.adults().filter((v) => this.inLight(v)).length, this.adults().length],
      b: this.structures.filter((s) => s.p < 1).map((s) => [s.id, +s.p.toFixed(2)]),
      a: this.animals.map((a) => [a.id, a.kind[0], +a.x.toFixed(2), +a.y.toFixed(2), a.dir, a.path.length || a.goal ? 1 : 0, this.isYoung(a) ? 1 : 0]),
      v: this.villagers.map((v) => ({
        id: v.id, name: v.name, g: v.gender, st: v.stage,
        x: +v.x.toFixed(2), y: +v.y.toFixed(2), dir: v.dir,
        act: this.actLabel(v), bubble: v.bubble ? v.bubble.text : null,
        lit: this.inLight(v), thinking: v.thinking && !v.plan, sleeping: v.sleeping, inside: v.inside && !v.away, away: !!v.away, sick: !!v.sick,
        moving: v.path.length > 0, working: !!v.plan && v.plan.phase === 'work' && !v.sleeping,
        shirt: v.shirt, hair: v.hair, skin: v.skin,
        n: [Math.round(v.needs.energy), Math.round(v.needs.hunger), Math.round(v.needs.social)],
        m: (() => { const m = this.maslow(v); return [m.at, m.state === 'unmet' ? 2 : m.state === 'wanting' ? 1 : 0]; })(),
        inv: Object.fromEntries(Object.entries(v.inv).filter(([, n]) => n > 0)), home: v.home,
        cast: v.plan && v.plan.action === 'fish' && v.plan.phase === 'work' ? v.plan.cast : null,
        doing: v.plan && v.plan.action === 'activity' && v.plan.phase === 'work' ? v.plan.what : null,
        yr: this.years(v), title: v.calling || '', role: this.leader === v.id ? (this.leaderTitle || 'looked to') : '', spear: !!v.plan && v.plan.action === 'hunt', old: v.stage === 'adult' && this.isOld(v), hp: Math.round(v.health),
      })),
    };
  }

  // Everyone who has ever lived here, the living and the dead, and who had children with whom.
  familyRecords() {
    const rec = (p, alive) => ({
      id: p.id, name: p.name, g: p.gender, parents: p.parents || [], born: p.bornDay, partner: p.partner || null, alive,
      yrs: alive ? this.years(p) : p.years ?? this.yearsFromDays((p.diedDay || 0) - (p.bornDay || 0)), died: alive ? null : p.diedDay, cause: alive ? null : p.cause,
      child: alive && p.stage === 'child', away: alive && !!p.away, title: p.calling || '', founder: !!p.founder || (alive ? false : (this.cfg.founders || []).some((f) => f.name === p.name && !(p.parents || []).length)),
    });
    const people = [...this.dead.map((d) => rec(d, false)), ...this.villagers.map((v) => rec(v, true))];
    const pairs = new Map();
    const add = (a, b) => { if (a == null || b == null || a === b) return; const k = [a, b].sort((x, y) => x - y).join('+'); if (!pairs.has(k)) pairs.set(k, [Math.min(a, b), Math.max(a, b)]); };
    for (const p of people) { if (p.parents.length === 2) add(p.parents[0], p.parents[1]); if (p.alive && p.partner) add(p.id, p.partner); }
    for (const st of this.stillborn || []) if (st.parents.length === 2) add(st.parents[0], st.parents[1]);
    const couples = [...pairs.values()].map(([a, b]) => {
      const pa = this.person(a), pb = this.person(b);
      const together = !!(this.byId(a) && this.byId(b) && this.byId(a).partner === b);
      // what the second is to the first, and what the first is to the second
      return [a, b, pa && pb ? this.relation(pa, pb, true) : '', pa && pb ? this.relation(pb, pa, true) : '', together];
    });
    return { people, couples, still: this.stillborn || [] };
  }

  worldState() {
    return {
      W, H, ox: (this.origin || {}).x || 0, oy: (this.origin || {}).y || 0, version: this.worldVersion, season: this.season(),
      ground: this.ground.join(''),
      objects: Object.values(this.objects).map((o) => [{ tree: 't', rock: 'r', bush: 'b', clay: 'c', reeds: 'g' }[o.kind] || 'b', o.x, o.y, o.kind === 'tree' ? o.v : o.kind === 'bush' || o.kind === 'reeds' ? (o.ripe ? 1 : 0) : o.left, o.kind === 'rock' && o.ore ? { green: 'g', red: 'r', grey: 'y' }[o.ore] || 0 : 0]),
      age: this.ageName(), ageLine: this.ageOf()[2],
      ways: (this.ways || []).filter((w) => w.held).map((w) => ({ text: w.text, kind: w.kind, by: w.by, day: w.day, yes: w.yes, no: w.no, broken: w.broken })),
      leader: this.byId(this.leader) ? { name: this.byId(this.leader).name, id: this.leader, title: this.leaderTitle || 'the one people look to' } : null,
      materials: (this.materials || []).map((m) => ({ name: m.name, from: costText(m.from), at: m.at ? this.typeName(m.at) : '', by: m.by, day: m.day, what: m.what, tags: m.tags })),
      raws: this.raws(),
      structures: this.structures.map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y, w: s.w, h: s.h, p: s.p, owner: s.owner, label: s.label, ripe: !!s.ripe, warm: !!s.warm, ...(STRUCT[s.type] && STRUCT[s.type].custom ? { name: STRUCT[s.type].name, look: STRUCT[s.type].look } : {}) })),
      paths: [...this.paths],
      scorched: Object.keys(this.scorched || {}).map((k) => k.split(',').map(Number)),
      family: this.familyRecords(),
      discoveries: DISCOVERIES.filter((d) => this.knows(d.id)).map((d) => d.name),
      known: DISCOVERIES.filter((d) => this.knows(d.id)).map((d) => ({ name: d.name, gives: d.unlocks.join(', ') || d.note || '' })),
      inventions: this.inventions.map((i) => ({ name: i.name, kind: i.kind, what: i.what, does: EFFECTS[i.effect], uses: (i.uses || []).join(', '), tags: (i.tags || []).join(', '), by: i.by, day: i.day, built: i.kind === 'building' ? this.structures.filter((st) => st.type === i.key && st.p >= 1).length : i.kind === 'tool' ? this.villagers.filter((o) => (o.items || []).some((it) => it.inv === i.id)).length : null })),
    };
  }

  detail(id) {
    const v = this.byId(id);
    if (!v) return null;
    const home = this.structById(v.home);
    const owner = home ? this.byId(home.owner) : null;
    return {
      id: v.id, name: v.name, gender: v.gender, stage: v.stage, age: this.years(v), health: v.health, lifespan: v.lifespan, old: v.stage === 'adult' && this.isOld(v),
      about: this.ageWord(v), personality: v.personality, nature: v.nature || null, thought: v.thought, act: this.actLabel(v),
      needs: v.needs, inv: v.inv,
      levels: (() => { const m = this.maslowNow(v); return { at: m.at, state: m.state, rows: LEVELS.map((l, i) => ({ name: l.name, what: l.what, score: m.scores[i], why: m.why[i] })) }; })(),
      home: home ? `${home.label ? `"${home.label}", ` : ''}${!owner || owner === v ? `their own ${home.type}` : owner.id === v.partner ? `the ${home.type} ${owner.name} built for them both` : `${owner.name}'s ${home.type}`}` : 'none yet',
      partner: v.partner ? this.byId(v.partner).name : null,
      parents: v.parents.map((p) => { const x = this.person(p); return x ? x.name + (this.byId(p) ? '' : ' (died)') : null; }).filter(Boolean),
      children: this.childrenOf(v).map((c) => c.name),
      kin: this.kinLines(v),
      born: v.genes ? Object.keys(TRAITS).filter((k) => v.genes[k]).sort((a, b) => Math.abs(v.genes[b]) - Math.abs(v.genes[a])).map((k) => TRAITS[k][v.genes[k] + 2]) : [],
      grudges: this.grudges(v).map((x) => `${x.o.name}: ${x.w.what}`), killed: v.killed || 0,
      title: v.calling || '', lessons: v.lessons || [], project: v.project ? `${v.project.idea} (${Math.min(3, v.project.progress)} of 3 tries)` : '',
      items: (v.items || []).map((it) => this.itemName(it)), wants: v.wants || [], sick: v.sick ? v.sick.name : null, away: !!v.away, tale: v.tale || null,
      memory: v.memory.slice().reverse(), diary: v.diary.slice().reverse(),
      people: this.villagers.filter((o) => o !== v).map((o) => ({ name: o.name, rel: this.relation(v, o), val: Math.round(this.getAffinity(v, o)), word: affinityWord(this.getAffinity(v, o)), view: (v.views || {})[o.id] || '' })),
    };
  }

  // The wider family for the detail panel: grandparents (living or dead), then living kin by what they are.
  kinLines(v) {
    const out = [];
    const cap = (w) => w[0].toUpperCase() + w.slice(1);
    const elders = [...this.lineage(v)].filter(([, d]) => d >= 2).sort((x, y) => x[1] - y[1]);
    const byDepth = new Map();
    for (const [id, d] of elders) {
      const p = this.person(id);
      if (!p) continue;
      const label = 'great-'.repeat(d - 2) + 'grandparents';
      if (!byDepth.has(label)) byDepth.set(label, []);
      byDepth.get(label).push(p.name + (this.byId(id) ? '' : ' (died)'));
    }
    for (const [label, names] of byDepth) out.push(`${cap(label)}: ${names.join(', ')}`);
    const groups = new Map();
    const skip = new Set(['partner', 'mother', 'father', 'son', 'daughter', 'neighbor']);
    for (const o of this.villagers) {
      if (o === v) continue;
      const rel = this.relation(v, o);
      if (skip.has(rel) || /grand(mother|father)$/.test(rel)) continue;
      if (!groups.has(rel)) groups.set(rel, []);
      groups.get(rel).push(o.name);
    }
    const many = (rel) => rel.includes('-in-law') ? rel.replace('-in-law', 's-in-law') : rel + 's';
    for (const [rel, names] of groups) out.push(`${cap(names.length > 1 ? many(rel) : rel)}: ${names.join(', ')}`);
    return out;
  }

  // ---------- saving ----------

  toJSON() {
    return {
      v: 1, seed: this.cfg.seed, ground: this.ground, objects: this.objects, spawn: this.spawn,
      structures: this.structures, paths: [...this.paths], day: this.day, time: this.time, clock: this.clock,
      stats: this.stats, discoveries: this.discoveries, nextId: this.nextId,
      animals: this.animals.filter((a) => a.kind !== 'wolf').map((a) => ({ ...a, path: [], goal: null })), store: this.store,
      dead: this.dead, ended: this.ended, lore: this.lore, inventions: this.inventions, inventedDay: this.inventedDay || 0, seen: this.seen || [], gatherDay: this.gatherDay || 0, ageModel: 2, heartModel: 2, natureModel: 3, techModel: 1, materials: this.materials || [], epoch: this.epoch || null, ways: this.ways || [], leader: this.leader || null, leaderTitle: this.leaderTitle || '', killings: this.killings || [], forgotten: this.forgotten || 0,
      W, H, origin: this.origin || { x: 0, y: 0 },
      weather: this.weather || null, disaster: this.disaster || null, fires: this.fires || {}, scorched: this.scorched || {}, rainless: this.rainless || 0, lastDisasterDay: this.lastDisasterDay || 0, burned: this.burned || 0, stillborn: this.stillborn || [], ecoModel: this.ecoModel || 0, fish: this.fish ?? null, goneKinds: this.goneKinds || {}, fishedOut: !!this.fishedOut,
      feed: this.feed.slice(-80), chronicle: this.chronicle,
      villagers: this.villagers.map((v) => ({ ...v, plan: null, path: [], thinking: false, asking: false, next: null, checked: false, brood: '', bubble: null, holdUntil: 0, nextThinkAt: 0, goSleep: false })),
    };
  }

  load(s) {
    setSize(s.W || START_W, s.H || START_H); // a world that has grown comes back at the size it reached
    this.origin = s.origin || { x: 0, y: 0 };
    Object.assign(this, {
      ground: s.ground, objects: s.objects, spawn: s.spawn, structures: s.structures, paths: new Set(s.paths),
      day: s.day, time: s.time, clock: s.clock || 0, stats: s.stats, discoveries: s.discoveries, nextId: s.nextId,
      feed: s.feed || [], chronicle: s.chronicle || [], villagers: s.villagers, worldVersion: 1, pendingBirths: 0,
    });
    this.animals = s.animals || [];
    this.store = s.store || { wood: 0, stone: 0, food: 0 };
    this.dead = s.dead || [];
    this.lore = s.lore || [];
    this.inventions = s.inventions || [];
    this.materials = s.materials || [];
    this.ways = s.ways || [];
    this.leader = s.leader || null;
    this.leaderTitle = s.leaderTitle || '';
    for (const inv of this.inventions) { if (!inv.uses) inv.uses = inv.material && RAW[inv.material] ? [inv.material] : inv.material === 'thatch' ? ['reeds'] : ['wood']; if (!inv.tags) inv.tags = []; }
    for (const inv of this.inventions) this.registerInvention(inv);
    this.epoch = s.epoch || null;
    // A world saved before the ground held anything but wood and stone: streak the rocks, and put clay and reeds at the water.
    if (!s.techModel) {
      for (const o of Object.values(this.objects)) if (o.kind === 'rock' && o.ore === undefined) o.ore = oreIn(Math.random, Math.random() < 0.4);
      const streaked = () => Object.values(this.objects).filter((o) => o.kind === 'rock' && o.ore).length;
      for (const o of Object.values(this.objects).filter((o) => o.kind === 'rock' && !o.ore).sort(() => Math.random() - 0.5)) { if (streaked() >= 5) break; o.ore = Math.random() < 0.6 ? 'green' : 'red'; }
    }
    this.inventedDay = s.inventedDay || 0;
    this.seen = s.seen || [];
    this.gatherDay = s.gatherDay || 0;
    this.weather = s.weather || null;
    this.disaster = s.disaster || null;
    this.fires = s.fires || {};
    this.scorched = s.scorched || {};
    this.rainless = s.rainless || 0;
    this.burned = s.burned || 0;
    this.stillborn = s.stillborn || [];
    this.fish = s.fish ?? null; // filled to the brim the first morning in an old world
    this.ecoModel = s.ecoModel || 0;
    this.goneKinds = s.goneKinds || {};
    this.fishedOut = !!s.fishedOut;
    // an old world gets a quiet spell before its first disaster
    this.lastDisasterDay = s.lastDisasterDay ?? s.day;
    // the first travelers all told the same tale; keep one telling of it
    if (!s.seen && this.lore.length > 1) this.lore = this.lore.slice(-1);
    this.ended = !!s.ended;
    this.animals = this.animals.filter((a) => a.kind !== 'wolf');
    for (const a of this.animals) delete a.hunter;
    for (const v of s.villagers) {
      if (v.health == null) v.health = 100;
      if (!v.lifespan) v.lifespan = this.newLifespan();
      if (!v.needs) v.needs = { energy: 90, hunger: 75, social: 70 };
      if (!v.wants) v.wants = [];
      if (!v.items) v.items = [];
      v.items = v.items.filter((it, i, all) => all.findIndex((o) => o.name.replace(/^(a|an)\s+(simple|new|sharp|sturdy)?\s*/i, '') === it.name.replace(/^(a|an)\s+(simple|new|sharp|sturdy)?\s*/i, '')) === i);
      if (!v.views) v.views = {};
      if (v.sick === undefined) v.sick = null;
      if (v.away === undefined) v.away = null;
    }
    for (const o of Object.values(this.objects)) delete o.res;
    // Anything half built when the world was saved gets its materials handed back.
    for (const st of this.structures.filter((x) => x.p < 1)) {
      const owner = this.byId(st.owner);
      if (owner) for (const [k, n] of Object.entries(STRUCT[st.type].cost)) this.give(owner, k, n);
    }
    this.structures = this.structures.filter((x) => x.p >= 1);
    for (const st of this.structures) delete st.res;
    for (const v of this.villagers) {
      v.sleeping = false;
      v.inside = !!v.away;
      v.plan = null;
      v.path = [];
      v.thinking = false;
      v.asking = false;
      v.next = null;
      v.checked = false;
    }
    // Founders get the natures written for them in config. Everyone else is asked, a couple each morning.
    for (const v of this.villagers) {
      if (v.nature === undefined) v.nature = null;
      const f = v.founder ? (this.cfg.founders || []).find((x) => x.name === v.name) : null;
      if (f && f.nature && !v.nature) v.nature = f.nature;
    }
    this.killings = s.killings || [];
    this.forgotten = s.forgotten || 0;
    // Everyone gets what they were born with, parents before children so it runs in families, and a plain nature to match.
    // The natures the model made up on its own had all come out as the same quiet dreamer.
    if (s.natureModel !== 3) {
      for (const v of this.villagers.slice().sort((a, b) => a.bornDay - b.bornDay)) {
        const f = v.founder ? (this.cfg.founders || []).find((x) => x.name === v.name) : null;
        if (f && f.nature) { v.genes = f.genes || this.newGenes(null, null); v.nature = f.nature; v.natureFull = true; continue; }
        v.genes = this.newGenes(...(v.parents || []).map((id) => this.villagers.find((o) => o.id === id)));
        v.nature = this.plainNature(v);
        v.natureFull = false;
        v.natureAsked = 0;
        if (v.stage === 'adult') v.personality = '';
        v.views = {};
        v.wants = [];
      }
    }
    for (const v of this.villagers) { if (!v.genes) v.genes = this.newGenes(null, null); if (!v.nature) v.nature = this.plainNature(v); }
    // Old worlds piled every feeling up to the top, because even a dull chat counted as warmth. Bring them back into range once.
    if (s.heartModel !== 2) {
      for (const v of this.villagers) for (const id of Object.keys(v.affinity)) {
        const o = this.villagers.find((x) => x.id === Number(id));
        if (!o || v.affinity[id] <= 60) continue;
        const top = v.partner === o.id ? 90 : v.parents.includes(o.id) || o.parents.includes(v.id) ? 84 : 72;
        v.affinity[id] = 60 + (v.affinity[id] - 60) * ((top - 60) / 40);
      }
    }
    // A world saved when lives were short gets everyone aged up to match the new, longer lives.
    if (s.ageModel !== 2) {
      const grown = this.cfg.daysToAdult;
      for (const v of this.villagers) {
        if (v.stage === 'adult') {
          const asAdult = Math.max(0, this.day - (v.adultDay ?? this.day));
          const days = v.founder ? 36 : grown + 2 + asAdult;
          v.bornDay = this.day - days;
        }
        v.lifespan = this.newLifespan();
        v.oldNoted = false;
      }
    }
    // A world saved before animals existed gets its wildlife now.
    if (!s.animals) { this.rebuildGrids(); this.seedWildlife(); }
  }
}
