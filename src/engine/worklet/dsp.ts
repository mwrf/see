/**
 * Core DSP building blocks used by voices and effects.
 * Pure TypeScript — no worklet APIs — so everything is unit-testable in Node.
 */

import { clamp, sanitize } from '../../shared/math';

/**
 * TPT (zero-delay feedback) state-variable filter, stable at high resonance.
 * Modes: 0 LPF, 1 HPF, 2 BPF, 3 BPF+ (band-pass mixed with dry, like the EMX's BPF+).
 */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0.5;
  private k = 1;

  constructor(private sr: number) {}

  set(cutoffHz: number, q: number): void {
    const fc = clamp(cutoffHz, 10, this.sr * 0.45);
    this.g = Math.tan((Math.PI * fc) / this.sr);
    this.k = 1 / clamp(q, 0.5, 20);
  }

  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  process(x: number, mode: number): number {
    const { g, k } = this;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const v1 = a1 * this.ic1 + a2 * (x - this.ic2);
    const v2 = this.ic2 + g * v1;
    this.ic1 = sanitize(2 * v1 - this.ic1);
    this.ic2 = sanitize(2 * v2 - this.ic2);
    switch (mode) {
      case 0:
        return v2; // LP
      case 1:
        return x - k * v1 - v2; // HP
      case 2:
        return k * v1; // BP (unity peak)
      default:
        return k * v1 + 0.5 * x; // BP+
    }
  }
}

/**
 * EMX-style amp envelope. Two shapes:
 *  - GATE (egOn=false): full level while the gate is open, short anti-click release.
 *  - DECAY (egOn=true): exponential decay from trigger, EG TIME = decay length.
 */
export class AmpEnv {
  private level = 0;
  private decayCoef = 0.999;
  private releaseCoef: number;
  private gateOpen = false;
  private decayMode = false;

  constructor(sr: number) {
    this.releaseCoef = Math.exp(-1 / (0.003 * sr)); // ~3ms release
  }

  trigger(decaySeconds: number, decayMode: boolean, sr: number): void {
    this.level = 1;
    this.decayMode = decayMode;
    this.gateOpen = true;
    // reach -60dB over decaySeconds
    this.decayCoef = Math.exp(-6.9078 / Math.max(1, decaySeconds * sr));
  }

  release(): void {
    this.gateOpen = false;
  }

  kill(): void {
    this.level = 0;
    this.gateOpen = false;
  }

  get active(): boolean {
    return this.level > 1e-4;
  }

  next(): number {
    if (this.decayMode) {
      this.level *= this.decayCoef;
    } else if (!this.gateOpen) {
      this.level *= this.releaseCoef;
    }
    if (this.level < 1e-5) this.level = 0;
    return this.level;
  }
}

/** One-shot decay envelope for filter EG / LFO-as-envelope. Returns 1 -> 0. */
export class DecayEnv {
  private level = 0;
  private coef = 0.999;

  trigger(decaySeconds: number, sr: number): void {
    this.level = 1;
    this.coef = Math.exp(-6.9078 / Math.max(1, decaySeconds * sr));
  }

  next(): number {
    this.level *= this.coef;
    if (this.level < 1e-5) this.level = 0;
    return this.level;
  }

  get value(): number {
    return this.level;
  }
}

/**
 * Part modulation LFO — hardware types (manual p.30): Saw, Squ, Tri, S&H, Env.
 * All types reset phase at each trigger EXCEPT Tri, which free-runs.
 * Env starts at maximum and decays smoothly (one-shot).
 */
export class Lfo {
  private phase = 0;
  private shValue = 0;
  private rngState: number;

  constructor(seed = 12345) {
    this.rngState = seed >>> 0;
  }

  private rand(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  /** Trigger-reset. `wave` decides whether the phase actually resets (Tri free-runs). */
  sync(wave: number): void {
    if (wave === 2) return; // Tri does not reset (manual p.30)
    this.phase = 0;
    this.shValue = this.rand() * 2 - 1;
  }

  /** Advance by freq/sr; returns bipolar -1..+1 (env returns 1->0 unipolar). */
  next(freqHz: number, wave: number, sr: number): number {
    const prev = this.phase;
    this.phase += freqHz / sr;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      if (wave === 3) this.shValue = this.rand() * 2 - 1;
    }
    const ph = this.phase;
    switch (wave) {
      case 0:
        return 1 - 2 * ph; // saw (falling)
      case 1:
        return ph < 0.5 ? 1 : -1; // square
      case 2:
        return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; // triangle (free-running)
      case 3:
        return this.shValue; // sample & hold
      default: {
        // one-shot decay envelope: falls 1 -> 0 across a single cycle, then stays 0
        if (this.phase < prev) this.phase = 1 - 1e-9; // freeze at end
        return Math.max(0, 1 - ph);
      }
    }
  }
}

/** One-pole parameter smoother (~time constant in seconds). */
export class Smoother {
  private y: number;
  private coef: number;

  constructor(sr: number, timeSeconds = 0.005, initial = 0) {
    this.y = initial;
    this.coef = Math.exp(-1 / (timeSeconds * sr));
  }

  set(v: number): void {
    this.y = v;
  }

  next(target: number): number {
    this.y = target + (this.y - target) * this.coef;
    return this.y;
  }

  get value(): number {
    return this.y;
  }
}

/** Simple circular delay line with linear-interpolated read. */
export class DelayLine {
  private buf: Float32Array;
  private pos = 0;

  constructor(maxSamples: number) {
    this.buf = new Float32Array(Math.max(4, Math.ceil(maxSamples)));
  }

  write(x: number): void {
    this.buf[this.pos] = sanitize(x);
    this.pos = (this.pos + 1) % this.buf.length;
  }

  /** Read `delay` samples back (before the most recent write). */
  read(delay: number): number {
    const n = this.buf.length;
    const d = clamp(delay, 1, n - 2);
    const rp = this.pos - 1 - d;
    const i0 = Math.floor(rp);
    const frac = rp - i0;
    const a = this.buf[((i0 % n) + n) % n];
    const b = this.buf[(((i0 + 1) % n) + n) % n];
    return a + (b - a) * frac;
  }

  clear(): void {
    this.buf.fill(0);
  }
}

/** PolyBLEP residual for alias-suppressed saw/square edges. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
