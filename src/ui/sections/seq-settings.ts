/**
 * Sequencer / data menu: step-key modes (STEP EDIT / KEYBOARD / PART MUTE /
 * PATTERN SET), octave shift, pattern navigation, motion seq controls, and
 * file export/import. (Tempo / beat / length / write live next to the LCD.)
 */

import { exportAll, exportPattern, parseImport, pickFile } from '../../data/file-io';
import {
  readAllPatterns,
  readAllSongs,
  wipeAll,
  writeGlobal,
  writePatternSlot,
} from '../../data/persist';
import {
  clearMotion,
  formatSlot,
  loadPattern,
  setLcd,
  setMotionMode,
  setStepKeyMode,
  shiftOctave,
} from '../../state/actions';
import { store, type StepKeyMode } from '../../state/store';
import { MOTION_MODE_NAMES } from '../../shared/params';
import { createButton, type PanelButton } from '../controls/button';
import { row, section } from './helpers';

export function createSeqSettings(): HTMLElement {
  const { el, body } = section('SEQUENCER', 'sec-seq');

  // --- step key modes
  const modeRow = row('seq-row');
  const modeButtons = new Map<StepKeyMode, PanelButton>();
  const modes: [StepKeyMode, string][] = [
    ['trig', 'STEP EDIT'],
    ['keyboard', 'KEYBOARD'],
    ['mute', 'PART MUTE'],
    ['patternSet', 'PATTERN SET'],
  ];
  for (const [mode, label] of modes) {
    const btn = createButton({ label, led: true, className: 'pbtn-sm', onPress: () => setStepKeyMode(mode) });
    modeButtons.set(mode, btn);
    modeRow.appendChild(btn.el);
  }

  const octRow = row('seq-row');
  octRow.append(
    createButton({ label: 'OCT −', className: 'pbtn-sm', onPress: () => shiftOctave(-1) }).el,
    createButton({ label: 'OCT +', className: 'pbtn-sm', onPress: () => shiftOctave(1) }).el,
  );

  // --- pattern navigation
  const ptnRow = row('seq-row');
  const prevPtn = createButton({
    label: '◀ PTN',
    className: 'pbtn-sm',
    onPress: () => void loadPattern(Math.max(0, store.get().patternSlot - 1)),
  });
  const nextPtn = createButton({
    label: 'PTN ▶',
    className: 'pbtn-sm',
    onPress: () => void loadPattern(Math.min(255, store.get().patternSlot + 1)),
  });
  ptnRow.append(prevPtn.el, nextPtn.el);

  // --- motion seq
  const motionRow = row('seq-row');
  const motionModeBtn = createButton({
    label: 'MOTION MODE',
    className: 'pbtn-sm',
    onPress: () => {
      const s = store.get();
      if (s.selectedPart === 'ACC') return;
      const cur =
        s.selectedPart in s.pattern.synths
          ? s.pattern.synths[s.selectedPart as never]['motionMode' as never]
          : s.pattern.drums[s.selectedPart as never]['motionMode' as never];
      const next = (Number(cur) === 0 ? 1 : 0) as 0 | 1;
      setMotionMode(s.selectedPart, next);
      setLcd('MOTION MODE', MOTION_MODE_NAMES[next]);
    },
  });
  const motionClearBtn = createButton({
    label: 'CLR MOTION',
    className: 'pbtn-sm',
    onPress: () => {
      const s = store.get();
      const idxs = s.pattern.motions
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.target === s.selectedPart)
        .map(({ i }) => i)
        .reverse();
      if (idxs.length === 0 && s.pattern.motions.length > 0) idxs.push(s.pattern.motions.length - 1);
      idxs.forEach((i) => clearMotion(i));
      setLcd('MOTION SEQ', idxs.length ? 'CLEARED' : 'EMPTY');
    },
  });
  motionRow.append(motionModeBtn.el, motionClearBtn.el);

  // --- data (export / import)
  const dataRow = row('seq-row');
  const exportBtn = createButton({
    label: 'EXPORT',
    className: 'pbtn-sm',
    onPress: () => {
      void (async () => {
        const s = store.get();
        const patterns = await readAllPatterns();
        patterns[s.patternSlot] = s.pattern; // include the working buffer
        const songs = await readAllSongs();
        exportAll(patterns, songs, s.global);
        setLcd('EXPORT', 'ALL DATA');
      })();
    },
    onLongPress: () => {
      exportPattern(store.get().pattern);
      setLcd('EXPORT', 'PATTERN');
    },
  });
  const importBtn = createButton({
    label: 'IMPORT',
    className: 'pbtn-sm',
    onPress: () => {
      void (async () => {
        const text = await pickFile('.json,.emxweb.json,.emxpat.json');
        if (!text) return;
        try {
          const parsed = parseImport(text);
          if (parsed.kind === 'pattern') {
            store.update(['pattern', 'steps', 'ui', 'lcd'], (s) => {
              s.pattern = parsed.pattern;
              s.patternDirty = true;
            });
            const { clonePattern } = await import('../../shared/model');
            const { getEngine } = await import('../../engine/audio-context');
            getEngine()?.send({ t: 'SET_PATTERN', pattern: clonePattern(parsed.pattern) });
            setLcd('IMPORT', 'PATTERN OK');
          } else {
            await wipeAll();
            for (let i = 0; i < parsed.file.patterns.length; i++) {
              const p = parsed.file.patterns[i];
              if (p) await writePatternSlot(i, p);
            }
            const { writeSongSlot } = await import('../../data/persist');
            for (let i = 0; i < parsed.file.songs.length; i++) {
              const song = parsed.file.songs[i];
              if (song) await writeSongSlot(i, song);
            }
            await writeGlobal(parsed.file.global);
            store.update(['ui', 'lcd'], (s) => {
              s.global = parsed.file.global;
            });
            setLcd('IMPORT', 'ALL DATA OK');
          }
        } catch (err) {
          setLcd('IMPORT ERROR', String((err as Error).message).slice(0, 20));
        }
      })();
    },
  });
  dataRow.append(exportBtn.el, importBtn.el);

  function refresh(): void {
    const s = store.get();
    for (const [mode, btn] of modeButtons) btn.setLed(s.stepKeyMode === mode, 'red');
    prevPtn.el.title = nextPtn.el.title = `pattern ${formatSlot(s.patternSlot)}`;
  }
  ['ui', 'pattern', 'transport', 'steps'].forEach((t) => store.subscribe(t, refresh));
  refresh();

  body.append(modeRow, octRow, ptnRow, motionRow, dataRow);
  return el;
}
