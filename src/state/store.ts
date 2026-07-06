/**
 * Single app store with coarse-topic pub/sub. Mutators publish the topics
 * they touched; components subscribe to topics ('pattern', 'playhead',
 * 'param:<id>:<target>', 'ui', 'transport', ...).
 */

import type { GlobalSettings, PartId, Pattern, Song } from '../shared/model';
import { createDefaultGlobal, createDefaultPattern } from '../shared/model';

export type StepKeyMode = 'trig' | 'keyboard' | 'mute' | 'solo' | 'patternSet';
export type ShiftState = 'off' | 'latched' | 'locked';
export type AppMode = 'pattern' | 'song' | 'global';

export interface AppState {
  audioStarted: boolean;
  pattern: Pattern; // working pattern (edit buffer)
  patternSlot: number;
  patternDirty: boolean;
  selectedPart: PartId;
  stepKeyMode: StepKeyMode;
  page: number; // bar page shown on the 16 step keys
  keyboardOctave: number; // index into KEYBOARD_RANGES (8 positions, like hardware)
  playhead: { playing: boolean; step: number; bar: number; songPos: number };
  recording: boolean;
  mode: AppMode;
  song: Song | null;
  songSlot: number;
  shift: ShiftState;
  global: GlobalSettings;
  lcd: { line1: string; line2: string; flash?: string };
  levels: { l: number; r: number };
  drumNames: string[];
}

export function createInitialState(): AppState {
  return {
    audioStarted: false,
    pattern: createDefaultPattern(),
    patternSlot: 0,
    patternDirty: false,
    selectedPart: 'D1',
    stepKeyMode: 'trig',
    page: 0,
    keyboardOctave: 4, // A3…C5, around middle C

    playhead: { playing: false, step: 0, bar: 0, songPos: 0 },
    recording: false,
    mode: 'pattern',
    song: null,
    songSlot: 0,
    shift: 'off',
    global: createDefaultGlobal(),
    lcd: { line1: 'ELECTRIBE MX', line2: 'WEB EDITION' },
    levels: { l: 0, r: 0 },
    drumNames: [],
  };
}

type Listener = () => void;

class Store {
  private state = createInitialState();
  private subs = new Map<string, Set<Listener>>();
  private pendingTopics = new Set<string>();
  private notifyQueued = false;

  get(): AppState {
    return this.state;
  }

  /** Mutate state synchronously and publish the given topics (async, batched). */
  update(topics: string[], mutator: (s: AppState) => void): void {
    mutator(this.state);
    for (const t of topics) this.pendingTopics.add(t);
    if (!this.notifyQueued) {
      this.notifyQueued = true;
      queueMicrotask(() => this.flush());
    }
  }

  /** Same as update but notifies synchronously (for engine-bridge ordering). */
  updateSync(topics: string[], mutator: (s: AppState) => void): void {
    mutator(this.state);
    for (const t of topics) this.pendingTopics.add(t);
    this.flush();
  }

  private flush(): void {
    this.notifyQueued = false;
    const topics = [...this.pendingTopics];
    this.pendingTopics.clear();
    const fired = new Set<Listener>();
    for (const t of topics) {
      const set = this.subs.get(t);
      if (!set) continue;
      for (const cb of set) {
        if (!fired.has(cb)) {
          fired.add(cb);
          cb();
        }
      }
    }
  }

  subscribe(topic: string, cb: Listener): () => void {
    let set = this.subs.get(topic);
    if (!set) {
      set = new Set();
      this.subs.set(topic, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }
}

export const store = new Store();
