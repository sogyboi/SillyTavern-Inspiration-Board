import { openBoard } from './index.js';

const SETTINGS_ID = 'inspiration_board_settings';
const LAUNCHER_ID = 'ib-mobile-launcher';
const STYLE_ID = 'ib-launcher-fix-style';

function injectLauncherStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${LAUNCHER_ID} {
      position: fixed !important;
      right: 16px !important;
      bottom: 108px !important;
      z-index: 2147483000 !important;
      min-width: 54px !important;
      height: 54px !important;
      padding: 0 16px !important;
      border: 1px solid rgba(255,255,255,.18) !important;
      border-radius: 27px !important;
      background: linear-gradient(145deg,#916cff,#5f43c7) !important;
      color: #fff !important;
      box-shadow: 0 10px 28px rgba(0,0,0,.55), 0 0 0 2px rgba(141,104,255,.16) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 7px !important;
      font: 700 15px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
      cursor: pointer !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
    }
    #${LAUNCHER_ID}:active { transform: scale(.96); }
    #${LAUNCHER_ID} .ib-mobile-launch-text { display: none; }
    #${SETTINGS_ID} .ib-settings-actions { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0; }
    #${SETTINGS_ID} .ib-settings-actions button { min-height:40px; }
    #${SETTINGS_ID} .ib-settings-note { opacity:.75; font-size:.9em; line-height:1.35; }
    @media (min-width: 600px) {
      #${LAUNCHER_ID} { min-width: 108px !important; }
      #${LAUNCHER_ID} .ib-mobile-launch-text { display: inline; }
    }
  `;
  document.head.appendChild(style);
}

function ensureFloatingLauncher() {
  injectLauncherStyles();
  let button = document.getElementById(LAUNCHER_ID);
  if (!button) {
    button = document.createElement('button');
    button.id = LAUNCHER_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'Open Inspiration Board');
    button.title = 'Open Inspiration Board';
    button.innerHTML = '<span aria-hidden="true">✦</span><span class="ib-mobile-launch-text">Board</span>';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBoard();
    });
    document.body.appendChild(button);
  } else if (button.parentElement !== document.body) {
    document.body.appendChild(button);
  }
  return button;
}

function buildSettingsPanel() {
  if (document.getElementById(SETTINGS_ID)) return true;
  const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
  if (!host) return false;

  const panel = document.createElement('div');
  panel.id = SETTINGS_ID;
  panel.className = 'inline-drawer';
  panel.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Inspiration Board</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="ib-settings-actions">
        <button type="button" class="menu_button" data-ib-open>✦ Open Inspiration Board</button>
        <button type="button" class="menu_button" data-ib-launcher>Show floating button</button>
      </div>
      <div class="ib-settings-note">
        Visual character-reference canvas. Add many photos at once, pan and pinch to zoom, organize references, and send a character draft into SillyTavern's creator.
      </div>
    </div>
  `;
  host.appendChild(panel);

  panel.querySelector('[data-ib-open]')?.addEventListener('click', openBoard);
  panel.querySelector('[data-ib-launcher]')?.addEventListener('click', () => {
    const button = ensureFloatingLauncher();
    button.animate?.([
      { transform: 'scale(1)' },
      { transform: 'scale(1.18)' },
      { transform: 'scale(1)' }
    ], { duration: 420 });
  });

  const header = panel.querySelector('.inline-drawer-toggle');
  const content = panel.querySelector('.inline-drawer-content');
  if (header && content) {
    content.style.display = 'none';
    header.addEventListener('click', () => {
      const open = content.style.display !== 'none';
      content.style.display = open ? 'none' : '';
      panel.querySelector('.inline-drawer-icon')?.classList.toggle('down', open);
      panel.querySelector('.inline-drawer-icon')?.classList.toggle('up', !open);
    });
  }
  return true;
}

function bootLauncherFix() {
  ensureFloatingLauncher();
  buildSettingsPanel();

  // SillyTavern builds parts of the Extensions page after third-party modules load.
  // Retry briefly so the settings entry appears even on slow Android devices.
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    ensureFloatingLauncher();
    const settingsReady = buildSettingsPanel();
    if ((settingsReady && attempts >= 4) || attempts >= 30) clearInterval(timer);
  }, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLauncherFix, { once: true });
} else {
  bootLauncherFix();
}
