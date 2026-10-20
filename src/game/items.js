import { emit } from './core/bus.js';
import { addItem, hasItem, removeItem, spend, state } from './core/state.js';
import { sfx } from './audio.js';
import { showShop, toast } from './hud.js';
import { addBuff } from './player.js';

// ---------- items: what they cost, what they do ----------
const fill = () => { state.stamina = 1; };
const eat = n => { state.stamina = Math.min(1, (state.stamina == null ? 1 : state.stamina) + n); };
const HEADLINES = [
  'Bihu committees start dhol rehearsals in every neighbourhood',
  'Waterlogging warning for low-lying lanes after tonight\'s rain',
  'Assam win a last-over thriller in the Ranji match',
  'New city bus route will link Hatigarh with Paltan Bazaar',
  'Til pitha and jalebi sellers expect a busy week before Bihu',
  'Gamosa weavers\' fair opens, with demonstrations at the looms',
  'Morning mist over the Brahmaputra; carry a light jacket',
  'Local boys\' football academy lifts the district under-14 cup',
  'Residents ask for a speed breaker near the Children\'s Park',
  'Tea prices steady, says the Guwahati auction centre',
];
const pickLine = a => a[Math.floor(Math.random() * a.length)];

const ITEMS = {
  lal_sah: { name: 'Lal sah', price: 10, desc: 'Red tea, hot and strong. Full stamina and a short burst of speed.', use() { fill(); addBuff('speed', 60); return 'The lal sah wakes you up. You feel quick on your feet.'; } },
  doodh_sah: { name: 'Doodh sah', price: 15, desc: 'Milky sweet tea. Full stamina, and you tire slowly for a while.', use() { fill(); addBuff('stamina', 90); return 'Warm doodh sah. You feel like you could walk all day.'; } },
  samosa: { name: 'Samosa', price: 15, desc: 'Crisp, spicy and still hot. A good bite of stamina.', use() { eat(0.5); return 'The samosa hits the spot.'; } },
  pitha: { name: 'Til pitha', price: 20, desc: 'Sesame and jaggery rolled in rice flour. Sweet and filling.', use() { eat(0.4); return 'Til pitha, soft outside and sweet inside.'; } },
  jalebi: { name: 'Jalebi', price: 20, desc: 'Orange spirals dipped in syrup. A quick sugar boost.', use() { eat(0.3); return 'Sticky, sweet and gone in a minute.'; } },
  water: { name: 'Water bottle', price: 10, desc: 'Cold drinking water. Full stamina.', use() { fill(); return 'Cold water. Much better.'; } },
  banana: { name: 'Banana', price: 5, desc: 'A small ripe banana. Cows like them too.', use() { eat(0.2); return 'A sweet little banana.'; } },
  biscuits: { name: 'Biscuits', price: 10, desc: 'A packet of glucose biscuits. Dogs will follow you for these.', hint: 'Better to keep these for a hungry dog.' },
  marigold: { name: 'Marigold garland', price: 20, desc: 'A fresh orange garland for a puja.', hint: 'Keep it for the puja.' },
  newspaper: { name: 'Newspaper', price: 5, desc: 'Today\'s paper. Light local reading.', use() { return `Headline: ${pickLine(HEADLINES)}`; }, ms: 6500 },
  cash_bag: { name: 'Cash bag', price: 0, desc: 'Someone\'s bag of cash. Handle with care.', hint: 'This is not yours to open.' },
  parcel: { name: 'Parcel', price: 0, desc: 'A wrapped parcel waiting at somebody\'s door.', hint: 'Deliver it to the address.' },
};

// ---------- shops ----------
const SHOPS = {
  tea_stall: { name: 'Bina\'s Tea Stall', owner: 'Bina Baideu', items: ['lal_sah', 'doodh_sah', 'pitha', 'biscuits'] },
  pan_tea: { name: 'Pan & Tea', owner: 'Khagen Da', items: ['lal_sah', 'water', 'newspaper'] },
  store: { name: 'Mamoni\'s Store', owner: 'Mamoni', items: ['biscuits', 'water', 'newspaper', 'banana'] },
  snacks: { name: 'Snacks Corner', owner: 'Rupa Khuri', items: ['samosa', 'jalebi', 'pitha'] },
  fruits: { name: 'Hari\'s Fruit Stall', owner: 'Hari', items: ['banana', 'water'] },
  flower_cart: { name: 'Flower Cart', owner: 'Jonali', items: ['marigold'] },
  hatigarh_kiosk: { name: 'Hatigarh Kiosk', owner: 'the kiosk owner', items: ['biscuits', 'water', 'newspaper'] },
  sweets: { name: 'Hatigarh Sweet Stall', owner: 'the sweet seller', items: ['jalebi', 'pitha'] },
};

// resolves when the shop closes; a forced close (pause, day change) resolves it with null and changes nothing
async function openShop(shopId) {
  const shop = SHOPS[shopId]; if (!shop) return;
  const items = shop.items.filter(id => ITEMS[id]).map(id => ({ id, name: ITEMS[id].name, price: ITEMS[id].price, desc: ITEMS[id].desc }));
  const onBuy = id => {
    const it = ITEMS[id]; if (!it || !shop.items.includes(id)) return 'Not sold here';
    if (!spend(it.price)) return 'Not enough money';
    addItem(id, 1); emit('shop:bought', { shopId, id, price: it.price }); sfx('coin');
    return true;
  };
  try { await showShop({ title: shop.name, subtitle: `Run by ${shop.owner}`, items, onBuy }); } catch (err) { console.error('[shop]', err); }
}

function useItem(id) {
  const it = ITEMS[id]; if (!it) return false;
  if (!it.use) { if (it.hint) toast(it.hint, { kind: 'info' }); return false; }
  if (!hasItem(id)) return false;
  removeItem(id, 1);
  const msg = it.use();
  emit('item:used', { id }); sfx('ui');
  toast(msg || `You used the ${it.name.toLowerCase()}.`, { kind: 'good', ms: it.ms });
  return true;
}

export { ITEMS, SHOPS, openShop, useItem };
