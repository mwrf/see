/**
 * Part select: 5 synth parts, 9 drum parts, accent.
 * Tap = select (and audition). Long-press = mute toggle. LEDs show
 * selection (red) and mute state (unlit label).
 */

import { isDrumPart, isSynthPart, selectPart, toggleMute } from '../../state/actions';
import { store } from '../../state/store';
import type { PartId } from '../../shared/model';
import { ALL_PART_IDS } from '../../shared/model';
import { createButton, type PanelButton } from '../controls/button';
import { section } from './helpers';

export function createPartSelect(): HTMLElement {
  const { el, body } = section('PART SELECT', 'sec-parts');

  const buttons = new Map<PartId, PanelButton>();

  const synthRow = document.createElement('div');
  synthRow.className = 'part-row';
  const drumRow = document.createElement('div');
  drumRow.className = 'part-row';

  for (const id of ALL_PART_IDS) {
    const btn = createButton({
      label: id === 'ACC' ? 'ACC' : id,
      led: true,
      className: 'pbtn-part',
      onPress: () => selectPart(id),
      onLongPress: () => {
        if (id !== 'ACC') toggleMute(id);
      },
    });
    buttons.set(id, btn);
    if (isSynthPart(id) || id === 'ACC') synthRow.appendChild(btn.el);
    else drumRow.appendChild(btn.el);
  }

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

  body.append(synthRow, drumRow);
  return el;
}
