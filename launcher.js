const SETTINGS_ID = 'inspiration_board_settings';
const LAUNCHER_ID = 'ib-mobile-launcher';
const STYLE_ID = 'ib-launcher-fix-style';
const DIALOG_ID = 'ib-board-dialog-host';
const VERSION = '0.1.2';

let boardModulePromise = null;
let boardModule = null;
let rootObserver = null;
let bootTimer = null;

function notify(message, type = 'info') {
  const toaster = globalThis.toastr;
  if (toaster && typeof toaster[type] === 'function') {
    toaster[type](message, 'Inspiration Board');
    return;
  }
  console[type === 'error' ? 'error' : 'log'](`[Inspiration Board] ${message}`);
}

function setStatus(message, isError = false) {
  document.querySelectorAll('[data-ib-status]').forEach((element) => {
    element.textContent = message;
    element.style.color = isError ? '#ff8a9a' : '';
  });
}

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
    #${SETTINGS_ID} .ib-settings-status { margin-top:8px; opacity:.8; font-size:.82em; }
    #${DIALOG_ID} {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      width: 100dvw !important;
      height: 100vh !important;
      height: 100dvh !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      overflow: hidden !important;
      color: inherit !important;
    }
    #${DIALOG_ID}::backdrop { background: rgba(0,0,0,.45); }
    #${DIALOG_ID}:not([open]) { display: none !important; }
    #${DIALOG_ID} > #st-inspiration-board {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      z-index: 1 !important;
    }
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
    button.dataset.ibOpen = 'true';
    button.setAttribute('aria-label', 'Open Inspiration Board');
    button.title = 'Open Inspiration Board';
    button.innerHTML = '<span aria-hidden="true">✦</span><span class="ib-mobile-launch-text">Board</span>';
  }
  if (button.parentElement !== document.body && document.body) {
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
        <button type="button" class="menu_button interactable" data-ib-open="true">✦ Open Inspiration Board</button>
        <button type="button" class="menu_button interactable" data-ib-show-launcher="true">Show floating button</button>
      </div>
      <div class="ib-settings-note">
        Visual character-reference canvas. Add many photos at once, pan and pinch to zoom, organize references, and send a character draft into SillyTavern's creator.
      </div>
      <div class="ib-settings-status" data-ib-status>Ready · v${VERSION}</div>
    </div>
  `;
  host.appendChild(panel);
  return true;
}

function ensureDialogHost() {
  injectLauncherStyles();
  let dialog = document.getElementById(DIALOG_ID);
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.setAttribute('aria-label', 'Inspiration Board');
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeBoardSafe();
    });
    document.body.appendChild(dialog);
  } else if (dialog.parentElement !== document.body) {
    document.body.appendChild(dialog);
  }
  return dialog;
}

function removeStaleBoardElements() {
  document.querySelectorAll('#st-inspiration-board').forEach((element) => element.remove());
  document.querySelectorAll('#ib-launcher').forEach((element) => element.remove());
}

async function loadBoardModule() {
  if (boardModulePromise) return boardModulePromise;

  setStatus('Loading board code…');
  removeStaleBoardElements();
  const moduleUrl = new URL('./index.js?v=0.1.2', import.meta.url).href;
  boardModulePromise = import(moduleUrl)
    .then((module) => {
      if (typeof module.openBoard !== 'function' || typeof module.closeBoard !== 'function') {
        throw new Error('Board module did not export openBoard and closeBoard.');
      }
      boardModule = module;
      document.querySelector('#ib-launcher')?.remove();
      setStatus(`Ready · v${VERSION}`);
      return module;
    })
    .catch((error) => {
      boardModulePromise = null;
      boardModule = null;
      throw error;
    });

  return boardModulePromise;
}

function observeBoardRoot(root, dialog) {
  rootObserver?.disconnect();
  rootObserver = new MutationObserver(() => {
    if (!root.classList.contains('open') && dialog.open) {
      dialog.close();
    }
  });
  rootObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
}

async function openBoardSafe() {
  try {
    const module = await loadBoardModule();
    let root = document.getElementById('st-inspiration-board');
    if (!root) {
      module.openBoard();
      root = document.getElementById('st-inspiration-board');
    }
    if (!root) throw new Error('The board interface was not created.');

    const dialog = ensureDialogHost();
    if (root.parentElement !== dialog) dialog.appendChild(root);

    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch (error) {
        console.warn('[Inspiration Board] showModal failed, using open fallback', error);
        dialog.setAttribute('open', '');
      }
    }

    module.openBoard();
    root.classList.add('open');
    root.style.setProperty('display', 'grid', 'important');
    observeBoardRoot(root, dialog);
    setStatus(`Open · v${VERSION}`);
  } catch (error) {
    console.error('[Inspiration Board] Could not open', error);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Error: ${message}`, true);
    notify(`Could not open the board: ${message}`, 'error');
    if (!globalThis.toastr) alert(`Inspiration Board could not open.\n\n${message}`);
  }
}

function closeBoardSafe() {
  try {
    boardModule?.closeBoard?.();
  } catch (error) {
    console.error('[Inspiration Board] close failed', error);
  }
  const root = document.getElementById('st-inspiration-board');
  root?.classList.remove('open');
  const dialog = document.getElementById(DIALOG_ID);
  if (dialog?.open) dialog.close();
  setStatus(`Ready · v${VERSION}`);
}

function pulseFloatingLauncher() {
  const button = ensureFloatingLauncher();
  button.animate?.([
    { transform: 'scale(1)' },
    { transform: 'scale(1.18)' },
    { transform: 'scale(1)' }
  ], { duration: 420 });
  setStatus('Floating button enabled. Close Extensions to see it.');
  notify('Floating Board button is enabled. Close the Extensions drawer to see it.', 'success');
}

function handleLauncherClick(event) {
  const openTarget = event.target.closest?.('[data-ib-open]');
  if (openTarget) {
    event.preventDefault();
    event.stopPropagation();
    void openBoardSafe();
    return;
  }

  const launcherTarget = event.target.closest?.('[data-ib-show-launcher]');
  if (launcherTarget) {
    event.preventDefault();
    event.stopPropagation();
    pulseFloatingLauncher();
  }
}

function bootLauncher() {
  injectLauncherStyles();
  ensureFloatingLauncher();
  buildSettingsPanel();

  // Capture clicks before SillyTavern's drawer handlers. This also survives
  // themes or extensions that rebuild the settings panel after startup.
  if (!globalThis.__inspirationBoardClickHandlerInstalled) {
    document.addEventListener('click', handleLauncherClick, true);
    globalThis.__inspirationBoardClickHandlerInstalled = true;
  }

  clearInterval(bootTimer);
  let attempts = 0;
  bootTimer = setInterval(() => {
    attempts += 1;
    ensureFloatingLauncher();
    const settingsReady = buildSettingsPanel();
    if ((settingsReady && attempts >= 12) || attempts >= 60) {
      clearInterval(bootTimer);
      bootTimer = null;
    }
  }, 500);

  globalThis.InspirationBoard = {
    open: openBoardSafe,
    close: closeBoardSafe,
    showLauncher: pulseFloatingLauncher,
    version: VERSION
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLauncher, { once: true });
} else {
  bootLauncher();
}
