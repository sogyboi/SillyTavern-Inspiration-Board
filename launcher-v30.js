import './launcher-v21.js?v=0.3.0';
import { installGenerationStudio } from './studio-v3.js?v=0.3.0';

const VERSION = '0.3.0';
let timer = null;

function enhance() {
  const bridge = globalThis.InspirationBoard;
  if (bridge) bridge.version = VERSION;
  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {
    if (!/Loading|Opening|Open|Error/i.test(element.textContent || '')) element.textContent = `Ready · v${VERSION}`;
  });
  const note = document.querySelector('#inspiration_board_settings .ib-v2-settings-note');
  if (note) note.textContent = 'Character design and generation workspace with blueprints, reference controls, OpenRouter Generation Studio, queue/history, image editing, visual organization, Android sharing, and optional server sync.';
  const app = bridge?.app;
  if (app) installGenerationStudio(app);
}

function boot() {
  enhance();
  clearInterval(timer);
  timer = setInterval(enhance, 700);
  console.info(`[Inspiration Board] Generation Studio v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
