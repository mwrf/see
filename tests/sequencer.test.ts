import { describe, expect, it } from 'vitest';
import { SequencerClock } from '../src/engine/worklet/sequencer';
import { STEPS_PER_BAR, STEPS_PER_QUARTER, type Beat } from '../src/shared/model';

const SR = 48000;

describe('SequencerClock', () => {
  it('computes samplesPerStep for every beat mode', () => {
    const clock = new SequencerClock(SR);
    for (const beat of ['16', '32', '8T', '16T'] as Beat[]) {
      clock.setBeat(beat);
      clock.setTempo(120);
      const expected = (SR * 60) / (120 * STEPS_PER_QUARTER[beat]);
      expect(clock.samplesPerStep).toBeCloseTo(expected, 6);
    }
  });

  it('emits one boundary per step with no cumulative drift at 300 BPM', () => {
    const clock = new SequencerClock(SR);
    clock.setTempo(300);
    clock.totalSteps = 16;
    clock.reset();
    const sps = clock.samplesPerStep;
    const boundaries: { step: number; time: number }[] = [];
    // render ~4 pattern loops in 128-sample blocks
    const totalSamples = Math.ceil(sps * 64) + 256;
    for (let pos = 0; pos < totalSamples; pos += 128) {
      boundaries.push(...clock.advance(128));
    }
    expect(boundaries.length).toBeGreaterThanOrEqual(64);
    for (let i = 0; i < 64; i++) {
      expect(boundaries[i].step).toBe(i % 16);
      expect(boundaries[i].time).toBeCloseTo(i * sps, 3);
    }
  });

  it('emits boundaries at 20 BPM too', () => {
    const clock = new SequencerClock(SR);
    clock.setTempo(20);
    clock.totalSteps = 16;
    clock.reset();
    const sps = clock.samplesPerStep; // 36000 samples at 20bpm 16th
    let count = 0;
    let rendered = 0;
    for (let pos = 0; pos < sps * 3; pos += 128) {
      count += clock.advance(128).length;
      rendered += 128;
    }
    // boundaries at 0, sps, 2*sps always covered; 3*sps included iff the
    // final partial block reaches it
    expect(count).toBe(rendered > sps * 3 ? 4 : 3);
  });

  it('marks pattern wrap boundaries', () => {
    const clock = new SequencerClock(SR);
    clock.setTempo(240);
    clock.totalSteps = 4;
    clock.reset();
    const all: { step: number; wrapped: boolean }[] = [];
    for (let pos = 0; pos < clock.samplesPerStep * 9; pos += 128) {
      all.push(...clock.advance(128));
    }
    expect(all[0].wrapped).toBe(false);
    const wraps = all.filter((b) => b.wrapped);
    expect(wraps.length).toBeGreaterThanOrEqual(2);
    for (const w of wraps) expect(w.step).toBe(0);
  });

  describe('swing', () => {
    it('delays only odd steps, up to half a step at 75%', () => {
      const clock = new SequencerClock(SR);
      clock.setTempo(120);
      clock.swing = 75;
      const sps = clock.samplesPerStep;
      expect(clock.swingDelay(0)).toBe(0);
      expect(clock.swingDelay(2)).toBe(0);
      expect(clock.swingDelay(1)).toBeCloseTo(sps * 0.5, 6);
      expect(clock.swingDelay(3)).toBeCloseTo(sps * 0.5, 6);
    });

    it('is zero at 50% and on triplet grids', () => {
      const clock = new SequencerClock(SR);
      clock.swing = 50;
      expect(clock.swingDelay(1)).toBe(0);
      clock.swing = 70;
      clock.setBeat('8T');
      expect(clock.swingDelay(1)).toBe(0);
      clock.setBeat('16T');
      expect(clock.swingDelay(1)).toBe(0);
      clock.setBeat('16');
      expect(clock.swingDelay(1)).toBeGreaterThan(0);
    });
  });

  it('steps per bar match the hardware grids (manual p.52)', () => {
    expect(STEPS_PER_BAR['16']).toBe(16);
    expect(STEPS_PER_BAR['32']).toBe(16); // 32nd-note steps, still 16 per measure
    expect(STEPS_PER_BAR['8T']).toBe(12);
    expect(STEPS_PER_BAR['16T']).toBe(12);
  });
});
