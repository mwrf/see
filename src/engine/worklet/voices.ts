/**
 * Synth and drum part voices. Each part owns one mono voice (like the EMX).
 * Voices render additively into stereo bus buffers; the core decides which bus.
 */

import { clamp, noteToFreq, panGains } from '../../shared/math';
import type { ParamMap } from '../../shared/model';
import {
  LFO_SYNC_DIVS,
  mapCutoff,
  mapEgTime,
  mapGlide,
  mapLevel,
  mapLfoSpeed,
  mapResonance,
  mapSemis,
} from '../../shared/params';
import { AmpEnv, DecayEnv, Lfo, Smoother, Svf } from './dsp';
import type { DrumWave } from './drum-rom';
import { Oscillator } from './osc';

export interface TriggerInfo {
  note: number;
  gateSamples: number;
  accented: boolean;
  accentLevel: number; // 0..127
  /** roll retrigger interval in samples (0 = no roll even if param on) */
  rollInterval: number;
}

abstract class BaseVoice {
  protected svf: Svf;
  protected ampEnv: AmpEnv;
  protected filterEnv = new DecayEnv();
  protected lfo: Lfo;
  protected cutoffSmooth: Smoother;
  protected accentGain = 1;
  protected gateRemaining = 0;
  protected rollInterval = 0;
  protected rollCountdown = 0;

  constructor(protected sr: number, lfoSeed: number) {
    this.svf = new Svf(sr);
    this.ampEnv = new AmpEnv(sr);
    this.lfo = new Lfo(lfoSeed);
    this.cutoffSmooth = new Smoother(sr, 0.004, 127);
  }

  get active(): boolean {
    return this.ampEnv.active;
  }

  noteOff(): void {
    this.gateRemaining = 0;
    this.ampEnv.release();
  }

  protected lfoFreq(p: ParamMap, bpm: number): number {
    if (p.lfoBpmSync >= 0.5) {
      const div = LFO_SYNC_DIVS[clamp(Math.round((p.lfoSpeed / 127) * (LFO_SYNC_DIVS.length - 1)), 0, LFO_SYNC_DIVS.length - 1)];
      return bpm / 60 / div.beats;
    }
    return mapLfoSpeed(p.lfoSpeed);
  }

  protected startCommon(p: ParamMap, t: TriggerInfo): void {
    const decay = mapEgTime(p.egTime);
    this.ampEnv.trigger(decay, p.ampEg >= 0.5, this.sr);
    this.filterEnv.trigger(decay, this.sr);
    if (p.lfoKeySync >= 0.5) this.lfo.sync();
    this.accentGain = t.accented && p.accent >= 0.5 ? 1 + (t.accentLevel / 127) * 0.9 : 1;
    this.gateRemaining = t.gateSamples;
    this.rollInterval = p.roll >= 0.5 ? t.rollInterval : 0;
    this.rollCountdown = this.rollInterval;
  }

  /** Handle gate countdown + roll retrigger; call once per sample. */
  protected tickGate(p: ParamMap): void {
    if (this.gateRemaining > 0) {
      this.gateRemaining--;
      if (this.rollInterval > 0 && --this.rollCountdown <= 0) {
        this.rollCountdown = this.rollInterval;
        const decay = mapEgTime(p.egTime);
        this.ampEnv.trigger(decay, p.ampEg >= 0.5, this.sr);
        this.filterEnv.trigger(decay, this.sr);
        this.onRollRetrigger();
      }
      if (this.gateRemaining === 0) this.ampEnv.release();
    }
  }

  protected onRollRetrigger(): void {}
}

export class SynthVoice extends BaseVoice {
  private osc: Oscillator;
  private curNote = 60;
  private targetNote = 60;
  private glideCoef = 0; // per-sample approach

  constructor(sr: number, seed: number) {
    super(sr, seed);
    this.osc = new Oscillator(sr, seed * 31 + 7);
  }

  trigger(p: ParamMap, t: TriggerInfo): void {
    this.targetNote = t.note;
    const glide = mapGlide(p.glide);
    if (glide < 0.001 || !this.active) {
      this.curNote = t.note;
      this.glideCoef = 0;
    } else {
      this.glideCoef = 1 - Math.exp(-1 / (glide * this.sr));
    }
    if (!this.active) this.osc.reset();
    this.startCommon(p, t);
  }

  render(p: ParamMap, bpm: number, outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    const lfoF = this.lfoFreq(p, bpm);
    const lfoWave = Math.round(p.lfoWave);
    const lfoDepth = p.lfoDepth / 127;
    const lfoDest = Math.round(p.lfoDest);
    const tune = mapSemis(p.tune);
    const oscType = Math.round(p.oscType);
    const level = mapLevel(p.level) * this.accentGain;
    const egInt = (p.egInt - 64) / 63; // -1..1
    const q = mapResonance(p.resonance);
    const fType = Math.round(p.filterType);

    for (let i = from; i < to; i++) {
      this.tickGate(p);
      const lfoV = this.lfo.next(lfoF, lfoWave, this.sr) * lfoDepth;
      // glide
      if (this.glideCoef > 0) this.curNote += (this.targetNote - this.curNote) * this.glideCoef;
      else this.curNote = this.targetNote;

      let note = this.curNote + tune;
      let e1 = p.oscEdit1;
      let ampMod = 1;
      let panMod = 0;
      let cutMod = 0;
      switch (lfoDest) {
        case 0:
          note += lfoV * 7;
          break;
        case 1:
          e1 = clamp(e1 + lfoV * 64, 0, 127);
          break;
        case 2:
          cutMod = lfoV * 64;
          break;
        case 3:
          ampMod = clamp(1 + lfoV, 0, 2);
          break;
        default:
          panMod = lfoV;
      }

      const freq = noteToFreq(note);
      let s = this.osc.sample(oscType, freq, e1, p.oscEdit2, this.sr);

      const fEnv = this.filterEnv.next();
      const cutKnob = this.cutoffSmooth.next(p.cutoff);
      const cutoff = mapCutoff(clamp(cutKnob + cutMod + egInt * fEnv * 96, 0, 127));
      this.svf.set(cutoff, q);
      s = this.svf.process(s, fType);

      const amp = this.ampEnv.next() * level * ampMod;
      const [gl, gr] = panGains((p.pan - 64) / 63 + panMod);
      outL[i] += s * amp * gl;
      outR[i] += s * amp * gr;
    }
  }
}

export class DrumVoice extends BaseVoice {
  private wave: DrumWave | null = null;
  private pos = 0;
  private rate = 1;
  private playing = false;

  constructor(sr: number, seed: number) {
    super(sr, seed);
  }

  trigger(p: ParamMap, t: TriggerInfo, wave: DrumWave | null): void {
    this.wave = wave;
    this.pos = 0;
    this.playing = wave !== null;
    this.rate = Math.pow(2, (mapSemis(p.pitch) + (t.note - 60)) / 12);
    this.startCommon(p, t);
  }

  override get active(): boolean {
    return this.playing && (this.ampEnv.active || this.gateRemaining > 0);
  }

  protected override onRollRetrigger(): void {
    this.pos = 0;
  }

  render(p: ParamMap, bpm: number, outL: Float32Array, outR: Float32Array, from: number, to: number): void {
    if (!this.active || !this.wave) return;
    const data = this.wave.data;
    const lfoF = this.lfoFreq(p, bpm);
    const lfoWave = Math.round(p.lfoWave);
    const lfoDepth = p.lfoDepth / 127;
    const lfoDest = Math.round(p.lfoDest);
    const level = mapLevel(p.level) * this.accentGain;
    const egInt = (p.egInt - 64) / 63;
    const q = mapResonance(p.resonance);
    const fType = Math.round(p.filterType);
    const gateMode = p.ampEg < 0.5;

    for (let i = from; i < to; i++) {
      this.tickGate(p);
      const lfoV = this.lfo.next(lfoF, lfoWave, this.sr) * lfoDepth;
      let rate = this.rate;
      let ampMod = 1;
      let panMod = 0;
      let cutMod = 0;
      switch (lfoDest) {
        case 0:
          rate *= Math.pow(2, (lfoV * 7) / 12);
          break;
        case 2:
          cutMod = lfoV * 64;
          break;
        case 3:
          ampMod = clamp(1 + lfoV, 0, 2);
          break;
        case 4:
          panMod = lfoV;
          break;
      }

      const i0 = this.pos | 0;
      if (i0 >= data.length - 1) {
        this.playing = false;
        this.ampEnv.kill();
        return;
      }
      const frac = this.pos - i0;
      let s = data[i0] + (data[i0 + 1] - data[i0]) * frac;
      this.pos += rate;

      const fEnv = this.filterEnv.next();
      const cutKnob = this.cutoffSmooth.next(p.cutoff);
      const cutoff = mapCutoff(clamp(cutKnob + cutMod + egInt * fEnv * 96, 0, 127));
      this.svf.set(cutoff, q);
      s = this.svf.process(s, fType);

      // In gate mode the sample plays through at full level (envelope only shapes
      // the tail via release); in decay mode EG TIME shortens/reshapes it.
      const env = this.ampEnv.next();
      const amp = (gateMode ? Math.max(env, this.gateRemaining > 0 ? 1 : env) : env) * level * ampMod;
      const [gl, gr] = panGains((p.pan - 64) / 63 + panMod);
      outL[i] += s * amp * gl;
      outR[i] += s * amp * gr;
    }
  }
}
