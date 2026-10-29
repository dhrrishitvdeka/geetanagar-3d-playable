// Map-space segment colliders shared by people, vehicles and camera probes.
// Keep this independent of the renderer so collision behavior can be checked without WebGL.
const COLL = new Map(), CC = 10;

function addCollider(a, b) {
  const x0 = Math.floor(Math.min(a[0], b[0]) / CC), x1 = Math.floor(Math.max(a[0], b[0]) / CC);
  const y0 = Math.floor(Math.min(a[1], b[1]) / CC), y1 = Math.floor(Math.max(a[1], b[1]) / CC);
  for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
    const key = i + ',' + j;
    if (!COLL.has(key)) COLL.set(key, []);
    COLL.get(key).push([a, b]);
  }
}

function blockedBySeg(x, y, r = 0.3) {
  // The circle may touch a wall in an adjacent cell even when its center is clear.
  const x0 = Math.floor((x - r) / CC), x1 = Math.floor((x + r) / CC);
  const y0 = Math.floor((y - r) / CC), y1 = Math.floor((y + r) / CC);
  for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
    const list = COLL.get(i + ',' + j); if (!list) continue;
    for (const [a, b] of list) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
      if ((x - a[0] - dx * t) ** 2 + (y - a[1] - dy * t) ** 2 < r * r) return true;
    }
  }
  return false;
}

export { addCollider, blockedBySeg, COLL, CC };
