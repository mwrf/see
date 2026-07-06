/** Panel buttons: momentary or toggle, with an optional LED. */

export interface ButtonSpec {
  label: string;
  led?: boolean;
  className?: string;
  onPress?: () => void;
  onRelease?: () => void;
  onLongPress?: () => void;
}

export interface PanelButton {
  el: HTMLElement;
  setLed(on: boolean, color?: 'red' | 'green' | 'orange'): void;
  setActive(on: boolean): void;
}

export function createButton(spec: ButtonSpec): PanelButton {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `pbtn ${spec.className ?? ''}`;
  el.innerHTML = `${spec.led ? '<span class="pbtn-led"></span>' : ''}<span class="pbtn-label">${spec.label}</span>`;
  const led = el.querySelector('.pbtn-led') as HTMLElement | null;

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longFired = false;

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    longFired = false;
    if (spec.onLongPress) {
      longPressTimer = setTimeout(() => {
        longFired = true;
        spec.onLongPress?.();
      }, 500);
    }
    if (!spec.onLongPress) spec.onPress?.();
  });
  el.addEventListener('pointerup', (e) => {
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (spec.onLongPress && !longFired) spec.onPress?.();
    spec.onRelease?.();
  });
  el.addEventListener('pointercancel', () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    spec.onRelease?.();
  });

  return {
    el,
    setLed(on, color = 'red') {
      if (!led) return;
      led.className = `pbtn-led ${on ? `led-on led-${color}` : ''}`;
    },
    setActive(on) {
      el.classList.toggle('pbtn-active', on);
    },
  };
}
