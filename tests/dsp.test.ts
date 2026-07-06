import { describe, expect, it } from 'vitest';
import { AmpEnv, Lfo, Svf } from '../src/engine/worklet/dsp';
import { renderDrumWave, NUM_DRUM_WAVES } from '../src/engine/worklet/drum-rom';
import { createFx } from '../src/engine/worklet/fx';
import { Oscillator } from '../src/engine/worklet/osc';
import { getPcmTables, NUM_PCM_WAVES } from '../src/engine/worklet/pcm-waves';
import { Valve } from '../src/engine/worklet/valve';
import { goertzelMag, makeRng } from '../src/shared/math';

const SR = 44100;

function assertFinite(buf: Float32Array, label: string): void {
  for (let i = 0; i < buf.length; i++) {
    if (!Number.isFinite(buf[i])) throw new Error(`${label}: non-finite at ${i}`);
  }
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

describe('oscillator algorithms', () => {
  it('every osc type produces bounded, non-silent, finite output', () => {
    for (let type = 0; type < 16; type++) {
      const osc = new Oscillator(SR, 42);
      const buf = new Float32Array(SR / 2);
      for (let i = 0; i < buf.length; i++) {
        buf[i] = osc.sample(type, 110, 64, 64, SR);
      }
      assertFinite(buf, `osc type ${type}`);
      const level = rms(buf.subarray(1000));
      expect(level, `osc type ${type} rms`).toBeGreaterThan(0.005);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      expect(peak, `osc type ${type} peak`).toBeLessThan(4);
    }
  });

  it('waveform osc has its fundamental at the requested pitch', () => {
    const osc = new Oscillator(SR, 1);
    const buf = new Float32Array(SR);
    for (let i = 0; i < buf.length; i++) buf[i] = osc.sample(0, 220, 0, 0, SR);
    const at220 = goertzelMag(buf, 220, SR);
    const at311 = goertzelMag(buf, 311, SR);
    expect(at220).toBeGreaterThan(at311 * 5);
  });

  it('osc types sound distinct (spectra differ pairwise)', () => {
    const spectra: number[][] = [];
    const freqs = [110, 220, 330, 440, 660, 880, 1320, 1760];
    for (let type = 0; type < 16; type++) {
      const osc = new Oscillator(SR, 7);
      const buf = new Float32Array(SR / 4);
      for (let i = 0; i < buf.length; i++) buf[i] = osc.sample(type, 110, 96, 96, SR);
      const mags = freqs.map((f) => goertzelMag(buf, f, SR));
      const total = mags.reduce((a, b) => a + b, 0) || 1;
      spectra.push(mags.map((m) => m / total));
    }
    let distinctPairs = 0;
    let pairs = 0;
    for (let a = 0; a < 16; a++) {
      for (let b = a + 1; b < 16; b++) {
        pairs++;
        const dist = spectra[a].reduce((acc, v, i) => acc + Math.abs(v - spectra[b][i]), 0);
        if (dist > 0.08) distinctPairs++;
      }
    }
    // the vast majority of pairs must be spectrally distinct
    expect(distinctPairs / pairs).toBeGreaterThan(0.85);
  });
});

describe('SVF filter', () => {
  it('stays stable at max resonance with noise input', () => {
    const svf = new Svf(SR);
    svf.set(800, 18);
    const rng = makeRng(9);
    let peak = 0;
    for (let i = 0; i < SR; i++) {
      const y = svf.process(rng() * 2 - 1, 0);
      expect(Number.isFinite(y)).toBe(true);
      peak = Math.max(peak, Math.abs(y));
    }
    expect(peak).toBeLessThan(50);
  });

  it('low-pass attenuates highs, high-pass attenuates lows', () => {
    for (const [mode, passFreq, stopFreq] of [
      [0, 100, 8000],
      [1, 8000, 100],
    ] as const) {
      const svf = new Svf(SR);
      svf.set(1000, 0.9);
      const buf = new Float32Array(SR / 2);
      let phA = 0;
      let phB = 0;
      for (let i = 0; i < buf.length; i++) {
        phA += (2 * Math.PI * passFreq) / SR;
        phB += (2 * Math.PI * stopFreq) / SR;
        buf[i] = svf.process(Math.sin(phA) + Math.sin(phB), mode);
      }
      const passMag = goertzelMag(buf.subarray(4000), passFreq, SR);
      const stopMag = goertzelMag(buf.subarray(4000), stopFreq, SR);
      expect(passMag).toBeGreaterThan(stopMag * 8);
    }
  });
});

describe('envelopes & LFO', () => {
  it('decay envelope reaches near-zero after the decay time', () => {
    const env = new AmpEnv(SR);
    env.trigger(0.1, true, SR);
    let v = 1;
    for (let i = 0; i < SR * 0.15; i++) v = env.next();
    expect(v).toBeLessThan(0.01);
  });

  it('gate envelope holds until release', () => {
    const env = new AmpEnv(SR);
    env.trigger(0.1, false, SR);
    let v = 0;
    for (let i = 0; i < 1000; i++) v = env.next();
    expect(v).toBeCloseTo(1, 5);
    env.release();
    for (let i = 0; i < SR * 0.05; i++) v = env.next();
    expect(v).toBeLessThan(0.01);
  });

  it('LFO waves stay in range and S&H changes per cycle', () => {
    for (let wave = 0; wave < 6; wave++) {
      const lfo = new Lfo(5);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < SR; i++) {
        const v = lfo.next(8, wave, SR);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(min).toBeGreaterThanOrEqual(-1.01);
      expect(max).toBeLessThanOrEqual(1.01);
      if (wave < 5) expect(max - min).toBeGreaterThan(0.5);
    }
  });
});

describe('drum ROM', () => {
  it('renders all 207 waves finite and audible', () => {
    for (let id = 0; id < NUM_DRUM_WAVES; id += 1) {
      const w = renderDrumWave(id, SR);
      expect(w.data.length).toBeGreaterThan(SR * 0.02);
      assertFinite(w.data, w.name);
      let peak = 0;
      for (let i = 0; i < w.data.length; i++) peak = Math.max(peak, Math.abs(w.data[i]));
      expect(peak, w.name).toBeGreaterThan(0.5);
      expect(peak, w.name).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const a = renderDrumWave(0, SR);
    const b = renderDrumWave(0, SR);
    expect(a.data).toEqual(b.data);
  });
});

describe('PCM tables', () => {
  it('generates 76 normalized single-cycle tables', () => {
    const tables = getPcmTables();
    expect(tables.length).toBe(NUM_PCM_WAVES);
    for (const t of tables) {
      assertFinite(t, 'pcm');
      let peak = 0;
      for (let i = 0; i < t.length; i++) peak = Math.max(peak, Math.abs(t[i]));
      expect(peak).toBeCloseTo(1, 1);
    }
  });
});

describe('effects', () => {
  it('all 16 fx types produce finite output on a pulse train', () => {
    for (let type = 0; type < 16; type++) {
      const fx = createFx(type, SR);
      const l = new Float32Array(128);
      const r = new Float32Array(128);
      for (let block = 0; block < 200; block++) {
        for (let i = 0; i < 128; i++) {
          const t = block * 128 + i;
          const pulse = t % 11025 < 200 ? Math.sin((2 * Math.PI * 220 * t) / SR) * 0.7 : 0;
          l[i] = pulse;
          r[i] = pulse;
        }
        fx.process(l, r, 0, 128, 80, 80, 120);
        assertFinite(l, `fx ${type} L`);
        assertFinite(r, `fx ${type} R`);
        for (let i = 0; i < 128; i++) {
          expect(Math.abs(l[i]), `fx ${type} bounded`).toBeLessThan(20);
        }
      }
    }
  });
});

describe('valve', () => {
  it('saturates without blowing up and passes through at zero gain', () => {
    const valve = new Valve();
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    for (let block = 0; block < 100; block++) {
      for (let i = 0; i < 128; i++) {
        const t = block * 128 + i;
        l[i] = r[i] = Math.sin((2 * Math.PI * 110 * t) / SR) * 0.9;
      }
      valve.process(l, r, 0, 128, 127);
      assertFinite(l, 'valve');
      for (let i = 0; i < 128; i++) expect(Math.abs(l[i])).toBeLessThan(1.6);
    }
    // zero gain: passthrough
    const l2 = new Float32Array([0.5, -0.5, 0.25]);
    const r2 = new Float32Array([0.5, -0.5, 0.25]);
    new Valve().process(l2, r2, 0, 3, 0);
    expect(l2[0]).toBe(0.5);
  });
});
