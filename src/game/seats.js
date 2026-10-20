// ---------- seats: benches register here so seated people can sit on them instead of beside them ----------
// A seat is { x, y, z, heading } at the middle of the bench (feet position; the sit pose lifts the hips).
// Each bench has two slots 0.45 m either side of the middle, along the bench.
const SEATS = [];
function addSeat(seat) { seat.slots = [null, null]; SEATS.push(seat); return seat; }
// the free slot nearest (x, y) within r, as { x, y, z, heading, seat, k }; null when none
function claimSeat(x, y, who, r = 1.6) {
  let best = null, bd = r;
  for (const s of SEATS) {
    const d = Math.hypot(s.x - x, s.y - y); if (d > bd + 0.5) continue;
    for (let k = 0; k < 2; k++) {
      if (s.slots[k] && s.slots[k] !== who) continue;
      const o = k ? 0.45 : -0.45, px = s.x - Math.sin(s.heading) * o, py = s.y + Math.cos(s.heading) * o, dd = Math.hypot(px - x, py - y);
      if (dd < bd) { bd = dd; best = { x: px, y: py, z: s.z, heading: s.heading, seat: s, k }; }
    }
  }
  if (best) best.seat.slots[best.k] = who;
  return best;
}
function releaseSeat(who) { for (const s of SEATS) for (let k = 0; k < 2; k++) if (s.slots[k] === who) s.slots[k] = null; }

export { SEATS, addSeat, claimSeat, releaseSeat };
