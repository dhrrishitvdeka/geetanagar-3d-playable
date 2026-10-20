// A small IndexedDB cache for the slowest procedural texture builds (facade sets, painted ground).
// It keeps the exact bytes a build produced, under a key hashed from the drawing code, the quality preset and the data the
// build reads, so any change to those can never serve a stale texture. Every call is wrapped: blocked storage, private mode,
// quota, a timeout or a mismatch all just report a miss and the caller builds as it always did.
// Off switch (no reads, no writes): ?nocache in the URL, or localStorage 'geet.noTexCache' = '1'. Wipe: __texCache.clear().
const DB_NAME = 'geet-texcache', META = 'meta', BLOB = 'blob';
const FORMAT = 1;                          // bump when the stored layout changes
const MAX_BYTES = 384 * 2 ** 20;           // total across all entries; the least recently used go first
const MAX_AGE = 30 * 864e5;                // entries untouched for 30 days are dropped
const READ_MS = 5000;                      // a slower read than this loses to just rebuilding

let off;
export function cacheEnabled() {
  if (off === undefined) {
    off = false;
    try { if (typeof indexedDB === 'undefined' || !indexedDB) off = true; } catch (e) { off = true; }
    try { if (new URLSearchParams(location.search).has('nocache')) off = true; } catch (e) { /* no location */ }
    try { if (localStorage.getItem('geet.noTexCache') === '1') off = true; } catch (e) { /* storage blocked */ }
  }
  return !off;
}

// ---------- key ----------
// 64-bit multiply-xor hash over strings (code), typed arrays (data) and anything JSON-able; each part is length-prefixed so
// ['ab', 'c'] and ['a', 'bc'] differ. Not cryptographic: it only has to notice that an input changed.
export function hashParts(parts) {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  const mix = c => { a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); };
  const word = n => { mix(n & 255); mix((n >>> 8) & 255); mix((n >>> 16) & 255); mix(n >>> 24); };
  for (let p of parts) {
    if (ArrayBuffer.isView(p)) { const u = new Uint8Array(p.buffer, p.byteOffset, p.byteLength); mix(2); word(u.length); for (let i = 0; i < u.length; i++) mix(u[i]); continue; }
    if (typeof p !== 'string') p = JSON.stringify(p) ?? 'undefined';
    mix(1); word(p.length); for (let i = 0; i < p.length; i++) { const c = p.charCodeAt(i); mix(c & 255); mix(c >>> 8); }
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507); a ^= Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507); b ^= Math.imul(a ^ (a >>> 13), 3266489909);
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
// name: one slot per kind and preset ('facades:high'); ver: changes with the code, the inputs and the browser
// (a browser update can nudge canvas rasterising, so the user agent is part of the key)
export function texKey(name, parts) {
  let ua = ''; try { ua = navigator.userAgent; } catch (e) { /* not a browser */ }
  return { name, ver: hashParts([FORMAT, ua, ...parts]) };
}

// ---------- IndexedDB plumbing ----------
let dbp = null;
function openDB() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const q = indexedDB.open(DB_NAME, 1);
      q.onupgradeneeded = () => { q.result.createObjectStore(META, { keyPath: 'name' }); q.result.createObjectStore(BLOB); };
      q.onsuccess = () => { const d = q.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
      q.onerror = () => rej(q.error); q.onblocked = () => rej(new Error('blocked'));
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error || new Error('aborted')); });
const within = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
const sizeOf = d => (ArrayBuffer.isView(d) ? d.byteLength : d && typeof d === 'object' ? Object.values(d).reduce((s, v) => s + sizeOf(v), 0) : 0);

// ---------- read ----------
// resolves to the stored data for exactly this key, or null
export async function cacheGet(key) {
  if (!cacheEnabled()) return null;
  try {
    return await within((async () => {
      const db = await openDB();
      const meta = await req(db.transaction(META).objectStore(META).get(key.name));
      if (!meta) return null;
      if (meta.ver !== key.ver) { dropStale(key.name); return null; } // older code or inputs: useless from now on
      const rec = await req(db.transaction(BLOB).objectStore(BLOB).get(key.name));
      if (!rec || rec.ver !== key.ver) return null;                    // a tab replaced the entry between the two reads
      if (Date.now() - meta.t > 864e5) { try { db.transaction(META, 'readwrite').objectStore(META).put({ ...meta, t: Date.now() }); } catch (e) { /* recency is only a hint */ } }
      return rec.data;
    })(), READ_MS);
  } catch (e) { return null; }
}
async function dropStale(name) {
  try { const db = await openDB(), tx = db.transaction([META, BLOB], 'readwrite'); tx.objectStore(META).delete(name); tx.objectStore(BLOB).delete(name); await txDone(tx); } catch (e) { /* nothing to clear */ }
}

// ---------- write ----------
// make() runs in an idle moment a few seconds after boot and returns the data (or null to skip); a build never waits for the write
const queue = []; let pumping = false;
export function cacheLater(key, make) {
  if (!cacheEnabled()) return;
  queue.push({ key, make });
  if (!pumping) { pumping = true; setTimeout(pump, 3000); }
}
function pump() {
  const run = async () => {
    const j = queue.shift();
    try { const data = await j.make(); if (data) await store(j.key, data); } catch (e) { /* storage unavailable or full: next run builds again */ }
    if (queue.length) setTimeout(pump, 500); else pumping = false;
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 10000 }); else run();
}
async function store(key, data) {
  const bytes = sizeOf(data);
  if (!bytes || bytes > MAX_BYTES) return;
  const db = await openDB();
  const metas = await req(db.transaction(META).objectStore(META).getAll());
  const tx = db.transaction([META, BLOB], 'readwrite'), mS = tx.objectStore(META), bS = tx.objectStore(BLOB);
  const now = Date.now(); let total = bytes;
  // keep the most recently used other entries while they fit; drop the old ones and the rest
  for (const m of metas.filter(m => m.name !== key.name).sort((p, q) => q.t - p.t)) {
    if (now - m.t > MAX_AGE || total + m.bytes > MAX_BYTES) { mS.delete(m.name); bS.delete(m.name); } else total += m.bytes;
  }
  bS.put({ ver: key.ver, data }, key.name); mS.put({ name: key.name, ver: key.ver, t: now, bytes });
  await txDone(tx);
  console.info(`texcache: stored ${key.name} (${(bytes / 2 ** 20).toFixed(0)} MB)`);
}

export async function cacheClear() {
  try { const db = await openDB(), tx = db.transaction([META, BLOB], 'readwrite'); tx.objectStore(META).clear(); tx.objectStore(BLOB).clear(); await txDone(tx); } catch (e) { /* nothing to clear */ }
}
try { globalThis.__texCache = { clear: cacheClear, enabled: cacheEnabled }; } catch (e) { /* frozen global */ }

// ---------- self-check (no browser needed): node -e "import('./src/render/texcache.js').then(m => m.selfCheck())" ----------
export function selfCheck() {
  const ok = (c, msg) => { if (!c) throw new Error('texcache self-check failed: ' + msg); };
  const draw = new Function('g', 'g.fillRect(0, 0, 4, 4)').toString(), draw2 = new Function('g', 'g.fillRect(0, 0, 4, 5)').toString();
  const data = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), data2 = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 9]);
  const k = (code, d, preset) => hashParts([FORMAT, code, d, preset, { w: 1, h: 2 }]);
  const base = k(draw, data, 'high');
  ok(base === k(draw, Uint8Array.from(data), 'high'), 'same inputs must give the same key');
  ok(base !== k(draw2, data, 'high'), 'a changed builder source must change the key');
  ok(base !== k(draw, data2, 'high'), 'changed input data must change the key');
  ok(base !== k(draw, data, 'low'), 'a different preset must change the key');
  ok(hashParts(['ab', 'c']) !== hashParts(['a', 'bc']), 'part boundaries must matter');
  ok(hashParts([new Uint8Array([1, 2]), new Uint8Array([3])]) !== hashParts([new Uint8Array([1]), new Uint8Array([2, 3])]), 'array boundaries must matter');
  ok(/^[0-9a-f]{16}$/.test(base), 'key is 16 hex digits');
  ok(sizeOf({ a: new Uint8Array(10), b: { c: new Uint8ClampedArray(5), d: null } }) === 15, 'size counts nested typed arrays');
  return base;
}
