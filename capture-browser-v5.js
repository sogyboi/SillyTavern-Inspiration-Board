import {
  CAPTURE_BROWSER_RELEASE,
  CAPTURE_BROWSER_VERSION,
  companionBrowseUrl,
  parseCaptureMarker,
  providerExternalUrl,
  shouldInterceptQuickSave,
  targetLabel,
} from './capture-browser-core-v5.js';

const INSTALL_KEY = Symbol.for('inspiration-board-capture-browser-v5');
const API_ROOT = '/api/plugins/inspiration-board-sync';
const detailCache = new Map();
const observers = new WeakMap();

function requestHeaders() {
  const context = globalThis.SillyTavern?.getContext?.();
  return context?.getRequestHeaders?.({ omitContentType: true }) || {};
}

function toast(app, message, type = 'info') {
  app.toast?.(message, type);
}

function activeBoard(app) {
  return app.activeBoard?.() || app.state?.boards?.find(board => board.id === app.state?.activeBoardId) || app.state?.boards?.[0] || null;
}

function launchCompanion(app, provider = 'pinterest', url = '') {
  const board = activeBoard(app);
  const deepLink = companionBrowseUrl({
    provider,
    server: location.origin,
    boardId: board?.id || '',
    boardName: board?.name || '',
    url,
  });
  const anchor = document.createElement('a');
  anchor.href = deepLink;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  toast(app, `Opening ${provider === 'pinterest' ? 'Pinterest' : provider === 'cosmos' ? 'Cosmos' : 'Web'} in Capture Browser. If Android says no app can open it, install the companion APK from the Capture Center banner.`, 'info');
}

function openExternal(provider = 'web') {
  window.open(providerExternalUrl(provider), '_blank', 'noopener,noreferrer');
}

function injectStyles() {
  if (document.getElementById('ib5-capture-browser-styles')) return;
  const style = document.createElement('style');
  style.id = 'ib5-capture-browser-styles';
  style.textContent = `
    .ib5-browser-banner{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;margin-bottom:10px;padding:11px 12px;border:1px solid #59468b;border-radius:15px;background:linear-gradient(135deg,#211a35,#14141f);box-shadow:0 8px 22px #0004}.ib5-browser-banner b,.ib5-browser-banner small{display:block}.ib5-browser-banner b{font-size:11px;color:#f2edff}.ib5-browser-banner small{margin-top:3px;color:#aaa2c2;font-size:8px;line-height:1.4}.ib5-browser-banner button{height:38px;padding:0 12px;border:1px solid #514469;border-radius:10px;background:#282139;color:#fff;font-size:9px}.ib5-browser-banner button.primary{border:0;background:linear-gradient(135deg,#9270ff,#6243d2)}
    .ib41-provider[data-ib5-browser]{position:relative}.ib41-provider[data-ib5-browser] [data-ib5-external]{display:grid;place-items:center;min-width:62px;height:36px;padding:0 8px;border:1px solid #474258;border-radius:10px;background:#22212c;color:#d7d1e5;font:800 8px/1 system-ui}.ib41-provider[data-ib5-browser]:hover{border-color:#7458d3}.ib41-provider[data-ib5-browser] .icon:after{content:'+';position:absolute;right:-4px;bottom:-4px;display:grid;place-items:center;width:18px;height:18px;border-radius:9px;background:#8e6cff;color:#fff;font:900 13px/18px system-ui}.ib41-provider[data-ib5-browser] .icon{position:relative}
    .ib5-target-chip{display:inline-flex!important;align-items:center!important;gap:4px!important;margin-top:4px!important;padding:3px 6px!important;border:1px solid #655398!important;border-radius:999px!important;background:#2a2141!important;color:#d9ceff!important;font:800 8px/1 system-ui!important;white-space:nowrap}.ib41-card[data-ib5-marked]{border-color:#4b3d6d}.ib41-card[data-ib5-marked] .quick{border-color:#7e62d7!important;background:#392b5c!important}
    @media(max-width:760px){.ib5-browser-banner{grid-template-columns:1fr auto}.ib5-browser-banner [data-ib5-open-cosmos]{display:none}.ib41-provider[data-ib5-browser] [data-ib5-external]{min-width:56px}}
  `;
  document.head.appendChild(style);
}

async function captureDetail(id) {
  if (detailCache.has(id)) return detailCache.get(id);
  const response = await fetch(`${API_ROOT}/shares/${encodeURIComponent(id)}`, { headers: requestHeaders() });
  if (!response.ok) throw new Error(`Could not read capture (HTTP ${response.status}).`);
  const detail = await response.json();
  detailCache.set(id, detail);
  return detail;
}

async function removeCapture(id) {
  const response = await fetch(`${API_ROOT}/shares/${encodeURIComponent(id)}`, { method: 'DELETE', headers: requestHeaders() });
  if (!response.ok) throw new Error(`Imported, but could not remove pending capture (HTTP ${response.status}).`);
  detailCache.delete(id);
}

function patchImportedSource(app, marker) {
  if (!marker?.page || !marker?.image) return;
  const board = app.state?.boards?.find(entry => entry.id === marker.boardId) || activeBoard(app);
  if (!board) return;
  const sourceImageLine = `Original image: ${marker.image}`;
  for (const item of board.items || []) {
    if (item.type !== 'image' || item.sourceUrl !== marker.image) continue;
    item.sourceUrl = marker.page;
    if (!String(item.notes || '').includes(sourceImageLine)) item.notes = [item.notes || '', sourceImageLine].filter(Boolean).join('\n\n');
    item.updatedAt = Date.now();
  }
  for (const entry of board.inbox || []) {
    if (entry.sourceUrl !== marker.image) continue;
    entry.sourceUrl = marker.page;
    if (!String(entry.notes || '').includes(sourceImageLine)) entry.notes = [entry.notes || '', sourceImageLine].filter(Boolean).join('\n\n');
  }
  app.scheduleSave?.();
}

async function importMarkedCapture(app, card, detail, markerInfo) {
  const bridge = globalThis.InspirationBoardCapture;
  if (!bridge?.importPending && !bridge?.importUrl) throw new Error('Capture Center is not ready yet. Close and reopen Inspiration Board.');
  const board = app.state?.boards?.find(entry => entry.id === markerInfo.marker.boardId) || activeBoard(app);
  const boardId = board?.id || activeBoard(app)?.id;
  if (!boardId) throw new Error('No board is available for this capture.');
  const target = markerInfo.marker.target || 'inbox';
  const progress = app.showProgressModal?.('Capture Browser save', `Saving as ${targetLabel(target)}…`);
  try {
    if (bridge.importPending) {
      await bridge.importPending(detail.id, target, boardId, { deleteAfter: true });
      detailCache.delete(detail.id);
    } else {
      await bridge.importUrl(markerInfo.url, target, boardId);
      await removeCapture(detail.id);
    }
    patchImportedSource(app, markerInfo.marker);
    await bridge.refresh?.();
    toast(app, `Saved Capture Browser item as ${targetLabel(target)}${board?.name ? ` → ${board.name}` : ''}.`, 'success');
  } finally {
    progress?.close?.();
  }
}

async function decorateCaptureCard(app, card) {
  if (!card?.isConnected || card.dataset.ib5Hydrating === '1') return;
  const id = card.dataset.ib41Capture;
  if (!id) return;
  card.dataset.ib5Hydrating = '1';
  try {
    const detail = await captureDetail(id);
    const info = shouldInterceptQuickSave(detail);
    if (!info) return;
    card.dataset.ib5Marked = '1';
    const infoBox = card.querySelector('.ib41-card-info');
    if (infoBox && !infoBox.querySelector('.ib5-target-chip')) {
      const chip = document.createElement('span');
      chip.className = 'ib5-target-chip';
      chip.textContent = `＋ ${targetLabel(info.marker.target)}${info.marker.boardName ? ` · ${info.marker.boardName}` : ''}`;
      infoBox.appendChild(chip);
    }
    const quick = card.querySelector('[data-ib41-quick]');
    if (quick && !quick.dataset.ib5Bound) {
      quick.dataset.ib5Bound = '1';
      quick.textContent = `Save · ${targetLabel(info.marker.target)}`;
      quick.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        quick.disabled = true;
        void importMarkedCapture(app, card, detail, info).catch(error => {
          quick.disabled = false;
          toast(app, error.message || String(error), 'error');
        });
      }, true);
    }
  } catch {
    // Normal Android Share captures continue through the existing v0.4.1 flow.
  } finally {
    card.dataset.ib5Hydrating = '0';
  }
}

function enhanceProviderCard(app, card) {
  if (card.dataset.ib5Browser) return;
  const provider = card.dataset.ib41Launch || 'web';
  card.dataset.ib5Browser = '1';
  card.title = `Open ${provider} inside Inspiration Board Capture Browser`;
  const title = card.querySelector('b');
  const hint = card.querySelector('small');
  const tail = card.querySelector(':scope > span:last-child');
  if (title) title.textContent = `Capture Browser · ${provider === 'pinterest' ? 'Pinterest' : provider === 'cosmos' ? 'Cosmos' : 'Web'}`;
  if (hint) hint.textContent = 'Browse with a draggable + button. Use App/Site if this provider blocks WebView.';
  if (tail) {
    tail.dataset.ib5External = '1';
    tail.textContent = 'App/Site ↗';
  }
  card.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.target.closest('[data-ib5-external]')) openExternal(provider);
    else launchCompanion(app, provider);
  }, true);
}

function ensureBanner(app, view) {
  if (!view || view.querySelector('.ib5-browser-banner') || !view.querySelector('.ib41-hero')) return;
  const banner = document.createElement('div');
  banner.className = 'ib5-browser-banner';
  banner.innerHTML = `<div><b>Capture Browser · floating save button</b><small>New in v0.5: browse Pinterest/Cosmos inside the Android companion and tap the draggable + to choose Face, Hair, Outfit, Style, Mood, Generation, and more. The normal Android Share workflow stays available as the fallback.</small></div><button class="primary" data-ib5-install>Install / update APK</button><button data-ib5-open-cosmos>Open Cosmos</button>`;
  view.insertBefore(banner, view.firstChild);
  banner.querySelector('[data-ib5-install]').onclick = () => window.open(CAPTURE_BROWSER_RELEASE, '_blank', 'noopener,noreferrer');
  banner.querySelector('[data-ib5-open-cosmos]').onclick = () => launchCompanion(app, 'cosmos');
}

function enhanceCaptureCenter(app) {
  const modal = document.querySelector('.ib41-capture-modal');
  if (!modal) return;
  const view = modal.querySelector('[data-ib41-view]');
  ensureBanner(app, view);
  modal.querySelectorAll('.ib41-provider[data-ib41-launch]').forEach(card => enhanceProviderCard(app, card));
  modal.querySelectorAll('[data-ib41-capture]').forEach(card => void decorateCaptureCard(app, card));
}

function installSettingsShortcut(app) {
  const panel = document.querySelector('#inspiration_board_settings .inline-drawer-content');
  if (!panel || panel.querySelector('[data-ib5-browser-shortcut]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu_button interactable';
  button.dataset.ib5BrowserShortcut = '1';
  button.textContent = '＋ Capture Browser (Android)';
  panel.appendChild(button);
  button.onclick = () => launchCompanion(app, 'pinterest');
}

export function installCaptureBrowserBridge(app) {
  if (!app) return false;
  injectStyles();
  if (!app[INSTALL_KEY]) {
    app[INSTALL_KEY] = true;
    const observer = new MutationObserver(() => {
      enhanceCaptureCenter(app);
      installSettingsShortcut(app);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    observers.set(app, observer);
  }
  enhanceCaptureCenter(app);
  installSettingsShortcut(app);
  globalThis.InspirationBoardCaptureBrowser = {
    version: CAPTURE_BROWSER_VERSION,
    open: (provider = 'pinterest', url = '') => launchCompanion(app, provider, url),
    installUrl: CAPTURE_BROWSER_RELEASE,
    parseMarker: parseCaptureMarker,
  };
  console.info(`[Inspiration Board] Android Capture Browser bridge v${CAPTURE_BROWSER_VERSION} installed`);
  return true;
}
