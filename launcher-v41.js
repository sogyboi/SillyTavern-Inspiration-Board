import './launcher-v30.js?v=0.5.1';
import { installBrowseHub } from './browse-hub-v4.js?v=0.5.1';
import { installCaptureFirst } from './capture-first-v41.js?v=0.5.1';

const VERSION = '0.4.1';
let timer = null;

function enhance() {
  const bridge = globalThis.InspirationBoard;
  if (bridge) bridge.version = VERSION;
  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {
    if (!/Loading|Opening|Open|Error/i.test(element.textContent || '')) element.textContent = `Ready · v${VERSION}`;
  });
  const note = document.querySelector('#inspiration_board_settings .ib-v2-settings-note');
  if (note) note.textContent = 'Capture-first visual character workspace: browse Pinterest/Cosmos in their real app or site, share or paste references into Capture Center, then route them directly to boards, reference roles, or Generation Studio.';
  const app = bridge?.app;
  if (app) installBrowseHub(app);
  if (app?.root?.isConnected) installCaptureFirst(app);
}

function boot() {
  enhance();
  clearInterval(timer);
  timer = setInterval(enhance, 700);
  console.info(`[Inspiration Board] Capture-first v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
