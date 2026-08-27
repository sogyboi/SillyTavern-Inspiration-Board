const VERSION = '0.2.0';
const SETTINGS_ID = 'inspiration_board_settings';
const TOP_WRAPPER_ID = 'ib-topbar-drawer-v2';
const TOP_BUTTON_ID = 'ib-topbar-button-v2';
const STYLE_ID = 'ib-launcher-v2-style';

let appModulePromise = null;
let appModule = null;
let repairTimer = null;
let lastPressAt = 0;

function toast(message, type = 'info') {
  const toaster = globalThis.toastr;
  if (toaster && typeof toaster[type] === 'function') toaster[type](message, 'Inspiration Board');
  else console[type === 'error' ? 'error' : 'log']('[Inspiration Board]', message);
}

function setStatus(message, isError = false) {
  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {
    element.textContent = message;
    element.style.color = isError ? '#ff8fa0' : '';
  });
}

function injectStyles() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    #${SETTINGS_ID} .ib-v2-settings-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
    #${SETTINGS_ID} .ib-v2-settings-actions button{min-height:42px;touch-action:manipulation}
    #${SETTINGS_ID} .ib-v2-settings-note{opacity:.76;line-height:1.35}
    #${SETTINGS_ID} [data-ib-v2-status]{margin-top:8px;color:#bcaeff;font-size:.84em;font-weight:600}
    #${TOP_WRAPPER_ID}{display:block!important}
    #${TOP_BUTTON_ID}{display:inline-block!important;cursor:pointer!important;pointer-events:auto!important;touch-action:manipulation!important;color:var(--SmartThemeBodyColor)!important;opacity:.42!important}
    #${TOP_BUTTON_ID}:hover,#${TOP_BUTTON_ID}:active,#${TOP_BUTTON_ID}.ib-open{opacity:1!important;color:#a98cff!important;filter:drop-shadow(0 0 5px rgba(141,104,255,.68))}
  `;
}

function bindPress(element, action) {
  if (!element) return;
  const invoke = event => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const now = Date.now();
    if (now - lastPressAt < 350) return;
    lastPressAt = now;
    action();
  };
  element.onpointerdown = invoke;
  element.ontouchstart = invoke;
  element.onclick = invoke;
  element.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') invoke(event);
  };
}

async function loadApp() {
  if (appModule) return appModule;
  if (!appModulePromise) {
    setStatus(`Loading v${VERSION}…`);
    const url = new URL('./app-v2.js?v=0.2.0', import.meta.url).href;
    appModulePromise = import(url).then(module => {
      if (typeof module.openBoard !== 'function') throw new Error('The v0.2 board module did not export openBoard().');
      appModule = module;
      setStatus(`Ready · v${VERSION}`);
      return module;
    }).catch(error => {
      appModulePromise = null;
      appModule = null;
      throw error;
    });
  }
  return appModulePromise;
}

async function openBoard() {
  try {
    setStatus(`Opening · v${VERSION}`);
    const module = await loadApp();
    module.openBoard();
    document.getElementById(TOP_BUTTON_ID)?.classList.add('ib-open');
    setStatus(`Open · v${VERSION}`);
  } catch (error) {
    console.error('[Inspiration Board] open failed', error);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Error · ${message}`, true);
    toast(message, 'error');
  }
}

function ensureSettingsPanel() {
  const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
  if (!host) return false;
  let panel = document.getElementById(SETTINGS_ID);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = SETTINGS_ID;
    panel.className = 'inline-drawer';
    panel.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Inspiration Board</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="ib-v2-settings-actions">
          <button id="ib-open-settings-v2" type="button" class="menu_button interactable">✦ Open Inspiration Board</button>
        </div>
        <div class="ib-v2-settings-note">Character-reference workspace with a multi-photo Inbox, groups, lasso selection, reference basket, AI-assisted drafting, board templates, snapshots, PNG export and Z Fold touch controls.</div>
        <div data-ib-v2-status>Ready · v${VERSION}</div>
      </div>`;
    host.appendChild(panel);
  } else if (panel.parentElement !== host) {
    host.appendChild(panel);
  }
  const status = panel.querySelector('[data-ib-v2-status]');
  if (status && !/Loading|Opening|Open|Error/.test(status.textContent || '')) status.textContent = `Ready · v${VERSION}`;
  bindPress(panel.querySelector('#ib-open-settings-v2'), () => void openBoard());
  return true;
}

function ensureTopBarButton() {
  const holder = document.getElementById('top-settings-holder');
  if (!holder) return false;
  let wrapper = document.getElementById(TOP_WRAPPER_ID);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = TOP_WRAPPER_ID;
    wrapper.className = 'drawer';
    wrapper.innerHTML = `<div class="drawer-toggle drawer-header"><div id="${TOP_BUTTON_ID}" class="drawer-icon fa-solid fa-images fa-fw closedIcon interactable" role="button" tabindex="0" title="Inspiration Board" aria-label="Open Inspiration Board"></div></div>`;
    holder.appendChild(wrapper);
  } else if (wrapper.parentElement !== holder) {
    holder.appendChild(wrapper);
  }
  bindPress(wrapper.querySelector(`#${TOP_BUTTON_ID}`), () => void openBoard());
  return true;
}

function removeLegacyLaunchers() {
  ['ib-mobile-launcher', 'ib-mobile-launcher-v015', 'ib-topbar-launcher-v016', 'ib-launcher'].forEach(id => document.getElementById(id)?.remove());
}

function boot() {
  injectStyles();
  removeLegacyLaunchers();
  ensureSettingsPanel();
  ensureTopBarButton();

  clearInterval(repairTimer);
  let attempts = 0;
  repairTimer = setInterval(() => {
    attempts++;
    ensureSettingsPanel();
    ensureTopBarButton();
    const root = document.getElementById('st-inspiration-board');
    document.getElementById(TOP_BUTTON_ID)?.classList.toggle('ib-open', Boolean(root?.classList.contains('open')));
    if (attempts > 180) {
      clearInterval(repairTimer);
      repairTimer = null;
    }
  }, 1000);

  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      void openBoard();
    }
  });

  globalThis.InspirationBoard = {
    open: openBoard,
    version: VERSION,
    get app() { return appModule?.getApp?.() || null; },
  };
  console.info(`[Inspiration Board] launcher v${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
