/**
 * The 16 MMT oscillator algorithms for synth parts.
 * One Oscillator instance per synth voice; `sample()` is called per audio sample
 * with the current (possibly modulated) frequency and EDIT1/EDIT2 values (0..127).
 */

import { clamp, lerp, makeRng, TWO_PI } from '../../shared/math';
import { DelayLine, polyBlep, Svf } from './dsp';
import { CHORD_TYPES, getPcmTables, PCM_TABLE_SIZE } from './pcm-waves';

const SEMI = Math.pow(2, 1 / 12);

export class Oscillator {
  private ph = new Float64Array(8);
  private rng: () => number;
  private noise1: Svf;
  private noise2: Svf;
  private comb: DelayLine;
  private combLp = 0;
  private pwmPhase = 0;

  constructor(sr: number, seed = 1) {
    this.rng = makeRng(seed);
    this.noise1 = new Svf(sr);
    this.noise2 = new Svf(sr);
    this.comb = new DelayLine(sr / 8); // down to ~8 Hz fundamental
  }

  reset(): void {
    this.ph.fill(0);
    this.pwmPhase = 0;
    this.noise1.reset();
    this.noise2.reset();
    this.comb.clear();
    this.combLp = 0;
  }

  private saw(i: number, dt: number): number {
    let t = this.ph[i] + dt;
    if (t >= 1) t -= 1;
    this.ph[i] = t;
    return 2 * t - 1 - polyBlep(t, dt);
  }

  private square(i: number, dt: number, pw: number): number {
    let t = this.ph[i] + dt;
    if (t >= 1) t -= 1;
    this.ph[i] = t;
    let v = t < pw ? 1 : -1;
    v += polyBlep(t, dt);
    v -= polyBlep((t - pw + 1) % 1, dt);
    return v;
  }

  private sine(i: number, dt: number): number {
    let t = this.ph[i] + dt;
    if (t >= 1) t -= 1;
    this.ph[i] = t;
    return Math.sin(TWO_PI * t);
  }

  /** Render one sample. freq in Hz; e1/e2 raw 0..127. */
  sample(type: number, freq: number, e1: number, e2: number, sr: number): number {
    const dt = clamp(freq, 0.1, sr * 0.45) / sr;
    const n1 = e1 / 127;
    const n2 = e2 / 127;

    switch (type) {
      case 0: {
        // WAVEFORM: EDIT1 morphs saw -> square -> tri -> sine; EDIT2 = pulse width
        const m = n1 * 3;
        const pw = 0.5 - n2 * 0.45;
        let t = this.ph[0] + dt;
        if (t >= 1) t -= 1;
        this.ph[0] = t;
        const sawV = 2 * t - 1 - polyBlep(t, dt);
        let sqV = (t < pw ? 1 : -1) + polyBlep(t, dt) - polyBlep((t - pw + 1) % 1, dt);
        const triV = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
        const sinV = Math.sin(TWO_PI * t);
        if (m < 1) return lerp(sawV, sqV, m);
        if (m < 2) return lerp(sqV, triV, m - 1);
        return lerp(triV, sinV, m - 2);
      }
      case 1: {
        // DUAL OSC: two saws, EDIT1 = detune (0..+7 semis), EDIT2 = osc2 mix
        const det = Math.pow(SEMI, n1 * 7);
        const a = this.saw(0, dt);
        const b = this.saw(1, clamp((freq * det) / sr, 0, 0.45));
        return (a + b * n2) / (1 + n2);
      }
      case 2: {
        // UNISON: 5 voices, EDIT1 = spread, EDIT2 = saw->square morph
        const spread = n1 * 0.03;
        let out = 0;
        for (let v = 0; v < 5; v++) {
          const d = clamp(dt * (1 + spread * (v - 2)), 0, 0.45);
          const sawV = this.saw(v, d);
          out += n2 < 0.5 ? sawV : lerp(sawV, this.ph[v] < 0.5 ? 1 : -1, (n2 - 0.5) * 2);
        }
        return out * 0.35;
      }
      case 3: {
        // SYNC: hard-synced slave saw. EDIT1 = slave ratio 1..8, EDIT2 = slave shape
        let mt = this.ph[0] + dt;
        let synced = false;
        if (mt >= 1) {
          mt -= 1;
          synced = true;
        }
        this.ph[0] = mt;
        const ratio = 1 + n1 * 7;
        if (synced) this.ph[1] = mt * ratio; // restart slave at master wrap
        let st = this.ph[1] + dt * ratio;
        if (st >= 1) st -= Math.floor(st);
        this.ph[1] = st;
        const sawV = 2 * st - 1;
        const triV = st < 0.5 ? 4 * st - 1 : 3 - 4 * st;
        return lerp(sawV, triV, n2) * 0.9;
      }
      case 4: {
        // RING: sin(f) * sin(f*ratio); EDIT1 = ratio, EDIT2 = dry/ring mix
        const ratio = 0.5 + n1 * 7.5;
        const a = this.sine(0, dt);
        const b = this.sine(1, clamp((freq * ratio) / sr, 0, 0.45));
        return lerp(a, a * b, 0.25 + 0.75 * n2);
      }
      case 5: {
        // X-MOD: two sines cross-modulating; EDIT1 = ratio, EDIT2 = depth
        const ratio = 0.5 + Math.round(n1 * 15) * 0.5;
        const depth = n2 * 6;
        const p0 = this.ph[0];
        const p1 = this.ph[1];
        const a = Math.sin(TWO_PI * p0 + depth * Math.sin(TWO_PI * p1) * 0.5);
        const b = Math.sin(TWO_PI * p1 + depth * Math.sin(TWO_PI * p0) * 0.5);
        this.ph[0] = (p0 + dt) % 1;
        this.ph[1] = (p1 + dt * ratio) % 1;
        return (a + 0.4 * b) * 0.75;
      }
      case 6: {
        // VPM: classic 2-op phase modulation; EDIT1 = harmonic ratio, EDIT2 = depth
        const ratio = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16][Math.round(n1 * 11)];
        const mod = Math.sin(TWO_PI * this.ph[1]) * n2 * n2 * 8;
        const out = Math.sin(TWO_PI * this.ph[0] + mod);
        this.ph[0] = (this.ph[0] + dt) % 1;
        this.ph[1] = (this.ph[1] + dt * ratio) % 1;
        return out;
      }
      case 7: {
        // NOISE: filtered white noise; EDIT1 = color (cutoff), EDIT2 = resonance
        this.noise1.set(60 * Math.pow(250, n1), 0.5 + n2 * 12);
        return clamp(this.noise1.process(this.rng() * 2 - 1, 0) * (1 + n2 * 1.5), -1.2, 1.2);
      }
      case 8: {
        // PCM: EDIT1 selects wave, EDIT2 detunes a second copy against it
        const tables = getPcmTables();
        const idx = Math.min(tables.length - 1, Math.round((e1 / 127) * (tables.length - 1)));
        const tab = tables[idx];
        let t0 = this.ph[0] + dt;
        if (t0 >= 1) t0 -= 1;
        this.ph[0] = t0;
        const a = tab[(t0 * PCM_TABLE_SIZE) | 0];
        if (n2 < 0.01) return a;
        const det = Math.pow(SEMI, n2 * 0.5);
        let t1 = this.ph[1] + dt * det;
        if (t1 >= 1) t1 -= 1;
        this.ph[1] = t1;
        return (a + tab[(t1 * PCM_TABLE_SIZE) | 0]) * 0.6;
      }
      case 9: {
        // CHORD: saw stack; EDIT1 = chord type, EDIT2 = detune/spread
        const chord = CHORD_TYPES[Math.min(CHORD_TYPES.length - 1, Math.round(n1 * (CHORD_TYPES.length - 1)))];
        let out = 0;
        for (let v = 0; v < chord.notes.length; v++) {
          const f = freq * Math.pow(SEMI, chord.notes[v]) * (1 + n2 * 0.004 * (v - 1));
          out += this.saw(v, clamp(f / sr, 0, 0.45));
        }
        return (out / chord.notes.length) * 1.2;
      }
      case 10: {
        // COMB: noise-excited comb resonator (Karplus-Strong-ish).
        // EDIT1 = feedback, EDIT2 = exciter brightness/noise level
        const delaySamp = sr / clamp(freq, 20, 4000);
        const fb = 0.8 + n1 * 0.199;
        const exciter = (this.rng() * 2 - 1) * (0.15 + n2 * 0.85);
        const back = this.comb.read(delaySamp);
        this.combLp = this.combLp + (0.15 + n2 * 0.6) * (back - this.combLp); // damping in loop
        const v = exciter + this.combLp * fb;
        this.comb.write(v);
        return clamp(v, -1.5, 1.5) * 0.8;
      }
      case 11: {
        // FORMANT: saw through two vowel formant band-passes; EDIT1 = vowel morph, EDIT2 = gender
        const F1 = [700, 550, 300, 450, 325]; // A E I O U
        const F2 = [1100, 1750, 2300, 800, 700];
        const pos = n1 * 4;
        const i0 = Math.min(3, Math.floor(pos));
        const fr = pos - i0;
        const shift = 0.6 + n2 * 1.2;
        const src = this.saw(0, dt);
        this.noise1.set(lerp(F1[i0], F1[i0 + 1], fr) * shift, 6);
        this.noise2.set(lerp(F2[i0], F2[i0 + 1], fr) * shift, 8);
        return clamp((this.noise1.process(src, 2) + this.noise2.process(src, 2) * 0.8) * 1.6, -1.3, 1.3);
      }
      case 12: {
        // PWM: square with internally modulated width; EDIT1 = width/depth, EDIT2 = mod speed
        this.pwmPhase = (this.pwmPhase + (0.05 + n2 * n2 * 12) / sr) % 1;
        const pw = 0.5 + Math.sin(TWO_PI * this.pwmPhase) * 0.45 * n1;
        return this.square(0, dt, clamp(pw, 0.03, 0.97));
      }
      case 13: {
        // SUPER-7: seven detuned saws; EDIT1 = detune, EDIT2 = side-voice mix
        const det = n1 * 0.035;
        let out = this.saw(3, dt); // center
        let side = 0;
        for (let v = 0; v < 7; v++) {
          if (v === 3) continue;
          side += this.saw(v, clamp(dt * (1 + det * (v - 3) * 0.5), 0, 0.45));
        }
        return (out + side * n2 * 0.55) * 0.5;
      }
      case 14: {
        // ADDITIVE: 16 harmonics; EDIT1 = spectral tilt, EDIT2 = odd/even balance
        let out = 0;
        const tilt = -2 + n1 * 2.2; // exponent
        for (let h = 1; h <= 16; h++) {
          const odd = h % 2 === 1;
          const bal = odd ? 1 - n2 * 0.9 : 0.1 + n2 * 0.9;
          const amp = Math.pow(h, tilt) * bal;
          out += amp * Math.sin(TWO_PI * ((this.ph[0] * h) % 1));
        }
        this.ph[0] = (this.ph[0] + dt) % 1;
        return clamp(out * 0.4, -1.3, 1.3);
      }
      default: {
        // 15 MOD-NOIZ: noise ring-modulated by the pitch, band-passed at the pitch.
        // EDIT1 = bandwidth (resonance), EDIT2 = raw-noise mix
        const nz = this.rng() * 2 - 1;
        const carrier = this.sine(0, dt);
        this.noise1.set(clamp(freq, 40, sr * 0.4), 1 + (1 - n1) * 14);
        const pitched = this.noise1.process(nz * carrier, 2) * (2 + (1 - n1) * 3);
        return clamp(lerp(pitched, nz, n2 * 0.8), -1.3, 1.3);
      }
    }
  }
}
