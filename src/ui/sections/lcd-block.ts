/**
 * LCD block: the amber display with the write/beat/length/tempo buttons
 * beside it (stand-in for the hardware's rotary dial cluster).
 */

import { setBeat, setLengthBars, setTempo, writePattern } from '../../state/actions';
import { store } from '../../state/store';
import { BEATS } from '../../shared/model';
import { createButton } from '../controls/button';
import { createLcd } from '../lcd/lcd';

export function createLcdBlock(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel-section sec-lcdblock';

  const title = document.createElement('div');
  title.className = 'lcd-title';
  title.textContent = 'EMX-1 · MUSIC PRODUCTION STATION';

  const wrap = document.createElement('div');
  wrap.className = 'lcd-wrap';

  const lcd = createLcd();

  const side = document.createElement('div');
  side.className = 'lcd-side';
  const writeBtn = createButton({ label: 'WRITE', led: true, className: 'pbtn-sm pbtn-write', onPress: () => void writePattern() });
  const beatBtn = createButton({
    label: 'BEAT',
    className: 'pbtn-sm',
    onPress: () => {
      const cur = store.get().pattern.beat;
      setBeat(BEATS[(BEATS.indexOf(cur) + 1) % BEATS.length]);
    },
  });
  const lenDown = createButton({ label: 'LEN −', className: 'pbtn-sm', onPress: () => setLengthBars(store.get().pattern.lengthBars - 1) });
  const lenUp = createButton({ label: 'LEN +', className: 'pbtn-sm', onPress: () => setLengthBars(store.get().pattern.lengthBars + 1) });
  const tempoDown = createButton({ label: 'TEMPO −', className: 'pbtn-sm', onPress: () => setTempo(store.get().pattern.tempo - 1) });
  const tempoUp = createButton({ label: 'TEMPO +', className: 'pbtn-sm', onPress: () => setTempo(store.get().pattern.tempo + 1) });
  side.append(writeBtn.el, beatBtn.el, lenDown.el, lenUp.el, tempoDown.el, tempoUp.el);

  function refresh(): void {
    const s = store.get();
    writeBtn.setLed(s.patternDirty, 'red');
    beatBtn.el.querySelector('.pbtn-label')!.textContent = `BEAT ${s.pattern.beat}`;
  }
  ['pattern', 'transport', 'steps', 'ui'].forEach((t) => store.subscribe(t, refresh));
  refresh();

  wrap.append(lcd.el, side);
  el.append(title, wrap);
  return el;
}
