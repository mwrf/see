/** Effects section (3 slots) + the Valve Force tube window. */

import { setParam } from '../../state/actions';
import { store } from '../../state/store';
import type { MotionTarget } from '../../shared/model';
import { FX_TYPE_NAMES } from '../../shared/params';
import { createButton } from '../controls/button';
import { createKnob } from '../controls/knob';
import { row, section, silkList } from './helpers';

export function createFxSection(): HTMLElement {
  const { el, body } = section('EFFECT', 'sec-fx');
  for (let s = 1; s <= 3; s++) {
    const target = `FX${s}` as MotionTarget;
    const slotEl = document.createElement('div');
    slotEl.className = 'fx-slot';
    slotEl.innerHTML = `<div class="fx-slot-title">FX ${s}</div>`;
    const r = row('fx-row');
    r.append(
      createKnob({ label: 'TYPE', resolve: () => ({ target, paramId: 'type' }), size: 'sm' }).el,
      createKnob({ label: 'EDIT 1', resolve: () => ({ target, paramId: 'edit1' }), size: 'sm' }).el,
      createKnob({ label: 'EDIT 2', resolve: () => ({ target, paramId: 'edit2' }), size: 'sm' }).el,
    );
    const chainBtn = createButton({
      label: s < 3 ? `CHAIN→${s + 1}` : 'CHAIN',
      led: true,
      className: 'pbtn-sm pbtn-toggle',
      onPress: () => {
        if (s === 3) return;
        const cur = store.get().pattern.fx[s - 1].chain;
        setParam(target, 'chain', cur ? 0 : 1);
      },
    });
    if (s === 3) chainBtn.el.classList.add('pbtn-disabled');
    const refreshChain = (): void => {
      chainBtn.setLed(store.get().pattern.fx[s - 1].chain, 'red');
    };
    ['params', 'pattern'].forEach((t) => store.subscribe(t, refreshChain));
    refreshChain();
    r.append(chainBtn.el);
    slotEl.appendChild(r);
    body.appendChild(slotEl);
  }
  body.appendChild(silkList(FX_TYPE_NAMES, 2));
  return el;
}

/** The Valve Force window — two tubes behind glass, glow follows tube gain. */
export function createValveSection(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel-section sec-valve';
  el.innerHTML = `
    <div class="valve-brand">VALVE <span>◉</span> FORCE</div>
    <div class="valve-window">
      <div class="valve-tube"></div>
      <div class="valve-tube"></div>
    </div>
  `;
  const tubes = el.querySelector('.valve-window') as HTMLElement;

  function refreshGlow(): void {
    const gain = store.get().global.valveGain / 127;
    tubes.style.setProperty('--tube-glow', String(gain));
  }
  store.subscribe('params', refreshGlow);
  refreshGlow();

  return el;
}
