import './launcher-v56.js?v=0.5.7';
import { installGenerationStudio } from './studio-v3.js?v=0.5.7';

const VERSION = '0.5.7';
let timer = null;

function enhance() {
  const bridge = globalThis.InspirationBoard;
  if (bridge) bridge.version = VERSION;
  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {
    if (!/Loading|Opening|Open|Error/i.test(element.textContent || '')) element.textContent = `Ready · v${VERSION}`;
  });
  const note = document.querySelector('#inspiration_board_settings .ib-v2-settings-note');
  if (note) note.textContent = 'Capture-first character workspace with OpenRouter image price discovery and visible generation lifecycle status. Model prices are labeled honestly as flat per-image, from-price, megapixel, token-priced, or unavailable.';
  const app = bridge?.app;
  if (app) installGenerationStudio(app);
}

function boot() {
  enhance();
  clearInterval(timer);
  timer = setInterval(enhance, 700);
  console.info(`[Inspiration Board] OpenRouter pricing + generation status v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
