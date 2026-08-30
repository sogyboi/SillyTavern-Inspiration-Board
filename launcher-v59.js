import './launcher-v57.js?v=0.5.9';
import { installOpenRouterGenerator, openOpenRouterGenerator } from './openrouter-gen-v58.js?v=0.5.9';
import { installGeneratedGallery } from './openrouter-gallery-v59.js?v=0.5.9';

const VERSION = '0.5.9';
let timer = null;
let lastOpenAt = 0;
let capturePointerHandler = null;
let captureClickHandler = null;

function appForGenerator() {
  return globalThis.InspirationBoard?.app || null;
}

function openQuickGenerator(event) {
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
  void openOpenRouterGenerator(app);
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
    openQuickGenerator(event);
  };
  captureClickHandler = event => openQuickGenerator(event);

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
  if (note) note.textContent = 'Quick Generate keeps live OpenRouter pricing/capabilities and now shows completed generations as large full-aspect previews directly under Generate with tap-to-view full-screen navigation.';
  const app = bridge?.app;
  if (app) installOpenRouterGenerator(app);
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
  console.info(`[Inspiration Board] Generated gallery v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
