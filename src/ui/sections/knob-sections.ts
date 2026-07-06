/**
 * Part-edit knob sections mirroring the hardware zones:
 *  - PART COMMON (top right): pitch·glide, EG time, pan, level + common switches
 *  - MODULATION (top far right): mod type/speed/depth/dest + BPM sync
 *  - SYNTH OSCILLATOR: osc type / wave / edit1 / edit2 / tune (synth only;
 *    the TYPE·WAVE knob edits the drum WAVE when a drum part is selected)
 *  - SYNTH FILTER: type, cutoff, resonance, EG int, drive (synth only)
 * Knobs re-bind to the selected part, like the hardware panel.
 */

import { getParam, isDrumPart, isSynthPart, setParam } from '../../state/actions';
import { store } from '../../state/store';
import type { MotionTarget } from '../../shared/model';
import { FILTER_TYPE_NAMES, LFO_WAVE_NAMES, OSC_TYPE_NAMES } from '../../shared/params';
import { createButton, type PanelButton } from '../controls/button';
import { createKnob } from '../controls/knob';
import { row, section, silkList } from './helpers';

type Binding = { target: MotionTarget; paramId: string } | null;

/**
 * Resolve a knob binding for the selected part.
 * drumParamId: undefined = same id, null = disabled for drums.
 * accent: bind accent parts' LEVEL when true.
 */
function forSelected(paramId: string, drumParamId?: string | null, accentOk = false): () => Binding {
  return () => {
    const part = store.get().selectedPart;
    if (isSynthPart(part)) return { target: part, paramId };
    if (isDrumPart(part)) {
      const id = drumParamId === undefined ? paramId : drumParamId;
      return id ? { target: part, paramId: id } : null;
    }
    if (accentOk && (part === 'ACCD' || part === 'ACCS')) return { target: part, paramId: 'level' };
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
      if (part === 'ACCD' || part === 'ACCS') return;
      if (!drumToo && isDrumPart(part)) return;
      const cur = getParam(part, paramId);
      setParam(part, paramId, cur >= 0.5 ? 0 : 1);
    },
  });
  const refresh = (): void => {
    const part = store.get().selectedPart;
    const valid = part !== 'ACCD' && part !== 'ACCS' && (drumToo || isSynthPart(part));
    btn.el.classList.toggle('pbtn-disabled', !valid);
    btn.setLed(valid && getParam(part, paramId) >= 0.5, 'red');
  };
  ['ui', 'params', 'pattern'].forEach((t) => store.subscribe(t, refresh));
  refresh();
  return btn;
}

export function createPartCommonSection(): HTMLElement {
  const { el, body } = section('PART COMMON', 'sec-common');
  const knobs = row('tight-row');
  knobs.append(
    // hardware PITCH/GLIDE knob: pitch for drums, glide for synths
    createKnob({
      label: 'PITCH·GLIDE',
      resolve: () => {
        const part = store.get().selectedPart;
        if (isSynthPart(part)) return { target: part, paramId: 'glide' };
        if (isDrumPart(part)) return { target: part, paramId: 'pitch' };
        return null;
      },
      size: 'sm',
    }).el,
    createKnob({ label: 'EG TIME', resolve: forSelected('egTime'), size: 'sm' }).el,
    createKnob({ label: 'PAN', resolve: forSelected('pan'), size: 'sm' }).el,
    createKnob({ label: 'LEVEL', resolve: forSelected('level', 'level', true) }).el,
  );
  const toggles = row('toggle-row');
  toggles.append(
    paramToggle('AMP EG', 'ampEg').el,
    paramToggle('ROLL', 'roll').el,
    paramToggle('ACCENT', 'accent').el,
    paramToggle('SWING', 'swingSw').el,
  );
  const fxRow = row('toggle-row');
  fxRow.append(
    paramToggle('FX SEND', 'fxOn').el,
    createKnob({ label: 'FX SELECT', resolve: forSelected('fxSend'), size: 'sm' }).el,
  );
  body.append(knobs, toggles, fxRow);
  return el;
}

export function createModSection(): HTMLElement {
  const { el, body } = section('MODULATION', 'sec-mod');
  const r = row('tight-row');
  r.append(
    createKnob({ label: 'TYPE', resolve: forSelected('lfoWave'), size: 'sm' }).el,
    createKnob({ label: 'SPEED', resolve: forSelected('lfoSpeed'), size: 'sm' }).el,
    createKnob({ label: 'DEPTH', resolve: forSelected('lfoDepth'), size: 'sm' }).el,
    createKnob({ label: 'DEST', resolve: forSelected('lfoDest'), size: 'sm' }).el,
  );
  const toggles = row('toggle-row');
  toggles.append(paramToggle('BPM SYNC', 'lfoBpmSync').el);
  body.append(r, toggles, silkList(LFO_WAVE_NAMES, 3, false));
  return el;
}

export function createOscSection(): HTMLElement {
  const { el, body } = section('SYNTH OSCILLATOR', 'sec-osc');
  const top = row();
  top.append(
    createKnob({
      label: 'TYPE·WAVE',
      resolve: forSelected('oscType', 'waveId'),
      size: 'lg',
    }).el,
    createKnob({ label: 'WAVE', resolve: forSelected('wave', null) }).el,
  );
  const mid = row();
  mid.append(
    createKnob({ label: 'OSC EDIT 1', resolve: forSelected('oscEdit1', null) }).el,
    createKnob({ label: 'OSC EDIT 2', resolve: forSelected('oscEdit2', null) }).el,
    createKnob({ label: 'TUNE', resolve: forSelected('tune', null), size: 'sm' }).el,
  );
  body.append(top, mid, silkList(OSC_TYPE_NAMES, 2));
  return el;
}

export function createFilterSection(): HTMLElement {
  const { el, body } = section('SYNTH FILTER', 'sec-filter');
  const top = row();
  top.append(
    createKnob({ label: 'CUTOFF', resolve: forSelected('cutoff', null), size: 'lg' }).el,
    createKnob({ label: 'RESONANCE', resolve: forSelected('resonance', null) }).el,
  );
  const bottom = row();
  bottom.append(
    createKnob({ label: 'TYPE', resolve: forSelected('filterType', null), size: 'sm' }).el,
    createKnob({ label: 'EG INT', resolve: forSelected('egInt', null), size: 'sm' }).el,
    createKnob({ label: 'DRIVE', resolve: forSelected('drive', null), size: 'sm' }).el,
  );
  body.append(top, bottom, silkList(FILTER_TYPE_NAMES, 2));
  return el;
}
