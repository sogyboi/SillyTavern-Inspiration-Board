import { ROLE_OPTIONS, clamp, duplicateItem, fitItems, makeBoard, makeImageItem, makeNoteItem, normalizeState, staggerPositions, uid } from './core.js';
import { clearImages, deleteImage, getImage, getImageByHash, hashBlob, listImages, makeThumbnail, putImage } from './db.js';

const MODULE = 'inspiration_board';
const STORAGE_KEY = 'st_inspiration_board_state_v1';
const MAX_FILE_MB = 30;
const imageUrlCache = new Map();

let state = loadState();
let selectedIds = new Set();
let history = [];
let future = [];
let boardRoot = null;
let canvasViewport = null;
let world = null;
let activeObjectUrls = new Set();
let searchText = '';
let filterRole = 'all';
let contextMenuItemId = null;
let drawerOpen = false;
let pointerMode = null;
let pinchStart = null;
let saveTimer = null;

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch (error) {
    console.warn('[Inspiration Board] Failed to load state', error);
    return normalizeState(null);
  }
}

function saveStateNow() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const ctx = globalThis.SillyTavern?.getContext?.();
  if (ctx?.extensionSettings) {
    ctx.extensionSettings[MODULE] ??= {};
    ctx.extensionSettings[MODULE].lastBoardId = state.activeBoardId;
    ctx.extensionSettings[MODULE].version = 1;
    ctx.saveSettingsDebounced?.();
  }
  updateSaveStatus('Saved');
}

function scheduleSave() {
  updateSaveStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 180);
}

function snapshot() {
  history.push(JSON.stringify(state));
  if (history.length > 40) history.shift();
  future.length = 0;
}

function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(state));
  state = normalizeState(JSON.parse(history.pop()));
  selectedIds.clear();
  scheduleSave();
  render();
}

function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(state));
  state = normalizeState(JSON.parse(future.pop()));
  selectedIds.clear();
  scheduleSave();
  render();
}

function activeBoard() {
  return state.boards.find(b => b.id === state.activeBoardId) || state.boards[0];
}

function itemById(id) {
  return activeBoard().items.find(item => item.id === id);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[ch]);
}

function toast(message, type = 'info') {
  if (globalThis.toastr?.[type]) globalThis.toastr[type](message, 'Inspiration Board');
  else console[type === 'error' ? 'error' : 'log'](`[Inspiration Board] ${message}`);
}

function updateSaveStatus(text) {
  const el = boardRoot?.querySelector('[data-save-status]');
  if (el) el.textContent = text;
}

function canvasCenterWorld() {
  const rect = canvasViewport.getBoundingClientRect();
  const view = activeBoard().view;
  return {
    x: (rect.width / 2 - view.x) / view.zoom,
    y: (rect.height / 2 - view.y) / view.zoom
  };
}

function setView(view, save = true) {
  const board = activeBoard();
  board.view = {
    x: Number.isFinite(view.x) ? view.x : board.view.x,
    y: Number.isFinite(view.y) ? view.y : board.view.y,
    zoom: clamp(Number.isFinite(view.zoom) ? view.zoom : board.view.zoom, 0.12, 4)
  };
  applyWorldTransform();
  updateZoomLabel();
  renderMinimap();
  if (save) scheduleSave();
}

function applyWorldTransform() {
  if (!world) return;
  const { x, y, zoom } = activeBoard().view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
}

function updateZoomLabel() {
  const label = boardRoot?.querySelector('[data-zoom-label]');
  if (label) label.textContent = `${Math.round(activeBoard().view.zoom * 100)}%`;
}

async function imageRecordToUrl(imageId, thumb = true) {
  const key = `${imageId}:${thumb ? 't' : 'o'}`;
  if (imageUrlCache.has(key)) return imageUrlCache.get(key);
  const record = await getImage(imageId);
  if (!record) return '';
  const blob = thumb && record.thumbnail ? record.thumbnail : record.blob;
  const url = URL.createObjectURL(blob);
  imageUrlCache.set(key, url);
  activeObjectUrls.add(url);
  return url;
}

function clearObjectUrls() {
  for (const url of activeObjectUrls) URL.revokeObjectURL(url);
  activeObjectUrls.clear();
  imageUrlCache.clear();
}

async function dimensionsForBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return dimensions;
}

async function ingestFiles(fileList) {
  const files = [...fileList].filter(file => file.type.startsWith('image/'));
  if (!files.length) return toast('No image files were selected.', 'warning');
  const accepted = files.filter(file => file.size <= MAX_FILE_MB * 1024 * 1024);
  if (accepted.length !== files.length) toast(`Skipped ${files.length - accepted.length} image(s) over ${MAX_FILE_MB} MB.`, 'warning');
  if (!accepted.length) return;

  const center = canvasCenterWorld();
  const positions = staggerPositions(accepted.length, center.x, center.y);
  snapshot();
  let added = 0;
  let reused = 0;

  for (let i = 0; i < accepted.length; i++) {
    const file = accepted[i];
    try {
      const hash = await hashBlob(file);
      let record = await getImageByHash(hash);
      if (!record) {
        const dims = await dimensionsForBlob(file);
        const thumbnail = await makeThumbnail(file);
        record = {
          id: uid('image'),
          name: file.name || `Image ${Date.now()}`,
          mime: file.type || 'image/jpeg',
          size: file.size,
          hash,
          width: dims.width,
          height: dims.height,
          blob: file,
          thumbnail: thumbnail.blob,
          createdAt: Date.now()
        };
        await putImage(record);
      } else {
        reused++;
      }
      const ratio = record.width / Math.max(1, record.height);
      const cardW = ratio >= 1 ? 340 : 280;
      const cardH = clamp(cardW / ratio, 190, 460);
      const pos = positions[i];
      activeBoard().items.push(makeImageItem({ imageId: record.id, name: file.name || record.name, width: cardW, height: cardH, x: pos.x, y: pos.y }));
      added++;
    } catch (error) {
      console.error('[Inspiration Board] import failed', file.name, error);
      toast(`Could not import ${file.name}.`, 'error');
    }
  }
  activeBoard().updatedAt = Date.now();
  scheduleSave();
  await renderItems();
  toast(`Added ${added} image${added === 1 ? '' : 's'}${reused ? ` (${reused} duplicate file${reused === 1 ? '' : 's'} reused)` : ''}.`, 'success');
}

async function importImageUrl() {
  const url = prompt('Paste a direct image URL:');
  if (!url) return;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('URL did not return an image');
    const filename = new URL(url).pathname.split('/').pop() || 'web-image';
    const file = new File([blob], filename, { type: blob.type });
    await ingestFiles([file]);
  } catch (error) {
    console.error(error);
    toast('That site blocked direct image importing. Save the image to your gallery and use Add Photos instead.', 'error');
  }
}

function addNote() {
  const center = canvasCenterWorld();
  snapshot();
  activeBoard().items.push(makeNoteItem({ x: center.x - 120, y: center.y - 80 }));
  scheduleSave();
  renderItems();
}

function addBoard() {
  const name = prompt('Board name:', 'New Character');
  if (!name?.trim()) return;
  snapshot();
  const board = makeBoard(name.trim());
  state.boards.push(board);
  state.activeBoardId = board.id;
  selectedIds.clear();
  scheduleSave();
  render();
}

function renameBoard() {
  const board = activeBoard();
  const name = prompt('Rename board:', board.name);
  if (!name?.trim()) return;
  snapshot();
  board.name = name.trim();
  board.updatedAt = Date.now();
  scheduleSave();
  renderBoardPicker();
}

function deleteBoard() {
  if (state.boards.length <= 1) return toast('You need at least one board.', 'warning');
  const board = activeBoard();
  if (!confirm(`Delete board “${board.name}”? Images used by other boards are kept.`)) return;
  snapshot();
  state.boards = state.boards.filter(b => b.id !== board.id);
  state.activeBoardId = state.boards[0].id;
  selectedIds.clear();
  scheduleSave();
  render();
}

function selectBoard(id) {
  if (!state.boards.some(b => b.id === id)) return;
  state.activeBoardId = id;
  selectedIds.clear();
  closeContextMenu();
  scheduleSave();
  render();
}

function deleteSelected() {
  if (!selectedIds.size) return;
  const board = activeBoard();
  const items = board.items.filter(item => selectedIds.has(item.id));
  if (!items.length) return;
  if (state.settings.confirmDelete && !confirm(`Move ${items.length} item(s) to trash?`)) return;
  snapshot();
  state.trash.push(...items.map(item => ({ ...structuredClone(item), boardId: board.id, deletedAt: Date.now() })));
  board.items = board.items.filter(item => !selectedIds.has(item.id));
  if (board.character.mainImageId && selectedIds.has(board.character.mainImageId)) board.character.mainImageId = null;
  board.character.referenceIds = board.character.referenceIds.filter(id => !selectedIds.has(id));
  selectedIds.clear();
  scheduleSave();
  renderItems();
  renderDrawer();
}

function duplicateSelected() {
  if (!selectedIds.size) return;
  snapshot();
  const copies = activeBoard().items.filter(item => selectedIds.has(item.id)).map(item => duplicateItem(item));
  activeBoard().items.push(...copies);
  selectedIds = new Set(copies.map(item => item.id));
  scheduleSave();
  renderItems();
}

function smartArrange() {
  const board = activeBoard();
  const movable = board.items.filter(item => !item.locked);
  if (!movable.length) return;
  snapshot();
  const positions = staggerPositions(movable.length, 0, 0);
  movable.forEach((item, index) => Object.assign(item, positions[index]));
  scheduleSave();
  renderItems();
  fitBoard();
}

function fitBoard() {
  const rect = canvasViewport.getBoundingClientRect();
  setView(fitItems(activeBoard().items, rect.width, rect.height), true);
}

function zoomAt(clientX, clientY, factor) {
  const rect = canvasViewport.getBoundingClientRect();
  const board = activeBoard();
  const old = board.view.zoom;
  const next = clamp(old * factor, 0.12, 4);
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const wx = (px - board.view.x) / old;
  const wy = (py - board.view.y) / old;
  setView({ zoom: next, x: px - wx * next, y: py - wy * next }, false);
  scheduleSave();
}

function openContextMenu(itemId, clientX, clientY) {
  contextMenuItemId = itemId;
  const item = itemById(itemId);
  if (!item) return;
  const menu = boardRoot.querySelector('.ib-context-menu');
  menu.innerHTML = `
    ${item.type === 'image' ? '<button data-action="main">★ Set as Main Portrait</button><button data-action="reference">✦ Add/Remove Character Reference</button><div class="ib-menu-label">Reference type</div>' + ROLE_OPTIONS.map(role => `<button data-action="role" data-role="${role}" class="${item.role === role ? 'active' : ''}">${role[0].toUpperCase() + role.slice(1)}</button>`).join('') : '<button data-action="edit-note">✎ Edit Note</button>'}
    <button data-action="tags"># Edit Tags</button>
    <button data-action="collection">▣ Set Collection</button>
    <button data-action="lock">${item.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
    <button data-action="duplicate">⧉ Duplicate</button>
    <button data-action="delete" class="danger">🗑 Move to Trash</button>`;
  const rect = boardRoot.getBoundingClientRect();
  const x = clamp(clientX - rect.left, 8, rect.width - 250);
  const y = clamp(clientY - rect.top, 8, rect.height - 440);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('open');
}

function closeContextMenu() {
  contextMenuItemId = null;
  boardRoot?.querySelector('.ib-context-menu')?.classList.remove('open');
}

function handleContextAction(button) {
  const item = itemById(contextMenuItemId);
  if (!item) return closeContextMenu();
  const action = button.dataset.action;
  snapshot();
  if (action === 'main' && item.type === 'image') {
    activeBoard().character.mainImageId = item.id;
    if (!activeBoard().character.referenceIds.includes(item.id)) activeBoard().character.referenceIds.push(item.id);
  } else if (action === 'reference' && item.type === 'image') {
    const refs = activeBoard().character.referenceIds;
    activeBoard().character.referenceIds = refs.includes(item.id) ? refs.filter(id => id !== item.id) : [...refs, item.id];
  } else if (action === 'role' && item.type === 'image') {
    item.role = button.dataset.role;
  } else if (action === 'edit-note' && item.type === 'note') {
    const value = prompt('Note text:', item.text);
    if (value !== null) item.text = value;
  } else if (action === 'tags') {
    const value = prompt('Tags, separated by commas:', item.tags.join(', '));
    if (value !== null) item.tags = value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 30);
  } else if (action === 'collection') {
    const value = prompt('Collection name (leave blank for none):', item.collection || '');
    if (value !== null) {
      item.collection = value.trim();
      if (item.collection && !state.collections.includes(item.collection)) state.collections.push(item.collection);
    }
  } else if (action === 'lock') {
    item.locked = !item.locked;
  } else if (action === 'duplicate') {
    activeBoard().items.push(duplicateItem(item));
  } else if (action === 'delete') {
    selectedIds = new Set([item.id]);
    deleteSelected();
    closeContextMenu();
    return;
  } else {
    history.pop();
    return;
  }
  scheduleSave();
  closeContextMenu();
  renderItems();
  renderDrawer();
}

function toggleSelection(id, additive = false) {
  if (!additive) selectedIds.clear();
  if (selectedIds.has(id) && additive) selectedIds.delete(id);
  else selectedIds.add(id);
  updateSelectionStyles();
}

function updateSelectionStyles() {
  boardRoot?.querySelectorAll('.ib-item').forEach(el => el.classList.toggle('selected', selectedIds.has(el.dataset.itemId)));
  const count = boardRoot?.querySelector('[data-selection-count]');
  if (count) count.textContent = selectedIds.size ? `${selectedIds.size} selected` : `${activeBoard().items.length} items`;
}

function itemMatches(item) {
  if (filterRole !== 'all' && (item.type !== 'image' || item.role !== filterRole)) return false;
  if (!searchText) return true;
  const haystack = [item.name, item.text, item.role, item.collection, ...(item.tags || [])].join(' ').toLowerCase();
  return haystack.includes(searchText.toLowerCase());
}

async function renderItems() {
  if (!world) return;
  world.innerHTML = '';
  const board = activeBoard();
  for (const item of board.items) {
    if (!itemMatches(item)) continue;
    const el = document.createElement('div');
    el.className = `ib-item ib-${item.type}${selectedIds.has(item.id) ? ' selected' : ''}${item.locked ? ' locked' : ''}`;
    el.dataset.itemId = item.id;
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = `${item.width}px`;
    el.style.height = `${item.height}px`;
    if (item.type === 'image') {
      const isMain = board.character.mainImageId === item.id;
      const isRef = board.character.referenceIds.includes(item.id);
      el.innerHTML = `<img alt="${escapeHtml(item.name)}" draggable="false"><div class="ib-card-top"><span>${escapeHtml(item.role)}</span>${isMain ? '<b title="Main portrait">★</b>' : ''}${isRef ? '<b title="Character reference">✦</b>' : ''}<button class="ib-item-menu" aria-label="Image options">•••</button></div><div class="ib-card-bottom">${escapeHtml(item.name || 'Image')}</div><div class="ib-resize-handle" aria-label="Resize"></div>`;
      const img = el.querySelector('img');
      imageRecordToUrl(item.imageId, true).then(url => { if (url && img.isConnected) img.src = url; });
    } else {
      el.innerHTML = `<div class="ib-note-text">${escapeHtml(item.text).replace(/\n/g, '<br>')}</div><button class="ib-item-menu" aria-label="Note options">•••</button><div class="ib-resize-handle" aria-label="Resize"></div>`;
    }
    world.appendChild(el);
  }
  updateSelectionStyles();
  renderMinimap();
}

function renderBoardPicker() {
  const select = boardRoot?.querySelector('[data-board-picker]');
  if (!select) return;
  select.innerHTML = state.boards.map(board => `<option value="${board.id}" ${board.id === state.activeBoardId ? 'selected' : ''}>${escapeHtml(board.name)}</option>`).join('');
}

function renderMinimap() {
  const map = boardRoot?.querySelector('.ib-minimap-inner');
  if (!map || !canvasViewport) return;
  const items = activeBoard().items;
  map.innerHTML = '';
  if (!items.length) return;
  const minX = Math.min(...items.map(i => i.x));
  const minY = Math.min(...items.map(i => i.y));
  const maxX = Math.max(...items.map(i => i.x + i.width));
  const maxY = Math.max(...items.map(i => i.y + i.height));
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  for (const item of items) {
    const dot = document.createElement('span');
    dot.style.left = `${((item.x - minX) / w) * 90 + 5}%`;
    dot.style.top = `${((item.y - minY) / h) * 90 + 5}%`;
    dot.style.width = `${Math.max(3, item.width / w * 90)}%`;
    dot.style.height = `${Math.max(3, item.height / h * 90)}%`;
    dot.className = item.type === 'note' ? 'note' : '';
    map.appendChild(dot);
  }
}

function renderDrawer() {
  const drawer = boardRoot?.querySelector('.ib-character-drawer');
  if (!drawer) return;
  drawer.classList.toggle('open', drawerOpen);
  const c = activeBoard().character;
  const fields = ['name', 'description', 'personality', 'scenario', 'first_message', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'tags'];
  fields.forEach(field => {
    const input = drawer.querySelector(`[data-char-field="${field}"]`);
    if (input && input !== document.activeElement) input.value = c[field] || '';
  });
  const refs = drawer.querySelector('.ib-reference-strip');
  refs.innerHTML = '';
  const refItems = c.referenceIds.map(id => itemById(id)).filter(Boolean);
  for (const item of refItems) {
    const box = document.createElement('button');
    box.className = `ib-reference ${c.mainImageId === item.id ? 'main' : ''}`;
    box.dataset.refId = item.id;
    box.title = `${item.role}: ${item.name}`;
    box.innerHTML = `<img alt=""><span>${escapeHtml(item.role)}</span>`;
    const img = box.querySelector('img');
    imageRecordToUrl(item.imageId, true).then(url => { if (url && img.isConnected) img.src = url; });
    refs.appendChild(box);
  }
  drawer.querySelector('[data-ref-count]').textContent = `${refItems.length} reference${refItems.length === 1 ? '' : 's'}`;
}

async function sendToCharacterCreator() {
  const ctx = globalThis.SillyTavern?.getContext?.();
  if (!ctx?.createCharacterData) return toast('This SillyTavern version does not expose the character creator data.', 'error');
  const c = activeBoard().character;
  const target = ctx.createCharacterData;
  const textFields = ['name', 'description', 'personality', 'scenario', 'first_message', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'tags'];
  for (const field of textFields) target[field] = c[field] || '';

  if (c.mainImageId) {
    const item = itemById(c.mainImageId);
    const record = item ? await getImage(item.imageId) : null;
    if (record?.blob) {
      const file = new File([record.blob], record.name || 'character.png', { type: record.mime || record.blob.type || 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.avatar = dt.files;
    }
  }

  closeBoard();
  const createButton = document.querySelector('#rm_button_create');
  if (createButton) {
    createButton.click();
    setTimeout(() => {
      const mapping = {
        '#character_name_pole': c.name,
        '#description_textarea': c.description,
        '#personality_textarea': c.personality,
        '#scenario_pole': c.scenario,
        '#firstmessage_textarea': c.first_message,
        '#mes_example_textarea': c.mes_example,
        '#creator_notes_textarea': c.creator_notes,
        '#system_prompt_textarea': c.system_prompt,
        '#post_history_instructions_textarea': c.post_history_instructions,
        '#tags_textarea': c.tags
      };
      for (const [selector, value] of Object.entries(mapping)) {
        const input = document.querySelector(selector);
        if (input) {
          input.value = value || '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }, 150);
    toast('Character draft sent to SillyTavern.', 'success');
  } else {
    toast('Draft is prepared. Open SillyTavern’s character creator to continue.', 'success');
  }
}

async function backupAll() {
  const images = await listImages();
  const serialized = [];
  for (const image of images) {
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    serialized.push({
      id: image.id, name: image.name, mime: image.mime, size: image.size, hash: image.hash,
      width: image.width, height: image.height, createdAt: image.createdAt,
      data: btoa(binary)
    });
  }
  const backup = { format: 'sillytavern-inspiration-board', version: 1, exportedAt: Date.now(), state, images: serialized };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inspiration-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup exported.', 'success');
}

async function restoreBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.format !== 'sillytavern-inspiration-board' || backup?.version !== 1) throw new Error('Unsupported backup');
    if (!confirm('Restore this backup? Current boards and stored images will be replaced.')) return;
    await clearImages();
    for (const image of backup.images || []) {
      const binary = atob(image.data);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      const blob = new Blob([bytes], { type: image.mime || 'image/jpeg' });
      const thumbnail = await makeThumbnail(blob);
      await putImage({ ...image, blob, thumbnail: thumbnail.blob, data: undefined });
    }
    state = normalizeState(backup.state);
    selectedIds.clear();
    history = [];
    future = [];
    clearObjectUrls();
    saveStateNow();
    render();
    toast('Backup restored.', 'success');
  } catch (error) {
    console.error(error);
    toast('Could not restore that backup.', 'error');
  }
}

async function cleanUnusedImages() {
  const used = new Set(state.boards.flatMap(board => board.items.filter(i => i.type === 'image').map(i => i.imageId)));
  const all = await listImages();
  const unused = all.filter(image => !used.has(image.id));
  if (!unused.length) return toast('No unused images found.', 'info');
  if (!confirm(`Delete ${unused.length} unused stored image(s)? This cannot be undone unless you have a backup.`)) return;
  for (const image of unused) await deleteImage(image.id);
  clearObjectUrls();
  toast(`Deleted ${unused.length} unused image(s).`, 'success');
}

function render() {
  if (!boardRoot) return;
  renderBoardPicker();
  applyWorldTransform();
  updateZoomLabel();
  renderItems();
  renderDrawer();
}

function buildUi() {
  const root = document.createElement('div');
  root.id = 'st-inspiration-board';
  root.className = 'ib-shell';
  root.innerHTML = `
    <div class="ib-topbar">
      <div class="ib-brand"><span>✦</span><div><b>Inspiration Board</b><small data-save-status>Saved</small></div></div>
      <select data-board-picker aria-label="Current board"></select>
      <button data-cmd="new-board" title="New board">＋</button>
      <button data-cmd="rename-board" title="Rename board">✎</button>
      <div class="ib-search"><span>⌕</span><input data-search placeholder="Search images, tags…"></div>
      <select data-role-filter aria-label="Filter role"><option value="all">All refs</option>${ROLE_OPTIONS.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
      <button data-cmd="undo" title="Undo">↶</button><button data-cmd="redo" title="Redo">↷</button>
      <button data-cmd="close" class="ib-close" title="Close">×</button>
    </div>
    <div class="ib-body">
      <aside class="ib-rail">
        <button data-cmd="photos" class="primary"><span>＋</span><label>Add Photos</label></button>
        <button data-cmd="url"><span>⌁</span><label>Image URL</label></button>
        <button data-cmd="note"><span>▤</span><label>Note</label></button>
        <button data-cmd="smart"><span>✦</span><label>Arrange</label></button>
        <button data-cmd="fit"><span>⊙</span><label>Fit</label></button>
        <div class="ib-rail-spacer"></div>
        <button data-cmd="backup"><span>⇩</span><label>Backup</label></button>
        <button data-cmd="restore"><span>⇧</span><label>Restore</label></button>
        <button data-cmd="clean"><span>⌫</span><label>Clean</label></button>
        <button data-cmd="delete-board" class="danger"><span>🗑</span><label>Board</label></button>
      </aside>
      <main class="ib-canvas" tabindex="0">
        <div class="ib-world"></div>
        <div class="ib-canvas-hint">Drag empty space to pan • Pinch/scroll to zoom • Tap an image then ••• for options</div>
        <div class="ib-minimap"><div class="ib-minimap-inner"></div></div>
        <div class="ib-zoom"><button data-cmd="zoom-out">−</button><span data-zoom-label>100%</span><button data-cmd="zoom-in">＋</button></div>
        <div class="ib-selection-tools"><span data-selection-count>0 items</span><button data-cmd="duplicate">⧉</button><button data-cmd="delete">🗑</button></div>
        <button class="ib-fab" data-cmd="photos" title="Add multiple photos">＋</button>
      </main>
    </div>
    <section class="ib-character-drawer">
      <button class="ib-drawer-handle" data-cmd="drawer"><span></span><b>Character Creator</b><em data-ref-count>0 references</em><i>⌃</i></button>
      <div class="ib-drawer-content">
        <div class="ib-reference-strip"></div>
        <div class="ib-form-grid">
          <label>Name<input data-char-field="name" placeholder="Character name"></label>
          <label>Tags<input data-char-field="tags" placeholder="fantasy, rogue, noble"></label>
          <label class="wide">Appearance / Description<textarea data-char-field="description" placeholder="Physical appearance, outfit, distinctive features…"></textarea></label>
          <label class="wide">Personality<textarea data-char-field="personality" placeholder="Traits, behavior, motivations…"></textarea></label>
          <label class="wide">Scenario<textarea data-char-field="scenario"></textarea></label>
          <label class="wide">First Message<textarea data-char-field="first_message"></textarea></label>
          <details class="wide"><summary>Advanced character fields</summary>
            <label>Example Messages<textarea data-char-field="mes_example"></textarea></label>
            <label>Creator Notes<textarea data-char-field="creator_notes"></textarea></label>
            <label>System Prompt<textarea data-char-field="system_prompt"></textarea></label>
            <label>Post-History Instructions<textarea data-char-field="post_history_instructions"></textarea></label>
          </details>
        </div>
        <button class="ib-send-character" data-cmd="send-character">Send Draft to SillyTavern Character Creator →</button>
      </div>
    </section>
    <div class="ib-context-menu"></div>
    <input class="ib-hidden-input" data-photo-input type="file" accept="image/*" multiple>
    <input class="ib-hidden-input" data-backup-input type="file" accept="application/json,.json">
  `;
  document.body.appendChild(root);
  boardRoot = root;
  canvasViewport = root.querySelector('.ib-canvas');
  world = root.querySelector('.ib-world');
  bindUi();
}

function bindUi() {
  boardRoot.addEventListener('click', event => {
    const command = event.target.closest('[data-cmd]')?.dataset.cmd;
    if (command) {
      event.preventDefault();
      if (command === 'photos') boardRoot.querySelector('[data-photo-input]').click();
      else if (command === 'url') importImageUrl();
      else if (command === 'note') addNote();
      else if (command === 'smart') smartArrange();
      else if (command === 'fit') fitBoard();
      else if (command === 'undo') undo();
      else if (command === 'redo') redo();
      else if (command === 'new-board') addBoard();
      else if (command === 'rename-board') renameBoard();
      else if (command === 'delete-board') deleteBoard();
      else if (command === 'close') closeBoard();
      else if (command === 'zoom-in') zoomAt(canvasViewport.getBoundingClientRect().left + canvasViewport.clientWidth / 2, canvasViewport.getBoundingClientRect().top + canvasViewport.clientHeight / 2, 1.2);
      else if (command === 'zoom-out') zoomAt(canvasViewport.getBoundingClientRect().left + canvasViewport.clientWidth / 2, canvasViewport.getBoundingClientRect().top + canvasViewport.clientHeight / 2, 1 / 1.2);
      else if (command === 'duplicate') duplicateSelected();
      else if (command === 'delete') deleteSelected();
      else if (command === 'drawer') { drawerOpen = !drawerOpen; renderDrawer(); }
      else if (command === 'send-character') sendToCharacterCreator();
      else if (command === 'backup') backupAll();
      else if (command === 'restore') boardRoot.querySelector('[data-backup-input]').click();
      else if (command === 'clean') cleanUnusedImages();
      return;
    }
    const menuButton = event.target.closest('.ib-item-menu');
    if (menuButton) {
      event.stopPropagation();
      const itemEl = menuButton.closest('.ib-item');
      openContextMenu(itemEl.dataset.itemId, event.clientX, event.clientY);
      return;
    }
    const menuAction = event.target.closest('.ib-context-menu button');
    if (menuAction) return handleContextAction(menuAction);
    const ref = event.target.closest('.ib-reference');
    if (ref) {
      const item = itemById(ref.dataset.refId);
      if (item) {
        selectedIds = new Set([item.id]);
        drawerOpen = false;
        renderDrawer();
        updateSelectionStyles();
        const rect = canvasViewport.getBoundingClientRect();
        setView({ ...activeBoard().view, x: rect.width / 2 - (item.x + item.width / 2) * activeBoard().view.zoom, y: rect.height / 2 - (item.y + item.height / 2) * activeBoard().view.zoom });
      }
      return;
    }
    if (!event.target.closest('.ib-context-menu')) closeContextMenu();
  });

  boardRoot.querySelector('[data-photo-input]').addEventListener('change', async event => {
    await ingestFiles(event.target.files);
    event.target.value = '';
  });
  boardRoot.querySelector('[data-backup-input]').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (file) await restoreBackup(file);
    event.target.value = '';
  });
  boardRoot.querySelector('[data-board-picker]').addEventListener('change', event => selectBoard(event.target.value));
  boardRoot.querySelector('[data-search]').addEventListener('input', event => { searchText = event.target.value.trim(); renderItems(); });
  boardRoot.querySelector('[data-role-filter]').addEventListener('change', event => { filterRole = event.target.value; renderItems(); });
  boardRoot.querySelectorAll('[data-char-field]').forEach(input => input.addEventListener('input', event => {
    activeBoard().character[event.target.dataset.charField] = event.target.value;
    activeBoard().updatedAt = Date.now();
    scheduleSave();
  }));

  canvasViewport.addEventListener('wheel', event => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
  canvasViewport.addEventListener('contextmenu', event => {
    const item = event.target.closest('.ib-item');
    if (item) {
      event.preventDefault();
      openContextMenu(item.dataset.itemId, event.clientX, event.clientY);
    }
  });

  canvasViewport.addEventListener('pointerdown', onPointerDown);
  canvasViewport.addEventListener('pointermove', onPointerMove);
  canvasViewport.addEventListener('pointerup', onPointerUp);
  canvasViewport.addEventListener('pointercancel', onPointerUp);

  canvasViewport.addEventListener('dragover', event => { event.preventDefault(); canvasViewport.classList.add('dragover'); });
  canvasViewport.addEventListener('dragleave', () => canvasViewport.classList.remove('dragover'));
  canvasViewport.addEventListener('drop', event => {
    event.preventDefault();
    canvasViewport.classList.remove('dragover');
    if (event.dataTransfer?.files?.length) ingestFiles(event.dataTransfer.files);
  });

  document.addEventListener('paste', onPaste);
  document.addEventListener('keydown', onKeyDown);
}

const activePointers = new Map();

function onPointerDown(event) {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  canvasViewport.setPointerCapture?.(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    pinchStart = {
      distance: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
      zoom: activeBoard().view.zoom,
      x: activeBoard().view.x,
      y: activeBoard().view.y,
      centerX: (pts[0].x + pts[1].x) / 2,
      centerY: (pts[0].y + pts[1].y) / 2
    };
    pointerMode = { type: 'pinch' };
    return;
  }
  const itemEl = event.target.closest('.ib-item');
  if (itemEl) {
    const item = itemById(itemEl.dataset.itemId);
    if (!item) return;
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    toggleSelection(item.id, additive);
    if (event.target.closest('.ib-item-menu')) return;
    if (event.target.closest('.ib-resize-handle') && !item.locked) {
      snapshot();
      pointerMode = { type: 'resize', id: item.id, startX: event.clientX, startY: event.clientY, width: item.width, height: item.height };
    } else if (!item.locked) {
      snapshot();
      const selectedItems = activeBoard().items.filter(i => selectedIds.has(i.id) && !i.locked);
      pointerMode = { type: 'move', startX: event.clientX, startY: event.clientY, items: selectedItems.map(i => ({ id: i.id, x: i.x, y: i.y })) };
    }
    event.stopPropagation();
  } else {
    selectedIds.clear();
    updateSelectionStyles();
    pointerMode = { type: 'pan', startX: event.clientX, startY: event.clientY, x: activeBoard().view.x, y: activeBoard().view.y };
  }
}

function onPointerMove(event) {
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!pointerMode) return;
  if (pointerMode.type === 'pinch' && activePointers.size >= 2 && pinchStart) {
    const pts = [...activePointers.values()];
    const distance = Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
    const factor = distance / Math.max(1, pinchStart.distance);
    const rect = canvasViewport.getBoundingClientRect();
    const centerX = (pts[0].x + pts[1].x) / 2;
    const centerY = (pts[0].y + pts[1].y) / 2;
    const px = pinchStart.centerX - rect.left;
    const py = pinchStart.centerY - rect.top;
    const wx = (px - pinchStart.x) / pinchStart.zoom;
    const wy = (py - pinchStart.y) / pinchStart.zoom;
    const nextZoom = clamp(pinchStart.zoom * factor, 0.12, 4);
    setView({ zoom: nextZoom, x: centerX - rect.left - wx * nextZoom, y: centerY - rect.top - wy * nextZoom }, false);
    return;
  }
  if (pointerMode.type === 'pan') {
    setView({ ...activeBoard().view, x: pointerMode.x + event.clientX - pointerMode.startX, y: pointerMode.y + event.clientY - pointerMode.startY }, false);
  } else if (pointerMode.type === 'move') {
    const zoom = activeBoard().view.zoom;
    const dx = (event.clientX - pointerMode.startX) / zoom;
    const dy = (event.clientY - pointerMode.startY) / zoom;
    for (const start of pointerMode.items) {
      const item = itemById(start.id);
      if (item) { item.x = start.x + dx; item.y = start.y + dy; }
    }
    renderItemPositions();
  } else if (pointerMode.type === 'resize') {
    const item = itemById(pointerMode.id);
    if (item) {
      const zoom = activeBoard().view.zoom;
      item.width = clamp(pointerMode.width + (event.clientX - pointerMode.startX) / zoom, 100, 1200);
      item.height = clamp(pointerMode.height + (event.clientY - pointerMode.startY) / zoom, 80, 1400);
      renderItemPositions();
    }
  }
}

function onPointerUp(event) {
  activePointers.delete(event.pointerId);
  if (pointerMode && pointerMode.type !== 'pinch') {
    activeBoard().updatedAt = Date.now();
    scheduleSave();
    renderMinimap();
  }
  if (activePointers.size < 2) pinchStart = null;
  if (activePointers.size === 0) pointerMode = null;
}

function renderItemPositions() {
  boardRoot.querySelectorAll('.ib-item').forEach(el => {
    const item = itemById(el.dataset.itemId);
    if (!item) return;
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = `${item.width}px`;
    el.style.height = `${item.height}px`;
  });
}

async function onPaste(event) {
  if (!boardRoot?.classList.contains('open')) return;
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
  if (files.length) {
    event.preventDefault();
    await ingestFiles(files);
  }
}

function onKeyDown(event) {
  if (!boardRoot?.classList.contains('open')) return;
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (event.key === 'Escape') {
    if (contextMenuItemId) closeContextMenu(); else closeBoard();
  } else if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault(); deleteSelected();
  } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); event.shiftKey ? redo() : undo();
  } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault(); duplicateSelected();
  }
}

function openBoard() {
  if (!boardRoot) buildUi();
  boardRoot.classList.add('open');
  document.body.classList.add('ib-open');
  render();
  setTimeout(() => canvasViewport.focus(), 0);
}

function closeBoard() {
  boardRoot?.classList.remove('open');
  document.body.classList.remove('ib-open');
  closeContextMenu();
  saveStateNow();
}

function injectLauncher() {
  if (document.querySelector('#ib-launcher')) return;
  const button = document.createElement('button');
  button.id = 'ib-launcher';
  button.type = 'button';
  button.className = 'menu_button interactable';
  button.title = 'Open Inspiration Board';
  button.innerHTML = '<span>✦</span><span class="ib-launch-label">Inspiration Board</span>';
  button.addEventListener('click', openBoard);

  const candidates = [
    document.querySelector('#extensionsMenu'),
    document.querySelector('#extensionsMenuButton')?.parentElement,
    document.querySelector('#left-nav-panel'),
    document.querySelector('#top-bar')
  ].filter(Boolean);
  if (candidates[0]) candidates[0].appendChild(button);
  else {
    button.classList.add('ib-floating-launcher');
    document.body.appendChild(button);
  }
}

function registerShortcut() {
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      boardRoot?.classList.contains('open') ? closeBoard() : openBoard();
    }
  });
}

function init() {
  try {
    buildUi();
    injectLauncher();
    registerShortcut();
    console.info('[Inspiration Board] loaded');
  } catch (error) {
    console.error('[Inspiration Board] failed to initialize', error);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();

export { openBoard, closeBoard };
