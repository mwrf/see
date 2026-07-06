/**
 * EMX-Web data model — the persisted/edited shape of patterns, songs, global settings.
 * Imported by the UI thread, the audio worklet, and tests. No DOM, no worklet APIs.
 * Structure follows the EMX-1 owner's manual (16 parts: 5 synth + 9 drum +
 * drum accent + synth accent; 128 steps max; beat/length/last-step semantics).
 */

export type SynthPartId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
export type DrumPartId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9';
/** ACCD = drum accent part, ACCS = synth accent part (two accents, like hardware). */
export type AccentPartId = 'ACCD' | 'ACCS';
export type PartId = SynthPartId | DrumPartId | AccentPartId;
/** Motion sequences can also target the three FX slot edit knobs. */
export type MotionTarget = PartId | 'FX1' | 'FX2' | 'FX3' | 'MASTER';

export const SYNTH_PART_IDS: SynthPartId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];
export const DRUM_PART_IDS: DrumPartId[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'];
export const ALL_PART_IDS: PartId[] = [...DRUM_PART_IDS, 'ACCD', ...SYNTH_PART_IDS, 'ACCS'];

export type Beat = '16' | '32' | '8T' | '16T';
export const BEATS: Beat[] = ['16', '32', '8T', '16T'];

/**
 * Steps per measure (manual p.52): beat 16 and 32 use 16 steps (a "32" step is a
 * 32nd note, so the measure lasts half as long); triplet grids use 12 steps.
 */
export const STEPS_PER_BAR: Record<Beat, number> = { '16': 16, '32': 16, '8T': 12, '16T': 12 };
/** Sequencer steps per quarter note for each beat mode. */
export const STEPS_PER_QUARTER: Record<Beat, number> = { '16': 4, '32': 8, '8T': 3, '16T': 6 };
/** Whether swing applies in this beat mode (triplet grids ignore swing, like hardware). */
export const BEAT_HAS_SWING: Record<Beat, boolean> = { '16': true, '32': true, '8T': false, '16T': false };

export const MAX_BARS = 8;
export const MAX_STEPS = 16 * MAX_BARS; // 128, like hardware
export const MAX_MOTION_SEQS = 24;
export const NUM_PATTERN_SLOTS = 256;
export const NUM_SONG_SLOTS = 64;
export const MIN_TEMPO = 20;
export const MAX_TEMPO = 300;
/** Max gate length in steps (manual: 0.25…128.0). */
export const MAX_GATE = 128;

/** A synth-part step. `gate` is in steps (fraction allowed); `note` is a MIDI note. */
export interface Step {
  on: boolean;
  note: number;
  gate: number;
}

/** Drum / accent steps only trigger. */
export interface DrumStep {
  on: boolean;
}

/**
 * All continuously-editable part parameters live in a flat Record keyed by param id
 * (see params.ts). Booleans are 0/1, enums are indices. This keeps knobs, engine
 * messages, motion sequences and serialization uniform.
 */
export type ParamMap = Record<string, number>;

export interface SynthPart {
  params: ParamMap;
  steps: Step[];
  /** 0 = SMOOTH, 1 = TRIG HOLD (motion seq playback mode for this part) */
  motionMode: 0 | 1;
  mute: boolean;
}

export interface DrumPart {
  params: ParamMap;
  steps: DrumStep[];
  motionMode: 0 | 1;
  mute: boolean;
}

export interface AccentPart {
  /** Accent intensity 0..127 (the PART COMMON level knob for the accent part) */
  level: number;
  steps: DrumStep[];
}

export interface FxSlot {
  /** Effect type index 0..15 (manual order, see fx registry) */
  type: number;
  edit1: number; // 0..127
  edit2: number; // 0..127
  /** Chain this slot's output into the next slot instead of the master bus. */
  chain: boolean;
}

export interface MotionSeq {
  target: MotionTarget;
  paramId: string;
  /** One value per sequencer step (length MAX_STEPS; unused tail ignored). */
  values: number[];
  /** Which steps actually hold recorded data. */
  mask: boolean[];
}

export interface ArpSettings {
  /** Index into ARP_SCALES (31 hardware scales) */
  scale: number;
  /** Center note produced at the middle of the pitch control */
  centerNote: number;
}

export interface Pattern {
  version: 1;
  name: string;
  tempo: number;
  /** 50..75 (%) */
  swing: number;
  beat: Beat;
  lengthBars: number; // 1..8
  /** Steps per measure (LAST STEP, 1..16; triplet beats cap at 12). */
  lastStep: number;
  /** Roll retrigger count per step: 2, 3 or 4 (manual "RollType"). */
  rollType: number;
  synths: Record<SynthPartId, SynthPart>;
  drums: Record<DrumPartId, DrumPart>;
  accentDrum: AccentPart;
  accentSynth: AccentPart;
  fx: [FxSlot, FxSlot, FxSlot];
  motions: MotionSeq[];
  arp: ArpSettings;
}

export interface SongEvent {
  patternSlot: number;
  /** Per-position transpose of synth parts, -24..+24 (manual "Note Offset"). */
  noteOffset: number;
  /** Parts muted for this song position (in addition to pattern data). */
  mutes: PartId[];
}

export interface Song {
  name: string;
  /** If >0 overrides pattern tempo for the whole song (tempo lock). */
  tempo: number;
  /** Next song slot to chain to when this one ends (-1 = stop). */
  nextSong: number;
  events: SongEvent[];
}

export interface GlobalSettings {
  masterVolume: number; // 0..127
  valveGain: number; // 0..127
  tubeOn: boolean;
  /** Master tune in cents, -50..+50 (synth parts only, like hardware). */
  masterTune: number;
  /** Memory protect: blocks WRITE operations when on. */
  protect: boolean;
}

/** Full-device export file. */
export interface EmxFile {
  magic: 'EMX-WEB';
  version: 1;
  patterns: (Pattern | null)[];
  songs: (Song | null)[];
  global: GlobalSettings;
}

// ---------------------------------------------------------------------------
// Defaults / factory
// ---------------------------------------------------------------------------

/** Effective steps per measure for a pattern (LAST STEP, capped by the beat grid). */
export function stepsPerMeasure(p: Pick<Pattern, 'beat' | 'lastStep'>): number {
  return Math.max(1, Math.min(STEPS_PER_BAR[p.beat], Math.round(p.lastStep)));
}

export function stepsForPattern(p: Pick<Pattern, 'beat' | 'lengthBars' | 'lastStep'>): number {
  return stepsPerMeasure(p) * p.lengthBars;
}

export function defaultSynthParams(): ParamMap {
  return {
    oscType: 0,
    wave: 0, // meaning depends on oscType (waveform / combo / PCM number…)
    oscEdit1: 64,
    oscEdit2: 64,
    glide: 0,
    tune: 64, // 64 = center, ±50 cents (SYNTH TUNE)
    filterType: 0,
    cutoff: 127,
    resonance: 0,
    egInt: 64, // bipolar, 64 = 0
    drive: 0,
    level: 100,
    pan: 64, // 64 = center
    egTime: 64,
    ampEg: 1, // 0 = gate, 1 = decay envelope
    roll: 0,
    accent: 1, // ACCENT SW
    swingSw: 1, // SWING SW
    lfoWave: 0, // Saw, Squ, Tri, S&H, Env
    lfoSpeed: 40,
    lfoDepth: 64, // bipolar, 64 = 0 (-63..+63)
    lfoDest: 0, // synth: Pitch, Amp, Pan, OscEd1, OscEd2, Cutoff
    lfoBpmSync: 0,
    fxSend: 0, // FX SELECT (FX1/2/3)
    fxOn: 0, // FX SEND on/off
  };
}

export function defaultDrumParams(waveId = 0): ParamMap {
  return {
    waveId,
    pitch: 64, // 64 = center, ±2 octaves via the hardware's nonlinear table
    // filter params kept engine-side for safety but hidden for drums in the UI
    filterType: 0,
    cutoff: 127,
    resonance: 0,
    egInt: 64,
    drive: 0,
    level: 100,
    pan: 64,
    egTime: 64,
    ampEg: 0, // gate mode: play whole sample
    roll: 0,
    accent: 1,
    swingSw: 1,
    lfoWave: 0,
    lfoSpeed: 40,
    lfoDepth: 64,
    lfoDest: 0, // drum: Pitch, Amp, Pan
    lfoBpmSync: 0,
    fxSend: 0,
    fxOn: 0,
  };
}

function emptySteps(): Step[] {
  // manual: cleared synth steps are pitch C4, gate 0.75
  return Array.from({ length: MAX_STEPS }, () => ({ on: false, note: 60, gate: 0.75 }));
}

function emptyDrumSteps(): DrumStep[] {
  return Array.from({ length: MAX_STEPS }, () => ({ on: false }));
}

/** Default drum kit wave assignment for a fresh pattern (indices into the drum ROM). */
export const DEFAULT_KIT: number[] = [0, 30, 60, 75, 90, 105, 120, 135, 160];

export function createDefaultPattern(name = 'INIT'): Pattern {
  const synths = {} as Record<SynthPartId, SynthPart>;
  for (const id of SYNTH_PART_IDS) {
    synths[id] = { params: defaultSynthParams(), steps: emptySteps(), motionMode: 0, mute: false };
  }
  const drums = {} as Record<DrumPartId, DrumPart>;
  DRUM_PART_IDS.forEach((id, i) => {
    drums[id] = {
      params: defaultDrumParams(DEFAULT_KIT[i] ?? 0),
      steps: emptyDrumSteps(),
      motionMode: 1,
      mute: false,
    };
  });
  return {
    version: 1,
    name,
    tempo: 120,
    swing: 50,
    beat: '16',
    lengthBars: 1,
    lastStep: 16,
    rollType: 2,
    synths,
    drums,
    accentDrum: { level: 64, steps: emptyDrumSteps() },
    accentSynth: { level: 64, steps: emptyDrumSteps() },
    fx: [
      { type: 1, edit1: 64, edit2: 64, chain: false },
      { type: 0, edit1: 64, edit2: 64, chain: false },
      { type: 8, edit1: 64, edit2: 64, chain: false },
    ],
    motions: [],
    arp: { scale: 0, centerNote: 60 },
  };
}

export function createDefaultGlobal(): GlobalSettings {
  return { masterVolume: 100, valveGain: 0, tubeOn: true, masterTune: 0, protect: false };
}

export function createEmptyFile(): EmxFile {
  return {
    magic: 'EMX-WEB',
    version: 1,
    patterns: Array.from({ length: NUM_PATTERN_SLOTS }, () => null),
    songs: Array.from({ length: NUM_SONG_SLOTS }, () => null),
    global: createDefaultGlobal(),
  };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

export function clonePattern(p: Pattern): Pattern {
  return JSON.parse(JSON.stringify(p)) as Pattern;
}

function migrateAccent(base: AccentPart, src: unknown): void {
  if (!src || typeof src !== 'object') return;
  const a = src as Partial<AccentPart>;
  if (typeof a.level === 'number') base.level = a.level;
  if (Array.isArray(a.steps)) {
    a.steps.slice(0, MAX_STEPS).forEach((s, i) => {
      base.steps[i] = { on: !!s.on };
    });
  }
}

/** Validate + migrate any parsed JSON into the current Pattern shape. Throws on garbage. */
export function migratePattern(raw: unknown): Pattern {
  if (typeof raw !== 'object' || raw === null) throw new Error('pattern: not an object');
  const p = raw as Partial<Pattern> & Record<string, unknown>;
  if (p.version !== 1) throw new Error(`pattern: unsupported version ${String(p.version)}`);
  const base = createDefaultPattern();
  const out = base as unknown as Record<string, unknown>;
  // Shallow-merge known top-level fields; per-part merge fills missing params with defaults
  // so files written by older builds keep loading as the param set grows.
  out.name = typeof p.name === 'string' ? p.name : base.name;
  out.tempo = typeof p.tempo === 'number' ? Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, p.tempo)) : base.tempo;
  out.swing = typeof p.swing === 'number' ? Math.min(75, Math.max(50, p.swing)) : base.swing;
  out.beat = BEATS.includes(p.beat as Beat) ? (p.beat as Beat) : base.beat;
  out.lengthBars =
    typeof p.lengthBars === 'number' ? Math.min(MAX_BARS, Math.max(1, Math.round(p.lengthBars))) : base.lengthBars;
  base.lastStep =
    typeof p.lastStep === 'number'
      ? Math.min(STEPS_PER_BAR[base.beat], Math.max(1, Math.round(p.lastStep)))
      : STEPS_PER_BAR[base.beat];
  base.rollType = [2, 3, 4].includes(p.rollType as number) ? (p.rollType as number) : 2;
  if (p.synths && typeof p.synths === 'object') {
    for (const id of SYNTH_PART_IDS) {
      const src = (p.synths as Record<string, Partial<SynthPart>>)[id];
      if (!src) continue;
      const dst = base.synths[id];
      if (src.params) dst.params = { ...dst.params, ...src.params };
      if (Array.isArray(src.steps)) {
        src.steps.slice(0, MAX_STEPS).forEach((s, i) => {
          dst.steps[i] = { on: !!s.on, note: typeof s.note === 'number' ? s.note : 60, gate: typeof s.gate === 'number' ? s.gate : 0.75 };
        });
      }
      dst.motionMode = src.motionMode === 1 ? 1 : 0;
      dst.mute = !!src.mute;
    }
  }
  if (p.drums && typeof p.drums === 'object') {
    for (const id of DRUM_PART_IDS) {
      const src = (p.drums as Record<string, Partial<DrumPart>>)[id];
      if (!src) continue;
      const dst = base.drums[id];
      if (src.params) dst.params = { ...dst.params, ...src.params };
      if (Array.isArray(src.steps)) {
        src.steps.slice(0, MAX_STEPS).forEach((s, i) => {
          dst.steps[i] = { on: !!s.on };
        });
      }
      dst.motionMode = src.motionMode === 0 ? 0 : 1;
      dst.mute = !!src.mute;
    }
  }
  migrateAccent(base.accentDrum, p.accentDrum ?? p.accent);
  migrateAccent(base.accentSynth, p.accentSynth ?? p.accent);
  if (Array.isArray(p.fx)) {
    p.fx.slice(0, 3).forEach((f, i) => {
      if (f && typeof f === 'object') {
        base.fx[i] = {
          type: typeof f.type === 'number' ? Math.min(15, Math.max(0, Math.round(f.type))) : base.fx[i].type,
          edit1: typeof f.edit1 === 'number' ? f.edit1 : base.fx[i].edit1,
          edit2: typeof f.edit2 === 'number' ? f.edit2 : base.fx[i].edit2,
          chain: !!f.chain,
        };
      }
    });
  }
  if (Array.isArray(p.motions)) {
    base.motions = (p.motions as MotionSeq[])
      .slice(0, MAX_MOTION_SEQS)
      .filter((m) => m && typeof m.paramId === 'string' && Array.isArray(m.values))
      .map((m) => ({
        target: (m.target as string) === 'ACC' ? 'ACCD' : m.target,
        paramId: m.paramId,
        values: m.values.slice(0, MAX_STEPS).map(Number),
        mask: Array.isArray(m.mask) ? m.mask.slice(0, MAX_STEPS).map(Boolean) : m.values.map(() => true),
      }));
  }
  if (p.arp && typeof p.arp === 'object') {
    const a = p.arp as Partial<ArpSettings>;
    base.arp = {
      scale: typeof a.scale === 'number' ? Math.max(0, Math.min(30, Math.round(a.scale))) : 0,
      centerNote: typeof a.centerNote === 'number' ? a.centerNote : 60,
    };
  }
  return base;
}

export function migrateFile(raw: unknown): EmxFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('file: not an object');
  const f = raw as Partial<EmxFile>;
  if (f.magic !== 'EMX-WEB') throw new Error('file: not an EMX-WEB export');
  if (f.version !== 1) throw new Error(`file: unsupported version ${String(f.version)}`);
  const out = createEmptyFile();
  if (Array.isArray(f.patterns)) {
    f.patterns.slice(0, NUM_PATTERN_SLOTS).forEach((p, i) => {
      if (p) out.patterns[i] = migratePattern(p);
    });
  }
  if (Array.isArray(f.songs)) {
    f.songs.slice(0, NUM_SONG_SLOTS).forEach((s, i) => {
      if (s && typeof s === 'object' && Array.isArray(s.events)) {
        out.songs[i] = {
          name: typeof s.name === 'string' ? s.name : `SONG ${i + 1}`,
          tempo: typeof s.tempo === 'number' ? s.tempo : 0,
          nextSong: typeof s.nextSong === 'number' ? Math.min(NUM_SONG_SLOTS - 1, Math.max(-1, Math.round(s.nextSong))) : -1,
          events: s.events
            .filter((e) => e && typeof e.patternSlot === 'number')
            .map((e) => ({
              patternSlot: Math.min(NUM_PATTERN_SLOTS - 1, Math.max(0, Math.round(e.patternSlot))),
              noteOffset: typeof e.noteOffset === 'number' ? Math.min(24, Math.max(-24, Math.round(e.noteOffset))) : 0,
              mutes: Array.isArray(e.mutes)
                ? e.mutes
                    .map((m) => ((m as string) === 'ACC' ? 'ACCD' : m))
                    .filter((m): m is PartId => ALL_PART_IDS.includes(m as PartId))
                : [],
            })),
        };
      }
    });
  }
  if (f.global && typeof f.global === 'object') {
    out.global = { ...out.global, ...f.global };
  }
  return out;
}
