/**
 * Top-level panel layout, mirroring the real EMX-1 faceplate zones:
 *   row 1: logo + master knobs | VALVE FORCE window | PART COMMON | MODULATION
 *   row 2: LCD block           | EFFECT             | SYNTH OSC   | SYNTH FILTER
 *   row 3: menu / song         | (effect, osc, filter continue)
 *   row 4: transport | part rows      (footer)
 *          arpeggiator | 16 step keys
 * Portrait re-slots the same components into a scroll layout with the
 * transport + parts + step keys pinned as a footer.
 */

import { createLcdBlock } from './sections/lcd-block';
import { createBrandSection } from './sections/brand';
import { createFxSection, createValveSection } from './sections/fx-valve';
import {
  createFilterSection,
  createModSection,
  createOscSection,
  createPartCommonSection,
} from './sections/knob-sections';
import { createPartSelect } from './sections/part-select';
import { createRibbonSection } from './sections/ribbon';
import { createSeqSettings } from './sections/seq-settings';
import { createSongSection } from './sections/song';
import { createStepKeys } from './sections/step-keys';
import { createTransport } from './sections/transport';

export function mountPanel(root: HTMLElement): void {
  root.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';

  const sections: [string, HTMLElement][] = [
    ['area-brand', createBrandSection()],
    ['area-valve', createValveSection()],
    ['area-common', createPartCommonSection()],
    ['area-mod', createModSection()],
    ['area-lcd', createLcdBlock()],
    ['area-fx', createFxSection()],
    ['area-osc', createOscSection()],
    ['area-filter', createFilterSection()],
  ];
  for (const [area, el] of sections) {
    el.classList.add(area);
    panel.appendChild(el);
  }

  // menu column: sequencer settings + song stacked
  const menu = document.createElement('div');
  menu.className = 'area-menu menu-col';
  menu.append(createSeqSettings(), createSongSection());
  panel.appendChild(menu);

  // footer: transport + parts on top, arpeggiator + step keys below
  const footer = document.createElement('div');
  footer.className = 'panel-footer area-footer';
  const transport = createTransport();
  transport.classList.add('area-transport');
  const parts = createPartSelect();
  parts.classList.add('area-parts');
  const arp = createRibbonSection();
  arp.classList.add('area-arp');
  const steps = createStepKeys();
  steps.classList.add('area-steps');
  footer.append(transport, parts, arp, steps);
  panel.appendChild(footer);
  root.appendChild(panel);

  // orientation class on body drives the grid template swap
  function applyOrientation(): void {
    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('portrait', portrait);
    document.body.classList.toggle('landscape', !portrait);
    if (!portrait) {
      // measure the real (unzoomed) panel size — zoom does not affect
      // offsetWidth/Height — and fit both axes when possible; below the
      // usability floor, fit height only and scroll horizontally
      document.documentElement.style.setProperty('--panel-scale', '1');
      const w = panel.offsetWidth + 20 || 1310;
      const h = panel.offsetHeight + 16 || 1045;
      const fit = Math.min(window.innerWidth / w, window.innerHeight / h);
      const scale = fit >= 0.55 ? fit : Math.min(0.55, Math.max(0.42, window.innerHeight / h));
      document.documentElement.style.setProperty('--panel-scale', String(Math.min(1.5, scale)));
    } else {
      document.documentElement.style.setProperty('--panel-scale', '1');
    }
  }
  window.addEventListener('resize', applyOrientation);
  applyOrientation();
  // re-measure once fonts/layout settle
  requestAnimationFrame(applyOrientation);
}
