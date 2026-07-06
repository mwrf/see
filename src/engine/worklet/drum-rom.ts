/**
 * Procedural drum ROM — 207 synthesized drum/percussion waves standing in for
 * the EMX-1's PCM drum set. Deterministic (seeded), rendered once at engine
 * init at the engine's sample rate. Zero assets to download.
 *
 * Layout: 0-29 kicks, 30-59 snares, 60-74 claps, 75-89 hats, 90-104 cymbals,
 * 105-119 toms, 120-159 percussion, 160-206 hits/FX.  Total 207.
 */

import { clamp, makeRng, TWO_PI } from '../../shared/math';
import { Svf } from './dsp';

export interface DrumWave {
  name: string;
  data: Float32Array;
}

export const NUM_DRUM_WAVES = 207;

const CAT_RANGES: [string, number, number][] = [
  ['KICK', 0, 30],
  ['SNARE', 30, 30],
  ['CLAP', 60, 15],
  ['HAT', 75, 15],
  ['CYMBAL', 90, 15],
  ['TOM', 105, 15],
  ['PERC', 120, 40],
  ['HIT', 160, 47],
];

export function drumWaveName(id: number): string {
  for (const [cat, start, count] of CAT_RANGES) {
    if (id >= start && id < start + count) {
      return `${cat} ${String(id - start + 1).padStart(2, '0')}`;
    }
  }
  return `WAVE ${id}`;
}

export function drumWaveCategory(id: number): string {
  for (const [cat, start, count] of CAT_RANGES) {
    if (id >= start && id < start + count) return cat;
  }
  return '?';
}

function normalize(buf: Float32Array, peak = 0.95): Float32Array {
  let max = 1e-9;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** Short raised-cosine fade at the tail to avoid clicks. */
function fadeOut(buf: Float32Array, ms: number, sr: number): Float32Array {
  const n = Math.min(buf.length, Math.floor((ms / 1000) * sr));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    buf[buf.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * t);
  }
  return buf;
}

function renderKick(v: number, sr: number, rng: () => number): Float32Array {
  // v 0..1 selects character across the bank
  const start = 120 + v * 700 + rng() * 60; // click/pitch-drop start Hz
  const end = 32 + v * 25;
  const pDec = 0.01 + v * v * 0.09; // pitch envelope time
  const aDec = 0.12 + (1 - v) * 0.5 + rng() * 0.15;
  const drive = 1 + v * 3;
  const click = v * 0.6;
  const len = Math.floor(sr * (aDec * 1.2 + 0.05));
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = end + (start - end) * Math.exp(-t / pDec);
    phase += (TWO_PI * f) / sr;
    const amp = Math.exp((-6.9 * t) / aDec);
    let s = Math.sin(phase) * amp;
    if (t < 0.004) s += click * (rng() * 2 - 1) * (1 - t / 0.004);
    out[i] = Math.tanh(s * drive);
  }
  return fadeOut(normalize(out), 8, sr);
}

function renderSnare(v: number, sr: number, rng: () => number): Float32Array {
  const tone = 140 + v * 220;
  const tDec = 0.05 + v * 0.1;
  const nDec = 0.08 + v * 0.28 + rng() * 0.05;
  const mix = 0.35 + v * 0.5; // noise amount
  const bp = new Svf(sr);
  bp.set(1200 + v * 4000, 1 + v * 2);
  const len = Math.floor(sr * (Math.max(tDec, nDec) * 1.3 + 0.03));
  const out = new Float32Array(len);
  let ph1 = 0;
  let ph2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const fEnv = 1 + 1.5 * Math.exp(-t / 0.02);
    ph1 += (TWO_PI * tone * fEnv) / sr;
    ph2 += (TWO_PI * tone * 1.63 * fEnv) / sr;
    const body = (Math.sin(ph1) + 0.6 * Math.sin(ph2)) * Math.exp((-6.9 * t) / tDec);
    const noise = bp.process(rng() * 2 - 1, 3) * Math.exp((-6.9 * t) / nDec);
    out[i] = Math.tanh(body * (1 - mix) * 2 + noise * mix * 2.4);
  }
  return fadeOut(normalize(out), 8, sr);
}

function renderClap(v: number, sr: number, rng: () => number): Float32Array {
  const bpHz = 900 + v * 1800;
  const spacing = 0.008 + v * 0.008;
  const bursts = 3 + Math.floor(v * 2);
  const tail = 0.12 + v * 0.3;
  const bp = new Svf(sr);
  bp.set(bpHz, 2.5);
  const len = Math.floor(sr * (bursts * spacing + tail * 1.2));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let env = 0;
    for (let b = 0; b < bursts; b++) {
      const dt = t - b * spacing;
      if (dt >= 0 && dt < spacing) env = Math.max(env, Math.exp(-dt / 0.004));
    }
    const tStart = bursts * spacing;
    if (t >= tStart) env = Math.max(env, Math.exp(-(t - tStart) / (tail / 4)));
    out[i] = bp.process((rng() * 2 - 1) * env, 3) * 2;
  }
  return fadeOut(normalize(out), 10, sr);
}

function renderMetallic(
  v: number,
  sr: number,
  rng: () => number,
  opts: { decay: number; hpHz: number; partials: number; shimmer: number },
): Float32Array {
  const ratios: number[] = [];
  for (let i = 0; i < opts.partials; i++) ratios.push(1 + i * 1.47 + rng() * 0.8);
  const base = 300 + v * 300;
  const hp = new Svf(sr);
  hp.set(opts.hpHz, 0.9);
  const len = Math.floor(sr * (opts.decay * 1.3 + 0.02));
  const out = new Float32Array(len);
  const phases = new Float64Array(opts.partials);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 0; k < opts.partials; k++) {
      phases[k] += (TWO_PI * base * ratios[k]) / sr;
      // square-ish partials = classic cheap-metal hat sound
      s += Math.sign(Math.sin(phases[k])) / opts.partials;
    }
    if (opts.shimmer > 0) s += (rng() * 2 - 1) * opts.shimmer;
    out[i] = hp.process(s, 1) * Math.exp((-6.9 * t) / opts.decay) * 2;
  }
  return fadeOut(normalize(out), 10, sr);
}

function renderTom(v: number, sr: number, rng: () => number): Float32Array {
  const start = 100 + v * 220 + rng() * 20;
  const end = start * 0.55;
  const dec = 0.15 + v * 0.25;
  const len = Math.floor(sr * (dec * 1.3 + 0.03));
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = end + (start - end) * Math.exp(-t / 0.08);
    phase += (TWO_PI * f) / sr;
    const amp = Math.exp((-6.9 * t) / dec);
    out[i] = Math.tanh((Math.sin(phase) + (rng() * 2 - 1) * 0.08 * Math.exp(-t / 0.02)) * 1.6) * amp;
  }
  return fadeOut(normalize(out), 8, sr);
}

function renderPerc(idx: number, sr: number, rng: () => number): Float32Array {
  const kind = idx % 8;
  const v = idx / 40;
  switch (kind) {
    case 0: {
      // conga/bongo: damped sine, slight strike noise
      const f = 180 + v * 400;
      const dec = 0.08 + v * 0.15;
      const len = Math.floor(sr * (dec * 1.4 + 0.02));
      const out = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph += (TWO_PI * f * (1 + 0.3 * Math.exp(-t / 0.008))) / sr;
        out[i] = Math.sin(ph) * Math.exp((-6.9 * t) / dec);
      }
      return fadeOut(normalize(out), 6, sr);
    }
    case 1: {
      // rimshot: filtered click + short ring
      const bp = new Svf(sr);
      bp.set(1700 + v * 800, 5);
      const len = Math.floor(sr * 0.09);
      const out = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph += (TWO_PI * (480 + v * 200)) / sr;
        const click = t < 0.003 ? rng() * 2 - 1 : 0;
        out[i] = bp.process(click * 3, 2) + Math.sin(ph) * Math.exp(-t / 0.015) * 0.7;
      }
      return fadeOut(normalize(out), 5, sr);
    }
    case 2: {
      // cowbell: two detuned squares
      const f = 520 + v * 300;
      const len = Math.floor(sr * 0.24);
      const out = new Float32Array(len);
      let p1 = 0;
      let p2 = 0;
      const bp = new Svf(sr);
      bp.set(f * 1.4, 1.5);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        p1 += (TWO_PI * f) / sr;
        p2 += (TWO_PI * f * 1.48) / sr;
        const s = Math.sign(Math.sin(p1)) + Math.sign(Math.sin(p2));
        out[i] = bp.process(s, 3) * Math.exp(-t / 0.07) * 2;
      }
      return fadeOut(normalize(out), 6, sr);
    }
    case 3: {
      // clave/wood: high damped sine
      const f = 800 + v * 1400;
      const len = Math.floor(sr * 0.09);
      const out = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph += (TWO_PI * f) / sr;
        out[i] = Math.sin(ph) * Math.exp(-t / 0.018);
      }
      return fadeOut(normalize(out), 4, sr);
    }
    case 4: {
      // shaker: short hp noise with attack shape
      const hp = new Svf(sr);
      hp.set(4000 + v * 4000, 1);
      const len = Math.floor(sr * 0.12);
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.035);
        out[i] = hp.process((rng() * 2 - 1) * env, 1) * 2;
      }
      return fadeOut(normalize(out), 6, sr);
    }
    case 5: {
      // zap: fast downward saw sweep
      const len = Math.floor(sr * 0.16);
      const out = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const f = 60 + (1800 + v * 2200) * Math.exp(-t / 0.03);
        ph = (ph + f / sr) % 1;
        out[i] = (2 * ph - 1) * Math.exp(-t / 0.05);
      }
      return fadeOut(normalize(out), 5, sr);
    }
    case 6: {
      // blip: short sine at fixed pitch
      const f = 400 + v * 2400;
      const len = Math.floor(sr * 0.07);
      const out = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph += (TWO_PI * f) / sr;
        out[i] = Math.sin(ph) * Math.exp(-t / 0.02);
      }
      return fadeOut(normalize(out), 4, sr);
    }
    default: {
      // tambourine-ish jingle
      return renderMetallic(v, sr, rng, { decay: 0.1 + v * 0.15, hpHz: 5000, partials: 5, shimmer: 0.4 });
    }
  }
}

function renderHit(idx: number, sr: number, rng: () => number): Float32Array {
  const kind = idx % 6;
  const v = idx / 47;
  switch (kind) {
    case 0: {
      // synth stab: detuned saw chord through closing LP
      const root = 55 * Math.pow(2, Math.floor(v * 24) / 12);
      const intervals = [0, 7, 12, v > 0.5 ? 3 : 4];
      const lp = new Svf(sr);
      const len = Math.floor(sr * 0.45);
      const out = new Float32Array(len);
      const phases = new Float64Array(intervals.length);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let s = 0;
        for (let k = 0; k < intervals.length; k++) {
          const f = root * Math.pow(2, intervals[k] / 12) * (1 + 0.002 * k);
          phases[k] = (phases[k] + f / sr) % 1;
          s += 2 * phases[k] - 1;
        }
        lp.set(300 + 6000 * Math.exp(-t / 0.09), 2);
        out[i] = lp.process(s * 0.3, 0) * Math.exp(-t / 0.2);
      }
      return fadeOut(normalize(out), 10, sr);
    }
    case 1: {
      // FM hit
      const f = 110 + v * 500;
      const ratio = 1 + Math.floor(v * 8);
      const len = Math.floor(sr * 0.35);
      const out = new Float32Array(len);
      let p1 = 0;
      let p2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        p2 += (TWO_PI * f * ratio) / sr;
        p1 += (TWO_PI * f) / sr;
        const depth = 5 * Math.exp(-t / 0.06);
        out[i] = Math.sin(p1 + depth * Math.sin(p2)) * Math.exp(-t / 0.12);
      }
      return fadeOut(normalize(out), 8, sr);
    }
    case 2: {
      // noise riser/sweep (reversed feel)
      const len = Math.floor(sr * 0.4);
      const out = new Float32Array(len);
      const bp = new Svf(sr);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        bp.set(200 + (v > 0.5 ? t : 1 - t) * 6000, 4);
        out[i] = bp.process((rng() * 2 - 1) * 2, 2) * Math.sin(Math.PI * t);
      }
      return fadeOut(normalize(out), 12, sr);
    }
    case 3: {
      // vox-ish formant blip
      const f = 130 + v * 160;
      const f1 = new Svf(sr);
      const f2 = new Svf(sr);
      f1.set(500 + v * 400, 7);
      f2.set(1400 + v * 900, 8);
      const len = Math.floor(sr * 0.25);
      const out = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph = (ph + f / sr) % 1;
        const src = 2 * ph - 1;
        out[i] = (f1.process(src, 2) + f2.process(src, 2) * 0.7) * Math.exp(-t / 0.1) * 1.6;
      }
      return fadeOut(normalize(out), 8, sr);
    }
    case 4: {
      // laser / pitch drop square
      const len = Math.floor(sr * 0.22);
      const out = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const f = 100 + (2500 + v * 3000) * Math.exp(-t / 0.05);
        ph = (ph + f / sr) % 1;
        out[i] = Math.sign(0.5 - ph) * Math.exp(-t / 0.08) * 0.9;
      }
      return fadeOut(normalize(out), 6, sr);
    }
    default: {
      // orchestral-ish burst: many harmonics with fast decay
      const root = 65 + v * 120;
      const len = Math.floor(sr * 0.4);
      const out = new Float32Array(len);
      const phases = new Float64Array(10);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let s = 0;
        for (let h = 1; h <= 10; h++) {
          phases[h - 1] += (TWO_PI * root * h * (1 + 0.001 * h)) / sr;
          s += Math.sin(phases[h - 1]) / Math.sqrt(h);
        }
        out[i] = Math.tanh(s * 0.5) * Math.exp(-t / 0.15);
      }
      return fadeOut(normalize(out), 10, sr);
    }
  }
}

/** Render a single drum wave by id. */
export function renderDrumWave(id: number, sr: number): DrumWave {
  const rng = makeRng(0xd00d + id * 7919);
  const name = drumWaveName(id);
  let data: Float32Array;
  if (id < 30) data = renderKick(id / 30, sr, rng);
  else if (id < 60) data = renderSnare((id - 30) / 30, sr, rng);
  else if (id < 75) data = renderClap((id - 60) / 15, sr, rng);
  else if (id < 90) {
    const v = (id - 75) / 15;
    // first two thirds closed (short), rest open (long)
    const open = id - 75 >= 10;
    data = renderMetallic(v, sr, rng, {
      decay: open ? 0.3 + v * 0.4 : 0.03 + v * 0.06,
      hpHz: 6500 + v * 2000,
      partials: 6,
      shimmer: 0.25,
    });
  } else if (id < 105) {
    const v = (id - 90) / 15;
    data = renderMetallic(v, sr, rng, {
      decay: 0.6 + v * 1.4,
      hpHz: 4000 + v * 2500,
      partials: 9,
      shimmer: 0.5,
    });
  } else if (id < 120) data = renderTom((id - 105) / 15, sr, rng);
  else if (id < 160) data = renderPerc(id - 120, sr, rng);
  else data = renderHit(id - 160, sr, rng);
  return { name, data: clampBuf(data) };
}

function clampBuf(buf: Float32Array): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] = clamp(buf[i], -1, 1);
  return buf;
}

/** Render the full ROM (used at engine init). */
export function renderDrumRom(sr: number): DrumWave[] {
  const waves: DrumWave[] = [];
  for (let i = 0; i < NUM_DRUM_WAVES; i++) waves.push(renderDrumWave(i, sr));
  return waves;
}
