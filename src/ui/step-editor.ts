/**
 * Step editor popover — long-press a step key (synth part, trig mode) to
 * edit that step's note and gate length, web-friendly stand-in for the
 * hardware's step-edit dial workflow.
 */

import { isSynthPart, setStepNote } from '../state/actions';
import { store } from '../state/store';
import { KEY_NAMES } from '../shared/params';

let openEditor: HTMLElement | null = null;

export function noteName(note: number): string {
  return `${KEY_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

export function openStepEditor(stepIdx: number): void {
  closeStepEditor();
  const s = store.get();
  if (!isSynthPart(s.selectedPart)) return;
  const part = s.selectedPart;
  const step = s.pattern.synths[part].steps[stepIdx];
  if (!step) return;

  const pop = document.createElement('div');
  pop.className = 'step-editor';
  pop.innerHTML = `
    <div class="step-editor-title">${part} · STEP ${stepIdx + 1}</div>
    <div class="step-editor-row">
      <button type="button" data-a="note-">−</button>
      <span class="step-editor-val" data-v="note"></span>
      <button type="button" data-a="note+">+</button>
      <span class="step-editor-lbl">NOTE</span>
    </div>
    <div class="step-editor-row">
      <button type="button" data-a="gate-">−</button>
      <span class="step-editor-val" data-v="gate"></span>
      <button type="button" data-a="gate+">+</button>
      <span class="step-editor-lbl">GATE</span>
    </div>
    <button type="button" class="step-editor-close" data-a="close">DONE</button>
  `;

  function refresh(): void {
    const st = store.get().pattern.synths[part].steps[stepIdx];
    (pop.querySelector('[data-v="note"]') as HTMLElement).textContent = `${noteName(st.note)}`;
    (pop.querySelector('[data-v="gate"]') as HTMLElement).textContent = `${st.gate.toFixed(2)}`;
  }

  pop.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).dataset.a;
    if (!a) return;
    const st = store.get().pattern.synths[part].steps[stepIdx];
    switch (a) {
      case 'note-':
        setStepNote(stepIdx, Math.max(12, st.note - 1));
        break;
      case 'note+':
        setStepNote(stepIdx, Math.min(108, st.note + 1));
        break;
      case 'gate-':
        setStepNote(stepIdx, st.note, Math.max(0.25, Math.round((st.gate - 0.25) * 4) / 4));
        break;
      case 'gate+':
        setStepNote(stepIdx, st.note, Math.min(8, Math.round((st.gate + 0.25) * 4) / 4));
        break;
      case 'close':
        closeStepEditor();
        return;
    }
    refresh();
  });

  refresh();
  document.body.appendChild(pop);
  openEditor = pop;
}

export function closeStepEditor(): void {
  openEditor?.remove();
  openEditor = null;
}
