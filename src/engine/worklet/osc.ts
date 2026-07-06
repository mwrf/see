/**
 * The 16 MMT oscillator algorithms for synth parts, matching the EMX-1
 * owner's manual (p.34-38): type + WAVE selector + OSC EDIT1/EDIT2 semantics.
 * One Oscillator instance per synth voice; `sample()` is called per audio
 * sample with the current (possibly modulated) parameter values.
 */

import { clamp, lerp, makeRng, TWO_PI } from '../../shared/math';
import { CHORD_NOTES, mapBipolar, mapHarmonic } from '../../shared/params';
import { DelayLine, polyBlep, Svf } from './dsp';
import { getPcmTables, PCM_TABLE_SIZE } from './pcm-waves';

const SEMI = Math.pow(2, 1 / 12);

/** ±63-style edit value -> pitch ratio (±63 = ±2 octaves, 47 ≈ ±1 octave). */
function editToRatio(e: number): number {
  const c = mapBipolar(e); // -1..1
  return Math.pow(2, c * 2);
}

/** 0..127 edit -> 0..+4 octaves ratio (comb pitch / sync slave pitch). */
function editToRatioUp4(e: number): number {
  return Math.pow(2, (e / 127) * 4);
}

/** Basic waveform generator index: 0 saw, 1 pulse/square, 2 tri, 3 sin, 4 noise. */
type BasicWave = 0 | 1 | 2 | 3 | 4;

export class Oscillator {
  private ph = new Float64Array(8);
  private rng: () => number;
  private noise1: Svf;
  private noise2: Svf;
  private comb: DelayLine;
  private combLp = 0;
  private shNoise = 0;
  private shCountdown = 0;

  constructor(sr: number, seed = 1) {
    this.rng = makeRng(seed);
    this.noise1 = new Svf(sr);
    this.noise2 = new Svf(sr);
    this.comb = new DelayLine(sr / 8);
  }

  reset(): void {
    this.ph.fill(0);
    this.noise1.reset();
    this.noise2.reset();
    this.comb.clear();
    this.combLp = 0;
    this.shCountdown = 0;
  }

  /** Advance phase i and return a basic bandlimited waveform. morph: 0..1 shape tweak. */
  private basic(i: number, dt: number, wave: BasicWave, morph = 0): number {
    if (wave === 4) return this.rng() * 2 - 1;
    let t = this.ph[i] + dt;
    if (t >= 1) t -= 1;
    this.ph[i] = t;
    switch (wave) {
      case 0: {
        // saw; morph 0..1 blends toward square (manual: waveform knob saw->square)
        const saw = 2 * t - 1 - polyBlep(t, dt);
        if (morph <= 0) return saw;
        const sq = (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt);
        return lerp(saw, sq, morph);
      }
      case 1: {
        // pulse; morph narrows pulse width from square (0) to silent sliver (1)
        const pw = clamp(0.5 - morph * 0.5, 0.02, 0.5);
        let v = t < pw ? 1 : -1;
        v += polyBlep(t, dt);
        v -= polyBlep((t - pw + 1) % 1, dt);
        return v;
      }
      case 2: {
        // tri; morph blends toward a brighter folded triangle (oct+5th flavor)
        const tri = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
        if (morph <= 0) return tri;
        const fold = Math.sin(TWO_PI * t) * Math.cos(TWO_PI * t * 2.5) * 1.2;
        return lerp(tri, clamp(fold, -1, 1), morph);
      }
      default: {
        // sin; morph adds overtone content via cheap phase shaping
        const s = Math.sin(TWO_PI * t + morph * 2.5 * Math.sin(TWO_PI * t * 2));
        return s;
      }
    }
  }

  /** Comb filter shared by COMB / PCM+COMB / NOIZ+COMB (Karplus-style loop). */
  private combProcess(input: number, freqHz: number, feedback: number, sr: number): number {
    const delaySamp = clamp(sr / clamp(freqHz, 20, 8000), 4, sr / 8 - 2);
    const fb = 0.5 + (feedback / 127) * 0.495;
    const back = this.comb.read(delaySamp);
    this.combLp += 0.35 * (back - this.combLp); // damping in the loop
    const v = input + this.combLp * fb;
    this.comb.write(v);
    return clamp(v * 0.7, -1.5, 1.5);
  }

  /**
   * Render one sample.
   * freq in Hz (already includes note/tune/transpose); wave = WAVE selector raw;
   * e1/e2 = OSC EDIT1/2 raw 0..127.
   */
  sample(type: number, freq: number, wave: number, e1: number, e2: number, sr: number): number {
    const dt = clamp(freq, 0.1, sr * 0.45) / sr;
    const n1 = e1 / 127;
    const w = Math.max(0, Math.round(wave));

    switch (type) {
      case 0: {
        // WAVE FORM: 2 osc; wave = Saw/Pulse/Tri/Sin; e1 = waveform morph; e2 = osc2 pitch ±2oct
        const wf = clamp(w, 0, 3) as BasicWave;
        const a = this.basic(0, dt, wf, n1);
        const c2 = mapBipolar(e2);
        if (Math.abs(c2) < 0.02) return a; // near 0 = only osc1 (manual)
        const ratio = editToRatio(e2);
        // second oscillator needs its own phase; reuse slot 1 with same waveform/morph
        const b = this.basic(1, clamp(dt * ratio, 0, 0.45), wf, n1);
        return (a + b) * 0.6;
      }
      case 1: {
        // DUAL OSC: wave = 20 combos (osc1 of 4 × osc2 of 5); e1 = balance; e2 = osc2 pitch
        const combo = clamp(w, 0, 19);
        const w1 = Math.floor(combo / 5) as BasicWave;
        const w2raw = combo % 5;
        const w2 = (w2raw === 4 ? 4 : w2raw) as BasicWave;
        const a = this.basic(0, dt, w1);
        const b = this.basic(1, clamp(dt * editToRatio(e2), 0, 0.45), w2);
        return lerp(a, b, n1);
      }
      case 2: {
        // CHORD OSC: 4 osc chord; wave = Saw/Squ/Tri/Sin; e1 = chord name; e2 = voicing -3..+3
        const wf = clamp(w, 0, 3) as BasicWave;
        const chord = CHORD_NOTES[clamp(Math.round((e1 / 127) * (CHORD_NOTES.length - 1)), 0, CHORD_NOTES.length - 1)];
        const voicing = Math.round(mapBipolar(e2) * 3);
        let out = 0;
        for (let v = 0; v < 4; v++) {
          let semis = chord[v % chord.length];
          // voicing shifts alternate chord tones by octaves
          if (voicing > 0 && v % 2 === 1) semis += 12 * Math.min(voicing, 2);
          if (voicing < 0 && v % 2 === 1) semis -= 12 * Math.min(-voicing, 2);
          const f = clamp((dt * Math.pow(SEMI, semis)), 0, 0.45);
          out += this.basic(v, f, wf);
        }
        return out * 0.3;
      }
      case 3: {
        // UNISON: wave = 3Saw..6Sin (count + waveform); e1 = detune; e2 = osc1 pitch
        const opt = clamp(w, 0, 11);
        const wf = Math.floor(opt / 4) as BasicWave;
        const count = 3 + (opt % 4);
        const det = (e1 / 127) * 0.025 + 0.0008; // never perfectly identical (manual)
        let out = this.basic(0, clamp(dt * editToRatio(e2), 0, 0.45), wf);
        for (let v = 1; v < count; v++) {
          const spread = det * (v - (count - 1) / 2);
          out += this.basic(v, clamp(dt * (1 + spread), 0, 0.45), wf);
        }
        return (out / count) * 1.4;
      }
      case 4: {
        // RING MOD: e1 = dry/ring balance; e2 = osc2 pitch
        const combo = clamp(w, 0, 19);
        const w1 = Math.floor(combo / 5) as BasicWave;
        const w2 = (combo % 5) as BasicWave;
        const a = this.basic(0, dt, w1);
        const b = this.basic(1, clamp(dt * editToRatio(e2), 0, 0.45), w2);
        return lerp(a, a * b * 1.4, n1);
      }
      case 5: {
        // OSC SYNC: osc1 (master, saw) resets osc2 (slave); wave = slave waveform;
        // e1 = slave waveform morph; e2 = slave pitch 0..+4 oct
        let mt = this.ph[0] + dt;
        let synced = false;
        if (mt >= 1) {
          mt -= 1;
          synced = true;
        }
        this.ph[0] = mt;
        const ratio = editToRatioUp4(e2);
        if (synced) this.ph[1] = (mt * ratio) % 1;
        const wf = clamp(w, 0, 3) as BasicWave;
        return this.basic(1, clamp(dt * ratio, 0, 0.45), wf, n1) * 0.9;
      }
      case 6: {
        // CROSS MOD: osc2 frequency-modulates osc1; e1 = depth; e2 = osc2 pitch
        const combo = clamp(w, 0, 19);
        const w1 = Math.floor(combo / 5) as BasicWave;
        const modV = Math.sin(TWO_PI * this.ph[1]);
        this.ph[1] = (this.ph[1] + dt * editToRatio(e2)) % 1;
        const fmDt = clamp(dt * (1 + modV * n1 * 6), 0.0000001, 0.45);
        return this.basic(0, fmDt, w1);
      }
      case 7: {
        // VPM: osc2 phase-modulates osc1; wave = carrier waveform; e1 = depth; e2 = harmonic 0.25..32
        const harm = mapHarmonic(e2);
        const mod = Math.sin(TWO_PI * this.ph[1]) * n1 * n1 * 8;
        this.ph[1] = (this.ph[1] + dt * harm) % 1;
        const wf = clamp(w, 0, 3) as BasicWave;
        // apply phase modulation by offsetting the carrier phase read
        let t = this.ph[0] + dt;
        if (t >= 1) t -= 1;
        this.ph[0] = t;
        const phase = (((t + mod / TWO_PI) % 1) + 1) % 1;
        switch (wf) {
          case 0:
            return 2 * phase - 1;
          case 1:
            return phase < 0.5 ? 1 : -1;
          case 2:
            return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
          default:
            return Math.sin(TWO_PI * phase);
        }
      }
      case 8: {
        // WAVE SHAPE: two osc mixed through a nonlinear shaper; wave = Type1/Type2;
        // e1 = shape depth; e2 = osc2 pitch
        const a = this.basic(0, dt, 0);
        const b = this.basic(1, clamp(dt * editToRatio(e2), 0, 0.45), 0);
        const x = (a + b * 0.7) * 0.6;
        const drive = 1 + n1 * n1 * 30;
        if (clamp(w, 0, 1) === 0) {
          return Math.tanh(x * drive) / Math.max(0.4, Math.tanh(drive * 0.35));
        }
        // Type2: folded sine shaper — harsher
        return clamp(Math.sin(x * drive * 1.8), -1, 1);
      }
      case 9: {
        // ADDITIVE: 3 osc; wave = basic waveform; e1 = osc2 harmonic; e2 = osc3 harmonic
        const wf = clamp(w, 0, 3) as BasicWave;
        const a = this.basic(0, dt, wf);
        const b = this.basic(1, clamp(dt * mapHarmonic(e1), 0, 0.45), wf);
        const c = this.basic(2, clamp(dt * mapHarmonic(e2), 0, 0.45), wf);
        return (a + b * 0.7 + c * 0.5) * 0.5;
      }
      case 10: {
        // COMB OSC: basic waveform through comb; wave incl. Noise; e1 = feedback; e2 = comb pitch
        const wf = clamp(w, 0, 4) as BasicWave;
        const src = this.basic(0, dt, wf) * 0.5;
        return this.combProcess(src, freq * editToRatioUp4(e2), e1, sr);
      }
      case 11: {
        // FORMANT OSC: two formant band-passes over a pulse source;
        // e1 = formant spread (vowel), e2 = offset (formant pitch shift)
        const src = this.basic(0, dt, 1, 0.3);
        const spread = 1 + n1 * 4;
        const offset = Math.pow(2, mapBipolar(e2) * 1.5);
        const f1 = clamp(280 * offset, 60, 5000);
        const f2 = clamp(280 * spread * offset * 2.2, 200, 6000);
        this.noise1.set(f1, 7);
        this.noise2.set(f2, 8);
        return clamp((this.noise1.process(src, 2) + this.noise2.process(src, 2) * 0.8) * 1.6, -1.3, 1.3);
      }
      case 12: {
        // NOISE OSC: sample&hold noise source + LPF/HPF mix; e1 = rate; e2 = color
        if (--this.shCountdown <= 0) {
          // higher e1 = slower noise generation (manual)
          this.shCountdown = 1 + Math.floor(n1 * n1 * 220);
          this.shNoise = this.rng() * 2 - 1;
        }
        const base = clamp(freq * 4, 100, 12000);
        this.noise1.set(base, 1.2);
        this.noise2.set(base, 1.2);
        const lp = this.noise1.process(this.shNoise, 0);
        const hp = this.noise2.process(this.shNoise, 1);
        const color = mapBipolar(e2); // -1 = only LPF, +1 = only HPF
        return clamp(lerp(lp, hp, (color + 1) / 2) * 1.5, -1.3, 1.3);
      }
      case 13: {
        // PCM+COMB: PCM wave through comb filter; wave = 1..76; e1 = feedback; e2 = comb pitch
        const src = this.pcmSample(w, dt) * 0.6;
        return this.combProcess(src, freq * editToRatioUp4(e2), e1, sr);
      }
      case 14: {
        // PCM+WS: waveshaped PCM; wave = 1..76; e1 = shape depth; e2 = character
        const src = this.pcmSample(w, dt);
        const drive = 1 + n1 * n1 * 25;
        const bias = (e2 / 127 - 0.5) * 0.8;
        const y = Math.tanh((src + bias) * drive) - Math.tanh(bias * drive);
        return clamp(y / Math.max(0.35, Math.tanh(drive * 0.3)), -1.3, 1.3) * 0.9;
      }
      default: {
        // NOIZ+COMB (hardware: AUDIO IN+COMB — browser stand-in uses noise excitation)
        const src = (this.rng() * 2 - 1) * 0.4;
        return this.combProcess(src, freq * editToRatioUp4(e2), e1, sr);
      }
    }
  }

  private pcmSample(wave: number, dt: number): number {
    const tables = getPcmTables();
    const idx = clamp(wave, 0, tables.length - 1);
    const tab = tables[idx];
    let t = this.ph[0] + dt;
    if (t >= 1) t -= 1;
    this.ph[0] = t;
    return tab[(t * PCM_TABLE_SIZE) | 0];
  }
}
