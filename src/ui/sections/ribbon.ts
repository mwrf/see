/** Arpeggiator ribbon + slider (touch strips). */

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
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  strip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    strip.setPointerCapture(e.pointerId);
    const p = posFromEvent(e);
    cursor.style.left = `${p * 100}%`;
    cursor.classList.add('on');
    ribbon(p);
  });
  strip.addEventListener('pointermove', (e) => {
    if (!strip.hasPointerCapture(e.pointerId)) return;
    const p = posFromEvent(e);
    cursor.style.left = `${p * 100}%`;
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
  sliderWrap.innerHTML = '<span class="ribbon-hint">GATE</span>';
  sliderWrap.prepend(sliderEl);

  body.append(strip, sliderWrap);
  return el;
}
