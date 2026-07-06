/**
 * Tests for hardware behaviors specified in the EMX-1 owner's manual:
 * drum pitch table, exclusive drum pairs, per-part swing switch, legato,
 * roll type, last step, live transpose, arp scales.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EmxCore } from '../src/engine/worklet/core';
import { renderDrumWave } from '../src/engine/worklet/drum-rom';
import type { FromEngine } from '../src/shared/messages';
import { createDefaultPattern } from '../src/shared/model';
import { ARP_SCALES, mapDrumPitchSemis } from '../src/shared/params';

const SR = 44100;
const BLOCK = 128;

function makeCore(): { core: EmxCore; messages: FromEngine[] } {
  const messages: FromEngine[] = [];
  const core = new EmxCore(SR, (msg) => messages.push(msg));
  const waves: Float32Array[] = [];
  for (const id of [0, 30, 75, 105]) waves[id] = renderDrumWave(id, SR).data;
  core.handle({ t: 'LOAD_ROM', waves });
  return { core, messages };
}

function renderSeconds(core: EmxCore, seconds: number): Float32Array {
  const total = Math.ceil((seconds * SR) / BLOCK) * BLOCK;
  const out = new Float32Array(total);
  const bl = new Float32Array(BLOCK);
  const br = new Float32Array(BLOCK);
  for (let pos = 0; pos < total; pos += BLOCK) {
    core.render(bl, br);
    out.set(bl, pos);
  }
  return out;
}

function findOnsets(buf: Float32Array, threshold = 0.05): number[] {
  const onsets: number[] = [];
  let quiet = true;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (quiet && a > threshold) {
      onsets.push(i);
      quiet = false;
    } else if (!quiet && a < threshold * 0.1) {
      let silent = true;
      for (let k = i; k < Math.min(i + 400, buf.length); k++) {
        if (Math.abs(buf[k]) > threshold * 0.2) {
          silent = false;
          break;
        }
      }
      if (silent) quiet = true;
    }
  }
  return onsets;
}

describe('drum pitch table (manual p.29)', () => {
  it('matches the documented anchor points', () => {
    expect(mapDrumPitchSemis(64)).toBe(0); // center
    expect(mapDrumPitchSemis(64 + 6)).toBeCloseTo(1, 5); // +6 = 1 semitone
    expect(mapDrumPitchSemis(64 + 39)).toBeCloseTo(12, 5); // +39 = 1 octave
    expect(mapDrumPitchSemis(64 + 63)).toBeCloseTo(24, 5); // +63 = 2 octaves
    expect(mapDrumPitchSemis(64 - 6)).toBeCloseTo(-1, 5);
    expect(mapDrumPitchSemis(64 - 39)).toBeCloseTo(-12, 5);
    expect(mapDrumPitchSemis(64 - 63)).toBeCloseTo(-24, 5);
  });
});

describe('arp scales', () => {
  it('has the 31 hardware scales with sane interval sets', () => {
    expect(ARP_SCALES).toHaveLength(31);
    for (const scale of ARP_SCALES) {
      expect(scale.length).toBeGreaterThan(0);
      expect(scale[0]).toBe(0);
      for (const iv of scale) {
        expect(iv).toBeGreaterThanOrEqual(0);
        expect(iv).toBeLessThan(12);
      }
    }
    expect(ARP_SCALES[30]).toEqual([0]); // Octave
    expect(ARP_SCALES[29]).toEqual([0, 7]); // 5th
  });
});

describe('EmxCore manual behaviors', () => {
  let core: EmxCore;
  let messages: FromEngine[];

  beforeEach(() => {
    ({ core, messages } = makeCore());
    void messages;
  });

  it('exclusive pair: when 6A and 6B trigger on the same step, only 6B sounds', () => {
    const p = createDefaultPattern();
    p.tempo = 120;
    // give both parts distinct waves; trigger both on step 0
    p.drums.D6.params.waveId = 0; // long kick
    p.drums.D7.params.waveId = 75; // short hat
    p.drums.D6.steps[0].on = true;
    p.drums.D7.steps[0].on = true;
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const out = renderSeconds(core, 0.4);
    // if only the hat (D7/6B) sounds, output should decay to silence quickly
    // (the kick would still be ringing at 0.3s)
    const tail = out.subarray(Math.floor(SR * 0.25));
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.02);
    expect(Math.max(...out.map(Math.abs))).toBeGreaterThan(0.05);
  });

  it('per-part SWING SW: parts with swing off stay on the straight grid', () => {
    const run = (swingSw: number): number[] => {
      const { core: c } = makeCore();
      const p = createDefaultPattern();
      p.tempo = 120;
      p.swing = 75;
      p.drums.D4.params.swingSw = swingSw;
      p.drums.D4.steps[0].on = true;
      p.drums.D4.steps[1].on = true;
      c.handle({ t: 'SET_PATTERN', pattern: p });
      c.handle({ t: 'TRANSPORT', action: 'play' });
      return findOnsets(renderSeconds(c, 0.9));
    };
    const sps = (SR * 60) / (120 * 4);
    const withSwing = run(1);
    const withoutSwing = run(0);
    expect(withSwing.length).toBeGreaterThanOrEqual(2);
    expect(withoutSwing.length).toBeGreaterThanOrEqual(2);
    const gapSwung = withSwing[1] - withSwing[0];
    const gapStraight = withoutSwing[1] - withoutSwing[0];
    expect(gapSwung - gapStraight).toBeGreaterThan(sps * 0.5 - BLOCK * 2);
  });

  it('legato: overlapping gate glides without retriggering the envelope', () => {
    const p = createDefaultPattern();
    p.tempo = 120;
    p.synths.S1.params.ampEg = 1; // decay envelope
    p.synths.S1.params.egTime = 80;
    p.synths.S1.params.glide = 60;
    // step 0 gate extends over step 1's note-on -> legato
    p.synths.S1.steps[0] = { on: true, note: 48, gate: 2.5 };
    p.synths.S1.steps[1] = { on: true, note: 60, gate: 0.5 };
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const out = renderSeconds(core, 0.5);
    const sps = (SR * 60) / (120 * 4);
    // a retrigger would reset the decay envelope to full level at step 1;
    // legato keeps decaying, so level right after step 1 < level right after step 0
    const rms = (from: number, len: number): number => {
      let sum = 0;
      for (let i = from; i < from + len; i++) sum += out[i] * out[i];
      return Math.sqrt(sum / len);
    };
    const early = rms(Math.floor(sps * 0.3), 800);
    const afterSecond = rms(Math.floor(sps * 1.3), 800);
    expect(afterSecond).toBeLessThan(early);
    expect(afterSecond).toBeGreaterThan(0.001); // still sounding (gate continues)
  });

  it('roll type controls retrigger count within a step', () => {
    const run = (rollType: number): number[] => {
      const { core: c } = makeCore();
      const p = createDefaultPattern();
      p.tempo = 60; // long steps -> distinct roll hits
      p.rollType = rollType;
      p.drums.D4.params.roll = 1;
      p.drums.D4.params.waveId = 75;
      p.drums.D4.steps[0].on = true;
      c.handle({ t: 'SET_PATTERN', pattern: p });
      c.handle({ t: 'TRANSPORT', action: 'play' });
      const sps = (SR * 60) / (60 * 4);
      return findOnsets(renderSeconds(c, sps / SR)); // one step only
    };
    expect(run(2).length).toBeGreaterThanOrEqual(2);
    expect(run(4).length).toBeGreaterThan(run(2).length);
  });

  it('LAST STEP shortens the measure (11-step odd meter loops early)', () => {
    const p = createDefaultPattern();
    p.tempo = 240;
    p.lastStep = 11;
    p.drums.D4.params.waveId = 75;
    p.drums.D4.steps[0].on = true;
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const sps = (SR * 60) / (240 * 4);
    const out = renderSeconds(core, (sps * 23) / SR); // just over 2 loops of 11
    const onsets = findOnsets(out);
    expect(onsets.length).toBeGreaterThanOrEqual(3);
    const gap = onsets[1] - onsets[0];
    expect(Math.abs(gap - sps * 11)).toBeLessThan(BLOCK * 3);
  });

  it('live transpose shifts synth pitch', () => {
    const freqOf = (transpose: number): number => {
      const { core: c } = makeCore();
      const p = createDefaultPattern();
      p.synths.S1.params.oscType = 0;
      p.synths.S1.params.oscEdit1 = 0;
      p.synths.S1.params.oscEdit2 = 64; // osc2 silent
      p.synths.S1.params.ampEg = 0; // gate mode so the note sustains while held
      c.handle({ t: 'SET_PATTERN', pattern: p });
      c.handle({ t: 'TRANSPOSE', semis: transpose });
      c.handle({ t: 'NOTE_ON', partId: 'S1', note: 69 }); // A4
      const out = renderSeconds(c, 0.5);
      // count zero crossings in the second half for a frequency estimate
      let crossings = 0;
      const from = Math.floor(out.length / 2);
      for (let i = from + 1; i < out.length; i++) {
        if (out[i - 1] < 0 && out[i] >= 0) crossings++;
      }
      return crossings / ((out.length - from) / SR);
    };
    const base = freqOf(0);
    const up12 = freqOf(12);
    expect(base).toBeGreaterThan(400);
    expect(base).toBeLessThan(480);
    expect(up12 / base).toBeGreaterThan(1.9);
    expect(up12 / base).toBeLessThan(2.1);
  });
});
