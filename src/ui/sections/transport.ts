/** Transport: PLAY/PAUSE, STOP, REC, TAP. */

import { play, stop, tapTempo, toggleRec } from '../../state/actions';
import { store } from '../../state/store';
import { createButton } from '../controls/button';
import { section } from './helpers';

export function createTransport(): HTMLElement {
  const { el, body } = section('TRANSPORT', 'sec-transport');

  const playBtn = createButton({
    label: '▶',
    led: true,
    className: 'pbtn-big pbtn-play',
    onPress: () => play(),
  });
  const stopBtn = createButton({
    label: '■',
    className: 'pbtn-big',
    onPress: () => stop(),
  });
  const recBtn = createButton({
    label: '⏺',
    led: true,
    className: 'pbtn-big pbtn-rec',
    onPress: () => toggleRec(),
  });
  const tapBtn = createButton({
    label: 'TAP',
    className: 'pbtn-big',
    onPress: () => tapTempo(),
  });

  body.classList.add('transport-body');
  body.append(recBtn.el, stopBtn.el, playBtn.el, tapBtn.el);

  store.subscribe('playhead', () => {
    playBtn.setLed(store.get().playhead.playing, 'green');
  });
  store.subscribe('transport', () => {
    recBtn.setLed(store.get().recording, 'red');
  });

  return el;
}
