/**
 * Rotary knob control — vertical drag, touch friendly, double-tap resets.
 * Value range/format comes from the param registry. The `target` resolver
 * lets one physical knob follow the selected part (like the hardware panel).
 */

import { getParam, setParam } from '../../state/actions';
import { store } from '../../state/store';
import type { MotionTarget } from '../../shared/model';
import { paramDef } from '../../shared/params';

export interface Control {
  el: HTMLElement;
  dispose(): void;
}

export interface KnobSpec {
  label: string;
  /** Resolve the current binding, or null when the knob is inactive for this part. */
  resolve(): { target: MotionTarget; paramId: string } | null;
  size?: 'sm' | 'md' | 'lg';
}

const SWEEP = 270; // degrees of rotation
const START = -135;

export function createKnob(spec: KnobSpec): Control {
  const el = document.createElement('div');
  el.className = `knob knob-${spec.size ?? 'md'}`;
  el.innerHTML = `
    <div class="knob-dial" tabindex="0" role="slider" aria-label="${spec.label}">
      <div class="knob-cap"><div class="knob-pointer"></div></div>
    </div>
    <div class="knob-label">${spec.label}</div>
  `;
  const dial = el.querySelector('.knob-dial') as HTMLElement;
  const cap = el.querySelector('.knob-cap') as HTMLElement;

  let binding = spec.resolve();

  function refresh(): void {
    binding = spec.resolve();
    if (!binding) {
      el.classList.add('knob-disabled');
      cap.style.transform = `rotate(${START}deg)`;
      return;
    }
    el.classList.remove('knob-disabled');
    const def = paramDef(binding.paramId);
    const v = getParam(binding.target, binding.paramId);
    const t = (v - def.min) / (def.max - def.min || 1);
    cap.style.transform = `rotate(${START + t * SWEEP}deg)`;
    dial.setAttribute('aria-valuenow', String(Math.round(v)));
    dial.setAttribute('aria-valuemin', String(def.min));
    dial.setAttribute('aria-valuemax', String(def.max));
  }

  let dragStartY = 0;
  let dragStartValue = 0;
  let lastTap = 0;

  function onPointerDown(e: PointerEvent): void {
    if (!binding) return;
    e.preventDefault();
    dial.setPointerCapture(e.pointerId);
    dragStartY = e.clientY;
    dragStartValue = getParam(binding.target, binding.paramId);
    el.classList.add('knob-active');
    const now = performance.now();
    if (now - lastTap < 300) {
      // double-tap: reset to default
      setParam(binding.target, binding.paramId, paramDef(binding.paramId).def);
      refresh();
    }
    lastTap = now;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!binding || !dial.hasPointerCapture(e.pointerId)) return;
    const def = paramDef(binding.paramId);
    const range = def.max - def.min || 1;
    // full range over ~180px of vertical travel; horizontal adds fine control
    const delta = ((dragStartY - e.clientY) / 180) * range;
    let v = dragStartValue + delta;
    v = Math.min(def.max, Math.max(def.min, v));
    if (def.stepped) v = Math.round(v);
    setParam(binding.target, binding.paramId, v);
    refresh();
  }

  function onPointerUp(e: PointerEvent): void {
    if (dial.hasPointerCapture(e.pointerId)) dial.releasePointerCapture(e.pointerId);
    el.classList.remove('knob-active');
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!binding) return;
    const def = paramDef(binding.paramId);
    const stepSize = def.stepped ? 1 : (def.max - def.min) / 32;
    let v = getParam(binding.target, binding.paramId);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v += stepSize;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v -= stepSize;
    else return;
    e.preventDefault();
    setParam(binding.target, binding.paramId, Math.min(def.max, Math.max(def.min, v)));
    refresh();
  }

  dial.addEventListener('pointerdown', onPointerDown);
  dial.addEventListener('pointermove', onPointerMove);
  dial.addEventListener('pointerup', onPointerUp);
  dial.addEventListener('pointercancel', onPointerUp);
  dial.addEventListener('keydown', onKeyDown);

  const unsubs = [
    store.subscribe('params', refresh),
    store.subscribe('ui', refresh),
    store.subscribe('pattern', refresh),
  ];
  refresh();

  return {
    el,
    dispose() {
      unsubs.forEach((u) => u());
    },
  };
}
