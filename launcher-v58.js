import './launcher-v57.js?v=0.5.8';
import { installOpenRouterGenerator, openOpenRouterGenerator } from './openrouter-gen-v58.js?v=0.5.8';

const VERSION = '0.5.8';
let timer = null;
let lastOpenAt = 0;
let capturePointerHandler = null;
let captureClickHandler = null;

function appForGenerator() {
  return globalThis.InspirationBoard?.app || null;
}

function openNewQuickGenerator(event) {
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
    openNewQuickGenerator(event);
  };
  captureClickHandler = event => openNewQuickGenerator(event);

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
  if (note) note.textContent = 'Quick Generate now uses live OpenRouter Image API capabilities and pricing, remembers its controls and prompt, and uses the dedicated Images API for reference-guided generation.';
  const app = bridge?.app;
  if (app) installOpenRouterGenerator(app);
}

function boot() {
  enhance();
  replaceLegacyGenerateHandlers();
  clearInterval(timer);
  timer = setInterval(() => {
    enhance();
    // launcher-v21 can rebind the target button during its compatibility interval.
    // Capture-phase handlers above remain authoritative, but keep the legacy touch
    // listener removed if an older launcher reintroduces it.
    const legacyTouch = globalThis.__ibOpenRouterTouchFallback;
    if (typeof legacyTouch === 'function') {
      document.removeEventListener('pointerdown', legacyTouch, true);
      globalThis.__ibOpenRouterTouchFallback = null;
    }
  }, 700);
  console.info(`[Inspiration Board] Quick Generate v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
