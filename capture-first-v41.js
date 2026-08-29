import { addReference, clamp, getFrameMembers, makeImageItem, makeInboxEntry, staggerPositions } from './core-v2.js';
import { createImageRecord, findNearDuplicates, getImageByHash, putImage } from './db-v2.js';
import { ensureStudio } from './studio-core-v3.js';
import {
  BROWSE_PROVIDERS,
  BROWSE_TARGETS,
  candidateFilename,
  mergeCandidates,
  normalizeCandidate,
  sourceNote,
  sourceTags,
  targetById,
} from './browse-core-v4.js';
import {
  CAPTURE_PROVIDER_ORDER,
  CAPTURE_VERSION,
  captureProvider,
  extractCaptureUrl,
  filterCaptures,
  makeCaptureHistoryRecord,
  normalizeCaptureSettings,
  pickBestCandidate,
  providerLaunchUrl,
  providerMeta,
  quickTargetForProvider,
  relativeCaptureTime,
  selectedCaptureIds,
  shouldOfferClipboard,
  sortCandidates,
  summarizeBatch,
} from './capture-core-v41.js';

const INSTALL_KEY = Symbol.for('inspiration-board-capture-first-v41');
const API_ROOT = '/api/plugins/inspiration-board-sync';
const SETTINGS_KEY = 'st_inspiration_board_capture_settings_v41';
const HISTORY_KEY = 'st_inspiration_board_capture_history_v41';
const MAX_HISTORY = 180;
const ROLE_FRAME_HINTS = Object.freeze({
  face: ['face'], hair: ['hair'], body: ['body', 'pose'], outfit: ['outfit', 'clothing'],
  expression: ['expression'], accessory: ['accessor'], prop: ['prop', 'weapon'], mood: ['mood', 'vibe'],
  environment: ['environment', 'setting', 'location'], general: [],
});
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

function readJsonStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function readSettings() {
  return normalizeCaptureSettings(readJsonStorage(SETTINGS_KEY, {}));
}

function writeSettings(value) {
  const settings = normalizeCaptureSettings(value);
  writeJsonStorage(SETTINGS_KEY, settings);
  return settings;
}

function readHistory() {
  const history = readJsonStorage(HISTORY_KEY, []);
  return Array.isArray(history) ? history : [];
}

function pushHistory(record) {
  const history = readHistory();
  history.unshift(record);
  writeJsonStorage(HISTORY_KEY, history.slice(0, MAX_HISTORY));
}

function runtimeFor(app) {
  if (!runtimes.has(app)) {
    runtimes.set(app, {
      modal: null,
      tab: 'capture',
      captures: [],
      selected: new Set(),
      pluginStatus: null,
      filterProvider: 'all',
      query: '',
      clipboardUrl: '',
      lastClipboardUrl: '',
      detailCache: new Map(),
      previewUrls: new Set(),
      previewObserver: null,
      pollTimer: null,
      installTimer: null,
      legacyBrowseOpen: null,
      lastPollAt: 0,
    });
  }
  return runtimes.get(app);
}

function toast(app, message, type = 'info') {
  app.toast?.(message, type);
}

function revokePreviews(runtime) {
  runtime.previewObserver?.disconnect?.();
  runtime.previewObserver = null;
  for (const url of runtime.previewUrls) URL.revokeObjectURL(url);
  runtime.previewUrls.clear();
}

function base64Bytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
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

async function listPendingCaptures() {
  try {
    const response = await fetch(`${API_ROOT}/shares`, { headers: requestHeaders() });
    if (!response.ok) return [];
    const value = await response.json();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function fetchCaptureDetail(runtime, id, { fresh = false } = {}) {
  if (!fresh && runtime.detailCache.has(id)) return runtime.detailCache.get(id);
  const response = await fetch(`${API_ROOT}/shares/${encodeURIComponent(id)}`, { headers: requestHeaders() });
  if (!response.ok) throw new Error(`Could not read capture (HTTP ${response.status}).`);
  const value = await response.json();
  runtime.detailCache.set(id, value);
  return value;
}

async function deleteCapture(id) {
  const response = await fetch(`${API_ROOT}/shares/${encodeURIComponent(id)}`, { method: 'DELETE', headers: requestHeaders() });
  if (!response.ok) throw new Error(`Could not delete capture (HTTP ${response.status}).`);
}

async function resolveRemotePage(url, provider = 'web') {
  const response = await fetch(`${API_ROOT}/resolve-page?url=${encodeURIComponent(url)}`, { headers: requestHeaders() });
  if (!response.ok) {
    let message = `Could not resolve page (HTTP ${response.status}).`;
    try { message = (await response.json())?.error || message; } catch {}
    throw new Error(message);
  }
  const data = await response.json();
  const page = { url: data.finalUrl || url, provider: data.provider || provider, title: data.title || '', description: data.description || '' };
  return {
    ...data,
    images: sortCandidates(mergeCandidates(data.images || [], page, 120)),
  };
}

function sharedFileCandidates(share) {
  const provider = captureProvider(share);
  const pageUrl = extractCaptureUrl(share);
  return (share.files || []).map((file, index) => {
    const blob = new Blob([base64Bytes(file.data)], { type: file.type || 'image/jpeg' });
    return normalizeCandidate({
      id: `share:${share.id}:${index}`,
      url: pageUrl || `https://capture.invalid/${encodeURIComponent(share.id)}/${index}`,
      pageUrl,
      provider,
      title: file.name || share.title || 'Shared image',
      description: share.text || '',
      source: 'android-share',
    }, { url: pageUrl, provider, title: share.title, description: share.text }) && {
      id: `share:${share.id}:${index}`,
      url: pageUrl || '',
      remoteUrl: '',
      pageUrl,
      provider,
      title: file.name || share.title || 'Shared image',
      description: share.text || '',
      alt: '',
      width: 0,
      height: 0,
      source: 'android-share',
      localBlob: blob,
      localName: file.name || `shared-${index + 1}.jpg`,
    };
  }).filter(Boolean);
}

async function resolveCapture(runtime, share, { allRemote = false } = {}) {
  const detail = share.files ? share : await fetchCaptureDetail(runtime, share.id);
  const files = sharedFileCandidates(detail);
  if (files.length) return { share: detail, candidates: files, mode: 'files' };
  const url = extractCaptureUrl(detail);
  if (!url) throw new Error('This capture contains no image file or usable web URL.');
  const resolved = await resolveRemotePage(url, captureProvider(detail));
  const candidates = allRemote ? resolved.images : [pickBestCandidate(resolved.images)].filter(Boolean);
  if (!candidates.length) throw new Error('The shared page did not expose a usable image. Open the source and share the image itself, then retry.');
  return { share: detail, candidates, mode: 'url', resolved };
}

async function remoteBlob(candidate) {
  if (candidate.localBlob instanceof Blob) return candidate.localBlob;
  const url = candidate.remoteUrl || candidate.url;
  const attempts = [
    () => fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }),
    () => fetch(`${API_ROOT}/remote-image?url=${encodeURIComponent(url)}`, { headers: requestHeaders() }),
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const response = await attempt();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!String(blob.type || response.headers.get('content-type') || '').startsWith('image/')) throw new Error('Remote URL did not return an image.');
      if (blob.size > 40 * 1024 * 1024) throw new Error('Image is larger than 40 MB.');
      return blob;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not download the image.');
}

function frameForRole(board, role) {
  const hints = ROLE_FRAME_HINTS[role] || [];
  if (!hints.length) return null;
  return (board.items || []).find(item => item.type === 'frame' && hints.some(hint => String(item.title || '').toLowerCase().includes(hint))) || null;
}

function positionInFrame(board, frame, width, height) {
  const count = getFrameMembers(board, frame.id).length;
  const innerWidth = Math.max(width, frame.width - 36);
  const columns = Math.max(1, Math.floor(innerWidth / (width + 20)));
  return {
    x: frame.x + 18 + (count % columns) * (width + 20),
    y: frame.y + 64 + Math.floor(count / columns) * (height + 20),
  };
}

function boardCenter(board) {
  const view = board.view || { x: 0, y: 0, zoom: 1 };
  const zoom = Math.max(0.08, Number(view.zoom) || 1);
  return { x: -Number(view.x || 0) / zoom, y: -Number(view.y || 0) / zoom };
}

async function createOrReuseRecord(app, candidate, settings) {
  const blob = await remoteBlob(candidate);
  const file = new File([blob], candidate.localName || candidateFilename(candidate, blob.type), { type: blob.type || 'image/jpeg' });
  const pending = await createImageRecord(file, { sourceUrl: candidate.pageUrl || candidate.remoteUrl || candidate.url || '' });
  const exact = await getImageByHash(pending.hash);
  if (exact) return { record: exact, reused: true, exact: true };
  const near = (await findNearDuplicates(pending.dhash, app.state?.settings?.duplicateDistance ?? 7))[0] || null;
  if (near && settings.nearDuplicateAction === 'reuse') return { record: near.image, reused: true, exact: false };
  if (near && settings.nearDuplicateAction === 'ask') {
    const keep = confirm(`This capture looks similar to “${near.image.name}”.\n\nOK = keep the new copy\nCancel = reuse the existing image`);
    if (!keep) return { record: near.image, reused: true, exact: false };
  }
  return { record: await putImage(pending), reused: false, exact: false };
}

function sourceMetadata(candidate, share) {
  const provider = candidate.provider || captureProvider(share);
  const sourceUrl = candidate.pageUrl || extractCaptureUrl(share) || candidate.remoteUrl || candidate.url || '';
  const tags = [...new Set([...sourceTags({ ...candidate, provider }), 'capture-first'])];
  const notes = [
    candidate.description || share.text || '',
    sourceUrl ? `Source: ${sourceUrl}` : '',
    `Captured from: ${providerMeta(provider).label}`,
    share.createdAt ? `Captured: ${new Date(share.createdAt).toLocaleString()}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 7000);
  return { provider, sourceUrl, tags, notes };
}

async function importCandidate(app, candidate, share, targetId, boardId, settings) {
  const target = targetById(targetId);
  const board = app.state.boards.find(entry => entry.id === boardId) || app.activeBoard();
  const { record, reused } = await createOrReuseRecord(app, candidate, settings);
  const metadata = sourceMetadata(candidate, share);

  if (target.placement === 'inbox') {
    let entry = board.inbox.find(existing => existing.imageId === record.id);
    if (!entry) {
      entry = makeInboxEntry({ imageId: record.id, name: candidate.title || candidate.alt || record.name, role: target.role, sourceUrl: metadata.sourceUrl });
      board.inbox.push(entry);
    }
    entry.role = target.role;
    entry.tags = [...new Set([...(entry.tags || []), ...metadata.tags])];
    entry.notes = metadata.notes;
    entry.collection = entry.collection || `${providerMeta(metadata.provider).label} Captures`;
    board.updatedAt = Date.now();
    return { entry, item: null, reused };
  }

  let item = board.items.find(existing => existing.type === 'image' && existing.imageId === record.id);
  if (!item) {
    const ratio = record.width / Math.max(1, record.height);
    const width = ratio >= 1.2 ? 340 : 260;
    const height = clamp(width / Math.max(ratio, 0.05), 170, 480);
    const frame = frameForRole(board, target.role);
    const position = frame ? positionInFrame(board, frame, width, height) : staggerPositions(1, boardCenter(board).x, boardCenter(board).y, width, height)[0];
    item = makeImageItem({ imageId: record.id, name: candidate.title || candidate.alt || record.name, role: target.role, sourceUrl: metadata.sourceUrl, width, height, x: position.x, y: position.y });
    item.tags = metadata.tags;
    item.notes = metadata.notes;
    item.collection = `${providerMeta(metadata.provider).label} Captures`;
    item.frameId = frame?.id || null;
    board.items.push(item);
  } else {
    item.role = target.role || item.role;
    item.tags = [...new Set([...(item.tags || []), ...metadata.tags])];
    item.sourceUrl ||= metadata.sourceUrl;
    item.notes ||= metadata.notes;
  }

  if (target.reference) addReference(board.character, item.id, target.role);
  if (target.main) board.character.mainImageId = item.id;
  if (target.reference || target.studio) {
    ensureStudio(board).referenceConfig[item.id] = {
      purpose: target.purpose || 'identity',
      strength: target.main || target.id === 'face' ? 95 : 82,
      strictness: target.main || ['face', 'hair'].includes(target.id) ? 'strict' : 'balanced',
      cropOnly: false,
      ignoreBackground: !['environment', 'mood'].includes(target.id),
      mustPreserve: Boolean(target.main || ['face', 'hair'].includes(target.id)),
      notes: `Capture-first import from ${providerMeta(metadata.provider).label}.`,
    };
  }
  board.updatedAt = Date.now();
  return { item, entry: null, reused };
}

async function importCapture(app, share, { targetId, boardId, deleteAfter = null, openStudio = true } = {}) {
  const runtime = runtimeFor(app);
  const settings = readSettings();
  const provider = captureProvider(share);
  const target = targetById(targetId || quickTargetForProvider(settings, provider).id);
  const board = app.state.boards.find(entry => entry.id === boardId) || app.activeBoard();
  const resolved = await resolveCapture(runtime, share);
  let reused = 0;
  const imported = [];
  app.snapshotUndo?.();
  for (const candidate of resolved.candidates) {
    const result = await importCandidate(app, candidate, resolved.share, target.id, board.id, settings);
    imported.push(result);
    if (result.reused) reused++;
  }
  app.scheduleSave?.();
  if (board.id === app.activeBoard().id) {
    await app.renderItems?.();
    await app.renderInboxButton?.();
    app.renderDrawer?.();
    const firstItem = imported.find(result => result.item)?.item;
    if (firstItem) {
      app.selectedIds = new Set(imported.filter(result => result.item).map(result => result.item.id));
      app.updateSelectionStyles?.();
      app.focusItem?.(firstItem);
    }
  }
  const shouldDelete = deleteAfter ?? settings.deleteAfterImport;
  if (shouldDelete && share.id) {
    await deleteCapture(share.id);
    runtime.detailCache.delete(share.id);
  }
  pushHistory(makeCaptureHistoryRecord({ share: resolved.share, provider, targetId: target.id, board, count: imported.length, status: shouldDelete ? 'imported' : 'kept' }));
  if (target.studio && openStudio && board.id === app.activeBoard().id) {
    setTimeout(() => app.openGenerationStudio?.({ draft: { referenceMode: 'selected', useBlueprint: true } }), 100);
  }
  return { images: imported.length, reused, target, board, deleted: shouldDelete };
}

async function importUrlDirect(app, url, targetId, boardId) {
  const provider = captureProvider({ url });
  const resolved = await resolveRemotePage(url, provider);
  const candidate = pickBestCandidate(resolved.images);
  if (!candidate) throw new Error('No usable image was found on that page.');
  const fakeShare = { id: '', title: resolved.title || candidate.title || 'Pasted link', text: resolved.description || '', url, createdAt: Date.now() };
  const settings = readSettings();
  app.snapshotUndo?.();
  const result = await importCandidate(app, candidate, fakeShare, targetId, boardId, settings);
  app.scheduleSave?.();
  if (boardId === app.activeBoard().id) {
    await app.renderItems?.();
    await app.renderInboxButton?.();
    app.renderDrawer?.();
    if (result.item) { app.selectedIds = new Set([result.item.id]); app.focusItem?.(result.item); }
  }
  const board = app.state.boards.find(entry => entry.id === boardId) || app.activeBoard();
  pushHistory(makeCaptureHistoryRecord({ share: fakeShare, provider, targetId, board, count: 1 }));
  if (targetById(targetId).studio && board.id === app.activeBoard().id) setTimeout(() => app.openGenerationStudio?.({ draft: { referenceMode: 'selected', useBlueprint: true } }), 100);
  return result;
}

function injectStyles() {
  if (document.getElementById('ib41-capture-styles')) return;
  const style = document.createElement('style');
  style.id = 'ib41-capture-styles';
  style.textContent = `
    #st-inspiration-board .ib4-rail-button,#st-inspiration-board .ib4-top-button{display:none!important}
    .ib41-capture-button{position:relative}.ib41-badge{position:absolute;right:3px;top:3px;display:none;min-width:18px;height:18px;padding:0 5px;border-radius:10px;background:#8f6cff;color:#fff;font:800 9px/18px system-ui;text-align:center}.ib41-badge.show{display:block}
    .ib41-capture-modal{z-index:2147483650!important}.ib41-capture-modal .ib2-modal-card{width:min(1180px,calc(100vw - 18px));height:min(920px,calc(100dvh - 18px));max-width:none!important;max-height:none!important;margin:9px;border-radius:22px;overflow:hidden}.ib41-capture-modal .ib2-modal-body{padding:0!important;overflow:hidden;min-height:0}
    .ib41-shell{display:grid;grid-template-rows:auto minmax(0,1fr);height:100%;background:radial-gradient(circle at 82% -5%,#8f6cff24,transparent 38%),#0d0d15;color:#f5f3ff}
    .ib41-tabs{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid #303044;background:#11111a;overflow-x:auto}.ib41-tabs button{min-width:112px;height:40px;border:1px solid #303044;border-radius:12px;background:#191924;color:#aaa7bc;font-weight:800}.ib41-tabs button.active{border-color:#7659d8;background:#2c2548;color:#fff}.ib41-tabs .spacer{flex:1}.ib41-tabs .status{display:flex;align-items:center;gap:6px;padding:0 8px;color:#8f8ba1;font-size:9px;white-space:nowrap}.ib41-tabs .status.ok{color:#89eeb0}.ib41-tabs .status.warn{color:#ffd18f}
    .ib41-view{min-height:0;overflow:auto;padding:10px 11px calc(20px + env(safe-area-inset-bottom));overscroll-behavior:contain}.ib41-hero{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:10px}.ib41-provider{display:grid;grid-template-columns:48px 1fr auto;gap:10px;align-items:center;min-height:82px;padding:10px;border:1px solid #333248;border-radius:17px;background:linear-gradient(135deg,#191924,#12121b);color:#fff;text-align:left}.ib41-provider .icon{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:#29283a;font-size:22px;font-weight:900}.ib41-provider.pinterest .icon{background:#4b1d2c;color:#ff7899}.ib41-provider.cosmos .icon{background:#2e2b39;color:#eee9ff}.ib41-provider.web .icon{background:#1d3049;color:#8dc8ff}.ib41-provider b,.ib41-provider small{display:block}.ib41-provider small{margin-top:3px;color:#918da1;font-size:8px;line-height:1.35}.ib41-provider>span:last-child{font-size:18px;color:#a796e8}
    .ib41-tip{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;border:1px solid #3c3655;border-radius:13px;background:#181521;color:#c8bee8;font-size:9px}.ib41-tip b{color:#fff}.ib41-tip button{margin-left:auto;height:32px;border:1px solid #4a4264;border-radius:9px;background:#272139;color:#fff;font-size:9px}
    .ib41-clipboard{display:none;grid-template-columns:1fr auto auto;gap:6px;align-items:center;margin-bottom:10px;padding:9px;border:1px solid #645093;border-radius:13px;background:#251d39}.ib41-clipboard.open{display:grid}.ib41-clipboard div{min-width:0}.ib41-clipboard b,.ib41-clipboard small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ib41-clipboard small{color:#b7add0;font-size:8px}.ib41-clipboard button{height:34px;border:1px solid #54466f;border-radius:9px;background:#31264a;color:#fff;font-size:9px}
    .ib41-linkbox{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px;margin-bottom:10px;padding:8px;border:1px solid #303044;border-radius:14px;background:#14141e}.ib41-linkbox input{min-width:0;height:40px;border:1px solid #38374d;border-radius:10px;background:#1c1c29;color:#fff;padding:0 10px;outline:0}.ib41-linkbox button{height:40px;padding:0 12px;border:1px solid #3a394e;border-radius:10px;background:#222230;color:#fff;font-size:9px}.ib41-linkbox button.primary{border:0;background:linear-gradient(135deg,#8e6bff,#6547d4)}
    .ib41-capture-head{display:grid;grid-template-columns:auto auto minmax(130px,1fr) auto auto auto;gap:6px;align-items:center;margin-bottom:8px}.ib41-capture-head button,.ib41-capture-head select,.ib41-capture-head input{height:36px;border:1px solid #343348;border-radius:9px;background:#1d1d29;color:#fff;font-size:9px}.ib41-capture-head button{padding:0 10px}.ib41-capture-head input{min-width:0;padding:0 9px}.ib41-capture-head select{padding:0 24px 0 8px}.ib41-capture-head button.primary{border:0;background:#6f51d8}
    .ib41-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.ib41-card{position:relative;display:grid;grid-template-rows:150px auto auto;min-width:0;border:1px solid #2e2e41;border-radius:16px;background:#171721;overflow:hidden}.ib41-card.selected{border-color:#8f6cff;box-shadow:0 0 0 2px #8f6cff33}.ib41-preview{position:relative;display:grid;place-items:center;overflow:hidden;background:linear-gradient(135deg,#181823,#0c0c12);color:#6d6980;font-size:34px}.ib41-preview img{width:100%;height:100%;object-fit:cover}.ib41-preview .provider-chip{position:absolute;left:7px;top:7px;padding:4px 7px;border-radius:999px;background:#0b0b12d9;color:#fff;font-size:8px;font-weight:800}.ib41-select{position:absolute;right:7px;top:7px;z-index:4;width:36px;height:36px;border:1px solid #ffffff33;border-radius:11px;background:#0d0d14d9;color:#fff;font-size:16px}.ib41-card.selected .ib41-select{background:#8e6bff;border-color:#b7a3ff}.ib41-card-info{padding:9px 9px 5px;min-width:0}.ib41-card-info b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.ib41-card-info small{display:block;margin-top:3px;color:#918da0;font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ib41-card-actions{display:grid;grid-template-columns:1fr auto auto;gap:5px;padding:5px 8px 8px}.ib41-card-actions button{height:34px;border:1px solid #343448;border-radius:9px;background:#22222e;color:#fff;font-size:8px}.ib41-card-actions button.quick{border-color:#624db0;background:#30264e}.ib41-card-actions button.danger{color:#ff9caf}
    .ib41-empty{display:grid;place-items:center;gap:8px;min-height:260px;padding:28px;text-align:center;color:#9995a7}.ib41-empty b{font-size:15px;color:#f2edff}.ib41-empty p{max-width:560px;margin:0;line-height:1.5}.ib41-empty-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:center}.ib41-empty-actions button{min-height:38px;padding:0 12px;border:1px solid #3b394d;border-radius:10px;background:#20202c;color:#fff}
    .ib41-sheet{position:absolute;left:0;right:0;bottom:0;z-index:80;display:none;max-height:min(82%,760px);padding:11px 12px calc(13px + env(safe-area-inset-bottom));border-top:1px solid #57486f;border-radius:22px 22px 0 0;background:linear-gradient(180deg,#1a1724,#101018);box-shadow:0 -18px 55px #000c;overflow:auto}.ib41-sheet.open{display:block}.ib41-sheet-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}.ib41-sheet-head div{flex:1;min-width:0}.ib41-sheet-head b,.ib41-sheet-head small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ib41-sheet-head small{color:#9a95aa;font-size:8px}.ib41-sheet-head button{width:38px;height:38px;border:0;border-radius:10px;background:#252432;color:#fff;font-size:20px}.ib41-sheet-previews{display:flex;gap:7px;overflow-x:auto;margin-bottom:9px}.ib41-sheet-previews img{flex:0 0 110px;width:110px;height:145px;object-fit:cover;border-radius:11px;background:#09090e}.ib41-sheet-controls{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px}.ib41-sheet-controls select{height:40px;border:1px solid #38364d;border-radius:10px;background:#1d1d29;color:#fff;padding:0 9px}.ib41-targets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.ib41-targets button{min-height:58px;border:1px solid #363448;border-radius:11px;background:#1e1e2a;color:#fff;font-size:8px}.ib41-targets button span{display:block;font-size:18px;margin-bottom:2px}.ib41-source{margin-top:8px;padding:8px;border:1px solid #2e2d3f;border-radius:10px;background:#101018;color:#8e899b;font-size:8px;word-break:break-all}
    .ib41-history{display:grid;gap:7px}.ib41-history-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:9px 10px;border:1px solid #303044;border-radius:12px;background:#171721}.ib41-history-row b,.ib41-history-row small{display:block}.ib41-history-row small{margin-top:3px;color:#918d9f;font-size:8px}.ib41-history-row button{height:34px;border:1px solid #373649;border-radius:9px;background:#242432;color:#fff;font-size:8px}.ib41-history-row.failed{border-color:#673440}.ib41-history-row.failed small{color:#ff9cac}
    .ib41-settings{display:grid;gap:10px;max-width:760px;margin:auto}.ib41-settings section{padding:12px;border:1px solid #303044;border-radius:15px;background:#15151f}.ib41-settings h3{margin:0 0 8px;font-size:13px}.ib41-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ib41-settings label{display:flex;flex-direction:column;gap:4px;color:#aaa6b7;font-size:9px}.ib41-settings select,.ib41-settings input[type=number]{height:38px;border:1px solid #39374c;border-radius:9px;background:#1d1d29;color:#fff;padding:0 8px}.ib41-check{display:flex!important;flex-direction:row!important;align-items:center;gap:7px!important;min-height:36px}.ib41-settings-actions{display:flex;justify-content:flex-end;gap:7px}.ib41-settings-actions button{height:40px;padding:0 13px;border:1px solid #39374c;border-radius:10px;background:#21212d;color:#fff}.ib41-settings-actions .primary{border:0;background:#6e51d7}
    @media(max-width:760px){.ib41-capture-modal .ib2-modal-card{width:100vw;height:100dvh;margin:0;border:0;border-radius:0}.ib41-hero{grid-template-columns:1fr}.ib41-provider{min-height:68px}.ib41-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.ib41-capture-head{grid-template-columns:auto minmax(110px,1fr) auto}.ib41-capture-head [data-ib41-provider-filter],.ib41-capture-head [data-ib41-board],.ib41-capture-head [data-ib41-target]{display:none}.ib41-targets{grid-template-columns:repeat(2,minmax(0,1fr))}.ib41-linkbox{grid-template-columns:1fr auto}.ib41-linkbox [data-ib41-open-url]{display:none}}
    @media(min-width:560px) and (max-width:1150px) and (orientation:portrait){.ib41-capture-modal .ib2-modal-card{width:100vw;height:100dvh;margin:0;border:0;border-radius:0}.ib41-view{padding:9px 10px calc(18px + env(safe-area-inset-bottom))}.ib41-hero{grid-template-columns:repeat(3,minmax(0,1fr))}.ib41-provider{grid-template-columns:44px 1fr;min-height:76px}.ib41-provider>span:last-child{display:none}.ib41-provider .icon{width:44px;height:44px}.ib41-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ib41-card{grid-template-rows:210px auto auto}.ib41-capture-head{position:sticky;top:-1px;z-index:8;padding:5px 0;background:#0d0d15f2;backdrop-filter:blur(12px)}.ib41-targets{grid-template-columns:repeat(3,minmax(0,1fr))}.ib41-sheet{max-height:72%}}
  `;
  document.head.appendChild(style);
}

function boardOptions(app, selectedId = '') {
  return app.state.boards.map(board => `<option value="${safeAttr(board.id)}" ${board.id === selectedId ? 'selected' : ''}>${escapeHtml(board.name)}</option>`).join('');
}

function targetOptions(selectedId = 'inbox') {
  return BROWSE_TARGETS.map(target => `<option value="${target.id}" ${target.id === selectedId ? 'selected' : ''}>${escapeHtml(target.label)}</option>`).join('');
}

function providerLabel(provider) {
  return providerMeta(provider).label;
}

function providerIcon(provider) {
  return providerMeta(provider).icon;
}

async function hydrateClipboard(app) {
  const runtime = runtimeFor(app);
  const settings = readSettings();
  if (!settings.autoClipboardPrompt || !runtime.modal?.isConnected) return;
  try {
    const text = await navigator.clipboard.readText();
    const url = shouldOfferClipboard(text, runtime.lastClipboardUrl);
    if (!url) return;
    runtime.clipboardUrl = url;
    runtime.lastClipboardUrl = url;
    const banner = runtime.modal.querySelector('[data-ib41-clipboard]');
    if (!banner) return;
    banner.classList.add('open');
    banner.querySelector('small').textContent = url;
  } catch {}
}

function providerCardsHtml() {
  return CAPTURE_PROVIDER_ORDER.map(provider => {
    const meta = providerMeta(provider);
    const hint = provider === 'pinterest' ? 'Browse normally, then Share → Inspiration Board Inbox.' : provider === 'cosmos' ? 'Use the real Cosmos experience, then share the element or link.' : 'Open any image site and share or copy the page URL.';
    return `<button class="ib41-provider ${provider}" data-ib41-launch="${provider}"><span class="icon">${meta.icon}</span><span><b>Open ${escapeHtml(meta.label)}</b><small>${escapeHtml(hint)}</small></span><span>↗</span></button>`;
  }).join('');
}

function captureCardsHtml(app) {
  const runtime = runtimeFor(app);
  const filtered = filterCaptures(runtime.captures, { query: runtime.query, provider: runtime.filterProvider });
  if (!filtered.length) {
    return `<div class="ib41-empty"><b>${runtime.captures.length ? 'No captures match this filter' : 'Your Capture Inbox is empty'}</b><p>Open Pinterest, Cosmos, Chrome, or Gallery, use Android Share, and choose <strong>Inspiration Board Inbox</strong>. URL-only shares are resolved when you import them.</p><div class="ib41-empty-actions"><button data-ib41-open-pwa>Open Capture App</button><button data-ib41-refresh>Refresh</button></div></div>`;
  }
  return `<div class="ib41-grid">${filtered.map(capture => {
    const provider = captureProvider(capture);
    const selected = runtime.selected.has(String(capture.id));
    const target = quickTargetForProvider(readSettings(), provider);
    return `<article class="ib41-card${selected ? ' selected' : ''}" data-ib41-capture="${safeAttr(capture.id)}">
      <div class="ib41-preview" data-ib41-preview><span>${providerIcon(provider)}</span><span class="provider-chip">${escapeHtml(providerLabel(provider))}</span><button class="ib41-select" data-ib41-select>${selected ? '✓' : ''}</button></div>
      <div class="ib41-card-info"><b>${escapeHtml(capture.title || 'Shared inspiration')}</b><small>${capture.fileCount || 0} image${capture.fileCount === 1 ? '' : 's'} · ${relativeCaptureTime(capture.createdAt)}${extractCaptureUrl(capture) ? ' · link included' : ''}</small></div>
      <div class="ib41-card-actions"><button class="quick" data-ib41-quick>${escapeHtml(target.label)}</button><button data-ib41-open>Open</button><button class="danger" data-ib41-delete>×</button></div>
    </article>`;
  }).join('')}</div>`;
}

function captureViewHtml(app) {
  const runtime = runtimeFor(app);
  const settings = readSettings();
  const activeBoard = app.activeBoard();
  const defaultTarget = settings.quickTarget;
  return `
    <section class="ib41-hero">${providerCardsHtml()}</section>
    <div class="ib41-tip"><span>⇩</span><span><b>Capture-first mode:</b> use the real app/site, then share the image or link back here. This avoids iframe/login/CORS problems.</span><button data-ib41-open-pwa>Share setup</button></div>
    <div class="ib41-clipboard" data-ib41-clipboard><div><b>Link found in clipboard</b><small></small></div><button data-ib41-clipboard-import>Import</button><button data-ib41-clipboard-dismiss>×</button></div>
    <div class="ib41-linkbox"><input data-ib41-url placeholder="Paste a Pinterest Pin, Cosmos element, webpage, or direct image URL"><button class="primary" data-ib41-import-url>Import Link</button><button data-ib41-open-url>Open</button></div>
    <div class="ib41-capture-head">
      <button data-ib41-select-all>Select all</button>
      <select data-ib41-provider-filter><option value="all">All sources</option>${CAPTURE_PROVIDER_ORDER.map(provider => `<option value="${provider}" ${runtime.filterProvider === provider ? 'selected' : ''}>${providerLabel(provider)}</option>`).join('')}</select>
      <input data-ib41-search placeholder="Filter captures…" value="${safeAttr(runtime.query)}">
      <select data-ib41-board>${boardOptions(app, activeBoard.id)}</select>
      <select data-ib41-target>${targetOptions(defaultTarget)}</select>
      <button class="primary" data-ib41-import-selected>Import selected</button>
    </div>
    <div data-ib41-capture-list>${captureCardsHtml(app)}</div>
    <section class="ib41-sheet" data-ib41-sheet></section>`;
}

function historyViewHtml() {
  const history = readHistory();
  if (!history.length) return '<div class="ib41-empty"><b>No capture history yet</b><p>Successful and failed capture imports will appear here with their original source links.</p></div>';
  return `<div class="ib41-history">${history.map(row => `<article class="ib41-history-row ${row.status}" data-history-id="${safeAttr(row.id)}"><div><b>${escapeHtml(row.title)}</b><small>${escapeHtml(providerLabel(row.provider))} · ${escapeHtml(row.boardName || 'Board')} · ${escapeHtml(targetById(row.targetId).label)} · ${row.count} image${row.count === 1 ? '' : 's'} · ${relativeCaptureTime(row.createdAt)}${row.error ? ` · ${escapeHtml(row.error)}` : ''}</small></div>${row.url ? `<button data-history-open="${safeAttr(row.url)}">Source</button>` : '<span></span>'}</article>`).join('')}</div>`;
}

function settingsViewHtml(app) {
  const settings = readSettings();
  return `<div class="ib41-settings">
    <section><h3>Quick-save defaults</h3><div class="ib41-settings-grid">${CAPTURE_PROVIDER_ORDER.map(provider => `<label>${providerLabel(provider)}<select data-setting-provider="${provider}">${targetOptions(settings.providerTargets[provider])}</select></label>`).join('')}<label>General quick target<select data-setting="quickTarget">${targetOptions(settings.quickTarget)}</select></label></div></section>
    <section><h3>Capture behavior</h3><div class="ib41-settings-grid"><label class="ib41-check"><input type="checkbox" data-setting="deleteAfterImport" ${settings.deleteAfterImport ? 'checked' : ''}> Remove Capture Inbox item after successful import</label><label class="ib41-check"><input type="checkbox" data-setting="autoClipboardPrompt" ${settings.autoClipboardPrompt ? 'checked' : ''}> Offer web links found in clipboard when Capture Center opens</label><label>Similar-image handling<select data-setting="nearDuplicateAction"><option value="ask" ${settings.nearDuplicateAction === 'ask' ? 'selected' : ''}>Ask me</option><option value="reuse" ${settings.nearDuplicateAction === 'reuse' ? 'selected' : ''}>Reuse existing image</option><option value="keep" ${settings.nearDuplicateAction === 'keep' ? 'selected' : ''}>Keep new copy</option></select></label><label>Refresh Capture Inbox every<select data-setting="pollSeconds">${[15,30,60,120,300].map(value => `<option value="${value}" ${settings.pollSeconds === value ? 'selected' : ''}>${value < 60 ? `${value} sec` : `${value / 60} min`}</option>`).join('')}</select></label></div></section>
    <section><h3>Compatibility tools</h3><p class="ib2-muted">The old embedded browser is intentionally de-emphasized because Pinterest and Cosmos frequently block it. The page scanner is still available as a fallback for sites that expose image metadata.</p><div class="ib41-settings-actions"><button data-ib41-legacy>Open legacy page scanner</button><button data-ib41-open-pwa>Open Android Capture App</button></div></section>
    <div class="ib41-settings-actions"><button data-ib41-settings-reset>Reset</button><button class="primary" data-ib41-settings-save>Save capture settings</button></div>
  </div>`;
}

function renderCurrentView(app) {
  const runtime = runtimeFor(app);
  const container = runtime.modal?.querySelector('[data-ib41-view]');
  if (!container) return;
  if (runtime.tab === 'capture') container.innerHTML = captureViewHtml(app);
  else if (runtime.tab === 'recent') container.innerHTML = historyViewHtml();
  else container.innerHTML = settingsViewHtml(app);
  bindCurrentView(app);
  if (runtime.tab === 'capture') installPreviewHydration(app);
}

async function hydrateCardPreview(app, card) {
  const runtime = runtimeFor(app);
  if (!card?.isConnected || card.dataset.previewLoaded) return;
  card.dataset.previewLoaded = '1';
  const share = runtime.captures.find(capture => String(capture.id) === card.dataset.ib41Capture);
  if (!share) return;
  const preview = card.querySelector('[data-ib41-preview]');
  try {
    const resolved = await resolveCapture(runtime, share);
    const candidate = resolved.candidates[0];
    if (!candidate || !preview?.isConnected) return;
    let src = candidate.url;
    if (candidate.localBlob) {
      src = URL.createObjectURL(candidate.localBlob);
      runtime.previewUrls.add(src);
    } else if (candidate.url) {
      src = `${API_ROOT}/remote-image?url=${encodeURIComponent(candidate.url)}`;
    }
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = '';
    image.src = src;
    image.onerror = () => image.remove();
    preview.prepend(image);
  } catch {
    card.dataset.previewLoaded = 'error';
  }
}

function installPreviewHydration(app) {
  const runtime = runtimeFor(app);
  runtime.previewObserver?.disconnect?.();
  const cards = [...(runtime.modal?.querySelectorAll('[data-ib41-capture]') || [])];
  if (!cards.length) return;
  if (typeof IntersectionObserver === 'function') {
    runtime.previewObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { runtime.previewObserver.unobserve(entry.target); void hydrateCardPreview(app, entry.target); }
    }, { root: runtime.modal.querySelector('[data-ib41-view]'), rootMargin: '300px' });
    cards.forEach(card => runtime.previewObserver.observe(card));
  } else {
    cards.slice(0, 12).forEach(card => void hydrateCardPreview(app, card));
  }
}

function openProvider(app, provider) {
  const url = providerLaunchUrl(provider);
  window.open(url, '_blank', 'noopener,noreferrer');
  toast(app, `Browse ${providerLabel(provider)} normally. When you find something, use Share → Inspiration Board Inbox.`, 'info');
}

async function openCaptureApp(app) {
  const runtime = runtimeFor(app);
  runtime.pluginStatus ||= await pluginStatus();
  if (!runtime.pluginStatus) return toast(app, 'The Inspiration Board server plugin is not connected. Install/update server-plugin/inspiration-board-sync and restart SillyTavern.', 'warning');
  window.open(runtime.pluginStatus.shareTargetUrl || `${API_ROOT}/app/`, '_blank', 'noopener');
}

async function refreshCaptures(app, { quiet = false } = {}) {
  const runtime = runtimeFor(app);
  runtime.pluginStatus = await pluginStatus();
  runtime.lastPollAt = Date.now();
  runtime.captures = runtime.pluginStatus ? await listPendingCaptures() : [];
  const valid = new Set(runtime.captures.map(capture => String(capture.id)));
  runtime.selected = new Set([...runtime.selected].filter(id => valid.has(id)));
  updateBadges(app);
  if (runtime.modal?.isConnected && runtime.tab === 'capture') renderCurrentView(app);
  if (!quiet && runtime.pluginStatus) toast(app, `${runtime.captures.length} pending capture${runtime.captures.length === 1 ? '' : 's'}.`, 'info');
}

function updateBadges(app) {
  const runtime = runtimeFor(app);
  const count = runtime.captures.length;
  app.root?.querySelectorAll('[data-ib41-badge]').forEach(badge => {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('show', count > 0);
  });
  const status = runtime.modal?.querySelector('[data-ib41-plugin-status]');
  if (status) {
    status.className = `status ${runtime.pluginStatus ? 'ok' : 'warn'}`;
    status.textContent = runtime.pluginStatus ? `Capture bridge · ${count} pending` : 'Server capture bridge offline';
  }
}

async function openCaptureSheet(app, share) {
  const runtime = runtimeFor(app);
  const sheet = runtime.modal?.querySelector('[data-ib41-sheet]');
  if (!sheet) return;
  sheet.classList.add('open');
  sheet.innerHTML = '<div class="ib41-empty"><b>Loading capture…</b></div>';
  try {
    const resolved = await resolveCapture(runtime, share, { allRemote: true });
    const urls = [];
    for (const candidate of resolved.candidates.slice(0, 8)) {
      if (candidate.localBlob) {
        const url = URL.createObjectURL(candidate.localBlob); runtime.previewUrls.add(url); urls.push(url);
      } else if (candidate.url) urls.push(`${API_ROOT}/remote-image?url=${encodeURIComponent(candidate.url)}`);
    }
    const settings = readSettings();
    const provider = captureProvider(resolved.share);
    const quick = quickTargetForProvider(settings, provider);
    sheet.innerHTML = `<div class="ib41-sheet-head"><div><b>${escapeHtml(resolved.share.title || 'Captured inspiration')}</b><small>${escapeHtml(providerLabel(provider))} · ${resolved.candidates.length} usable image${resolved.candidates.length === 1 ? '' : 's'}</small></div><button data-ib41-sheet-close>×</button></div>
      <div class="ib41-sheet-previews">${urls.length ? urls.map(url => `<img src="${safeAttr(url)}" alt="">`).join('') : '<span class="ib2-muted">Preview unavailable</span>'}</div>
      <div class="ib41-sheet-controls"><select data-ib41-sheet-board>${boardOptions(app, app.activeBoard().id)}</select><select data-ib41-sheet-default>${targetOptions(quick.id)}</select></div>
      <div class="ib41-targets">${BROWSE_TARGETS.map(target => `<button data-ib41-sheet-target="${target.id}"><span>${target.icon}</span>${escapeHtml(target.label)}</button>`).join('')}</div>
      <div class="ib41-source">${escapeHtml(extractCaptureUrl(resolved.share) || 'Image shared directly from Android')}</div>`;
    sheet.querySelector('[data-ib41-sheet-close]').onclick = () => sheet.classList.remove('open');
    sheet.querySelectorAll('[data-ib41-sheet-target]').forEach(button => button.onclick = async () => {
      const boardId = sheet.querySelector('[data-ib41-sheet-board]').value;
      button.disabled = true;
      try {
        const progress = app.showProgressModal?.('Saving capture', `Adding to ${app.state.boards.find(board => board.id === boardId)?.name || 'board'}…`);
        try { await importCapture(app, share, { targetId: button.dataset.ib41SheetTarget, boardId }); }
        finally { progress?.close?.(); }
        sheet.classList.remove('open');
        await refreshCaptures(app, { quiet: true });
      } catch (error) {
        toast(app, error.message || String(error), 'error');
        button.disabled = false;
      }
    });
  } catch (error) {
    sheet.innerHTML = `<div class="ib41-sheet-head"><div><b>Could not resolve capture</b><small>${escapeHtml(error.message || String(error))}</small></div><button data-ib41-sheet-close>×</button></div><div class="ib41-empty-actions"><button data-ib41-sheet-source>Open source</button><button data-ib41-sheet-retry>Retry</button></div>`;
    sheet.querySelector('[data-ib41-sheet-close]').onclick = () => sheet.classList.remove('open');
    sheet.querySelector('[data-ib41-sheet-source]').onclick = () => { const url = extractCaptureUrl(share); if (url) window.open(url, '_blank', 'noopener,noreferrer'); };
    sheet.querySelector('[data-ib41-sheet-retry]').onclick = () => openCaptureSheet(app, share);
  }
}

async function bulkImport(app) {
  const runtime = runtimeFor(app);
  const ids = selectedCaptureIds(runtime.captures, runtime.selected);
  if (!ids.length) return toast(app, 'Select one or more captures first.', 'warning');
  const boardId = runtime.modal.querySelector('[data-ib41-board]')?.value || app.activeBoard().id;
  const targetId = runtime.modal.querySelector('[data-ib41-target]')?.value || readSettings().quickTarget;
  const progress = app.showProgressModal?.('Importing captures', `Preparing ${ids.length} capture${ids.length === 1 ? '' : 's'}…`);
  const results = [];
  for (let index = 0; index < ids.length; index++) {
    const share = runtime.captures.find(capture => String(capture.id) === ids[index]);
    if (!share) continue;
    progress?.update?.(`Importing ${index + 1} of ${ids.length}: ${share.title || 'capture'}…`);
    try {
      const result = await importCapture(app, share, { targetId, boardId, openStudio: false });
      results.push({ ok: true, ...result });
    } catch (error) {
      results.push({ ok: false, error: error.message || String(error) });
      pushHistory(makeCaptureHistoryRecord({ share, provider: captureProvider(share), targetId, board: app.state.boards.find(board => board.id === boardId), status: 'failed', error: error.message || String(error) }));
    }
  }
  progress?.close?.();
  runtime.selected.clear();
  await refreshCaptures(app, { quiet: true });
  const summary = summarizeBatch(results);
  toast(app, `Capture import: ${summary.imported} saved, ${summary.images} image${summary.images === 1 ? '' : 's'}${summary.reused ? `, ${summary.reused} reused` : ''}${summary.failed ? `, ${summary.failed} failed` : ''}.`, summary.failed ? 'warning' : 'success');
  if (targetById(targetId).studio && summary.imported && boardId === app.activeBoard().id) app.openGenerationStudio?.({ draft: { referenceMode: 'selected', useBlueprint: true } });
}

function bindCaptureCards(app) {
  const runtime = runtimeFor(app);
  const list = runtime.modal?.querySelector('[data-ib41-capture-list]');
  if (!list) return;
  list.onclick = async event => {
    if (event.target.closest('[data-ib41-open-pwa]')) return openCaptureApp(app);
    if (event.target.closest('[data-ib41-refresh]')) return refreshCaptures(app);
    const card = event.target.closest('[data-ib41-capture]');
    if (!card) return;
    const share = runtime.captures.find(capture => String(capture.id) === card.dataset.ib41Capture);
    if (!share) return;
    if (event.target.closest('[data-ib41-select]')) {
      const id = String(share.id);
      if (runtime.selected.has(id)) runtime.selected.delete(id); else runtime.selected.add(id);
      card.classList.toggle('selected', runtime.selected.has(id));
      card.querySelector('[data-ib41-select]').textContent = runtime.selected.has(id) ? '✓' : '';
      return;
    }
    if (event.target.closest('[data-ib41-delete]')) {
      if (!confirm('Delete this pending capture?')) return;
      try { await deleteCapture(share.id); runtime.detailCache.delete(share.id); await refreshCaptures(app, { quiet: true }); }
      catch (error) { toast(app, error.message, 'error'); }
      return;
    }
    if (event.target.closest('[data-ib41-quick]')) {
      const settings = readSettings();
      const target = quickTargetForProvider(settings, captureProvider(share));
      const progress = app.showProgressModal?.('Quick save', `Adding as ${target.label}…`);
      try { await importCapture(app, share, { targetId: target.id, boardId: app.activeBoard().id }); await refreshCaptures(app, { quiet: true }); }
      catch (error) { toast(app, error.message || String(error), 'error'); }
      finally { progress?.close?.(); }
      return;
    }
    if (event.target.closest('[data-ib41-open]')) return openCaptureSheet(app, share);
  };
}

function saveSettingsFromView(app) {
  const runtime = runtimeFor(app);
  const container = runtime.modal?.querySelector('[data-ib41-view]');
  if (!container) return;
  const current = readSettings();
  const next = {
    ...current,
    deleteAfterImport: container.querySelector('[data-setting="deleteAfterImport"]').checked,
    autoClipboardPrompt: container.querySelector('[data-setting="autoClipboardPrompt"]').checked,
    nearDuplicateAction: container.querySelector('[data-setting="nearDuplicateAction"]').value,
    pollSeconds: Number(container.querySelector('[data-setting="pollSeconds"]').value),
    quickTarget: container.querySelector('[data-setting="quickTarget"]').value,
    providerTargets: { ...current.providerTargets },
  };
  container.querySelectorAll('[data-setting-provider]').forEach(select => { next.providerTargets[select.dataset.settingProvider] = select.value; });
  writeSettings(next);
  resetPollTimer(app);
  toast(app, 'Capture settings saved.', 'success');
  runtime.tab = 'capture';
  renderModal(app);
}

function bindCurrentView(app) {
  const runtime = runtimeFor(app);
  const container = runtime.modal?.querySelector('[data-ib41-view]');
  if (!container) return;
  container.querySelectorAll('[data-ib41-launch]').forEach(button => button.onclick = () => openProvider(app, button.dataset.ib41Launch));
  container.querySelectorAll('[data-ib41-open-pwa]').forEach(button => button.onclick = () => openCaptureApp(app));
  if (runtime.tab === 'capture') {
    bindCaptureCards(app);
    container.querySelector('[data-ib41-refresh]')?.addEventListener('click', () => refreshCaptures(app));
    container.querySelector('[data-ib41-search]')?.addEventListener('input', event => { runtime.query = event.target.value; const list = container.querySelector('[data-ib41-capture-list]'); if (list) { list.innerHTML = captureCardsHtml(app); bindCaptureCards(app); installPreviewHydration(app); } });
    container.querySelector('[data-ib41-provider-filter]')?.addEventListener('change', event => { runtime.filterProvider = event.target.value; renderCurrentView(app); });
    container.querySelector('[data-ib41-select-all]')?.addEventListener('click', () => {
      const visible = filterCaptures(runtime.captures, { query: runtime.query, provider: runtime.filterProvider });
      const allSelected = visible.length && visible.every(capture => runtime.selected.has(String(capture.id)));
      if (allSelected) visible.forEach(capture => runtime.selected.delete(String(capture.id))); else visible.forEach(capture => runtime.selected.add(String(capture.id)));
      renderCurrentView(app);
    });
    container.querySelector('[data-ib41-import-selected]')?.addEventListener('click', () => void bulkImport(app));
    container.querySelector('[data-ib41-import-url]')?.addEventListener('click', async () => {
      const input = container.querySelector('[data-ib41-url]');
      const url = String(input.value || '').trim();
      if (!url) return;
      const boardId = container.querySelector('[data-ib41-board]')?.value || app.activeBoard().id;
      const targetId = container.querySelector('[data-ib41-target]')?.value || readSettings().quickTarget;
      const progress = app.showProgressModal?.('Importing link', 'Resolving the best image…');
      try { await importUrlDirect(app, url, targetId, boardId); input.value = ''; toast(app, 'Link imported.', 'success'); }
      catch (error) { toast(app, error.message || String(error), 'error'); }
      finally { progress?.close?.(); }
    });
    container.querySelector('[data-ib41-open-url]')?.addEventListener('click', () => { const url = container.querySelector('[data-ib41-url]').value.trim(); if (url) window.open(url, '_blank', 'noopener,noreferrer'); });
    container.querySelector('[data-ib41-clipboard-import]')?.addEventListener('click', async () => {
      const url = runtime.clipboardUrl; if (!url) return;
      const targetId = quickTargetForProvider(readSettings(), captureProvider({ url })).id;
      const progress = app.showProgressModal?.('Importing clipboard link', 'Resolving image…');
      try { await importUrlDirect(app, url, targetId, app.activeBoard().id); runtime.clipboardUrl = ''; renderCurrentView(app); }
      catch (error) { toast(app, error.message || String(error), 'error'); }
      finally { progress?.close?.(); }
    });
    container.querySelector('[data-ib41-clipboard-dismiss]')?.addEventListener('click', () => { runtime.clipboardUrl = ''; container.querySelector('[data-ib41-clipboard]').classList.remove('open'); });
    if (runtime.clipboardUrl) {
      const banner = container.querySelector('[data-ib41-clipboard]'); banner.classList.add('open'); banner.querySelector('small').textContent = runtime.clipboardUrl;
    }
  } else if (runtime.tab === 'recent') {
    container.querySelectorAll('[data-history-open]').forEach(button => button.onclick = () => window.open(button.dataset.historyOpen, '_blank', 'noopener,noreferrer'));
  } else {
    container.querySelector('[data-ib41-settings-save]').onclick = () => saveSettingsFromView(app);
    container.querySelector('[data-ib41-settings-reset]').onclick = () => { writeSettings({}); renderCurrentView(app); };
    container.querySelector('[data-ib41-legacy]').onclick = () => runtime.legacyBrowseOpen?.('pinterest');
  }
}

function renderModal(app) {
  const runtime = runtimeFor(app);
  const modal = runtime.modal;
  if (!modal?.isConnected) return;
  modal.querySelectorAll('[data-ib41-tab]').forEach(button => button.classList.toggle('active', button.dataset.ib41Tab === runtime.tab));
  updateBadges(app);
  renderCurrentView(app);
}

export function openCaptureCenter(app, initialTab = 'capture') {
  injectStyles();
  ensureButtons(app);
  const runtime = runtimeFor(app);
  runtime.tab = ['capture', 'recent', 'settings'].includes(initialTab) ? initialTab : 'capture';
  revokePreviews(runtime);
  const modal = app.showModal('Capture Center', `<div class="ib41-shell"><nav class="ib41-tabs"><button data-ib41-tab="capture">⇩ Captures</button><button data-ib41-tab="recent">◴ Recent</button><button data-ib41-tab="settings">⚙ Settings</button><span class="spacer"></span><span class="status" data-ib41-plugin-status>Checking capture bridge…</span></nav><main class="ib41-view" data-ib41-view></main></div>`, 'ib41-capture-modal');
  runtime.modal = modal;
  modal.querySelectorAll('[data-ib41-tab]').forEach(button => button.onclick = () => { runtime.tab = button.dataset.ib41Tab; renderModal(app); });
  modal.querySelector('[data-modal-close]').addEventListener('click', () => { revokePreviews(runtime); runtime.modal = null; });
  renderModal(app);
  void refreshCaptures(app, { quiet: true }).then(() => hydrateClipboard(app));
  return modal;
}

function ensureButtons(app) {
  if (!app.root) return;
  const rail = app.root.querySelector('.ib2-rail');
  if (rail && !rail.querySelector('[data-ib41-capture-button]')) {
    const button = document.createElement('button');
    button.className = 'ib41-capture-button';
    button.dataset.ib41CaptureButton = '1';
    button.title = 'Capture from Pinterest, Cosmos, Gallery and the web';
    button.innerHTML = '<span>⇩</span><label>Capture</label><em class="ib41-badge" data-ib41-badge>0</em>';
    const anchor = rail.querySelector('[data-cmd="url"]');
    anchor?.after(button);
    if (!anchor) rail.prepend(button);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openCaptureCenter(app); });
  }
  const top = app.root.querySelector('.ib2-topbar');
  if (top && !top.querySelector('[data-ib41-capture-top]')) {
    const button = document.createElement('button');
    button.className = 'ib41-capture-button';
    button.dataset.ib41CaptureTop = '1';
    button.title = 'Open Capture Center';
    button.innerHTML = '⇩ Capture <span class="ib41-badge" data-ib41-badge>0</span>';
    const anchor = top.querySelector('[data-cmd="inbox"]');
    anchor?.before(button);
    if (!anchor) top.appendChild(button);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openCaptureCenter(app); });
  }
  updateBadges(app);
}

function resetPollTimer(app) {
  const runtime = runtimeFor(app);
  clearInterval(runtime.pollTimer);
  const seconds = readSettings().pollSeconds;
  runtime.pollTimer = setInterval(() => {
    if (!app.root?.isConnected) return;
    void refreshCaptures(app, { quiet: true });
  }, seconds * 1000);
}

function installSettingsShortcut(app) {
  const panel = document.querySelector('#inspiration_board_settings .inline-drawer-content');
  if (!panel || panel.querySelector('[data-ib41-settings-shortcut]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu_button interactable';
  button.dataset.ib41SettingsShortcut = '1';
  button.textContent = '⇩ Capture Center';
  panel.querySelector('.ib-v2-settings-actions')?.appendChild(button);
  if (!button.isConnected) panel.appendChild(button);
  button.onclick = () => globalThis.InspirationBoard?.app && openCaptureCenter(globalThis.InspirationBoard.app);
}

export function installCaptureFirst(app) {
  if (!app) return false;
  injectStyles();
  const runtime = runtimeFor(app);
  if (!runtime.legacyBrowseOpen && globalThis.InspirationBoardBrowse?.open) runtime.legacyBrowseOpen = globalThis.InspirationBoardBrowse.open;
  ensureButtons(app);
  installSettingsShortcut(app);
  if (!app[INSTALL_KEY]) {
    app[INSTALL_KEY] = true;
    app.openCaptureCenter = tab => openCaptureCenter(app, tab);
    resetPollTimer(app);
    setTimeout(() => void refreshCaptures(app, { quiet: true }), 1500);
  }
  clearInterval(runtime.installTimer);
  runtime.installTimer = setInterval(() => {
    if (!app.root?.isConnected) return;
    ensureButtons(app);
    installSettingsShortcut(app);
  }, 1000);
  globalThis.InspirationBoardCapture = {
    version: CAPTURE_VERSION,
    open: tab => openCaptureCenter(app, tab),
    refresh: () => refreshCaptures(app),
    settings: () => readSettings(),
    history: () => readHistory(),
    importUrl: (url, target = readSettings().quickTarget, boardId = app.activeBoard().id) => importUrlDirect(app, url, target, boardId),
  };
  console.info(`[Inspiration Board] Capture-first workflow v${CAPTURE_VERSION} installed`);
  return true;
}
