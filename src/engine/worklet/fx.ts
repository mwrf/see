/**
 * The 16 effect types + FX slot wrapper. Effects process stereo bus buffers in
 * place. EDIT1/EDIT2 are the two panel knobs (0..127), meanings per type.
 */

import { clamp, lerp, sanitize, TWO_PI } from '../../shared/math';
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
    const fb = 0.75 + (e1 / 127) * 0.23;
    const mix = e2 / 127;
    const damp = 0.35;
    for (let i = from; i < to; i++) {
      const inL = l[i];
      const inR = r[i];
      let wl = 0;
      let wr = 0;
      for (let c = 0; c < 4; c++) {
        const readL = this.combsL[c].read(this.timesL[c]);
        const readR = this.combsR[c].read(this.timesR[c]);
        this.combLp[c] += damp * (readL - this.combLp[c]);
        this.combLp[c + 4] += damp * (readR - this.combLp[c + 4]);
        this.combsL[c].write(inL + this.combLp[c] * fb);
        this.combsR[c].write(inR + this.combLp[c + 4] * fb);
        wl += readL;
        wr += readR;
      }
      // single allpass diffusion stage
      const apInL = wl * 0.25;
      const apInR = wr * 0.25;
      const apOutL = this.apL.read(0.005 * this.sr) - 0.5 * apInL;
      const apOutR = this.apR.read(0.0056 * this.sr) - 0.5 * apInR;
      this.apL.write(apInL + 0.5 * apOutL);
      this.apR.write(apInR + 0.5 * apOutR);
      l[i] = lerp(inL, sanitize(apOutL), mix);
      r[i] = lerp(inR, sanitize(apOutR), mix);
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
    const time = (0.002 + (e1 / 127) * 0.18) * this.sr;
    const fb = (e2 / 127) * 0.85;
    for (let i = from; i < to; i++) {
      const wl = this.dl.read(time);
      const wr = this.dr.read(time * 1.01);
      this.dl.write(l[i] + wl * fb);
      this.dr.write(r[i] + wr * fb);
      l[i] += wl * 0.8;
      r[i] += wr * 0.8;
    }
  }
}

const DELAY_DIVS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.5, 2]; // beats

class BpmDelay implements FxProcessor {
  private dl: DelayLine;
  private dr: DelayLine;

  constructor(private sr: number) {
    this.dl = new DelayLine(sr * 4);
    this.dr = new DelayLine(sr * 4);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number, bpm: number): void {
    const div = DELAY_DIVS[clamp(Math.round((e1 / 127) * (DELAY_DIVS.length - 1)), 0, DELAY_DIVS.length - 1)];
    const time = clamp(((60 / bpm) * div) * this.sr, 8, this.sr * 4 - 8);
    const fb = (e2 / 127) * 0.85;
    for (let i = from; i < to; i++) {
      const wl = this.dl.read(time);
      const wr = this.dr.read(time);
      // ping-pong: cross feedback
      this.dl.write(l[i] + wr * fb);
      this.dr.write(r[i] + wl * fb);
      l[i] += wl * 0.8;
      r[i] += wr * 0.8;
    }
  }
}

class ModDelay implements FxProcessor {
  private dl: DelayLine;
  private dr: DelayLine;
  private phase = 0;

  constructor(private sr: number) {
    this.dl = new DelayLine(sr * 0.6);
    this.dr = new DelayLine(sr * 0.6);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const base = (0.01 + (e1 / 127) * 0.4) * this.sr;
    const depth = (e2 / 127) * 0.004 * this.sr;
    for (let i = from; i < to; i++) {
      this.phase = (this.phase + 0.7 / this.sr) % 1;
      const m = Math.sin(TWO_PI * this.phase) * depth;
      const wl = this.dl.read(base + m);
      const wr = this.dr.read(base - m);
      this.dl.write(l[i] + wl * 0.45);
      this.dr.write(r[i] + wr * 0.45);
      l[i] += wl * 0.7;
      r[i] += wr * 0.7;
    }
  }
}

class GrainShifter implements FxProcessor {
  private buf: DelayLine;
  private grain = 2048;
  private counter = 0;

  constructor(private sr: number) {
    this.buf = new DelayLine(sr);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    this.grain = Math.floor(64 + (e1 / 127) * (e1 / 127) * this.sr * 0.4);
    const mix = e2 / 127;
    for (let i = from; i < to; i++) {
      this.buf.write((l[i] + r[i]) * 0.5);
      this.counter++;
      if (this.counter >= this.grain) this.counter = 0;
      const w = this.buf.read(this.grain - this.counter + 1);
      l[i] = lerp(l[i], w, mix);
      r[i] = lerp(r[i], w, mix);
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
    const speed = 0.05 + (e1 / 127) * (e1 / 127) * 6;
    const depth = e2 / 127;
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

class Phaser implements FxProcessor {
  private zl = [0, 0, 0, 0];
  private zr = [0, 0, 0, 0];
  private phase = 0;
  private fbL = 0;
  private fbR = 0;

  constructor(private sr: number) {}

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const speed = 0.03 + (e1 / 127) * (e1 / 127) * 4;
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
    const freq = 20 * Math.pow(200, e1 / 127);
    const mix = e2 / 127;
    for (let i = from; i < to; i++) {
      this.phase = (this.phase + freq / this.sr) % 1;
      const m = Math.sin(TWO_PI * this.phase);
      l[i] = lerp(l[i], l[i] * m, mix);
      r[i] = lerp(r[i], r[i] * m, mix);
    }
  }
}

class TalkMod implements FxProcessor {
  private f1l: Svf;
  private f2l: Svf;
  private f1r: Svf;
  private f2r: Svf;

  constructor(sr: number) {
    this.f1l = new Svf(sr);
    this.f2l = new Svf(sr);
    this.f1r = new Svf(sr);
    this.f2r = new Svf(sr);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const F1 = [700, 550, 300, 450, 325];
    const F2 = [1100, 1750, 2300, 800, 700];
    const pos = (e1 / 127) * 4;
    const i0 = Math.min(3, Math.floor(pos));
    const fr = pos - i0;
    const q = 4 + (e2 / 127) * 10;
    const f1 = lerp(F1[i0], F1[i0 + 1], fr);
    const f2 = lerp(F2[i0], F2[i0 + 1], fr);
    this.f1l.set(f1, q);
    this.f2l.set(f2, q);
    this.f1r.set(f1, q);
    this.f2r.set(f2, q);
    for (let i = from; i < to; i++) {
      l[i] = (this.f1l.process(l[i], 2) + this.f2l.process(l[i], 2) * 0.8) * 1.5;
      r[i] = (this.f1r.process(r[i], 2) + this.f2r.process(r[i], 2) * 0.8) * 1.5;
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
    const semis = Math.round(((e1 - 64) / 63) * 12);
    const ratio = Math.pow(2, semis / 12);
    const mix = e2 / 127;
    const inc = 1 - ratio;
    for (let i = from; i < to; i++) {
      this.dl.write(l[i]);
      this.dr.write(r[i]);
      this.read += inc;
      if (this.read < 1) this.read += this.win;
      if (this.read > this.win * 2) this.read -= this.win;
      const d1 = this.read;
      const d2 = d1 > this.win ? d1 - this.win : d1 + this.win;
      // crossfade between two read heads to hide the wrap
      const x = Math.abs((d1 % this.win) / this.win - 0.5) * 2;
      const g1 = 1 - x;
      const g2 = x;
      const wl = this.dl.read(d1) * g1 + this.dl.read(d2) * g2;
      const wr = this.dr.read(d1) * g1 + this.dr.read(d2) * g2;
      l[i] = lerp(l[i], wl, mix);
      r[i] = lerp(r[i], wr, mix);
    }
  }
}

class Compressor implements FxProcessor {
  private env = 0;

  constructor(private sr: number) {}

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const thresh = Math.pow(10, (-(e1 / 127) * 40) / 20); // 0..-40dB
    const atk = Math.exp(-1 / ((0.001 + (e2 / 127) * 0.05) * this.sr));
    const rel = Math.exp(-1 / (0.12 * this.sr));
    const makeup = 1 + (e1 / 127) * 2.2;
    for (let i = from; i < to; i++) {
      const level = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      this.env = level > this.env ? level + (this.env - level) * atk : level + (this.env - level) * rel;
      let gain = 1;
      if (this.env > thresh) gain = Math.pow(this.env / thresh, -0.75); // ~4:1
      l[i] *= gain * makeup;
      r[i] *= gain * makeup;
    }
  }
}

class Distortion implements FxProcessor {
  private lpL: Svf;
  private lpR: Svf;

  constructor(sr: number) {
    this.lpL = new Svf(sr);
    this.lpR = new Svf(sr);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const drive = 1 + (e1 / 127) * (e1 / 127) * 60;
    const tone = 400 * Math.pow(40, e2 / 127);
    this.lpL.set(tone, 0.8);
    this.lpR.set(tone, 0.8);
    const comp = 1 / Math.pow(drive, 0.6);
    for (let i = from; i < to; i++) {
      l[i] = this.lpL.process(Math.tanh(l[i] * drive) * comp * 2, 0);
      r[i] = this.lpR.process(Math.tanh(r[i] * drive) * comp * 2, 0);
    }
  }
}

class Decimator implements FxProcessor {
  private holdL = 0;
  private holdR = 0;
  private counter = 0;

  process(l: Float32Array, r: Float32Array, from: number, to: number, e1: number, e2: number): void {
    const step = 1 + Math.floor((e1 / 127) * (e1 / 127) * 60);
    const bits = 16 - Math.floor((e2 / 127) * 13);
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
    const lowGain = ((e1 - 64) / 63) * 1.2; // +/- shelf amount
    const highGain = ((e2 - 64) / 63) * 1.2;
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
      return new ShortDelay(sr);
    case 2:
      return new BpmDelay(sr);
    case 3:
      return new ModDelay(sr);
    case 4:
      return new GrainShifter(sr);
    case 5:
      return new ChorusFlanger(sr);
    case 6:
      return new Phaser(sr);
    case 7:
      return new RingMod(sr);
    case 8:
      return new TalkMod(sr);
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
