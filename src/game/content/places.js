import { GEO } from '../../core/geo.js';
import { asphHalf, nearestOnMain } from '../../world/mainroad.js';
import { beside } from '../../world/streetlife.js';
import { DECK } from '../../world/deck.js';

// ---------- named places to discover (walk inside the radius and you get a toast and a few rupees) ----------
// kind: landmark, temple, school, shop, travel, view. Most come straight from GEO.labels so they follow any label fix.
const label = t => { const l = GEO.labels.find(l => l.t === t); return l ? [l.x, l.y] : null; };
const [fx0, fy0, fx1, fy1] = GEO.field;
const bus = (GEO.labels.find(l => l.t === 'Geetanagar Bus Stand') || { x: -57, y: -74 });
// the tea stall sits on the park forecourt, south of the road (same offset streetlife.js uses for it)
const teaStall = (() => { try { const [, i] = nearestOnMain(-121, -70); const [x, y] = beside(-121, -1, asphHalf(i) + 3.6); return [x, y]; } catch (e) { return [-121, -79]; } })();

const RAW = [
  ['field', 'Geetanagar Field', (fx0 + fx1) / 2, (fy0 + fy1) / 2, 38, 'landmark'],
  ['mandir', 'Mandir Gate', 49.5, -33.5, 20, 'temple'],
  ['viewpoint', 'View Point', DECK.cx, DECK.cy, 18, 'view'],
  ['park', "Children's Park", ...(label("Lakhipriya Devi Baruani Children's Park") || [-105.4, -93.9]), 36, 'landmark'],
  ['tea_stall', "Park Forecourt Tea Stall", teaStall[0], teaStall[1], 14, 'shop'],
  ['hatigarh', 'Hatigarh Chariali', ...(label('Hatigarh Chariali') || [-499.7, -78]), 40, 'travel'],
  ['hat_stalls', 'Hatigarh Stall Row', -489.3, -50.4, 18, 'shop'],
  ['busstand', 'Geetanagar Bus Stand', bus.x, bus.y, 18, 'travel'],
  ['sbi', 'SBI Branch Gitanagar', ...(label('SBI Branch Gitanagar') || [168.9, -172.2]), 24, 'landmark'],
  ['sbi_atm', 'SBI ATM', ...(label('SBI ATM') || [-340, -78]), 15, 'shop'],
  ['fss', 'Faculty Senior Secondary School', ...(label('Faculty Senior Secondary School') || [119.2, 241.2]), 30, 'school'],
  ['kanya', 'Kanya Mahavidyalaya', ...(label('Kanya Mahavidyalaya') || [-78.9, 83.6]), 30, 'school'],
  ['high_school', 'Geetanagar High School', ...(label('Geetanagar High School') || [-45, 24.4]), 28, 'school'],
  ['lp_school', 'Geetanagar LP School', ...(label('Geetanagar LP School') || [-68, 16]), 20, 'school'],
  ['sparsh', 'Sparsh High & Day Care', ...(label('Sparsh High & Day Care') || [6, -41]), 16, 'school'],
  ['sarbojonin', 'Sarbojonin Namghar', ...(label('Sarbojonin Namghar') || [-100, 115]), 25, 'temple'],
  ['rajohua', 'Rajohua Namghar', ...(label('Rajohua Namghar') || [239.2, 83.6]), 25, 'temple'],
  ['akanir', 'Akanir Namghar', ...(label('Akanir Namghar') || [433, -125]), 25, 'temple'],
  ['hat_namghar', 'Hatigarh Sarbojanin Namghar', ...(label('Hatigarh Sarbojanin Namghar') || [-729, 93]), 25, 'temple'],
  ['bura_gosai', 'Sri Sri Bura Gosai Than', ...(label('Sri Sri Bura Gosai Than') || [-746, 42]), 25, 'temple'],
  ['jagannath', 'Jagannath Mandir', ...(label('Bishnupriya Manipuri Jagannath Mandir') || [-228.4, 300.4]), 25, 'temple'],
  ['alakh_niranjan', 'Alakh Niranjan Shiv Mandir', ...(label('Alakh Niranjan Shiv Mandir') || [-510, 318]), 25, 'temple'],
  ['shiv_mandir', 'Shiv Mandir', ...(label('Shiv Mandir') || [-315, 251]), 25, 'temple'],
  ['sai_baba', 'Sai Baba and Shiv Mandir', ...(label('Sai Baba And Shiv Mandir') || [-150, -321]), 25, 'temple'],
  ['banquet', 'Jonaki Kareng Banquet Garden', ...(label('Jonaki Kareng Banquet Garden') || [-183.4, -185.1]), 30, 'landmark'],
  ['salsa', 'Shanghai Salsa', ...(label('Shanghai Salsa') || [-512.5, -130.8]), 20, 'shop'],
  ['tennis', 'Tennis Social', ...(label('Tennis Social') || [248.2, -188.5]), 25, 'landmark'],
];
const PLACES = RAW.map(([id, name, x, y, r, kind]) => ({ id, name, x, y, r, kind }));
const PLACE_BY_ID = Object.fromEntries(PLACES.map(p => [p.id, p]));

export { PLACES, PLACE_BY_ID };
