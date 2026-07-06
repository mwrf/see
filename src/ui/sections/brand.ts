/**
 * Top-left block: ELECTRIBE·MX boxed-letter logo (like the silkscreen on the
 * hardware) with MASTER VOLUME and TUBE GAIN knobs below it.
 */

import { createKnob } from '../controls/knob';
import { row } from './helpers';

export function createBrandSection(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel-section sec-brand';

  const logo = document.createElement('div');
  logo.className = 'emx-logo';
  const boxed = 'ELECTRIBE'
    .split('')
    .map((c, i) => `<span class="${i === 4 ? 'logo-box logo-box-hl' : 'logo-box'}">${c}</span>`)
    .join('');
  logo.innerHTML = `
    <div class="logo-row">${boxed}<span class="logo-mx">MX</span></div>
    <div class="logo-sub">MUSIC PRODUCTION STATION · WEB</div>
  `;

  const knobs = row('brand-knobs');
  knobs.append(
    createKnob({ label: 'MASTER VOLUME', resolve: () => ({ target: 'MASTER', paramId: 'masterVolume' }) }).el,
    createKnob({ label: 'TUBE GAIN', resolve: () => ({ target: 'MASTER', paramId: 'valveGain' }) }).el,
    createKnob({ label: 'SWING', resolve: () => ({ target: 'MASTER', paramId: 'swing' }), size: 'sm' }).el,
    createKnob({ label: 'TUNE', resolve: () => ({ target: 'MASTER', paramId: 'masterTune' }), size: 'sm' }).el,
  );

  el.append(logo, knobs);
  return el;
}
