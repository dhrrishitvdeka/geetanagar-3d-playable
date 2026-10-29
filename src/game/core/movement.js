// Limit collision probes to short stretches even when a frame arrives late.
// canMove evaluates terrain/kerbs and other actors from each accepted position.
function movePlanar(body, dx, dy, canMove, { slide = true, maxStep = 0.15 } = {}) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / maxStep));
  let sx = dx / steps, sy = dy / steps, blockedX = false, blockedY = false;
  for (let i = 0; i < steps; i++) {
    const ox = body.x, oy = body.y;
    if (canMove(ox + sx, oy + sy, ox, oy)) { body.x += sx; body.y += sy; continue; }
    if (!slide) return { blocked: true, blockedX: dx !== 0, blockedY: dy !== 0 };
    if (sx !== 0 && canMove(ox + sx, oy, ox, oy)) {
      body.x += sx; blockedY ||= sy !== 0; sy = 0;
    } else if (sy !== 0 && canMove(ox, oy + sy, ox, oy)) {
      body.y += sy; blockedX ||= sx !== 0; sx = 0;
    } else {
      blockedX ||= sx !== 0; blockedY ||= sy !== 0; break;
    }
  }
  return { blocked: blockedX || blockedY, blockedX, blockedY };
}

export { movePlanar };
