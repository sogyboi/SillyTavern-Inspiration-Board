import './launcher-015.js?v=0.1.6';

const VERSION = '0.1.6';
const TOP_ID = 'ib-topbar-launcher-v016';
const STYLE_ID = 'ib-topbar-launcher-v016-style';
let lastTap = 0;
let repairTimer = null;

function injectTopBarStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    #${TOP_ID}{
      display:inline-block!important;
      cursor:pointer!important;
      font-size:var(--topBarIconSize)!important;
      padding:1px 3px!important;
      color:var(--SmartThemeBodyColor)!important;
      opacity:.55!important;
      pointer-events:auto!important;
      touch-action:manipulation!important;
      transition:opacity .15s ease,color .15s ease,filter .15s ease!important;
    }
    #${TOP_ID}:hover,#${TOP_ID}:active{opacity:1!important;color:#a98cff!important;filter:drop-shadow(0 0 5px rgba(141,104,255,.65))!important}
    #${TOP_ID}.ib-board-open{opacity:1!important;color:#a98cff!important}
  `;
}

function updateVersionText() {
  document.querySelectorAll('[data-ib-status]').forEach(el => {
    if (!/Opening|Open|ERROR|Floating/.test(el.textContent || '')) el.textContent = `Ready · v${VERSION}`;
  });
  if (globalThis.InspirationBoard) globalThis.InspirationBoard.version = VERSION;
}

function openBoard() {
  const now = Date.now();
  if (now - lastTap < 450) return;
  lastTap = now;
  try {
    const opener = globalThis.InspirationBoard?.open;
    if (typeof opener !== 'function') throw new Error('Inspiration Board launcher is not ready yet.');
    opener();
    document.getElementById(TOP_ID)?.classList.add('ib-board-open');
  } catch (error) {
    console.error('[Inspiration Board] top-bar open failed', error);
    globalThis.toastr?.error?.(error?.message || String(error), 'Inspiration Board');
  }
}

function bindTopButton(button) {
  const invoke = event => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    openBoard();
  };
  button.onpointerdown = invoke;
  button.ontouchstart = invoke;
  button.onclick = invoke;
  button.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') invoke(event);
  };
}

function ensureTopBarButton() {
  injectTopBarStyle();
  const topBar = document.getElementById('top-bar');
  if (!topBar) return false;
  let button = document.getElementById(TOP_ID);
  if (!button) {
    button = document.createElement('div');
    button.id = TOP_ID;
    button.className = 'drawer-icon fa-solid fa-images fa-fw closedIcon interactable';
    button.title = 'Inspiration Board';
    button.setAttribute('aria-label', 'Open Inspiration Board');
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    topBar.appendChild(button);
  } else if (button.parentElement !== topBar) {
    topBar.appendChild(button);
  }
  bindTopButton(button);
  return true;
}

function syncOpenState() {
  const root = document.getElementById('st-inspiration-board');
  document.getElementById(TOP_ID)?.classList.toggle('ib-board-open', !!root?.classList.contains('open'));
}

function bootTopBarButton() {
  injectTopBarStyle();
  ensureTopBarButton();
  updateVersionText();
  clearInterval(repairTimer);
  repairTimer = setInterval(() => {
    ensureTopBarButton();
    updateVersionText();
    syncOpenState();
  }, 1000);
  console.info('[Inspiration Board] top-bar launcher 0.1.6 ready');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootTopBarButton, { once: true });
else bootTopBarButton();
