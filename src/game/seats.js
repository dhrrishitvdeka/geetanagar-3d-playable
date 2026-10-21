// ---------- seats: benches register here so seated people can sit on them instead of beside them ----------
// A seat is { x, y, z, heading, h?, single? }: (x, y) is where the hips go, z the ground under it, h the height of the sitting
// surface above z (0.47 for the benches). The character models put the pelvis on that point at that height (see realchars.js).
// A bench has two slots 0.45 m either side of the middle, along the bench; a single seat (a chair) has one, in the middle.
const SEATS = [];
function addSeat(seat) { seat.h = seat.h ?? 0.47; seat.slots = seat.single ? [null] : [null, null]; SEATS.push(seat); return seat; }
// the free slot nearest (x, y) within r, as { x, y, z, heading, seat, k }; null when none
function claimSeat(x, y, who, r = 1.6) {
  let best = null, bd = r;
  for (const s of SEATS) {
    const d = Math.hypot(s.x - x, s.y - y); if (d > bd + 0.5) continue;
    for (let k = 0; k < s.slots.length; k++) {
      if (s.slots[k] && s.slots[k] !== who) continue;
      const o = s.single ? 0 : k ? 0.45 : -0.45, px = s.x - Math.sin(s.heading) * o, py = s.y + Math.cos(s.heading) * o, dd = Math.hypot(px - x, py - y);
      if (dd < bd) { bd = dd; best = { x: px, y: py, z: s.z, h: s.h, heading: s.heading, seat: s, k }; }
    }
  }
  if (best) best.seat.slots[best.k] = who;
  return best;
}
function releaseSeat(who) { for (const s of SEATS) for (let k = 0; k < s.slots.length; k++) if (s.slots[k] === who) s.slots[k] = null; }

export { SEATS, addSeat, claimSeat, releaseSeat };
