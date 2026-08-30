import './launcher-v57.js?v=0.6.1';
import { installOpenRouterGenerator, openOpenRouterGenerator } from './openrouter-gen-v58.js?v=0.6.1';
import { installGeneratedGallery } from './openrouter-gallery-v59.js?v=0.6.1';
import { installOpenRouterModelBrowser } from './openrouter-browser-v60.js?v=0.6.1';
import { installVeniceGenerator, openVeniceGenerator } from './venice-gen-v61.js?v=0.6.1';

const VERSION = '0.6.1';
const PROVIDER_KEY = 'st_inspiration_board_media_provider_v60';
let timer = null;
let lastOpenAt = 0;
let capturePointerHandler = null;
let captureClickHandler = null;

function appForGenerator() {
  return globalThis.InspirationBoard?.app || null;
}

function openOpenRouter(app = appForGenerator()) {
  if (!app) return;
  localStorage.setItem(PROVIDER_KEY, 'openrouter');
  void openOpenRouterGenerator(app);
}

function openVenice(app = appForGenerator()) {
  if (!app) return;
  localStorage.setItem(PROVIDER_KEY, 'venice');
  void openVeniceGenerator(app, { openOpenRouter });
}

function openRememberedProvider(app = appForGenerator()) {
  const provider = localStorage.getItem(PROVIDER_KEY) || 'openrouter';
  if (provider === 'venice') openVenice(app);
  else openOpenRouter(app);
}

function openMediaGenerator(event) {
  const target = event.target?.closest?.('[data-cmd="openrouter-gen"]');
  if (!target) return;
  const app = appForGenerator();
  if (!app) return;

  const now = Date.now();
  if (now - lastOpenAt < 500) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  lastOpenAt = now;
  event.preventDefault();
  event.stopImmediatePropagation();
  openRememberedProvider(app);
}

function replaceLegacyGenerateHandlers() {
  const legacyTouch = globalThis.__ibOpenRouterTouchFallback;
  if (typeof legacyTouch === 'function') {
    document.removeEventListener('pointerdown', legacyTouch, true);
    globalThis.__ibOpenRouterTouchFallback = null;
  }

  if (capturePointerHandler) document.removeEventListener('pointerdown', capturePointerHandler, true);
  if (captureClickHandler) document.removeEventListener('click', captureClickHandler, true);

  capturePointerHandler = event => {
    if (event.pointerType === 'mouse') return;
    openMediaGenerator(event);
  };
  captureClickHandler = event => openMediaGenerator(event);

  document.addEventListener('pointerdown', capturePointerHandler, true);
  document.addEventListener('click', captureClickHandler, true);
}

function enhance() {
  const bridge = globalThis.InspirationBoard;
  if (bridge) bridge.version = VERSION;
  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {
    if (!/Loading|Opening|Open|Error/i.test(element.textContent || '')) element.textContent = `Ready · v${VERSION}`;
  });
  const note = document.querySelector('#inspiration_board_settings .ib-v2-settings-note');
  if (note) note.textContent = 'Generate now includes reference-integrity checks for Venice: text-to-image clearly disables references, Edit/Ref models show the exact base/source plan, and completed edits report the reference endpoint/count actually sent.';

  const app = bridge?.app;
  if (app) installOpenRouterGenerator(app);
  installOpenRouterModelBrowser({ openVenice });
  installVeniceGenerator({ openOpenRouter });
  installGeneratedGallery();
}

function boot() {
  enhance();
  replaceLegacyGenerateHandlers();
  clearInterval(timer);
  timer = setInterval(() => {
    enhance();
    const legacyTouch = globalThis.__ibOpenRouterTouchFallback;
    if (typeof legacyTouch === 'function') {
      document.removeEventListener('pointerdown', legacyTouch, true);
      globalThis.__ibOpenRouterTouchFallback = null;
    }
  }, 700);
  console.info(`[Inspiration Board] Media generator v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
