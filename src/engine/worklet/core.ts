/**
 * EmxCore — the whole instrument, renderable offline (tests) or inside the
 * AudioWorkletProcessor. Owns the sequencer clock, 14 voices, motion
 * sequences, 3 FX slots, and the valve output stage.
 */

import { clamp } from '../../shared/math';
import type {
  DrumPartId,
  MotionSeq,
  MotionTarget,
  ParamMap,
  PartId,
  Pattern,
  Song,
  Step,
  SynthPartId,
} from '../../shared/model';
import {
  createDefaultPattern,
  DRUM_PART_IDS,
  STEPS_PER_BAR,
  stepsForPattern,
  SYNTH_PART_IDS,
} from '../../shared/model';
import type { FromEngine, ToEngine } from '../../shared/messages';
import { mapLevel, SCALES } from '../../shared/params';
import type { DrumWave } from './drum-rom';
import { createFx, type FxProcessor } from './fx';
import { SequencerClock } from './sequencer';
import { Valve } from './valve';
import { DrumVoice, SynthVoice, type TriggerInfo } from './voices';

export const BLOCK = 128;

interface PendingTrigger {
  time: number; // absolute sample time
  partId: PartId;
  note: number;
  gateSamples: number;
  accented: boolean;
}

interface FxSlotState {
  type: number;
  proc: FxProcessor;
}

export class EmxCore {
  readonly sr: number;
  private post: (msg: FromEngine, transfer?: Transferable[]) => void;

  private pattern: Pattern = createDefaultPattern();
  private patternSlot = 0;
  private nextPattern: { pattern: Pattern; slot: number } | null = null;

  private clock: SequencerClock;
  private playing = false;
  private recording = false;
  private pending: PendingTrigger[] = [];
  private lastReportedStep = -1;

  private rom: DrumWave[] = [];
  private synthVoices = new Map<SynthPartId, SynthVoice>();
  private drumVoices = new Map<DrumPartId, DrumVoice>();
  /** live (possibly motion-overridden) params per part, reused across blocks */
  private effParams = new Map<string, ParamMap>();

  private fxSlots: FxSlotState[] = [];
  private valve = new Valve();
  private masterVolume = 100;
  private valveGain = 0;

  private solo: PartId | null = null;
  private selectedPart: PartId = 'S1';

  // live keyboard state
  private heldNotes = new Map<PartId, number>();

  // ribbon arpeggiator
  private ribbonPos: number | null = null;
  private sliderPos = 0.5;
  private arpCountdown = 0;

  // song mode
  private mode: 'pattern' | 'song' = 'pattern';
  private song: Song | null = null;
  private songPatterns: Record<number, Pattern> = {};
  private songPos = 0;

  // motion recording accumulators, keyed `${target}:${paramId}`
  private motionRec = new Map<string, MotionSeq>();

  // scratch buses
  private busDryL = new Float32Array(BLOCK);
  private busDryR = new Float32Array(BLOCK);
  private busFxL = [new Float32Array(BLOCK), new Float32Array(BLOCK), new Float32Array(BLOCK)];
  private busFxR = [new Float32Array(BLOCK), new Float32Array(BLOCK), new Float32Array(BLOCK)];

  private levelMeterCountdown = 0;

  constructor(sr: number, post: (msg: FromEngine, transfer?: Transferable[]) => void) {
    this.sr = sr;
    this.post = post;
    this.clock = new SequencerClock(sr);
    SYNTH_PART_IDS.forEach((id, i) => this.synthVoices.set(id, new SynthVoice(sr, 100 + i)));
    DRUM_PART_IDS.forEach((id, i) => this.drumVoices.set(id, new DrumVoice(sr, 200 + i)));
    this.applyPattern(this.pattern);
    for (let s = 0; s < 3; s++) {
      this.fxSlots.push({ type: this.pattern.fx[s].type, proc: createFx(this.pattern.fx[s].type, sr) });
    }
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  handle(msg: ToEngine): void {
    switch (msg.t) {
      case 'LOAD_ROM':
        this.rom = msg.waves.map((data, i) => ({ name: `W${i}`, data }));
        break;
      case 'SELECT_PART':
        this.selectedPart = msg.partId;
        break;
      case 'SET_PATTERN':
        this.applyPattern(msg.pattern);
        break;
      case 'SET_NEXT_PATTERN':
        if (this.playing) {
          this.nextPattern = { pattern: msg.pattern, slot: msg.slot };
        } else {
          this.applyPattern(msg.pattern);
          this.patternSlot = msg.slot;
          this.post({ t: 'PATTERN_SWITCHED', slot: msg.slot });
        }
        break;
      case 'EDIT_STEP': {
        const part = this.getPart(msg.partId);
        if (part) part.steps[msg.step] = msg.data as Step;
        else if (msg.partId === 'ACC') this.pattern.accent.steps[msg.step] = { on: (msg.data as Step).on };
        break;
      }
      case 'SET_PARAM':
        this.setParam(msg.target, msg.paramId, msg.value);
        break;
      case 'SET_TEMPO':
        this.pattern.tempo = msg.bpm;
        this.clock.setTempo(msg.bpm);
        break;
      case 'SET_SWING':
        this.pattern.swing = msg.value;
        this.clock.swing = msg.value;
        break;
      case 'TRANSPORT':
        this.transport(msg.action);
        break;
      case 'NOTE_ON':
        this.noteOn(msg.partId, msg.note);
        break;
      case 'NOTE_OFF':
        this.noteOff(msg.partId);
        break;
      case 'TRIG':
        this.noteOn(msg.partId, 60);
        break;
      case 'RIBBON':
        this.ribbonPos = msg.value;
        if (msg.value === null) this.arpCountdown = 0;
        break;
      case 'SLIDER':
        this.sliderPos = msg.value;
        break;
      case 'MUTE': {
        const part = this.getPart(msg.partId);
        if (part) part.mute = msg.on;
        break;
      }
      case 'SOLO':
        this.solo = msg.partId;
        break;
      case 'SET_MOTION_MODE': {
        const part = this.getPart(msg.partId);
        if (part) part.motionMode = msg.mode;
        break;
      }
      case 'CLEAR_MOTION':
        this.pattern.motions.splice(msg.index, 1);
        break;
      case 'SET_SONG':
        this.song = msg.song;
        this.songPatterns = msg.patterns;
        this.songPos = 0;
        break;
      case 'SONG_POS':
        this.songPos = msg.position;
        break;
      case 'MODE':
        this.mode = msg.mode;
        if (msg.mode === 'song') this.songPos = 0;
        break;
    }
  }

  private getPart(id: PartId): { params: ParamMap; steps: (Step | { on: boolean })[]; mute: boolean; motionMode: 0 | 1 } | null {
    if ((SYNTH_PART_IDS as string[]).includes(id)) return this.pattern.synths[id as SynthPartId];
    if ((DRUM_PART_IDS as string[]).includes(id)) return this.pattern.drums[id as DrumPartId];
    return null;
  }

  private setParam(target: MotionTarget, paramId: string, value: number): void {
    if (target === 'MASTER') {
      if (paramId === 'masterVolume') this.masterVolume = value;
      else if (paramId === 'valveGain') this.valveGain = value;
      else if (paramId === 'accentLevel') this.pattern.accent.level = value;
      else if (paramId === 'swing') {
        this.pattern.swing = value;
        this.clock.swing = value;
      }
    } else if (target === 'FX1' || target === 'FX2' || target === 'FX3') {
      const slot = this.pattern.fx[Number(target[2]) - 1];
      if (paramId === 'type') slot.type = Math.round(value);
      else if (paramId === 'edit1') slot.edit1 = value;
      else if (paramId === 'edit2') slot.edit2 = value;
      else if (paramId === 'chain') slot.chain = value >= 0.5;
    } else {
      const part = this.getPart(target);
      if (part) part.params[paramId] = value;
    }
    // motion recording: sample knob writes while REC+PLAY
    if (this.recording && this.playing) this.touchMotionRec(target, paramId, value);
  }

  private applyPattern(p: Pattern): void {
    this.pattern = p;
    this.clock.setTempo(p.tempo);
    this.clock.setBeat(p.beat);
    this.clock.swing = p.swing;
    this.clock.totalSteps = stepsForPattern(p);
  }

  private transport(action: string): void {
    switch (action) {
      case 'play':
        if (!this.playing) {
          this.playing = true;
          this.clock.reset();
          this.pending = [];
          this.lastReportedStep = -1;
        }
        break;
      case 'pause':
        this.playing = false;
        this.releaseAll();
        break;
      case 'stop':
        this.playing = false;
        this.clock.reset();
        this.pending = [];
        this.releaseAll();
        this.flushMotionRec();
        this.post({ t: 'POSITION', step: 0, bar: 0, songPos: this.songPos, playing: false });
        break;
      case 'recOn':
        this.recording = true;
        break;
      case 'recOff':
        this.recording = false;
        this.flushMotionRec();
        break;
    }
  }

  private releaseAll(): void {
    for (const v of this.synthVoices.values()) v.noteOff();
    for (const v of this.drumVoices.values()) v.noteOff();
  }

  // -------------------------------------------------------------------------
  // Live input (keyboard / pads / ribbon)
  // -------------------------------------------------------------------------

  private noteOn(partId: PartId, note: number): void {
    if (partId === 'ACC') return;
    this.heldNotes.set(partId, note);
    // live triggers can arrive before the first render populated the
    // effective-params overlay — make sure it exists now
    this.refreshEffectiveParams();
    const gate = this.playing ? Math.floor(this.clock.samplesPerStep * 0.95) : this.sr * 4;
    this.triggerPart(partId, note, gate, false, 0);
    // realtime record: quantize to nearest step
    if (this.recording && this.playing) {
      const total = this.clock.totalSteps;
      const step = Math.round(this.clock.stepFloat) % total;
      const part = this.getPart(partId);
      if (part) {
        const data: Step = { on: true, note, gate: 0.75 };
        part.steps[step] = (SYNTH_PART_IDS as string[]).includes(partId) ? data : ({ on: true } as Step);
        this.post({ t: 'RECORDED', partId, step, data: part.steps[step] as Step });
      }
    }
  }

  private noteOff(partId: PartId): void {
    this.heldNotes.delete(partId);
    const sv = this.synthVoices.get(partId as SynthPartId);
    if (sv) sv.noteOff();
  }

  /** Trigger a part's voice now (offset 0) or store for sub-block trigger handling. */
  private triggerPart(partId: PartId, note: number, gateSamples: number, accented: boolean, _offset: number): void {
    const rollInterval = Math.max(32, Math.floor(this.clock.samplesPerStep / 2));
    const info: TriggerInfo = {
      note,
      gateSamples,
      accented,
      accentLevel: this.pattern.accent.level,
      rollInterval,
    };
    const sv = this.synthVoices.get(partId as SynthPartId);
    if (sv) {
      sv.trigger(this.eff(partId), info);
      return;
    }
    const dv = this.drumVoices.get(partId as DrumPartId);
    if (dv) {
      const waveId = Math.round(this.eff(partId).waveId ?? 0);
      dv.trigger(this.eff(partId), info, this.rom[waveId] ?? null);
    }
  }

  // -------------------------------------------------------------------------
  // Motion sequences
  // -------------------------------------------------------------------------

  private touchMotionRec(target: MotionTarget, paramId: string, value: number): void {
    const key = `${target}:${paramId}`;
    let m = this.motionRec.get(key);
    if (!m) {
      m = {
        target,
        paramId,
        values: new Array(this.clock.totalSteps).fill(value) as number[],
        mask: new Array(this.clock.totalSteps).fill(false) as boolean[],
      };
      this.motionRec.set(key, m);
    }
    const step = Math.floor(this.clock.stepFloat) % this.clock.totalSteps;
    m.values[step] = value;
    m.mask[step] = true;
  }

  private flushMotionRec(): void {
    for (const m of this.motionRec.values()) {
      if (!m.mask.some(Boolean)) continue;
      // merge into pattern motions (replace same target+param)
      const idx = this.pattern.motions.findIndex((x) => x.target === m.target && x.paramId === m.paramId);
      if (idx >= 0) this.pattern.motions[idx] = m;
      else if (this.pattern.motions.length < 24) this.pattern.motions.push(m);
      this.post({ t: 'MOTION_RECORDED', motion: m });
    }
    this.motionRec.clear();
  }

  /** Effective params for a part: base params + motion overlay (computed per block). */
  private eff(partId: MotionTarget): ParamMap {
    let ep = this.effParams.get(partId);
    if (!ep) {
      ep = {};
      this.effParams.set(partId, ep);
    }
    return ep;
  }

  private motionValue(m: MotionSeq, stepFloat: number, smooth: boolean): number {
    const total = this.clock.totalSteps;
    const cur = Math.floor(stepFloat) % total;
    // find value at/before cur (hold)
    const valueAt = (s: number): number => {
      for (let k = 0; k < total; k++) {
        const idx = (s - k + total) % total;
        if (m.mask[idx]) return m.values[idx];
      }
      return m.values[cur] ?? 0;
    };
    const v0 = valueAt(cur);
    if (!smooth) return v0;
    // next recorded value after cur
    let nextIdx = -1;
    for (let k = 1; k <= total; k++) {
      const idx = (cur + k) % total;
      if (m.mask[idx]) {
        nextIdx = k;
        break;
      }
    }
    if (nextIdx === -1) return v0;
    const v1 = m.values[(cur + nextIdx) % total];
    const frac = (stepFloat - Math.floor(stepFloat)) / nextIdx;
    return v0 + (v1 - v0) * frac;
  }

  /** Rebuild effective params for every part + FX from base + motions. */
  private refreshEffectiveParams(): void {
    const stepFloat = this.playing ? this.clock.stepFloat : 0;
    for (const id of SYNTH_PART_IDS) Object.assign(this.eff(id), this.pattern.synths[id].params);
    for (const id of DRUM_PART_IDS) Object.assign(this.eff(id), this.pattern.drums[id].params);
    for (let s = 0; s < 3; s++) {
      const slot = this.pattern.fx[s];
      const ep = this.eff(`FX${s + 1}` as MotionTarget);
      ep.edit1 = slot.edit1;
      ep.edit2 = slot.edit2;
    }
    if (!this.playing) return;
    for (const m of this.pattern.motions) {
      const part = this.getPart(m.target as PartId);
      const smooth = part ? part.motionMode === 0 : true;
      const v = this.motionValue(m, stepFloat, smooth);
      this.eff(m.target)[m.paramId] = v;
    }
    // while recording, the live knob value wins over motion playback
    for (const m of this.motionRec.values()) {
      const step = Math.floor(stepFloat) % this.clock.totalSteps;
      if (m.mask[step]) this.eff(m.target)[m.paramId] = m.values[step];
    }
  }

  // -------------------------------------------------------------------------
  // Sequencer stepping
  // -------------------------------------------------------------------------

  private scheduleStep(step: number, time: number): void {
    const accented = this.pattern.accent.steps[step]?.on ?? false;
    const swing = this.clock.swingDelay(step);
    for (const id of SYNTH_PART_IDS) {
      const part = this.pattern.synths[id];
      const st = part.steps[step];
      if (!st?.on || part.mute) continue;
      if (this.solo && this.solo !== id) continue;
      this.pending.push({
        time: time + swing,
        partId: id,
        note: st.note,
        gateSamples: Math.max(64, Math.floor(st.gate * this.clock.samplesPerStep)),
        accented,
      });
    }
    for (const id of DRUM_PART_IDS) {
      const part = this.pattern.drums[id];
      const st = part.steps[step];
      if (!st?.on || part.mute) continue;
      if (this.solo && this.solo !== id) continue;
      this.pending.push({
        time: time + swing,
        partId: id,
        note: 60,
        gateSamples: Math.floor(this.clock.samplesPerStep * 0.95),
        accented,
      });
    }
    // ribbon arp: retrigger the selected part each step while touched
    if (this.ribbonPos !== null) this.scheduleArp(time + swing);
  }

  private scheduleArp(time: number): void {
    const pos = this.ribbonPos;
    if (pos === null) return;
    const partId = this.selectedPart;
    if (partId === 'ACC') return;
    const gate = Math.max(48, Math.floor(this.clock.samplesPerStep * clamp(this.sliderPos, 0.05, 1)));
    let note = 60;
    if ((SYNTH_PART_IDS as string[]).includes(partId)) {
      const scale = SCALES[this.pattern.arp.scale % SCALES.length];
      const span = 2 * scale.length; // +/- one octave of scale degrees
      const degree = Math.round((pos - 0.5) * span);
      const oct = Math.floor(degree / scale.length);
      const idx = ((degree % scale.length) + scale.length) % scale.length;
      note = this.pattern.arp.centerNote + this.pattern.arp.key + oct * 12 + scale[idx];
    }
    this.pending.push({ time, partId, note, gateSamples: gate, accented: false });
  }

  private onPatternEnd(): void {
    this.flushMotionRec();
    if (this.mode === 'song' && this.song) {
      this.songPos++;
      const ev = this.song.events[this.songPos];
      if (!ev) {
        this.playing = false;
        this.releaseAll();
        this.post({ t: 'SONG_ENDED' });
        return;
      }
      const p = this.songPatterns[ev.patternSlot];
      if (p) {
        this.applyPattern(p);
        for (const partId of ev.mutes) {
          const part = this.getPart(partId);
          if (part) part.mute = true;
        }
      }
      this.post({ t: 'PATTERN_SWITCHED', slot: ev.patternSlot });
      return;
    }
    if (this.nextPattern) {
      this.applyPattern(this.nextPattern.pattern);
      this.patternSlot = this.nextPattern.slot;
      this.post({ t: 'PATTERN_SWITCHED', slot: this.patternSlot });
      this.nextPattern = null;
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  render(outL: Float32Array, outR: Float32Array): void {
    const n = outL.length;
    this.busDryL.fill(0);
    this.busDryR.fill(0);
    for (let s = 0; s < 3; s++) {
      this.busFxL[s].fill(0);
      this.busFxR[s].fill(0);
    }

    const blockStart = this.clock.position;

    if (this.playing) {
      const boundaries = this.clock.advance(n);
      for (const b of boundaries) {
        if (b.wrapped) this.onPatternEnd();
        this.scheduleStep(b.step % this.clock.totalSteps, b.time);
        const step = b.step % this.clock.totalSteps;
        if (step !== this.lastReportedStep) {
          this.lastReportedStep = step;
          const spb = STEPS_PER_BAR[this.pattern.beat];
          this.post({
            t: 'POSITION',
            step: step % spb,
            bar: Math.floor(step / spb),
            songPos: this.songPos,
            playing: true,
          });
        }
      }
      // standalone arp retrigger between steps is unnecessary: steps cover it
    } else if (this.ribbonPos !== null) {
      // arp while stopped: self-clocked at the step rate
      this.arpCountdown -= n;
      if (this.arpCountdown <= 0) {
        this.arpCountdown = this.clock.samplesPerStep;
        this.scheduleArp(blockStart);
      }
    }

    this.refreshEffectiveParams();

    // fire pending triggers due in this block, splitting rendering at offsets
    const blockEnd = blockStart + n;
    const due = this.pending.filter((p) => p.time < blockEnd);
    this.pending = this.pending.filter((p) => p.time >= blockEnd);
    due.sort((a, b) => a.time - b.time);

    const cuts = [0];
    for (const p of due) {
      const off = clamp(Math.floor(p.time - blockStart), 0, n - 1);
      if (off > 0 && cuts[cuts.length - 1] !== off) cuts.push(off);
    }
    cuts.push(n);

    let dueIdx = 0;
    for (let c = 0; c < cuts.length - 1; c++) {
      const from = cuts[c];
      const to = cuts[c + 1];
      // apply triggers landing at `from`
      while (dueIdx < due.length) {
        const off = clamp(Math.floor(due[dueIdx].time - blockStart), 0, n - 1);
        if (off > from) break;
        const p = due[dueIdx++];
        this.triggerPart(p.partId, p.note, p.gateSamples, p.accented, off);
      }
      this.renderSegment(from, to);
    }

    // FX processing with chain routing
    const bpm = this.clock.bpm;
    for (let s = 0; s < 3; s++) {
      const slot = this.pattern.fx[s];
      let state = this.fxSlots[s];
      if (state.type !== slot.type) {
        state = { type: slot.type, proc: createFx(slot.type, this.sr) };
        this.fxSlots[s] = state;
      }
      const ep = this.eff(`FX${s + 1}` as MotionTarget);
      const e1 = ep.edit1 ?? slot.edit1;
      const e2 = ep.edit2 ?? slot.edit2;
      state.proc.process(this.busFxL[s], this.busFxR[s], 0, n, e1, e2, bpm);
      if (slot.chain && s < 2) {
        for (let i = 0; i < n; i++) {
          this.busFxL[s + 1][i] += this.busFxL[s][i];
          this.busFxR[s + 1][i] += this.busFxR[s][i];
        }
      } else {
        for (let i = 0; i < n; i++) {
          this.busDryL[i] += this.busFxL[s][i];
          this.busDryR[i] += this.busFxR[s][i];
        }
      }
    }

    // valve + master
    this.valve.process(this.busDryL, this.busDryR, 0, n, this.valveGain);
    const master = mapLevel(this.masterVolume) * 1.4;
    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < n; i++) {
      const l = clamp(this.busDryL[i] * master, -1.5, 1.5);
      const r = clamp(this.busDryR[i] * master, -1.5, 1.5);
      outL[i] = l;
      outR[i] = r;
      peakL = Math.max(peakL, Math.abs(l));
      peakR = Math.max(peakR, Math.abs(r));
    }

    this.levelMeterCountdown -= n;
    if (this.levelMeterCountdown <= 0) {
      this.levelMeterCountdown = this.sr / 15;
      this.post({ t: 'LEVELS', l: peakL, r: peakR });
    }
  }

  private renderSegment(from: number, to: number): void {
    const bpm = this.clock.bpm;
    for (const id of SYNTH_PART_IDS) {
      const voice = this.synthVoices.get(id);
      if (!voice?.active) continue;
      const part = this.pattern.synths[id];
      const ep = this.eff(id);
      const useFx = ep.fxOn >= 0.5;
      const fxIdx = clamp(Math.round(ep.fxSend), 0, 2);
      const l = useFx ? this.busFxL[fxIdx] : this.busDryL;
      const r = useFx ? this.busFxR[fxIdx] : this.busDryR;
      if (part.mute || (this.solo && this.solo !== id)) continue;
      voice.render(ep, bpm, l, r, from, to);
    }
    for (const id of DRUM_PART_IDS) {
      const voice = this.drumVoices.get(id);
      if (!voice?.active) continue;
      const part = this.pattern.drums[id];
      const ep = this.eff(id);
      const useFx = ep.fxOn >= 0.5;
      const fxIdx = clamp(Math.round(ep.fxSend), 0, 2);
      const l = useFx ? this.busFxL[fxIdx] : this.busDryL;
      const r = useFx ? this.busFxR[fxIdx] : this.busDryR;
      if (part.mute || (this.solo && this.solo !== id)) continue;
      voice.render(ep, bpm, l, r, from, to);
    }
  }
}
