/**
 * Part select, hardware style: DRUM PART keys 1-5 / 6A / 6B / 7A / 7B,
 * SYNTH PART keys 1-5, and the ACCENT key.
 * Tap = select (and audition). Long-press = mute toggle.
 */

import { isDrumPart, isSynthPart, selectPart, toggleMute } from '../../state/actions';
import { store } from '../../state/store';
import type { PartId } from '../../shared/model';
import { ALL_PART_IDS, DRUM_PART_IDS, SYNTH_PART_IDS } from '../../shared/model';
import { createButton, type PanelButton } from '../controls/button';

/** Hardware silk-screen names for the drum parts. */
export const DRUM_LABELS: Record<string, string> = {
  D1: '1',
  D2: '2',
  D3: '3',
  D4: '4',
  D5: '5',
  D6: '6A',
  D7: '6B',
  D8: '7A',
  D9: '7B',
};

export function partLabel(id: PartId): string {
  if (isDrumPart(id)) return DRUM_LABELS[id];
  if (isSynthPart(id)) return id.slice(1);
  return 'ACCENT';
}

export function createPartSelect(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel-section sec-parts';

  const buttons = new Map<PartId, PanelButton>();

  function makeButton(id: PartId): PanelButton {
    const btn = createButton({
      label: partLabel(id),
      led: true,
      className: `pbtn-part ${id === 'ACC' ? 'pbtn-accent' : ''}`,
      onPress: () => selectPart(id),
      onLongPress: () => {
        if (id !== 'ACC') toggleMute(id);
      },
    });
    buttons.set(id, btn);
    return btn;
  }

  const drumGroup = document.createElement('div');
  drumGroup.className = 'part-group';
  drumGroup.innerHTML = '<div class="part-group-title">DRUM PART</div>';
  const drumRow = document.createElement('div');
  drumRow.className = 'part-row';
  for (const id of DRUM_PART_IDS) drumRow.appendChild(makeButton(id).el);
  drumGroup.appendChild(drumRow);

  const synthGroup = document.createElement('div');
  synthGroup.className = 'part-group';
  synthGroup.innerHTML = '<div class="part-group-title">SYNTH PART</div>';
  const synthRow = document.createElement('div');
  synthRow.className = 'part-row';
  for (const id of SYNTH_PART_IDS) synthRow.appendChild(makeButton(id).el);
  synthRow.appendChild(makeButton('ACC').el);
  synthGroup.appendChild(synthRow);

  function refresh(): void {
    const s = store.get();
    for (const id of ALL_PART_IDS) {
      const btn = buttons.get(id)!;
      btn.setLed(s.selectedPart === id, 'red');
      let muted = false;
      if (isSynthPart(id)) muted = s.pattern.synths[id].mute;
      else if (isDrumPart(id)) muted = s.pattern.drums[id].mute;
      btn.el.classList.toggle('pbtn-muted', muted);
    }
  }

  ['ui', 'pattern', 'steps'].forEach((t) => store.subscribe(t, refresh));
  refresh();

  el.append(drumGroup, synthGroup);
  return el;
}
