/**
 * Arpeggiator: ribbon strip + gate slider. Vertical in landscape (bottom-left
 * corner, like the hardware); horizontal in portrait. The component detects
 * its own orientation from its rendered shape.
 */

import { ribbon, slider } from '../../state/actions';
import { section } from './helpers';

export function createRibbonSection(): HTMLElement {
  const { el, body } = section('ARPEGGIATOR', 'sec-ribbon');

  const strip = document.createElement('div');
  strip.className = 'ribbon-strip';
  strip.innerHTML = '<div class="ribbon-cursor"></div><span class="ribbon-hint">RIBBON</span>';
  const cursor = strip.querySelector('.ribbon-cursor') as HTMLElement;

  function posFromEvent(e: PointerEvent): number {
    const rect = strip.getBoundingClientRect();
    if (rect.height > rect.width) {
      // vertical: top = high value
      return Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
    }
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  function placeCursor(p: number): void {
    const rect = strip.getBoundingClientRect();
    if (rect.height > rect.width) {
      cursor.classList.add('vert');
      cursor.style.top = `${(1 - p) * 100}%`;
      cursor.style.left = '';
    } else {
      cursor.classList.remove('vert');
      cursor.style.left = `${p * 100}%`;
      cursor.style.top = '';
    }
  }

  strip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    strip.setPointerCapture(e.pointerId);
    const p = posFromEvent(e);
    placeCursor(p);
    cursor.classList.add('on');
    ribbon(p);
  });
  strip.addEventListener('pointermove', (e) => {
    if (!strip.hasPointerCapture(e.pointerId)) return;
    const p = posFromEvent(e);
    placeCursor(p);
    ribbon(p);
  });
  const release = (e: PointerEvent): void => {
    if (strip.hasPointerCapture(e.pointerId)) strip.releasePointerCapture(e.pointerId);
    cursor.classList.remove('on');
    ribbon(null);
  };
  strip.addEventListener('pointerup', release);
  strip.addEventListener('pointercancel', release);

  const sliderEl = document.createElement('input');
  sliderEl.type = 'range';
  sliderEl.min = '0';
  sliderEl.max = '100';
  sliderEl.value = '50';
  sliderEl.className = 'arp-slider';
  sliderEl.setAttribute('aria-label', 'Arp gate time');
  sliderEl.addEventListener('input', () => slider(Number(sliderEl.value) / 100));

  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'arp-slider-wrap';
  sliderWrap.innerHTML = '<span class="ribbon-hint arp-slider-hint">GATE</span>';
  sliderWrap.prepend(sliderEl);

  body.append(strip, sliderWrap);
  return el;
}
