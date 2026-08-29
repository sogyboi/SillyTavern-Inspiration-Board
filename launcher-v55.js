import './launcher-v41.js?v=0.5.5';
import { installCaptureBrowserBridge } from './capture-browser-v5.js?v=0.5.5';

const VERSION = '0.5.5';
let timer = null;

function enhance() {
  const bridge = globalThis.InspirationBoard;
  if (bridge) bridge.version = VERSION;
  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {
    if (!/Loading|Opening|Open|Error/i.test(element.textContent || '')) element.textContent = `Ready · v${VERSION}`;
  });
  const note = document.querySelector('#inspiration_board_settings .ib-v2-settings-note');
  if (note) note.textContent = 'Capture-first character workspace. v0.5.5 fixes the SillyTavern server JSON save path; Android Capture Browser v0.5.4 remains compatible and Android Share stays available as fallback.';
  const app = bridge?.app;
  if (app) installCaptureBrowserBridge(app);
}

function boot() {
  enhance();
  clearInterval(timer);
  timer = setInterval(enhance, 700);
  console.info(`[Inspiration Board] Capture Browser integration v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
