/**
 * The 16 step keys with red LEDs. Behavior depends on stepKeyMode:
 *  - trig: toggle steps for the selected part (LEDs show triggers, playhead sweeps)
 *  - keyboard: chromatic keyboard for the selected synth part
 *  - mute: keys toggle part mutes (drums 1-9 = keys 1-9, synths = keys 11-15)
 *  - solo: same mapping, toggles solo
 *  - patternSet: keys select pattern slots within the current group
 */

import {
  isDrumPart,
  isSynthPart,
  keyboardNoteOn,
  keyboardNoteOff,
  loadPattern,
  setPage,
  toggleMute,
  toggleSolo,
  isSolo,
  toggleStep,
} from '../../state/actions';
import { store } from '../../state/store';
import type { PartId } from '../../shared/model';
import { DRUM_PART_IDS, SYNTH_PART_IDS, stepsForPattern, stepsPerMeasure } from '../../shared/model';
import { createButton, type PanelButton } from '../controls/button';
import { openStepEditor } from '../step-editor';
import { section } from './helpers';

/** Key -> part mapping for mute/solo modes: drums on 1-9, synths on 11-15. */
const MUTE_KEY_PARTS: (PartId | null)[] = [
  ...DRUM_PART_IDS,
  null,
  ...SYNTH_PART_IDS,
  null,
];

export function createStepKeys(): HTMLElement {
  const { el, body } = section('STEP KEYS', 'sec-stepkeys');

  const barRow = document.createElement('div');
  barRow.className = 'bar-row';
  const barPrev = createButton({ label: '◀ BAR', className: 'pbtn-sm', onPress: () => setPage(store.get().page - 1) });
  const barLabel = document.createElement('span');
  barLabel.className = 'bar-label';
  const barNext = createButton({ label: 'BAR ▶', className: 'pbtn-sm', onPress: () => setPage(store.get().page + 1) });
  barRow.append(barPrev.el, barLabel, barNext.el);

  const grid = document.createElement('div');
  grid.className = 'stepkey-grid';
  const keys: PanelButton[] = [];

  for (let i = 0; i < 16; i++) {
    const isUpbeat = i % 4 === 0;
    const key = createButton({
      label: String(i + 1),
      led: true,
      className: `stepkey ${isUpbeat ? 'stepkey-beat' : ''}`,
      onPress: () => onKeyPress(i),
      onRelease: () => onKeyRelease(),
      onLongPress: () => onKeyLongPress(i),
      // keyboard mode needs the note to start on pointer-down
      deferPress: () => store.get().stepKeyMode !== 'keyboard',
    });
    keys.push(key);
    grid.appendChild(key.el);
  }

  function onKeyPress(i: number): void {
    const s = store.get();
    switch (s.stepKeyMode) {
      case 'trig':
        toggleStep(i);
        break;
      case 'keyboard':
        keyboardNoteOn(i);
        break;
      case 'mute': {
        const part = MUTE_KEY_PARTS[i];
        if (part) toggleMute(part);
        break;
      }
      case 'solo': {
        const part = MUTE_KEY_PARTS[i];
        if (part) toggleSolo(part);
        break;
      }
      case 'patternSet':
        void loadPattern(s.page * 16 + i);
        break;
    }
  }

  function onKeyRelease(): void {
    if (store.get().stepKeyMode === 'keyboard') keyboardNoteOff();
  }

  /** Long-press on a synth-part step opens the note/gate editor. */
  function onKeyLongPress(i: number): void {
    const s = store.get();
    if (s.stepKeyMode !== 'trig' || !isSynthPart(s.selectedPart)) {
      onKeyPress(i);
      return;
    }
    const spm = stepsPerMeasure(s.pattern);
    const stepIdx = s.page * spm + i;
    if (i >= spm || stepIdx >= stepsForPattern(s.pattern)) return;
    openStepEditor(stepIdx);
  }

  function stepOnAt(idx: number): boolean {
    const s = store.get();
    const part = s.selectedPart;
    if (isSynthPart(part)) return s.pattern.synths[part].steps[idx]?.on ?? false;
    if (isDrumPart(part)) return s.pattern.drums[part].steps[idx]?.on ?? false;
    if (part === 'ACCD') return s.pattern.accentDrum.steps[idx]?.on ?? false;
    return s.pattern.accentSynth.steps[idx]?.on ?? false;
  }

  function muteOf(part: PartId): boolean {
    const s = store.get();
    if (isSynthPart(part)) return s.pattern.synths[part].mute;
    if (isDrumPart(part)) return s.pattern.drums[part].mute;
    return false;
  }

  function refreshLeds(): void {
    const s = store.get();
    const spm = stepsPerMeasure(s.pattern);
    barLabel.textContent = `BAR ${s.page + 1}/${s.pattern.lengthBars} · ${s.pattern.beat}`;

    for (let i = 0; i < 16; i++) {
      const key = keys[i];
      switch (s.stepKeyMode) {
        case 'trig': {
          const stepIdx = s.page * spm + i;
          const inRange = i < spm && stepIdx < stepsForPattern(s.pattern);
          key.el.classList.toggle('stepkey-off-range', !inRange);
          key.setLed(inRange && stepOnAt(stepIdx), 'red');
          break;
        }
        case 'keyboard': {
          // light the white-note positions for orientation (A-based ranges)
          const semitone = (9 + i) % 12; // ranges start on A
          const black = [1, 3, 6, 8, 10].includes(semitone);
          key.el.classList.toggle('stepkey-off-range', false);
          key.setLed(!black, 'orange');
          break;
        }
        case 'mute': {
          const part = MUTE_KEY_PARTS[i];
          key.el.classList.toggle('stepkey-off-range', !part);
          key.setLed(!!part && !muteOf(part), 'green');
          break;
        }
        case 'solo': {
          const part = MUTE_KEY_PARTS[i];
          key.el.classList.toggle('stepkey-off-range', !part);
          key.setLed(!!part && isSolo(part), 'orange');
          break;
        }
        case 'patternSet': {
          key.el.classList.toggle('stepkey-off-range', false);
          key.setLed(s.page * 16 + i === s.patternSlot, 'red');
          break;
        }
      }
    }
  }

  // playhead sweep via rAF (reads latest POSITION mirror from the store)
  let raf = 0;
  let lastLit = -1;
  function sweep(): void {
    const s = store.get();
    const spm = stepsPerMeasure(s.pattern);
    let lit = -1;
    if (s.playhead.playing && s.stepKeyMode === 'trig') {
      const absStep = s.playhead.bar * spm + s.playhead.step;
      const pageStart = s.page * spm;
      if (absStep >= pageStart && absStep < pageStart + spm) lit = absStep - pageStart;
    }
    if (lit !== lastLit) {
      if (lastLit >= 0) keys[lastLit]?.el.classList.remove('stepkey-playhead');
      if (lit >= 0) keys[lit]?.el.classList.add('stepkey-playhead');
      lastLit = lit;
    }
    raf = requestAnimationFrame(sweep);
  }
  raf = requestAnimationFrame(sweep);
  void raf;

  ['steps', 'ui', 'pattern'].forEach((t) => store.subscribe(t, refreshLeds));
  refreshLeds();

  body.append(barRow, grid);
  return el;
}
