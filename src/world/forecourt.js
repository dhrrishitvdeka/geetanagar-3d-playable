import * as THREE from 'three';
import { hAt, rng } from '../core/geo.js';
import { MeshBuilder } from './bldg/mesh.js';

// March 2026 Street View: 3_qRnWZanWudTCw74Lodrw, south-facing park forecourt.
// Concrete open pavilion beside two blue kiosks, rather than another wooden tin stall.
// Dimensions/fixtures are reconstructed; this does not identify the real operator.
const built = new Set();
function buildTeaShelter(x, y, angle) {
  const key = `${x},${y}`; if (built.has(key)) return; built.add(key);
  const masonry = new MeshBuilder(), fixtures = new MeshBuilder();
  const u = [Math.sin(angle), -Math.cos(angle)], n = [Math.cos(angle), Math.sin(angle)];
  const ground = hAt(x, y), W = 4.2, D = 2.8, H = 2.48;
  const C = c => new THREE.Color(c);
  const concrete = C('#b9b4a3'), coping = C('#8d9081'), damp = C('#777c65'), steel = C('#838d89');
  const box = (a0, a1, d0, d1, z0, z1, c, faces = 'fbtulr', builder = masonry) =>
    builder.box([x, y], u, n, a0, a1, d0, d1, ground + z0, ground + z1, c, faces, ground);
  box(-W / 2, W / 2, -D / 2, D / 2, -0.06, 0.035, coping);
  // Four independent columns leave the front open for the existing tea interaction.
  const random = rng(731);
  for (const a of [-W / 2 + 0.16, W / 2 - 0.16]) for (const d of [-D / 2 + 0.16, D / 2 - 0.16]) {
    box(a - 0.14, a + 0.14, d - 0.14, d + 0.14, 0, H, concrete);
    box(a - 0.18, a + 0.18, d - 0.18, d + 0.18, H - 0.12, H + 0.02, coping);
    box(a - 0.145, a + 0.145, d - 0.145, d + 0.145, 0.035, 0.3 + random() * 0.18, damp);
    // Torn pale paper remnants, not invented business signs or phone numbers.
    for (let k = 0; k < 3; k++) {
      const z = 0.65 + k * 0.35, width = 0.14 + random() * 0.09;
      box(a - width / 2, a + width / 2, d + 0.141, d + 0.144, z, z + 0.22, C(k % 2 ? '#d4c69a' : '#d5d0bb'), 'f');
    }
  }
  const aw = W / 2 + 0.27, ad = D / 2 + 0.28;
  box(-aw, aw, -ad, ad, H, H + 0.18, concrete);
  box(-aw + 0.05, aw - 0.05, -ad + 0.05, ad - 0.05, H - 0.018, H - 0.006, C('#787b70'), 'u');
  for (const d of [-ad + 0.06, ad - 0.06]) {
    box(-aw, aw, d - 0.06, d + 0.06, H + 0.18, H + 0.46, concrete);
    box(-aw - 0.025, aw + 0.025, d - 0.085, d + 0.085, H + 0.46, H + 0.52, coping);
    for (let k = 0; k < 13; k++) {
      const a = -aw + 0.08 + k * (2 * aw - 0.2) / 13;
      box(a, a + 0.04 + random() * 0.05, d + 0.061, d + 0.064, H + 0.2, H + 0.24 + random() * 0.18, damp, 'f');
    }
  }
  for (const a of [-aw + 0.06, aw - 0.06]) box(a - 0.06, a + 0.06, -ad + 0.12, ad - 0.12, H + 0.18, H + 0.46, concrete);
  // Back bench and the tea worktop stay inside the pavilion, clear of its open front.
  box(-1.5, 1.5, -1.12, -0.74, 0.42, 0.5, C('#767b66'));
  for (const a of [-1.15, 1.15]) box(a - 0.08, a + 0.08, -1.07, -0.8, 0.035, 0.42, concrete);
  box(-0.75, 0.75, -0.25, 0.18, 0.83, 0.9, C('#77766a'));
  for (const a of [-0.58, 0.58]) box(a - 0.04, a + 0.04, -0.18, 0.12, 0.035, 0.83, steel, 'fbtulr', fixtures);
  box(-0.58, -0.31, -0.16, 0.1, 0.9, 1.13, steel, 'fbtulr', fixtures);
  for (let k = 0; k < 5; k++) box(-0.15 + k * 0.12, -0.1 + k * 0.12, 0.02, 0.08, 0.9, 0.98, C('#e0dcd0'), 'fbtulr', fixtures);
  const mesh = masonry.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98 }));
  const metal = fixtures.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.63 }));
  if (mesh) mesh.name = 'park_forecourt_concrete_shelter';
  if (metal) metal.name = 'park_forecourt_tea_fixtures';
  return { vertices: masonry.verts + fixtures.verts, meshes: Number(!!mesh) + Number(!!metal) };
}

export { buildTeaShelter };
