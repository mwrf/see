/** Session restore: reload working pattern + global settings from IndexedDB. */

import { loadWorkingPattern, readGlobal } from './data/persist';
import type { Engine } from './engine/audio-context';
import { clonePattern } from './shared/model';
import { store } from './state/store';

export async function loadGlobal(): Promise<void> {
  const g = await readGlobal();
  if (g) {
    store.update(['ui', 'params'], (s) => {
      s.global = { ...s.global, ...g };
    });
  }
}

export async function restoreSession(engine: Engine): Promise<void> {
  const restored = await loadWorkingPattern();
  if (restored) {
    store.update(['pattern', 'steps', 'ui', 'params'], (s) => {
      s.pattern = restored.pattern;
      s.patternSlot = restored.slot;
    });
    engine.send({ t: 'SET_PATTERN', pattern: clonePattern(restored.pattern) });
  } else {
    engine.send({ t: 'SET_PATTERN', pattern: clonePattern(store.get().pattern) });
  }
  const g = store.get().global;
  engine.send({ t: 'SET_PARAM', target: 'MASTER', paramId: 'masterVolume', value: g.masterVolume });
  engine.send({ t: 'SET_PARAM', target: 'MASTER', paramId: 'valveGain', value: g.valveGain });
  engine.send({ t: 'SET_PARAM', target: 'MASTER', paramId: 'masterTune', value: 64 + ((g.masterTune ?? 0) / 50) * 63 });
}
