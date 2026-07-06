/**
 * The parameter registry — the spine of the app.
 * Every knob / automatable parameter has an entry here. Knob components,
 * SET_PARAM messages, motion-sequence targets and the LCD all reference
 * these ids. Values are stored raw (mostly 0..127); the engine maps them.
 * Names, orders and ranges follow the EMX-1 owner's manual.
 */

export interface ParamDef {
  id: string;
  label: string; // silk-screen label
  min: number;
  max: number;
  def: number;
  /** true if the value is a stepped enum / switch (knob snaps, LCD shows a name) */
  stepped?: boolean;
  /** LCD value formatter */
  fmt?: (v: number) => string;
}

/** The 16 MMT oscillator algorithms, manual order (p.34-38). */
export const OSC_TYPE_NAMES = [
  'WAVE FORM',
  'DUAL OSC',
  'CHORD OSC',
  'UNISON',
  'RING MOD',
  'OSC SYNC',
  'CROSS MOD',
  'VPM',
  'WAVE SHAPE',
  'ADDITIVE',
  'COMB OSC',
  'FORMANT',
  'NOISE',
  'PCM+COMB',
  'PCM+WS',
  'NOIZ+COMB', // hardware: AUDIO IN+COMB — no audio input in the browser, noise-excited stand-in
];

/** WAVE options per oscillator type (index = oscType). */
const BASIC4 = ['SAW', 'PULSE', 'TRI', 'SIN'];
const COMBO20 = (() => {
  // "twenty different combinations" of osc1 × osc2 (manual p.34)
  const w1 = ['SAW', 'SQU', 'TRI', 'SIN'];
  const w2 = ['SAW', 'SQU', 'TRI', 'SIN', 'NOIZ'];
  const out: string[] = [];
  for (const a of w1) for (const b of w2) out.push(`${a}·${b}`);
  return out;
})();
const UNISON12 = (() => {
  const out: string[] = [];
  for (const w of ['SAW', 'SQU', 'TRI', 'SIN']) for (let n = 3; n <= 6; n++) out.push(`${n}${w}`);
  return out;
})();
export const OSC_WAVE_OPTIONS: (string[] | 'pcm' | null)[] = [
  BASIC4, // WAVE FORM
  COMBO20, // DUAL
  BASIC4, // CHORD
  UNISON12, // UNISON
  COMBO20, // RING
  BASIC4, // SYNC (slave waveform)
  COMBO20, // CROSS MOD
  BASIC4, // VPM (carrier)
  ['TYPE1', 'TYPE2'], // WAVE SHAPE
  BASIC4, // ADDITIVE
  ['SAW', 'SQU', 'TRI', 'SIN', 'NOIZ'], // COMB
  null, // FORMANT (---)
  null, // NOISE (---)
  'pcm', // PCM+COMB (1..76)
  'pcm', // PCM+WS (1..76)
  null, // NOIZ+COMB (---)
];

/** OSC EDIT1 / EDIT2 display names per oscillator type (manual p.34-38). */
export const OSC_EDIT_NAMES: [string, string][] = [
  ['WAVEFORM', 'OSC2 PITCH'],
  ['OSC BALANCE', 'OSC2 PITCH'],
  ['CHORD NAME', 'VOICING'],
  ['DETUNE', 'OSC1 PITCH'],
  ['MOD DEPTH', 'MOD PITCH'],
  ['WAVEFORM', 'MOD PITCH'],
  ['MOD DEPTH', 'MOD PITCH'],
  ['MOD DEPTH', 'MOD HARMONY'],
  ['WAVE SHAPE', 'OSC2 PITCH'],
  ['OSC2 HARMONY', 'OSC3 HARMONY'],
  ['FEEDBACK', 'COMB PITCH'],
  ['FORMANT', 'OFFSET'],
  ['RATE', 'COLOR'],
  ['FEEDBACK', 'COMB PITCH'],
  ['WAVE SHAPE', 'CHARACTER'],
  ['FEEDBACK', 'COMB PITCH'],
];

/** Chord forms for CHORD OSC (manual p.35). */
export const CHORD_NAMES = [
  'Major', '6th', '7th', 'M7', '7(b5)', 'minor', 'm6', 'm7', 'mMaj7', 'dim', 'dim7', 'm7(b5)', 'aug', 'aug7', 'sus4', 'sus7',
];
export const CHORD_NOTES: number[][] = [
  [0, 4, 7, 12], // Major
  [0, 4, 7, 9], // 6th
  [0, 4, 7, 10], // 7th
  [0, 4, 7, 11], // M7
  [0, 4, 6, 10], // 7(b5)
  [0, 3, 7, 12], // minor
  [0, 3, 7, 9], // m6
  [0, 3, 7, 10], // m7
  [0, 3, 7, 11], // mMaj7
  [0, 3, 6, 12], // dim
  [0, 3, 6, 9], // dim7
  [0, 3, 6, 10], // m7(b5)
  [0, 4, 8, 12], // aug
  [0, 4, 8, 10], // aug7
  [0, 5, 7, 12], // sus4
  [0, 5, 7, 10], // sus7
];

export const FILTER_TYPE_NAMES = ['LPF', 'HPF', 'BPF', 'BPF+'];
/** Modulation types (manual: Saw, Squ, Tri, S&H, Env; Tri is free-running). */
export const LFO_WAVE_NAMES = ['SAW', 'SQU', 'TRI', 'S&H', 'ENV'];
/** Synth destinations; drums use only the first three (Pitch, Amp, Pan). */
export const LFO_DEST_NAMES = ['PITCH', 'AMP', 'PAN', 'OSC ED1', 'OSC ED2', 'CUTOFF'];
export const LFO_DEST_COUNT_DRUM = 3;

/** The 16 effect types, manual order (p.43-45). */
export const FX_TYPE_NAMES = [
  'REVERB',
  'BPM DELAY',
  'MOD DELAY',
  'GRAIN SFT',
  'SHORT DLY',
  'PHASER',
  'RING MOD',
  'TALK MOD',
  'CHO/FLG',
  'PITCH SFT',
  'COMPRESSR',
  'DISTORTON',
  'DECIMATOR',
  'EQ',
  'LPF',
  'HPF',
];

/** FX EDIT1/EDIT2 display names per type (manual p.43-45). */
export const FX_EDIT_NAMES: [string, string][] = [
  ['TIME', 'LEVEL'],
  ['TIME', 'DEPTH'],
  ['TIME', 'DEPTH'],
  ['SPEED', 'BALANCE'],
  ['TIME', 'DEPTH'],
  ['SPEED', 'DEPTH'],
  ['OSC FREQ', 'BALANCE'],
  ['FORMANT', 'OFFSET'],
  ['SPEED', 'DEPTH'],
  ['PITCH', 'BALANCE'],
  ['SENS', 'ATTACK'],
  ['GAIN', 'LEVEL'],
  ['FREQ', 'BIT'],
  ['LOW GAIN', 'HIGH GAIN'],
  ['CUTOFF', 'RESONANCE'],
  ['CUTOFF', 'RESONANCE'],
];

export const FX_SEND_NAMES = ['FX1', 'FX2', 'FX3'];
export const MOTION_MODE_NAMES = ['SMOOTH', 'TRIG HOLD'];
export const METRONOME_MODE_NAMES = ['OFF', 'REC', 'ON'];

/** The 31 arpeggio scales (manual p.28), intervals in semitones from the key. */
export const ARP_SCALE_NAMES = [
  'CHROMA', 'IONIAN', 'DORIAN', 'PHRYGI', 'LYDIAN', 'MIXLYD', 'AEOLIA', 'LOCRIA',
  'MBLUES', 'mBLUES', 'DIM', 'COMDIM', 'MPENTA', 'mPENTA', 'RAGA1', 'RAGA2',
  'RAGA3', 'SPANSH', 'GYPSY', 'ARABIA', 'EGYPT', 'HAWAII', 'PELOG', 'JAPAN',
  'RYUKYU', 'WHOLE', 'M3RD', 'm3RD', '4TH', '5TH', 'OCTAVE',
];
export const ARP_SCALES: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // Chromatic
  [0, 2, 4, 5, 7, 9, 11], // Ionian
  [0, 2, 3, 5, 7, 9, 10], // Dorian
  [0, 1, 3, 5, 7, 8, 10], // Phrygian
  [0, 2, 4, 6, 7, 9, 11], // Lydian
  [0, 2, 4, 5, 7, 9, 10], // Mixolydian
  [0, 2, 3, 5, 7, 8, 10], // Aeolian
  [0, 1, 3, 5, 6, 8, 10], // Locrian
  [0, 3, 4, 7, 9, 10], // Major Blues
  [0, 3, 5, 6, 7, 10], // minor Blues
  [0, 2, 3, 5, 6, 8, 9, 11], // Diminish
  [0, 1, 3, 4, 6, 7, 9, 10], // Combination Diminish
  [0, 2, 4, 7, 9], // Major Pentatonic
  [0, 3, 5, 7, 10], // minor Pentatonic
  [0, 1, 4, 5, 7, 8, 11], // Raga Bhairav
  [0, 1, 4, 6, 7, 9, 11], // Raga Gamanasrama
  [0, 1, 3, 6, 7, 8, 11], // Raga Todi
  [0, 1, 3, 4, 5, 7, 8, 10], // Spanish
  [0, 2, 3, 6, 7, 8, 11], // Gypsy
  [0, 2, 4, 5, 6, 8, 10], // Arabian
  [0, 2, 5, 7, 10], // Egyptian
  [0, 2, 3, 7, 9], // Hawaiian
  [0, 1, 3, 7, 8], // Pelog
  [0, 1, 5, 7, 8], // Japanese Miyakobushi
  [0, 4, 5, 7, 11], // Ryukyu
  [0, 2, 4, 6, 8, 10], // Wholetone
  [0, 4, 8], // M3rd
  [0, 3, 6, 9], // m3rd
  [0, 5, 10], // 4th
  [0, 7], // 5th
  [0], // Octave
];

export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Keyboard-mode pitch ranges (manual p.22): 8 octave positions. */
export const KEYBOARD_RANGES: { label: string; baseNote: number }[] = [
  { label: 'A-1…C1', baseNote: 9 }, // A-1
  { label: 'A0…C2', baseNote: 21 },
  { label: 'A1…C3', baseNote: 33 },
  { label: 'A2…C4', baseNote: 45 },
  { label: 'A3…C5', baseNote: 57 },
  { label: 'A4…C6', baseNote: 69 },
  { label: 'A5…C7', baseNote: 81 },
  { label: 'A6…C8', baseNote: 93 },
];

/** LFO BPM-sync divisions: 8/1 .. 1/64 (manual p.30). */
export const LFO_SYNC_DIVS: { label: string; beats: number }[] = [
  { label: '8/1', beats: 32 },
  { label: '4/1', beats: 16 },
  { label: '2/1', beats: 8 },
  { label: '1/1', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
  { label: '1/32', beats: 0.125 },
  { label: '1/64', beats: 0.0625 },
];

/** BPM-synced delay times (note values 1/64..1/1, manual p.43). */
export const DELAY_DIVS: { label: string; beats: number }[] = [
  { label: '1/64', beats: 0.0625 },
  { label: '1/32', beats: 0.125 },
  { label: '1/16', beats: 0.25 },
  { label: '1/8', beats: 0.5 },
  { label: '1/6', beats: 2 / 3 },
  { label: '1/4', beats: 1 },
  { label: '1/3', beats: 4 / 3 },
  { label: '1/2', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '1/1', beats: 4 },
];

const num = (v: number) => String(Math.round(v));
const onOff = (v: number) => (v >= 0.5 ? 'ON' : 'OFF');
const bipolar127 = (v: number) => {
  const c = Math.round(v) - 64;
  return c > 0 ? `+${c}` : String(c);
};
const pan127 = (v: number) => {
  const c = Math.round(v) - 64;
  if (c === 0) return 'CNT';
  return c < 0 ? `L${-c}` : `R${c}`;
};
const cents50 = (v: number) => {
  const c = Math.round(((v - 64) / 63) * 50);
  return c > 0 ? `+${c}` : String(c);
};
const pick = (names: string[]) => (v: number) => names[Math.max(0, Math.min(names.length - 1, Math.round(v)))] ?? '?';

function p(id: string, label: string, def: number, opts: Partial<ParamDef> = {}): ParamDef {
  return { id, label, min: 0, max: 127, def, fmt: num, ...opts };
}

/** Params shared by synth and drum parts. */
const COMMON_PART_PARAMS: ParamDef[] = [
  p('level', 'LEVEL', 100),
  p('pan', 'PAN', 64, { fmt: pan127 }),
  p('egTime', 'EG TIME', 64),
  p('ampEg', 'AMP EG', 0, { max: 1, stepped: true, fmt: (v) => (v >= 0.5 ? '↘ DECAY' : '■ GATE') }),
  p('roll', 'ROLL', 0, { max: 1, stepped: true, fmt: onOff }),
  p('accent', 'ACCENT SW', 1, { max: 1, stepped: true, fmt: onOff }),
  p('swingSw', 'SWING SW', 1, { max: 1, stepped: true, fmt: onOff }),
  p('lfoWave', 'MOD TYPE', 0, { max: 4, stepped: true, fmt: pick(LFO_WAVE_NAMES) }),
  p('lfoSpeed', 'MOD SPEED', 40),
  p('lfoDepth', 'MOD DEPTH', 64, { fmt: bipolar127 }),
  p('lfoDest', 'MOD DEST', 0, { max: 5, stepped: true, fmt: pick(LFO_DEST_NAMES) }),
  p('lfoBpmSync', 'BPM SYNC', 0, { max: 1, stepped: true, fmt: onOff }),
  p('fxSend', 'FX SELECT', 0, { max: 2, stepped: true, fmt: pick(FX_SEND_NAMES) }),
  p('fxOn', 'FX SEND', 0, { max: 1, stepped: true, fmt: onOff }),
];

export const SYNTH_PARAMS: ParamDef[] = [
  p('oscType', 'OSC TYPE', 0, { max: 15, stepped: true, fmt: pick(OSC_TYPE_NAMES) }),
  p('wave', 'WAVE', 0, { max: 75, stepped: true }), // fmt resolved per osc type in the UI
  p('oscEdit1', 'OSC EDIT1', 64),
  p('oscEdit2', 'OSC EDIT2', 64),
  p('glide', 'GLIDE', 0),
  p('tune', 'SYNTH TUNE', 64, { fmt: cents50 }),
  p('filterType', 'FILTER TYPE', 0, { max: 3, stepped: true, fmt: pick(FILTER_TYPE_NAMES) }),
  p('cutoff', 'CUTOFF', 127),
  p('resonance', 'RESONANCE', 0),
  p('egInt', 'EG INT', 64, { fmt: bipolar127 }),
  p('drive', 'DRIVE', 0),
  ...COMMON_PART_PARAMS,
];

export const DRUM_PARAMS: ParamDef[] = [
  p('waveId', 'WAVE', 0, { max: 206, stepped: true }), // fmt patched by drum ROM names at runtime
  p('pitch', 'PITCH', 64, { fmt: bipolar127 }),
  ...COMMON_PART_PARAMS,
  // engine-side only for drums (hidden in UI): filterType/cutoff/resonance/egInt/drive
  p('filterType', 'FILTER TYPE', 0, { max: 3, stepped: true, fmt: pick(FILTER_TYPE_NAMES) }),
  p('cutoff', 'CUTOFF', 127),
  p('resonance', 'RESONANCE', 0),
  p('egInt', 'EG INT', 64, { fmt: bipolar127 }),
  p('drive', 'DRIVE', 0),
];

export const FX_PARAMS: ParamDef[] = [
  p('type', 'FX TYPE', 0, { max: 15, stepped: true, fmt: pick(FX_TYPE_NAMES) }),
  p('edit1', 'FX EDIT1', 64),
  p('edit2', 'FX EDIT2', 64),
  p('chain', 'FX CHAIN', 0, { max: 1, stepped: true, fmt: onOff }),
];

export const MASTER_PARAMS: ParamDef[] = [
  p('masterVolume', 'MASTER', 100),
  p('valveGain', 'TUBE GAIN', 0),
  p('accentLevel', 'ACCENT LVL', 64),
  p('swing', 'SWING', 50, { min: 50, max: 75, fmt: (v) => `${Math.round(v)}%` }),
  p('masterTune', 'MASTER TUNE', 64, { fmt: cents50 }),
];

const registry = new Map<string, ParamDef>();
for (const def of [...SYNTH_PARAMS, ...DRUM_PARAMS, ...FX_PARAMS, ...MASTER_PARAMS]) {
  if (!registry.has(def.id)) registry.set(def.id, def);
}

export function paramDef(id: string): ParamDef {
  const def = registry.get(id);
  if (!def) throw new Error(`unknown param: ${id}`);
  return def;
}

export function formatParam(id: string, value: number): string {
  const def = registry.get(id);
  return def?.fmt ? def.fmt(value) : String(Math.round(value));
}

/** Display name for a synth WAVE value under a given oscillator type. */
export function formatSynthWave(oscType: number, wave: number): string {
  const opts = OSC_WAVE_OPTIONS[Math.max(0, Math.min(15, Math.round(oscType)))];
  if (opts === null) return '---';
  if (opts === 'pcm') return `PCM ${String(Math.round(wave) + 1).padStart(2, '0')}`;
  const arr = opts;
  return arr[Math.max(0, Math.min(arr.length - 1, Math.round(wave)))] ?? '?';
}

/** Number of WAVE options for an oscillator type (0 = none). */
export function synthWaveCount(oscType: number): number {
  const opts = OSC_WAVE_OPTIONS[Math.max(0, Math.min(15, Math.round(oscType)))];
  if (opts === null) return 0;
  if (opts === 'pcm') return 76;
  return opts.length;
}

// ---------------------------------------------------------------------------
// Engine-side value mappings (raw 0..127 -> physical units). Kept here so the
// UI (LCD) and the engine agree exactly.
// ---------------------------------------------------------------------------

/** Cutoff knob -> Hz, exponential 20 Hz .. 18 kHz. */
export function mapCutoff(v: number): number {
  return 20 * Math.pow(900, v / 127);
}

/** Resonance knob -> filter Q, 0.5 .. 18. */
export function mapResonance(v: number): number {
  return 0.5 + (v / 127) * (v / 127) * 17.5;
}

/** EG time knob -> seconds, 5 ms .. 6 s. */
export function mapEgTime(v: number): number {
  return 0.005 * Math.pow(1200, v / 127);
}

/** LFO speed knob -> Hz, 0.05 .. 60 Hz. */
export function mapLfoSpeed(v: number): number {
  return 0.05 * Math.pow(1200, v / 127);
}

/** Glide knob -> seconds per approach constant, 0 .. 0.4 s. */
export function mapGlide(v: number): number {
  return (v / 127) * (v / 127) * 0.4;
}

/** Bipolar 0..127 (center 64) -> -1..+1 */
export function mapBipolar(v: number): number {
  return Math.max(-1, Math.min(1, (v - 64) / 63));
}

/** Synth tune knob -> cents offset -50..+50. */
export function mapTuneCents(v: number): number {
  return mapBipolar(v) * 50;
}

/**
 * Drum PITCH -> semitone offset via the hardware's nonlinear table (manual p.29):
 * ±6 = 1 semitone, then every 3 units = 1 semitone up to ±39 = 1 octave,
 * then every 2 units = 1 semitone up to ±63 = 2 octaves.
 */
export function mapDrumPitchSemis(v: number): number {
  const c = Math.max(-63, Math.min(63, Math.round(v) - 64));
  const a = Math.abs(c);
  let semis: number;
  if (a <= 6) semis = a / 6;
  else if (a <= 39) semis = 1 + (a - 6) / 3;
  else semis = 12 + (a - 39) / 2;
  return Math.sign(c) * semis;
}

/** Level knob -> linear gain with a gentle audio-taper curve. */
export function mapLevel(v: number): number {
  const t = v / 127;
  return t * t;
}

/** Harmonic edit value (0..127) -> 0.25..32.00 multiple (VPM/additive harmonics). */
export function mapHarmonic(v: number): number {
  return 0.25 * Math.pow(128, v / 127);
}
