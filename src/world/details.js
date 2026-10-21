import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../core/context.js';
import { hAt, hash2, pointInPoly, rng } from '../core/geo.js';
import { VEG_U } from '../veg/wind.js';
import { ROOFS, tanks } from './buildings.js';
import { GATE_POSTS, PIL, WALL_FACES } from './compound.js';
import { canvasTex } from './materials.js';

// ================= the small things: posters and painted ads on the boundary walls, pots on the copings, house name plates
// on the gate pillars, DTH dishes on the parapets and washing drying on the roofs =================
// All of it is seeded per wall piece, gate or roof, so the town looks the same every visit. Nothing here has a collider.
const W = (x, y, h) => [x, h, -y]; // map (x, y) and height to world
const pick = (r, a) => a[Math.floor(r() * a.length)];
const seedOf = (x, y, k = 0) => rng(Math.floor(hash2(x * 1.37 + k, y * 0.91 - k) * 1e9));

// ---------- a flat-shaded quad accumulator ----------
const acc = () => ({ p: [], n: [], u: [], c: [], i: [], w: [] });
// v: 4 world corners (bl, br, tr, tl), uv: 4 pairs, nrm: world normal, wind: optional per-corner [sway, flutter, phase]
function quad(A, v, uv, nrm, col, wind) {
  const k = A.p.length / 3;
  v.forEach((q, j) => { A.p.push(q[0], q[1], q[2]); A.n.push(nrm[0], nrm[1], nrm[2]); A.u.push(uv[j][0], uv[j][1]); A.c.push(col.r, col.g, col.b); if (wind) A.w.push(...wind[j]); });
  A.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
}
function geom(A) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(A.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3));
  if (A.w.length) g.setAttribute('aCloth', new THREE.Float32BufferAttribute(A.w, 3));
  g.setIndex(A.i); g.computeBoundingSphere(); return g;
}
// a rectangle on a vertical face: centre (x, y) at height y0..y0+h, width w along R = right as seen from the front, normal (nx, ny); roll in radians
function facePlate(A, x, y, nx, ny, w, y0, h, cell, col, roll = 0) {
  const rx = -ny, ry = nx, cx = 0, cy = y0 + h / 2, c = Math.cos(roll), s = Math.sin(roll);
  const corner = (du, dv) => { const u = du * c - dv * s, v = du * s + dv * c; return W(x + rx * u, y + ry * u, cy + v); };
  quad(A, [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)], cell, [nx, 0, -ny], col);
}

// ---------- the poster atlas: what gets stuck and painted on walls in Geetanagar ----------
// [px x, y, w, h] in a 1024 x 1024 canvas, size in metres, and where it goes: 'paper' (posters at eye level, often in clusters),
// 'paint' (painted straight onto a long plain wall), 'gate' (beside a gate), 'flex' (a printed banner tied to the wall)
const ATLAS = 1024;
const POSTERS = [
  { r: [0, 0, 220, 320], m: [0.42, 0.6], at: 'paper', draw: (g, x, y, w, h) => { paper(g, x, y, w, h, '#fbf6dc'); txt(g, 'TUITION', x + w / 2, y + 52, 'bold 44px sans-serif', '#c0271f'); txt(g, 'Class V to X', x + w / 2, y + 110, 'bold 24px sans-serif', '#1f2f6a'); txt(g, 'All Subjects', x + w / 2, y + 146, '22px sans-serif', '#1f2f6a'); txt(g, 'Assamese & English', x + w / 2, y + 182, '19px sans-serif', '#333'); txt(g, 'medium', x + w / 2, y + 206, '19px sans-serif', '#333'); txt(g, 'Seats limited!', x + w / 2, y + 252, 'italic bold 22px sans-serif', '#c0271f'); txt(g, 'near Geetanagar High School', x + w / 2, y + 292, '14px sans-serif', '#555'); } },
  { r: [224, 0, 220, 320], m: [0.42, 0.6], at: 'paper', draw: (g, x, y, w, h) => { paper(g, x, y, w, h, '#fff4d6'); band(g, x, y, w, 46, '#b3202a'); band(g, x, y + h - 30, w, 30, '#1f7a3a'); txt(g, 'RONGALI BIHU', x + w / 2, y + 32, 'bold 26px serif', '#fff2c0'); japi(g, x + w / 2, y + 120, 52); txt(g, 'UTSAV 2026', x + w / 2, y + 206, 'bold 28px serif', '#b3202a'); txt(g, 'Geetanagar Bihu Sanmilan', x + w / 2, y + 236, 'bold 15px sans-serif', '#1f2f2f'); txt(g, 'Husori - Bihu Nas - Dhulia', x + w / 2, y + 262, '14px sans-serif', '#333'); txt(g, 'at the field', x + w / 2, y + h - 10, 'bold 15px sans-serif', '#fff'); } },
  { r: [448, 0, 220, 320], m: [0.42, 0.6], at: 'paper', draw: (g, x, y, w, h) => { paper(g, x, y, w, h, '#eef4fb'); band(g, x, y, w, 70, '#1d4f9c'); txt(g, 'BRIGHT STAR', x + w / 2, y + 32, 'bold 28px sans-serif', '#fff'); txt(g, 'ACADEMY', x + w / 2, y + 60, 'bold 20px sans-serif', '#ffd84a'); txt(g, 'Class XI - XII', x + w / 2, y + 112, 'bold 22px sans-serif', '#1d4f9c'); txt(g, 'Science', x + w / 2, y + 142, '22px sans-serif', '#1d4f9c'); txt(g, 'JEE - NEET - CEE', x + w / 2, y + 190, 'bold 21px sans-serif', '#c0271f'); band(g, x + 20, y + 230, w - 40, 40, '#ffd84a'); txt(g, 'ADMISSION OPEN', x + w / 2, y + 257, 'bold 18px sans-serif', '#1d4f9c'); } },
  { r: [672, 0, 220, 320], m: [0.42, 0.6], at: 'paper', draw: (g, x, y, w, h) => { paper(g, x, y, w, h, '#ffffff'); txt(g, 'VOLUNTARY', x + w / 2, y + 36, 'bold 22px sans-serif', '#b3121f'); txt(g, 'BLOOD DONATION', x + w / 2, y + 64, 'bold 22px sans-serif', '#b3121f'); txt(g, 'CAMP', x + w / 2, y + 92, 'bold 22px sans-serif', '#b3121f'); drop(g, x + w / 2, y + 160, 34); txt(g, 'Sunday, 9 am - 2 pm', x + w / 2, y + 232, 'bold 17px sans-serif', '#222'); txt(g, 'Namghar premises', x + w / 2, y + 258, '16px sans-serif', '#222'); txt(g, 'Donate blood, save a life', x + w / 2, y + 296, 'italic 15px sans-serif', '#b3121f'); } },
  { r: [896, 0, 128, 180], m: [0.24, 0.34], at: 'paper', draw: (g, x, y, w, h) => { paper(g, x, y, w, h, '#e9f7e4'); txt(g, 'YOGA', x + w / 2, y + 40, 'bold 30px sans-serif', '#2f7a3a'); txt(g, 'CLASS', x + w / 2, y + 68, 'bold 18px sans-serif', '#2f7a3a'); txt(g, 'every morning', x + w / 2, y + 112, '13px sans-serif', '#333'); txt(g, '6 am', x + w / 2, y + 132, 'bold 16px sans-serif', '#333'); txt(g, 'park forecourt', x + w / 2, y + 160, '12px sans-serif', '#555'); } },
  { r: [0, 324, 300, 200], m: [0.6, 0.4], at: 'gate', draw: (g, x, y, w, h) => { paper(g, x, y, w, h, '#c79e6a', 0.03); hand(g, 'TO-LET', x + w / 2, y + 78, 'bold 64px "Comic Sans MS", cursive', '#b0181c'); hand(g, '2 rooms + kitchen', x + w / 2, y + 128, '26px "Comic Sans MS", cursive', '#222'); hand(g, 'enquire inside', x + w / 2, y + 166, '22px "Comic Sans MS", cursive', '#222'); } },
  { r: [304, 324, 300, 200], m: [0.6, 0.4], at: 'paper', draw: (g, x, y, w, h) => { paper(g, x, y, w, h, '#ffffff'); band(g, x, y, w, 64, '#1f7a4a'); txt(g, 'HOMEO CLINIC', x + w / 2, y + 44, 'bold 34px sans-serif', '#fff'); txt(g, 'Evening 5 - 8 pm', x + w / 2, y + 112, 'bold 26px sans-serif', '#1f7a4a'); txt(g, 'Sunday closed', x + w / 2, y + 150, '22px sans-serif', '#444'); txt(g, 'first lane on the left', x + w / 2, y + 184, '17px sans-serif', '#666'); } },
  { r: [608, 324, 416, 200], m: [1.8, 0.86], at: 'flex', draw: (g, x, y, w, h) => { const gr = g.createLinearGradient(x, y, x + w, y); gr.addColorStop(0, '#b3202a'); gr.addColorStop(0.5, '#e0a21a'); gr.addColorStop(1, '#1f7a3a'); g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,248,225,0.92)'; g.fillRect(x + 10, y + 10, w - 20, h - 20); japi(g, x + 70, y + h / 2, 50); japi(g, x + w - 70, y + h / 2, 50); txt(g, 'Rongali Bihu Utsav', x + w / 2, y + 72, 'bold 34px serif', '#b3202a'); txt(g, '2026', x + w / 2, y + 112, 'bold 30px serif', '#1f7a3a'); txt(g, 'Geetanagar Bihu Sanmilan', x + w / 2, y + 148, 'bold 19px sans-serif', '#333'); txt(g, 'All are welcome', x + w / 2, y + 176, 'italic 17px sans-serif', '#555'); } },
  { r: [0, 528, 512, 120], m: [1.6, 0.38], at: 'paint', draw: (g, x, y, w, h) => { g.save(); g.globalAlpha = 0.85; txt(g, 'STICK NO BILLS', x + w / 2, y + 86, 'bold 76px Impact, sans-serif', '#151515'); g.restore(); } },
  { r: [512, 528, 512, 172], m: [2.4, 0.8], at: 'paint', draw: (g, x, y, w, h) => { band(g, x, y, w, h, '#f2c21b'); band(g, x, y + h - 26, w, 26, '#b3202a'); txt(g, 'LAKHIMI', x + 170, y + 82, 'bold 56px serif', '#b3202a'); txt(g, 'pure xoriyoh tel', x + 170, y + 122, 'bold 26px sans-serif', '#3a2a0a');
    g.fillStyle = '#2f7a2a'; g.fillRect(x + 360, y + 34, 84, 106); g.fillRect(x + 384, y + 20, 36, 16); g.strokeStyle = '#2f7a2a'; g.lineWidth = 6; g.beginPath(); g.arc(x + 402, y + 32, 26, Math.PI, 0); g.stroke(); // a mustard-oil tin with its handle
    g.fillStyle = '#f6e7a0'; g.fillRect(x + 368, y + 56, 68, 62); g.fillStyle = '#e8b416'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + 402 + Math.cos(k * 1.26) * 9, y + 87 + Math.sin(k * 1.26) * 9, 7, 0, 7); g.fill(); } g.fillStyle = '#b3202a'; g.beginPath(); g.arc(x + 402, y + 87, 5, 0, 7); g.fill(); txt(g, 'MUSTARD OIL', x + w / 2, y + h - 7, 'bold 18px sans-serif', '#fff'); } },
  { r: [0, 704, 512, 160], m: [2.4, 0.75], at: 'paint', draw: (g, x, y, w, h) => { band(g, x, y, w, h, '#2c5a9e'); band(g, x, y + h - 30, w, 30, '#e8e4d8'); txt(g, 'JOYMOTI', x + w / 2, y + 66, 'bold 60px sans-serif', '#ffffff'); txt(g, 'CEMENT', x + w / 2, y + 108, 'bold 34px sans-serif', '#ffd84a'); txt(g, 'strong as the hills', x + w / 2, y + h - 8, 'italic bold 20px sans-serif', '#2c5a9e'); } },
  { r: [512, 704, 512, 160], m: [1.5, 0.47], at: 'gate', draw: (g, x, y, w, h) => { band(g, x, y, w, h, '#f4f2ea'); txt(g, 'NO PARKING', x + w / 2, y + 82, 'bold 70px sans-serif', '#c0171c'); txt(g, 'gate in use, 24 hours', x + w / 2, y + 132, 'bold 30px sans-serif', '#222'); } },
];
const txt = (g, s, x, y, font, col) => { g.font = font; g.fillStyle = col; g.textAlign = 'center'; g.fillText(s, x, y); };
const hand = (g, s, x, y, font, col) => { g.save(); g.translate(x, y); g.rotate(-0.03); txt(g, s, 0, 0, font, col); g.restore(); };
const band = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
function paper(g, x, y, w, h, col, edge = 0.1) { g.fillStyle = col; g.fillRect(x, y, w, h); g.strokeStyle = `rgba(0,0,0,${edge})`; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); }
function japi(g, cx, cy, r) { // the Assamese bamboo-and-palm-leaf hat: a flat cone with red and black rings and a white diamond band
  g.fillStyle = '#d8a84a'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  for (const [f, c] of [[0.92, '#b3202a'], [0.8, '#d8a84a'], [0.62, '#1d1d1d'], [0.5, '#d8a84a'], [0.24, '#b3202a']]) { g.fillStyle = c; g.beginPath(); g.arc(cx, cy, r * f, 0, 7); g.fill(); }
  g.fillStyle = '#f4efe2'; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, x = cx + Math.cos(a) * r * 0.71, y = cy + Math.sin(a) * r * 0.71; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.fill(); }
}
function drop(g, cx, cy, r) { g.fillStyle = '#c8121f'; g.beginPath(); g.moveTo(cx, cy - r * 1.6); g.quadraticCurveTo(cx + r * 1.1, cy - r * 0.2, cx + r, cy + r * 0.3); g.arc(cx, cy + r * 0.3, r, 0, Math.PI); g.quadraticCurveTo(cx - r * 1.1, cy - r * 0.2, cx, cy - r * 1.6); g.fill(); }
function posterTex() {
  return canvasTex(ATLAS, ATLAS, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (const P of POSTERS) {
      const [x, y, pw, ph] = P.r; g.save(); g.beginPath(); g.rect(x, y, pw, ph); g.clip(); P.draw(g, x, y, pw, ph);
      if (P.at !== 'paint') { const r = rng(x * 7 + y); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,70,40,${0.03 + r() * 0.06})`; g.fillRect(x + r() * pw, y + r() * ph, 2 + r() * 14, 1 + r() * 30); } } // dirt and rain streaks
      g.restore();
    }
  }, false);
}
const cellUV = P => { const [x, y, w, h] = P.r; return [[x / ATLAS, 1 - (y + h) / ATLAS], [(x + w) / ATLAS, 1 - (y + h) / ATLAS], [(x + w) / ATLAS, 1 - y / ATLAS], [x / ATLAS, 1 - y / ATLAS]]; };

// ---------- the house names on the gate pillars ----------
const PLATES = ['Kalita Niwas', 'Shanti Kutir', 'Deka Bhawan', 'Matri Chhaya', 'Baruah Villa', 'Sarma Abas', 'Sukhanjali', 'Bora Niwas', 'Gogoi Bhawan', 'Saikia Kutir', 'Mayang', 'Hazarika Abas', 'H. No. 12', 'H. No. 27', 'H. No. 5', 'H. No. 41', 'Choudhury Niwas', 'Medhi Kutir', 'Jonaki', 'Talukdar Villa', 'H. No. 18', 'Pitri Smriti', 'Das Bhawan', 'Nilachal'];
const PLATE_STYLE = [['#1b1b1d', '#d8b45a'], ['#f2efe8', '#1b1b1d'], ['#f2efe8', '#9a1b1f'], ['#1f4f9a', '#ffffff']]; // black granite with gold, white marble, enamel blue
function plateTex() {
  return canvasTex(512, 512, (g) => {
    PLATES.forEach((name, k) => {
      const x = (k % 4) * 128, y = Math.floor(k / 4) * 64, [bg, fg] = /^H\. No/.test(name) ? PLATE_STYLE[3] : PLATE_STYLE[k % 3];
      g.fillStyle = bg; g.fillRect(x + 2, y + 2, 124, 60); g.strokeStyle = fg; g.lineWidth = 2; g.strokeRect(x + 7, y + 7, 114, 50);
      g.font = `bold ${name.length > 13 ? 15 : 18}px serif`; g.fillStyle = fg; g.textAlign = 'center'; g.fillText(name, x + 64, y + 39);
    });
  }, false);
}

// ---------- the washing: one 512 x 256 atlas of cloth, most of it tinted by vertex colour ----------
// cells (128 x 128): 0 gamosa, 1 sari folded over the line, 2 sheet, 3 striped towel, 4 shirt, 5 trousers, 6 mekhela, 7 child's frock
const CLOTH = [
  { w: [0.7, 0.8], h: [0.45, 0.55], tint: false }, { w: [1.0, 1.25], h: [0.75, 0.95], tint: true }, { w: [0.8, 1.2], h: [0.6, 0.85], tint: true },
  { w: [0.45, 0.55], h: [0.65, 0.8], tint: true }, { w: [0.55, 0.65], h: [0.62, 0.72], tint: true }, { w: [0.34, 0.4], h: [0.85, 0.95], tint: true },
  { w: [0.9, 1.05], h: [0.75, 0.85], tint: false }, { w: [0.36, 0.42], h: [0.45, 0.55], tint: true },
];
const CLOTH_COL = ['#c0392b', '#2a6fb5', '#e6b422', '#3c8a4a', '#d35d8f', '#f2f0ea', '#f2f0ea', '#7a4a8a', '#e07b39', '#5b6770', '#87a9c9', '#a7c46a'];
const DARK_COL = ['#2c2c34', '#3a3f4a', '#5b4a3c', '#23324f'];
function clothTex() {
  return canvasTex(512, 256, (g) => {
    g.clearRect(0, 0, 512, 256);
    const cell = (k, f) => { const x = (k % 4) * 128, y = Math.floor(k / 4) * 128; g.save(); g.translate(x, y); f(); g.restore(); };
    const folds = (x0, x1, y0, y1) => { for (let x = x0; x < x1; x += 9) { g.fillStyle = `rgba(0,0,0,${0.04 + (x % 27) / 300})`; g.fillRect(x, y0, 4, y1 - y0); } };
    cell(0, () => { g.fillStyle = '#f7f5ee'; g.fillRect(4, 4, 120, 120); for (const y of [12, 104]) { g.fillStyle = '#c0171c'; g.fillRect(4, y, 120, 10); } g.fillStyle = '#c0171c'; for (let x = 14; x < 120; x += 16) { g.fillRect(x, 28, 6, 6); g.fillRect(x, 92, 6, 6); } for (let x = 8; x < 124; x += 4) g.fillRect(x, 120, 2, 6); folds(4, 124, 4, 124); });
    cell(1, () => { g.fillStyle = '#ffffff'; g.fillRect(2, 2, 124, 124); g.fillStyle = '#b8b8b8'; g.fillRect(2, 104, 124, 20); g.fillStyle = '#e8e8e8'; for (let x = 6; x < 124; x += 10) g.fillRect(x, 108, 5, 5); folds(2, 126, 2, 104); });
    cell(2, () => { g.fillStyle = '#ffffff'; g.fillRect(2, 2, 124, 124); g.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 10; x < 124; x += 28) g.fillRect(x, 2, 3, 124); for (let y = 10; y < 124; y += 28) g.fillRect(2, y, 124, 3); folds(2, 126, 2, 126); });
    cell(3, () => { for (let y = 2; y < 126; y += 12) { g.fillStyle = (y / 12) % 2 < 1 ? '#ffffff' : '#c8c8c8'; g.fillRect(14, y, 100, 12); } g.fillStyle = '#ffffff'; for (let x = 16; x < 114; x += 4) g.fillRect(x, 120, 2, 7); });
    cell(4, () => { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(40, 4); g.lineTo(88, 4); g.lineTo(124, 20); g.lineTo(118, 50); g.lineTo(98, 44); g.lineTo(98, 124); g.lineTo(30, 124); g.lineTo(30, 44); g.lineTo(10, 50); g.lineTo(4, 20); g.closePath(); g.fill(); g.fillStyle = '#c4c4c4'; g.fillRect(62, 8, 4, 116); for (let y = 24; y < 120; y += 20) { g.fillStyle = '#9a9a9a'; g.fillRect(68, y, 4, 4); } g.fillStyle = '#d8d8d8'; g.fillRect(48, 4, 32, 10); });
    cell(5, () => { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(16, 4); g.lineTo(112, 4); g.lineTo(108, 124); g.lineTo(70, 124); g.lineTo(64, 40); g.lineTo(58, 124); g.lineTo(20, 124); g.closePath(); g.fill(); g.fillStyle = '#c8c8c8'; g.fillRect(16, 4, 96, 10); });
    cell(6, () => { g.fillStyle = '#efe4c4'; g.fillRect(2, 2, 124, 124); g.fillStyle = '#9a1b2a'; g.fillRect(2, 92, 124, 4); g.fillRect(2, 118, 124, 4); for (let x = 8; x < 124; x += 14) { g.beginPath(); g.moveTo(x, 98); g.lineTo(x + 6, 107); g.lineTo(x, 116); g.lineTo(x - 6, 107); g.fill(); } for (let x = 12; x < 124; x += 24) for (let y = 16; y < 84; y += 24) g.fillRect(x + ((y / 24) % 2) * 12, y, 4, 4); folds(2, 126, 2, 90); });
    cell(7, () => { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(44, 4); g.lineTo(84, 4); g.lineTo(96, 30); g.lineTo(122, 124); g.lineTo(6, 124); g.lineTo(32, 30); g.closePath(); g.fill(); g.fillStyle = '#dcdcdc'; for (let x = 10; x < 120; x += 12) g.fillRect(x, 112, 6, 8); });
  }, false);
}
const clothUV = k => { const x = (k % 4) * 128, y = Math.floor(k / 4) * 128, u0 = x / 512, u1 = (x + 128) / 512, v0 = 1 - (y + 128) / 256, v1 = 1 - y / 256; return [u0, u1, v0, v1]; };
// sway the washing in the town's wind (veg/wind.js): aCloth.x = sway in metres at that vertex, y = flutter weight, z = phase
function clothWind(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = VEG_U.uTime; sh.uniforms.uWind = VEG_U.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWind; attribute vec3 aCloth;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  { vec3 wd = vec3(uWind.x, 0.0, -uWind.y); float g = 0.7 + 0.3 * sin(uTime * 0.37 + aCloth.z * 0.2);
    float s = (sin(uTime * 1.4 + aCloth.z) * 0.6 + sin(uTime * 2.9 + aCloth.z * 1.7) * 0.3) * g;
    transformed += wd * (aCloth.x * (0.55 + s) + aCloth.y * 0.03 * sin(uTime * 7.1 + aCloth.z * 3.0 + position.y * 9.0)); }`);
  };
  mat.customProgramCacheKey = () => 'cloth'; return mat;
}

// ---------- 1. walls: posters, painted ads, banners, pots on the coping ----------
function at(f, a) { // point, road-facing normal and segment length at arc a along a wall piece
  const q = f.q; let k = 0; while (k < q.length - 2 && q[k + 1][2] < a) k++;
  const p0 = q[k], p1 = q[k + 1], t = Math.max(0, Math.min(1, (a - p0[2]) / ((p1[2] - p0[2]) || 1)));
  return { x: p0[0] + (p1[0] - p0[0]) * t, y: p0[1] + (p1[1] - p0[1]) * t, n: f.n[k], a0: p0[2], a1: p1[2] };
}
function wallDetails(A, pots, st) {
  const byAt = k => POSTERS.filter(P => P.at === k), PAPER = byAt('paper'), PAINT = byAt('paint'), FLEX = byAt('flex');
  const age = r => { const v = 0.72 + r() * 0.28; return new THREE.Color(v, v * (0.97 + r() * 0.03), v * (0.9 + r() * 0.08)); }; // faded, a little yellowed
  for (const f of WALL_FACES) {
    const L = f.q[f.q.length - 1][2] - f.q[0][2], r = seedOf(f.q[0][0], f.q[0][1], 3);
    const put = (P, a, y0, roll, lift = 0) => { // false if it would hang over a bend or the end of the piece, or poke above the coping
      const w = P.m[0], h = P.m[1]; if (a - w / 2 < f.q[0][2] || a + w / 2 > f.q[f.q.length - 1][2] || y0 + h > f.h - 0.06) return false;
      const e0 = at(f, a - w / 2), e1 = at(f, a + w / 2), e = at(f, a), cx = (e0.x + e1.x) / 2, cy = (e0.y + e1.y) / 2, dev = Math.hypot(e.x - cx, e.y - cy); if (dev > 0.03) return false;
      const d = Math.hypot(e1.x - e0.x, e1.y - e0.y) || 1, s = (e1.y - e0.y) * e.n[0] - (e1.x - e0.x) * e.n[1] > 0 ? 1 : -1, nx = s * (e1.y - e0.y) / d, ny = -s * (e1.x - e0.x) / d; // chord normal, road side
      const off = f.t / 2 + 0.006 + dev + lift; facePlate(A, cx + nx * off, cy + ny * off, nx, ny, w, hAt(cx, cy) + y0, h, cellUV(P), P.at === 'paint' ? new THREE.Color(0.85, 0.85, 0.82).multiplyScalar(0.8 + r() * 0.2) : age(r), roll);
      st.posters++; return true;
    };
    if (L > 4 && r() < 0.18) put(pick(r, PAINT), f.q[0][2] + 1.3 + r() * (L - 2.6), 0.32 + r() * 0.15, 0); // painted on a long plain wall
    if (L > 3 && r() < 0.05) put(FLEX[0], f.q[0][2] + 1 + r() * (L - 2), 0.4, (r() - 0.5) * 0.03);
    const clusters = Math.floor(L / 16 + r());
    for (let c = 0; c < clusters; c++) { // a few posters pasted next to and over each other
      let a = f.q[0][2] + 0.4 + r() * Math.max(0, L - 0.8); const n = 1 + Math.floor(r() * 3);
      const series = r() < 0.35 ? pick(r, PAPER) : null; // now and then the same poster pasted in a row, as a campaign does
      for (let k = 0; k < n; k++) { const P = series || pick(r, PAPER); if (put(P, a, 0.85 + r() * 0.2, (r() - 0.5) * 0.08, k * 0.002)) a += P.m[0] * (series ? 1.04 : 0.7 + r() * 0.35); }
    }
    if (f.h < 2.2 && L > 2.5 && r() < 0.11) { // a row of potted plants along the coping
      const len = Math.min(L - 0.6, 2 + r() * 3), a0 = f.q[0][2] + 0.3 + r() * (L - 0.6 - len), step = 0.55 + r() * 0.3, flower = r() < 0.35 ? pick(r, ['#e8902a', '#c8202a', '#c0307a', '#f4d03f']) : null;
      for (let a = a0; a <= a0 + len; a += step) { const e = at(f, a); pots.push({ x: e.x, y: e.y, z: hAt(e.x, e.y) + f.h + 0.07, r: r(), flower: flower && r() < 0.7 ? flower : null }); }
    }
  }
  // beside some gates: NO PARKING or TO-LET on the wall just past the pillar
  const GATE = byAt('gate');
  for (const g of GATE_POSTS) {
    const r = seedOf(g.x, g.y, 5); if (r() > 0.16) continue;
    const P = pick(r, GATE), sd = r() < 0.5 ? -1 : 1, u = sd * (g.hg + PIL * 2 + 0.15 + P.m[0] / 2), x = g.x + g.tx * u, y = g.y + g.ty * u, off = g.t / 2 + 0.006;
    if (P.m[1] + 0.75 > g.h - 0.06) continue;
    facePlate(A, x + g.nx * off, y + g.ny * off, g.nx, g.ny, P.m[0], hAt(x, y) + 0.75, P.m[1], cellUV(P), new THREE.Color(0.9, 0.9, 0.86), 0); st.posters++;
  }
}
function gatePlates(A, st) {
  for (const g of GATE_POSTS) {
    const r = seedOf(g.x, g.y, 9); if (r() > 0.55) continue;
    const k = Math.floor(r() * PLATES.length), sd = r() < 0.5 ? -1 : 1, u = sd * (g.hg + PIL), x = g.x + g.tx * u, y = g.y + g.ty * u, off = PIL + 0.008;
    const cx = (k % 4) * 128, cy = Math.floor(k / 4) * 64, uv = [[cx / 512, 1 - (cy + 64) / 512], [(cx + 128) / 512, 1 - (cy + 64) / 512], [(cx + 128) / 512, 1 - cy / 512], [cx / 512, 1 - cy / 512]];
    facePlate(A, x + g.nx * off, y + g.ny * off, g.nx, g.ny, 0.32, hAt(x, y) + 1.22, 0.16, uv, new THREE.Color(1, 1, 1)); st.plates++;
  }
}

// ---------- 2. roofs: DTH dishes on the parapet, washing lines ----------
// a 60 cm offset dish on a short pipe mount facing south (the DTH satellites are in the southern sky from Assam); an offset dish's
// reflector stands nearly upright, about 30 degrees back, with the LNB held out in front of it
function dishGeometry() {
  const tint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const cap = new THREE.SphereGeometry(1, 12, 2, 0, Math.PI * 2, 0, 0.32); cap.translate(0, -1, 0); // rim 0.31 m round, concave side down
  const o = new THREE.Object3D(), A = new THREE.Vector3(0, -0.05, -0.29), B = new THREE.Vector3(0, -0.42, -0.22); // the feed arm off the lower rim (local -z ends up at the bottom), the LNB out in front at about centre height
  o.position.copy(A).add(B).multiplyScalar(0.5); o.lookAt(B); o.updateMatrix();
  const arm = new THREE.BoxGeometry(0.025, 0.025, A.distanceTo(B)).applyMatrix4(o.matrix);
  const lnb = new THREE.BoxGeometry(0.055, 0.1, 0.055); lnb.translate(B.x, B.y, B.z);
  const dish = mergeGeometries([tint(cap.toNonIndexed(), '#e4e5e1'), tint(arm.toNonIndexed(), '#8a8d90'), tint(lnb.toNonIndexed(), '#2b2d30')], false);
  const el = 0.5, q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, Math.sin(el), Math.cos(el)));
  dish.applyQuaternion(q); dish.translate(0, 0.56, 0);
  const pole = new THREE.CylinderGeometry(0.022, 0.022, 0.56, 6); pole.translate(0, 0.28, 0);
  const g = mergeGeometries([dish, tint(pole.toNonIndexed(), '#7d8084')], false); g.computeBoundingSphere(); return g;
}
function roofDetails(dishes, lines, C, st) {
  for (const R of ROOFS) {
    const r = seedOf(R.c[0], R.c[1], 11), cop = R.z1 + 0.95 + 0.07;
    // DTH dish: on the most southward-facing stretch of parapet, or on top of the stair room
    if (r() < 0.55) {
      let best = null; for (const e of R.E) if (e.L >= 1.6 && (!best || e.n[1] < best.n[1])) best = e;
      if (R.mumty && r() < 0.25) dishes.push({ x: R.mumty.x + (r() - 0.5), y: R.mumty.y + (r() - 0.5), z: R.z1 + 2.62, yaw: (r() - 0.5) * 0.5, c: r() });
      else if (best) {
        const on = f => dishes.push({ x: best.p[0] + best.u[0] * best.L * f - best.n[0] * 0.09, y: best.p[1] + best.u[1] * best.L * f - best.n[1] * 0.09, z: cop, yaw: (r() - 0.5) * 0.5, c: r() });
        const f1 = 0.15 + r() * 0.7; on(f1);
        if (R.a > 260 && r() < 0.4) { const f2 = f1 > 0.5 ? f1 - (1.1 + r() * 1.5) / best.L : f1 + (1.1 + r() * 1.5) / best.L; if (f2 > 0.05 && f2 < 0.95) on(f2); } // a flat each, a metre or two apart
      }
    }
    // washing line: along the longest edge, a metre in, clear of the stair room and the tanks
    if (R.a < 40 || r() > 0.38) continue;
    const e = R.E[R.longest], len = Math.min(6, e.L - 1.8); if (len < 2.2) continue;
    let ok = false, x0, y0, x1, y1;
    for (const inset of [1.0, 1.8, 2.6]) {
      const m = (e.L - len) / 2; x0 = e.p[0] + e.u[0] * m - e.n[0] * inset; y0 = e.p[1] + e.u[1] * m - e.n[1] * inset; x1 = x0 + e.u[0] * len; y1 = y0 + e.u[1] * len;
      const clear = (x, y) => pointInPoly(x, y, R.pts) && !(R.mumty && Math.hypot(x - R.mumty.x, y - R.mumty.y) < 2.4) && !tanks.some(t => Math.hypot(x - t.x, y - t.y) < 1.4);
      if (clear(x0, y0) && clear(x1, y1) && clear((x0 + x1) / 2, (y0 + y1) / 2)) { ok = true; break; }
    }
    if (!ok) continue;
    const H = R.z1 + 1.8; lines.push({ x0, y0, x1, y1, z: R.z1, H }); st.lines++;
    const ux = e.u[0], uy = e.u[1], nw = [-uy, 0, -ux]; // normal of the hanging plane, world
    for (let s = 0.12; s < len - 0.3;) {
      const k = Math.floor(r() * CLOTH.length), T = CLOTH[k], w = T.w[0] + r() * (T.w[1] - T.w[0]), h = T.h[0] + r() * (T.h[1] - T.h[0]); if (s + w > len - 0.1) break;
      const col = T.tint ? new THREE.Color(k === 5 ? pick(r, DARK_COL) : pick(r, CLOTH_COL)) : new THREE.Color(1, 1, 1), [u0, u1, v0, v1] = clothUV(k), ph = r() * 20;
      const ax = x0 + ux * s, ay = y0 + uy * s, rows = 3;
      for (let j = 0; j < rows; j++) { // three bands down the cloth so the bottom swings and the top stays pegged
        const fa = j / rows, fb = (j + 1) / rows, wa = [0.09 * fa ** 1.5, fa, ph], wb = [0.09 * fb ** 1.5, fb, ph];
        quad(C, [W(ax, ay, H - fb * h), W(ax + ux * w, ay + uy * w, H - fb * h), W(ax + ux * w, ay + uy * w, H - fa * h), W(ax, ay, H - fa * h)],
          [[u0, v1 - fb * (v1 - v0)], [u1, v1 - fb * (v1 - v0)], [u1, v1 - fa * (v1 - v0)], [u0, v1 - fa * (v1 - v0)]], nw, col, [wb, wb, wa, wa]);
      }
      st.clothes++; s += w + 0.06 + r() * 0.22;
    }
  }
}

// ---------- build ----------
function buildDetails() {
  const t0 = performance.now(), st = { posters: 0, plates: 0, pots: 0, dishes: 0, lines: 0, clothes: 0 };
  const A = acc(), PL = acc(), C = acc(), pots = [], dishes = [], lines = [];
  wallDetails(A, pots, st); gatePlates(PL, st); roofDetails(dishes, lines, C, st);
  const flat = { roughness: 0.9, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
  if (A.p.length) { const m = new THREE.Mesh(geom(A), new THREE.MeshStandardMaterial({ map: posterTex(), alphaTest: 0.4, ...flat })); m.receiveShadow = true; m.name = 'wall_posters'; scene.add(m); }
  if (PL.p.length) { const m = new THREE.Mesh(geom(PL), new THREE.MeshStandardMaterial({ map: plateTex(), ...flat, roughness: 0.35, metalness: 0.1 })); m.receiveShadow = true; m.name = 'gate_plates'; scene.add(m); }
  const dm = new THREE.Object3D();
  if (pots.length) { // terracotta pots (and the odd old paint bucket) with a leafy clump, some in flower
    const potG = new THREE.CylinderGeometry(0.13, 0.095, 0.2, 10); potG.translate(0, 0.1, 0);
    const leafG = new THREE.IcosahedronGeometry(1, 0);
    const flowers = pots.filter(p => p.flower).length, pm = new THREE.InstancedMesh(potG, new THREE.MeshStandardMaterial({ roughness: 0.9 }), pots.length);
    const lm = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), pots.length * 6 + flowers * 3);
    let li = 0; const c = new THREE.Color(), GREENS = ['#3f7a2e', '#4e8a34', '#2f6a2a', '#5f9a3a', '#6a9a3a'];
    const leaf = (x, y, z, sx, sy, sz, rx, ry, rz, col) => { dm.position.set(x, y, z); dm.rotation.set(rx, ry, rz); dm.scale.set(sx, sy, sz); dm.updateMatrix(); lm.setMatrixAt(li, dm.matrix); lm.setColorAt(li++, c.set(col)); };
    pots.forEach((p, i) => {
      dm.position.set(p.x, p.z, -p.y); dm.rotation.set(0, p.r * 6, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); pm.setMatrixAt(i, dm.matrix);
      pm.setColorAt(i, c.set(p.r < 0.72 ? (p.r < 0.4 ? '#a8553a' : '#b9673f') : p.r < 0.86 ? '#e8e8e2' : '#3a6fb0'));
      const kind = (p.r * 7.31) % 1, wx = p.x, wz = -p.y, y0 = p.z + 0.2;
      if (kind < 0.25) for (let k = 0; k < 5; k++) { const a = k * 1.26 + p.r * 4, t = 0.02 + (k % 2) * 0.02; leaf(wx + Math.cos(a) * t, y0 + 0.12, wz + Math.sin(a) * t, 0.022, 0.15 + (k % 3) * 0.04, 0.008, Math.sin(a) * 0.25, a, Math.cos(a) * 0.25, k % 2 ? '#3d6b2a' : '#6f8f3a'); } // a snake plant: stiff upright blades
      else for (let k = 0; k < 6; k++) { const a = k * 1.05 + p.r * 5, t = k ? 0.055 + (k % 2) * 0.02 : 0, s = 0.05 + ((p.r * 17 + k * 0.29) % 1) * 0.035; leaf(wx + Math.cos(a) * t, y0 + 0.05 + (k ? (k % 3) * 0.03 : 0.08), wz + Math.sin(a) * t, s, s * 0.9, s, a, p.r * 5 + k, 0, GREENS[(Math.floor(p.r * 40) + k) % GREENS.length]); } // a leafy clump
      if (p.flower) for (let k = 0; k < 3; k++) { const a = p.r * 9 + k * 2.1; dm.position.set(p.x + Math.cos(a) * 0.1, p.z + 0.36 + k * 0.03, -p.y + Math.sin(a) * 0.1); dm.scale.setScalar(0.035); dm.updateMatrix(); lm.setMatrixAt(li, dm.matrix); lm.setColorAt(li++, c.set(p.flower)); }
    });
    lm.count = li; pm.name = 'wall_pots'; for (const m of [pm, lm]) { m.castShadow = m.receiveShadow = true; scene.add(m); } st.pots = pots.length;
  }
  if (dishes.length) {
    const im = new THREE.InstancedMesh(dishGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide }), dishes.length), c = new THREE.Color();
    dishes.forEach((d, i) => { dm.position.set(d.x, d.z, -d.y); dm.rotation.set(0, d.yaw, 0); dm.scale.setScalar(1); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); im.setColorAt(i, c.setScalar(d.c < 0.8 ? 1 : 0.55)); }); // a few older grey ones
    im.castShadow = im.receiveShadow = true; im.name = 'roof_dishes'; scene.add(im); st.dishes = dishes.length;
  }
  if (lines.length) { // steel posts, the wire, and the washing
    const postG = new THREE.CylinderGeometry(0.02, 0.025, 1.85, 5); postG.translate(0, 0.925, 0);
    const wireG = new THREE.BoxGeometry(1, 0.012, 0.012), mat = new THREE.MeshStandardMaterial({ color: '#5d5f60', roughness: 0.6, metalness: 0.4 });
    const pm = new THREE.InstancedMesh(postG, mat, lines.length * 2), wm = new THREE.InstancedMesh(wireG, mat, lines.length);
    lines.forEach((l, i) => {
      for (const [k, x, y] of [[0, l.x0, l.y0], [1, l.x1, l.y1]]) { dm.position.set(x, l.z, -y); dm.rotation.set(0, 0, 0); dm.scale.setScalar(1); dm.updateMatrix(); pm.setMatrixAt(i * 2 + k, dm.matrix); }
      const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0); dm.position.set((l.x0 + l.x1) / 2, l.H + 0.01, -(l.y0 + l.y1) / 2); dm.rotation.set(0, Math.atan2(l.y1 - l.y0, l.x1 - l.x0), 0); dm.scale.set(len, 1, 1); dm.updateMatrix(); wm.setMatrixAt(i, dm.matrix);
    });
    for (const m of [pm, wm]) { m.castShadow = true; scene.add(m); }
    const tex = clothTex(), cm = new THREE.Mesh(geom(C), clothWind(new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 })));
    cm.customDepthMaterial = clothWind(new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking }));
    cm.castShadow = cm.receiveShadow = true; cm.userData.noMerge = true; cm.name = 'washing'; scene.add(cm);
  }
  console.info(`[details] ${st.posters} posters and painted ads, ${st.plates} name plates, ${st.pots} pots, ${st.dishes} dishes, ${st.lines} washing lines with ${st.clothes} clothes; ${Math.round(performance.now() - t0)} ms`);
  return st;
}

export { buildDetails };
