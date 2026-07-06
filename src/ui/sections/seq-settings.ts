/**
 * Sequencer / data menu: step-key modes (STEP EDIT / KEYBOARD / PART MUTE /
 * SOLO / PATTERN SET), octave shift, transpose, pattern navigation, pattern
 * operations (clear/copy/shift/move), motion seq controls, roll type, last
 * step, arp scale, and file export/import.
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
  clearPart,
  clearPattern,
  clearSolo,
  copyPart,
  cycleArpScale,
  formatSlot,
  getTranspose,
  isDrumPart,
  isSynthPart,
  loadPattern,
  moveData,
  renamePattern,
  setLastStep,
  setLcd,
  setMotionMode,
  setRollType,
  setStepKeyMode,
  setTranspose,
  shiftNotes,
  shiftOctave,
  toggleProtect,
} from '../../state/actions';
import { store, type StepKeyMode } from '../../state/store';
import { MOTION_MODE_NAMES } from '../../shared/params';
import type { DrumPartId, PartId, SynthPartId } from '../../shared/model';
import { DRUM_PART_IDS, SYNTH_PART_IDS } from '../../shared/model';
import { createButton, type PanelButton } from '../controls/button';
import { row, section } from './helpers';

function nextPartOf(id: PartId): PartId {
  if (isSynthPart(id)) {
    const i = SYNTH_PART_IDS.indexOf(id as SynthPartId);
    return SYNTH_PART_IDS[(i + 1) % SYNTH_PART_IDS.length];
  }
  if (isDrumPart(id)) {
    const i = DRUM_PART_IDS.indexOf(id as DrumPartId);
    return DRUM_PART_IDS[(i + 1) % DRUM_PART_IDS.length];
  }
  return id;
}

export function createSeqSettings(): HTMLElement {
  const { el, body } = section('SEQUENCER', 'sec-seq');

  // --- step key modes
  const modeRow = row('seq-row');
  const modeButtons = new Map<StepKeyMode, PanelButton>();
  const modes: [StepKeyMode, string][] = [
    ['trig', 'STEP EDIT'],
    ['keyboard', 'KEYBOARD'],
    ['mute', 'PART MUTE'],
    ['solo', 'SOLO'],
    ['patternSet', 'PATTERN SET'],
  ];
  for (const [mode, label] of modes) {
    const btn = createButton({
      label,
      led: true,
      className: 'pbtn-sm',
      onPress: () => setStepKeyMode(mode),
      onLongPress: mode === 'solo' ? () => clearSolo() : undefined,
    });
    modeButtons.set(mode, btn);
    modeRow.appendChild(btn.el);
  }

  const octRow = row('seq-row');
  octRow.append(
    createButton({ label: 'OCT −', className: 'pbtn-sm', onPress: () => shiftOctave(-1) }).el,
    createButton({ label: 'OCT +', className: 'pbtn-sm', onPress: () => shiftOctave(1) }).el,
    createButton({ label: 'TRANS −', className: 'pbtn-sm', onPress: () => setTranspose(getTranspose() - 1) }).el,
    createButton({ label: 'TRANS +', className: 'pbtn-sm', onPress: () => setTranspose(getTranspose() + 1) }).el,
  );

  // --- pattern navigation + settings
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
  const renameBtn = createButton({
    label: 'RENAME',
    className: 'pbtn-sm',
    onPress: () => {
      const name = window.prompt('Pattern name (8 chars):', store.get().pattern.name);
      if (name !== null) renamePattern(name);
    },
  });
  ptnRow.append(prevPtn.el, nextPtn.el, renameBtn.el);

  const setupRow = row('seq-row');
  const rollBtn = createButton({
    label: 'ROLL TYPE',
    className: 'pbtn-sm',
    onPress: () => {
      const cur = store.get().pattern.rollType;
      setRollType(cur >= 4 ? 2 : cur + 1);
    },
  });
  const lastStepDown = createButton({ label: 'LAST −', className: 'pbtn-sm', onPress: () => setLastStep(store.get().pattern.lastStep - 1) });
  const lastStepUp = createButton({ label: 'LAST +', className: 'pbtn-sm', onPress: () => setLastStep(store.get().pattern.lastStep + 1) });
  const arpBtn = createButton({ label: 'ARP SCALE', className: 'pbtn-sm', onPress: () => cycleArpScale(1) });
  setupRow.append(rollBtn.el, lastStepDown.el, lastStepUp.el, arpBtn.el);

  // --- pattern operations (hardware SHIFT functions)
  const opsRow = row('seq-row');
  const clearPartBtn = createButton({
    label: 'CLR PART',
    className: 'pbtn-sm',
    onPress: () => clearPart(store.get().selectedPart),
  });
  const clearPtnBtn = createButton({
    label: 'CLR PTN',
    className: 'pbtn-sm',
    onLongPress: () => clearPattern(), // long-press to avoid accidents
    onPress: () => setLcd('CLEAR PTN', 'HOLD TO CLEAR'),
  });
  const copyBtn = createButton({
    label: 'COPY PART',
    className: 'pbtn-sm',
    onPress: () => {
      const s = store.get();
      // copies the selected part into the next part of the same type
      const to = nextPartOf(s.selectedPart);
      if (to !== s.selectedPart) copyPart(s.selectedPart, to);
    },
  });
  opsRow.append(clearPartBtn.el, clearPtnBtn.el, copyBtn.el);

  const opsRow2 = row('seq-row');
  const shiftDown = createButton({
    label: 'NOTE −1',
    className: 'pbtn-sm',
    onPress: () => {
      const s = store.get();
      if (isSynthPart(s.selectedPart)) shiftNotes(s.selectedPart as SynthPartId, -1);
    },
  });
  const shiftUp = createButton({
    label: 'NOTE +1',
    className: 'pbtn-sm',
    onPress: () => {
      const s = store.get();
      if (isSynthPart(s.selectedPart)) shiftNotes(s.selectedPart as SynthPartId, 1);
    },
  });
  const moveL = createButton({ label: 'MOVE ◀', className: 'pbtn-sm', onPress: () => moveData(store.get().selectedPart, -1) });
  const moveR = createButton({ label: 'MOVE ▶', className: 'pbtn-sm', onPress: () => moveData(store.get().selectedPart, 1) });
  opsRow2.append(shiftDown.el, shiftUp.el, moveL.el, moveR.el);

  // --- motion seq
  const motionRow = row('seq-row');
  const motionModeBtn = createButton({
    label: 'MOTION MODE',
    className: 'pbtn-sm',
    onPress: () => {
      const s = store.get();
      if (s.selectedPart === 'ACCD' || s.selectedPart === 'ACCS') return;
      const cur = isSynthPart(s.selectedPart)
        ? s.pattern.synths[s.selectedPart as SynthPartId].motionMode
        : s.pattern.drums[s.selectedPart as DrumPartId].motionMode;
      const next = (cur === 0 ? 1 : 0) as 0 | 1;
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
  const protectBtn = createButton({ label: 'PROTECT', led: true, className: 'pbtn-sm', onPress: () => toggleProtect() });
  motionRow.append(motionModeBtn.el, motionClearBtn.el, protectBtn.el);

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
            store.update(['pattern', 'steps', 'ui', 'lcd', 'params'], (s) => {
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
            store.update(['ui', 'lcd', 'params'], (s) => {
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
    protectBtn.setLed(s.global.protect, 'orange');
    rollBtn.el.querySelector('.pbtn-label')!.textContent = `ROLL ×${s.pattern.rollType}`;
  }
  ['ui', 'pattern', 'transport', 'steps'].forEach((t) => store.subscribe(t, refresh));
  refresh();

  body.append(modeRow, octRow, ptnRow, setupRow, opsRow, opsRow2, motionRow, dataRow);
  return el;
}
