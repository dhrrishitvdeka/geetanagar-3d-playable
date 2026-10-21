import { renderer } from '../core/context.js';
import { getPixelRatioScale } from '../render/post.js';
import { QUALITY } from '../render/quality.js';

// ---------- frame-rate readout: game.html?fps ----------
// fps over the last second, the slowest frame of the last two seconds, the GPU the browser actually gave WebGL (on a laptop with
// two GPUs this says whether the game runs on the integrated or the dedicated one), the quality preset and the dynamic resolution.
function gpuName() {
  try { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); const s = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown GPU'; return s.replace(/^ANGLE \(|\)$/g, '').replace(/ Direct3D.*$/, '').replace(/\(0x[0-9A-F]+\)\s*/i, ''); }
  catch (e) { return 'unknown GPU'; }
}
function initPerfHud() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:max(16px,env(safe-area-inset-left,0px));bottom:12px;z-index:50;pointer-events:none;padding:6px 9px;border-radius:8px;'
    + 'font:12px/1.45 var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:var(--ink,#eee);background:var(--panel,rgba(20,20,20,.7));border:1px solid var(--line,transparent);white-space:pre';
  document.body.appendChild(el);
  const gpu = gpuName(), win = new Float32Array(240); let n = 0, i = 0, last = 0, shown = 0;
  const tick = now => {
    if (last) { win[i] = now - last; i = (i + 1) % win.length; if (n < win.length) n++; }
    last = now;
    if (now - shown > 500) {
      shown = now; let sum1 = 0, c1 = 0, worst = 0;
      for (let k = 0, t = 0; k < n; k++) { const d = win[(i - 1 - k + win.length) % win.length]; t += d; if (t <= 1000) { sum1 += d; c1++; } if (t <= 2000 && d > worst) worst = d; else if (t > 2000) break; }
      el.textContent = `${c1 ? (1000 * c1 / sum1).toFixed(0) : '–'} fps   worst ${worst.toFixed(1)} ms\n${gpu}\n${QUALITY} · res ${Math.round(getPixelRatioScale() * 100)}%`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
if (new URLSearchParams(location.search).has('fps')) initPerfHud();

export { initPerfHud };
