/**
 * Top-level panel layout. One set of section components, re-slotted by CSS
 * grid for landscape (faithful full panel) vs portrait (stacked scroll with
 * sticky transport + step keys).
 */

import { createLcd } from './lcd/lcd';
import { createFxSection, createValveSection } from './sections/fx-valve';
import {
  createAmpSection,
  createFilterSection,
  createMasterSection,
  createModSection,
  createOscSection,
} from './sections/knob-sections';
import { createPartSelect } from './sections/part-select';
import { createRibbonSection } from './sections/ribbon';
import { createSeqSettings } from './sections/seq-settings';
import { createStepKeys } from './sections/step-keys';
import { createTransport } from './sections/transport';

export function mountPanel(root: HTMLElement): void {
  root.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';

  const header = document.createElement('header');
  header.className = 'panel-header';
  header.innerHTML = `
    <span class="brand">EMX<span class="brand-web">web</span></span>
    <span class="brand-sub">MUSIC PRODUCTION STATION · ELECTRIBE MX EMULATOR</span>
  `;

  const lcd = createLcd();
  lcd.el.classList.add('area-lcd');

  const sections: [string, HTMLElement][] = [
    ['area-seq', createSeqSettings()],
    ['area-osc', createOscSection()],
    ['area-filter', createFilterSection()],
    ['area-mod', createModSection()],
    ['area-amp', createAmpSection()],
    ['area-fx', createFxSection()],
    ['area-valve', createValveSection()],
    ['area-master', createMasterSection()],
    ['area-ribbon', createRibbonSection()],
  ];

  panel.appendChild(header);
  panel.appendChild(lcd.el);
  for (const [area, el] of sections) {
    el.classList.add(area);
    panel.appendChild(el);
  }

  // transport + part select + step keys live in one footer container so the
  // portrait layout can pin them as a unit
  const footer = document.createElement('div');
  footer.className = 'panel-footer area-footer';
  const transport = createTransport();
  transport.classList.add('area-transport');
  const parts = createPartSelect();
  parts.classList.add('area-parts');
  const steps = createStepKeys();
  steps.classList.add('area-steps');
  footer.append(transport, parts, steps);
  panel.appendChild(footer);
  root.appendChild(panel);

  // orientation class on body drives the grid template swap
  function applyOrientation(): void {
    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('portrait', portrait);
    document.body.classList.toggle('landscape', !portrait);
    // scale the landscape panel to fit the viewport
    if (!portrait) {
      // fit both axes when possible; below the usability floor, fit height
      // only and let the panel scroll horizontally
      const fit = Math.min(window.innerWidth / 1300, window.innerHeight / 1010);
      const scale = fit >= 0.55 ? fit : Math.min(0.55, Math.max(0.42, window.innerHeight / 1010));
      document.documentElement.style.setProperty('--panel-scale', String(Math.min(1.5, scale)));
    } else {
      document.documentElement.style.setProperty('--panel-scale', '1');
    }
  }
  window.addEventListener('resize', applyOrientation);
  applyOrientation();
}
