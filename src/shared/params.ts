/**
 * The parameter registry — the spine of the app.
 * Every knob / automatable parameter has an entry here. Knob components,
 * SET_PARAM messages, motion-sequence targets and the LCD all reference
 * these ids. Values are stored raw (mostly 0..127); the engine maps them.
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

export const OSC_TYPE_NAMES = [
  'WAVEFORM',
  'DUAL OSC',
  'UNISON',
  'SYNC',
  'RING',
  'X-MOD',
  'VPM',
  'NOISE',
  'PCM',
  'CHORD',
  'COMB',
  'FORMANT',
  'PWM',
  'SUPER-7',
  'ADDITIVE',
  'MOD-NOIZ',
];

export const FILTER_TYPE_NAMES = ['LPF', 'HPF', 'BPF', 'BPF+'];
export const LFO_WAVE_NAMES = ['SAW', 'SQU', 'TRI', 'SIN', 'S&H', 'ENV'];
export const LFO_DEST_NAMES = ['PITCH', 'OSC EDIT', 'CUTOFF', 'AMP', 'PAN'];
export const FX_TYPE_NAMES = [
  'REVERB',
  'SHORT DLY',
  'BPM DLY',
  'MOD DLY',
  'GRAIN SFT',
  'CHO/FLG',
  'PHASER',
  'RING MOD',
  'TALK MOD',
  'PITCH SFT',
  'COMPRESSR',
  'DISTORTON',
  'DECIMATOR',
  'EQ',
  'LPF',
  'HPF',
];
export const FX_SEND_NAMES = ['FX1', 'FX2', 'FX3'];
export const MOTION_MODE_NAMES = ['SMOOTH', 'TRIG HOLD'];

export const SCALE_NAMES = [
  'CHROMATIC',
  'MAJOR',
  'MINOR',
  'HARM MIN',
  'DORIAN',
  'MIXOLYDN',
  'PENTA MAJ',
  'PENTA MIN',
  'BLUES',
  'RYUKYU',
];
/** Interval sets (semitones within octave) for each scale above. */
export const SCALES: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [0, 2, 4, 5, 7, 9, 11],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 8, 11],
  [0, 2, 3, 5, 7, 9, 10],
  [0, 2, 4, 5, 7, 9, 10],
  [0, 2, 4, 7, 9],
  [0, 3, 5, 7, 10],
  [0, 3, 5, 6, 7, 10],
  [0, 4, 5, 7, 11],
];

export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** LFO BPM-sync divisions: label + beats per cycle. */
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
const semis24 = (v: number) => {
  const s = Math.round(((v - 64) / 63) * 24);
  return s > 0 ? `+${s}` : String(s);
};
const pick = (names: string[]) => (v: number) => names[Math.max(0, Math.min(names.length - 1, Math.round(v)))] ?? '?';

function p(id: string, label: string, def: number, opts: Partial<ParamDef> = {}): ParamDef {
  return { id, label, min: 0, max: 127, def, fmt: num, ...opts };
}

/** Params shared by synth and drum parts. */
const COMMON_PART_PARAMS: ParamDef[] = [
  p('filterType', 'FILTER TYPE', 0, { max: 3, stepped: true, fmt: pick(FILTER_TYPE_NAMES) }),
  p('cutoff', 'CUTOFF', 127),
  p('resonance', 'RESONANCE', 0),
  p('egInt', 'EG INT', 64, { fmt: bipolar127 }),
  p('level', 'LEVEL', 100),
  p('pan', 'PAN', 64, { fmt: pan127 }),
  p('egTime', 'EG TIME', 64),
  p('ampEg', 'AMP EG', 0, { max: 1, stepped: true, fmt: (v) => (v >= 0.5 ? '↘ DECAY' : '■ GATE') }),
  p('roll', 'ROLL', 0, { max: 1, stepped: true, fmt: onOff }),
  p('accent', 'ACCENT', 1, { max: 1, stepped: true, fmt: onOff }),
  p('lfoWave', 'LFO WAVE', 0, { max: 5, stepped: true, fmt: pick(LFO_WAVE_NAMES) }),
  p('lfoSpeed', 'LFO SPEED', 40),
  p('lfoDepth', 'LFO DEPTH', 0),
  p('lfoDest', 'LFO DEST', 0, { max: 4, stepped: true, fmt: pick(LFO_DEST_NAMES) }),
  p('lfoBpmSync', 'BPM SYNC', 0, { max: 1, stepped: true, fmt: onOff }),
  p('lfoKeySync', 'KEY SYNC', 1, { max: 1, stepped: true, fmt: onOff }),
  p('fxSend', 'FX SELECT', 0, { max: 2, stepped: true, fmt: pick(FX_SEND_NAMES) }),
  p('fxOn', 'FX ON', 0, { max: 1, stepped: true, fmt: onOff }),
];

export const SYNTH_PARAMS: ParamDef[] = [
  p('oscType', 'OSC TYPE', 0, { max: 15, stepped: true, fmt: pick(OSC_TYPE_NAMES) }),
  p('oscEdit1', 'OSC EDIT1', 64),
  p('oscEdit2', 'OSC EDIT2', 0),
  p('glide', 'GLIDE', 0),
  p('tune', 'TUNE', 64, { fmt: semis24 }),
  ...COMMON_PART_PARAMS,
];

export const DRUM_PARAMS: ParamDef[] = [
  p('waveId', 'WAVE', 0, { max: 206, stepped: true }), // fmt patched by drum ROM names at runtime
  p('pitch', 'PITCH', 64, { fmt: semis24 }),
  ...COMMON_PART_PARAMS,
];

export const FX_PARAMS: ParamDef[] = [
  p('type', 'FX TYPE', 0, { max: 15, stepped: true, fmt: pick(FX_TYPE_NAMES) }),
  p('edit1', 'FX EDIT1', 64),
  p('edit2', 'FX EDIT2', 64),
  p('chain', 'CHAIN', 0, { max: 1, stepped: true, fmt: onOff }),
];

export const MASTER_PARAMS: ParamDef[] = [
  p('masterVolume', 'MASTER', 100),
  p('valveGain', 'TUBE GAIN', 0),
  p('accentLevel', 'ACCENT LVL', 64),
  p('swing', 'SWING', 50, { min: 50, max: 75, fmt: (v) => `${Math.round(v)}%` }),
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

/** Glide knob -> seconds per semitone-ish slide constant, 0 .. 0.4 s. */
export function mapGlide(v: number): number {
  return (v / 127) * (v / 127) * 0.4;
}

/** Bipolar 0..127 (center 64) -> -1..+1 */
export function mapBipolar(v: number): number {
  return Math.max(-1, Math.min(1, (v - 64) / 63));
}

/** Pitch/tune knob -> semitone offset -24..+24 */
export function mapSemis(v: number): number {
  return mapBipolar(v) * 24;
}

/** Level knob -> linear gain with a gentle audio-taper curve. */
export function mapLevel(v: number): number {
  const t = v / 127;
  return t * t;
}
