const VERSION = '0.1.5';
const SETTINGS_ID = 'inspiration_board_settings';
const FLOAT_ID = 'ib-mobile-launcher-v015';
const STYLE_ID = 'ib-launcher-v015-style';

let modulePromise = null;
let boardModule = null;
let lastActionAt = 0;
let repairTimer = null;

function toast(message, type = 'info') {
  const t = globalThis.toastr;
  if (t && typeof t[type] === 'function') t[type](message, 'Inspiration Board');
  else console[type === 'error' ? 'error' : 'log']('[Inspiration Board]', message);
}

function status(message, error = false) {
  document.querySelectorAll('[data-ib-status]').forEach(el => {
    el.textContent = message;
    el.style.color = error ? '#ff8b9b' : '';
  });
}

function injectStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    #${FLOAT_ID}{position:fixed!important;right:16px!important;bottom:92px!important;z-index:2147483646!important;height:56px!important;min-width:56px!important;padding:0 16px!important;border:1px solid rgba(255,255,255,.22)!important;border-radius:28px!important;background:linear-gradient(145deg,#956fff,#5a40c8)!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;font:700 15px/1 system-ui,sans-serif!important;box-shadow:0 10px 30px #0009!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;touch-action:manipulation!important}
    #${FLOAT_ID}:active{transform:scale(.94)!important}
    #${SETTINGS_ID} .ib-settings-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
    #${SETTINGS_ID} .ib-settings-actions button{min-height:42px!important;touch-action:manipulation!important;pointer-events:auto!important}
    #${SETTINGS_ID} .ib-settings-note{opacity:.76;line-height:1.35}
    #${SETTINGS_ID} .ib-settings-status{margin-top:9px;font-size:.84em;font-weight:600;color:#b9adff}
    #st-inspiration-board{z-index:2147483645!important}
    #st-inspiration-board.open{display:grid!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important}
    @media(min-width:600px){#${FLOAT_ID} .ib-float-label{display:inline}}@media(max-width:599px){#${FLOAT_ID} .ib-float-label{display:none}}
  `;
}

function runOnce(fn) {
  const now = Date.now();
  if (now - lastActionAt < 450) return;
  lastActionAt = now;
  fn();
}

function bindButton(button, action) {
  if (!button) return;
  button.disabled = false;
  button.style.pointerEvents = 'auto';
  button.style.touchAction = 'manipulation';
  const invoke = event => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    runOnce(action);
  };
  button.onpointerdown = invoke;
  button.ontouchstart = invoke;
  button.onclick = invoke;
}

function ensureFloatingButton() {
  injectStyle();
  let button = document.getElementById(FLOAT_ID);
  if (!button) {
    button = document.createElement('button');
    button.id = FLOAT_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'Open Inspiration Board');
    button.innerHTML = '<span>✦</span><span class="ib-float-label">Board</span>';
  }
  if (document.body && button.parentElement !== document.body) document.body.appendChild(button);
  bindButton(button, () => void openBoard());
  return button;
}

function ensureSettingsPanel() {
  injectStyle();
  const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
  if (!host) return false;
  let panel = document.getElementById(SETTINGS_ID);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = SETTINGS_ID;
    panel.className = 'inline-drawer';
    panel.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header"><b>Inspiration Board</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content">
        <div class="ib-settings-actions">
          <button id="ib-open-v015" type="button" class="menu_button interactable">✦ Open Inspiration Board</button>
          <button id="ib-float-v015" type="button" class="menu_button interactable">Show floating button</button>
        </div>
        <div class="ib-settings-note">Visual character-reference canvas. Add many photos at once, pan and pinch to zoom, organize references, and send a character draft into SillyTavern's creator.</div>
        <div class="ib-settings-status" data-ib-status>Ready · v${VERSION}</div>
      </div>`;
    host.appendChild(panel);
  } else {
    let actions = panel.querySelector('.ib-settings-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'ib-settings-actions';
      panel.querySelector('.inline-drawer-content')?.prepend(actions);
    }
    let open = panel.querySelector('#ib-open-v015');
    if (!open) {
      panel.querySelectorAll('[data-ib-open]').forEach(el => el.remove());
      open = document.createElement('button');
      open.id = 'ib-open-v015'; open.type = 'button'; open.className = 'menu_button interactable'; open.textContent = '✦ Open Inspiration Board'; actions.appendChild(open);
    }
    let float = panel.querySelector('#ib-float-v015');
    if (!float) {
      panel.querySelectorAll('[data-ib-show-launcher],[data-ib-launcher]').forEach(el => el.remove());
      float = document.createElement('button');
      float.id = 'ib-float-v015'; float.type = 'button'; float.className = 'menu_button interactable'; float.textContent = 'Show floating button'; actions.appendChild(float);
    }
    let s = panel.querySelector('[data-ib-status]');
    if (!s) {
      s = document.createElement('div'); s.className = 'ib-settings-status'; s.dataset.ibStatus = ''; panel.querySelector('.inline-drawer-content')?.appendChild(s);
    }
    s.textContent = `Ready · v${VERSION}`;
  }
  bindButton(panel.querySelector('#ib-open-v015'), () => void openBoard());
  bindButton(panel.querySelector('#ib-float-v015'), () => {
    const b = ensureFloatingButton();
    b.style.setProperty('display', 'flex', 'important');
    status(`Floating button shown · v${VERSION}`);
    toast('Floating Board button is visible.', 'success');
  });
  return true;
}

async function getModule() {
  if (boardModule) return boardModule;
  if (!modulePromise) {
    status(`Loading board… v${VERSION}`);
    const url = new URL('./index.js?v=0.1.5', import.meta.url).href;
    modulePromise = import(url).then(mod => {
      if (typeof mod.openBoard !== 'function') throw new Error('index.js did not export openBoard().');
      boardModule = mod;
      document.getElementById('ib-launcher')?.remove();
      return mod;
    }).catch(err => { modulePromise = null; throw err; });
  }
  return modulePromise;
}

async function openBoard() {
  status(`Opening… v${VERSION}`);
  try {
    const mod = await getModule();
    mod.openBoard();
    let root = document.getElementById('st-inspiration-board');
    if (!root) throw new Error('Board root was not created.');
    if (document.body && root.parentElement !== document.body) document.body.appendChild(root);
    root.classList.add('open');
    root.style.setProperty('display', 'grid', 'important');
    root.style.setProperty('z-index', '2147483645', 'important');
    document.documentElement.classList.add('ib-open');
    status(`Open · v${VERSION}`);
  } catch (err) {
    console.error('[Inspiration Board] open failed', err);
    const msg = err instanceof Error ? err.message : String(err);
    status(`ERROR · ${msg}`, true);
    toast(`Open failed: ${msg}`, 'error');
    try { alert(`Inspiration Board error:\n\n${msg}`); } catch {}
  }
}

function boot() {
  injectStyle();
  ensureFloatingButton();
  ensureSettingsPanel();

  // Capture-phase backup in case a theme swallows the target's normal event.
  const backup = event => {
    const target = event.target?.closest?.('#ib-open-v015,#ib-float-v015,#' + FLOAT_ID);
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    if (target.id === 'ib-float-v015') runOnce(() => { ensureFloatingButton(); status(`Floating button shown · v${VERSION}`); });
    else runOnce(() => void openBoard());
  };
  if (globalThis.__ibV015Backup) document.removeEventListener('pointerdown', globalThis.__ibV015Backup, true);
  document.addEventListener('pointerdown', backup, true);
  globalThis.__ibV015Backup = backup;

  clearInterval(repairTimer);
  let count = 0;
  repairTimer = setInterval(() => {
    count++;
    ensureFloatingButton();
    ensureSettingsPanel();
    if (count > 120) { clearInterval(repairTimer); repairTimer = null; }
  }, 1000);

  globalThis.InspirationBoard = { open: openBoard, version: VERSION, showLauncher: ensureFloatingButton };
  console.info(`[Inspiration Board] launcher ${VERSION} ready`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
