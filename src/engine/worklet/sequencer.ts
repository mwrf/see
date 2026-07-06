/**
 * Sequencer clock — pure timing math, no audio APIs.
 * The clock is rigid: step boundaries advance on an exact float sample grid.
 * Swing never warps the clock; it only delays the *trigger times* of off-beat
 * steps (handled by the core via a pending-trigger queue).
 */

import type { Beat } from '../../shared/model';
import { BEAT_HAS_SWING, STEPS_PER_QUARTER } from '../../shared/model';

export interface StepBoundary {
  /** step index within the pattern (0..totalSteps-1) */
  step: number;
  /** absolute sample time of the rigid boundary */
  time: number;
  /** true when this boundary wrapped to step 0 (pattern end -> start) */
  wrapped: boolean;
}

export class SequencerClock {
  private samplePos = 0;
  private nextBoundaryTime = 0;
  private nextStep = 0;
  private spsCache = 0;

  bpm = 120;
  beat: Beat = '16';
  totalSteps = 16;
  swing = 50; // 50..75

  constructor(public sr: number) {
    this.recalc();
  }

  private recalc(): void {
    this.spsCache = (this.sr * 60) / (this.bpm * STEPS_PER_QUARTER[this.beat]);
  }

  get samplesPerStep(): number {
    return this.spsCache;
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.recalc();
  }

  setBeat(beat: Beat): void {
    this.beat = beat;
    this.recalc();
  }

  /** Restart from step 0 at the current sample position. */
  reset(): void {
    this.samplePos = 0;
    this.nextBoundaryTime = 0;
    this.nextStep = 0;
  }

  /** Current playback position in steps (float), for motion interpolation / LED display. */
  get stepFloat(): number {
    const prevStep = (this.nextStep - 1 + this.totalSteps) % this.totalSteps;
    const sinceBoundary = this.samplePos - (this.nextBoundaryTime - this.spsCache);
    return (prevStep + Math.min(1, Math.max(0, sinceBoundary / this.spsCache))) % this.totalSteps;
  }

  get position(): number {
    return this.samplePos;
  }

  /**
   * Swing delay (in samples) for a given step index, or 0.
   * Off-beat 16ths (odd step in a pair) are delayed toward the next step.
   */
  swingDelay(step: number): number {
    if (!BEAT_HAS_SWING[this.beat] || this.swing <= 50) return 0;
    if (step % 2 !== 1) return 0;
    return ((this.swing - 50) / 100) * 2 * this.spsCache;
  }

  /**
   * Advance the clock by `blockLen` samples, returning every rigid step
   * boundary that falls inside [samplePos, samplePos + blockLen).
   */
  advance(blockLen: number): StepBoundary[] {
    const end = this.samplePos + blockLen;
    const out: StepBoundary[] = [];
    while (this.nextBoundaryTime < end) {
      const step = this.nextStep;
      out.push({ step, time: this.nextBoundaryTime, wrapped: step === 0 && this.nextBoundaryTime > 0 });
      this.nextStep = (this.nextStep + 1) % this.totalSteps;
      this.nextBoundaryTime += this.spsCache;
    }
    this.samplePos = end;
    return out;
  }
}
