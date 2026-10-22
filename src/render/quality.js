// The active quality preset ('low' | 'medium' | 'high'), decided once before the world is built so that
// geometry-level choices (instance counts, texture sizes, ground resolution) can depend on it.
// Order: ?q=low in the URL, then the viewer's saved choice, then a guess from the GPU and device.
const KEY = 'geet.quality';
const VALID = ['low', 'medium', 'high'];

function detect() {
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch (e) { /* no WebGL info */ }
  const mobile = matchMedia('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  if (mobile || mem <= 4 || cores <= 4 || /Mali|Adreno|PowerVR|Apple GPU|SwiftShader|llvmpipe|Microsoft Basic/i.test(gpu)) return 'low';
  if (/Intel|UHD|Iris|Radeon\(TM\) Graphics|Vega \d/i.test(gpu)) return 'medium'; // integrated graphics
  return 'high';
}

const QUALITY = (() => {
  const url = new URLSearchParams(location.search).get('q');
  if (VALID.includes(url)) return url;
  try { const saved = localStorage.getItem(KEY); if (VALID.includes(saved)) return saved; } catch (e) { /* storage blocked */ }
  return detect();
})();

const isLow = () => QUALITY === 'low';
function saveQuality(q) { try { localStorage.setItem(KEY, q); } catch (e) { /* storage blocked */ } }

// haze density: thicker on Low so its shorter view distance (3.5 km) fades out instead of cutting off
const fogFor = street => QUALITY === 'low' ? (street ? 0.0017 : 0.0006) : (street ? 0.00085 : 0.00035);

export { QUALITY, isLow, saveQuality, detect, fogFor };
