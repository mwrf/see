/**
 * Procedurally generated single-cycle PCM wavetables for the PCM oscillator
 * (stands in for the EMX's 76 synth PCM waves) plus chord tables.
 * Generated once on first use; deterministic.
 */

import { makeRng, TWO_PI } from '../../shared/math';

export const PCM_TABLE_SIZE = 2048;
export const NUM_PCM_WAVES = 76;

let tables: Float32Array[] | null = null;

function normalized(buf: Float32Array): Float32Array {
  let max = 1e-9;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const g = 1 / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** Build one cycle from a harmonic recipe: amps[h-1] = amplitude of harmonic h. */
function additive(amps: number[], phases?: number[]): Float32Array {
  const out = new Float32Array(PCM_TABLE_SIZE);
  for (let h = 0; h < amps.length; h++) {
    const a = amps[h];
    if (a === 0) continue;
    const ph = phases ? phases[h] : 0;
    for (let i = 0; i < PCM_TABLE_SIZE; i++) {
      out[i] += a * Math.sin(TWO_PI * ((h + 1) * i) / PCM_TABLE_SIZE + ph);
    }
  }
  return normalized(out);
}

function harmonicSeries(n: number, fn: (h: number) => number): number[] {
  return Array.from({ length: n }, (_, i) => fn(i + 1));
}

export function getPcmTables(): Float32Array[] {
  if (tables) return tables;
  const t: Float32Array[] = [];

  // 0-7: classic analog shapes (bandlimited to 64 harmonics)
  t.push(additive(harmonicSeries(64, (h) => 1 / h))); // saw
  t.push(additive(harmonicSeries(64, (h) => (h % 2 ? 1 / h : 0)))); // square
  t.push(additive(harmonicSeries(64, (h) => (h % 2 ? ((h - 1) / 2) % 2 === 0 ? 1 / (h * h) : -1 / (h * h) : 0)))); // triangle
  t.push(additive([1])); // sine
  for (const pw of [0.1, 0.2, 0.3, 0.4]) {
    // pulse waves at various widths
    t.push(additive(harmonicSeries(64, (h) => (2 / (h * Math.PI)) * Math.sin(Math.PI * h * pw))));
  }

  // 8-15: organ / drawbar combos
  t.push(additive([1, 0, 0.7])); // organ 1+3
  t.push(additive([1, 0.8, 0, 0.5])); // organ 1+2+4
  t.push(additive([1, 0, 0, 0.9, 0, 0, 0, 0.6])); // organ 1+4+8
  t.push(additive([1, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15])); // full drawbars
  t.push(additive([0.6, 1, 0, 0.4])); // 2nd-heavy
  t.push(additive([1, 0, 0.5, 0, 0.33, 0, 0.25])); // odd stack
  t.push(additive([1, 0.5, 0, 0, 0, 0.8])); // wide organ
  t.push(additive([1, 0, 0, 0, 0.7, 0, 0, 0, 0.4])); // fifths organ

  // 16-27: "digital" waves — bright harmonic recipes
  t.push(additive(harmonicSeries(32, (h) => (h === 1 || h === 2 || h === 5 || h === 9 ? 1 / Math.sqrt(h) : 0))));
  t.push(additive(harmonicSeries(48, (h) => 1 / Math.pow(h, 0.5)))); // bright saw-ish
  t.push(additive(harmonicSeries(48, (h) => (h % 3 === 1 ? 1 / h : 0)))); // every 3rd
  t.push(additive(harmonicSeries(48, (h) => (h % 4 === 1 ? 1 / Math.sqrt(h) : 0))));
  t.push(additive(harmonicSeries(24, (h) => (h <= 6 ? 0 : 1 / (h - 5))))); // hollow highs
  t.push(additive(harmonicSeries(40, (h) => Math.sin(h * 0.9) / h))); // comb-ish
  t.push(additive(harmonicSeries(40, (h) => Math.cos(h * 0.5) / Math.sqrt(h))));
  t.push(additive(harmonicSeries(56, (h) => (h % 2 ? Math.sin(h * 1.7) / h : Math.cos(h * 0.7) / (h + 2)))));
  t.push(additive(harmonicSeries(16, (h) => 1 / (1 + Math.abs(h - 8))))); // formant bump @8
  t.push(additive(harmonicSeries(24, (h) => 1 / (1 + Math.abs(h - 12))))); // formant bump @12
  t.push(additive(harmonicSeries(32, (h) => 1 / (1 + Math.abs(h - 5)) + 0.5 / (1 + Math.abs(h - 15)))));
  t.push(additive(harmonicSeries(64, (h) => (h === 1 ? 0.4 : h >= 30 ? 1 / (h - 25) : 0)))); // sizzle

  // 28-39: bell / metallic (harmonic approximations of bell partials)
  const bellRecipes = [
    [1, 0, 0.6, 0, 0.4, 0, 0, 0.5, 0, 0, 0, 0.3],
    [0.8, 0, 0, 1, 0, 0, 0.5, 0, 0, 0.35],
    [1, 0.3, 0, 0, 0.7, 0, 0, 0, 0, 0.45, 0, 0, 0.2],
    [0.9, 0, 0.2, 0, 0, 0.8, 0, 0, 0, 0, 0.4],
    [1, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0.35, 0, 0.2],
    [0.7, 1, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.3],
  ];
  for (const r of bellRecipes) t.push(additive(r));
  const rng1 = makeRng(777);
  for (let k = 0; k < 6; k++) {
    t.push(additive(harmonicSeries(20, (h) => (rng1() < 0.3 ? rng1() / Math.sqrt(h) : 0))));
  }

  // 40-51: vocal / formant cycles (two formant bumps over a saw spectrum)
  const vowels: [number, number][] = [
    [3, 12], [4, 9], [2, 14], [5, 16], [3, 8], [6, 11], [2, 6], [4, 18], [7, 13], [3, 15], [5, 8], [2, 10],
  ];
  for (const [f1, f2] of vowels) {
    t.push(
      additive(
        harmonicSeries(48, (h) => (1 / h) * (1.2 / (1 + Math.pow((h - f1) / 2, 2)) + 0.8 / (1 + Math.pow((h - f2) / 3, 2)))),
      ),
    );
  }

  // 52-63: FM-ish / gritty single cycles (waveshaped sines, deterministic)
  for (let k = 0; k < 12; k++) {
    const idx = k + 1;
    const out = new Float32Array(PCM_TABLE_SIZE);
    for (let i = 0; i < PCM_TABLE_SIZE; i++) {
      const ph = (TWO_PI * i) / PCM_TABLE_SIZE;
      out[i] = Math.sin(ph + (1 + idx * 0.6) * Math.sin(ph * (1 + (idx % 5))));
    }
    t.push(normalized(out));
  }

  // 64-75: random-harmonic "wavetable scan" style waves (seeded, reproducible)
  const rng2 = makeRng(424242);
  for (let k = 0; k < 12; k++) {
    t.push(additive(harmonicSeries(40, (h) => (rng2() < 0.45 ? (rng2() * 2 - 1) / Math.pow(h, 0.7) : 0))));
  }

  tables = t.slice(0, NUM_PCM_WAVES);
  return tables;
}

/** Chord oscillator interval sets (semitones from root). */
export const CHORD_TYPES: { name: string; notes: number[] }[] = [
  { name: 'OCT', notes: [0, 12] },
  { name: '5TH', notes: [0, 7, 12] },
  { name: 'SUS4', notes: [0, 5, 7] },
  { name: 'MAJ', notes: [0, 4, 7] },
  { name: 'MAJ7', notes: [0, 4, 7, 11] },
  { name: 'MAJ9', notes: [0, 4, 7, 14] },
  { name: 'MIN', notes: [0, 3, 7] },
  { name: 'MIN7', notes: [0, 3, 7, 10] },
  { name: 'MIN9', notes: [0, 3, 7, 14] },
  { name: 'DOM7', notes: [0, 4, 7, 10] },
  { name: 'DIM', notes: [0, 3, 6, 9] },
  { name: 'AUG', notes: [0, 4, 8] },
];
