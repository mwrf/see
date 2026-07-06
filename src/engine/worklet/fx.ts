/**
 * The 16 effect types + FX slot wrapper, in the EMX-1 manual's order with the
 * manual's FX EDIT1/EDIT2 semantics (p.43-45). Effects process stereo bus
 * buffers in place.
 *
 *  0 REVERB     time / level        8 CHO/FLG    speed / depth(→flanger)
 *  1 BPM DELAY  time(note) / depth  9 PITCH SFT  pitch ±2400c / balance
 *  2 MOD DELAY  time(note) / depth 10 COMPRESSR  sens / attack
 *  3 GRAIN SFT  speed / balance    11 DISTORTON  gain / level
 *  4 SHORT DLY  time / depth       12 DECIMATOR  freq / bit
 *  5 PHASER     speed / depth      13 EQ         low ± / high ±
 *  6 RING MOD   oscfreq / balance  14 LPF        cutoff / resonance
 *  7 TALK MOD   formant / offset   15 HPF        cutoff / resonance
 */

import { clamp, lerp, sanitize, TWO_PI } from '../../shared/math';
import { DELAY_DIVS } from '../../shared/params';
import { DelayLine, Svf } from './dsp';

export interface FxProcessor {
  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number, bpm: number): void;
}

class Reverb implements FxProcessor {
  private combsL: DelayLine[];
  private combsR: DelayLine[];
  private timesL: number[];
  private timesR: number[];
  private combLp: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private apL: DelayLine;
  private apR: DelayLine;

  constructor(private sr: number) {
    const times = [0.0297, 0.0371, 0.0411, 0.0437];
    this.timesL = times.map((t) => t * sr);
    this.timesR = times.map((t) => t * sr * 1.07);
    this.combsL = this.timesL.map((t) => new DelayLine(t + 8));
    this.combsR = this.timesR.map((t) => new DelayLine(t + 8));
    this.apL = new DelayLine(0.0071 * sr + 8);
    this.apR = new DelayLine(0.0077 * sr + 8);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const fb = 0.7 + (e1 / 127) * 0.28; // TIME
    const level = e2 / 127; // LEVEL (wet mixed onto dry, mono-mix topology)
    const damp = 0.35;
    for (let i = from; i < to; i++) {
      const mono = (l[i] + r[i]) * 0.5;
      let wl = 0;
      let wr = 0;
      for (let c = 0; c < 4; c++) {
        const readL = this.combsL[c].read(this.timesL[c]);
        const readR = this.combsR[c].read(this.timesR[c]);
        this.combLp[c] += damp * (readL - this.combLp[c]);
        this.combLp[c + 4] += damp * (readR - this.combLp[c + 4]);
        this.combsL[c].write(mono + this.combLp[c] * fb);
        this.combsR[c].write(mono + this.combLp[c + 4] * fb);
        wl += readL;
        wr += readR;
      }
      const apInL = wl * 0.25;
      const apInR = wr * 0.25;
      const apOutL = this.apL.read(0.005 * this.sr) - 0.5 * apInL;
      const apOutR = this.apR.read(0.0056 * this.sr) - 0.5 * apInR;
      this.apL.write(apInL + 0.5 * apOutL);
      this.apR.write(apInR + 0.5 * apOutR);
      l[i] += sanitize(apOutL) * level;
      r[i] += sanitize(apOutR) * level;
    }
  }
}

/** e1 -> BPM-synced delay samples using the manual's note-value steps. */
function bpmDelaySamples(e1: number, bpm: number, sr: number, maxSamples: number): number {
  const div = DELAY_DIVS[clamp(Math.round((e1 / 127) * (DELAY_DIVS.length - 1)), 0, DELAY_DIVS.length - 1)];
  return clamp((60 / bpm) * div.beats * sr, 8, maxSamples);
}

class BpmDelay implements FxProcessor {
  private dl: DelayLine;
  private dr: DelayLine;
  private max: number;

  constructor(sr: number) {
    this.max = sr * 4;
    this.dl = new DelayLine(this.max);
    this.dr = new DelayLine(this.max);
    this.sr = sr;
  }

  private sr: number;

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number, bpm: number): void {
    const time = bpmDelaySamples(e1, bpm, this.sr, this.max - 8);
    const depth = e2 / 127; // level + feedback
    const fb = depth * 0.75;
    for (let i = from; i < to; i++) {
      const wl = this.dl.read(time);
      const wr = this.dr.read(time);
      // stereo cross topology: L feeds R's line and vice versa
      this.dl.write(l[i] + wr * fb);
      this.dr.write(r[i] + wl * fb);
      l[i] += wl * depth;
      r[i] += wr * depth;
    }
  }
}

class ModDelay implements FxProcessor {
  private dl: DelayLine;
  private dr: DelayLine;
  private phase = 0;
  private max: number;

  constructor(private sr: number) {
    this.max = sr * 4;
    this.dl = new DelayLine(this.max);
    this.dr = new DelayLine(this.max);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number, bpm: number): void {
    const base = bpmDelaySamples(e1, bpm, this.sr, this.max - 200);
    const depth = e2 / 127;
    const fb = depth * 0.6;
    const modAmt = Math.min(base * 0.3, 0.004 * this.sr);
    for (let i = from; i < to; i++) {
      this.phase = (this.phase + 0.6 / this.sr) % 1;
      const m = Math.sin(TWO_PI * this.phase) * modAmt;
      const mono = (l[i] + r[i]) * 0.5;
      const wl = this.dl.read(base + m);
      const wr = this.dr.read(base - m);
      this.dl.write(mono + wl * fb);
      this.dr.write(mono + wr * fb);
      l[i] += wl * depth;
      r[i] += wr * depth;
    }
  }
}

/** Manual p.44: grain interval in sequencer steps by SPEED value. */
function grainSteps(speed: number): number {
  if (speed <= 1) return 128;
  if (speed <= 5) return 32;
  if (speed <= 9) return 16;
  if (speed <= 13) return 12;
  if (speed <= 21) return 8;
  if (speed <= 25) return 6;
  if (speed <= 33) return 4;
  if (speed <= 37) return 3;
  if (speed <= 41) return 8 / 3;
  if (speed <= 49) return 2;
  if (speed <= 53) return 4 / 3;
  if (speed <= 83) return 1;
  // 84..127: 9/10 down to 1/10 in even steps
  const t = (speed - 84) / (127 - 84);
  return 0.9 - t * 0.8;
}

class GrainShifter implements FxProcessor {
  private buf: DelayLine;
  private counter = 0;
  private grain = 2048;

  constructor(private sr: number) {
    this.buf = new DelayLine(sr * 4);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number, bpm: number): void {
    const stepSamples = (this.sr * 60) / (bpm * 4); // 16th-note step
    this.grain = clamp(Math.floor(grainSteps(Math.round(e1)) * stepSamples), 32, this.sr * 4 - 8);
    const bal = e2 / 127;
    for (let i = from; i < to; i++) {
      this.buf.write((l[i] + r[i]) * 0.5);
      this.counter++;
      if (this.counter >= this.grain) this.counter = 0;
      const w = this.buf.read(this.grain - this.counter + 1);
      l[i] = lerp(l[i], w, bal);
      r[i] = lerp(r[i], w, bal);
    }
  }
}

class ShortDelay implements FxProcessor {
  private dl: DelayLine;
  private dr: DelayLine;

  constructor(private sr: number) {
    this.dl = new DelayLine(sr * 0.2);
    this.dr = new DelayLine(sr * 0.2);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const time = (0.001 + (e1 / 127) * 0.18) * this.sr;
    const depth = e2 / 127;
    const fb = depth * 0.7;
    for (let i = from; i < to; i++) {
      const wl = this.dl.read(time);
      const wr = this.dr.read(time * 1.013);
      // stereo cross feedback
      this.dl.write(l[i] + wr * fb);
      this.dr.write(r[i] + wl * fb);
      l[i] += wl * depth;
      r[i] += wr * depth;
    }
  }
}

class Phaser implements FxProcessor {
  private zl = [0, 0, 0, 0];
  private zr = [0, 0, 0, 0];
  private phase = 0;
  private fbL = 0;
  private fbR = 0;

  constructor(private sr: number) {}

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const speed = (e1 / 127) * (e1 / 127) * 5; // SPEED (0 freezes the LFO, like hardware)
    const depth = e2 / 127;
    for (let i = from; i < to; i++) {
      this.phase = (this.phase + speed / this.sr) % 1;
      const sweep = 300 + (Math.sin(TWO_PI * this.phase) * 0.5 + 0.5) * 2200 * depth;
      const a = (Math.tan((Math.PI * sweep) / this.sr) - 1) / (Math.tan((Math.PI * sweep) / this.sr) + 1);
      let xl = l[i] + this.fbL * 0.5 * depth;
      let xr = r[i] + this.fbR * 0.5 * depth;
      for (let s = 0; s < 4; s++) {
        const yl = a * xl + this.zl[s];
        this.zl[s] = sanitize(xl - a * yl);
        xl = yl;
        const yr = a * xr + this.zr[s];
        this.zr[s] = sanitize(xr - a * yr);
        xr = yr;
      }
      this.fbL = xl;
      this.fbR = xr;
      l[i] = l[i] * 0.6 + xl * 0.6;
      r[i] = r[i] * 0.6 + xr * 0.6;
    }
  }
}

class RingMod implements FxProcessor {
  private phase = 0;

  constructor(private sr: number) {}

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const freq = 20 * Math.pow(200, e1 / 127); // OSC FREQ
    const bal = e2 / 127; // BALANCE
    for (let i = from; i < to; i++) {
      this.phase = (this.phase + freq / this.sr) % 1;
      const m = Math.sin(TWO_PI * this.phase);
      l[i] = lerp(l[i], l[i] * m, bal);
      r[i] = lerp(r[i], r[i] * m, bal);
    }
  }
}

class TalkMod implements FxProcessor {
  private f1: Svf;
  private f2: Svf;

  constructor(sr: number) {
    this.f1 = new Svf(sr);
    this.f2 = new Svf(sr);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    // FORMANT sweeps [a]-[e]-[i]-[o]-[u]; OFFSET shifts formant pitch (manual)
    const F1 = [700, 550, 300, 450, 325];
    const F2 = [1100, 1750, 2300, 800, 700];
    const pos = (e1 / 127) * 4;
    const i0 = Math.min(3, Math.floor(pos));
    const fr = pos - i0;
    const shift = Math.pow(2, ((e2 - 64) / 63) * 1.2); // OFFSET ±
    const f1 = lerp(F1[i0], F1[i0 + 1], fr) * shift;
    const f2 = lerp(F2[i0], F2[i0 + 1], fr) * shift;
    this.f1.set(f1, 8);
    this.f2.set(f2, 9);
    for (let i = from; i < to; i++) {
      const mono = (l[i] + r[i]) * 0.5;
      const y = (this.f1.process(mono, 2) + this.f2.process(mono, 2) * 0.8) * 1.6;
      l[i] = y;
      r[i] = y;
    }
  }
}

class ChorusFlanger implements FxProcessor {
  private dl: DelayLine;
  private dr: DelayLine;
  private phase = 0;

  constructor(private sr: number) {
    this.dl = new DelayLine(sr * 0.05);
    this.dr = new DelayLine(sr * 0.05);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const speed = (e1 / 127) * (e1 / 127) * 6; // 0 freezes LFO (hardware behavior)
    const depth = e2 / 127; // higher depth morphs chorus -> flanger
    const flange = depth > 0.6;
    const base = (flange ? 0.002 : 0.012) * this.sr;
    const modAmt = base * 0.8 * depth;
    const fb = flange ? 0.6 : 0.1;
    for (let i = from; i < to; i++) {
      this.phase = (this.phase + speed / this.sr) % 1;
      const m1 = Math.sin(TWO_PI * this.phase);
      const m2 = Math.sin(TWO_PI * (this.phase + 0.25));
      const wl = this.dl.read(base + m1 * modAmt);
      const wr = this.dr.read(base + m2 * modAmt);
      this.dl.write(l[i] + wl * fb);
      this.dr.write(r[i] + wr * fb);
      l[i] = l[i] * 0.7 + wl * 0.7;
      r[i] = r[i] * 0.7 + wr * 0.7;
    }
  }
}

class PitchShifter implements FxProcessor {
  private dl: DelayLine;
  private dr: DelayLine;
  private read = 0;
  private win: number;

  constructor(sr: number) {
    this.dl = new DelayLine(sr * 0.25);
    this.dr = new DelayLine(sr * 0.25);
    this.win = sr * 0.05;
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    // PITCH: -2400..+2400 cents (center 64 = no shift), BALANCE: dry/wet
    const cents = ((e1 - 64) / 63) * 2400;
    const ratio = Math.pow(2, cents / 1200);
    const bal = e2 / 127;
    const inc = 1 - ratio;
    for (let i = from; i < to; i++) {
      this.dl.write(l[i]);
      this.dr.write(r[i]);
      this.read += inc;
      if (this.read < 1) this.read += this.win;
      if (this.read > this.win * 2) this.read -= this.win;
      const d1 = this.read;
      const d2 = d1 > this.win ? d1 - this.win : d1 + this.win;
      const x = Math.abs((d1 % this.win) / this.win - 0.5) * 2;
      const g1 = 1 - x;
      const g2 = x;
      const wl = this.dl.read(d1) * g1 + this.dl.read(d2) * g2;
      const wr = this.dr.read(d1) * g1 + this.dr.read(d2) * g2;
      l[i] = lerp(l[i], wl, bal);
      r[i] = lerp(r[i], wr, bal);
    }
  }
}

class Compressor implements FxProcessor {
  private env = 0;

  constructor(private sr: number) {}

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const thresh = Math.pow(10, (-(e1 / 127) * 40) / 20); // SENS
    const atk = Math.exp(-1 / ((0.001 + (e2 / 127) * 0.08) * this.sr)); // ATTACK (right = slower)
    const rel = Math.exp(-1 / (0.12 * this.sr));
    const makeup = 1 + (e1 / 127) * 2.2;
    for (let i = from; i < to; i++) {
      const level = Math.max(Math.abs(l[i]), Math.abs(r[i])); // detects louder of L/R
      this.env = level > this.env ? level + (this.env - level) * atk : level + (this.env - level) * rel;
      let gain = 1;
      if (this.env > thresh) gain = Math.pow(this.env / thresh, -0.75);
      l[i] *= gain * makeup;
      r[i] *= gain * makeup;
    }
  }
}

class Distortion implements FxProcessor {
  private lp: Svf;

  constructor(sr: number) {
    this.lp = new Svf(sr);
    this.lp.set(6500, 0.8);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const drive = 1 + (e1 / 127) * (e1 / 127) * 60; // GAIN
    const level = (e2 / 127) * 1.6; // LEVEL
    const comp = 1 / Math.pow(drive, 0.6);
    for (let i = from; i < to; i++) {
      const mono = (l[i] + r[i]) * 0.5; // mono-mix topology
      const y = this.lp.process(Math.tanh(mono * drive) * comp * 2, 0) * level;
      l[i] = y;
      r[i] = y;
    }
  }
}

class Decimator implements FxProcessor {
  private holdL = 0;
  private holdR = 0;
  private counter = 0;

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const step = 1 + Math.floor((e1 / 127) * (e1 / 127) * 60); // FREQ (right = lo-fi)
    const bits = 16 - Math.floor((e2 / 127) * 13); // BIT (right = lo-fi)
    const q = Math.pow(2, bits - 1);
    for (let i = from; i < to; i++) {
      if (++this.counter >= step) {
        this.counter = 0;
        this.holdL = Math.round(l[i] * q) / q;
        this.holdR = Math.round(r[i] * q) / q;
      }
      l[i] = this.holdL;
      r[i] = this.holdR;
    }
  }
}

class Eq implements FxProcessor {
  private lowL: Svf;
  private lowR: Svf;
  private highL: Svf;
  private highR: Svf;

  constructor(sr: number) {
    this.lowL = new Svf(sr);
    this.lowR = new Svf(sr);
    this.highL = new Svf(sr);
    this.highR = new Svf(sr);
    this.lowL.set(250, 0.7);
    this.lowR.set(250, 0.7);
    this.highL.set(3500, 0.7);
    this.highR.set(3500, 0.7);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const lowGain = ((e1 - 64) / 63) * 1.2; // LOW GAIN ± (center flat)
    const highGain = ((e2 - 64) / 63) * 1.2; // HIGH GAIN ±
    for (let i = from; i < to; i++) {
      const lLow = this.lowL.process(l[i], 0);
      const rLow = this.lowR.process(r[i], 0);
      const lHigh = this.highL.process(l[i], 1);
      const rHigh = this.highR.process(r[i], 1);
      l[i] = l[i] + lLow * lowGain + lHigh * highGain;
      r[i] = r[i] + rLow * lowGain + rHigh * highGain;
    }
  }
}

class FilterFx implements FxProcessor {
  private fl: Svf;
  private fr: Svf;

  constructor(sr: number, private mode: 0 | 1) {
    this.fl = new Svf(sr);
    this.fr = new Svf(sr);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const cutoff = 20 * Math.pow(900, e1 / 127);
    const q = 0.5 + (e2 / 127) * (e2 / 127) * 14;
    this.fl.set(cutoff, q);
    this.fr.set(cutoff, q);
    for (let i = from; i < to; i++) {
      l[i] = this.fl.process(l[i], this.mode);
      r[i] = this.fr.process(r[i], this.mode);
    }
  }
}

export function createFx(type: number, sr: number): FxProcessor {
  switch (type) {
    case 0:
      return new Reverb(sr);
    case 1:
      return new BpmDelay(sr);
    case 2:
      return new ModDelay(sr);
    case 3:
      return new GrainShifter(sr);
    case 4:
      return new ShortDelay(sr);
    case 5:
      return new Phaser(sr);
    case 6:
      return new RingMod(sr);
    case 7:
      return new TalkMod(sr);
    case 8:
      return new ChorusFlanger(sr);
    case 9:
      return new PitchShifter(sr);
    case 10:
      return new Compressor(sr);
    case 11:
      return new Distortion(sr);
    case 12:
      return new Decimator();
    case 13:
      return new Eq(sr);
    case 14:
      return new FilterFx(sr, 0);
    default:
      return new FilterFx(sr, 1);
  }
}
