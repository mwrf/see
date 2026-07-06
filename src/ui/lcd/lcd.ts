/**
 * The green dot-matrix LCD — one canvas, redrawn only when relevant state
 * changes (and per step while playing). Header row shows slot / mode /
 * tempo / transport; two text lines show whatever changed last.
 */

import { formatSlot, formatSongSlot } from '../../state/actions';
import { store } from '../../state/store';
import { glyph, GLYPH_H, GLYPH_W } from './font';

const COLS = 20;
const DOT = 3; // css px per dot at scale 1
const GAP = 1;
const CHAR_W = (GLYPH_W + 1) * (DOT + GAP);
const CHAR_H = (GLYPH_H + 1) * (DOT + GAP);
const PAD = 10;

export interface Lcd {
  el: HTMLElement;
  dispose(): void;
}

export function createLcd(): Lcd {
  const el = document.createElement('div');
  el.className = 'lcd';
  const canvas = document.createElement('canvas');
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const logicalW = COLS * CHAR_W + PAD * 2;
  const logicalH = CHAR_H * 3 + PAD * 2 + 8;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;
  canvas.style.width = '100%';
  canvas.style.aspectRatio = `${logicalW} / ${logicalH}`;
  ctx.scale(dpr, dpr);

  function drawText(text: string, row: number, colOffset = 0, bright = 1): void {
    const y0 = PAD + row * (CHAR_H + 4);
    for (let c = 0; c < Math.min(text.length, COLS - colOffset); c++) {
      const g = glyph(text[c]);
      const x0 = PAD + (c + colOffset) * CHAR_W;
      for (let gx = 0; gx < GLYPH_W; gx++) {
        const bits = g[gx];
        for (let gy = 0; gy < GLYPH_H; gy++) {
          const on = (bits >> gy) & 1;
          ctx.fillStyle = on
            ? `rgba(20, 45, 18, ${0.92 * bright})`
            : 'rgba(20, 45, 18, 0.08)';
          ctx.fillRect(x0 + gx * (DOT + GAP), y0 + gy * (DOT + GAP), DOT, DOT);
        }
      }
    }
  }

  function render(): void {
    const s = store.get();
    // backlight
    const grad = ctx.createLinearGradient(0, 0, 0, logicalH);
    grad.addColorStop(0, '#9fbf3f');
    grad.addColorStop(0.5, '#b3d24d');
    grad.addColorStop(1, '#98b93c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, logicalW, logicalH);

    // header: mode/slot, transport state, tempo, position — fixed columns
    const slotLabel = s.mode === 'song' ? formatSongSlot(s.songSlot) : formatSlot(s.patternSlot);
    const dirty = s.patternDirty ? '*' : ' ';
    const playState = s.playhead.playing ? '▸' : '■';
    const rec = s.recording ? '●' : ' ';
    drawText(`${slotLabel}${dirty}${playState}${rec}`, 0, 0, 0.8);
    const tempo = Number.isInteger(s.pattern.tempo) ? String(s.pattern.tempo) : s.pattern.tempo.toFixed(1);
    drawText(`${tempo}BPM`.padStart(8), 0, 8, 0.8);
    const pos = `${s.playhead.bar + 1}.${String(s.playhead.step + 1).padStart(2, '0')}`;
    drawText(pos.padStart(4), 0, 16, 0.8);

    drawText(s.lcd.line1.toUpperCase(), 1);
    drawText(s.lcd.line2.toUpperCase(), 2);
  }

  const unsubs = ['lcd', 'playhead', 'transport', 'ui', 'pattern'].map((t) => store.subscribe(t, render));
  render();

  return {
    el,
    dispose() {
      unsubs.forEach((u) => u());
    },
  };
}
