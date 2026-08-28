import { normalizeState } from './core-v2.js';
import { clearImages, createImageRecord, listImages, putImage } from './db-v2.js';
import { ensureStudio, sanitizeFilename } from './studio-core-v3.js';

const API_ROOT = '/api/plugins/inspiration-board-sync';

function requestHeaders({ contentType = null } = {}) {
  const context = globalThis.SillyTavern?.getContext?.();
  const headers = context?.getRequestHeaders?.({ omitContentType: true }) || {};
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function blobToSerializable(blob) {
  return {
    type: blob.type,
    data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
  };
}

function serializableToBlob(value) {
  return new Blob([base64ToBytes(value.data)], { type: value.type || 'application/octet-stream' });
}

async function serializeImage(record) {
  const output = { ...record };
  output.blob = await blobToSerializable(record.blob);
  if (record.thumbnail) output.thumbnail = await blobToSerializable(record.thumbnail);
  return output;
}

async function deserializeImage(record) {
  const output = { ...record };
  output.blob = serializableToBlob(record.blob);
  if (record.thumbnail) output.thumbnail = serializableToBlob(record.thumbnail);
  return output;
}

async function gzipBytes(text) {
  const source = new TextEncoder().encode(text);
  if (typeof CompressionStream !== 'function') return { bytes: source, encoding: 'identity' };
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), encoding: 'gzip' };
}

async function ungzipText(bytes, encoding) {
  if (encoding !== 'gzip') return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress the synced workspace. Update Chrome and retry.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function buildWorkspaceBundle(app, { activeBoardOnly = false } = {}) {
  const state = typeof structuredClone === 'function' ? structuredClone(app.state) : JSON.parse(JSON.stringify(app.state));
  if (activeBoardOnly) {
    state.boards = state.boards.filter(board => board.id === state.activeBoardId);
    state.activeBoardId = state.boards[0]?.id || null;
  }
  const usedImageIds = new Set();
  for (const board of state.boards) {
    for (const item of board.items || []) if (item.imageId) usedImageIds.add(item.imageId);
    for (const entry of board.inbox || []) if (entry.imageId) usedImageIds.add(entry.imageId);
    for (const generation of board.studio?.generations || []) for (const id of generation.resultImageIds || []) usedImageIds.add(id);
  }
  const images = (await listImages()).filter(record => !activeBoardOnly || usedImageIds.has(record.id));
  const serialized = [];
  for (const image of images) serialized.push(await serializeImage(image));
  return {
    format: 'sillytavern-inspiration-board-workspace',
    version: 3,
    exportedAt: Date.now(),
    state,
    images: serialized,
  };
}

export async function restoreWorkspaceBundle(app, bundle, { replace = true, clearImageStore = false } = {}) {
  if (bundle?.format !== 'sillytavern-inspiration-board-workspace' || !bundle.state || !Array.isArray(bundle.images)) throw new Error('This is not a valid Inspiration Board workspace bundle.');
  await app.createPersistentSnapshot?.('Before workspace restore', true);
  if (clearImageStore) await clearImages();
  for (const serialized of bundle.images) await putImage(await deserializeImage(serialized));
  if (replace) {
    app.state = normalizeState(bundle.state);
  } else {
    const incoming = normalizeState(bundle.state);
    const existingIds = new Set(app.state.boards.map(board => board.id));
    for (const board of incoming.boards) {
      if (existingIds.has(board.id)) board.id = `${board.id}-${Date.now().toString(36)}`;
      app.state.boards.push(board);
    }
  }
  app.selectedIds.clear();
  app.saveStateNow?.({ snapshot: false });
  app.clearObjectUrls?.();
  await app.render?.();
}

export async function syncPluginStatus() {
  const response = await fetch(`${API_ROOT}/status`, { headers: requestHeaders() });
  if (!response.ok) throw new Error('The optional Inspiration Board Sync server plugin is not installed or not running.');
  return response.json();
}

export async function listServerWorkspaces() {
  const response = await fetch(`${API_ROOT}/workspaces`, { headers: requestHeaders() });
  if (!response.ok) throw new Error(`Could not list server workspaces (HTTP ${response.status}).`);
  return response.json();
}

export async function saveWorkspaceToServer(app, workspaceId, { activeBoardOnly = false, onProgress = () => {} } = {}) {
  onProgress('Collecting boards and images…');
  const bundle = await buildWorkspaceBundle(app, { activeBoardOnly });
  onProgress(`Compressing ${bundle.images.length} stored image${bundle.images.length === 1 ? '' : 's'}…`);
  const packed = await gzipBytes(JSON.stringify(bundle));
  const response = await fetch(`${API_ROOT}/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: 'PUT',
    headers: {
      ...requestHeaders({ contentType: 'application/octet-stream' }),
      'X-Inspiration-Encoding': packed.encoding,
      'X-Inspiration-Name': encodeURIComponent(app.activeBoard().name || workspaceId),
    },
    body: packed.bytes,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Server sync failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const result = await response.json();
  const studio = ensureStudio(app.activeBoard());
  studio.sync.workspaceId = workspaceId;
  studio.sync.lastSyncedAt = Date.now();
  app.scheduleSave();
  return result;
}

export async function loadWorkspaceFromServer(app, workspaceId, { replace = true, onProgress = () => {} } = {}) {
  onProgress('Downloading workspace…');
  const response = await fetch(`${API_ROOT}/workspaces/${encodeURIComponent(workspaceId)}`, { headers: requestHeaders() });
  if (!response.ok) throw new Error(`Could not load the server workspace (HTTP ${response.status}).`);
  const encoding = response.headers.get('X-Inspiration-Encoding') || 'identity';
  const bytes = new Uint8Array(await response.arrayBuffer());
  onProgress('Decompressing and restoring…');
  const bundle = JSON.parse(await ungzipText(bytes, encoding));
  await restoreWorkspaceBundle(app, bundle, { replace });
  return bundle;
}

export async function deleteServerWorkspace(workspaceId) {
  const response = await fetch(`${API_ROOT}/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'DELETE', headers: requestHeaders() });
  if (!response.ok) throw new Error(`Could not delete server workspace (HTTP ${response.status}).`);
  return response.json();
}

export async function listPendingShares() {
  const response = await fetch(`${API_ROOT}/shares`, { headers: requestHeaders() });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export async function importPendingShare(app, shareId) {
  const response = await fetch(`${API_ROOT}/shares/${encodeURIComponent(shareId)}`, { headers: requestHeaders() });
  if (!response.ok) throw new Error(`Could not fetch the shared images (HTTP ${response.status}).`);
  const share = await response.json();
  const files = (share.files || []).map(file => new File([base64ToBytes(file.data)], file.name || 'shared-image', { type: file.type || 'image/jpeg' }));
  if (!files.length) throw new Error('The share did not contain image files.');
  await app.ingestFiles(files, { sourceUrl: share.url || '' });
  await fetch(`${API_ROOT}/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE', headers: requestHeaders() });
  return share;
}

export async function shareImageFromBoard(app, item, { text = '', title = '' } = {}) {
  const record = await (await import('./db-v2.js')).getImage(item.imageId);
  if (!record?.blob) throw new Error('The selected image is missing.');
  const extension = record.mime === 'image/jpeg' ? 'jpg' : record.mime === 'image/webp' ? 'webp' : 'png';
  const file = new File([record.blob], `${sanitizeFilename(item.name || 'inspiration-board')}.${extension}`, { type: record.mime || 'image/png' });
  const data = { title: title || item.name || 'Inspiration Board', text: text || item.notes || '', files: [file] };
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share(data);
    return true;
  }
  const url = URL.createObjectURL(record.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return false;
}

export async function copyReferenceBundle(app, items) {
  const board = app.activeBoard();
  const studio = ensureStudio(board);
  const bundle = {
    board: board.name,
    character: board.character?.name || '',
    blueprint: studio.blueprint,
    references: items.map(item => ({
      name: item.name,
      role: item.role,
      tags: item.tags,
      notes: item.notes,
      sourceUrl: item.sourceUrl,
      config: studio.referenceConfig?.[item.id] || null,
    })),
  };
  await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
  return bundle;
}

function serverPluginInstallCommand() {
  return `cd ~/SillyTavern/plugins && git clone https://github.com/sogyboi/SillyTavern-Inspiration-Board.git inspiration-board-sync-repo && cp -r inspiration-board-sync-repo/server-plugin/inspiration-board-sync ./inspiration-board-sync`;
}

export async function openSyncSharePanel(app) {
  const studio = ensureStudio(app.activeBoard());
  const modal = app.showModal('Sync, Share & Android Capture', `
    <div class="ib3-sync-hero">
      <b>Keep boards available across devices</b>
      <span>Browser storage remains the default. The optional server plugin adds phone/PC sync and an Android share-target inbox.</span>
    </div>
    <div class="ib3-sync-status" data-sync-status>Checking server plugin…</div>
    <div class="ib3-form-grid">
      <label>Workspace ID<input data-sync-id value="${sanitizeFilename(studio.sync.workspaceId || studio.settings.serverWorkspaceId || app.activeBoard().name, 'my-board')}"></label>
      <label>Save scope<select data-sync-scope><option value="all" ${studio.settings.syncAllBoards ? 'selected' : ''}>All boards and images</option><option value="active" ${!studio.settings.syncAllBoards ? 'selected' : ''}>Current board only</option></select></label>
    </div>
    <div class="ib3-sync-actions">
      <button data-sync-save><span>☁</span><b>Save to Server</b><small>Upload a compressed workspace snapshot.</small></button>
      <button data-sync-load><span>⇣</span><b>Load from Server</b><small>Restore or merge a saved workspace.</small></button>
      <button data-sync-list><span>▤</span><b>Browse Workspaces</b><small>See server copies, sizes and dates.</small></button>
      <button data-sync-shares><span>↗</span><b>Android Share Inbox</b><small>Import images shared to the optional companion PWA.</small></button>
      <button data-sync-share-selected><span>⌁</span><b>Share Selected Image</b><small>Use Android or browser share with the image and notes.</small></button>
      <button data-sync-copy><span>{ }</span><b>Copy Reference Bundle</b><small>Copy roles, tags, blueprint and source metadata.</small></button>
    </div>
    <details class="ib3-sync-install"><summary>Server plugin installation</summary><p>The extension works without this. To enable server sync, copy <code>server-plugin/inspiration-board-sync</code> from the repository into SillyTavern's <code>plugins</code> folder and restart SillyTavern. Server plugins must be enabled in config.yaml.</p><textarea readonly>${serverPluginInstallCommand()}</textarea><p>After installation, open <code>${location.origin}${API_ROOT}/app/</code> in Chrome and install it to Android for the share-target workflow.</p></details>
  `, 'ib3-sync-modal');
  const status = modal.querySelector('[data-sync-status]');
  const setStatus = (message, type = '') => { status.textContent = message; status.className = `ib3-sync-status ${type}`; };
  let plugin = null;
  try { plugin = await syncPluginStatus(); setStatus(`Server plugin connected · v${plugin.version || 'unknown'} · ${plugin.workspaceCount || 0} workspace(s)`, 'good'); }
  catch (error) { setStatus(error.message, 'warning'); }

  const workspaceId = () => sanitizeFilename(modal.querySelector('[data-sync-id]').value, 'my-board');
  modal.querySelector('[data-sync-save]').onclick = async () => {
    if (!plugin) return app.toast('Install and restart the optional server plugin first.', 'warning');
    const progress = app.showProgressModal('Saving workspace', 'Collecting data…');
    try {
      const result = await saveWorkspaceToServer(app, workspaceId(), {
        activeBoardOnly: modal.querySelector('[data-sync-scope]').value === 'active',
        onProgress: message => progress.update(message),
      });
      setStatus(`Saved ${result.name || workspaceId()} · ${new Date(result.updatedAt).toLocaleString()}`, 'good');
      app.toast('Workspace saved to the SillyTavern server.', 'success');
    } catch (error) { app.toast(error.message, 'error'); setStatus(error.message, 'error'); }
    finally { progress.close(); }
  };
  modal.querySelector('[data-sync-load]').onclick = async () => {
    if (!plugin) return app.toast('Install and restart the optional server plugin first.', 'warning');
    const mode = confirm('Replace your local boards with the server copy?\n\nOK = Replace\nCancel = Merge as additional boards') ? 'replace' : 'merge';
    const progress = app.showProgressModal('Loading workspace', 'Downloading…');
    try {
      await loadWorkspaceFromServer(app, workspaceId(), { replace: mode === 'replace', onProgress: message => progress.update(message) });
      app.toast(`Workspace ${mode === 'replace' ? 'restored' : 'merged'}.`, 'success'); modal.remove();
    } catch (error) { app.toast(error.message, 'error'); }
    finally { progress.close(); }
  };
  modal.querySelector('[data-sync-list]').onclick = async () => {
    if (!plugin) return app.toast('Install and restart the optional server plugin first.', 'warning');
    const rows = await listServerWorkspaces();
    const list = app.showModal('Server Workspaces', `<div class="ib3-server-list">${rows.length ? rows.map(row => `<article><div><b>${row.name || row.id}</b><span>${Math.round((row.size || 0) / 1024 / 1024 * 10) / 10} MB · ${new Date(row.updatedAt).toLocaleString()}</span></div><button data-server-load="${row.id}">Load</button><button class="danger" data-server-delete="${row.id}">Delete</button></article>`).join('') : '<p class="ib2-muted">No server workspaces yet.</p>'}</div>`);
    list.querySelectorAll('[data-server-load]').forEach(button => button.onclick = async () => { modal.querySelector('[data-sync-id]').value = button.dataset.serverLoad; list.remove(); });
    list.querySelectorAll('[data-server-delete]').forEach(button => button.onclick = async () => { if (confirm(`Delete ${button.dataset.serverDelete} from the server?`)) { await deleteServerWorkspace(button.dataset.serverDelete); button.closest('article').remove(); } });
  };
  modal.querySelector('[data-sync-shares]').onclick = async () => {
    if (!plugin) return app.toast('Install and restart the optional server plugin first.', 'warning');
    const shares = await listPendingShares();
    const shareModal = app.showModal('Android Share Inbox', `<div class="ib3-server-list">${shares.length ? shares.map(share => `<article><div><b>${share.title || share.id}</b><span>${share.fileCount} image(s) · ${new Date(share.createdAt).toLocaleString()}</span></div><button data-share-import="${share.id}">Import</button></article>`).join('') : '<p class="ib2-muted">No pending Android shares.</p>'}</div>`);
    shareModal.querySelectorAll('[data-share-import]').forEach(button => button.onclick = async () => { await importPendingShare(app, button.dataset.shareImport); button.closest('article').remove(); app.toast('Shared images added to the Inbox.', 'success'); });
  };
  modal.querySelector('[data-sync-share-selected]').onclick = async () => {
    const item = [...app.selectedIds].map(id => app.itemById(id)).find(candidate => candidate?.type === 'image');
    if (!item) return app.toast('Select an image first.', 'warning');
    await shareImageFromBoard(app, item, { text: item.notes || `Reference from ${app.activeBoard().name}` });
  };
  modal.querySelector('[data-sync-copy]').onclick = async () => {
    const items = [...app.selectedIds].map(id => app.itemById(id)).filter(item => item?.type === 'image');
    await copyReferenceBundle(app, items.length ? items : app.activeBoard().items.filter(item => item.type === 'image'));
    app.toast('Reference bundle copied.', 'success');
  };
}

export async function pollPendingShares(app) {
  const studio = ensureStudio(app.activeBoard());
  if (!studio.settings.shareTargetPolling) return [];
  try {
    const shares = await listPendingShares();
    if (shares.length) app.toast(`${shares.length} Android share bundle${shares.length === 1 ? ' is' : 's are'} waiting in Sync & Share.`, 'info');
    return shares;
  } catch { return []; }
}

export function injectSyncStyles() {
  if (document.getElementById('ib3-sync-styles')) return;
  const style = document.createElement('style');
  style.id = 'ib3-sync-styles';
  style.textContent = `
    .ib3-sync-hero{display:flex;flex-direction:column;gap:4px;padding:14px;border:1px solid #4e407c;border-radius:15px;background:radial-gradient(circle at top right,#8f6cff35,transparent 48%),#14141f}.ib3-sync-hero span{font-size:11px;color:var(--ib2-muted)}.ib3-sync-status{margin:9px 0;padding:8px 10px;border:1px solid var(--ib2-line);border-radius:10px;background:#11111a;font-size:10px}.ib3-sync-status.good{border-color:#2f6846;color:#9effbd}.ib3-sync-status.warning{border-color:#74562e;color:#ffd28c}.ib3-sync-status.error{border-color:#743344;color:#ff9aaa}
    .ib3-sync-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px}.ib3-sync-actions button{display:grid;grid-template-columns:34px 1fr;grid-template-rows:auto auto;gap:2px 8px;text-align:left;padding:10px;border:1px solid var(--ib2-line);border-radius:13px;background:#171722;color:var(--ib2-text)}.ib3-sync-actions button>span{grid-row:1/3;display:grid;place-items:center;font-size:23px;color:#b9a4ff}.ib3-sync-actions small{color:var(--ib2-muted);font-size:9px}.ib3-sync-install{margin-top:12px;border:1px solid var(--ib2-line);border-radius:12px;padding:9px}.ib3-sync-install textarea{width:100%;min-height:88px;font-family:monospace;font-size:9px}
    .ib3-server-list{display:grid;gap:8px}.ib3-server-list article{display:flex;gap:7px;align-items:center;padding:9px;border:1px solid var(--ib2-line);border-radius:11px;background:#161621}.ib3-server-list article>div{display:flex;flex-direction:column;flex:1;min-width:0}.ib3-server-list span{font-size:9px;color:var(--ib2-muted)}
    @media(max-width:620px){.ib3-sync-actions{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}
