import {
  addReference,
  clamp,
  getFrameMembers,
  makeImageItem,
  makeInboxEntry,
  staggerPositions,
} from './core-v2.js';
import {
  createImageRecord,
  findNearDuplicates,
  getImageByHash,
  putImage,
} from './db-v2.js';
import { ensureStudio } from './studio-core-v3.js';
import {
  BROWSE_PROVIDERS,
  BROWSE_TARGETS,
  BROWSE_VERSION,
  buildProviderSearch,
  candidateFilename,
  detectBrowseProvider,
  extractFirstUrl,
  isLikelyImageUrl,
  mergeCandidates,
  normalizeCandidate,
  normalizeRemoteUrl,
  sourceNote,
  sourceTags,
  targetById,
} from './browse-core-v4.js';

const INSTALL_KEY = Symbol.for('inspiration-board-browse-v4');
const API_ROOT = '/api/plugins/inspiration-board-sync';
const HISTORY_KEY = 'st_inspiration_board_browse_history_v4';
const runtimes = new WeakMap();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function safeAttr(value = '') {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function requestHeaders() {
  const context = globalThis.SillyTavern?.getContext?.();
  return context?.getRequestHeaders?.({ omitContentType: true }) || {};
}

function runtimeFor(app) {
  if (!runtimes.has(app)) {
    runtimes.set(app, {
      provider: 'pinterest',
      query: '',
      sourceUrl: '',
      candidates: [],
      captures: [],
      pluginStatus: null,
      liveVisible: false,
      modal: null,
      actionCandidate: null,
      installTimer: null,
      notePatched: false,
      originalRenderItems: null,
      originalPointerDown: null,
    });
  }
  return runtimes.get(app);
}

function toast(app, message, type = 'info') {
  app.toast?.(message, type);
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeHistory(entries) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 120))); } catch {}
}

function rememberImport(candidate, target) {
  const history = readHistory();
  history.unshift({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    provider: candidate.provider || 'web',
    imageUrl: candidate.url,
    pageUrl: candidate.pageUrl || '',
    title: candidate.title || candidate.alt || '',
    targetId: target.id,
    importedAt: Date.now(),
  });
  writeHistory(history);
}

function injectStyles() {
  if (document.getElementById('ib4-browse-styles')) return;
  const style = document.createElement('style');
  style.id = 'ib4-browse-styles';
  style.textContent = `
    #st-inspiration-board{--ib4-pink:#e85a9b;--ib4-cosmos:#ece9ff;--ib4-blue:#6d91ff;--ib4-sheet:#12121c}
    .ib4-rail-button span{color:#d6c9ff}.ib4-rail-button.active{background:linear-gradient(145deg,#7f5ce9,#4d37b3)!important;color:#fff!important}
    .ib4-top-button{min-width:auto!important;padding:0 12px!important;font-size:12px!important;font-weight:750}.ib4-top-button span{font-size:15px;margin-right:4px}
    .ib4-browse-modal{z-index:2147483600!important}.ib4-browse-modal .ib2-modal-card{width:min(1180px,calc(100vw - 20px));height:min(900px,calc(100dvh - 20px));max-width:none!important;max-height:none!important;margin:10px;border-radius:20px;overflow:hidden}.ib4-browse-modal .ib2-modal-body{padding:0!important;min-height:0;overflow:hidden}
    .ib4-hub{display:grid;grid-template-rows:auto auto minmax(0,1fr);height:100%;min-height:0;background:radial-gradient(circle at 74% 0,#7c5cff16,transparent 35%),#0d0d15}
    .ib4-provider-tabs{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--ib-line);overflow-x:auto;background:#101019}.ib4-provider-tabs button{display:flex;align-items:center;justify-content:center;gap:6px;min-width:104px;height:40px;border:1px solid #2e2e42;border-radius:12px;background:#171722;color:#b9b6c9;font-weight:700}.ib4-provider-tabs button.active{border-color:#795be0;background:#2a2344;color:#fff;box-shadow:inset 0 0 0 1px #8f70ff55}.ib4-provider-tabs .pinterest.active{border-color:#b6385e;background:#431d2c}.ib4-provider-tabs .cosmos.active{border-color:#77708f;background:#2d2a37}
    .ib4-toolbar{display:grid;grid-template-columns:minmax(160px,1fr) auto auto auto auto;gap:7px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--ib-line);background:#12121b}.ib4-searchbox{display:flex;align-items:center;gap:7px;min-width:0;height:42px;padding:0 11px;border:1px solid #343449;border-radius:12px;background:#191925}.ib4-searchbox input{width:100%;min-width:0;border:0;background:transparent;color:#fff;outline:0}.ib4-toolbar button{height:42px;padding:0 12px;border:1px solid #343449;border-radius:11px;background:#20202d;color:#fff;font-size:11px}.ib4-toolbar button.primary{border:0;background:linear-gradient(135deg,#8d68ff,#6144d3)}.ib4-toolbar button.active{border-color:#8268d5;background:#30284e}.ib4-status{grid-column:1/-1;display:flex;align-items:center;gap:8px;min-height:22px;color:#aaa7bc;font-size:10px}.ib4-status strong{color:#e8e2ff}.ib4-status .ok{color:#88efae}.ib4-status .warn{color:#ffd08d}.ib4-status .error{color:#ff9eb0}
    .ib4-main{position:relative;min-height:0;overflow:hidden}.ib4-feed{height:100%;padding:10px;overflow:auto;columns:4 190px;column-gap:10px;overscroll-behavior:contain}.ib4-card{position:relative;display:inline-block;width:100%;margin:0 0 10px;break-inside:avoid;border:1px solid #29293b;border-radius:16px;background:#161621;overflow:hidden;box-shadow:0 8px 24px #0005}.ib4-card>img{display:block;width:100%;min-height:120px;max-height:520px;object-fit:cover;background:#0b0b10}.ib4-card.broken>img{min-height:160px;opacity:.22}.ib4-card-info{display:flex;flex-direction:column;gap:2px;padding:8px 9px 10px}.ib4-card-info b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.ib4-card-info span{font-size:8px;color:#8f8ba1}.ib4-provider-chip{position:absolute;left:7px;top:7px;z-index:3;padding:4px 7px;border:1px solid #ffffff25;border-radius:999px;background:#0a0a10cc;color:#fff;font-size:8px;font-weight:800;backdrop-filter:blur(8px)}.ib4-add{position:absolute;right:7px;top:7px;z-index:5;width:40px;height:40px;border:0;border-radius:50%;background:#8c69ff;color:#fff;font-size:24px;box-shadow:0 6px 18px #0008}.ib4-card-actions{display:flex;gap:4px;padding:0 8px 8px}.ib4-card-actions button{flex:1;height:31px;border:1px solid #303044;border-radius:8px;background:#20202d;color:#d8d3e9;font-size:8px}.ib4-empty{display:grid;place-items:center;gap:8px;min-height:280px;padding:30px;text-align:center;color:#9d99ae;break-inside:avoid}.ib4-empty b{color:#ece9ff;font-size:15px}.ib4-empty p{max-width:520px;margin:0;line-height:1.45}.ib4-empty-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:center}.ib4-empty-actions button{min-height:40px;padding:0 13px;border:1px solid #3a3850;border-radius:11px;background:#1d1d2a;color:#fff}
    .ib4-live{position:absolute;inset:0;z-index:12;display:none;grid-template-rows:auto minmax(0,1fr);background:#0b0b11}.ib4-live.open{display:grid}.ib4-livebar{display:flex;align-items:center;gap:7px;padding:7px 9px;border-bottom:1px solid #303044;background:#151520}.ib4-livebar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aaa7bc;font-size:9px}.ib4-livebar button{height:34px;border:1px solid #333347;border-radius:9px;background:#222230;color:#fff}.ib4-live iframe{width:100%;height:100%;border:0;background:#fff}.ib4-live-note{position:absolute;left:50%;bottom:12px;z-index:2;max-width:82%;transform:translateX(-50%);padding:7px 10px;border:1px solid #ffffff28;border-radius:10px;background:#0c0c13dd;color:#ddd7ef;font-size:9px;text-align:center;pointer-events:none}
    .ib4-sheet{position:absolute;left:0;right:0;bottom:0;z-index:30;display:none;max-height:min(82%,720px);padding:10px 12px calc(12px + env(safe-area-inset-bottom));border-top:1px solid #49405f;border-radius:20px 20px 0 0;background:linear-gradient(180deg,#191725,#101018);box-shadow:0 -18px 50px #000b;overflow:auto}.ib4-sheet.open{display:block}.ib4-sheet-head{display:grid;grid-template-columns:70px 1fr auto;gap:10px;align-items:center;margin-bottom:10px}.ib4-sheet-head img{width:70px;height:84px;object-fit:cover;border-radius:11px;background:#08080d}.ib4-sheet-head div{min-width:0}.ib4-sheet-head b,.ib4-sheet-head span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ib4-sheet-head span{margin-top:3px;color:#9995aa;font-size:9px}.ib4-sheet-head button{align-self:start;width:38px;height:38px;border:0;border-radius:10px;background:#242433;color:#fff;font-size:20px}.ib4-target-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.ib4-target{min-height:60px;padding:7px;border:1px solid #343348;border-radius:12px;background:#1d1d29;color:#fff}.ib4-target span{display:block;font-size:18px}.ib4-target small{display:block;margin-top:2px;font-size:8px;color:#aaa6b9}.ib4-source-line{margin-top:9px;padding:8px;border:1px solid #2e2e42;border-radius:10px;background:#101018;color:#8e899d;font-size:8px;word-break:break-all}
    .ib4-captures{display:grid;gap:8px}.ib4-capture{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;padding:10px;border:1px solid #303044;border-radius:13px;background:#171721;break-inside:avoid}.ib4-capture b,.ib4-capture small{display:block}.ib4-capture small{margin-top:3px;color:#9692a5;font-size:8px}.ib4-capture-actions{display:flex;gap:4px;align-items:center}.ib4-capture-actions button{height:34px;border:1px solid #37364a;border-radius:9px;background:#252534;color:#fff;font-size:9px}
    .ib4-note-grip{position:absolute;left:7px;right:49px;top:6px;z-index:16;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(101,72,22,.18);color:#7d5a21;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}.ib4-note-grip:before{content:'⋮⋮  drag note';font:700 9px/1 system-ui,sans-serif;letter-spacing:.3px}.ib4-note-grip:active{cursor:grabbing;background:rgba(101,72,22,.30)}.ib2-note-text{padding-top:42px!important;touch-action:pan-y!important;user-select:text!important;-webkit-user-select:text!important;overscroll-behavior:contain}.ib2-note>.ib2-item-menu{z-index:18}.ib2-note .ib2-resize-handle{z-index:19}
    @media (max-width:760px){.ib4-browse-modal .ib2-modal-card{width:100vw;height:100dvh;margin:0;border:0;border-radius:0}.ib4-toolbar{grid-template-columns:minmax(120px,1fr) auto auto}.ib4-toolbar [data-ib4-live],.ib4-toolbar [data-ib4-paste]{display:none}.ib4-feed{columns:2 145px;padding:7px;column-gap:7px}.ib4-target-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ib4-provider-tabs{padding-inline:7px}.ib4-provider-tabs button{min-width:94px}}
    @media (min-width:560px) and (max-width:1150px) and (orientation:portrait){#st-inspiration-board .ib2-topbar{height:54px;padding:6px 7px;gap:5px}#st-inspiration-board .ib2-brand{min-width:auto}#st-inspiration-board .ib2-brand>div{display:none}#st-inspiration-board .ib2-body{grid-template-columns:68px minmax(0,1fr)}#st-inspiration-board .ib2-rail{padding:5px 4px}#st-inspiration-board .ib2-rail button{min-height:52px;border-radius:11px}#st-inspiration-board .ib2-rail button label{font-size:8px}.ib4-browse-modal .ib2-modal-card{width:100vw;height:100dvh;margin:0;border:0;border-radius:0}.ib4-provider-tabs{padding-top:max(8px,env(safe-area-inset-top))}.ib4-feed{columns:2 250px;padding:9px}.ib4-card>img{max-height:620px}.ib4-toolbar{grid-template-columns:minmax(160px,1fr) auto auto auto}.ib4-toolbar [data-ib4-live]{display:none}.ib4-target-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.ib4-sheet{max-height:72%}}
  `;
  document.head.appendChild(style);
}

function enhanceNotes(app) {
  if (!app.root) return;
  for (const note of app.root.querySelectorAll('.ib2-note')) {
    if (!note.querySelector('.ib4-note-grip')) {
      const grip = document.createElement('div');
      grip.className = 'ib4-note-grip';
      grip.title = 'Drag note';
      grip.setAttribute('aria-label', 'Drag note');
      note.prepend(grip);
    }
    const text = note.querySelector('.ib2-note-text');
    if (text && !text.dataset.ib4Bound) {
      text.dataset.ib4Bound = '1';
      text.addEventListener('dblclick', event => {
        event.stopPropagation();
        const item = app.itemById(note.dataset.itemId);
        if (!item || item.type !== 'note') return;
        const next = prompt('Note text:', item.text || '');
        if (next === null) return;
        app.snapshotUndo?.();
        item.text = next;
        item.updatedAt = Date.now();
        app.scheduleSave?.();
        void app.renderItems?.();
      });
    }
  }
}

function patchNoteDragging(app) {
  const runtime = runtimeFor(app);
  if (runtime.notePatched) return;
  runtime.notePatched = true;
  runtime.originalRenderItems = app.renderItems.bind(app);
  app.renderItems = async (...args) => {
    const result = await runtime.originalRenderItems(...args);
    enhanceNotes(app);
    return result;
  };
  runtime.originalPointerDown = app.onPointerDown.bind(app);
  app.onPointerDown = event => {
    const note = event.target?.closest?.('.ib2-note');
    if (note && !event.target.closest('.ib4-note-grip,.ib2-resize-handle,.ib2-item-menu,button,input,textarea,select')) {
      const item = app.itemById(note.dataset.itemId);
      if (item) {
        const additive = event.ctrlKey || event.metaKey || event.shiftKey || app.activeBoard().interactionMode === 'select';
        app.toggleSelection?.(item.id, additive);
      }
      return;
    }
    return runtime.originalPointerDown(event);
  };
  enhanceNotes(app);
}

function ensureButtons(app) {
  if (!app.root) return;
  const rail = app.root.querySelector('.ib2-rail');
  if (rail && !rail.querySelector('[data-ib4-browse]')) {
    const button = document.createElement('button');
    button.className = 'ib4-rail-button';
    button.dataset.ib4Browse = '1';
    button.innerHTML = '<span>⌘</span><label>Browse</label>';
    button.title = 'Browse Pinterest, Cosmos and the web';
    const urlButton = rail.querySelector('[data-cmd="url"]');
    urlButton?.after(button);
    if (!urlButton) rail.prepend(button);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openBrowseHub(app); });
  }
  const topbar = app.root.querySelector('.ib2-topbar');
  if (topbar && !topbar.querySelector('[data-ib4-browse-top]')) {
    const button = document.createElement('button');
    button.className = 'ib4-top-button';
    button.dataset.ib4BrowseTop = '1';
    button.title = 'Browse inspiration';
    button.innerHTML = '<span>⌘</span>Browse';
    const inbox = topbar.querySelector('[data-cmd="inbox"]');
    inbox?.before(button);
    if (!inbox) topbar.appendChild(button);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openBrowseHub(app); });
  }
}

async function pluginStatus() {
  try {
    const response = await fetch(`${API_ROOT}/status`, { headers: requestHeaders() });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function extractClientCandidates(html, pageUrl, provider) {
  const output = [];
  const add = (url, data = {}) => {
    const candidate = normalizeCandidate({ url, provider, pageUrl, ...data }, { url: pageUrl, provider });
    if (candidate) output.push(candidate);
  };
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('meta[property="og:title"]')?.content || doc.title || '';
    const description = doc.querySelector('meta[property="og:description"]')?.content || doc.querySelector('meta[name="description"]')?.content || '';
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[property="twitter:image"]']) {
      doc.querySelectorAll(selector).forEach(node => add(node.content, { title, description, source: selector }));
    }
    doc.querySelectorAll('img').forEach(image => {
      const src = image.currentSrc || image.getAttribute('src') || image.getAttribute('data-src') || image.getAttribute('data-lazy-src');
      if (src) add(src, { title, description, alt: image.alt || '', width: image.naturalWidth || image.width || Number(image.getAttribute('width')) || 0, height: image.naturalHeight || image.height || Number(image.getAttribute('height')) || 0, source: 'img' });
      const srcset = image.getAttribute('srcset') || image.getAttribute('data-srcset');
      if (srcset) {
        const last = srcset.split(',').map(value => value.trim().split(/\s+/)[0]).filter(Boolean).pop();
        if (last) add(last, { title, description, alt: image.alt || '', source: 'srcset' });
      }
    });
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const value = JSON.parse(script.textContent || 'null');
        const stack = Array.isArray(value) ? [...value] : [value];
        while (stack.length) {
          const current = stack.pop();
          if (!current || typeof current !== 'object') continue;
          const images = [current.image, current.thumbnailUrl, current.contentUrl].flat().filter(Boolean);
          for (const image of images) {
            if (typeof image === 'string') add(image, { title: current.name || title, description: current.description || description, source: 'jsonld' });
            else if (image?.url) add(image.url, { title: current.name || title, description: current.description || description, width: image.width, height: image.height, source: 'jsonld' });
          }
          for (const child of Object.values(current)) if (child && typeof child === 'object') stack.push(...(Array.isArray(child) ? child : [child]));
        }
      } catch {}
    });
    return { title, description, images: mergeCandidates(output, { url: pageUrl, provider, title, description }) };
  } catch {
    return { title: '', description: '', images: mergeCandidates(output, { url: pageUrl, provider }) };
  }
}

async function resolvePage(url, provider = detectBrowseProvider(url)) {
  const normalized = normalizeRemoteUrl(url);
  if (!normalized) throw new Error('Enter a valid http or https URL.');
  if (isLikelyImageUrl(normalized)) return { url: normalized, finalUrl: normalized, provider, title: '', description: '', images: [normalizeCandidate({ url: normalized, pageUrl: normalized, provider }, { url: normalized, provider })] };

  try {
    const response = await fetch(`${API_ROOT}/resolve-page?url=${encodeURIComponent(normalized)}`, { headers: requestHeaders() });
    if (response.ok) {
      const data = await response.json();
      return { ...data, images: mergeCandidates(data.images || [], { url: data.finalUrl || normalized, provider: data.provider || provider, title: data.title, description: data.description }) };
    }
  } catch {}

  try {
    const response = await fetch(normalized, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (type.startsWith('image/')) return { url: normalized, finalUrl: normalized, provider, images: [normalizeCandidate({ url: normalized, pageUrl: normalized, provider }, { url: normalized, provider })] };
    const html = await response.text();
    const extracted = extractClientCandidates(html, response.url || normalized, provider);
    return { url: normalized, finalUrl: response.url || normalized, provider, ...extracted };
  } catch {
    throw new Error('This page blocks browser-side image scanning. Install/update the optional Inspiration Board Sync server plugin, or open the site and share/paste the image into Captures.');
  }
}

async function downloadCandidate(candidate) {
  const attempts = [
    async () => fetch(candidate.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }),
    async () => fetch(`${API_ROOT}/remote-image?url=${encodeURIComponent(candidate.url)}`, { headers: requestHeaders() }),
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const response = await attempt();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!String(blob.type || response.headers.get('content-type') || '').startsWith('image/')) throw new Error('The URL did not return an image.');
      if (blob.size > 40 * 1024 * 1024) throw new Error('Image is larger than 40 MB.');
      return blob;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not download that image.');
}

async function importCandidate(app, candidate, targetId) {
  const target = targetById(targetId);
  const normalized = normalizeCandidate(candidate, { url: candidate.pageUrl, provider: candidate.provider });
  if (!normalized) throw new Error('This image URL is invalid.');
  const progress = app.showProgressModal?.('Importing inspiration', `Downloading from ${BROWSE_PROVIDERS[normalized.provider]?.label || 'the web'}…`);
  try {
    const blob = await downloadCandidate(normalized);
    const file = new File([blob], candidateFilename(normalized, blob.type), { type: blob.type || 'image/jpeg' });
    const pending = await createImageRecord(file, { sourceUrl: normalized.pageUrl || normalized.url });
    let record = await getImageByHash(pending.hash);
    if (!record) {
      const near = (await findNearDuplicates(pending.dhash, app.state?.settings?.duplicateDistance ?? 7))[0];
      if (near && !confirm(`This looks similar to “${near.image.name}”. Import this copy anyway?`)) {
        record = near.image;
      } else {
        record = await putImage(pending);
      }
    }

    const board = app.activeBoard();
    app.snapshotUndo?.();
    const tags = sourceTags(normalized);
    const note = sourceNote(normalized);

    if (target.placement === 'inbox') {
      let entry = board.inbox.find(item => item.imageId === record.id);
      if (!entry) {
        entry = makeInboxEntry({ imageId: record.id, name: normalized.title || record.name, role: target.role, sourceUrl: normalized.pageUrl || normalized.url });
        board.inbox.push(entry);
      }
      entry.role = target.role;
      entry.tags = [...new Set([...(entry.tags || []), ...tags])];
      entry.notes = note;
      app.inboxSelectedIds?.add?.(entry.id);
      app.scheduleSave?.();
      await app.renderInboxButton?.();
      rememberImport(normalized, target);
      toast(app, `Added to ${board.name} Inbox.`, 'success');
      return { record, entry };
    }

    let item = board.items.find(existing => existing.type === 'image' && existing.imageId === record.id);
    if (!item) {
      const ratio = record.width / Math.max(1, record.height);
      const width = ratio >= 1.2 ? 340 : 260;
      const height = clamp(width / Math.max(ratio, 0.05), 170, 480);
      const frame = app.frameForRole?.(target.role) || null;
      let position;
      if (frame) {
        position = app.nextPositionInFrame?.(frame, getFrameMembers(board, frame.id).length, width, height);
      }
      if (!position) {
        const center = app.canvasCenterWorld?.() || { x: 0, y: 0 };
        position = staggerPositions(1, center.x, center.y, width, height)[0];
      }
      item = makeImageItem({ imageId: record.id, name: normalized.title || record.name, role: target.role, sourceUrl: normalized.pageUrl || normalized.url, width, height, x: position.x, y: position.y });
      item.tags = tags;
      item.notes = note;
      item.frameId = frame?.id || null;
      board.items.push(item);
    } else {
      item.role = target.role || item.role;
      item.tags = [...new Set([...(item.tags || []), ...tags])];
      if (note && !item.notes) item.notes = note;
    }

    if (target.reference) addReference(board.character, item.id, target.role);
    if (target.main) board.character.mainImageId = item.id;
    if (target.studio || target.reference) {
      const studio = ensureStudio(board);
      studio.referenceConfig[item.id] = {
        purpose: target.purpose || 'identity',
        strength: target.main || target.id === 'face' ? 95 : 82,
        strictness: target.main || ['face', 'hair'].includes(target.id) ? 'strict' : 'balanced',
        cropOnly: false,
        ignoreBackground: !['environment', 'mood'].includes(target.id),
        mustPreserve: Boolean(target.main || ['face', 'hair'].includes(target.id)),
        notes: `Imported from ${BROWSE_PROVIDERS[normalized.provider]?.label || 'web browsing'}.`,
      };
    }

    app.selectedIds = new Set([item.id]);
    board.updatedAt = Date.now();
    app.scheduleSave?.();
    await app.renderItems?.();
    app.renderDrawer?.();
    app.focusItem?.(item);
    rememberImport(normalized, target);
    toast(app, `${normalized.title || 'Image'} added as ${target.label}.`, 'success');
    return { record, item };
  } finally {
    progress?.close?.();
  }
}

function providerButtonHtml(providerId, selected) {
  const provider = BROWSE_PROVIDERS[providerId];
  return `<button class="${providerId}${selected ? ' active' : ''}" data-ib4-provider="${providerId}"><span>${provider.icon}</span>${provider.label}</button>`;
}

function statusText(runtime) {
  if (runtime.provider === 'captures') return runtime.pluginStatus ? `<span class="ok">Capture bridge connected</span> · ${runtime.captures.length} pending share${runtime.captures.length === 1 ? '' : 's'}` : '<span class="warn">Capture bridge unavailable</span> · install/update the optional server plugin for Android sharing.';
  if (runtime.candidates.length) return `<strong>${runtime.candidates.length}</strong> image${runtime.candidates.length === 1 ? '' : 's'} found · tap <strong>＋</strong> to pull one into the board.`;
  return runtime.pluginStatus ? '<span class="ok">Direct capture bridge connected.</span> Search or paste a page URL.' : '<span class="warn">Local-only mode.</span> Direct image URLs work; Pinterest/Cosmos page scanning may need the optional sync plugin or Android Share.';
}

function feedEmptyHtml(runtime) {
  const provider = BROWSE_PROVIDERS[runtime.provider] || BROWSE_PROVIDERS.web;
  return `<div class="ib4-empty"><b>Browse ${escapeHtml(provider.label)}</b><p>Search for inspiration, paste a page or image URL, or open the live site. When a site blocks embedded browsing or cross-site downloads, use Open Site and share the image/link back to Inspiration Board.</p><div class="ib4-empty-actions"><button data-ib4-search-now>Search / Explore</button><button data-ib4-open-external>Open ${escapeHtml(provider.label)}</button><button data-ib4-show-live>Try live site</button></div></div>`;
}

function renderFeed(app) {
  const runtime = runtimeFor(app);
  const modal = runtime.modal;
  if (!modal?.isConnected) return;
  const feed = modal.querySelector('[data-ib4-feed]');
  const status = modal.querySelector('[data-ib4-status]');
  if (status) status.innerHTML = statusText(runtime);
  if (runtime.provider === 'captures') return renderCaptures(app);
  if (!runtime.candidates.length) {
    feed.innerHTML = feedEmptyHtml(runtime);
    bindFeedButtons(app);
    return;
  }
  feed.innerHTML = runtime.candidates.map((candidate, index) => `
    <article class="ib4-card" data-ib4-index="${index}">
      <span class="ib4-provider-chip">${escapeHtml(BROWSE_PROVIDERS[candidate.provider]?.label || 'Web')}</span>
      <button class="ib4-add" data-ib4-add="${index}" aria-label="Add to board">＋</button>
      <img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${safeAttr(candidate.url)}" alt="${safeAttr(candidate.alt || candidate.title || 'Inspiration image')}">
      <div class="ib4-card-info"><b>${escapeHtml(candidate.title || candidate.alt || 'Untitled reference')}</b><span>${candidate.width && candidate.height ? `${candidate.width} × ${candidate.height} · ` : ''}${escapeHtml(candidate.source || 'page')}</span></div>
      <div class="ib4-card-actions"><button data-ib4-quick="inbox" data-index="${index}">Inbox</button><button data-ib4-quick="board" data-index="${index}">Board</button><button data-ib4-source="${index}">Source</button></div>
    </article>`).join('');
  for (const card of feed.querySelectorAll('.ib4-card')) {
    const image = card.querySelector('img');
    image.addEventListener('error', () => {
      if (image.dataset.proxied) { card.classList.add('broken'); return; }
      image.dataset.proxied = '1';
      const candidate = runtime.candidates[Number(card.dataset.ib4Index)];
      image.src = `${API_ROOT}/remote-image?url=${encodeURIComponent(candidate.url)}`;
    });
  }
  bindFeedButtons(app);
}

function bindFeedButtons(app) {
  const runtime = runtimeFor(app);
  const feed = runtime.modal?.querySelector('[data-ib4-feed]');
  if (!feed) return;
  feed.onclick = event => {
    const add = event.target.closest('[data-ib4-add]');
    if (add) return showImportSheet(app, runtime.candidates[Number(add.dataset.ib4Add)]);
    const quick = event.target.closest('[data-ib4-quick]');
    if (quick) {
      const candidate = runtime.candidates[Number(quick.dataset.index)];
      void importCandidate(app, candidate, quick.dataset.ib4Quick).catch(error => toast(app, error.message, 'error'));
      return;
    }
    const source = event.target.closest('[data-ib4-source]');
    if (source) {
      const candidate = runtime.candidates[Number(source.dataset.ib4Source)];
      window.open(candidate.pageUrl || candidate.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (event.target.closest('[data-ib4-search-now]')) return void runSearch(app);
    if (event.target.closest('[data-ib4-open-external]')) return openProviderExternal(app);
    if (event.target.closest('[data-ib4-show-live]')) return showLiveSite(app, true);
  };
}

function showImportSheet(app, candidate) {
  const runtime = runtimeFor(app);
  runtime.actionCandidate = candidate;
  const sheet = runtime.modal?.querySelector('[data-ib4-sheet]');
  if (!sheet || !candidate) return;
  sheet.innerHTML = `
    <div class="ib4-sheet-head"><img src="${safeAttr(candidate.url)}" referrerpolicy="no-referrer" alt=""><div><b>${escapeHtml(candidate.title || candidate.alt || 'Inspiration image')}</b><span>${escapeHtml(BROWSE_PROVIDERS[candidate.provider]?.label || 'Web')} · choose where this reference should go</span></div><button data-ib4-sheet-close>×</button></div>
    <div class="ib4-target-grid">${BROWSE_TARGETS.map(target => `<button class="ib4-target" data-ib4-target="${target.id}"><span>${target.icon}</span>${escapeHtml(target.label)}<small>${target.placement === 'inbox' ? 'Save for later' : target.reference ? 'Place + reference' : 'Place on canvas'}</small></button>`).join('')}</div>
    <div class="ib4-source-line">${escapeHtml(candidate.pageUrl || candidate.url)}</div>`;
  sheet.classList.add('open');
  sheet.querySelector('[data-ib4-sheet-close]').onclick = () => sheet.classList.remove('open');
  sheet.querySelectorAll('[data-ib4-target]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try {
      await importCandidate(app, candidate, button.dataset.ib4Target);
      sheet.classList.remove('open');
      renderFeed(app);
    } catch (error) {
      toast(app, error instanceof Error ? error.message : String(error), 'error');
      button.disabled = false;
    }
  });
}

function setProvider(app, providerId) {
  const runtime = runtimeFor(app);
  runtime.provider = providerId;
  runtime.candidates = [];
  runtime.sourceUrl = '';
  const modal = runtime.modal;
  modal?.querySelectorAll('[data-ib4-provider]').forEach(button => button.classList.toggle('active', button.dataset.ib4Provider === providerId));
  const input = modal?.querySelector('[data-ib4-query]');
  if (input) input.placeholder = providerId === 'pinterest' ? 'Search Pinterest…' : providerId === 'cosmos' ? 'Search Cosmos…' : providerId === 'captures' ? 'Android shares appear here' : 'Search the web or paste a page URL…';
  if (providerId === 'captures') void loadCaptures(app);
  showLiveSite(app, false);
  renderFeed(app);
}

function currentSearchUrl(app) {
  const runtime = runtimeFor(app);
  const raw = runtime.modal?.querySelector('[data-ib4-query]')?.value?.trim() || runtime.query || '';
  const pastedUrl = extractFirstUrl(raw);
  if (pastedUrl) return pastedUrl;
  return buildProviderSearch(runtime.provider, raw);
}

async function runSearch(app, explicitUrl = '') {
  const runtime = runtimeFor(app);
  if (runtime.provider === 'captures') return loadCaptures(app);
  const input = runtime.modal?.querySelector('[data-ib4-query]');
  runtime.query = input?.value?.trim() || runtime.query;
  const url = explicitUrl || currentSearchUrl(app);
  runtime.sourceUrl = url;
  const status = runtime.modal?.querySelector('[data-ib4-status]');
  if (status) status.innerHTML = '<strong>Scanning…</strong> Looking for images on the page.';
  const feed = runtime.modal?.querySelector('[data-ib4-feed]');
  if (feed) feed.innerHTML = '<div class="ib4-empty"><b>Finding images…</b><p>This can take a few seconds on Pinterest or Cosmos.</p></div>';
  try {
    const result = await resolvePage(url, runtime.provider);
    runtime.candidates = mergeCandidates(result.images || [], { url: result.finalUrl || url, provider: result.provider || runtime.provider, title: result.title, description: result.description }, 100);
    if (!runtime.candidates.length) throw new Error('The page loaded, but no usable images were exposed. Try opening the site and sharing an individual image or Pin/element back to Inspiration Board.');
    renderFeed(app);
  } catch (error) {
    runtime.candidates = [];
    if (status) status.innerHTML = `<span class="error">${escapeHtml(error.message || String(error))}</span>`;
    if (feed) feed.innerHTML = `<div class="ib4-empty"><b>This site blocked direct scanning</b><p>${escapeHtml(error.message || String(error))}</p><div class="ib4-empty-actions"><button data-ib4-open-external>Open site</button><button data-ib4-show-live>Try live site</button><button data-ib4-captures>Open Captures</button></div></div>`;
    feed?.querySelector('[data-ib4-open-external]')?.addEventListener('click', () => openProviderExternal(app));
    feed?.querySelector('[data-ib4-show-live]')?.addEventListener('click', () => showLiveSite(app, true));
    feed?.querySelector('[data-ib4-captures]')?.addEventListener('click', () => setProvider(app, 'captures'));
  }
}

function openProviderExternal(app) {
  const runtime = runtimeFor(app);
  if (runtime.provider === 'captures') return;
  const url = runtime.sourceUrl || currentSearchUrl(app);
  window.open(url, '_blank', 'noopener,noreferrer');
}

function showLiveSite(app, visible) {
  const runtime = runtimeFor(app);
  const live = runtime.modal?.querySelector('[data-ib4-live-panel]');
  if (!live) return;
  runtime.liveVisible = Boolean(visible);
  live.classList.toggle('open', runtime.liveVisible);
  const toggle = runtime.modal.querySelector('[data-ib4-live]');
  toggle?.classList.toggle('active', runtime.liveVisible);
  if (!runtime.liveVisible) return;
  const url = runtime.sourceUrl || currentSearchUrl(app);
  const frame = live.querySelector('iframe');
  const label = live.querySelector('[data-ib4-live-url]');
  if (label) label.textContent = url;
  if (frame && frame.src !== url) frame.src = url;
}

async function loadCaptures(app) {
  const runtime = runtimeFor(app);
  runtime.provider = 'captures';
  const feed = runtime.modal?.querySelector('[data-ib4-feed]');
  if (feed) feed.innerHTML = '<div class="ib4-empty"><b>Checking Android Captures…</b></div>';
  runtime.pluginStatus = runtime.pluginStatus || await pluginStatus();
  if (!runtime.pluginStatus) {
    runtime.captures = [];
    return renderCaptures(app);
  }
  try {
    const response = await fetch(`${API_ROOT}/shares`, { headers: requestHeaders() });
    runtime.captures = response.ok ? await response.json() : [];
  } catch {
    runtime.captures = [];
  }
  renderCaptures(app);
}

function renderCaptures(app) {
  const runtime = runtimeFor(app);
  const feed = runtime.modal?.querySelector('[data-ib4-feed]');
  const status = runtime.modal?.querySelector('[data-ib4-status]');
  if (!feed) return;
  if (status) status.innerHTML = statusText(runtime);
  if (!runtime.pluginStatus) {
    feed.innerHTML = '<div class="ib4-empty"><b>Android capture bridge is not installed</b><p>Copy <code>server-plugin/inspiration-board-sync</code> into SillyTavern’s <code>plugins/</code> directory and restart. Then install its small PWA from the plugin page so Pinterest, Cosmos, Chrome and your Gallery can share images or links directly into this Inbox.</p></div>';
    return;
  }
  if (!runtime.captures.length) {
    feed.innerHTML = `<div class="ib4-empty"><b>No pending captures</b><p>Share an image or link from Pinterest, Cosmos, Chrome, or your Gallery to the Inspiration Board Inbox PWA. It will appear here.</p><div class="ib4-empty-actions"><button data-ib4-capture-app>Open capture app</button><button data-ib4-refresh-captures>Refresh</button></div></div>`;
  } else {
    feed.innerHTML = `<div class="ib4-captures">${runtime.captures.map(capture => `<article class="ib4-capture" data-capture-id="${safeAttr(capture.id)}"><div><b>${escapeHtml(capture.title || 'Shared inspiration')}</b><small>${capture.fileCount || 0} image file${capture.fileCount === 1 ? '' : 's'}${capture.url ? ` · ${escapeHtml(capture.url)}` : capture.text ? ` · ${escapeHtml(String(capture.text).slice(0, 160))}` : ''}</small></div><div class="ib4-capture-actions"><button data-capture-open>Open</button><button data-capture-delete>Delete</button></div></article>`).join('')}</div>`;
  }
  feed.onclick = async event => {
    if (event.target.closest('[data-ib4-capture-app]')) return window.open(runtime.pluginStatus.shareTargetUrl || `${API_ROOT}/app/`, '_blank', 'noopener');
    if (event.target.closest('[data-ib4-refresh-captures]')) return loadCaptures(app);
    const row = event.target.closest('[data-capture-id]');
    if (!row) return;
    if (event.target.closest('[data-capture-delete]')) {
      await fetch(`${API_ROOT}/shares/${encodeURIComponent(row.dataset.captureId)}`, { method: 'DELETE', headers: requestHeaders() });
      return loadCaptures(app);
    }
    if (event.target.closest('[data-capture-open]')) return openCapture(app, row.dataset.captureId);
  };
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function openCapture(app, shareId) {
  const runtime = runtimeFor(app);
  try {
    const response = await fetch(`${API_ROOT}/shares/${encodeURIComponent(shareId)}`, { headers: requestHeaders() });
    if (!response.ok) throw new Error(`Could not read capture (HTTP ${response.status}).`);
    const share = await response.json();
    const candidates = [];
    for (const file of share.files || []) {
      const blob = new Blob([base64ToBytes(file.data)], { type: file.type || 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      candidates.push(normalizeCandidate({
        id: `capture:${share.id}:${file.name}`,
        url,
        pageUrl: extractFirstUrl(share.url, share.text),
        provider: detectBrowseProvider(extractFirstUrl(share.url, share.text)),
        title: file.name || share.title,
        description: share.text || '',
        source: 'android-share',
      }, { url: extractFirstUrl(share.url, share.text) }));
      candidates[candidates.length - 1].captureBlob = blob;
      candidates[candidates.length - 1].captureName = file.name;
    }
    const sharedUrl = extractFirstUrl(share.url, share.text);
    if (!candidates.length && sharedUrl) {
      runtime.provider = detectBrowseProvider(sharedUrl);
      runtime.modal.querySelectorAll('[data-ib4-provider]').forEach(button => button.classList.toggle('active', button.dataset.ib4Provider === runtime.provider));
      runtime.modal.querySelector('[data-ib4-query]').value = sharedUrl;
      return runSearch(app, sharedUrl);
    }
    if (!candidates.length) throw new Error('This capture contained no image files or usable URL.');

    runtime.candidates = candidates;
    runtime.provider = candidates[0]?.provider || 'web';
    renderFeed(app);
    // Captured blobs are already local. Override the action sheet importer for these candidates by replacing blob URLs with File-backed data when selected.
    for (const candidate of runtime.candidates) {
      candidate.originalCaptureUrl = candidate.url;
    }
    const originalDownload = downloadCandidate;
    void originalDownload;
    // Keep the bundle until imported manually; deletion is explicit in Captures.
  } catch (error) {
    toast(app, error.message || String(error), 'error');
  }
}

async function importCapturedCandidate(app, candidate, targetId) {
  if (!candidate.captureBlob) return importCandidate(app, candidate, targetId);
  const target = targetById(targetId);
  const recordPending = await createImageRecord(new File([candidate.captureBlob], candidate.captureName || candidateFilename(candidate, candidate.captureBlob.type), { type: candidate.captureBlob.type || 'image/jpeg' }), { sourceUrl: candidate.pageUrl || '' });
  let record = await getImageByHash(recordPending.hash);
  if (!record) record = await putImage(recordPending);
  const board = app.activeBoard();
  app.snapshotUndo?.();
  if (target.placement === 'inbox') {
    let entry = board.inbox.find(item => item.imageId === record.id);
    if (!entry) { entry = makeInboxEntry({ imageId: record.id, name: candidate.title || record.name, role: target.role, sourceUrl: candidate.pageUrl || '' }); board.inbox.push(entry); }
    entry.tags = [...new Set([...(entry.tags || []), ...sourceTags(candidate), 'android-share'])];
    entry.notes = sourceNote(candidate);
    app.scheduleSave?.();
    await app.renderInboxButton?.();
    rememberImport(candidate, target);
    toast(app, 'Captured image added to Inbox.', 'success');
    return;
  }
  const ratio = record.width / Math.max(1, record.height);
  const width = ratio >= 1.2 ? 340 : 260;
  const height = clamp(width / Math.max(ratio, 0.05), 170, 480);
  const center = app.canvasCenterWorld?.() || { x: 0, y: 0 };
  const position = staggerPositions(1, center.x, center.y, width, height)[0];
  const item = makeImageItem({ imageId: record.id, name: candidate.title || record.name, role: target.role, sourceUrl: candidate.pageUrl || '', width, height, x: position.x, y: position.y });
  item.tags = [...sourceTags(candidate), 'android-share'];
  item.notes = sourceNote(candidate);
  board.items.push(item);
  if (target.reference) addReference(board.character, item.id, target.role);
  if (target.main) board.character.mainImageId = item.id;
  if (target.reference || target.studio) ensureStudio(board).referenceConfig[item.id] = { purpose: target.purpose || 'identity', strength: target.main ? 95 : 82, strictness: target.main ? 'strict' : 'balanced', cropOnly: false, ignoreBackground: !['environment', 'mood'].includes(target.id), mustPreserve: Boolean(target.main), notes: 'Imported from Android Share.' };
  app.selectedIds = new Set([item.id]);
  app.scheduleSave?.();
  await app.renderItems?.();
  app.renderDrawer?.();
  app.focusItem?.(item);
  rememberImport(candidate, target);
}

function patchCapturedImporter(app) {
  const runtime = runtimeFor(app);
  const sheet = runtime.modal?.querySelector('[data-ib4-sheet]');
  if (!sheet) return;
  const candidate = runtime.actionCandidate;
  if (!candidate?.captureBlob) return;
  sheet.querySelectorAll('[data-ib4-target]').forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        await importCapturedCandidate(app, candidate, button.dataset.ib4Target);
        sheet.classList.remove('open');
      } catch (error) {
        toast(app, error.message || String(error), 'error');
        button.disabled = false;
      }
    };
  });
}

export function openBrowseHub(app, initialProvider = null) {
  injectStyles();
  patchNoteDragging(app);
  ensureButtons(app);
  const runtime = runtimeFor(app);
  runtime.provider = initialProvider || (runtime.provider === 'captures' ? 'pinterest' : runtime.provider || 'pinterest');
  const modal = app.showModal('Browse Inspiration', `
    <div class="ib4-hub">
      <nav class="ib4-provider-tabs">${providerButtonHtml('pinterest', runtime.provider === 'pinterest')}${providerButtonHtml('cosmos', runtime.provider === 'cosmos')}${providerButtonHtml('web', runtime.provider === 'web')}<button data-ib4-provider="captures" class="captures${runtime.provider === 'captures' ? ' active' : ''}"><span>⇩</span>Captures</button></nav>
      <div class="ib4-toolbar">
        <label class="ib4-searchbox"><span>⌕</span><input data-ib4-query placeholder="Search Pinterest…" value="${safeAttr(runtime.query)}"></label>
        <button class="primary" data-ib4-search>Search</button>
        <button data-ib4-paste>Paste URL</button>
        <button data-ib4-open>Open Site</button>
        <button data-ib4-live>Live</button>
        <div class="ib4-status" data-ib4-status></div>
      </div>
      <main class="ib4-main">
        <div class="ib4-feed" data-ib4-feed></div>
        <section class="ib4-live" data-ib4-live-panel><div class="ib4-livebar"><span data-ib4-live-url></span><button data-ib4-live-external>Open external</button><button data-ib4-live-close>×</button></div><iframe title="Live inspiration site" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe><div class="ib4-live-note">Pinterest or Cosmos may block embedding. If the page is blank, use Open external and share/paste the image or page back into Inspiration Board.</div></section>
        <section class="ib4-sheet" data-ib4-sheet></section>
      </main>
    </div>
  `, 'ib4-browse-modal');
  runtime.modal = modal;
  runtime.pluginStatus = null;
  void pluginStatus().then(status => { runtime.pluginStatus = status; renderFeed(app); });

  modal.querySelectorAll('[data-ib4-provider]').forEach(button => button.onclick = () => setProvider(app, button.dataset.ib4Provider));
  modal.querySelector('[data-ib4-search]').onclick = () => void runSearch(app);
  modal.querySelector('[data-ib4-query]').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void runSearch(app); } });
  modal.querySelector('[data-ib4-paste]').onclick = async () => {
    let value = '';
    try { value = await navigator.clipboard.readText(); } catch {}
    if (!value) value = prompt('Paste a Pinterest, Cosmos, webpage, or direct image URL:') || '';
    const url = extractFirstUrl(value);
    if (!url) return toast(app, 'Clipboard did not contain a usable web URL.', 'warning');
    runtime.provider = detectBrowseProvider(url);
    modal.querySelector('[data-ib4-query]').value = url;
    modal.querySelectorAll('[data-ib4-provider]').forEach(button => button.classList.toggle('active', button.dataset.ib4Provider === runtime.provider));
    void runSearch(app, url);
  };
  modal.querySelector('[data-ib4-open]').onclick = () => openProviderExternal(app);
  modal.querySelector('[data-ib4-live]').onclick = () => showLiveSite(app, !runtime.liveVisible);
  modal.querySelector('[data-ib4-live-close]').onclick = () => showLiveSite(app, false);
  modal.querySelector('[data-ib4-live-external]').onclick = () => openProviderExternal(app);
  modal.querySelector('[data-modal-close]').addEventListener('click', () => { runtime.modal = null; });
  modal.addEventListener('click', event => {
    if (event.target.closest('[data-ib4-add]')) setTimeout(() => patchCapturedImporter(app), 0);
  }, true);
  renderFeed(app);
  if (runtime.provider === 'captures') void loadCaptures(app);
  return modal;
}

export function installBrowseHub(app) {
  if (!app) return;
  injectStyles();
  patchNoteDragging(app);
  ensureButtons(app);
  const runtime = runtimeFor(app);
  if (app[INSTALL_KEY]) return;
  app[INSTALL_KEY] = true;
  runtime.installTimer = setInterval(() => {
    if (!document.contains(app.root)) return;
    ensureButtons(app);
    enhanceNotes(app);
  }, 1200);
  globalThis.InspirationBoardBrowse = {
    version: BROWSE_VERSION,
    open: provider => openBrowseHub(app, provider),
    importUrl: async (url, target = 'inbox') => {
      const provider = detectBrowseProvider(url);
      const result = await resolvePage(url, provider);
      const candidate = result.images?.[0];
      if (!candidate) throw new Error('No image found at that URL.');
      return importCandidate(app, candidate, target);
    },
  };
  console.info(`[Inspiration Board] Browse Hub v${BROWSE_VERSION} installed`);
}
