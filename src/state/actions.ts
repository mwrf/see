/**
 * Semantic actions — the only way UI components mutate state.
 * Every action updates the store and mirrors the change to the engine.
 * (Store is source of truth for edits; the worklet holds the live copy.)
 */

import { autosaveWorkingPattern, readPatternSlot, writePatternSlot } from '../data/persist';
import { getEngine } from '../engine/audio-context';
import { drumWaveName } from '../engine/worklet/drum-rom';
import type { Beat, DrumPartId, MotionTarget, PartId, Pattern, Song, Step, SynthPartId } from '../shared/model';
import {
  clonePattern,
  createDefaultPattern,
  DRUM_PART_IDS,
  MAX_TEMPO,
  MIN_TEMPO,
  STEPS_PER_BAR,
  stepsForPattern,
  SYNTH_PART_IDS,
} from '../shared/model';
import type { ToEngine } from '../shared/messages';
import { formatParam, paramDef } from '../shared/params';
import { store } from './store';

function send(msg: ToEngine): void {
  getEngine()?.send(msg);
}

function touchPattern(): void {
  const s = store.get();
  s.patternDirty = true;
  autosaveWorkingPattern(s.pattern, s.patternSlot);
}

export function isSynthPart(id: PartId): id is SynthPartId {
  return (SYNTH_PART_IDS as string[]).includes(id);
}

export function isDrumPart(id: PartId): id is DrumPartId {
  return (DRUM_PART_IDS as string[]).includes(id);
}

export function setLcd(line1: string, line2: string): void {
  store.update(['lcd'], (s) => {
    s.lcd.line1 = line1;
    s.lcd.line2 = line2;
  });
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export function play(): void {
  send({ t: 'TRANSPORT', action: 'play' });
  store.update(['playhead'], (s) => {
    s.playhead.playing = true;
  });
}

export function stop(): void {
  send({ t: 'TRANSPORT', action: 'stop' });
  store.update(['playhead'], (s) => {
    s.playhead.playing = false;
    s.playhead.step = 0;
    s.playhead.bar = 0;
  });
}

export function togglePlay(): void {
  if (store.get().playhead.playing) stop();
  else play();
}

export function toggleRec(): void {
  const rec = !store.get().recording;
  send({ t: 'TRANSPORT', action: rec ? 'recOn' : 'recOff' });
  store.update(['transport'], (s) => {
    s.recording = rec;
  });
}

const tapTimes: number[] = [];

export function tapTempo(): void {
  const now = performance.now();
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes.length = 0;
  tapTimes.push(now);
  if (tapTimes.length >= 2) {
    const intervals = tapTimes.slice(1).map((t, i) => t - tapTimes[i]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    setTempo(Math.round((60000 / avg) * 10) / 10);
  }
  if (tapTimes.length > 8) tapTimes.shift();
}

export function setTempo(bpm: number): void {
  const clamped = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, bpm));
  send({ t: 'SET_TEMPO', bpm: clamped });
  store.update(['transport', 'pattern'], (s) => {
    s.pattern.tempo = clamped;
    s.lcd.line1 = 'TEMPO';
    s.lcd.line2 = `${clamped}`;
  });
  store.update(['lcd'], () => {});
  touchPattern();
}

// ---------------------------------------------------------------------------
// Pattern structure
// ---------------------------------------------------------------------------

export function setSwing(value: number): void {
  const v = Math.min(75, Math.max(50, Math.round(value)));
  send({ t: 'SET_SWING', value: v });
  store.update(['pattern', 'lcd', 'param:swing:MASTER'], (s) => {
    s.pattern.swing = v;
    s.lcd.line1 = 'SWING';
    s.lcd.line2 = `${v}%`;
  });
  touchPattern();
}

export function setBeat(beat: Beat): void {
  store.update(['pattern', 'steps', 'lcd'], (s) => {
    s.pattern.beat = beat;
    s.page = 0;
    s.lcd.line1 = 'BEAT';
    s.lcd.line2 = beat;
  });
  send({ t: 'SET_PATTERN', pattern: clonePattern(store.get().pattern) });
  touchPattern();
}

export function setLengthBars(bars: number): void {
  store.update(['pattern', 'steps', 'lcd'], (s) => {
    s.pattern.lengthBars = Math.min(8, Math.max(1, Math.round(bars)));
    if (s.page >= s.pattern.lengthBars) s.page = s.pattern.lengthBars - 1;
    s.lcd.line1 = 'LENGTH';
    s.lcd.line2 = `${s.pattern.lengthBars} BAR${s.pattern.lengthBars > 1 ? 'S' : ''}`;
  });
  send({ t: 'SET_PATTERN', pattern: clonePattern(store.get().pattern) });
  touchPattern();
}

// ---------------------------------------------------------------------------
// Part selection / step keys
// ---------------------------------------------------------------------------

export function selectPart(partId: PartId): void {
  store.update(['ui', 'steps', 'lcd'], (s) => {
    s.selectedPart = partId;
    if (partId === 'ACC') s.lcd.line1 = 'ACCENT';
    else s.lcd.line1 = `PART ${partId}`;
    if (isDrumPart(partId)) {
      const waveId = Math.round(s.pattern.drums[partId].params.waveId);
      s.lcd.line2 = drumWaveName(waveId);
    } else if (isSynthPart(partId)) {
      s.lcd.line2 = formatParam('oscType', s.pattern.synths[partId].params.oscType);
    } else {
      s.lcd.line2 = `LEVEL ${Math.round(s.pattern.accent.level)}`;
    }
  });
  send({ t: 'SELECT_PART', partId });
  // pressing a part key auditions its sound (like hardware)
  if (partId !== 'ACC') send({ t: 'TRIG', partId });
}

export function setStepKeyMode(mode: 'trig' | 'keyboard' | 'mute' | 'patternSet'): void {
  store.update(['ui', 'steps'], (s) => {
    s.stepKeyMode = mode;
  });
}

export function setPage(page: number): void {
  store.update(['ui', 'steps'], (s) => {
    s.page = Math.min(s.pattern.lengthBars - 1, Math.max(0, page));
  });
}

/** Toggle a step for the selected part. `keyIndex` is 0..15 on the current page. */
export function toggleStep(keyIndex: number): void {
  const s = store.get();
  const spb = STEPS_PER_BAR[s.pattern.beat];
  if (keyIndex >= spb && s.pattern.beat !== '32') return; // 12/24-step grids use fewer keys
  const perPage = s.pattern.beat === '32' ? 32 : spb;
  const stepIdx = s.page * perPage + keyIndex;
  if (stepIdx >= stepsForPattern(s.pattern)) return;

  const part = s.selectedPart;
  let data: Step | { on: boolean };
  if (isSynthPart(part)) {
    const st = s.pattern.synths[part].steps[stepIdx];
    st.on = !st.on;
    data = { ...st };
  } else if (isDrumPart(part)) {
    const st = s.pattern.drums[part].steps[stepIdx];
    st.on = !st.on;
    data = { ...st };
  } else {
    const st = s.pattern.accent.steps[stepIdx];
    st.on = !st.on;
    data = { ...st };
  }
  send({ t: 'EDIT_STEP', partId: part, step: stepIdx, data: data as Step });
  store.update(['steps'], () => {});
  touchPattern();
}

export function setStepNote(stepIdx: number, note: number, gate?: number): void {
  const s = store.get();
  if (!isSynthPart(s.selectedPart)) return;
  const st = s.pattern.synths[s.selectedPart].steps[stepIdx];
  st.note = note;
  if (gate !== undefined) st.gate = gate;
  send({ t: 'EDIT_STEP', partId: s.selectedPart, step: stepIdx, data: { ...st } });
  store.update(['steps'], () => {});
  touchPattern();
}

// ---------------------------------------------------------------------------
// Keyboard mode (step keys as chromatic keyboard)
// ---------------------------------------------------------------------------

export function keyboardNote(keyIndex: number): number {
  const s = store.get();
  // step keys 0..15 map to a chromatic run from C + octave shift
  return 48 + s.keyboardOctave * 12 + keyIndex;
}

export function keyboardNoteOn(keyIndex: number): void {
  const s = store.get();
  if (s.selectedPart === 'ACC') return;
  const note = keyboardNote(keyIndex);
  send({ t: 'NOTE_ON', partId: s.selectedPart, note });
}

export function keyboardNoteOff(): void {
  const s = store.get();
  if (s.selectedPart === 'ACC') return;
  send({ t: 'NOTE_OFF', partId: s.selectedPart });
}

export function shiftOctave(delta: number): void {
  store.update(['ui', 'lcd'], (s) => {
    s.keyboardOctave = Math.min(3, Math.max(-2, s.keyboardOctave + delta));
    s.lcd.line1 = 'OCTAVE';
    s.lcd.line2 = s.keyboardOctave >= 0 ? `+${s.keyboardOctave}` : `${s.keyboardOctave}`;
  });
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

/** Resolve the ParamMap that backs a target in the working pattern (or null for MASTER). */
function targetParams(s: ReturnType<typeof store.get>, target: MotionTarget): Record<string, number> | null {
  if (isSynthPart(target as PartId)) return s.pattern.synths[target as SynthPartId].params;
  if (isDrumPart(target as PartId)) return s.pattern.drums[target as DrumPartId].params;
  return null;
}

export function setParam(target: MotionTarget, paramId: string, value: number): void {
  const def = paramDef(paramId);
  const v = Math.min(def.max, Math.max(def.min, value));
  const s = store.get();
  if (target === 'MASTER') {
    if (paramId === 'masterVolume') s.global.masterVolume = v;
    else if (paramId === 'valveGain') s.global.valveGain = v;
    else if (paramId === 'accentLevel') s.pattern.accent.level = v;
    else if (paramId === 'swing') s.pattern.swing = v;
  } else if (target === 'FX1' || target === 'FX2' || target === 'FX3') {
    const slot = s.pattern.fx[Number(target[2]) - 1];
    if (paramId === 'type') slot.type = Math.round(v);
    else if (paramId === 'edit1') slot.edit1 = v;
    else if (paramId === 'edit2') slot.edit2 = v;
    else if (paramId === 'chain') slot.chain = v >= 0.5;
  } else {
    const params = targetParams(s, target);
    if (!params) return;
    params[paramId] = def.stepped ? Math.round(v) : v;
  }
  send({ t: 'SET_PARAM', target, paramId, value: def.stepped ? Math.round(v) : v });
  const displayValue =
    paramId === 'waveId' ? drumWaveName(Math.round(v)) : formatParam(paramId, v);
  store.update([`param:${paramId}:${target}`, 'params', 'lcd'], (st) => {
    st.lcd.line1 = def.label;
    st.lcd.line2 = displayValue;
  });
  if (target !== 'MASTER' || paramId === 'accentLevel' || paramId === 'swing') touchPattern();
}

export function getParam(target: MotionTarget, paramId: string): number {
  const s = store.get();
  if (target === 'MASTER') {
    if (paramId === 'masterVolume') return s.global.masterVolume;
    if (paramId === 'valveGain') return s.global.valveGain;
    if (paramId === 'accentLevel') return s.pattern.accent.level;
    if (paramId === 'swing') return s.pattern.swing;
    return 0;
  }
  if (target === 'FX1' || target === 'FX2' || target === 'FX3') {
    const slot = s.pattern.fx[Number(target[2]) - 1];
    if (paramId === 'type') return slot.type;
    if (paramId === 'edit1') return slot.edit1;
    if (paramId === 'edit2') return slot.edit2;
    if (paramId === 'chain') return slot.chain ? 1 : 0;
    return 0;
  }
  const params = targetParams(s, target);
  return params?.[paramId] ?? 0;
}

// ---------------------------------------------------------------------------
// Mute / solo / motion
// ---------------------------------------------------------------------------

let currentSolo: PartId | null = null;

export function toggleMute(partId: PartId): void {
  const s = store.get();
  let on = false;
  if (isSynthPart(partId)) {
    on = s.pattern.synths[partId].mute = !s.pattern.synths[partId].mute;
  } else if (isDrumPart(partId)) {
    on = s.pattern.drums[partId].mute = !s.pattern.drums[partId].mute;
  } else return;
  send({ t: 'MUTE', partId, on });
  store.update(['ui', 'steps'], () => {});
  touchPattern();
}

export function toggleSolo(partId: PartId): void {
  currentSolo = currentSolo === partId ? null : partId;
  send({ t: 'SOLO', partId: currentSolo });
  store.update(['ui'], () => {});
}

export function getSolo(): PartId | null {
  return currentSolo;
}

export function clearMotion(index: number): void {
  const s = store.get();
  s.pattern.motions.splice(index, 1);
  send({ t: 'CLEAR_MOTION', index });
  store.update(['pattern', 'lcd'], (st) => {
    st.lcd.line1 = 'MOTION SEQ';
    st.lcd.line2 = 'CLEARED';
  });
  touchPattern();
}

export function setMotionMode(partId: PartId, mode: 0 | 1): void {
  const s = store.get();
  if (isSynthPart(partId)) s.pattern.synths[partId].motionMode = mode;
  else if (isDrumPart(partId)) s.pattern.drums[partId].motionMode = mode;
  send({ t: 'SET_MOTION_MODE', partId, mode });
  store.update(['pattern'], () => {});
  touchPattern();
}

// ---------------------------------------------------------------------------
// Ribbon / slider
// ---------------------------------------------------------------------------

export function ribbon(value: number | null): void {
  send({ t: 'RIBBON', value });
}

export function slider(value: number): void {
  send({ t: 'SLIDER', value });
}

// ---------------------------------------------------------------------------
// Pattern slots
// ---------------------------------------------------------------------------

export async function writePattern(slot?: number): Promise<void> {
  const s = store.get();
  const target = slot ?? s.patternSlot;
  await writePatternSlot(target, clonePattern(s.pattern));
  store.update(['ui', 'lcd'], (st) => {
    st.patternSlot = target;
    st.patternDirty = false;
    st.lcd.line1 = 'WRITE';
    st.lcd.line2 = `PATTERN ${formatSlot(target)}`;
  });
}

export async function loadPattern(slot: number): Promise<void> {
  const s = store.get();
  const stored = await readPatternSlot(slot);
  const pattern = stored ?? createDefaultPattern(`PTN ${formatSlot(slot)}`);
  if (s.playhead.playing) {
    // quantized switch at pattern end (like hardware)
    send({ t: 'SET_NEXT_PATTERN', pattern: clonePattern(pattern), slot });
    store.update(['lcd'], (st) => {
      st.lcd.line1 = 'NEXT PTN';
      st.lcd.line2 = formatSlot(slot);
    });
  } else {
    send({ t: 'SET_NEXT_PATTERN', pattern: clonePattern(pattern), slot });
    store.update(['pattern', 'steps', 'ui', 'lcd', 'transport'], (st) => {
      st.pattern = pattern;
      st.patternSlot = slot;
      st.patternDirty = false;
      st.page = 0;
      st.lcd.line1 = `PTN ${formatSlot(slot)}`;
      st.lcd.line2 = pattern.name;
    });
  }
}

/** EMX-style slot naming: A.01-A.64, B.01-B.64, C…, D… */
export function formatSlot(slot: number): string {
  const bank = 'ABCD'[Math.floor(slot / 64)] ?? '?';
  return `${bank}.${String((slot % 64) + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Song mode (engine sync happens when entering song mode / pressing play)
// ---------------------------------------------------------------------------

export async function setAppMode(mode: 'pattern' | 'song' | 'global'): Promise<void> {
  store.update(['ui', 'lcd'], (s) => {
    s.mode = mode;
    s.lcd.line1 = mode.toUpperCase();
    s.lcd.line2 = mode === 'song' ? formatSongSlot(s.songSlot) : mode === 'pattern' ? formatSlot(s.patternSlot) : '';
  });
  if (mode === 'song') {
    await syncSongToEngine();
    send({ t: 'MODE', mode: 'song' });
  } else if (mode === 'pattern') {
    send({ t: 'MODE', mode: 'pattern' });
    send({ t: 'SET_PATTERN', pattern: clonePattern(store.get().pattern) });
  }
}

export function formatSongSlot(slot: number): string {
  return `S.${String(slot + 1).padStart(2, '0')}`;
}

export async function syncSongToEngine(): Promise<void> {
  const s = store.get();
  if (!s.song) return;
  const patterns: Record<number, Pattern> = {};
  for (const ev of s.song.events) {
    if (!(ev.patternSlot in patterns)) {
      const p = await readPatternSlot(ev.patternSlot);
      if (p) patterns[ev.patternSlot] = p;
    }
  }
  send({ t: 'SET_SONG', song: s.song, patterns });
}

export function setSong(song: Song | null, slot: number): void {
  store.update(['ui', 'song'], (s) => {
    s.song = song;
    s.songSlot = slot;
  });
}
