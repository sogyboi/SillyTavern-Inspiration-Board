import './launcher-v30.js?v=0.4.0';
import { installBrowseHub } from './browse-v4.js?v=0.4.0';

const VERSION = '0.4.0';
let timer = null;

function enhance() {
  const bridge = globalThis.InspirationBoard;
  if (bridge) bridge.version = VERSION;
  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {
    if (!/Loading|Opening|Open|Error/i.test(element.textContent || '')) element.textContent = `Ready · v${VERSION}`;
  });
  const note = document.querySelector('#inspiration_board_settings .ib-v2-settings-note');
  if (note) note.textContent = 'Character design workspace with Pinterest, Cosmos and web browsing, direct reference capture, OpenRouter Generation Studio, Android sharing, and optional phone/PC sync.';
  const app = bridge?.app;
  if (app) installBrowseHub(app);
}

function boot() {
  enhance();
  clearInterval(timer);
  timer = setInterval(enhance, 700);
  console.info(`[Inspiration Board] Browse Hub v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
