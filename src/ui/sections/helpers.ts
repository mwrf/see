/** Small helpers shared by panel sections. */

export function section(title: string, className = ''): { el: HTMLElement; body: HTMLElement } {
  const el = document.createElement('section');
  el.className = `panel-section ${className}`;
  el.innerHTML = `<h2 class="section-title">${title}</h2><div class="section-body"></div>`;
  return { el, body: el.querySelector('.section-body') as HTMLElement };
}

export function row(className = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `control-row ${className}`;
  return el;
}

/** Silkscreen list — the printed reference tables on the hardware panel. */
export function silkList(items: string[], columns = 2, numbered = true): HTMLElement {
  const el = document.createElement('div');
  el.className = 'silk-list';
  el.style.setProperty('--silk-cols', String(columns));
  el.innerHTML = items
    .map((name, i) => `<span>${numbered ? `<i>${i + 1}</i>` : ''}${name}</span>`)
    .join('');
  return el;
}
