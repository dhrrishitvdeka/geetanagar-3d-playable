import { hAt } from '../core/geo.js';
import { HAT, nearestOnMain } from '../world/mainroad.js';
import { on } from './core/bus.js';
import { state } from './core/state.js';

// ---------- context and graph ----------
// Everything is synthesised; nothing plays until the first user gesture creates the context.
const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
let ctx = null, dead = false, master, sfxBus, ambBus, engBus, white, brown;
let inited = false, lx = 0, ly = 0, lh = 0, haveListener = false;
const MAXV = 24, voices = [];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const vol01 = () => clamp(Number(state.settings && state.settings.volume) || 0, 0, 1);

function make() {
  if (ctx || dead || !AC) return !!ctx;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { dead = true; return false; }
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
  master = ctx.createGain(); master.gain.value = vol01() ** 2; master.connect(comp); comp.connect(ctx.destination);
  sfxBus = ctx.createGain(); ambBus = ctx.createGain(); engBus = ctx.createGain(); sfxBus.connect(master); ambBus.connect(master); engBus.connect(master);
  const sr = ctx.sampleRate;
  white = ctx.createBuffer(1, sr * 2, sr); const w = white.getChannelData(0); for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
  // brown noise (integrated white) with the drift removed so the loop point has no click
  brown = ctx.createBuffer(1, sr * 4, sr); const b = brown.getChannelData(0); let a = 0;
  for (let i = 0; i < b.length; i++) { a = (a + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = a; }
  const d = b[b.length - 1] - b[0]; let mx = 0.0001;
  for (let i = 0; i < b.length; i++) { b[i] -= d * i / b.length; mx = Math.max(mx, Math.abs(b[i])); }
  for (let i = 0; i < b.length; i++) b[i] /= mx;
  buildBeds();
  return true;
}
function unlock() {
  if (dead || !AC) return;
  try { if (!ctx && !make()) return; if (ctx.state !== 'running') ctx.resume().then(() => { if (wantEng) engine(true, wantSpeed); }, () => {}); } catch (e) { /* blocked; retry on the next gesture */ }
}
function initAudio() {
  if (inited || !AC) return; inited = true;
  for (const t of ['pointerdown', 'keydown', 'touchend', 'click']) addEventListener(t, unlock, { passive: true });
  on('ui:settings', () => setVolume(vol01()));
  document.addEventListener('visibilitychange', () => { if (!ctx) return; try { if (document.hidden) ctx.suspend(); else ctx.resume(); } catch (e) { /* ignore */ } });
}
function setVolume(v) {
  v = clamp(Number(v) || 0, 0, 1); if (state.settings) state.settings.volume = v;
  if (ctx) master.gain.setTargetAtTime(v * v, ctx.currentTime, 0.03); // squared: the slider feels even
}
const live = () => ctx && ctx.state === 'running';

// ---------- building blocks ----------
function env(g, t0, att, peak, hold, rel) { const p = g.gain; p.setValueAtTime(0.0001, t0); p.linearRampToValueAtTime(peak, t0 + att); p.setValueAtTime(peak, t0 + att + hold); p.exponentialRampToValueAtTime(0.0001, t0 + att + hold + rel); }
// oscillator with a fast attack and exponential decay; f1 optional glide target
function tone(out, type, f0, f1, t0, dur, peak, att = 0.005) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t0);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  env(g, t0, att, peak, 0, dur - att); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + 0.02); return g;
}
function noise(out, t0, dur, type, f0, f1, q, peak, att = 0.004, buf = white) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = buf; s.loop = true;
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  env(g, t0, att, peak, 0, dur - att); s.connect(f); f.connect(g); g.connect(out); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.02); return g;
}
function lfo(target, rate, depth, t0, dur) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g); g.connect(target); o.start(t0); o.stop(t0 + dur); }
function whistleVoice(out, t0, dur, p, rise) { // pea whistle: sine with fast vibrato and a rattling amplitude
  const o = ctx.createOscillator(), amp = ctx.createGain(), g = ctx.createGain(), f = 2850 * p;
  o.type = 'sine'; o.frequency.setValueAtTime(f * 0.97, t0); o.frequency.linearRampToValueAtTime(f * rise, t0 + dur);
  lfo(o.frequency, 27, 120, t0, dur + 0.05); amp.gain.value = 0.62; lfo(amp.gain, 31, 0.38, t0, dur + 0.05);
  env(g, t0, 0.02, 0.5, Math.max(0, dur - 0.08), 0.06); o.connect(amp); amp.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + 0.1);
  noise(out, t0, dur, 'highpass', 3200, 3200, 0.7, 0.12, 0.02);
}

// a looping white-noise band into out, with its own gain envelope (attack, hold, release)
function hiss(out, t0, len, type, f, q, peak, att, rel) {
  const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = white; s.loop = true; bp.type = type; bp.frequency.value = f; bp.Q.value = q;
  env(g, t0, att, peak, Math.max(0, len - att - rel), rel); s.connect(bp); bp.connect(g); g.connect(out); s.start(t0, Math.random() * 1.5); s.stop(t0 + len + 0.05); return g;
}
// a sung vowel ("aa") for the kirtan: two detuned saws through two formants, with a singer's vibrato
function voice(out, t0, dur, f) {
  const g = ctx.createGain(), bps = []; env(g, t0, 0.09, 0.32, Math.max(0, dur - 0.3), 0.21); g.connect(out);
  for (const [fr, q, k] of [[730, 5, 1], [1090, 6, 0.55], [2440, 7, 0.18]]) { const bp = ctx.createBiquadFilter(), kg = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q; kg.gain.value = 2.4 * k; bp.connect(kg); kg.connect(g); bps.push(bp); }
  for (const det of [-7, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; lfo(o.frequency, 5.3, f * 0.012, t0, dur + 0.1); for (const bp of bps) o.connect(bp); o.start(t0); o.stop(t0 + dur + 0.1); }
}

// ---------- sounds ----------
// Each takes (start time, output gain, pitch multiplier) and returns its length in seconds.
const SFX = {
  step(t, out, p) { const f = 760 * p * rnd(0.8, 1.25); noise(out, t, 0.075, 'lowpass', f, f * 0.45, 0.7, 1.3, 0.003); tone(out, 'sine', 130 * p, 70, t, 0.06, 0.3, 0.003); return 0.1; },
  coin(t, out, p) {
    tone(out, 'square', 987.8 * p, 0, t, 0.09, 0.07); tone(out, 'sine', 987.8 * p, 0, t, 0.12, 0.35);
    tone(out, 'square', 1318.5 * p, 0, t + 0.075, 0.4, 0.07); tone(out, 'sine', 1318.5 * p, 0, t + 0.075, 0.4, 0.35); tone(out, 'sine', 2637 * p, 0, t + 0.075, 0.25, 0.1); return 0.55;
  },
  pickup(t, out, p) { [523.3, 659.3, 784, 1046.5].forEach((f, i) => { tone(out, 'triangle', f * p, 0, t + i * 0.065, 0.2, 0.32); tone(out, 'sine', f * 2 * p, 0, t + i * 0.065, 0.14, 0.07); }); return 0.5; },
  bell(t, out, p) { // temple bell: inharmonic partials, the low ones ring longest, a close pair beats
    const f = 430 * p, parts = [[1, 1, 4.2], [2, 0.55, 3.2], [2.76, 0.5, 2.6], [4.07, 0.28, 1.7], [5.43, 0.18, 1.2], [6.8, 0.1, 0.8]];
    for (const [k, a, d] of parts) tone(out, 'sine', f * k, 0, t, d, a * 0.42, 0.004);
    tone(out, 'sine', f + 1.6, 0, t, 4.2, 0.26, 0.004); tone(out, 'sine', f * 0.5, 0, t, 3, 0.18, 0.01);
    noise(out, t, 0.05, 'bandpass', 2600, 2600, 1, 1.2, 0.001); return 4.4;
  },
  horn(t, out, p) { // two detuned tones about a third apart, sometimes a double beep
    const f = rnd(360, 430) * p, dbl = Math.random() < 0.35;
    const beep = (t0, len) => {
      const lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 2100; env(g, t0, 0.012, 0.16, len, 0.05);
      for (const [type, k, det] of [['square', 1, 0], ['sawtooth', 1.26, 6], ['square', 1.012, -4]]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * k; o.detune.value = det; o.connect(lp); o.start(t0); o.stop(t0 + len + 0.2); }
      lp.connect(g); g.connect(out);
    };
    if (dbl) { beep(t, 0.16); beep(t + 0.26, 0.2); return 0.7; } beep(t, rnd(0.3, 0.5)); return 0.7;
  },
  clank(t, out, p) { tone(out, 'triangle', 1850 * p, 1500, t, 0.18, 0.35, 0.001); tone(out, 'sine', 2950 * p, 0, t, 0.12, 0.18, 0.001); noise(out, t, 0.04, 'highpass', 3000, 3000, 0.8, 0.5, 0.001); return 0.22; },
  dhol(t, out, p) { tone(out, 'sine', 95 * p, 52, t, 0.32, 1.2, 0.002); noise(out, t, 0.05, 'bandpass', 900 * p, 400, 1.2, 0.9, 0.001); tone(out, 'triangle', 190 * p, 120, t, 0.12, 0.35, 0.002); return 0.36; }, // a dhol stroke: low skin, slap, a little ring
  kick(t, out, p) { tone(out, 'sine', 160 * p, 42, t, 0.28, 1.1, 0.002); noise(out, t, 0.06, 'lowpass', 1100, 500, 0.8, 1.2, 0.002); return 0.35; },
  goal(t, out, p) { // crowd cheer: three noise bands swelling, with a rough flutter, and a whistle over the top
    for (const [f, q, pk] of [[520, 0.7, 2.2], [1050, 0.8, 2.6], [2300, 0.9, 1.4]]) {
      const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), fl = ctx.createGain();
      s.buffer = white; s.loop = true; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; fl.gain.value = 0.8; lfo(fl.gain, rnd(6, 11), 0.2, t, 3.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk * 0.55, t + 0.55); g.gain.linearRampToValueAtTime(pk, t + 1.3); g.gain.linearRampToValueAtTime(pk * 0.7, t + 2.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
      s.connect(bp); bp.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 3.5);
    }
    whistleVoice(out, t + 0.1, 0.55, p, 1.04); return 3.6;
  },
  ui(t, out, p) { tone(out, 'sine', 1900 * p, 1300 * p, t, 0.035, 0.3, 0.002); noise(out, t, 0.015, 'highpass', 4000, 4000, 0.7, 0.2, 0.001); return 0.06; },
  error(t, out, p) { for (const d of [0, 0.15]) { const g = tone(out, 'sawtooth', 120 * p, 95 * p, t + d, 0.12, 0.5, 0.006); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; g.disconnect(); g.connect(lp); lp.connect(out); } return 0.32; },
  quest(t, out, p) { [523.3, 659.3, 784].forEach((f, i) => { const d = t + i * 0.14; tone(out, 'triangle', f * p, 0, d, 1.0, 0.3, 0.01); tone(out, 'sine', f * 2 * p, 0, d, 0.7, 0.1, 0.01); tone(out, 'sine', f * 3 * p, 0, d, 0.3, 0.03, 0.01); }); return 1.4; },
  bark(t, out, p) { // dog: pitched buzz through two formants plus a noise burst, 1 to 3 barks
    const n = 1 + (Math.random() * 3 | 0), base = rnd(300, 420) * p;
    for (let i = 0; i < n; i++) {
      const d = t + i * rnd(0.19, 0.26), o = ctx.createOscillator(), f1 = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(base * 1.15, d); o.frequency.exponentialRampToValueAtTime(base * 0.7, d + 0.13);
      f1.type = 'bandpass'; f1.frequency.setValueAtTime(900, d); f1.frequency.exponentialRampToValueAtTime(600, d + 0.13); f1.Q.value = 3;
      env(g, d, 0.01, 0.9, 0.03, 0.09); o.connect(f1); f1.connect(g); g.connect(out); o.start(d); o.stop(d + 0.2);
      noise(out, d, 0.1, 'bandpass', 1500, 900, 1.5, 1.4, 0.008);
    }
    return n * 0.26 + 0.2;
  },
  moo(t, out, p) { // low sawtooth with a vowel-ish formant sweep (oo-aa-oo)
    const o = ctx.createOscillator(), g = ctx.createGain(), f = 105 * p, len = 1.5;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.9, t); o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.4); o.frequency.linearRampToValueAtTime(f * 0.8, t + len);
    lfo(o.frequency, 5.5, 3, t, len + 0.1); env(g, t, 0.18, 0.9, len - 0.55, 0.4); g.connect(out);
    for (const [a, b, c, q, k] of [[380, 720, 380, 5, 1], [900, 1250, 800, 6, 0.55]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(a, t); bp.frequency.linearRampToValueAtTime(b, t + 0.55); bp.frequency.linearRampToValueAtTime(c, t + len);
      const kg = ctx.createGain(); kg.gain.value = 2.2 * k; o.connect(bp); bp.connect(kg); kg.connect(g);
    }
    o.start(t); o.stop(t + len + 0.5); return len + 0.5;
  },
  caw(t, out, p) { // harsh FM squawk, one to three times
    const n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const d = t + i * 0.3, car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), f = rnd(560, 680) * p;
      car.type = 'sawtooth'; car.frequency.setValueAtTime(f, d); car.frequency.exponentialRampToValueAtTime(f * 0.65, d + 0.22);
      mod.type = 'square'; mod.frequency.value = rnd(75, 110); mg.gain.value = 260; mod.connect(mg); mg.connect(car.frequency);
      bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9; env(g, d, 0.015, 0.8, 0.09, 0.12);
      car.connect(bp); bp.connect(g); g.connect(out); car.start(d); mod.start(d); car.stop(d + 0.3); mod.stop(d + 0.3);
    }
    return n * 0.3 + 0.1;
  },
  whistle(t, out, p) { whistleVoice(out, t, 0.12, p, 1.0); whistleVoice(out, t + 0.2, 0.55, p, 1.03); return 0.85; },
  shutter(t, out, p) { noise(out, t, 0.02, 'highpass', 2500, 2500, 0.7, 1.4, 0.001); tone(out, 'sine', 200 * p, 110, t, 0.05, 0.4, 0.002); noise(out, t + 0.07, 0.035, 'bandpass', 2600, 1500, 1.2, 1.3, 0.001); tone(out, 'sine', 150 * p, 90, t + 0.07, 0.06, 0.3, 0.002); return 0.15; },
  splash(t, out, p) {
    noise(out, t, 1.0, 'bandpass', 700 * p, 2600 * p, 1.1, 2.0, 0.03); noise(out, t, 0.7, 'highpass', 3500, 3500, 0.7, 0.6, 0.02);
    for (let i = 0; i < 5; i++) { const d = t + 0.05 + Math.random() * 0.6, f = rnd(300, 800) * p; tone(out, 'sine', f, f * 2.2, d, 0.07, 0.18, 0.005); }
    return 1.1;
  },
  cooker(t, out, p) { // a pressure cooker's whistle from a kitchen: steam through the weight, a sung tone that wavers, then it dies away
    const f = rnd(2000, 2700) * p, len = rnd(1.1, 1.9), g = ctx.createGain(); env(g, t, 0.22, 0.55, len - 0.6, 0.38); g.connect(out);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f * 0.9, t); o.frequency.linearRampToValueAtTime(f, t + 0.28); lfo(o.frequency, rnd(7, 11), f * 0.012, t, len + 0.1);
    og.gain.value = 0.45; o.connect(og); og.connect(g); o.start(t); o.stop(t + len + 0.1);
    hiss(g, t, len, 'bandpass', f * 1.02, 7, 1.1, 0.15, 0.3); hiss(g, t, len, 'highpass', 4500, 0.7, 0.25, 0.15, 0.3); return len + 0.2;
  },
  conch(t, out, p) { // a shankha at dusk or puja: a brassy horn that opens up as the breath fills it, blown one to three times
    const f = rnd(290, 360) * p, n = 1 + (Math.random() * 3 | 0); let d = t;
    for (let i = 0; i < n; i++) {
      const len = rnd(1.3, 2.3), o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), g2 = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.93, d); o.frequency.linearRampToValueAtTime(f, d + 0.3); lfo(o.frequency, 4.6, f * 0.008, d, len + 0.1);
      o2.type = 'square'; o2.frequency.setValueAtTime(f * 1.995, d + 0.3); g2.gain.value = 0.18; o2.connect(g2); g2.connect(lp);
      lp.type = 'lowpass'; lp.Q.value = 2.2; lp.frequency.setValueAtTime(600, d); lp.frequency.linearRampToValueAtTime(1900, d + 0.45); lp.frequency.linearRampToValueAtTime(1300, d + len);
      env(g, d, 0.32, 0.3, len - 0.75, 0.43); o.connect(lp); lp.connect(g); g.connect(out); o.start(d); o2.start(d); o.stop(d + len + 0.1); o2.stop(d + len + 0.1);
      hiss(out, d, len, 'bandpass', 1500, 1.2, 0.05, 0.2, 0.4); d += len + rnd(0.25, 0.5);
    }
    return d - t;
  },
  kirtan(t, out, p) { // one bar of naam-kirtan at the namghar: taal cymbals on the beat, the khol drum, and voices answering the call
    const base = 196 * p, sc = [0, 2, 4, 7, 9, 12], beat = 0.5;
    for (let i = 0; i < 8; i++) {
      const d = t + i * beat; // taal: a bright inharmonic "ching", louder on the beat
      for (const [k, a] of [[1, 0.2], [1.47, 0.14], [2.09, 0.08]]) tone(out, 'sine', 3150 * k, 0, d, 0.45, a * (i % 2 ? 0.55 : 1), 0.001);
      hiss(out, d, 0.12, 'highpass', 6000, 0.7, 0.08, 0.001, 0.1);
      if (i % 4 === 0 || i % 4 === 3) tone(out, 'sine', 118, 72, d, 0.3, 0.9, 0.003); // khol, the low head
      if (i % 2 === 1) { hiss(out, d + 0.25, 0.06, 'bandpass', 1900, 1.4, 0.55, 0.001, 0.05); tone(out, 'triangle', 340, 280, d + 0.25, 0.12, 0.3, 0.002); } // and the slapped high head
    }
    let d = t; const start = Math.floor(Math.random() * 3);
    for (let k = 0; k < 4; k++) { const f = base * 2 ** (sc[(start + (k === 3 ? 0 : Math.floor(Math.random() * 4))) % sc.length] / 12); voice(out, d, 0.96, f); voice(out, d + 0.02, 0.94, f * 2 * 0.998); d += 1; }
    return 4;
  },
  teastall(t, out, p) { // a tea stall: glasses clinking, or the kettle hissing on the stove
    if (Math.random() < 0.6) { for (let i = 0; i < 2 + (Math.random() * 2 | 0); i++) { const d = t + i * rnd(0.12, 0.3), f = rnd(2900, 3600) * p; tone(out, 'sine', f, 0, d, 0.22, 0.25, 0.001); tone(out, 'sine', f * 1.71, 0, d, 0.14, 0.1, 0.001); } return 1; }
    hiss(out, t, 2.4, 'bandpass', 3400, 2.5, 0.22, 0.6, 0.6); tone(out, 'sine', 3400 * p, 3450 * p, t + 0.5, 1.4, 0.04, 0.4); return 2.5;
  },
  airbrake(t, out, p) { noise(out, t, 0.9, 'highpass', 2600, 1800, 0.7, 1.1, 0.01); noise(out, t, 0.35, 'bandpass', 900, 600, 1, 0.5, 0.01); tone(out, 'sine', 170 * p, 110, t + 0.75, 0.12, 0.6, 0.004); return 1.1; }, // a bus pulling in: the air brakes, then the door
  schoolbell(t, out, p) { // the school's bell: a hanging brass plate struck again and again
    const n = 8 + (Math.random() * 5 | 0);
    for (let i = 0; i < n; i++) { const d = t + i * 0.32, f = 820 * p; for (const [k, a, dec] of [[1, 0.5, 1.1], [2.32, 0.3, 0.7], [3.9, 0.16, 0.4], [5.6, 0.08, 0.25]]) tone(out, 'sine', f * k, 0, d, dec, a * 0.5, 0.001); hiss(out, d, 0.04, 'bandpass', 3000, 1, 0.4, 0.001, 0.03); }
    return n * 0.32 + 1.2;
  },
  door(t, out, p) { for (const d of [0, 0.15, 0.42]) { tone(out, 'sine', 190 * p, 120 * p, t + d, 0.09, 0.9, 0.002); noise(out, t + d, 0.05, 'bandpass', 420, 300, 1.4, 1.4, 0.002); } return 0.6; },
  engine_start(t, out, p) { // starter cranks (amplitude pulses), then the engine catches
    const o = ctx.createOscillator(), am = ctx.createGain(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(34 * p, t); o.frequency.linearRampToValueAtTime(62 * p, t + 0.8); lp.type = 'lowpass'; lp.frequency.value = 520;
    am.gain.value = 0.5; lfo(am.gain, 15, 0.5, t, 0.85); env(g, t, 0.05, 0.8, 0.7, 0.05); o.connect(lp); lp.connect(am); am.connect(g); g.connect(out); o.start(t); o.stop(t + 0.95);
    const c = t + 0.82, o2 = ctx.createOscillator(), g2 = ctx.createGain(), lp2 = ctx.createBiquadFilter();
    o2.type = 'sawtooth'; o2.frequency.setValueAtTime(95 * p, c); o2.frequency.exponentialRampToValueAtTime(52 * p, c + 0.6); lp2.type = 'lowpass'; lp2.frequency.value = 700;
    env(g2, c, 0.02, 0.9, 0.15, 0.5); o2.connect(lp2); lp2.connect(g2); g2.connect(out); o2.start(c); o2.stop(c + 0.8);
    noise(out, c, 0.1, 'lowpass', 900, 400, 0.8, 1.5, 0.002); return 1.7;
  },
};

// ---------- playing sounds ----------
function sfx(name, o = {}) {
  const fn = SFX[name]; if (!fn || !live()) return;
  let v = o.vol == null ? 1 : o.vol, pan = 0;
  if (Number.isFinite(o.x) && Number.isFinite(o.y) && haveListener) {
    const dx = o.x - lx, dy = o.y - ly, d = Math.hypot(dx, dy);
    const k = d <= 4 ? 1 : d >= 70 ? 0 : (1 - (d - 4) / 66) ** 2; v *= k;
    if (d > 0.5) pan = clamp(((dx * Math.sin(lh) - dy * Math.cos(lh)) / d) * Math.min(1, d / 4) * 0.9, -0.9, 0.9); // right of heading = (sin h, -cos h)
  }
  if (v < 0.008) return;
  const now = ctx.currentTime;
  for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < now) voices.splice(i, 1);
  if (voices.length >= MAXV) { // drop the quietest (the oldest of equals); if the new one is quieter still, skip it
    let q = 0; for (let i = 1; i < voices.length; i++) if (voices[i].lvl < voices[q].lvl) q = i;
    if (voices[q].lvl >= v) return;
    try { voices[q].out.disconnect(); } catch (e) { /* already gone */ } voices.splice(q, 1);
  }
  const out = ctx.createGain(); out.gain.value = v;
  if (ctx.createStereoPanner) { const sp = ctx.createStereoPanner(); sp.pan.value = pan; out.connect(sp); sp.connect(sfxBus); } else out.connect(sfxBus);
  const len = fn(now + 0.005, out, o.pitch > 0 ? o.pitch : 1);
  voices.push({ out, end: now + len + 0.1, lvl: v });
}
function setListener(x, y, heading) {
  lx = x; ly = y; lh = heading || 0; haveListener = true;
  if (ctx) ambTick();
}

// ---------- scooter engine ----------
let eng = null, wantEng = false, wantSpeed = 0, engT = 0;
function engine(on, speed01) {
  wantEng = !!on; wantSpeed = clamp(Number(speed01) || 0, 0, 1);
  if (!live()) return;
  const now = ctx.currentTime;
  if (!wantEng) {
    if (!eng) return;
    eng.g.gain.setTargetAtTime(0, now, 0.1); const e = eng; eng = null;
    for (const o of e.oscs) try { o.stop(now + 0.6); } catch (err) { /* already stopped */ } return;
  }
  if (!eng) { // saw plus a pulse-ish sub, lowpassed, with a slow wobble in the pitch
    const g = ctx.createGain(), lp = ctx.createBiquadFilter(), o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain(), wob = ctx.createOscillator(), wg = ctx.createGain();
    g.gain.value = 0; lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.value = 400;
    o1.type = 'sawtooth'; o2.type = 'square'; g2.gain.value = 0.5; wob.frequency.value = 7; wg.gain.value = 18; wob.connect(wg); wg.connect(o1.detune); wg.connect(o2.detune);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(engBus); o1.start(); o2.start(); wob.start();
    eng = { g, lp, o1, o2, wob, oscs: [o1, o2, wob] }; engT = 0;
  }
  if (now - engT < 0.05) return; engT = now; // the caller runs this every frame; 20 updates a second is plenty
  const s = wantSpeed, f = 48 + 100 * s;
  eng.o1.frequency.setTargetAtTime(f, now, 0.08); eng.o2.frequency.setTargetAtTime(f * 0.5, now, 0.08);
  eng.lp.frequency.setTargetAtTime(380 + 1700 * s, now, 0.1); eng.g.gain.setTargetAtTime(0.1 + 0.16 * s, now, 0.12);
  eng.wob.frequency.setTargetAtTime(6 + 5 * s, now, 0.2);
}

// ---------- sounds that belong to places (registered by content/soundscape.js) ----------
// { x, y } or at(listenerX, listenerY) -> [x, y] | null (asked afresh each time, e.g. a house near the listener), r: heard within,
// hours: [from, to), every: [min, max] seconds between plays, sound, vol, when(): extra condition
const PLACES = [];
function addSoundSpot(o) { PLACES.push({ next: 0, vol: 1, ...o }); }
function placeTick(now) {
  const tm = state.time;
  for (const s of PLACES) {
    if (now < s.next || tm < s.hours[0] || tm >= s.hours[1] || (s.when && !s.when())) continue;
    const pos = s.at ? s.at(lx, ly) : [s.x, s.y];
    if (!pos || Math.hypot(pos[0] - lx, pos[1] - ly) > s.r) { s.next = now + 2; continue; }
    s.next = now + rnd(s.every[0], s.every[1]); sfx(s.sound, { x: pos[0], y: pos[1], vol: s.vol });
  }
}

// ---------- ambience ----------
let beds = null, ambOverride = null, ambAt = 0, ambLvl = { traffic: 0, birds: 0, crowd: 0 }, nextKoel = 0;
function buildBeds() {
  const loopSrc = buf => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * (buf.duration - 0.1)); return s; };
  const slow = (param, rate, depth) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g); g.connect(param); o.start(); };
  // traffic: rumble with a slow swell, plus a thin band of tyre hiss
  const traffic = ctx.createGain(), wob = ctx.createGain(), lp = ctx.createBiquadFilter(), hiss = ctx.createBiquadFilter(), hg = ctx.createGain();
  traffic.gain.value = 0; wob.gain.value = 0.85; slow(wob.gain, 0.13, 0.15); lp.type = 'lowpass'; lp.frequency.value = 520;
  loopSrc(brown).connect(lp); lp.connect(wob); wob.connect(traffic); hiss.type = 'bandpass'; hiss.frequency.value = 1700; hiss.Q.value = 0.5; hg.gain.value = 0.05; loopSrc(white).connect(hiss); hiss.connect(hg); hg.connect(traffic); traffic.connect(ambBus);
  // crowd: two voice-range bands, wobbling at syllable rate
  const crowd = ctx.createGain(); crowd.gain.value = 0;
  for (const [f, q, r] of [[480, 1.1, 3.4], [1050, 1.4, 4.3]]) { const bp = ctx.createBiquadFilter(), w = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; w.gain.value = 0.7; slow(w.gain, r, 0.3); slow(w.gain, 0.21, 0.1); loopSrc(white).connect(bp); bp.connect(w); w.connect(crowd); }
  crowd.connect(ambBus);
  const birds = ctx.createGain(); birds.gain.value = 0; birds.connect(ambBus);
  beds = { traffic, crowd, birds };
}
function setAmbience(levels) {
  ambOverride = levels ? { traffic: clamp(levels.traffic || 0, 0, 1), birds: clamp(levels.birds || 0, 0, 1), crowd: clamp(levels.crowd || 0, 0, 1) } : null;
  if (ctx) { ambAt = 0; ambTick(); }
}
function ambTick() {
  const nowMs = performance.now(); if (nowMs - ambAt < 250 || !beds || !haveListener && !ambOverride) return; ambAt = nowMs;
  let tr, bi, cr;
  if (ambOverride) { tr = ambOverride.traffic; bi = ambOverride.birds; cr = ambOverride.crowd; }
  else {
    const dm = nearestOnMain(lx, ly)[0], dh = Math.hypot(lx - HAT.x, ly - HAT.y);
    tr = Math.max(0.06, (1 - clamp((dm - 6) / 140, 0, 1)) ** 1.5, 0.9 * (1 - clamp(dh / 130, 0, 1)));
    const hill = clamp((hAt(lx, ly) - 8) / 10, 0, 1), tm = state.time, tod = tm < 9 ? 1 : tm < 16 ? 0.5 : 0.7;
    bi = clamp((0.12 + 0.6 * hill) * tod * (1 - 0.6 * tr), 0, 1); // road noise masks the birds
    cr = Math.max(1 - clamp(dh / 75, 0, 1), 0.8 * (1 - clamp(Math.hypot(lx + 120, ly + 80) / 45, 0, 1)));
  }
  ambLvl.traffic = tr; ambLvl.birds = bi; ambLvl.crowd = cr;
  const t = ctx.currentTime;
  beds.traffic.gain.setTargetAtTime(tr * 0.38, t, 0.5); beds.crowd.gain.setTargetAtTime(cr * 0.2, t, 0.5); beds.birds.gain.setTargetAtTime(bi > 0.01 ? 1 : 0, t, 0.5);
  if (live() && bi > 0.03 && Math.random() < 1 - Math.exp(-bi * 1.1 * 0.25)) chirp(bi);
  if (live()) placeTick(t);
}
function chirp(level) { // one bird call into the birds bed; a koel-like call now and then
  const t = ctx.currentTime + 0.02, out = ctx.createGain(); out.gain.value = 0.12 + 0.25 * level;
  if (ctx.createStereoPanner) { const sp = ctx.createStereoPanner(); sp.pan.value = rnd(-0.8, 0.8); out.connect(sp); sp.connect(beds.birds); } else out.connect(beds.birds);
  if (t > nextKoel && Math.random() < 0.15) { // koel: rising "ku-oo", repeated and climbing
    nextKoel = t + 15;
    for (let i = 0; i < 3; i++) { const d = t + i * 0.9, k = 1 + i * 0.07; tone(out, 'sine', 680 * k, 880 * k, d, 0.28, 0.8, 0.03); tone(out, 'sine', 900 * k, 1500 * k, d + 0.3, 0.55, 1.0, 0.04); }
    return;
  }
  const n = 2 + (Math.random() * 4 | 0), base = rnd(2600, 5200); let d = t;
  for (let i = 0; i < n; i++) { const up = Math.random() < 0.5, f = base * (1 + 0.05 * i); tone(out, 'sine', f, f * (up ? 1.3 : 0.75), d, rnd(0.04, 0.08), 0.8, 0.006); d += rnd(0.07, 0.12); }
}

export { initAudio, sfx, setListener, setAmbience, engine, setVolume, addSoundSpot };
