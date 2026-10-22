import { SHOP_BAYS } from '../../world/shops.js';
import { addSpot } from '../npc/agents.js';
import { Aborted, shopTalk } from './npcs.js';

// ---------- the people behind the counters of the shopfronts on Mother Teresa Rd ----------
// world/shops.js records one bay per open frontage (SHOP_BAYS); each becomes a spot that fills, while you are within ~60 m and
// the shops are open, with a keeper standing behind the counter. What they wear, say and sell follows the signboard. The shops
// whose sign fits a shop table in items.js (sweets, tea, groceries, dresses...) sell through the usual "Buy something".
const MEKHELA = [['#cdae6c', '#d8bd7f', '#8e1f2f', '#a3172b', 'silk'], ['#efe6cf', '#f3ecd9', '#1f6a45', '#b3202e', 'silk'], ['#7a1c2c', '#7a1c2c', '#d9b44a', '#d9b44a', 'cotton'], ['#2d6a4f', '#2d6a4f', '#efe3c2', '#d9b44a', 'cotton']]; // mekhela, sador, blouse, motif, fabric
const pick = (a, k) => a[k % a.length];
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/&/g, 'and');

// what some of them call out to people walking past (agents.js 'vendor'); the rest just wave
const CALLS = {
  cloth: ['New stock for Bihu! Come and look!', 'Good quality, fair price. Come in, come in!'], // footwear and garments share the cloth counter
  dresses: ['Bihu mekhela sador, new stock from Sualkuchi!', 'Come and look, the muga has just come in!'],
  sweets: ['Garam jalebi! Hot from the oil!', 'Til pitha, fresh this morning!'],
  bakery: ['Fresh bread, cake, biscuits!'],
  tea: ['Garam sah! Lal sah, doodh sah!', 'Sah khabo? A cup of tea?'],
  hotel: ['Bhat ready! Rice, dal, fish!', 'Masor tenga today, come, sit!'],
  fruit: ['Komola, kol! Oranges, bananas, sweet ones!', 'Anaras from the hills, ripe today!'],
};

// per kind of shop: role, look, how they greet you, small talk
const KEEP = {
  cloth: k => ({ role: 'vendor', app: (() => { const [m, w, b, mo, fab] = pick(MEKHELA, k); return { female: true, hairStyle: 'bun', topStyle: 'blouse', top: b, bottomStyle: 'mekhela', bottom: m, wrap: w, motif: mo, fabric: fab }; })(),
    greet: 'Nomoskar! Muga, pat and eri, all handloom from Sualkuchi. Bihu is around the corner, no?',
    chat: [['Every mekhela sador here came off a loom in Sualkuchi. Look at the border, you can count the threads in the motifs.'], ['Muga silk only gets more golden as it gets older. My mother still wears the one from her wedding.'], ['For Bihu the girls want red and gold. The boys want a new gamosa and a japi, and they all want it yesterday.']] }),
  sweets: k => ({ role: 'vendor', app: { female: false, topStyle: 'shirt', top: '#f4efe2', gamosa: k % 2 === 0 }, greet: 'Til pitha, narikol laru, jalebi straight from the oil. What will it be?',
    chat: [['The til pitha goes first in Bihu week. I start rolling at four in the morning.'], ['Jalebi is all about the syrup. Too thin and it runs, too thick and it cracks.']] }),
  bakery: k => ({ role: 'vendor', app: { female: k % 2 === 0 }, greet: 'Fresh from the oven this morning. Try a slice of cake.', chat: [['The school children come at four o\'clock and empty the whole shelf.']] }),
  tea: k => ({ role: 'vendor', app: { female: false, gamosa: true, topStyle: 'shirt' }, greet: 'Lal sah or doodh sah? The kettle never stops here.', chat: [['Assam tea, strong enough to wake the Brahmaputra.'], ['Sit on the bench outside. Everyone in Geetanagar sits there sooner or later.']] }),
  hotel: k => ({ role: 'vendor', app: { female: false, topStyle: 'tshirt', top: '#f4f4f0' }, title: 'cook', greet: 'Bhat khabo? Rice, dal, aloo pitika and masor tenga. Sit, sit.',
    chat: [['Masor tenga: fish, tomato, a little lemon. Sour, the way it should be.'], ['People come all the way from Hatigarh for my aloo pitika. Mustard oil, green chilli, nothing else.']] }),
  grocery: k => ({ role: 'vendor', app: { female: k % 3 === 0 }, greet: 'Biscuits, water, anything? Prices are fixed, smiles are free.', chat: [['If it is not on the shelf, I can get it by tomorrow. That is the promise of a Geetanagar shop.']] }),
  ration: k => ({ role: 'vendor', app: { female: false }, greet: 'Joha rice, masoor dal, mustard oil. Tell me what you need.', chat: [['Joha rice, smell it. That is how rice should smell.'], ['The dal comes from Barpeta, the rice from Nalbari. Only the sacks are from Guwahati.']] }),
  fruit: k => ({ role: 'vendor', app: { female: false, hat: 'cap' }, greet: 'Bananas, oranges, everything fresh this morning.', chat: [['The oranges are from the hills, sweet as anything. The bananas are from my uncle\'s garden.']] }),
  medical: k => ({ role: 'vendor', app: { female: k % 2 === 1, topStyle: 'shirt', top: '#f4f4f0' }, greet: 'Need something? Bring the doctor\'s slip if it is a prescription.', chat: [['Drink water, eat on time, and you will hardly need me. Bad for business, good for you.']] }),
  paper: k => ({ role: 'vendor', app: {}, greet: 'Notebooks, pens, today\'s paper. Xerox on the side.', chat: [['Exam season the queue reaches the road. Today it is quiet.']] }),
  electric: k => ({ role: 'vendor', app: { female: false }, greet: 'Chargers, bulbs, a new screen guard? I can fix it if it is broken.', chat: [['Every phone in Geetanagar has passed through my hands at least once.']] }),
  hardware: k => ({ role: 'vendor', app: { female: false }, greet: 'Paint, pipes, nails. Building something?', chat: [['Before Bihu everybody paints the gate. I sell more red than any other colour.']] }),
  salon: k => ({ role: 'vendor', app: { female: k % 2 === 0 }, greet: 'Haircut? Sit down, the chair is free.', chat: [['A Bihu haircut, now that is serious business.']] }),
  general: k => ({ role: 'vendor', app: {}, greet: 'Nomoskar! Come in, look around.', chat: [['Business is slow before noon. Everyone is at work or at school.']] }),
};

let inited = false;
function initShopkeepers() {
  if (inited) return; inited = true;
  SHOP_BAYS.forEach((b, k) => {
    const kp = (KEEP[b.kind] || KEEP.general)(k), shopTitle = titleCase(b.name);
    const onTalk = npc => shopTalk(npc).catch(e => { if (!(e instanceof Aborted)) console.error('[shopkeepers] talk', e); });
    addSpot(b.x, b.y, 7, 18, () => [{ role: kp.role, x: b.x, y: b.y, z: b.z, heading: b.heading, behavior: 'vendor', fixed: true, title: kp.title || shopTitle, appearance: kp.app,
      def: { shop: b.sells, shopTitle, greet: kp.greet, chat: kp.chat, calls: CALLS[b.sells === 'dresses' ? 'dresses' : b.kind], onTalk } }], 60);
  });
}
// the nearest frontage with a given signboard name to (x, y): where a quest can send you shopping
function nearestShop(name, x, y) {
  let best = null, bd = 1e18; for (const b of SHOP_BAYS) { if (b.name !== name) continue; const d = (b.x - x) ** 2 + (b.y - y) ** 2; if (d < bd) { bd = d; best = b; } }
  return best;
}

export { initShopkeepers, nearestShop };
