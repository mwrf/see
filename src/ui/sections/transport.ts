/** Transport: RESET/ERASE, REC, STOP, PLAY/PAUSE, TAP, METRO. */

import {
  cycleMetronome,
  eraseHold,
  getMetronomeMode,
  play,
  resetPattern,
  stop,
  tapTempo,
  toggleRec,
} from '../../state/actions';
import { store } from '../../state/store';
import { createButton } from '../controls/button';
import { section } from './helpers';

export function createTransport(): HTMLElement {
  const { el, body } = section('TRANSPORT', 'sec-transport');

  // RESET: tap = restart pattern; hold = erase selected part's passing triggers
  const resetBtn = createButton({
    label: 'RESET',
    className: 'pbtn-big pbtn-reset',
    onPress: () => resetPattern(),
    onLongPress: () => eraseHold(true),
    onRelease: () => eraseHold(false),
  });
  const recBtn = createButton({
    label: '●',
    led: true,
    className: 'pbtn-big pbtn-rec',
    onPress: () => toggleRec(),
  });
  const stopBtn = createButton({
    label: '■',
    className: 'pbtn-big',
    onPress: () => stop(),
  });
  const playBtn = createButton({
    label: '▶',
    led: true,
    className: 'pbtn-big pbtn-play',
    onPress: () => play(),
  });
  const tapBtn = createButton({
    label: 'TAP',
    className: 'pbtn-big',
    onPress: () => tapTempo(),
  });
  const metroBtn = createButton({
    label: 'METRO',
    led: true,
    className: 'pbtn-sm',
    onPress: () => cycleMetronome(),
  });

  body.classList.add('transport-body');
  body.append(resetBtn.el, recBtn.el, stopBtn.el, playBtn.el, tapBtn.el, metroBtn.el);

  store.subscribe('playhead', () => {
    playBtn.setLed(store.get().playhead.playing, 'green');
  });
  store.subscribe('transport', () => {
    recBtn.setLed(store.get().recording, 'red');
    const mode = getMetronomeMode();
    metroBtn.setLed(mode > 0, mode === 2 ? 'green' : 'orange');
  });

  return el;
}
