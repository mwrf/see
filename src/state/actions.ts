/**
 * Semantic actions — the only way UI components mutate state.
 * Every action updates the store and mirrors the change to the engine.
 * (Store is source of truth for edits; the worklet holds the live copy.)
 */

import { autosaveWorkingPattern, readPatternSlot, writePatternSlot } from '../data/persist';
import { getEngine } from '../engine/audio-context';
import { drumWaveName } from '../engine/worklet/drum-rom';
import type { AccentPart, Beat, DrumPartId, MotionTarget, PartId, Pattern, Song, Step, SynthPartId } from '../shared/model';
import {
  clonePattern,
  createDefaultPattern,
  DRUM_PART_IDS,
  MAX_GATE,
  MAX_TEMPO,
  MIN_TEMPO,
  STEPS_PER_BAR,
  stepsForPattern,
  stepsPerMeasure,
  SYNTH_PART_IDS,
} from '../shared/model';
import type { ToEngine } from '../shared/messages';
import {
  ARP_SCALE_NAMES,
  formatParam,
  formatSynthWave,
  KEYBOARD_RANGES,
  METRONOME_MODE_NAMES,
  paramDef,
  synthWaveCount,
} from '../shared/params';
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

export function isAccentPart(id: PartId): id is 'ACCD' | 'ACCS' {
  return id === 'ACCD' || id === 'ACCS';
}

function accentOf(pattern: Pattern, id: 'ACCD' | 'ACCS'): AccentPart {
  return id === 'ACCD' ? pattern.accentDrum : pattern.accentSynth;
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

/** RESET key: restart the current pattern from its beginning during playback. */
export function resetPattern(): void {
  send({ t: 'RESET' });
}

/** SHIFT+RESET behavior: hold to erase the selected part's triggers as they pass. */
export function eraseHold(on: boolean): void {
  send({ t: 'ERASE_HOLD', on });
  if (on) setLcd('ERASE', store.get().selectedPart);
}

/** Metronome cycles Off -> Rec -> On (subset of the hardware's modes). */
let metronomeMode: 0 | 1 | 2 = 0;

export function cycleMetronome(): void {
  metronomeMode = ((metronomeMode + 1) % 3) as 0 | 1 | 2;
  send({ t: 'SET_METRONOME', mode: metronomeMode });
  store.update(['transport', 'lcd'], (s) => {
    s.lcd.line1 = 'METRONOME';
    s.lcd.line2 = METRONOME_MODE_NAMES[metronomeMode];
  });
}

export function getMetronomeMode(): number {
  return metronomeMode;
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
  const clamped = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(bpm * 10) / 10));
  send({ t: 'SET_TEMPO', bpm: clamped });
  store.update(['transport', 'pattern', 'lcd'], (s) => {
    s.pattern.tempo = clamped;
    s.lcd.line1 = 'TEMPO';
    s.lcd.line2 = `${clamped}`;
  });
  touchPattern();
}

/** Live performance transpose, -24..+24 semitones (not saved, like hardware). */
let transposeSemis = 0;

export function setTranspose(semis: number): void {
  transposeSemis = Math.min(24, Math.max(-24, Math.round(semis)));
  send({ t: 'TRANSPOSE', semis: transposeSemis });
  store.update(['transport', 'lcd'], (s) => {
    s.lcd.line1 = 'TRANSPOSE';
    s.lcd.line2 = transposeSemis > 0 ? `+${transposeSemis}` : `${transposeSemis}`;
  });
}

export function getTranspose(): number {
  return transposeSemis;
}

// ---------------------------------------------------------------------------
// Pattern structure
// ---------------------------------------------------------------------------

export function setSwing(value: number): void {
  const v = Math.min(75, Math.max(50, Math.round(value)));
  send({ t: 'SET_SWING', value: v });
  store.update(['pattern', 'lcd', 'params'], (s) => {
    s.pattern.swing = v;
    s.lcd.line1 = 'SWING';
    s.lcd.line2 = `${v}%`;
  });
  touchPattern();
}

function resyncPattern(): void {
  send({ t: 'SET_PATTERN', pattern: clonePattern(store.get().pattern) });
  touchPattern();
}

export function setBeat(beat: Beat): void {
  store.update(['pattern', 'steps', 'lcd'], (s) => {
    s.pattern.beat = beat;
    // changing BEAT resets LAST STEP to the grid default (manual p.53)
    s.pattern.lastStep = STEPS_PER_BAR[beat];
    s.page = 0;
    s.lcd.line1 = 'BEAT';
    s.lcd.line2 = beat;
  });
  resyncPattern();
}

export function setLengthBars(bars: number): void {
  store.update(['pattern', 'steps', 'lcd'], (s) => {
    s.pattern.lengthBars = Math.min(8, Math.max(1, Math.round(bars)));
    if (s.page >= s.pattern.lengthBars) s.page = s.pattern.lengthBars - 1;
    s.lcd.line1 = 'LENGTH';
    s.lcd.line2 = `${s.pattern.lengthBars} BAR${s.pattern.lengthBars > 1 ? 'S' : ''}`;
  });
  resyncPattern();
}

export function setLastStep(steps: number): void {
  store.update(['pattern', 'steps', 'lcd'], (s) => {
    s.pattern.lastStep = Math.min(STEPS_PER_BAR[s.pattern.beat], Math.max(1, Math.round(steps)));
    s.lcd.line1 = 'LAST STEP';
    s.lcd.line2 = `${s.pattern.lastStep}`;
  });
  resyncPattern();
}

export function setRollType(type: number): void {
  store.update(['pattern', 'lcd'], (s) => {
    s.pattern.rollType = [2, 3, 4].includes(type) ? type : 2;
    s.lcd.line1 = 'ROLL TYPE';
    s.lcd.line2 = `${s.pattern.rollType}`;
  });
  resyncPattern();
}

export function cycleArpScale(dir: 1 | -1): void {
  store.update(['pattern', 'lcd'], (s) => {
    const n = ARP_SCALE_NAMES.length;
    s.pattern.arp.scale = (s.pattern.arp.scale + dir + n) % n;
    s.lcd.line1 = 'ARP SCALE';
    s.lcd.line2 = ARP_SCALE_NAMES[s.pattern.arp.scale];
  });
  resyncPattern();
}

// ---------------------------------------------------------------------------
// Part selection / step keys
// ---------------------------------------------------------------------------

export function selectPart(partId: PartId, audition = true): void {
  store.update(['ui', 'steps', 'lcd'], (s) => {
    s.selectedPart = partId;
    if (isAccentPart(partId)) {
      s.lcd.line1 = partId === 'ACCD' ? 'DRUM ACCENT' : 'SYNTH ACCENT';
      s.lcd.line2 = `LEVEL ${Math.round(accentOf(s.pattern, partId).level)}`;
    } else if (isDrumPart(partId)) {
      s.lcd.line1 = `DRUM ${partId.slice(1)}`;
      s.lcd.line2 = drumWaveName(Math.round(s.pattern.drums[partId].params.waveId));
    } else {
      s.lcd.line1 = `SYNTH ${partId.slice(1)}`;
      s.lcd.line2 = formatParam('oscType', s.pattern.synths[partId as SynthPartId].params.oscType);
    }
    // keyboard mode is only valid for synth parts (manual p.12)
    if (!isSynthPart(partId) && s.stepKeyMode === 'keyboard') s.stepKeyMode = 'trig';
  });
  send({ t: 'SELECT_PART', partId });
  // pressing a part key auditions its sound at accented level (like hardware)
  if (audition && !isAccentPart(partId)) send({ t: 'TRIG', partId });
}

export function setStepKeyMode(mode: 'trig' | 'keyboard' | 'mute' | 'solo' | 'patternSet'): void {
  store.update(['ui', 'steps'], (s) => {
    if (mode === 'keyboard' && !isSynthPart(s.selectedPart)) return;
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
  const spm = stepsPerMeasure(s.pattern);
  if (keyIndex >= spm) return;
  const stepIdx = s.page * spm + keyIndex;
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
    const st = accentOf(s.pattern, part).steps[stepIdx];
    st.on = !st.on;
    data = { ...st };
  }
  send({ t: 'EDIT_STEP', partId: part, step: stepIdx, data: data as Step });
  store.update(['steps'], () => {});
  touchPattern();
}

/** SHIFT + part key: turn all steps of a part on/off at once (manual p.23). */
export function toggleAllSteps(partId: PartId): void {
  const s = store.get();
  const total = stepsForPattern(s.pattern);
  const steps = isSynthPart(partId)
    ? s.pattern.synths[partId].steps
    : isDrumPart(partId)
      ? s.pattern.drums[partId].steps
      : accentOf(s.pattern, partId).steps;
  const anyOn = steps.slice(0, total).some((st) => st.on);
  for (let i = 0; i < total; i++) {
    steps[i].on = !anyOn;
    send({ t: 'EDIT_STEP', partId, step: i, data: { ...steps[i] } as Step });
  }
  store.update(['steps'], () => {});
  touchPattern();
}

export function setStepNote(stepIdx: number, note: number, gate?: number): void {
  const s = store.get();
  if (!isSynthPart(s.selectedPart)) return;
  const st = s.pattern.synths[s.selectedPart].steps[stepIdx];
  st.note = note;
  if (gate !== undefined) st.gate = Math.min(MAX_GATE, Math.max(0.25, gate));
  send({ t: 'EDIT_STEP', partId: s.selectedPart, step: stepIdx, data: { ...st } });
  store.update(['steps'], () => {});
  touchPattern();
}

// ---------------------------------------------------------------------------
// Keyboard mode (step keys as chromatic keyboard, 8 octave ranges like hardware)
// ---------------------------------------------------------------------------

export function keyboardNote(keyIndex: number): number {
  const s = store.get();
  const range = KEYBOARD_RANGES[Math.min(KEYBOARD_RANGES.length - 1, Math.max(0, s.keyboardOctave))];
  return range.baseNote + keyIndex;
}

export function keyboardNoteOn(keyIndex: number): void {
  const s = store.get();
  if (!isSynthPart(s.selectedPart)) return;
  send({ t: 'NOTE_ON', partId: s.selectedPart, note: keyboardNote(keyIndex) });
}

export function keyboardNoteOff(): void {
  const s = store.get();
  if (!isSynthPart(s.selectedPart)) return;
  send({ t: 'NOTE_OFF', partId: s.selectedPart });
}

export function shiftOctave(delta: number): void {
  store.update(['ui', 'lcd'], (s) => {
    s.keyboardOctave = Math.min(KEYBOARD_RANGES.length - 1, Math.max(0, s.keyboardOctave + delta));
    s.lcd.line1 = 'PITCH RANGE';
    s.lcd.line2 = KEYBOARD_RANGES[s.keyboardOctave].label;
  });
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

/** Resolve the ParamMap that backs a target in the working pattern (or null). */
function targetParams(s: ReturnType<typeof store.get>, target: MotionTarget): Record<string, number> | null {
  if (isSynthPart(target as PartId)) return s.pattern.synths[target as SynthPartId].params;
  if (isDrumPart(target as PartId)) return s.pattern.drums[target as DrumPartId].params;
  return null;
}

export function setParam(target: MotionTarget, paramId: string, value: number): void {
  const def = paramDef(paramId);
  let v = Math.min(def.max, Math.max(def.min, value));
  const s = store.get();
  let displayValue: string | null = null;
  if (target === 'MASTER') {
    if (paramId === 'masterVolume') s.global.masterVolume = v;
    else if (paramId === 'valveGain') s.global.valveGain = v;
    else if (paramId === 'masterTune') s.global.masterTune = ((v - 64) / 63) * 50;
    else if (paramId === 'swing') s.pattern.swing = v;
  } else if (target === 'ACCD' || target === 'ACCS') {
    if (paramId === 'level' || paramId === 'accentLevel') {
      accentOf(s.pattern, target).level = v;
      displayValue = String(Math.round(v));
    }
  } else if (target === 'FX1' || target === 'FX2' || target === 'FX3') {
    const slot = s.pattern.fx[Number(target[2]) - 1];
    if (paramId === 'type') slot.type = Math.round(v);
    else if (paramId === 'edit1') slot.edit1 = v;
    else if (paramId === 'edit2') slot.edit2 = v;
    else if (paramId === 'chain') slot.chain = v >= 0.5;
  } else {
    const params = targetParams(s, target);
    if (!params) return;
    if (def.stepped) v = Math.round(v);
    // synth WAVE wraps to the option count of the current osc type
    if (paramId === 'wave' && isSynthPart(target as PartId)) {
      const count = synthWaveCount(params.oscType);
      v = count === 0 ? 0 : Math.min(count - 1, Math.max(0, Math.round(v)));
      displayValue = formatSynthWave(params.oscType, v);
    }
    if (paramId === 'oscType') {
      // switching osc type clamps wave into the new range
      const count = synthWaveCount(v);
      if (params.wave >= Math.max(1, count)) params.wave = 0;
    }
    params[paramId] = v;
  }
  send({ t: 'SET_PARAM', target, paramId, value: def.stepped ? Math.round(v) : v });
  if (displayValue === null) {
    displayValue = paramId === 'waveId' ? drumWaveName(Math.round(v)) : formatParam(paramId, v);
  }
  store.update([`param:${paramId}:${target}`, 'params', 'lcd'], (st) => {
    st.lcd.line1 = def.label;
    st.lcd.line2 = displayValue!;
  });
  if (target !== 'MASTER' || paramId === 'swing') touchPattern();
}

export function getParam(target: MotionTarget, paramId: string): number {
  const s = store.get();
  if (target === 'MASTER') {
    if (paramId === 'masterVolume') return s.global.masterVolume;
    if (paramId === 'valveGain') return s.global.valveGain;
    if (paramId === 'masterTune') return 64 + (s.global.masterTune / 50) * 63;
    if (paramId === 'swing') return s.pattern.swing;
    return 0;
  }
  if (target === 'ACCD' || target === 'ACCS') {
    return accentOf(s.pattern, target).level;
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

const soloSet = new Set<PartId>();

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
  if (isAccentPart(partId)) return;
  const on = !soloSet.has(partId);
  if (on) soloSet.add(partId);
  else soloSet.delete(partId);
  send({ t: 'SOLO', partId, on });
  store.update(['ui', 'steps'], () => {});
}

export function clearSolo(): void {
  soloSet.clear();
  send({ t: 'SOLO', partId: null, on: false });
  store.update(['ui', 'steps'], () => {});
}

export function isSolo(partId: PartId): boolean {
  return soloSet.has(partId);
}

export function anySolo(): boolean {
  return soloSet.size > 0;
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
// Pattern operations (SHIFT functions on hardware)
// ---------------------------------------------------------------------------

function partSteps(pattern: Pattern, partId: PartId): (Step | { on: boolean })[] {
  if (isSynthPart(partId)) return pattern.synths[partId].steps;
  if (isDrumPart(partId)) return pattern.drums[partId].steps;
  return accentOf(pattern, partId).steps;
}

/** CLEAR PART: erase the selected part's sequence + its motions (not sound). */
export function clearPart(partId: PartId): void {
  const s = store.get();
  const steps = partSteps(s.pattern, partId);
  const total = stepsForPattern(s.pattern);
  for (let i = 0; i < total; i++) {
    const st = steps[i] as Step;
    st.on = false;
    if (isSynthPart(partId)) {
      st.note = 60; // manual: cleared synth steps reset to C4, gate 0.75
      st.gate = 0.75;
    }
  }
  s.pattern.motions = s.pattern.motions.filter((m) => m.target !== partId);
  resyncPattern();
  store.update(['steps', 'pattern', 'lcd'], (st) => {
    st.lcd.line1 = 'CLEAR PART';
    st.lcd.line2 = partId;
  });
}

/** CLEAR PATTERN: reinitialize the whole working pattern. */
export function clearPattern(): void {
  const s = store.get();
  const fresh = createDefaultPattern(s.pattern.name);
  store.update(['pattern', 'steps', 'params', 'lcd'], (st) => {
    st.pattern = fresh;
    st.page = 0;
    st.lcd.line1 = 'CLEAR';
    st.lcd.line2 = 'PATTERN';
  });
  resyncPattern();
}

/** SHIFT NOTE: transpose the stored note data of a synth part (manual p.55). */
export function shiftNotes(partId: SynthPartId, semis: number): void {
  const s = store.get();
  const total = stepsForPattern(s.pattern);
  const steps = s.pattern.synths[partId].steps;
  for (let i = 0; i < total; i++) {
    steps[i].note = Math.min(127, Math.max(0, steps[i].note + semis));
  }
  resyncPattern();
  store.update(['steps', 'lcd'], (st) => {
    st.lcd.line1 = 'SHIFT NOTE';
    st.lcd.line2 = semis > 0 ? `+${semis}` : `${semis}`;
  });
}

/** MOVE DATA: rotate a part's steps by N (wraps around, manual p.54). */
export function moveData(partId: PartId, offset: number): void {
  const s = store.get();
  const total = stepsForPattern(s.pattern);
  const steps = partSteps(s.pattern, partId);
  const src = steps.slice(0, total).map((st) => ({ ...st }));
  for (let i = 0; i < total; i++) {
    const from = (((i - offset) % total) + total) % total;
    Object.assign(steps[i], src[from]);
  }
  resyncPattern();
  store.update(['steps', 'lcd'], (st) => {
    st.lcd.line1 = 'MOVE DATA';
    st.lcd.line2 = offset > 0 ? `+${offset}` : `${offset}`;
  });
}

/** COPY PART: copy another part's sound + sequence into the selected part. */
export function copyPart(from: PartId, to: PartId): void {
  const s = store.get();
  if (isSynthPart(from) && isSynthPart(to)) {
    const src = s.pattern.synths[from];
    s.pattern.synths[to] = JSON.parse(JSON.stringify(src)) as typeof src;
  } else if (isDrumPart(from) && isDrumPart(to)) {
    const src = s.pattern.drums[from];
    s.pattern.drums[to] = JSON.parse(JSON.stringify(src)) as typeof src;
  } else {
    setLcd('COPY PART', 'TYPE MISMATCH');
    return;
  }
  resyncPattern();
  store.update(['steps', 'params', 'lcd'], (st) => {
    st.lcd.line1 = 'COPY PART';
    st.lcd.line2 = `${from} → ${to}`;
  });
}

// ---------------------------------------------------------------------------
// Pattern slots
// ---------------------------------------------------------------------------

export async function writePattern(slot?: number): Promise<void> {
  const s = store.get();
  if (s.global.protect) {
    setLcd('PROTECT', 'MEMORY ON');
    return;
  }
  const target = slot ?? s.patternSlot;
  await writePatternSlot(target, clonePattern(s.pattern));
  store.update(['ui', 'lcd'], (st) => {
    st.patternSlot = target;
    st.patternDirty = false;
    st.lcd.line1 = 'WRITE';
    st.lcd.line2 = `PATTERN ${formatSlot(target)}`;
  });
}

export function renamePattern(name: string): void {
  store.update(['pattern', 'lcd'], (s) => {
    s.pattern.name = name.slice(0, 8).toUpperCase();
    s.lcd.line1 = 'RENAME';
    s.lcd.line2 = s.pattern.name;
  });
  touchPattern();
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
    store.update(['pattern', 'steps', 'ui', 'lcd', 'transport', 'params'], (st) => {
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
// Song mode
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

function blankSong(slot: number): Song {
  return { name: `SONG ${slot + 1}`, tempo: 0, nextSong: -1, events: [] };
}

export async function loadSong(slot: number): Promise<void> {
  const { readSongSlot } = await import('../data/persist');
  const song = await readSongSlot(slot);
  store.update(['ui', 'song', 'lcd'], (s) => {
    s.songSlot = slot;
    s.song = song ?? blankSong(slot);
    s.lcd.line1 = formatSongSlot(slot);
    s.lcd.line2 = song ? `${song.events.length} EVENTS` : 'EMPTY';
  });
  if (store.get().mode === 'song') await syncSongToEngine();
}

export async function saveSong(): Promise<void> {
  const s = store.get();
  if (!s.song) return;
  if (s.global.protect) {
    setLcd('PROTECT', 'MEMORY ON');
    return;
  }
  const { writeSongSlot } = await import('../data/persist');
  await writeSongSlot(s.songSlot, s.song);
  setLcd('WRITE', formatSongSlot(s.songSlot));
}

/** Append the current pattern slot as the next song event. */
export async function addSongEvent(): Promise<void> {
  const s = store.get();
  if (!s.song) setSong(blankSong(s.songSlot), s.songSlot);
  const song = store.get().song!;
  song.events.push({ patternSlot: s.patternSlot, noteOffset: 0, mutes: [] });
  store.update(['song', 'lcd'], (st) => {
    st.lcd.line1 = `POS ${song.events.length}`;
    st.lcd.line2 = `PTN ${formatSlot(s.patternSlot)}`;
  });
  if (s.mode === 'song') await syncSongToEngine();
}

export async function removeSongEvent(): Promise<void> {
  const s = store.get();
  if (!s.song || s.song.events.length === 0) return;
  s.song.events.pop();
  store.update(['song', 'lcd'], (st) => {
    st.lcd.line1 = 'EVENT DELETED';
    st.lcd.line2 = `${s.song!.events.length} LEFT`;
  });
  if (s.mode === 'song') await syncSongToEngine();
}

/** Adjust the note offset of the last song event (per-position transpose). */
export async function nudgeSongNoteOffset(delta: number): Promise<void> {
  const s = store.get();
  const ev = s.song?.events[s.song.events.length - 1];
  if (!ev) return;
  ev.noteOffset = Math.min(24, Math.max(-24, ev.noteOffset + delta));
  store.update(['song', 'lcd'], (st) => {
    st.lcd.line1 = 'NOTE OFFSET';
    st.lcd.line2 = ev.noteOffset > 0 ? `+${ev.noteOffset}` : `${ev.noteOffset}`;
  });
  if (s.mode === 'song') await syncSongToEngine();
}

export function toggleProtect(): void {
  store.update(['ui', 'lcd'], (s) => {
    s.global.protect = !s.global.protect;
    s.lcd.line1 = 'PROTECT';
    s.lcd.line2 = s.global.protect ? 'ON' : 'OFF';
  });
}
