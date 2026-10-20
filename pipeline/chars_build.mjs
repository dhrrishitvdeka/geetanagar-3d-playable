// Builds the web character assets in public/assets/chars/ from the free Quaternius packs kept in vendor/ (CC0).
//   node pipeline/chars_build.mjs          everything
//   node pipeline/chars_build.mjs anims    only anims.glb (no image work)
//
// vendor/quaternius/ubc  Universal Base Characters (Standard): Superhero male and female bodies, hair, one 65-bone rig
// vendor/quaternius/ual  Universal Animation Library (Standard): 43 clips on the same 65-bone rig
//
// Output (all binary glTF, buffers and images embedded):
//   male.glb, female.glb  body + eyes + eyebrows, skinned to the rig. One base-colour texture each (the light skin variant,
//                         1024 px JPG) and a 1024 px normal map. Skin tone is NOT baked: the runtime recolours the texture by
//                         luminance, so the material carries `extras.skinRef` / `extras.lumRef` (the texture's own mean skin
//                         colour in linear space and its luminance) to normalise against. Roughness maps are dropped.
//   hair.glb              Hair_SimpleParted, Hair_Long, Hair_Buns, Hair_Buzzed, Hair_BuzzedFemale, Hair_Beard as plain meshes.
//                         Every hair file is 100% weighted to the Head bone, so the vertices are moved into head-bone-local
//                         space here; the game parents them to the Head bone, which fits both bodies without skinning.
//                         The two hair textures are 512 px JPG (they are opaque, shaded strand maps; tint at runtime).
//   anims.glb             the skeleton nodes (no mesh) and the clips the game uses, with these trimmed: scale tracks dropped
//                         (all 1), translation tracks dropped except pelvis (every character keeps its own bone lengths), the
//                         root bone dropped (identical rest rotation), constant rotation tracks stored as one key.
//
//                         The hair materials carry `extras.lumRef` (mean luminance of their texture) for the same reason.
//
// Needs Windows PowerShell (System.Drawing) for the JPEG resizing. No npm packages. vendor/ is read only and never executed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UBC = path.join(ROOT, 'vendor', 'quaternius', 'ubc', 'Universal Base Characters[Standard]');
const BASE = path.join(UBC, 'Base Characters');
const HAIR = path.join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)');
const UAL = path.join(ROOT, 'vendor', 'quaternius', 'ual', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb');
const OUT = path.join(ROOT, 'public', 'assets', 'chars');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chars_build_'));
const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Idle_Talking_Loop', 'Crouch_Idle_Loop',
  'Crouch_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Sitting_Enter', 'Sitting_Exit', 'Driving_Loop', 'Interact', 'Hit_Chest', 'Hit_Head'];
const BODY_TEX = 1024, HAIR_TEX = 512, JPG_Q = 85;

// ---------- reading glTF (.gltf with an external .bin, or .glb) ----------
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readGltf(file) {
  const b = fs.readFileSync(file); let json, bin;
  if (path.extname(file).toLowerCase() === '.glb') {
    let o = 12; const len = b.readUInt32LE(8);
    while (o < len) { const cl = b.readUInt32LE(o), ct = b.readUInt32LE(o + 4), d = b.subarray(o + 8, o + 8 + cl); if (ct === 0x4E4F534A) json = JSON.parse(d.toString('utf8')); else if (ct === 0x004E4942) bin = d; o += 8 + cl; }
  } else { json = JSON.parse(b.toString('utf8')); bin = fs.readFileSync(path.join(path.dirname(file), json.buffers[0].uri)); }
  // accessor -> { data: typed array copy, count, type, componentType, normalized }
  const acc = i => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], C = COMP[a.componentType], n = a.count * NCOMP[a.type];
    if (bv.byteStride && bv.byteStride !== C.BYTES_PER_ELEMENT * NCOMP[a.type]) throw new Error('interleaved accessors are not supported');
    const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return { data: new C(bin.buffer.slice(off, off + n * C.BYTES_PER_ELEMENT)), count: a.count, type: a.type, componentType: a.componentType, normalized: !!a.normalized };
  };
  return { json, acc };
}

// ---------- writing a GLB ----------
class Glb {
  constructor() {
    this.doc = { asset: { version: '2.0', generator: 'chars_build.mjs' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], skins: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], accessors: [], bufferViews: [], animations: [] };
    this.parts = []; this.size = 0;
  }
  view(buf, target) {
    const idx = this.doc.bufferViews.length, bv = { buffer: 0, byteOffset: this.size, byteLength: buf.length }; if (target) bv.target = target;
    this.doc.bufferViews.push(bv); this.parts.push(buf); this.size += buf.length;
    const pad = (4 - (this.size % 4)) % 4; if (pad) { this.parts.push(Buffer.alloc(pad)); this.size += pad; }
    return idx;
  }
  // typed array -> accessor index; POSITION and time inputs get min/max (required by the spec for POSITION, handy elsewhere)
  accessor(data, componentType, type, { normalized = false, target, minmax = false } = {}) {
    const bv = this.view(Buffer.from(data.buffer, data.byteOffset, data.byteLength), target), nc = NCOMP[type], count = data.length / nc;
    const a = { bufferView: bv, componentType, count, type }; if (normalized) a.normalized = true;
    if (minmax) { const mn = new Array(nc).fill(Infinity), mx = new Array(nc).fill(-Infinity); for (let i = 0; i < data.length; i++) { const k = i % nc; if (data[i] < mn[k]) mn[k] = data[i]; if (data[i] > mx[k]) mx[k] = data[i]; } a.min = mn; a.max = mx; }
    this.doc.accessors.push(a); return this.doc.accessors.length - 1;
  }
  copyAccessor(src, i, opt = {}) { const a = src.acc(i); return this.accessor(a.data, a.componentType, a.type, { normalized: a.normalized, ...opt }); }
  texture(buf, mime) {
    const bv = this.view(buf); this.doc.images.push({ bufferView: bv, mimeType: mime }); this.doc.textures.push({ sampler: 0, source: this.doc.images.length - 1 });
    return this.doc.textures.length - 1;
  }
  write(file) {
    const d = this.doc; for (const k of ['skins', 'materials', 'textures', 'images', 'animations', 'meshes', 'accessors']) if (!d[k].length) delete d[k];
    d.buffers = [{ byteLength: this.size }];
    let json = Buffer.from(JSON.stringify(d), 'utf8'); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const bin = Buffer.concat(this.parts), total = 12 + 8 + json.length + 8 + bin.length, h = Buffer.alloc(12);
    h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
    const c1 = Buffer.alloc(8); c1.writeUInt32LE(json.length, 0); c1.writeUInt32LE(0x4E4F534A, 4);
    const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004E4942, 4);
    fs.writeFileSync(file, Buffer.concat([h, c1, json, c2, bin])); return total;
  }
}

// ---------- images: resize with System.Drawing, optionally measure the mean skin colour ----------
const PS = `param([string]$Src,[string]$Dst,[int]$Size,[int]$Q,[string]$Fmt,[int]$Stats)
Add-Type -AssemblyName System.Drawing
$img=[System.Drawing.Image]::FromFile($Src)
$bmp=New-Object System.Drawing.Bitmap($Size,$Size,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality=[System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$ia=New-Object System.Drawing.Imaging.ImageAttributes
$ia.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
$g.DrawImage($img,(New-Object System.Drawing.Rectangle(0,0,$Size,$Size)),0,0,$img.Width,$img.Height,[System.Drawing.GraphicsUnit]::Pixel,$ia)
$g.Dispose(); $img.Dispose()
if($Fmt -eq 'jpg'){
  $enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object{$_.MimeType -eq 'image/jpeg'}
  $p=New-Object System.Drawing.Imaging.EncoderParameters(1)
  $p.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]$Q)
  $bmp.Save($Dst,$enc,$p)
} else { $bmp.Save($Dst,[System.Drawing.Imaging.ImageFormat]::Png) }
if($Stats -ge 1){
  $rect=New-Object System.Drawing.Rectangle(0,0,$Size,$Size)
  $d=$bmp.LockBits($rect,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $n=[Math]::Abs($d.Stride)*$Size; $buf=New-Object byte[] $n
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0,$buf,0,$n); $stride=$d.Stride; $bmp.UnlockBits($d)
  $lin=New-Object double[] 256
  for($i=0;$i -lt 256;$i++){ $v=$i/255.0; if($v -le 0.04045){$lin[$i]=$v/12.92}else{$lin[$i]=[Math]::Pow(($v+0.055)/1.055,2.4)} }
  $sr=0.0;$sg=0.0;$sb=0.0;$c=0
  for($y=0;$y -lt $Size;$y+=4){ for($x=0;$x -lt $Size;$x+=4){ $o=$y*$stride+$x*3; $b=$buf[$o];$gg=$buf[$o+1];$r=$buf[$o+2]
    if($Stats -eq 2 -or (($r-$b) -gt 30 -and $r -gt $gg)){ $sr+=$lin[$r];$sg+=$lin[$gg];$sb+=$lin[$b];$c++ } } }
  [Console]::Out.WriteLine(('STATS {0} {1} {2}' -f ($sr/$c).ToString([Globalization.CultureInfo]::InvariantCulture),($sg/$c).ToString([Globalization.CultureInfo]::InvariantCulture),($sb/$c).ToString([Globalization.CultureInfo]::InvariantCulture)))
}
$bmp.Dispose()
`;
const PS_FILE = path.join(TMP, 'resize.ps1'); fs.writeFileSync(PS_FILE, PS);
function image(src, size, { fmt = 'jpg', q = JPG_Q, stats = false } = {}) {
  const dst = path.join(TMP, path.basename(src, '.png') + '_' + size + '.' + fmt);
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_FILE, '-Src', src, '-Dst', dst, '-Size', String(size), '-Q', String(q), '-Fmt', fmt, '-Stats', stats === 'all' ? '2' : stats ? '1' : '0'], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(dst)) throw new Error('image resize failed for ' + src + '\n' + (r.stderr || r.stdout));
  const out = { buf: fs.readFileSync(dst), mime: fmt === 'jpg' ? 'image/jpeg' : 'image/png' };
  if (stats) { const m = /STATS (\S+) (\S+) (\S+)/.exec(r.stdout); if (!m) throw new Error('no stats from ' + src); out.skinRef = [+m[1], +m[2], +m[3]]; }
  return out;
}

// ---------- bodies ----------
function buildBody(gender) {
  const G = gender === 'male' ? 'Male' : 'Female', src = readGltf(path.join(BASE, 'Godot - UE', `Superhero_${G}_FullBody.gltf`)), j = src.json, g = new Glb();
  const baseTex = gender === 'male' ? 'T_Superhero_Male_Ligh.png' : 'T_Superhero_Female_Light_BaseColor.png';
  const colour = image(path.join(BASE, 'Textures', baseTex), BODY_TEX, { stats: true });
  const normal = image(path.join(BASE, 'Godot - UE', `T_Superhero_${G}_Normal.png`), BODY_TEX, { q: 88 });
  const eye = { buf: fs.readFileSync(path.join(BASE, 'Textures', 'T_Eye_Brown.png')), mime: 'image/png' };
  const [r, gg, b] = colour.skinRef, lumRef = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const tColour = g.texture(colour.buf, colour.mime), tNormal = g.texture(normal.buf, normal.mime), tEye = g.texture(eye.buf, eye.mime);
  g.doc.materials.push(
    { name: 'Body', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: tColour }, metallicFactor: 0, roughnessFactor: 0.78 }, normalTexture: { index: tNormal, scale: 0.8 }, extras: { skinRef: colour.skinRef, lumRef } },
    { name: 'Eyes', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: tEye }, metallicFactor: 0, roughnessFactor: 0.35 } },
    { name: 'Eyebrows', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.1, 0.08, 0.07, 1], metallicFactor: 0, roughnessFactor: 0.8 } });
  // pick our material by the source material name; keep only position, normal, uv, joints, weights, indices
  const matOf = n => (n === "MI_Eyes" ? 1 : /^MI_Superhero/i.test(n) ? 0 : 2);
  j.meshes.forEach(m => {
    const p = m.primitives[0], A = p.attributes, at = {};
    at.POSITION = g.copyAccessor(src, A.POSITION, { minmax: true, target: 34962 }); at.NORMAL = g.copyAccessor(src, A.NORMAL, { target: 34962 }); at.TEXCOORD_0 = g.copyAccessor(src, A.TEXCOORD_0, { target: 34962 });
    at.JOINTS_0 = g.copyAccessor(src, A.JOINTS_0, { target: 34962 }); at.WEIGHTS_0 = g.copyAccessor(src, A.WEIGHTS_0, { target: 34962 });
    g.doc.meshes.push({ name: m.name, primitives: [{ attributes: at, indices: g.copyAccessor(src, p.indices, { target: 34963 }), material: matOf(j.materials[p.material].name), mode: 4 }] });
  });
  const sk = j.skins[0];
  g.doc.skins.push({ name: sk.name, joints: sk.joints.slice(), inverseBindMatrices: g.copyAccessor(src, sk.inverseBindMatrices) });
  g.doc.nodes = j.nodes.map(n => { const o = { ...n }; return o; });
  g.doc.scenes[0].nodes = j.scenes[0].nodes.slice();
  const bytes = g.write(path.join(OUT, gender + '.glb'));
  return { bytes, lumRef, skinRef: colour.skinRef, colour: colour.buf.length, normal: normal.buf.length };
}

// ---------- hair: head-local meshes in one file ----------
const STYLES = ['Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Beard'];
function buildHair() {
  const g = new Glb(), tex = [image(path.join(HAIR, 'T_Hair_1_BaseColor.png'), HAIR_TEX, { stats: 'all' }), image(path.join(HAIR, 'T_Hair_2_BaseColor.png'), HAIR_TEX, { stats: 'all' })];
  const tIdx = tex.map(t => g.texture(t.buf, t.mime));
  g.doc.materials.push(...tIdx.map((t, i) => ({ name: 'Hair' + (i + 1), doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: t }, metallicFactor: 0, roughnessFactor: 0.78 }, extras: { lumRef: +(0.2126 * tex[i].skinRef[0] + 0.7152 * tex[i].skinRef[1] + 0.0722 * tex[i].skinRef[2]).toFixed(4) } })));
  for (const name of STYLES) {
    const src = readGltf(path.join(HAIR, name + '.gltf')), j = src.json, sk = j.skins[0], hi = sk.joints.findIndex(n => j.nodes[n].name === 'Head');
    if (hi < 0) throw new Error('no Head bone in ' + name);
    const ibm = src.acc(sk.inverseBindMatrices).data.subarray(hi * 16, hi * 16 + 16), p = j.meshes[0].primitives[0];
    const pos = src.acc(p.attributes.POSITION).data, nor = src.acc(p.attributes.NORMAL).data, P = new Float32Array(pos.length), N = new Float32Array(nor.length);
    for (let i = 0; i < pos.length; i += 3) { // bind-space -> Head-bone-local
      const x = pos[i], y = pos[i + 1], z = pos[i + 2], nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
      P[i] = ibm[0] * x + ibm[4] * y + ibm[8] * z + ibm[12]; P[i + 1] = ibm[1] * x + ibm[5] * y + ibm[9] * z + ibm[13]; P[i + 2] = ibm[2] * x + ibm[6] * y + ibm[10] * z + ibm[14];
      N[i] = ibm[0] * nx + ibm[4] * ny + ibm[8] * nz; N[i + 1] = ibm[1] * nx + ibm[5] * ny + ibm[9] * nz; N[i + 2] = ibm[2] * nx + ibm[6] * ny + ibm[10] * nz;
    }
    const mat = j.materials[p.material].name === 'MI_Hair_2' ? 1 : 0;
    const at = { POSITION: g.accessor(P, 5126, 'VEC3', { minmax: true, target: 34962 }), NORMAL: g.accessor(N, 5126, 'VEC3', { target: 34962 }), TEXCOORD_0: g.copyAccessor(src, p.attributes.TEXCOORD_0, { target: 34962 }) };
    g.doc.meshes.push({ name, primitives: [{ attributes: at, indices: g.copyAccessor(src, p.indices, { target: 34963 }), material: mat, mode: 4 }] });
    g.doc.nodes.push({ name, mesh: g.doc.meshes.length - 1 }); g.doc.scenes[0].nodes.push(g.doc.nodes.length - 1);
  }
  return { bytes: g.write(path.join(OUT, 'hair.glb')), tex: tex.map(t => t.buf.length) };
}

// ---------- animations: skeleton nodes + the clips we use ----------
function buildAnims() {
  const src = readGltf(UAL), j = src.json, g = new Glb();
  const keep = j.nodes.map((n, i) => n.mesh === undefined ? i : -1), remap = new Map(); let c = 0; keep.forEach(i => { if (i >= 0) remap.set(i, c++); });
  g.doc.nodes = j.nodes.filter(n => n.mesh === undefined).map(n => { const o = { ...n }; delete o.skin; if (o.children) o.children = o.children.filter(k => remap.has(k)).map(k => remap.get(k)); if (o.children && !o.children.length) delete o.children; return o; });
  g.doc.scenes[0].nodes = j.scenes[0].nodes.filter(k => remap.has(k)).map(k => remap.get(k));
  const SKIP = new Set(['root']); let tracks = 0, keys = 0;
  for (const name of CLIPS) {
    const a = j.animations.find(x => x.name === name); if (!a) throw new Error('clip not found: ' + name);
    const samplers = [], channels = [], inCache = new Map();
    for (const ch of a.channels) {
      const bone = j.nodes[ch.target.node].name, path_ = ch.target.path;
      if (SKIP.has(bone) || path_ === 'scale' || (path_ === 'translation' && bone !== 'pelvis')) continue;
      const s = a.samplers[ch.sampler], times = src.acc(s.input), out = src.acc(s.output), nc = path_ === 'rotation' ? 4 : 3;
      let constant = true; for (let k = nc; k < out.data.length && constant; k++) if (Math.abs(out.data[k] - out.data[k % nc]) > 1e-5) constant = false;
      let inIdx, outData;
      if (constant) { const key = 'c'; if (!inCache.has(key)) inCache.set(key, g.accessor(new Float32Array([0]), 5126, 'SCALAR', { minmax: true })); inIdx = inCache.get(key); outData = out.data.slice(0, nc); }
      else { if (!inCache.has(s.input)) inCache.set(s.input, g.accessor(times.data, 5126, 'SCALAR', { minmax: true })); inIdx = inCache.get(s.input); outData = out.data; }
      samplers.push({ input: inIdx, output: g.accessor(outData, 5126, path_ === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: remap.get(ch.target.node), path: path_ } });
      tracks++; keys += outData.length / nc;
    }
    g.doc.animations.push({ name, samplers, channels });
  }
  return { bytes: g.write(path.join(OUT, 'anims.glb')), clips: CLIPS.length, tracks, keys };
}

// ---------- run ----------
function main() {
  if (process.argv[2] === 'anims') { if (!fs.existsSync(UAL)) throw new Error('missing vendor file: ' + UAL); fs.mkdirSync(OUT, { recursive: true }); const a = buildAnims(); console.log('anims.glb  ', (a.bytes / 1024).toFixed(0) + ' KB', '(' + a.clips + ' clips,', a.tracks, 'tracks,', a.keys, 'keys)'); fs.rmSync(TMP, { recursive: true, force: true }); return; }
  for (const p of [BASE, HAIR, UAL]) if (!fs.existsSync(p)) throw new Error('missing vendor file: ' + p);
  fs.mkdirSync(OUT, { recursive: true });
  const kb = n => (n / 1024).toFixed(0) + ' KB';
  const m = buildBody('male'), f = buildBody('female'), h = buildHair(), a = buildAnims();
  console.log('male.glb   ', kb(m.bytes), '(colour', kb(m.colour), ', normal', kb(m.normal) + ')', 'skinRef', m.skinRef.map(v => v.toFixed(3)).join(','), 'lumRef', m.lumRef.toFixed(3));
  console.log('female.glb ', kb(f.bytes), '(colour', kb(f.colour), ', normal', kb(f.normal) + ')', 'skinRef', f.skinRef.map(v => v.toFixed(3)).join(','), 'lumRef', f.lumRef.toFixed(3));
  console.log('hair.glb   ', kb(h.bytes), '(textures', h.tex.map(kb).join(', ') + ')');
  console.log('anims.glb  ', kb(a.bytes), '(' + a.clips + ' clips,', a.tracks, 'tracks,', a.keys, 'keys)');
  console.log('total      ', kb(m.bytes + f.bytes + h.bytes + a.bytes));
  fs.rmSync(TMP, { recursive: true, force: true });
}
main();
