import * as THREE from 'three';
import { scene } from '../core/context.js';
import { P, hAt, hash2, rng } from '../core/geo.js';
import { addCollider, normalsOf } from './geom.js';
import { MAINP, hw, nearestOnMain } from './mainroad.js';
import { MAT, box, canvasTex, std } from './materials.js';
import { facadeMaterials } from './bldg/facades.js';
import { MeshBuilder } from './bldg/mesh.js';

// ---------- roadside kiosks: behind the footpath railing, not on it ----------
function kioskTex(name, bg, fg) {
  return canvasTex(256, 64, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = 'bold 26px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, w / 2, h / 2 + 1); g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8); }, false);
}
const GOODS = ['#d23b2f', '#f2c12e', '#2f8f4e', '#2a63b5', '#f07b22', '#8b2fa8', '#ffffff', '#e8457e'].map(c => new THREE.Color(c));
function kiosk(x, y, ang, body, name, signBg, signFg) {
  const g = new THREE.Group(), W = 2.4, D = 1.7, H = 2.2, bm = std(body, { roughness: 0.6 });
  const back = box(W, H, 0.06, bm); back.position.set(0, H / 2, -D / 2); g.add(back);
  for (const s of [-1, 1]) { const side = box(0.06, H, D, bm); side.position.set(s * W / 2, H / 2, 0); g.add(side); }
  const floor = box(W, 0.5, D, bm); floor.position.set(0, 0.25, 0); g.add(floor);
  const counter = box(W, 0.08, 0.5, std('#c9b48a')); counter.position.set(0, 1.0, D / 2 - 0.1); g.add(counter);
  const front = box(W, 0.5, 0.06, bm); front.position.set(0, 0.75, D / 2); g.add(front);
  // shelves of packets and bottles
  const r = rng(Math.floor(x * 13 + y));
  for (const sh of [1.25, 1.65, 2.0]) {
    const shelf = box(W - 0.15, 0.04, 0.35, std('#8a6a48')); shelf.position.set(0, sh, -D / 2 + 0.25); g.add(shelf);
    for (let k = 0; k < 9; k++) { const it = box(0.16 + r() * 0.08, 0.18 + r() * 0.14, 0.14, std(GOODS[Math.floor(r() * GOODS.length)].getStyle())); it.position.set(-W / 2 + 0.25 + k * 0.24, sh + 0.11, -D / 2 + 0.25); g.add(it); }
  }
  // hanging snack strips
  for (let k = 0; k < 7; k++) { const s = box(0.18, 0.7, 0.01, std(GOODS[k % GOODS.length].getStyle())); s.position.set(-W / 2 + 0.3 + k * 0.3, H - 0.45, D / 2 - 0.05); g.add(s); }
  // tin roof sloping forward with an overhang, and the signboard
  const roof = box(W + 0.5, 0.05, D + 0.9, MAT.tin); roof.position.set(0, H + 0.12, 0.3); roof.rotation.x = 0.12; g.add(roof);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.55, 0.06), [bm, bm, bm, bm, new THREE.MeshStandardMaterial({ map: kioskTex(name, signBg, signFg) }), bm]);
  sign.position.set(0, H + 0.48, D / 2 + 0.55); g.add(sign);
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 10), std('#2f6fb3')); stool.position.set(W / 2 + 0.5, 0.22, D / 2 + 0.3); g.add(stool);
  g.position.set(x, hAt(x, y), -y); g.rotation.y = ang; g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
  const c = Math.cos(ang), s = Math.sin(ang), pts = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]].map(([u, v]) => [x + u * c + v * s, y + u * s - v * c]);
  // local z (toward the road) maps to -y in world when ang = 0
  for (let i = 0; i < 4; i++) addCollider(pts[i], pts[(i + 1) % 4]);
}
function buildKiosks() {
  const spots = [[24, '#b8322b', 'PAN & TEA', '#ffe14a', '#b8322b'], [31, '#e1b52e', 'STORE', '#1f4fa3', '#ffffff'], [-44, '#d8642c', 'SNACKS', '#ffffff', '#c0392b'], [-37, '#2f7d4f', 'FRUITS', '#ffd23f', '#1d5a35']];
  for (const [kx, col, name, bg, fg] of spots) {
    const [, i] = nearestOnMain(kx, -50); const p = MAINP[i], n = normalsOf(MAINP)[i];
    const side = n[1] > 0 ? 1 : -1, off = hw(i) + 1.6;
    const x = p[0] + n[0] * side * off, y = p[1] + n[1] * side * off;
    kiosk(x, y, Math.atan2(-n[0] * side, n[1] * side), col, name, bg, fg);
  }
}


// ---------- shopfronts on Mother Teresa Rd ----------
// Ground floors facing the main road: RCC pillars between bays, a raised concrete step, rolling shutters
// (open, half down or closed) in front of painted interiors, one big flex signboard per frontage and
// tarpaulin awnings. Names are generic placeholders except the SBI branch, which is on the map.
const SHOP_NAMES = ['GUPTA GENERAL STORE', 'MAA MEDICAL HALL', 'SHARMA SWEETS', 'NEW FASHION TAILORS', 'DAS HARDWARE', 'BORA STATIONERY', 'MOBILE CARE', 'JYOTI ELECTRICALS',
  'FRESH FRUITS', 'ASSAM TEA STALL', 'UNIQUE XEROX', 'STYLE SALOON', 'SMILE DENTAL CLINIC', 'BAKERY & CAKES', 'KALITA RATION STORE', 'STATE BANK OF INDIA',
  'NEW LAXMI VARIETY', 'MEDICOS & SURGICALS', 'SAIKIA ENTERPRISE', 'GANESH PAINTS', 'ROYAL FOOTWEAR', 'NEW SIGNATURE MOBILE', 'PATHAK BOOK STALL', 'BARUAH OPTICALS',
  'MAA KAMAKHYA HOTEL', 'GREEN VALLEY PHARMACY', 'HAPPY KIDS GARMENTS', 'MAHALAXMI JEWELLERS', 'SUNRISE CYBER CAFE', 'CITY GLASS HOUSE', 'TRIPTI RESTAURANT', 'NEW ASSAM DRESSES'];
const TAGS = ['Grocery • Cold Drinks • Recharge', 'Medicines • Surgicals • Baby Food', 'Sweets • Snacks • Curd', 'Ladies & Gents Tailoring', 'Paints • Sanitary • Hardware', 'Books • Stationery • Xerox',
  'Mobile Repair • Accessories', 'Wiring • Fans • LED', 'Fruits & Vegetables', 'Tea • Snacks • Lunch', 'Xerox • Lamination • Print', 'Ladies & Gents Parlour', 'Dental Care • X-Ray', 'Cakes • Pastries • Bread',
  'Rice • Dal • Oil', '', 'Cosmetics • Gifts • Toys', 'Open 24 Hours', 'Building Materials', 'Paints • Hardware', 'Shoes • Chappals • Bags', 'Mobiles • Sim • Recharge', 'Text Books • Notebooks', 'Spectacles • Eye Test',
  'Rice • Fish • Thali', 'Medicines • Generic', 'Kids Wear • School Uniform', 'Gold • Silver', 'Internet • Online Forms', 'Glass • Aluminium • Frames', 'Veg & Non-Veg', 'Mekhela Sador • Sarees'];
const BANK_SIGN = 15;
const SIGN_COLS = [['#c62828', '#ffffff', '#ffd54f'], ['#f9c80e', '#b71c1c', '#1a237e'], ['#1565c0', '#ffffff', '#ffeb3b'], ['#2e7d32', '#ffffff', '#ffeb3b'], ['#ffffff', '#c62828', '#1565c0'],
  ['#6a1b9a', '#ffeb3b', '#ffffff'], ['#ef6c00', '#ffffff', '#1b1b1b'], ['#00838f', '#ffffff', '#ffeb3b'], ['#ad1457', '#ffffff', '#ffe082'], ['#283593', '#ffeb3b', '#ffffff'], ['#f5f0e1', '#1b5e20', '#c62828'], ['#212121', '#ffc107', '#ffffff']];
const signAtlas = canvasTex(2048, 2048, (g) => {
  const r = rng(77);
  for (let i = 0; i < 32; i++) {
    const x = (i % 2) * 1024, y = Math.floor(i / 2) * 128, [bg, fg, ac] = i === BANK_SIGN ? ['#1d5fa8', '#ffffff', '#ffffff'] : SIGN_COLS[(i * 5) % SIGN_COLS.length];
    g.fillStyle = bg; g.fillRect(x, y, 1024, 128);
    // printed flex: a lighter swoosh, an accent bar, a round badge
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.moveTo(x, y + 128); g.quadraticCurveTo(x + 400, y + 40, x + 1024, y + 90); g.lineTo(x + 1024, y + 128); g.fill();
    g.fillStyle = ac; g.fillRect(x, y + 112, 1024, 6);
    if (i !== BANK_SIGN) { g.beginPath(); g.arc(x + 70, y + 58, 44, 0, 7); g.fill(); g.fillStyle = bg; g.font = 'bold 44px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(SHOP_NAMES[i][0], x + 70, y + 60); }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 64; g.font = `bold ${fs}px Arial Black, Arial, sans-serif`; while (g.measureText(SHOP_NAMES[i]).width > 800 && fs > 30) { fs -= 2; g.font = `bold ${fs}px Arial Black, Arial, sans-serif`; }
    g.fillText(SHOP_NAMES[i], x + 560, y + (TAGS[i] ? 46 : 60));
    if (TAGS[i]) { g.font = 'bold 24px Arial, sans-serif'; g.fillStyle = ac; g.fillText(TAGS[i], x + 560, y + 92); }
    // sun fading, dust and creases
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, y, 1024, 50);
    for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`; g.fillRect(x + r() * 1024, y, 2 + r() * 3, 128); }
    g.fillStyle = 'rgba(60,50,40,0.18)'; g.fillRect(x, y + 118, 1024, 10);
  }
}, false);
// interiors (top row) and rolling shutters (bottom row), 512 x 512 each
const INTERIORS = 4, SHUTTERS = 4;
const shopAtlas = canvasTex(2048, 1024, (g) => {
  const r = rng(9), PK = ['#d23b2f', '#f2c12e', '#2f8f4e', '#2a63b5', '#f07b22', '#e8457e', '#eeeeee', '#7a4fa0', '#c9a227'];
  for (let k = 0; k < INTERIORS; k++) {
    const x = k * 512, bx0 = x + 110, bx1 = x + 402, by0 = 90, by1 = 330; // back wall in one-point perspective
    g.fillStyle = ['#d9d2c0', '#e6e4dc', '#cfd8d2', '#d8cfc0'][k]; g.fillRect(x, 0, 512, 512);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(bx0, by0); g.lineTo(bx0, by1); g.lineTo(x, 512); g.fill(); g.beginPath(); g.moveTo(x + 512, 0); g.lineTo(bx1, by0); g.lineTo(bx1, by1); g.lineTo(x + 512, 512); g.fill();
    g.fillStyle = '#f2f0ea'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 512, 0); g.lineTo(bx1, by0); g.lineTo(bx0, by0); g.fill();                   // ceiling
    g.fillStyle = '#b9b2a4'; g.beginPath(); g.moveTo(x, 512); g.lineTo(x + 512, 512); g.lineTo(bx1, by1); g.lineTo(bx0, by1); g.fill();               // tiled floor
    g.fillStyle = '#ffffff'; g.fillRect(x + 190, 28, 130, 9); g.fillRect(x + 160, 58, 190, 7);                                                       // tube lights
    if (k === 1) { // clothes: garments on rails
      for (let row = 0; row < 2; row++) for (let i = 0; i < 12; i++) { g.fillStyle = PK[Math.floor(r() * PK.length)]; g.fillRect(bx0 + 6 + i * 24, by0 + 20 + row * 110, 20, 80 + r() * 10); }
      g.fillStyle = '#555'; g.fillRect(bx0, by0 + 18, bx1 - bx0, 3); g.fillRect(bx0, by0 + 128, bx1 - bx0, 3);
    } else { // shelves of packets, bottles and boxes on the back and side walls
      for (let sy = by0 + 10; sy < by1 - 20; sy += 46) {
        g.fillStyle = '#7a634a'; g.fillRect(bx0, sy + 38, bx1 - bx0, 5);
        for (let i = bx0 + 3; i < bx1 - 10; i += 11 + r() * 6) { g.fillStyle = k === 2 ? (r() < 0.6 ? '#f4f4f0' : PK[Math.floor(r() * PK.length)]) : PK[Math.floor(r() * PK.length)]; const hh = 14 + r() * 22; g.fillRect(i, sy + 38 - hh, 9 + r() * 6, hh); }
      }
      for (const s of [-1, 1]) for (let j = 0; j < 5; j++) { // side wall shelves
        const t = j / 5; g.fillStyle = PK[Math.floor(r() * PK.length)];
        const sx = s < 0 ? x + 20 + t * 70 : x + 492 - t * 70 - 30; g.fillRect(sx, 120 + j * 55, 30, 34);
      }
    }
    // counter across the front
    g.fillStyle = ['#8a6a48', '#6d7f8c', '#d8d8d2', '#a0522d'][k]; g.fillRect(x + 30, 380, 452, 132);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 30, 380, 452, 10);
    if (k === 0 || k === 3) for (let i = 0; i < 9; i++) { g.fillStyle = PK[Math.floor(r() * PK.length)]; g.fillRect(x + 50 + i * 48, 320 + r() * 20, 34, 60); } // jars and crates on the counter
    if (k === 2) { g.fillStyle = 'rgba(180,220,230,0.35)'; g.fillRect(x + 40, 395, 432, 90); }
  }
  for (let k = 0; k < SHUTTERS; k++) { // corrugated rolling shutters: galvanised, blue, green, rusty
    const x = k * 512, base = ['#a3a8aa', '#5c7a96', '#6f8a6a', '#8f8a80'][k];
    g.fillStyle = base; g.fillRect(x, 512, 512, 512);
    for (let y = 512; y < 1024; y += 12) { g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y, 512, 3); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + 9, 512, 3); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${k === 3 ? '120,70,40' : '60,55,50'},${0.05 + r() * 0.12})`; const w = 10 + r() * 80; g.fillRect(x + r() * 512, 512 + r() * 512, w, 10 + r() * 140); }
    const gr = g.createLinearGradient(0, 512, 0, 1024); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(110,90,70,0.35)'); g.fillStyle = gr; g.fillRect(x, 512, 512, 512);
  }
}, false);
// awning fabric: plain tarpaulin (left half) and striped canvas (right half), greyscale for vertex tint
const awningTex = canvasTex(512, 256, (g) => {
  g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 512, 256); const r = rng(4);
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.06})`; g.fillRect(r() * 256, 0, 2 + r() * 8, 256); }
  for (let x = 256; x < 512; x += 32) { g.fillStyle = '#ffffff'; g.fillRect(x, 0, 16, 256); g.fillStyle = '#8a8a8a'; g.fillRect(x + 16, 0, 16, 256); }
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(0,0,0,0.15)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
}, false);

function buildShopfronts(list) {
  const FM = facadeMaterials();
  const inter = new MeshBuilder(), shut = new MeshBuilder(), sign = new MeshBuilder(), awn = new MeshBuilder(), trim = new MeshBuilder();
  const WHITE = new THREE.Color(1, 1, 1), GREY = new THREE.Color('#6f7375'), STEP = new THREE.Color('#a9a59c'), FRAME = new THREE.Color('#3c3f42');
  const tarp = ['#2f6fb3', '#2f6fb3', '#3f7fbf', '#2e7d32', '#c62828', '#d9a520', '#00838f', '#8b8f93'].map(c => new THREE.Color(c));
  let si = 0;
  for (const b of list) {
    const pts = b.pts, top = b.top;
    for (const ei of b.edges) {
      const a = pts[ei], c = pts[(ei + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const u = [(c[0] - a[0]) / L, (c[1] - a[1]) / L], n = [u[1], -u[0]]; // outward for CCW polygons
      const gmin = Math.min(hAt(a[0], a[1]), hAt(c[0], c[1]));
      const bays = Math.max(1, Math.round(L / 3.4)), bw = L / bays, H = 2.75;
      const pc = b.wall.clone().multiplyScalar(0.9);
      const P = (al, d, z) => [a[0] + u[0] * al + n[0] * d, a[1] + u[1] * al + n[1] * d, z];
      // raised concrete step along the frontage, RCC pillars between the bays
      trim.box(a, u, n, 0, L, -0.02, 0.75, Math.min(gmin, top) - 0.4, top + 0.02, STEP, 'ftlr', gmin);
      for (let k = 0; k <= bays; k++) trim.box(a, u, n, k * bw - (k === 0 ? 0 : 0.17), k * bw + (k === bays ? 0 : 0.17), -0.02, 0.1, top, top + 2.98, pc, 'ftlr', top);
      for (let k = 0; k < bays; k++) {
        const al0 = k * bw + 0.17, al1 = (k + 1) * bw - 0.17;
        const hsh = hash2(a[0] + k * 3.7, a[1] - k), state = hsh < 0.5 ? 'open' : hsh < 0.8 ? 'half' : 'closed';
        const ic = Math.floor(hash2(k + 1.3, a[0]) * INTERIORS), sc = Math.floor(hash2(a[1], k + 2.1) * SHUTTERS);
        const iu0 = ic / 4, iu1 = (ic + 1) / 4, su0 = sc / 4, su1 = (sc + 1) / 4;
        if (state !== 'closed') inter.quad(P(al0, 0.03, top), P(al1, 0.03, top), P(al1, 0.03, top + H), P(al0, 0.03, top + H), [n[0], n[1], 0], WHITE, [[iu0, 0.5], [iu1, 0.5], [iu1, 1], [iu0, 1]]);
        const f = state === 'open' ? 0.06 : state === 'half' ? 0.35 + (hsh - 0.5) * 1.2 : 1, zb = top + H * (1 - f);
        shut.quad(P(al0, 0.07, zb), P(al1, 0.07, zb), P(al1, 0.07, top + H), P(al0, 0.07, top + H), [n[0], n[1], 0], WHITE, [[su0, 0.5 - f * 0.5], [su1, 0.5 - f * 0.5], [su1, 0.5], [su0, 0.5]]);
        trim.box(a, u, n, al0, al1, 0.04, 0.1, zb - 0.05, zb + 0.02, FRAME, 'ftu', top);                                // shutter bottom bar
        trim.box(a, u, n, al0 - 0.05, al1 + 0.05, 0, 0.32, top + H, top + 2.98, GREY, 'ftu', top);                      // shutter roll housing
        // awning over most bays: sloping tarp with a front valance and two thin struts
        if (hash2(k * 1.9, a[0] + a[1]) < 0.72) {
          const col = tarp[Math.floor(hash2(a[0] + k, 3) * tarp.length)].clone().multiplyScalar(0.85 + hash2(k, a[1]) * 0.2), striped = hash2(a[1] + k, 7) < 0.25;
          const o = 1.25 + hash2(k, 5) * 0.4, zt = top + 2.95, zf = top + 2.4, s0 = striped ? 0.5 : 0, s1 = Math.min(s0 + 0.5, s0 + (al1 - al0 + 0.3) / 8);
          awn.quad(P(al0 - 0.15, 0.3, zt), P(al1 + 0.15, 0.3, zt), P(al1 + 0.15, o, zf), P(al0 - 0.15, o, zf), [n[0] * 0.4, n[1] * 0.4, 0.9], col, [[s0, 1], [s1, 1], [s1, 0.3], [s0, 0.3]]);
          awn.quad(P(al0 - 0.15, o, zf), P(al1 + 0.15, o, zf), P(al1 + 0.15, o, zf - 0.28), P(al0 - 0.15, o, zf - 0.28), [n[0], n[1], 0], col.clone().multiplyScalar(0.9), [[s0, 0.3], [s1, 0.3], [s1, 0], [s0, 0]]);
          for (const al of [al0 - 0.1, al1 + 0.1]) trim.box(P(al, 0, 0), u, n, -0.015, 0.015, 0.3, o, zf + 0.02, zf + 0.05, FRAME, 'tf', top);
        }
      }
      // signboard: one flex board across the frontage, in a thin steel frame
      let row = b.sign != null ? BANK_SIGN : si++ % 32; if (b.sign == null && row === BANK_SIGN) row = si++ % 32;
      const u0 = (row % 2) * 0.5, u1 = u0 + 0.5, v1 = 1 - Math.floor(row / 2) / 16, v0 = v1 - 1 / 16;
      const sh = Math.min(1.15, 0.85 + L * 0.02), z0 = top + 3.0, z1 = z0 + sh;
      sign.quad(P(0.1, 0.2, z0), P(L - 0.1, 0.2, z0), P(L - 0.1, 0.2, z1), P(0.1, 0.2, z1), [n[0], n[1], 0], WHITE, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      trim.box(a, u, n, 0.06, L - 0.06, 0.1, 0.19, z0 - 0.04, z1 + 0.04, FRAME, 'tulr', top);
    }
  }
  inter.mesh(new THREE.MeshStandardMaterial({ map: shopAtlas, emissive: '#ffffff', emissiveMap: shopAtlas, emissiveIntensity: 0.22, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { cast: false });
  shut.mesh(new THREE.MeshStandardMaterial({ map: shopAtlas, roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), { cast: false });
  sign.mesh(new THREE.MeshStandardMaterial({ map: signAtlas, roughness: 0.55, emissive: '#ffffff', emissiveMap: signAtlas, emissiveIntensity: 0.12, side: THREE.DoubleSide }));
  awn.mesh(new THREE.MeshStandardMaterial({ map: awningTex, vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }));
  trim.mesh(FM.trim);
}

export { kioskTex, kiosk, buildKiosks, buildShopfronts, GOODS, SHOP_NAMES, SIGN_COLS, signAtlas, shopAtlas };
