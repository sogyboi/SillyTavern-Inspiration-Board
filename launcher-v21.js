import './launcher-v2.js?v=0.2.1';
import { installOpenRouterGenerator } from './openrouter-gen-v21.js?v=0.2.1';

const VERSION = '0.2.1';
let enhanceTimer = null;

function enhance() {
  const bridge = globalThis.InspirationBoard;
  if (bridge) bridge.version = VERSION;
  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {
    if (!/Loading|Opening|Open|Error/i.test(element.textContent || '')) element.textContent = `Ready · v${VERSION}`;
  });
  const note = document.querySelector('#inspiration_board_settings .ib-v2-settings-note');
  if (note) note.textContent = 'Character-reference workspace with bulk image organization, OpenRouter image generation, reference-guided generation, AI-assisted drafting, board templates, snapshots, PNG export and Z Fold touch controls.';
  const app = bridge?.app;
  if (app) installOpenRouterGenerator(app);
}

function boot() {
  enhance();
  clearInterval(enhanceTimer);
  enhanceTimer = setInterval(enhance, 700);
  console.info(`[Inspiration Board] OpenRouter image generation v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
