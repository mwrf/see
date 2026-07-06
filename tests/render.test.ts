/**
 * Offline whole-engine tests: run EmxCore block by block and assert the
 * sequencer triggers voices at the right sample positions.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EmxCore } from '../src/engine/worklet/core';
import { renderDrumWave } from '../src/engine/worklet/drum-rom';
import type { FromEngine } from '../src/shared/messages';
import { createDefaultPattern } from '../src/shared/model';

const SR = 44100;
const BLOCK = 128;

function makeCore(): { core: EmxCore; messages: FromEngine[] } {
  const messages: FromEngine[] = [];
  const core = new EmxCore(SR, (msg) => messages.push(msg));
  // minimal ROM: only the waves the default kit needs for these tests
  const waves: Float32Array[] = [];
  for (const id of [0, 30, 75]) waves[id] = renderDrumWave(id, SR).data;
  core.handle({ t: 'LOAD_ROM', waves });
  return { core, messages };
}

function renderSeconds(core: EmxCore, seconds: number): { l: Float32Array; r: Float32Array } {
  const total = Math.ceil((seconds * SR) / BLOCK) * BLOCK;
  const l = new Float32Array(total);
  const r = new Float32Array(total);
  const bl = new Float32Array(BLOCK);
  const br = new Float32Array(BLOCK);
  for (let pos = 0; pos < total; pos += BLOCK) {
    bl.fill(0);
    br.fill(0);
    core.render(bl, br);
    l.set(bl, pos);
    r.set(br, pos);
  }
  return { l, r };
}

/** Find onset positions: samples where local energy jumps from silence. */
function findOnsets(buf: Float32Array, threshold = 0.05): number[] {
  const onsets: number[] = [];
  let quiet = true;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (quiet && a > threshold) {
      onsets.push(i);
      quiet = false;
    } else if (!quiet && a < threshold * 0.1) {
      // require a run of silence before re-arming
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

describe('EmxCore end-to-end', () => {
  let core: EmxCore;
  let messages: FromEngine[];

  beforeEach(() => {
    ({ core, messages } = makeCore());
  });

  it('four-on-the-floor kick lands on exact step times at 120 BPM', () => {
    const p = createDefaultPattern();
    p.tempo = 120;
    for (const s of [0, 4, 8, 12]) p.drums.D1.steps[s].on = true;
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const { l } = renderSeconds(core, 2.1);

    const sps = (SR * 60) / (120 * 4); // 5512.5 samples per 16th
    const onsets = findOnsets(l);
    expect(onsets.length).toBeGreaterThanOrEqual(4);
    // beats are every 4 steps = 0.5s
    const expected = [0, 4, 8, 12, 16, 20, 24, 28].map((s) => s * sps);
    for (let i = 0; i < 4; i++) {
      const nearest = expected.reduce((best, e) => (Math.abs(e - onsets[i]) < Math.abs(best - onsets[i]) ? e : best), Infinity);
      expect(Math.abs(onsets[i] - nearest), `onset ${i} at ${onsets[i]}`).toBeLessThan(BLOCK + 64);
    }
  });

  it('produces silence when stopped and sound when playing', () => {
    const p = createDefaultPattern();
    p.drums.D1.steps[0].on = true;
    core.handle({ t: 'SET_PATTERN', pattern: p });
    const { l: silent } = renderSeconds(core, 0.2);
    expect(Math.max(...silent.map(Math.abs))).toBe(0);
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const { l: loud } = renderSeconds(core, 0.2);
    expect(Math.max(...loud.map(Math.abs))).toBeGreaterThan(0.05);
  });

  it('swing delays off-beat steps by the configured amount', () => {
    const run = (swing: number): number[] => {
      const { core: c } = makeCore();
      const p = createDefaultPattern();
      p.tempo = 120;
      p.swing = swing;
      // use the closed hat (short decay) so consecutive steps don't overlap
      p.drums.D4.steps[0].on = true;
      p.drums.D4.steps[1].on = true;
      c.handle({ t: 'SET_PATTERN', pattern: p });
      c.handle({ t: 'TRANSPORT', action: 'play' });
      const { l } = renderSeconds(c, 0.9);
      return findOnsets(l);
    };
    const sps = (SR * 60) / (120 * 4);
    const straight = run(50);
    const swung = run(75);
    expect(straight.length).toBeGreaterThanOrEqual(2);
    expect(swung.length).toBeGreaterThanOrEqual(2);
    const gapStraight = straight[1] - straight[0];
    const gapSwung = swung[1] - swung[0];
    expect(gapStraight).toBeGreaterThan(sps - BLOCK * 2);
    expect(gapStraight).toBeLessThan(sps + BLOCK * 2);
    expect(gapSwung - gapStraight).toBeGreaterThan(sps * 0.5 - BLOCK * 2);
  });

  it('posts POSITION messages while playing', () => {
    const p = createDefaultPattern();
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    renderSeconds(core, 1.1);
    const positions = messages.filter((m) => m.t === 'POSITION');
    expect(positions.length).toBeGreaterThanOrEqual(8);
  });

  it('synth part plays a note and respects mute', () => {
    const p = createDefaultPattern();
    p.synths.S1.steps[0] = { on: true, note: 48, gate: 2 };
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const { l } = renderSeconds(core, 0.4);
    expect(Math.max(...l.map(Math.abs))).toBeGreaterThan(0.02);

    core.handle({ t: 'TRANSPORT', action: 'stop' });
    core.handle({ t: 'MUTE', partId: 'S1', on: true });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const { l: muted } = renderSeconds(core, 0.4);
    expect(Math.max(...muted.map(Math.abs))).toBeLessThan(0.001);
  });

  it('live NOTE_ON triggers immediately without the sequencer', () => {
    core.handle({ t: 'NOTE_ON', partId: 'S1', note: 60 });
    const { l } = renderSeconds(core, 0.1);
    expect(Math.max(...l.map(Math.abs))).toBeGreaterThan(0.01);
  });

  it('realtime record quantizes a hit to the nearest step and echoes it', () => {
    const p = createDefaultPattern();
    p.tempo = 120;
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    core.handle({ t: 'TRANSPORT', action: 'recOn' });
    // render half a step, then hit a drum
    const sps = (SR * 60) / (120 * 4);
    renderSeconds(core, (sps * 0.4) / SR);
    core.handle({ t: 'TRIG', partId: 'D2' });
    renderSeconds(core, 0.05);
    const rec = messages.filter((m) => m.t === 'RECORDED');
    expect(rec.length).toBe(1);
    expect(rec[0].t === 'RECORDED' && rec[0].partId).toBe('D2');
    expect(rec[0].t === 'RECORDED' && rec[0].step).toBe(0); // 0.4 steps rounds to 0
  });

  it('pattern switch is quantized to pattern end', () => {
    const p1 = createDefaultPattern('ONE');
    p1.tempo = 240;
    const p2 = createDefaultPattern('TWO');
    p2.tempo = 240;
    core.handle({ t: 'SET_PATTERN', pattern: p1 });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    renderSeconds(core, 0.1);
    core.handle({ t: 'SET_NEXT_PATTERN', pattern: p2, slot: 42 });
    // a 16-step pattern at 240bpm = 1 second long
    renderSeconds(core, 0.5);
    expect(messages.filter((m) => m.t === 'PATTERN_SWITCHED')).toHaveLength(0);
    renderSeconds(core, 0.6);
    const switched = messages.filter((m) => m.t === 'PATTERN_SWITCHED');
    expect(switched).toHaveLength(1);
    expect(switched[0].t === 'PATTERN_SWITCHED' && switched[0].slot).toBe(42);
  });

  it('motion sequence modulates a param during playback', () => {
    const p = createDefaultPattern();
    p.tempo = 240;
    p.synths.S1.steps.forEach((s, i) => {
      if (i < 16) {
        s.on = true;
        s.note = 36;
        s.gate = 0.9;
      }
    });
    p.synths.S1.params.cutoff = 127;
    p.motions.push({
      target: 'S1',
      paramId: 'cutoff',
      values: Array.from({ length: 256 }, (_, i) => (i % 16 < 8 ? 127 : 6)),
      mask: Array.from({ length: 256 }, (_, i) => i < 16),
    });
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const { l } = renderSeconds(core, 1.0);
    // first half (open filter) must be brighter than second half (closed)
    const half = Math.floor(l.length / 2);
    const hfEnergy = (buf: Float32Array): number => {
      let e = 0;
      for (let i = 1; i < buf.length; i++) e += Math.abs(buf[i] - buf[i - 1]);
      return e / buf.length;
    };
    const bright = hfEnergy(l.subarray(0, half));
    const dark = hfEnergy(l.subarray(half));
    expect(bright).toBeGreaterThan(dark * 1.5);
  });

  it('song mode advances through events and ends', () => {
    const pA = createDefaultPattern('A');
    pA.tempo = 300;
    pA.drums.D1.steps[0].on = true;
    const pB = createDefaultPattern('B');
    pB.tempo = 300;
    core.handle({ t: 'SET_PATTERN', pattern: pA });
    core.handle({
      t: 'SET_SONG',
      song: { name: 'S', tempo: 0, events: [{ patternSlot: 0, mutes: [] }, { patternSlot: 1, mutes: [] }] },
      patterns: { 0: pA, 1: pB },
    });
    core.handle({ t: 'MODE', mode: 'song' });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    // each pattern at 300bpm/16 steps = 0.8s; render 2s to cross both
    renderSeconds(core, 2.0);
    expect(messages.some((m) => m.t === 'PATTERN_SWITCHED' && m.slot === 1)).toBe(true);
    expect(messages.some((m) => m.t === 'SONG_ENDED')).toBe(true);
  });

  it('never emits NaN even with extreme settings', () => {
    const p = createDefaultPattern();
    p.tempo = 300;
    p.swing = 75;
    for (let i = 0; i < 16; i++) {
      p.drums.D1.steps[i].on = true;
      p.synths.S1.steps[i] = { on: true, note: 100, gate: 1.2 };
    }
    p.synths.S1.params.oscType = 6;
    p.synths.S1.params.resonance = 127;
    p.synths.S1.params.cutoff = 127;
    p.synths.S1.params.lfoDepth = 127;
    p.synths.S1.params.fxOn = 1;
    p.fx[0] = { type: 11, edit1: 127, edit2: 127, chain: true };
    p.fx[1] = { type: 2, edit1: 127, edit2: 127, chain: true };
    p.fx[2] = { type: 0, edit1: 127, edit2: 127, chain: false };
    core.handle({ t: 'SET_PATTERN', pattern: p });
    core.handle({ t: 'SET_PARAM', target: 'MASTER', paramId: 'valveGain', value: 127 });
    core.handle({ t: 'TRANSPORT', action: 'play' });
    const { l, r } = renderSeconds(core, 1.5);
    for (let i = 0; i < l.length; i++) {
      expect(Number.isFinite(l[i]) && Number.isFinite(r[i])).toBe(true);
    }
  });
});
