/** Boot: start overlay (audio needs a user gesture), engine init, UI mount. */

import { loadGlobal, restoreSession } from './boot-restore';
import { startEngine } from './engine/audio-context';
import { attachEngineBridge } from './state/engine-bridge';
import { store } from './state/store';
import { mountPanel } from './ui/panel';
import './ui/styles/theme.css';
import './ui/styles/panel.css';
import './ui/styles/controls.css';
import './ui/styles/portrait.css';

const root = document.getElementById('app')!;

const overlay = document.createElement('div');
overlay.className = 'start-overlay';
overlay.innerHTML = `
  <div class="start-card">
    <div class="start-logo">EMX<span>web</span></div>
    <div class="start-sub">ELECTRIBE MX · MUSIC PRODUCTION STATION</div>
    <button class="start-btn" type="button">TAP TO POWER ON</button>
    <div class="start-hint">audio starts after a tap (browser requirement)</div>
  </div>
`;
document.body.appendChild(overlay);

mountPanel(root);
void loadGlobal();

overlay.querySelector('.start-btn')!.addEventListener('click', () => {
  void (async () => {
    overlay.classList.add('starting');
    try {
      const engine = await startEngine();
      attachEngineBridge(engine);
      await restoreSession(engine);
      store.update(['ui', 'lcd'], (s) => {
        s.audioStarted = true;
        s.lcd.line1 = 'ELECTRIBE MX';
        s.lcd.line2 = 'READY';
      });
      overlay.remove();
    } catch (err) {
      overlay.classList.remove('starting');
      const hint = overlay.querySelector('.start-hint')!;
      hint.textContent = `audio failed to start: ${(err as Error).message}`;
    }
  })();
});
