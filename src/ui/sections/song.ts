/**
 * Song mode strip: pattern/song mode toggle, song slot navigation,
 * event chain editing (append current pattern / delete last), save.
 */

import {
  addSongEvent,
  formatSongSlot,
  loadSong,
  nudgeSongNoteOffset,
  removeSongEvent,
  saveSong,
  setAppMode,
} from '../../state/actions';
import { store } from '../../state/store';
import { createButton } from '../controls/button';
import { row, section } from './helpers';

export function createSongSection(): HTMLElement {
  const { el, body } = section('SONG', 'sec-song');

  const modeRow = row('seq-row');
  const patternMode = createButton({
    label: 'PATTERN',
    led: true,
    className: 'pbtn-sm',
    onPress: () => void setAppMode('pattern'),
  });
  const songMode = createButton({
    label: 'SONG',
    led: true,
    className: 'pbtn-sm',
    onPress: () => {
      void (async () => {
        if (!store.get().song) await loadSong(store.get().songSlot);
        await setAppMode('song');
      })();
    },
  });
  modeRow.append(patternMode.el, songMode.el);

  const navRow = row('seq-row');
  const prev = createButton({
    label: '◀ SONG',
    className: 'pbtn-sm',
    onPress: () => void loadSong(Math.max(0, store.get().songSlot - 1)),
  });
  const next = createButton({
    label: 'SONG ▶',
    className: 'pbtn-sm',
    onPress: () => void loadSong(Math.min(63, store.get().songSlot + 1)),
  });
  navRow.append(prev.el, next.el);

  const editRow = row('seq-row');
  const add = createButton({ label: '+ PTN', className: 'pbtn-sm', onPress: () => void addSongEvent() });
  const del = createButton({ label: '− EVT', className: 'pbtn-sm', onPress: () => void removeSongEvent() });
  const offDown = createButton({ label: 'OFS −', className: 'pbtn-sm', onPress: () => void nudgeSongNoteOffset(-1) });
  const offUp = createButton({ label: 'OFS +', className: 'pbtn-sm', onPress: () => void nudgeSongNoteOffset(1) });
  const save = createButton({ label: 'SAVE', className: 'pbtn-sm pbtn-write', onPress: () => void saveSong() });
  editRow.append(add.el, del.el, offDown.el, offUp.el, save.el);

  const info = document.createElement('div');
  info.className = 'song-info';

  function refresh(): void {
    const s = store.get();
    patternMode.setLed(s.mode === 'pattern', 'green');
    songMode.setLed(s.mode === 'song', 'green');
    const n = s.song?.events.length ?? 0;
    info.textContent = `${formatSongSlot(s.songSlot)} · ${n} event${n === 1 ? '' : 's'}${
      s.mode === 'song' && s.playhead.playing ? ` · pos ${s.playhead.songPos + 1}` : ''
    }`;
  }
  ['ui', 'song', 'playhead'].forEach((t) => store.subscribe(t, refresh));
  refresh();

  body.append(modeRow, navRow, editRow, info);
  return el;
}
