/**
 * Valve Force — tube output stage emulation.
 * Asymmetric tanh waveshaping with a 2nd-harmonic bias, 2× oversampled
 * (linear-interp up, half-band-ish averaging down) to keep aliasing down.
 */

import { sanitize } from '../../shared/math';

export class Valve {
  private prevL = 0;
  private prevR = 0;
  private dcL = 0;
  private dcR = 0;

  private shape(x: number, drive: number, bias: number): number {
    const y = Math.tanh((x + bias) * drive) - Math.tanh(bias * drive);
    return y / Math.max(0.2, Math.tanh(drive * 0.8));
  }

  /** gain 0..127 tube gain knob. Processes in place. */
  process(l: Float32Array, r: Float32Array, from: number, to: number, gain: number): void {
    if (gain <= 0.5) {
      this.prevL = l[to - 1] ?? this.prevL;
      this.prevR = r[to - 1] ?? this.prevR;
      return;
    }
    const t = gain / 127;
    const drive = 1 + t * t * 7;
    const bias = 0.12 * t;
    const post = 1 / (1 + t * 0.9);
    for (let i = from; i < to; i++) {
      // 2x oversample: process midpoint + sample, average down
      const midL = (this.prevL + l[i]) * 0.5;
      const midR = (this.prevR + r[i]) * 0.5;
      this.prevL = l[i];
      this.prevR = r[i];
      let yl = (this.shape(midL, drive, bias) + this.shape(l[i], drive, bias)) * 0.5;
      let yr = (this.shape(midR, drive, bias) + this.shape(r[i], drive, bias)) * 0.5;
      // one-pole DC blocker (the asymmetric shaper introduces offset)
      this.dcL = sanitize(this.dcL + 0.002 * (yl - this.dcL));
      this.dcR = sanitize(this.dcR + 0.002 * (yr - this.dcR));
      yl -= this.dcL;
      yr -= this.dcR;
      l[i] = yl * post;
      r[i] = yr * post;
    }
  }
}
