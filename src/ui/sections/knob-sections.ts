/**
 * The four part-edit knob sections (OSC/WAVE, FILTER, MOD/LFO, AMP) plus the
 * master section. Knobs re-bind to the selected part, like the hardware
 * panel where one physical knob edits whatever part is selected.
 */

import { getParam, isDrumPart, isSynthPart, setParam } from '../../state/actions';
import { store } from '../../state/store';
import type { MotionTarget } from '../../shared/model';
import { createButton, type PanelButton } from '../controls/button';
import { createKnob } from '../controls/knob';
import { row, section } from './helpers';

type Binding = { target: MotionTarget; paramId: string } | null;

function forSelected(paramId: string, drumParamId?: string | null, accentOk = false): () => Binding {
  return () => {
    const part = store.get().selectedPart;
    if (isSynthPart(part)) return { target: part, paramId };
    if (isDrumPart(part)) {
      const id = drumParamId === undefined ? paramId : drumParamId;
      return id ? { target: part, paramId: id } : null;
    }
    if (accentOk && part === 'ACC') return { target: 'MASTER', paramId: 'accentLevel' };
    return null;
  };
}

/** Toggle button bound to a 0/1 param of the selected part. */
function paramToggle(label: string, paramId: string, drumToo = true): PanelButton {
  const btn = createButton({
    label,
    led: true,
    className: 'pbtn-sm pbtn-toggle',
    onPress: () => {
      const part = store.get().selectedPart;
      if (part === 'ACC') return;
      if (!drumToo && isDrumPart(part)) return;
      const cur = getParam(part, paramId);
      setParam(part, paramId, cur >= 0.5 ? 0 : 1);
    },
  });
  const refresh = (): void => {
    const part = store.get().selectedPart;
    const valid = part !== 'ACC' && (drumToo || isSynthPart(part));
    btn.el.classList.toggle('pbtn-disabled', !valid);
    btn.setLed(valid && getParam(part, paramId) >= 0.5, 'orange');
  };
  ['ui', 'params', 'pattern'].forEach((t) => store.subscribe(t, refresh));
  refresh();
  return btn;
}

export function createOscSection(): HTMLElement {
  const { el, body } = section('OSCILLATOR / WAVE', 'sec-osc');
  const r = row();
  r.append(
    createKnob({
      label: 'TYPE·WAVE',
      resolve: forSelected('oscType', 'waveId'),
      size: 'lg',
    }).el,
    createKnob({ label: 'EDIT1·PITCH', resolve: forSelected('oscEdit1', 'pitch') }).el,
    createKnob({ label: 'EDIT2', resolve: forSelected('oscEdit2', null) }).el,
    createKnob({ label: 'GLIDE', resolve: forSelected('glide', null) }).el,
    createKnob({ label: 'TUNE', resolve: forSelected('tune', null) }).el,
  );
  body.appendChild(r);
  return el;
}

export function createFilterSection(): HTMLElement {
  const { el, body } = section('FILTER', 'sec-filter');
  const r = row();
  r.append(
    createKnob({ label: 'TYPE', resolve: forSelected('filterType') }).el,
    createKnob({ label: 'CUTOFF', resolve: forSelected('cutoff'), size: 'lg' }).el,
    createKnob({ label: 'RESONANCE', resolve: forSelected('resonance') }).el,
    createKnob({ label: 'EG INT', resolve: forSelected('egInt') }).el,
  );
  body.appendChild(r);
  return el;
}

export function createModSection(): HTMLElement {
  const { el, body } = section('MODULATION LFO', 'sec-mod');
  const r = row();
  r.append(
    createKnob({ label: 'WAVE', resolve: forSelected('lfoWave') }).el,
    createKnob({ label: 'SPEED', resolve: forSelected('lfoSpeed') }).el,
    createKnob({ label: 'DEPTH', resolve: forSelected('lfoDepth') }).el,
    createKnob({ label: 'DEST', resolve: forSelected('lfoDest') }).el,
  );
  const toggles = row('toggle-row');
  toggles.append(paramToggle('BPM SYNC', 'lfoBpmSync').el, paramToggle('KEY SYNC', 'lfoKeySync').el);
  body.append(r, toggles);
  return el;
}

export function createAmpSection(): HTMLElement {
  const { el, body } = section('AMP / EG', 'sec-amp');
  const r = row();
  r.append(
    createKnob({ label: 'LEVEL', resolve: forSelected('level', 'level', true), size: 'lg' }).el,
    createKnob({ label: 'PAN', resolve: forSelected('pan') }).el,
    createKnob({ label: 'EG TIME', resolve: forSelected('egTime') }).el,
  );
  const toggles = row('toggle-row');
  toggles.append(
    paramToggle('AMP EG', 'ampEg').el,
    paramToggle('ROLL', 'roll').el,
    paramToggle('ACCENT', 'accent').el,
    paramToggle('FX ON', 'fxOn').el,
  );
  const fxSel = row('toggle-row');
  fxSel.append(createKnob({ label: 'FX SELECT', resolve: forSelected('fxSend'), size: 'sm' }).el);
  body.append(r, toggles, fxSel);
  return el;
}

export function createMasterSection(): HTMLElement {
  const { el, body } = section('MASTER', 'sec-master');
  const r = row();
  r.append(
    createKnob({ label: 'SWING', resolve: () => ({ target: 'MASTER', paramId: 'swing' }) }).el,
    createKnob({ label: 'ACCENT', resolve: () => ({ target: 'MASTER', paramId: 'accentLevel' }) }).el,
    createKnob({ label: 'MASTER VOL', resolve: () => ({ target: 'MASTER', paramId: 'masterVolume' }), size: 'lg' }).el,
  );
  body.appendChild(r);
  return el;
}
