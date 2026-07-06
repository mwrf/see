/** Shared math helpers — pure, usable from UI thread, worklet, and tests. */

export const TWO_PI = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** MIDI note number -> frequency in Hz (A4 = 69 = 440). */
export function noteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Map a normalized 0..1 value onto an exponential range. */
export function expMap(t: number, lo: number, hi: number): number {
  return lo * Math.pow(hi / lo, t);
}

/** Equal-power pan: input -1..+1, returns [gainL, gainR]. */
export function panGains(pan: number): [number, number] {
  const p = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI; // 0..pi/2
  return [Math.cos(p), Math.sin(p)];
}

/** Deterministic 32-bit PRNG (mulberry32) so engine output is reproducible in tests. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flush denormals / NaN / Inf to keep feedback DSP stable. */
export function sanitize(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.abs(x) < 1e-15 ? 0 : x;
}

/** dB -> linear gain */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Tiny DFT magnitude at a single frequency — test helper for "is the fundamental there". */
export function goertzelMag(buf: Float32Array, freq: number, sampleRate: number): number {
  const w = (TWO_PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s0 = 0,
    s1 = 0,
    s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    s0 = buf[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (buf.length / 2);
}
