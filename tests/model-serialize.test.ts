import { describe, expect, it } from 'vitest';
import {
  createDefaultPattern,
  createEmptyFile,
  migrateFile,
  migratePattern,
  stepsForPattern,
} from '../src/shared/model';

describe('pattern serialization', () => {
  it('round-trips a pattern through JSON', () => {
    const p = createDefaultPattern('TEST');
    p.tempo = 133.5;
    p.swing = 66;
    p.beat = '16T';
    p.lengthBars = 4;
    p.drums.D1.steps[0].on = true;
    p.drums.D3.steps[7].on = true;
    p.synths.S1.steps[3] = { on: true, note: 52, gate: 1.5 };
    p.synths.S2.params.oscType = 6;
    p.motions.push({
      target: 'S1',
      paramId: 'cutoff',
      values: Array.from({ length: 256 }, (_, i) => i % 128),
      mask: Array.from({ length: 256 }, (_, i) => i % 2 === 0),
    });
    const restored = migratePattern(JSON.parse(JSON.stringify(p)));
    expect(restored.tempo).toBe(133.5);
    expect(restored.swing).toBe(66);
    expect(restored.beat).toBe('16T');
    expect(restored.lengthBars).toBe(4);
    expect(restored.drums.D1.steps[0].on).toBe(true);
    expect(restored.drums.D3.steps[7].on).toBe(true);
    expect(restored.synths.S1.steps[3]).toEqual({ on: true, note: 52, gate: 1.5 });
    expect(restored.synths.S2.params.oscType).toBe(6);
    expect(restored.motions).toHaveLength(1);
    expect(restored.motions[0].values[5]).toBe(5);
    expect(restored.motions[0].mask[1]).toBe(false);
  });

  it('fills missing params with defaults (forward migration)', () => {
    const p = createDefaultPattern();
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    delete (raw.synths as Record<string, { params: Record<string, number> }>).S1.params.lfoDepth;
    const restored = migratePattern(raw);
    expect(restored.synths.S1.params.lfoDepth).toBe(64); // bipolar center default
  });

  it('clamps out-of-range values', () => {
    const p = createDefaultPattern();
    const raw = JSON.parse(JSON.stringify(p)) as { tempo: number; swing: number; lengthBars: number };
    raw.tempo = 9999;
    raw.swing = 10;
    raw.lengthBars = 40;
    const restored = migratePattern(raw);
    expect(restored.tempo).toBe(300);
    expect(restored.swing).toBe(50);
    expect(restored.lengthBars).toBe(8);
  });

  it('rejects garbage', () => {
    expect(() => migratePattern(null)).toThrow();
    expect(() => migratePattern({ version: 99 })).toThrow();
  });

  it('round-trips a full device file', () => {
    const f = createEmptyFile();
    f.patterns[3] = createDefaultPattern('SLOT3');
    f.patterns[255] = createDefaultPattern('LAST');
    f.songs[0] = {
      name: 'SONG',
      tempo: 140,
      nextSong: 4,
      events: [{ patternSlot: 3, noteOffset: -12, mutes: ['D1', 'S2'] }],
    };
    f.global.valveGain = 90;
    const restored = migrateFile(JSON.parse(JSON.stringify(f)));
    expect(restored.patterns[3]?.name).toBe('SLOT3');
    expect(restored.patterns[255]?.name).toBe('LAST');
    expect(restored.patterns[0]).toBeNull();
    expect(restored.songs[0]?.nextSong).toBe(4);
    expect(restored.songs[0]?.events[0]).toEqual({ patternSlot: 3, noteOffset: -12, mutes: ['D1', 'S2'] });
    expect(restored.global.valveGain).toBe(90);
    expect(() => migrateFile({ magic: 'NOPE' })).toThrow();
  });

  it('computes step counts from beat, length and last step (hardware grids)', () => {
    const p = createDefaultPattern();
    // beat 32 still uses 16 steps per measure (each step = a 32nd note)
    p.beat = '32';
    p.lengthBars = 8;
    p.lastStep = 16;
    expect(stepsForPattern(p)).toBe(128);
    // triplet grids use 12 steps per measure
    p.beat = '8T';
    p.lengthBars = 2;
    p.lastStep = 12;
    expect(stepsForPattern(p)).toBe(24);
    // LAST STEP shortens the measure (e.g. 11-step odd meter)
    p.beat = '16';
    p.lengthBars = 2;
    p.lastStep = 11;
    expect(stepsForPattern(p)).toBe(22);
    // lastStep is capped by the beat grid
    p.beat = '8T';
    p.lastStep = 16;
    expect(stepsForPattern(p)).toBe(24);
  });
});
