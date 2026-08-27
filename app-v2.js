import {
  FRAME_COLORS,
  ROLE_LABELS,
  ROLE_OPTIONS,
  addReference,
  allReferenceIds,
  assignItemsToFrames,
  clamp,
  createBoardFromTemplate,
  deepClone,
  duplicateItem,
  findContainingFrame,
  fitItems,
  getBounds,
  getFrameMembers,
  getVisibleItems,
  hammingDistanceHex,
  makeFrameItem,
  makeImageItem,
  makeInboxEntry,
  makeNoteItem,
  normalizeState,
  rectIntersects,
  removeReference,
  sanitizeFilename,
  snapshotState,
  staggerPositions,
  toggleReference,
  uid,
} from './core-v2.js';
import {
  blobToDataUrl,
  clearImages,
  clearSnapshots,
  createImageRecord,
  deleteImage,
  deleteSnapshot,
  findNearDuplicates,
  getImage,
  getImageByHash,
  getSnapshot,
  listImages,
  listSnapshots,
  makeThumbnail,
  pruneSnapshots,
  putImage,
  putSnapshot,
} from './db-v2.js';
import { analyzeCharacterReferences, applyAiSuggestions } from './ai-v2.js';
import { exportBoardAsPng } from './export-v2.js';

const VERSION = '0.2.0';
const MODULE = 'inspiration_board';
const STORAGE_KEY = 'st_inspiration_board_state_v2';
const LEGACY_STORAGE_KEY = 'st_inspiration_board_state_v1';
const MAX_FILE_MB = 30;
const MAX_UNDO = 60;
const FRAME_ROLE_HINTS = Object.freeze({
  face: ['face'],
  hair: ['hair'],
  body: ['body', 'pose'],
  outfit: ['outfit', 'clothing'],
  expression: ['expression'],
  accessory: ['accessor'],
  prop: ['prop', 'weapon'],
  mood: ['mood', 'vibe'],
  environment: ['environment', 'setting', 'location'],
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
  })[character]);
}

function formatTime(timestamp) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

class InspirationBoardApp {
  constructor() {
    this.state = this.loadState();
    this.selectedIds = new Set();
    this.inboxSelectedIds = new Set();
    this.history = [];
    this.future = [];
    this.root = null;
    this.canvas = null;
    this.world = null;
    this.renderToken = 0;
    this.objectUrlCache = new Map();
    this.objectUrls = new Set();
    this.searchText = '';
    this.filterRole = 'all';
    this.filterFavorite = false;
    this.contextItemId = null;
    this.drawerOpen = false;
    this.pointerMode = null;
    this.pinchStart = null;
    this.activePointers = new Map();
    this.longPressTimer = null;
    this.saveTimer = null;
    this.lastSnapshotAt = 0;
    this.snapshotPending = false;
    this.isOpen = false;
    this.closingFromPop = false;
    this.lastTap = { time: 0, itemId: null, x: 0, y: 0 };
    this.boundPaste = event => this.onPaste(event);
    this.boundKeydown = event => this.onKeyDown(event);
    this.boundPopstate = event => this.onPopState(event);
  }

  loadState() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) return normalizeState(JSON.parse(current));
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const migrated = normalizeState(JSON.parse(legacy));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) {
      console.warn('[Inspiration Board] state load failed', error);
    }
    return normalizeState(null);
  }

  activeBoard() {
    return this.state.boards.find(board => board.id === this.state.activeBoardId) || this.state.boards[0];
  }

  itemById(id, board = this.activeBoard()) {
    return board.items.find(item => item.id === id);
  }

  toast(message, type = 'info') {
    const toaster = globalThis.toastr;
    if (toaster && typeof toaster[type] === 'function') toaster[type](message, 'Inspiration Board');
    else console[type === 'error' ? 'error' : 'log']('[Inspiration Board]', message);
  }

  updateSaveStatus(text) {
    const element = this.root?.querySelector('[data-save-status]');
    if (element) element.textContent = text;
  }

  snapshotUndo() {
    this.history.push(JSON.stringify(this.state));
    if (this.history.length > MAX_UNDO) this.history.shift();
    this.future.length = 0;
  }

  async createPersistentSnapshot(reason = 'Autosave', force = false) {
    const now = Date.now();
    const interval = this.state.settings.autoSnapshotMinutes * 60_000;
    if (!force && now - this.lastSnapshotAt < interval) return;
    if (this.snapshotPending) return;
    this.snapshotPending = true;
    try {
      await putSnapshot({
        state: snapshotState(this.state),
        boardId: this.state.activeBoardId,
        reason,
        label: this.activeBoard()?.name || '',
      });
      await pruneSnapshots(this.state.settings.maxSnapshots);
      this.lastSnapshotAt = now;
    } catch (error) {
      console.warn('[Inspiration Board] snapshot failed', error);
    } finally {
      this.snapshotPending = false;
    }
  }

  saveStateNow({ snapshot = true } = {}) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      const context = globalThis.SillyTavern?.getContext?.();
      if (context?.extensionSettings) {
        context.extensionSettings[MODULE] ??= {};
        context.extensionSettings[MODULE].version = 2;
        context.extensionSettings[MODULE].lastBoardId = this.state.activeBoardId;
        context.saveSettingsDebounced?.();
      }
      this.updateSaveStatus('Saved');
      if (snapshot) void this.createPersistentSnapshot('Autosave');
    } catch (error) {
      console.error('[Inspiration Board] save failed', error);
      this.updateSaveStatus('Save failed');
      this.toast('Could not save the board. Browser storage may be full.', 'error');
    }
  }

  scheduleSave() {
    this.updateSaveStatus('Saving…');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveStateNow(), 220);
  }

  async beforeDestructive(reason) {
    this.snapshotUndo();
    await this.createPersistentSnapshot(reason, true);
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(JSON.stringify(this.state));
    this.state = normalizeState(JSON.parse(this.history.pop()));
    this.selectedIds.clear();
    this.scheduleSave();
    this.render();
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(JSON.stringify(this.state));
    this.state = normalizeState(JSON.parse(this.future.pop()));
    this.selectedIds.clear();
    this.scheduleSave();
    this.render();
  }

  async imageUrl(imageId, thumbnail = true) {
    const key = `${imageId}:${thumbnail ? 'thumb' : 'full'}`;
    if (this.objectUrlCache.has(key)) return this.objectUrlCache.get(key);
    const record = await getImage(imageId);
    if (!record) return '';
    const blob = thumbnail && record.thumbnail ? record.thumbnail : record.blob;
    const url = URL.createObjectURL(blob);
    this.objectUrlCache.set(key, url);
    this.objectUrls.add(url);
    return url;
  }

  clearObjectUrls() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.objectUrlCache.clear();
  }

  canvasCenterWorld() {
    const rect = this.canvas.getBoundingClientRect();
    const view = this.activeBoard().view;
    return {
      x: (rect.width / 2 - view.x) / view.zoom,
      y: (rect.height / 2 - view.y) / view.zoom,
    };
  }

  setView(view, save = true) {
    const board = this.activeBoard();
    board.view = {
      x: Number.isFinite(view.x) ? view.x : board.view.x,
      y: Number.isFinite(view.y) ? view.y : board.view.y,
      zoom: clamp(Number.isFinite(view.zoom) ? view.zoom : board.view.zoom, 0.08, 4),
    };
    this.applyWorldTransform();
    this.updateZoomLabel();
    this.renderMinimap();
    if (save) this.scheduleSave();
  }

  applyWorldTransform() {
    if (!this.world) return;
    const { x, y, zoom } = this.activeBoard().view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  }

  updateZoomLabel() {
    const label = this.root?.querySelector('[data-zoom-label]');
    if (label) label.textContent = `${Math.round(this.activeBoard().view.zoom * 100)}%`;
  }

  zoomAt(clientX, clientY, factor) {
    const rect = this.canvas.getBoundingClientRect();
    const board = this.activeBoard();
    const oldZoom = board.view.zoom;
    const nextZoom = clamp(oldZoom * factor, 0.08, 4);
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const worldX = (px - board.view.x) / oldZoom;
    const worldY = (py - board.view.y) / oldZoom;
    this.setView({ zoom: nextZoom, x: px - worldX * nextZoom, y: py - worldY * nextZoom }, false);
    this.scheduleSave();
  }

  fitBoard() {
    const rect = this.canvas.getBoundingClientRect();
    this.setView(fitItems(getVisibleItems(this.activeBoard()), rect.width, rect.height), true);
  }

  focusItem(item) {
    if (!item) return;
    const rect = this.canvas.getBoundingClientRect();
    const zoom = clamp(Math.min(rect.width / Math.max(item.width * 1.4, 1), rect.height / Math.max(item.height * 1.4, 1)), 0.25, 2.2);
    this.setView({
      zoom,
      x: rect.width / 2 - (item.x + item.width / 2) * zoom,
      y: rect.height / 2 - (item.y + item.height / 2) * zoom,
    });
  }

  boardHasImage(imageId) {
    const board = this.activeBoard();
    return board.items.some(item => item.type === 'image' && item.imageId === imageId)
      || board.inbox.some(entry => entry.imageId === imageId);
  }

  ensureInboxEntry(record, overrides = {}) {
    const board = this.activeBoard();
    const existing = board.inbox.find(entry => entry.imageId === record.id);
    if (existing) return existing;
    const entry = makeInboxEntry({
      imageId: record.id,
      name: record.name,
      sourceUrl: record.sourceUrl || '',
      ...overrides,
    });
    board.inbox.push(entry);
    return entry;
  }

  async ingestFiles(fileList, { sourceUrl = '' } = {}) {
    const files = [...fileList].filter(file => file?.type?.startsWith('image/'));
    if (!files.length) return this.toast('No image files were selected.', 'warning');
    const accepted = files.filter(file => file.size <= MAX_FILE_MB * 1024 * 1024);
    if (accepted.length !== files.length) this.toast(`Skipped ${files.length - accepted.length} image(s) larger than ${MAX_FILE_MB} MB.`, 'warning');
    if (!accepted.length) return;

    const progress = this.showProgressModal('Importing photos', `Preparing ${accepted.length} image${accepted.length === 1 ? '' : 's'}…`);
    const newRecords = [];
    const exactRecords = [];
    const batchRecords = [];
    let failed = 0;

    for (let index = 0; index < accepted.length; index++) {
      const file = accepted[index];
      progress.update(`Reading ${index + 1} of ${accepted.length}: ${file.name || 'image'}`);
      try {
        const record = await createImageRecord(file, { sourceUrl });
        const exact = await getImageByHash(record.hash);
        if (exact) {
          exactRecords.push(exact);
          continue;
        }

        let nearest = (await findNearDuplicates(record.dhash, this.state.settings.duplicateDistance))[0] || null;
        for (const prior of batchRecords) {
          const distance = hammingDistanceHex(record.dhash, prior.record.dhash);
          if (distance <= this.state.settings.duplicateDistance && (!nearest || distance < nearest.distance)) {
            nearest = { image: prior.record, distance, pending: true };
          }
        }
        const pending = { record, near: nearest };
        batchRecords.push(pending);
        if (nearest) newRecords.push(pending);
      } catch (error) {
        failed++;
        console.error('[Inspiration Board] image import failed', file.name, error);
      }
    }

    progress.close();
    const keepNearIds = newRecords.length ? await this.reviewPossibleDuplicates(newRecords) : new Set();
    let added = 0;
    let reused = 0;
    let skippedNear = 0;

    await this.createPersistentSnapshot('Before photo import', true);
    this.snapshotUndo();

    for (const exact of exactRecords) {
      if (!this.boardHasImage(exact.id)) {
        this.ensureInboxEntry(exact);
        reused++;
      }
    }

    for (const pending of batchRecords) {
      if (pending.near && !keepNearIds.has(pending.record.id)) {
        skippedNear++;
        continue;
      }
      await putImage(pending.record);
      this.ensureInboxEntry(pending.record);
      added++;
    }

    this.activeBoard().updatedAt = Date.now();
    this.scheduleSave();
    await this.renderInboxButton();
    this.openInboxPanel();
    const parts = [`${added} new`, `${reused} exact duplicate${reused === 1 ? '' : 's'} reused`];
    if (skippedNear) parts.push(`${skippedNear} similar skipped`);
    if (failed) parts.push(`${failed} failed`);
    this.toast(`Import finished: ${parts.join(', ')}.`, failed ? 'warning' : 'success');
  }

  async importImageUrl() {
    const url = prompt('Paste a direct image URL:');
    if (!url) return;
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('The URL did not return an image.');
      const name = new URL(url).pathname.split('/').pop() || 'web-image';
      const file = new File([blob], name, { type: blob.type });
      await this.ingestFiles([file], { sourceUrl: url });
    } catch (error) {
      console.error('[Inspiration Board] URL import failed', error);
      this.toast('That site blocked direct importing. Save the picture to your gallery and use Add Photos.', 'error');
    }
  }

  async reviewPossibleDuplicates(pairs) {
    return new Promise(async resolve => {
      const modal = this.showModal('Possible duplicate photos', `
        <p class="ib2-muted">These new photos look similar to images already stored. Select the new copies you still want to keep.</p>
        <div class="ib2-duplicate-list"></div>
        <div class="ib2-modal-actions">
          <button data-dup-action="skip">Skip all similar</button>
          <button data-dup-action="keep">Keep all</button>
          <button class="primary" data-dup-action="continue">Continue</button>
        </div>
      `, 'ib2-duplicate-modal');
      const list = modal.querySelector('.ib2-duplicate-list');
      const tempUrls = [];
      for (const pair of pairs) {
        const newUrl = URL.createObjectURL(pair.record.thumbnail || pair.record.blob);
        tempUrls.push(newUrl);
        let oldUrl = '';
        if (pair.near?.pending) {
          oldUrl = URL.createObjectURL(pair.near.image.thumbnail || pair.near.image.blob);
          tempUrls.push(oldUrl);
        } else if (pair.near?.image) {
          const old = await getImage(pair.near.image.id);
          if (old) {
            oldUrl = URL.createObjectURL(old.thumbnail || old.blob);
            tempUrls.push(oldUrl);
          }
        }
        const row = document.createElement('label');
        row.className = 'ib2-duplicate-row';
        row.innerHTML = `
          <input type="checkbox" data-keep-id="${pair.record.id}">
          <div><small>Existing</small><img src="${oldUrl}" alt="Existing similar image"></div>
          <div class="ib2-duplicate-arrow">≈</div>
          <div><small>New · distance ${pair.near?.distance ?? '?'}</small><img src="${newUrl}" alt="New image"></div>
          <strong>Keep new copy</strong>`;
        list.appendChild(row);
      }
      const finish = keep => {
        tempUrls.forEach(url => URL.revokeObjectURL(url));
        modal.remove();
        resolve(keep);
      };
      modal.addEventListener('click', event => {
        const action = event.target.closest('[data-dup-action]')?.dataset.dupAction;
        if (!action) return;
        if (action === 'skip') finish(new Set());
        else if (action === 'keep') finish(new Set(pairs.map(pair => pair.record.id)));
        else finish(new Set([...modal.querySelectorAll('[data-keep-id]:checked')].map(input => input.dataset.keepId)));
      });
      modal.querySelector('[data-modal-close]')?.addEventListener('click', () => finish(new Set()), { once: true });
    });
  }

  addNote() {
    const center = this.canvasCenterWorld();
    this.snapshotUndo();
    this.activeBoard().items.push(makeNoteItem({ x: center.x - 120, y: center.y - 80 }));
    this.activeBoard().updatedAt = Date.now();
    this.scheduleSave();
    this.renderItems();
  }

  async addFrame() {
    const values = await this.showFrameForm();
    if (!values) return;
    const center = this.canvasCenterWorld();
    this.snapshotUndo();
    this.activeBoard().items.push(makeFrameItem({
      title: values.title,
      color: values.color,
      x: center.x - 360,
      y: center.y - 260,
      width: 720,
      height: 520,
    }));
    this.activeBoard().updatedAt = Date.now();
    this.scheduleSave();
    this.renderItems();
  }

  showFrameForm(frame = null) {
    return new Promise(resolve => {
      const modal = this.showModal(frame ? 'Edit reference group' : 'New reference group', `
        <label>Group name<input data-frame-title value="${escapeHtml(frame?.title || 'Reference Group')}"></label>
        <label>Color<select data-frame-color>${FRAME_COLORS.map(color => `<option value="${color}" ${frame?.color === color ? 'selected' : ''}>${color}</option>`).join('')}</select></label>
        <div class="ib2-modal-actions"><button data-frame-cancel>Cancel</button><button class="primary" data-frame-save>${frame ? 'Save' : 'Create group'}</button></div>
      `);
      const finish = value => { modal.remove(); resolve(value); };
      modal.querySelector('[data-frame-cancel]').onclick = () => finish(null);
      modal.querySelector('[data-modal-close]').onclick = () => finish(null);
      modal.querySelector('[data-frame-save]').onclick = () => {
        const title = modal.querySelector('[data-frame-title]').value.trim();
        if (!title) return;
        finish({ title, color: modal.querySelector('[data-frame-color]').value });
      };
      modal.querySelector('[data-frame-title]').focus();
    });
  }

  async addBoard() {
    const values = await this.showNewBoardForm();
    if (!values) return;
    this.snapshotUndo();
    const board = createBoardFromTemplate(values.name, values.template);
    this.state.boards.push(board);
    this.state.activeBoardId = board.id;
    this.selectedIds.clear();
    this.scheduleSave();
    this.render();
    if (board.items.length) setTimeout(() => this.fitBoard(), 50);
  }

  showNewBoardForm() {
    return new Promise(resolve => {
      const modal = this.showModal('Create a character board', `
        <label>Board name<input data-new-board-name value="New Character"></label>
        <div class="ib2-template-grid">
          <button class="selected" data-template="character"><b>Character Design</b><span>Face, hair, outfit, expressions, body, props and mood groups.</span></button>
          <button data-template="compact"><b>Compact Design</b><span>Main look, mood and extras.</span></button>
          <button data-template="blank"><b>Blank Canvas</b><span>Start without groups.</span></button>
        </div>
        <div class="ib2-modal-actions"><button data-board-cancel>Cancel</button><button class="primary" data-board-create>Create</button></div>
      `);
      let template = 'character';
      modal.querySelector('.ib2-template-grid').addEventListener('click', event => {
        const button = event.target.closest('[data-template]');
        if (!button) return;
        template = button.dataset.template;
        modal.querySelectorAll('[data-template]').forEach(entry => entry.classList.toggle('selected', entry === button));
      });
      const finish = value => { modal.remove(); resolve(value); };
      modal.querySelector('[data-board-cancel]').onclick = () => finish(null);
      modal.querySelector('[data-modal-close]').onclick = () => finish(null);
      modal.querySelector('[data-board-create]').onclick = () => {
        const name = modal.querySelector('[data-new-board-name]').value.trim();
        if (name) finish({ name, template });
      };
      modal.querySelector('[data-new-board-name]').focus();
    });
  }

  renameBoard() {
    const board = this.activeBoard();
    const name = prompt('Rename board:', board.name);
    if (!name?.trim()) return;
    this.snapshotUndo();
    board.name = name.trim();
    board.updatedAt = Date.now();
    this.scheduleSave();
    this.renderBoardPicker();
  }

  async deleteBoard() {
    if (this.state.boards.length <= 1) return this.toast('You need at least one board.', 'warning');
    const board = this.activeBoard();
    if (!confirm(`Delete board “${board.name}”? Stored photos used elsewhere will be kept.`)) return;
    await this.beforeDestructive('Before deleting board');
    this.state.boards = this.state.boards.filter(entry => entry.id !== board.id);
    this.state.activeBoardId = this.state.boards[0].id;
    this.selectedIds.clear();
    this.scheduleSave();
    this.render();
  }

  selectBoard(id) {
    if (!this.state.boards.some(board => board.id === id)) return;
    this.state.activeBoardId = id;
    this.selectedIds.clear();
    this.inboxSelectedIds.clear();
    this.closeContextMenu();
    this.scheduleSave();
    this.render();
  }

  toggleMode() {
    const board = this.activeBoard();
    board.interactionMode = board.interactionMode === 'pan' ? 'select' : 'pan';
    this.scheduleSave();
    this.renderMode();
  }

  toggleCanvasOnly() {
    const board = this.activeBoard();
    board.canvasOnly = !board.canvasOnly;
    this.scheduleSave();
    this.root.classList.toggle('ib2-canvas-only', board.canvasOnly);
  }

  async deleteSelected() {
    if (!this.selectedIds.size) return;
    const board = this.activeBoard();
    const items = board.items.filter(item => this.selectedIds.has(item.id));
    if (!items.length) return;
    if (this.state.settings.confirmDelete && !confirm(`Move ${items.length} selected item(s) to trash?`)) return;
    await this.beforeDestructive('Before deleting selected items');
    const deletingFrames = new Set(items.filter(item => item.type === 'frame').map(item => item.id));
    for (const item of board.items) if (item.frameId && deletingFrames.has(item.frameId)) item.frameId = null;
    this.state.trash.push(...items.map(item => ({ ...deepClone(item), boardId: board.id, deletedAt: Date.now() })));
    board.items = board.items.filter(item => !this.selectedIds.has(item.id));
    for (const id of this.selectedIds) removeReference(board.character, id);
    this.selectedIds.clear();
    board.updatedAt = Date.now();
    this.scheduleSave();
    this.renderItems();
    this.renderDrawer();
  }

  duplicateSelected() {
    if (!this.selectedIds.size) return;
    this.snapshotUndo();
    const board = this.activeBoard();
    const copies = board.items.filter(item => this.selectedIds.has(item.id)).map(item => duplicateItem(item));
    board.items.push(...copies);
    this.selectedIds = new Set(copies.map(item => item.id));
    board.updatedAt = Date.now();
    this.scheduleSave();
    this.renderItems();
  }

  bulkSetRole(role) {
    if (!ROLE_OPTIONS.includes(role)) return;
    this.snapshotUndo();
    for (const id of this.selectedIds) {
      const item = this.itemById(id);
      if (item?.type === 'image') {
        item.role = role;
        item.updatedAt = Date.now();
      }
    }
    this.scheduleSave();
    this.renderItems();
  }

  bulkToggleReferences() {
    const images = [...this.selectedIds].map(id => this.itemById(id)).filter(item => item?.type === 'image');
    if (!images.length) return;
    this.snapshotUndo();
    const character = this.activeBoard().character;
    const allAreReferences = images.every(item => allReferenceIds(character).includes(item.id));
    for (const item of images) {
      if (allAreReferences) removeReference(character, item.id);
      else addReference(character, item.id, item.role);
    }
    this.scheduleSave();
    this.renderItems();
    this.renderDrawer();
  }

  bulkEditTags() {
    if (!this.selectedIds.size) return;
    const value = prompt('Tags to add to every selected item, separated by commas:');
    if (value === null) return;
    const tags = value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 30);
    this.snapshotUndo();
    for (const id of this.selectedIds) {
      const item = this.itemById(id);
      if (item) item.tags = [...new Set([...(item.tags || []), ...tags])];
    }
    this.scheduleSave();
    this.renderItems();
  }

  bulkAssignFrame() {
    if (!this.selectedIds.size) return;
    const frames = this.activeBoard().items.filter(item => item.type === 'frame');
    const choices = frames.map((frame, index) => `${index + 1}. ${frame.title}`).join('\n');
    const response = prompt(`Move selected items into which group? Enter a number, or 0 for no group.\n\n${choices}`, '0');
    if (response === null) return;
    const index = Number(response) - 1;
    const frameId = index >= 0 && frames[index] ? frames[index].id : null;
    this.snapshotUndo();
    for (const id of this.selectedIds) {
      const item = this.itemById(id);
      if (item && item.type !== 'frame') item.frameId = frameId;
    }
    this.scheduleSave();
    this.renderItems();
  }

  smartArrange() {
    const board = this.activeBoard();
    const images = board.items.filter(item => item.type === 'image' && !item.locked);
    const notes = board.items.filter(item => item.type === 'note' && !item.locked);
    if (!images.length && !notes.length) return;
    this.snapshotUndo();

    const frames = board.items.filter(item => item.type === 'frame');
    if (frames.length) {
      for (const image of images) {
        const hints = FRAME_ROLE_HINTS[image.role] || [];
        const frame = frames.find(candidate => hints.some(hint => candidate.title.toLowerCase().includes(hint)));
        if (frame) image.frameId = frame.id;
      }
      for (const frame of frames) {
        const members = getFrameMembers(board, frame.id).filter(item => !item.locked);
        const contentTop = frame.y + 64;
        const innerWidth = Math.max(180, frame.width - 36);
        const cardWidth = clamp(Math.min(250, (innerWidth - 24) / Math.max(1, Math.ceil(Math.sqrt(members.length || 1)))), 150, 250);
        const cols = Math.max(1, Math.floor(innerWidth / (cardWidth + 20)));
        members.forEach((item, index) => {
          const ratio = item.width / Math.max(1, item.height);
          const height = item.type === 'note' ? 150 : clamp(cardWidth / ratio, 150, 330);
          item.width = cardWidth;
          item.height = height;
          item.x = frame.x + 18 + (index % cols) * (cardWidth + 20);
          item.y = contentTop + Math.floor(index / cols) * (Math.max(180, height) + 20);
        });
      }
      const ungrouped = [...images, ...notes].filter(item => !item.frameId);
      const positions = staggerPositions(ungrouped.length, 0, 1350, 240, 300);
      ungrouped.forEach((item, index) => Object.assign(item, positions[index]));
    } else {
      const movable = [...images, ...notes];
      const positions = staggerPositions(movable.length, 0, 0, 260, 330);
      movable.forEach((item, index) => Object.assign(item, positions[index]));
    }
    board.updatedAt = Date.now();
    this.scheduleSave();
    this.renderItems();
    setTimeout(() => this.fitBoard(), 30);
  }

  frameForRole(role) {
    const hints = FRAME_ROLE_HINTS[role] || [];
    return this.activeBoard().items.find(item => item.type === 'frame' && hints.some(hint => item.title.toLowerCase().includes(hint))) || null;
  }

  nextPositionInFrame(frame, index, width = 240, height = 310) {
    const innerWidth = Math.max(width, frame.width - 36);
    const cols = Math.max(1, Math.floor(innerWidth / (width + 20)));
    return {
      x: frame.x + 18 + (index % cols) * (width + 20),
      y: frame.y + 64 + Math.floor(index / cols) * (height + 20),
    };
  }

  async placeInboxEntries(entryIds) {
    const board = this.activeBoard();
    const entries = board.inbox.filter(entry => entryIds.includes(entry.id));
    if (!entries.length) return;
    this.snapshotUndo();
    const center = this.canvasCenterWorld();
    const unframedPositions = staggerPositions(entries.length, center.x, center.y, 250, 320);
    const roleCounts = {};
    const created = [];

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const record = await getImage(entry.imageId);
      if (!record) continue;
      const ratio = record.width / Math.max(1, record.height);
      const width = ratio >= 1.15 ? 320 : 250;
      const height = clamp(width / ratio, 170, 430);
      const frame = this.frameForRole(entry.role);
      let position = unframedPositions[index];
      if (frame) {
        const count = roleCounts[frame.id] || getFrameMembers(board, frame.id).length;
        position = this.nextPositionInFrame(frame, count, width, height);
        roleCounts[frame.id] = count + 1;
      }
      const item = makeImageItem({
        imageId: entry.imageId,
        name: entry.name || record.name,
        role: entry.role,
        sourceUrl: entry.sourceUrl || record.sourceUrl || '',
        width,
        height,
        x: position.x,
        y: position.y,
      });
      item.tags = [...(entry.tags || [])];
      item.collection = entry.collection || '';
      item.favorite = Boolean(entry.favorite);
      item.rating = entry.rating || 0;
      item.notes = entry.notes || '';
      item.frameId = frame?.id || null;
      board.items.push(item);
      created.push(item);
    }

    if (this.state.settings.removeInboxAfterPlace !== false) {
      const used = new Set(entries.map(entry => entry.id));
      board.inbox = board.inbox.filter(entry => !used.has(entry.id));
    }
    this.inboxSelectedIds.clear();
    this.selectedIds = new Set(created.map(item => item.id));
    board.updatedAt = Date.now();
    this.scheduleSave();
    this.closeModal();
    await this.renderItems();
    this.renderInboxButton();
    this.renderDrawer();
    if (created.length) this.focusItem(created[0]);
  }

  async deleteInboxEntries(entryIds) {
    if (!entryIds.length) return;
    if (!confirm(`Remove ${entryIds.length} photo${entryIds.length === 1 ? '' : 's'} from this inbox? Stored files used on boards are kept.`)) return;
    this.snapshotUndo();
    const remove = new Set(entryIds);
    this.activeBoard().inbox = this.activeBoard().inbox.filter(entry => !remove.has(entry.id));
    this.inboxSelectedIds.clear();
    this.scheduleSave();
    this.openInboxPanel();
    this.renderInboxButton();
  }

  async openInboxPanel() {
    const board = this.activeBoard();
    const modal = this.showModal(`Image Inbox · ${board.inbox.length}`, `
      <div class="ib2-inbox-toolbar">
        <button data-inbox-select-all>Select all</button>
        <button data-inbox-clear>Clear selection</button>
        <select data-inbox-role aria-label="Set selected role">${ROLE_OPTIONS.map(role => `<option value="${role}">${ROLE_LABELS[role]}</option>`).join('')}</select>
        <button data-inbox-apply-role>Set role</button>
        <button data-inbox-favorite>★ Favorite</button>
        <span class="ib2-spacer"></span>
        <button class="danger" data-inbox-delete>Remove selected</button>
        <button class="primary" data-inbox-place>Add selected to board</button>
      </div>
      <div class="ib2-inbox-grid"></div>
    `, 'ib2-inbox-modal');
    const grid = modal.querySelector('.ib2-inbox-grid');
    if (!board.inbox.length) {
      grid.innerHTML = '<div class="ib2-empty"><b>Your inbox is empty.</b><span>Use Add Photos to select many images from your gallery.</span></div>';
    }
    for (const entry of board.inbox) {
      const card = document.createElement('article');
      card.className = `ib2-inbox-card${this.inboxSelectedIds.has(entry.id) ? ' selected' : ''}`;
      card.dataset.entryId = entry.id;
      card.innerHTML = `
        <button class="ib2-inbox-select" aria-label="Select photo">${this.inboxSelectedIds.has(entry.id) ? '✓' : ''}</button>
        <img alt="${escapeHtml(entry.name)}">
        <div class="ib2-inbox-card-info">
          <b title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</b>
          <span>${ROLE_LABELS[entry.role] || entry.role}</span>
          <div class="ib2-rating" data-inbox-rating>${[1, 2, 3, 4, 5].map(value => `<button data-rate="${value}" class="${entry.rating >= value ? 'active' : ''}">★</button>`).join('')}</div>
        </div>
        <button class="ib2-inbox-star ${entry.favorite ? 'active' : ''}" title="Favorite">★</button>`;
      const img = card.querySelector('img');
      this.imageUrl(entry.imageId, true).then(url => { if (url && img.isConnected) img.src = url; });
      grid.appendChild(card);
    }

    const selectedEntryIds = () => [...this.inboxSelectedIds];
    grid.addEventListener('click', event => {
      const card = event.target.closest('.ib2-inbox-card');
      if (!card) return;
      const entry = board.inbox.find(item => item.id === card.dataset.entryId);
      if (!entry) return;
      const rate = event.target.closest('[data-rate]');
      if (rate) {
        entry.rating = Number(rate.dataset.rate);
        this.scheduleSave();
        this.openInboxPanel();
        return;
      }
      if (event.target.closest('.ib2-inbox-star')) {
        entry.favorite = !entry.favorite;
        this.scheduleSave();
        this.openInboxPanel();
        return;
      }
      if (this.inboxSelectedIds.has(entry.id)) this.inboxSelectedIds.delete(entry.id);
      else this.inboxSelectedIds.add(entry.id);
      card.classList.toggle('selected', this.inboxSelectedIds.has(entry.id));
      card.querySelector('.ib2-inbox-select').textContent = this.inboxSelectedIds.has(entry.id) ? '✓' : '';
    });
    modal.querySelector('[data-inbox-select-all]').onclick = () => { board.inbox.forEach(entry => this.inboxSelectedIds.add(entry.id)); this.openInboxPanel(); };
    modal.querySelector('[data-inbox-clear]').onclick = () => { this.inboxSelectedIds.clear(); this.openInboxPanel(); };
    modal.querySelector('[data-inbox-apply-role]').onclick = () => {
      const role = modal.querySelector('[data-inbox-role]').value;
      this.snapshotUndo();
      board.inbox.filter(entry => this.inboxSelectedIds.has(entry.id)).forEach(entry => { entry.role = role; });
      this.scheduleSave();
      this.openInboxPanel();
    };
    modal.querySelector('[data-inbox-favorite]').onclick = () => {
      this.snapshotUndo();
      board.inbox.filter(entry => this.inboxSelectedIds.has(entry.id)).forEach(entry => { entry.favorite = true; });
      this.scheduleSave();
      this.openInboxPanel();
    };
    modal.querySelector('[data-inbox-delete]').onclick = () => this.deleteInboxEntries(selectedEntryIds());
    modal.querySelector('[data-inbox-place]').onclick = () => this.placeInboxEntries(selectedEntryIds());
  }

  async renderInboxButton() {
    const count = this.root?.querySelector('[data-inbox-count]');
    if (count) count.textContent = String(this.activeBoard().inbox.length);
  }

  openContextMenu(itemId, clientX, clientY) {
    this.contextItemId = itemId;
    const item = this.itemById(itemId);
    if (!item) return;
    const menu = this.root.querySelector('.ib2-context-menu');
    if (item.type === 'image') {
      const isReference = allReferenceIds(this.activeBoard().character).includes(item.id);
      menu.innerHTML = `
        <button data-action="main">★ Set as main portrait</button>
        <button data-action="reference">${isReference ? '✦ Remove from reference basket' : '✦ Add to reference basket'}</button>
        <button data-action="details">⚙ Image details & crop</button>
        <button data-action="view-original">⛶ View original</button>
        <button data-action="replace">↺ Replace image</button>
        <button data-action="rotate-left">↶ Rotate left</button>
        <button data-action="rotate-right">↷ Rotate right</button>
        <button data-action="flip-x">↔ Flip horizontal</button>
        <button data-action="flip-y">↕ Flip vertical</button>
        <div class="ib2-menu-label">Reference type</div>
        ${ROLE_OPTIONS.map(role => `<button data-action="role" data-role="${role}" class="${item.role === role ? 'active' : ''}">${ROLE_LABELS[role]}</button>`).join('')}
        <button data-action="favorite">${item.favorite ? '☆ Remove favorite' : '★ Favorite'}</button>
        <button data-action="tags"># Edit tags</button>
        <button data-action="collection">▣ Set collection</button>
        <button data-action="lock">${item.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
        <button data-action="duplicate">⧉ Duplicate</button>
        <button data-action="delete" class="danger">🗑 Move to trash</button>`;
    } else if (item.type === 'frame') {
      menu.innerHTML = `
        <button data-action="frame-edit">✎ Rename / color</button>
        <button data-action="frame-collapse">${item.collapsed ? '▾ Expand group' : '▴ Collapse group'}</button>
        <button data-action="frame-select">□ Select group members</button>
        <button data-action="lock">${item.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
        <button data-action="duplicate">⧉ Duplicate group</button>
        <button data-action="delete" class="danger">🗑 Delete group</button>`;
    } else {
      menu.innerHTML = `
        <button data-action="edit-note">✎ Edit note</button>
        <button data-action="tags"># Edit tags</button>
        <button data-action="collection">▣ Set collection</button>
        <button data-action="lock">${item.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
        <button data-action="duplicate">⧉ Duplicate</button>
        <button data-action="delete" class="danger">🗑 Move to trash</button>`;
    }
    const rect = this.root.getBoundingClientRect();
    const width = 260;
    menu.style.left = `${clamp(clientX - rect.left, 8, Math.max(8, rect.width - width - 8))}px`;
    menu.style.top = `${clamp(clientY - rect.top, 8, Math.max(8, rect.height - 540))}px`;
    menu.classList.add('open');
  }

  closeContextMenu() {
    this.contextItemId = null;
    this.root?.querySelector('.ib2-context-menu')?.classList.remove('open');
  }

  async handleContextAction(button) {
    const item = this.itemById(this.contextItemId);
    if (!item) return this.closeContextMenu();
    const action = button.dataset.action;
    if (['details', 'view-original', 'replace', 'frame-edit'].includes(action)) {
      this.closeContextMenu();
      if (action === 'details') return this.openImageDetails(item.id);
      if (action === 'view-original') return this.viewOriginal(item);
      if (action === 'replace') {
        const input = this.root.querySelector('[data-replace-input]');
        input.dataset.replaceItemId = item.id;
        input.click();
        return;
      }
      if (action === 'frame-edit') {
        const values = await this.showFrameForm(item);
        if (values) {
          this.snapshotUndo();
          item.title = values.title;
          item.color = values.color;
          item.updatedAt = Date.now();
          this.scheduleSave();
          this.renderItems();
        }
        return;
      }
    }

    if (action === 'delete') {
      this.selectedIds = new Set([item.id]);
      this.closeContextMenu();
      return this.deleteSelected();
    }

    this.snapshotUndo();
    const character = this.activeBoard().character;
    if (action === 'main' && item.type === 'image') {
      character.mainImageId = item.id;
      addReference(character, item.id, item.role);
    } else if (action === 'reference' && item.type === 'image') {
      toggleReference(character, item.id, item.role);
    } else if (action === 'role' && item.type === 'image') {
      const previousRole = item.role;
      item.role = button.dataset.role;
      if (character.references?.[previousRole]?.includes(item.id)) addReference(character, item.id, item.role);
    } else if (action === 'favorite' && item.type === 'image') {
      item.favorite = !item.favorite;
    } else if (action === 'rotate-left' && item.type === 'image') {
      item.rotation = (item.rotation + 270) % 360;
    } else if (action === 'rotate-right' && item.type === 'image') {
      item.rotation = (item.rotation + 90) % 360;
    } else if (action === 'flip-x' && item.type === 'image') {
      item.flipX = !item.flipX;
    } else if (action === 'flip-y' && item.type === 'image') {
      item.flipY = !item.flipY;
    } else if (action === 'edit-note' && item.type === 'note') {
      const value = prompt('Note text:', item.text);
      if (value !== null) item.text = value;
    } else if (action === 'tags') {
      const value = prompt('Tags, separated by commas:', (item.tags || []).join(', '));
      if (value !== null) item.tags = value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 30);
    } else if (action === 'collection') {
      const value = prompt('Collection name (leave blank for none):', item.collection || '');
      if (value !== null) {
        item.collection = value.trim();
        if (item.collection && !this.state.collections.includes(item.collection)) this.state.collections.push(item.collection);
      }
    } else if (action === 'lock') {
      item.locked = !item.locked;
    } else if (action === 'duplicate') {
      if (item.type === 'frame') {
        const frameCopy = duplicateItem(item, 60);
        this.activeBoard().items.push(frameCopy);
        for (const member of getFrameMembers(this.activeBoard(), item.id)) {
          const memberCopy = duplicateItem(member, 60);
          memberCopy.frameId = frameCopy.id;
          this.activeBoard().items.push(memberCopy);
        }
      } else {
        this.activeBoard().items.push(duplicateItem(item));
      }
    } else if (action === 'frame-collapse' && item.type === 'frame') {
      item.collapsed = !item.collapsed;
    } else if (action === 'frame-select' && item.type === 'frame') {
      this.selectedIds = new Set([item.id, ...getFrameMembers(this.activeBoard(), item.id).map(member => member.id)]);
    } else {
      this.history.pop();
      return this.closeContextMenu();
    }
    item.updatedAt = Date.now();
    this.activeBoard().updatedAt = Date.now();
    this.scheduleSave();
    this.closeContextMenu();
    this.renderItems();
    this.renderDrawer();
  }

  async openImageDetails(itemId) {
    const item = this.itemById(itemId);
    if (!item || item.type !== 'image') return;
    const record = await getImage(item.imageId);
    if (!record) return this.toast('The stored image could not be found.', 'error');
    const url = await this.imageUrl(item.imageId, false);
    const modal = this.showModal('Image details & crop', `
      <div class="ib2-image-editor">
        <div class="ib2-crop-preview"><img src="${url}" alt="${escapeHtml(item.name)}"></div>
        <div class="ib2-image-fields">
          <label>Name<input data-image-name value="${escapeHtml(item.name)}"></label>
          <label>Reference type<select data-image-role>${ROLE_OPTIONS.map(role => `<option value="${role}" ${item.role === role ? 'selected' : ''}>${ROLE_LABELS[role]}</option>`).join('')}</select></label>
          <label>Source URL<input data-image-source value="${escapeHtml(item.sourceUrl || '')}" placeholder="https://..."></label>
          <label>Tags<input data-image-tags value="${escapeHtml((item.tags || []).join(', '))}"></label>
          <label>Rating<select data-image-rating>${[0, 1, 2, 3, 4, 5].map(value => `<option value="${value}" ${item.rating === value ? 'selected' : ''}>${value ? '★'.repeat(value) : 'Not rated'}</option>`).join('')}</select></label>
          <label class="ib2-check"><input type="checkbox" data-image-favorite ${item.favorite ? 'checked' : ''}> Favorite</label>
          <label class="wide">Notes<textarea data-image-notes>${escapeHtml(item.notes || '')}</textarea></label>
          <label>Crop zoom <output data-crop-zoom-output>${item.crop.zoom.toFixed(2)}×</output><input type="range" min="1" max="4" step="0.01" value="${item.crop.zoom}" data-crop-zoom></label>
          <label>Focal point X <output data-focal-x-output>${Math.round(item.crop.focalX)}%</output><input type="range" min="0" max="100" step="1" value="${item.crop.focalX}" data-focal-x></label>
          <label>Focal point Y <output data-focal-y-output>${Math.round(item.crop.focalY)}%</output><input type="range" min="0" max="100" step="1" value="${item.crop.focalY}" data-focal-y></label>
          <div class="ib2-transform-buttons wide">
            <button data-editor-action="rotate-left">↶ Rotate</button>
            <button data-editor-action="rotate-right">↷ Rotate</button>
            <button data-editor-action="flip-x">↔ Flip H</button>
            <button data-editor-action="flip-y">↕ Flip V</button>
            <button data-editor-action="reset">Reset crop</button>
            <button data-editor-action="replace">Replace</button>
            <button data-editor-action="original">View original</button>
          </div>
        </div>
      </div>
      <div class="ib2-modal-actions"><button data-editor-cancel>Cancel</button><button class="primary" data-editor-save>Save changes</button></div>
    `, 'ib2-image-editor-modal');

    const draft = deepClone(item);
    const preview = modal.querySelector('.ib2-crop-preview img');
    const updatePreview = () => {
      preview.style.objectPosition = `${draft.crop.focalX}% ${draft.crop.focalY}%`;
      preview.style.transform = `scale(${draft.crop.zoom}) rotate(${draft.rotation}deg) scaleX(${draft.flipX ? -1 : 1}) scaleY(${draft.flipY ? -1 : 1})`;
      modal.querySelector('[data-crop-zoom-output]').textContent = `${draft.crop.zoom.toFixed(2)}×`;
      modal.querySelector('[data-focal-x-output]').textContent = `${Math.round(draft.crop.focalX)}%`;
      modal.querySelector('[data-focal-y-output]').textContent = `${Math.round(draft.crop.focalY)}%`;
    };
    updatePreview();
    modal.querySelector('[data-crop-zoom]').oninput = event => { draft.crop.zoom = Number(event.target.value); updatePreview(); };
    modal.querySelector('[data-focal-x]').oninput = event => { draft.crop.focalX = Number(event.target.value); updatePreview(); };
    modal.querySelector('[data-focal-y]').oninput = event => { draft.crop.focalY = Number(event.target.value); updatePreview(); };
    modal.querySelector('.ib2-transform-buttons').onclick = event => {
      const action = event.target.closest('[data-editor-action]')?.dataset.editorAction;
      if (!action) return;
      if (action === 'rotate-left') draft.rotation = (draft.rotation + 270) % 360;
      else if (action === 'rotate-right') draft.rotation = (draft.rotation + 90) % 360;
      else if (action === 'flip-x') draft.flipX = !draft.flipX;
      else if (action === 'flip-y') draft.flipY = !draft.flipY;
      else if (action === 'reset') {
        draft.crop = { zoom: 1, focalX: 50, focalY: 50 };
        draft.rotation = 0;
        draft.flipX = false;
        draft.flipY = false;
        modal.querySelector('[data-crop-zoom]').value = '1';
        modal.querySelector('[data-focal-x]').value = '50';
        modal.querySelector('[data-focal-y]').value = '50';
      } else if (action === 'replace') {
        const input = this.root.querySelector('[data-replace-input]');
        input.dataset.replaceItemId = item.id;
        input.click();
      } else if (action === 'original') {
        this.viewOriginal(item);
      }
      updatePreview();
    };
    modal.querySelector('[data-editor-cancel]').onclick = () => modal.remove();
    modal.querySelector('[data-editor-save]').onclick = () => {
      this.snapshotUndo();
      const previousRole = item.role;
      item.name = modal.querySelector('[data-image-name]').value.trim() || item.name;
      item.role = modal.querySelector('[data-image-role]').value;
      item.sourceUrl = modal.querySelector('[data-image-source]').value.trim();
      item.tags = modal.querySelector('[data-image-tags]').value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 30);
      item.rating = Number(modal.querySelector('[data-image-rating]').value);
      item.favorite = modal.querySelector('[data-image-favorite]').checked;
      item.notes = modal.querySelector('[data-image-notes]').value;
      item.crop = draft.crop;
      item.rotation = draft.rotation;
      item.flipX = draft.flipX;
      item.flipY = draft.flipY;
      item.updatedAt = Date.now();
      const character = this.activeBoard().character;
      if (character.references?.[previousRole]?.includes(item.id) && previousRole !== item.role) addReference(character, item.id, item.role);
      this.scheduleSave();
      modal.remove();
      this.renderItems();
      this.renderDrawer();
    };
  }

  async viewOriginal(item) {
    const record = await getImage(item.imageId);
    if (!record?.blob) return;
    const url = await this.imageUrl(item.imageId, false);
    const modal = this.showModal(item.name || record.name || 'Original image', `
      <div class="ib2-original-view"><img src="${url}" alt="${escapeHtml(item.name)}"></div>
      <div class="ib2-original-meta"><span>${record.width} × ${record.height}</span><span>${Math.round((record.size || 0) / 1024)} KB</span>${item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">Open source</a>` : ''}</div>
    `, 'ib2-original-modal');
    modal.querySelector('.ib2-original-view img').onclick = () => modal.remove();
  }

  async replaceItemImage(itemId, file) {
    const item = this.itemById(itemId);
    if (!item || item.type !== 'image' || !file?.type?.startsWith('image/')) return;
    const progress = this.showProgressModal('Replacing image', `Reading ${file.name}…`);
    try {
      const record = await createImageRecord(file, { sourceUrl: item.sourceUrl });
      const exact = await getImageByHash(record.hash);
      const finalRecord = exact || await putImage(record);
      this.snapshotUndo();
      item.imageId = finalRecord.id;
      item.name = file.name || finalRecord.name;
      item.updatedAt = Date.now();
      this.clearObjectUrls();
      this.scheduleSave();
      await this.renderItems();
      this.renderDrawer();
      this.toast('Image replaced.', 'success');
    } catch (error) {
      console.error('[Inspiration Board] replace failed', error);
      this.toast('Could not replace that image.', 'error');
    } finally {
      progress.close();
    }
  }

  toggleSelection(id, additive = false) {
    if (!additive) this.selectedIds.clear();
    if (additive && this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.updateSelectionStyles();
  }

  updateSelectionStyles() {
    this.root?.querySelectorAll('.ib2-item').forEach(element => element.classList.toggle('selected', this.selectedIds.has(element.dataset.itemId)));
    const count = this.root?.querySelector('[data-selection-count]');
    if (count) count.textContent = this.selectedIds.size ? `${this.selectedIds.size} selected` : `${this.activeBoard().items.length} items`;
    const bar = this.root?.querySelector('.ib2-bulk-bar');
    if (bar) bar.classList.toggle('open', this.selectedIds.size > 0);
  }

  itemMatches(item) {
    if (item.type === 'frame') {
      if (!this.searchText && this.filterRole === 'all' && !this.filterFavorite) return true;
      const members = getFrameMembers(this.activeBoard(), item.id);
      return item.title.toLowerCase().includes(this.searchText.toLowerCase()) || members.some(member => this.itemMatches(member));
    }
    if (this.filterRole !== 'all' && (item.type !== 'image' || item.role !== this.filterRole)) return false;
    if (this.filterFavorite && (item.type !== 'image' || !item.favorite)) return false;
    if (!this.searchText) return true;
    const haystack = [item.name, item.text, item.role, item.collection, item.notes, ...(item.tags || [])].join(' ').toLowerCase();
    return haystack.includes(this.searchText.toLowerCase());
  }

  imageTransformStyle(item) {
    const crop = item.crop || { zoom: 1, focalX: 50, focalY: 50 };
    return `object-position:${crop.focalX}% ${crop.focalY}%;transform:scale(${crop.zoom}) rotate(${item.rotation || 0}deg) scaleX(${item.flipX ? -1 : 1}) scaleY(${item.flipY ? -1 : 1});`;
  }

  async renderItems() {
    if (!this.world) return;
    const token = ++this.renderToken;
    this.world.innerHTML = '';
    const board = this.activeBoard();
    const visible = getVisibleItems(board).filter(item => this.itemMatches(item));
    const frames = visible.filter(item => item.type === 'frame');
    const content = visible.filter(item => item.type !== 'frame');

    for (const frame of frames) {
      const element = document.createElement('div');
      element.className = `ib2-item ib2-frame frame-${frame.color}${frame.collapsed ? ' collapsed' : ''}${frame.locked ? ' locked' : ''}${this.selectedIds.has(frame.id) ? ' selected' : ''}`;
      element.dataset.itemId = frame.id;
      element.style.left = `${frame.x}px`;
      element.style.top = `${frame.y}px`;
      element.style.width = `${frame.width}px`;
      element.style.height = `${frame.collapsed ? 52 : frame.height}px`;
      const count = getFrameMembers(board, frame.id).length;
      element.innerHTML = `
        <div class="ib2-frame-header"><b>${escapeHtml(frame.title)}</b><span>${count}</span><button data-frame-toggle title="${frame.collapsed ? 'Expand' : 'Collapse'}">${frame.collapsed ? '▾' : '▴'}</button><button class="ib2-item-menu" aria-label="Group options">•••</button></div>
        <div class="ib2-frame-body"></div>${frame.collapsed ? '' : '<div class="ib2-resize-handle" aria-label="Resize"></div>'}`;
      this.world.appendChild(element);
    }

    for (const item of content) {
      if (token !== this.renderToken) return;
      const element = document.createElement('div');
      element.className = `ib2-item ib2-${item.type}${this.selectedIds.has(item.id) ? ' selected' : ''}${item.locked ? ' locked' : ''}${item.favorite ? ' favorite' : ''}`;
      element.dataset.itemId = item.id;
      element.style.left = `${item.x}px`;
      element.style.top = `${item.y}px`;
      element.style.width = `${item.width}px`;
      element.style.height = `${item.height}px`;
      if (item.type === 'image') {
        const isMain = board.character.mainImageId === item.id;
        const isReference = allReferenceIds(board.character).includes(item.id);
        element.innerHTML = `
          <div class="ib2-image-viewport"><img alt="${escapeHtml(item.name)}" draggable="false" style="${this.imageTransformStyle(item)}"></div>
          <div class="ib2-card-top"><span>${escapeHtml(ROLE_LABELS[item.role] || item.role)}</span>${isMain ? '<b title="Main portrait">★</b>' : ''}${isReference ? '<b title="Reference basket">✦</b>' : ''}${item.rating ? `<i>${'★'.repeat(item.rating)}</i>` : ''}<button class="ib2-item-menu" aria-label="Image options">•••</button></div>
          <div class="ib2-card-bottom">${escapeHtml(item.name || 'Image')}</div><div class="ib2-resize-handle" aria-label="Resize"></div>`;
        const img = element.querySelector('img');
        this.imageUrl(item.imageId, true).then(url => { if (url && img.isConnected) img.src = url; });
      } else {
        element.innerHTML = `<div class="ib2-note-text">${escapeHtml(item.text).replace(/\n/g, '<br>')}</div><button class="ib2-item-menu" aria-label="Note options">•••</button><div class="ib2-resize-handle" aria-label="Resize"></div>`;
      }
      this.world.appendChild(element);
    }
    this.updateSelectionStyles();
    this.renderMinimap();
  }

  renderItemPositions() {
    this.root.querySelectorAll('.ib2-item').forEach(element => {
      const item = this.itemById(element.dataset.itemId);
      if (!item) return;
      element.style.left = `${item.x}px`;
      element.style.top = `${item.y}px`;
      element.style.width = `${item.width}px`;
      element.style.height = `${item.type === 'frame' && item.collapsed ? 52 : item.height}px`;
    });
  }

  renderBoardPicker() {
    const select = this.root?.querySelector('[data-board-picker]');
    if (!select) return;
    select.innerHTML = this.state.boards.map(board => `<option value="${board.id}" ${board.id === this.state.activeBoardId ? 'selected' : ''}>${escapeHtml(board.name)}</option>`).join('');
  }

  renderMode() {
    const board = this.activeBoard();
    const button = this.root?.querySelector('[data-cmd="mode"]');
    if (button) {
      button.textContent = board.interactionMode === 'pan' ? '✋' : '▱';
      button.title = board.interactionMode === 'pan' ? 'Pan mode. Tap to switch to lasso select.' : 'Lasso select mode. Tap to switch to pan.';
      button.classList.toggle('active', board.interactionMode === 'select');
    }
    this.root?.classList.toggle('ib2-select-mode', board.interactionMode === 'select');
  }

  renderMinimap() {
    const map = this.root?.querySelector('.ib2-minimap-inner');
    if (!map || !this.canvas) return;
    const items = getVisibleItems(this.activeBoard());
    map.innerHTML = '';
    const bounds = getBounds(items);
    if (!bounds) return;
    for (const item of items) {
      const dot = document.createElement('span');
      dot.style.left = `${((item.x - bounds.x) / bounds.width) * 90 + 5}%`;
      dot.style.top = `${((item.y - bounds.y) / bounds.height) * 90 + 5}%`;
      dot.style.width = `${Math.max(3, item.width / bounds.width * 90)}%`;
      dot.style.height = `${Math.max(3, (item.type === 'frame' && item.collapsed ? 52 : item.height) / bounds.height * 90)}%`;
      dot.className = item.type;
      map.appendChild(dot);
    }
  }

  async renderDrawer() {
    const drawer = this.root?.querySelector('.ib2-character-drawer');
    if (!drawer) return;
    drawer.classList.toggle('open', this.drawerOpen);
    const board = this.activeBoard();
    const character = board.character;
    const fields = ['name', 'description', 'personality', 'scenario', 'first_message', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'tags'];
    for (const field of fields) {
      const input = drawer.querySelector(`[data-char-field="${field}"]`);
      if (input && input !== document.activeElement) input.value = character[field] || '';
    }
    const linked = drawer.querySelector('[data-linked-character]');
    linked.textContent = character.linkedCharacter ? `Linked: ${character.linkedCharacter.name}` : 'Not linked to a SillyTavern character';

    const basket = drawer.querySelector('.ib2-reference-basket');
    basket.innerHTML = '';
    let total = 0;
    for (const role of ROLE_OPTIONS) {
      const ids = character.references?.[role] || [];
      const items = ids.map(id => this.itemById(id)).filter(item => item?.type === 'image');
      if (!items.length) continue;
      total += items.length;
      const group = document.createElement('section');
      group.className = 'ib2-reference-group';
      group.innerHTML = `<header><b>${ROLE_LABELS[role]}</b><span>${items.length}</span></header><div class="ib2-reference-row"></div>`;
      const row = group.querySelector('.ib2-reference-row');
      for (const item of items) {
        const card = document.createElement('article');
        card.className = `ib2-reference${character.mainImageId === item.id ? ' main' : ''}`;
        card.dataset.refId = item.id;
        card.innerHTML = `<button data-ref-action="focus"><img alt="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span></button><button data-ref-action="main" title="Set main">★</button><button data-ref-action="remove" title="Remove">×</button>`;
        const image = card.querySelector('img');
        this.imageUrl(item.imageId, true).then(url => { if (url && image.isConnected) image.src = url; });
        row.appendChild(card);
      }
      basket.appendChild(group);
    }
    if (!total) basket.innerHTML = '<div class="ib2-empty compact">Tap an image’s ••• menu and add it to the reference basket.</div>';
    drawer.querySelector('[data-ref-count]').textContent = `${total} reference${total === 1 ? '' : 's'}`;
  }

  handleReferenceAction(button) {
    const card = button.closest('.ib2-reference');
    const item = this.itemById(card?.dataset.refId);
    if (!item) return;
    const action = button.dataset.refAction;
    if (action === 'focus') {
      this.selectedIds = new Set([item.id]);
      this.drawerOpen = false;
      this.renderDrawer();
      this.updateSelectionStyles();
      this.focusItem(item);
    } else if (action === 'main') {
      this.snapshotUndo();
      this.activeBoard().character.mainImageId = item.id;
      this.scheduleSave();
      this.renderItems();
      this.renderDrawer();
    } else if (action === 'remove') {
      this.snapshotUndo();
      removeReference(this.activeBoard().character, item.id);
      this.scheduleSave();
      this.renderItems();
      this.renderDrawer();
    }
  }

  currentSillyTavernCharacter() {
    const context = globalThis.SillyTavern?.getContext?.();
    const index = Number(context?.characterId);
    if (!context || !Number.isInteger(index) || index < 0) return null;
    return { context, index, character: context.characters?.[index] };
  }

  characterIdentity(character, index) {
    const data = character?.data || character || {};
    return {
      index,
      name: String(data.name || character?.name || `Character ${index + 1}`),
      avatar: String(character?.avatar || data.avatar || ''),
      linkedAt: Date.now(),
    };
  }

  linkCurrentCharacter() {
    const current = this.currentSillyTavernCharacter();
    if (!current?.character) return this.toast('Open a character chat first, then link the board.', 'warning');
    this.snapshotUndo();
    this.activeBoard().character.linkedCharacter = this.characterIdentity(current.character, current.index);
    this.scheduleSave();
    this.renderDrawer();
    this.toast(`Linked this board to ${this.activeBoard().character.linkedCharacter.name}.`, 'success');
  }

  async chooseLinkedCharacter() {
    const context = globalThis.SillyTavern?.getContext?.();
    const characters = context?.characters || [];
    if (!characters.length) return this.toast('No SillyTavern characters are available.', 'warning');
    const modal = this.showModal('Link board to a character', `
      <label>Character<select data-link-character>${characters.map((character, index) => {
        const identity = this.characterIdentity(character, index);
        return `<option value="${index}">${escapeHtml(identity.name)}</option>`;
      }).join('')}</select></label>
      <label class="ib2-check"><input type="checkbox" data-link-import checked> Import the character’s current text fields into this board</label>
      <div class="ib2-modal-actions"><button data-link-cancel>Cancel</button><button class="primary" data-link-save>Link board</button></div>
    `);
    modal.querySelector('[data-link-cancel]').onclick = () => modal.remove();
    modal.querySelector('[data-link-save]').onclick = () => {
      const index = Number(modal.querySelector('[data-link-character]').value);
      const character = characters[index];
      if (!character) return;
      this.snapshotUndo();
      this.activeBoard().character.linkedCharacter = this.characterIdentity(character, index);
      if (modal.querySelector('[data-link-import]').checked) this.importCharacterFields(character);
      this.scheduleSave();
      modal.remove();
      this.renderDrawer();
    };
  }

  importCharacterFields(character) {
    const data = character?.data || character || {};
    const target = this.activeBoard().character;
    const mapping = {
      name: data.name || character?.name,
      description: data.description,
      personality: data.personality,
      scenario: data.scenario,
      first_message: data.first_mes ?? data.first_message,
      mes_example: data.mes_example,
      creator_notes: data.creator_notes,
      system_prompt: data.system_prompt,
      post_history_instructions: data.post_history_instructions,
      tags: Array.isArray(character?.tags) ? character.tags.join(', ') : data.tags,
    };
    for (const [field, value] of Object.entries(mapping)) if (value !== undefined && value !== null) target[field] = String(value);
  }

  importLinkedCharacterFields() {
    const context = globalThis.SillyTavern?.getContext?.();
    const link = this.activeBoard().character.linkedCharacter;
    if (!context || !link) return this.toast('This board is not linked.', 'warning');
    const character = context.characters?.[link.index]
      || context.characters?.find(entry => (entry.avatar || entry.data?.avatar) === link.avatar)
      || context.characters?.find(entry => (entry.name || entry.data?.name) === link.name);
    if (!character) return this.toast('The linked character could not be found.', 'error');
    this.snapshotUndo();
    this.importCharacterFields(character);
    this.scheduleSave();
    this.renderDrawer();
    this.toast('Imported the linked character’s fields.', 'success');
  }

  openLinkedCharacter() {
    const context = globalThis.SillyTavern?.getContext?.();
    const link = this.activeBoard().character.linkedCharacter;
    if (!context || !link) return this.toast('This board is not linked.', 'warning');
    const index = context.characters?.[link.index] ? link.index : context.characters?.findIndex(entry => (entry.avatar || entry.data?.avatar) === link.avatar);
    if (!Number.isInteger(index) || index < 0) return this.toast('The linked character could not be found.', 'error');
    this.closeBoard();
    if (typeof context.selectCharacterById === 'function') context.selectCharacterById(String(index));
    else if (typeof context.openCharacterChat === 'function') context.openCharacterChat(context.characters[index]);
  }

  unlinkCharacter() {
    if (!this.activeBoard().character.linkedCharacter) return;
    this.snapshotUndo();
    this.activeBoard().character.linkedCharacter = null;
    this.scheduleSave();
    this.renderDrawer();
  }

  autoSelectLinkedBoard() {
    if (!this.state.settings.autoOpenLinkedBoard) return;
    const current = this.currentSillyTavernCharacter();
    if (!current?.character) return;
    const identity = this.characterIdentity(current.character, current.index);
    const board = this.state.boards.find(entry => {
      const link = entry.character?.linkedCharacter;
      return link && (link.avatar && link.avatar === identity.avatar || link.name === identity.name);
    });
    if (board) this.state.activeBoardId = board.id;
  }

  async analyzeReferences() {
    const board = this.activeBoard();
    const count = allReferenceIds(board.character).length;
    if (!count) return this.toast('Add images to the Character Reference Basket first.', 'warning');
    if (!confirm(`Analyze up to ${Math.min(count, this.state.settings.aiMaxImages)} reference images using SillyTavern’s configured Image Captioning model? This may use paid API credits.`)) return;
    const progress = this.showProgressModal('AI reference analysis', 'Starting image analysis…');
    try {
      const suggestions = await analyzeCharacterReferences({
        board,
        getItemById: id => this.itemById(id),
        maxImages: this.state.settings.aiMaxImages,
        onProgress: update => progress.update(update.message),
      });
      progress.close();
      this.showAiSuggestions(suggestions);
    } catch (error) {
      progress.close();
      console.error('[Inspiration Board] AI analysis failed', error);
      this.toast(error instanceof Error ? error.message : 'AI analysis failed.', 'error');
    }
  }

  showAiSuggestions(suggestions) {
    const modal = this.showModal('Review AI suggestions', `
      <p class="ib2-muted">Nothing is applied automatically. Edit the text and choose which fields to copy into the character draft.</p>
      <div class="ib2-ai-fields">
        <label><input type="checkbox" data-ai-use="description" checked> Appearance / Description<textarea data-ai-field="description">${escapeHtml(suggestions.description)}</textarea></label>
        <label><input type="checkbox" data-ai-use="personality" checked> Personality inspiration<textarea data-ai-field="personality">${escapeHtml(suggestions.personality)}</textarea></label>
        <label><input type="checkbox" data-ai-use="scenario"> Scenario<textarea data-ai-field="scenario">${escapeHtml(suggestions.scenario)}</textarea></label>
        <label><input type="checkbox" data-ai-use="creator_notes" checked> Creator notes<textarea data-ai-field="creator_notes">${escapeHtml(suggestions.creator_notes)}</textarea></label>
        <label><input type="checkbox" data-ai-use="tags" checked> Tags<input data-ai-field="tags" value="${escapeHtml((suggestions.tags || []).join(', '))}"></label>
        <details><summary>Raw visual captions</summary><pre>${escapeHtml((suggestions.captions || []).map(entry => `[${ROLE_LABELS[entry.role]}] ${entry.caption}`).join('\n\n'))}</pre></details>
      </div>
      <div class="ib2-modal-actions"><button data-ai-cancel>Cancel</button><button class="primary" data-ai-apply>Apply selected fields</button></div>
    `, 'ib2-ai-modal');
    modal.querySelector('[data-ai-cancel]').onclick = () => modal.remove();
    modal.querySelector('[data-ai-apply]').onclick = () => {
      const fields = [...modal.querySelectorAll('[data-ai-use]:checked')].map(input => input.dataset.aiUse);
      const edited = {
        ...suggestions,
        description: modal.querySelector('[data-ai-field="description"]').value,
        personality: modal.querySelector('[data-ai-field="personality"]').value,
        scenario: modal.querySelector('[data-ai-field="scenario"]').value,
        creator_notes: modal.querySelector('[data-ai-field="creator_notes"]').value,
        tags: modal.querySelector('[data-ai-field="tags"]').value.split(',').map(tag => tag.trim()).filter(Boolean),
      };
      this.snapshotUndo();
      applyAiSuggestions(this.activeBoard().character, edited, fields);
      this.scheduleSave();
      modal.remove();
      this.drawerOpen = true;
      this.renderDrawer();
      this.toast('AI suggestions applied to the draft.', 'success');
    };
  }

  async sendToCharacterCreator() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context?.createCharacterData) return this.toast('This SillyTavern version does not expose the character creator data.', 'error');
    const character = this.activeBoard().character;
    const target = context.createCharacterData;
    const fields = ['name', 'description', 'personality', 'scenario', 'first_message', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'tags'];
    for (const field of fields) target[field] = character[field] || '';
    if (character.mainImageId) {
      const item = this.itemById(character.mainImageId);
      const record = item ? await getImage(item.imageId) : null;
      if (record?.blob) {
        const file = new File([record.blob], record.name || 'character.png', { type: record.mime || record.blob.type || 'image/png' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        target.avatar = transfer.files;
      }
    }
    this.closeBoard();
    const createButton = document.querySelector('#rm_button_create');
    if (createButton) {
      createButton.click();
      setTimeout(() => {
        const mapping = {
          '#character_name_pole': character.name,
          '#description_textarea': character.description,
          '#personality_textarea': character.personality,
          '#scenario_pole': character.scenario,
          '#firstmessage_textarea': character.first_message,
          '#mes_example_textarea': character.mes_example,
          '#creator_notes_textarea': character.creator_notes,
          '#system_prompt_textarea': character.system_prompt,
          '#post_history_instructions_textarea': character.post_history_instructions,
          '#tags_textarea': character.tags,
        };
        for (const [selector, value] of Object.entries(mapping)) {
          const input = document.querySelector(selector);
          if (!input) continue;
          input.value = value || '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 180);
      this.toast('Character draft sent to SillyTavern.', 'success');
    } else {
      this.toast('The draft is prepared. Open SillyTavern’s character creator to continue.', 'success');
    }
  }

  async showHistory() {
    const snapshots = await listSnapshots(this.state.settings.maxSnapshots);
    const modal = this.showModal('Board history', `
      <p class="ib2-muted">The newest ${this.state.settings.maxSnapshots} automatic and safety snapshots are kept in browser storage.</p>
      <div class="ib2-history-list"></div>
      <div class="ib2-modal-actions"><button data-history-save>Save snapshot now</button><button class="danger" data-history-clear>Clear history</button></div>
    `, 'ib2-history-modal');
    const list = modal.querySelector('.ib2-history-list');
    if (!snapshots.length) list.innerHTML = '<div class="ib2-empty">No snapshots yet.</div>';
    for (const snapshot of snapshots) {
      const row = document.createElement('article');
      row.className = 'ib2-history-row';
      row.dataset.snapshotId = snapshot.id;
      row.innerHTML = `<div><b>${escapeHtml(snapshot.reason || 'Snapshot')}</b><span>${escapeHtml(snapshot.label || '')} · ${formatTime(snapshot.createdAt)}</span></div><button data-history-restore>Restore</button><button class="danger" data-history-delete>Delete</button>`;
      list.appendChild(row);
    }
    list.onclick = async event => {
      const row = event.target.closest('[data-snapshot-id]');
      if (!row) return;
      if (event.target.closest('[data-history-delete]')) {
        await deleteSnapshot(row.dataset.snapshotId);
        row.remove();
      } else if (event.target.closest('[data-history-restore]')) {
        if (!confirm('Restore this snapshot? A safety snapshot of the current state will be made first.')) return;
        await this.createPersistentSnapshot('Before history restore', true);
        const snapshot = await getSnapshot(row.dataset.snapshotId);
        if (!snapshot?.state) return;
        this.snapshotUndo();
        this.state = normalizeState(snapshot.state);
        this.selectedIds.clear();
        this.clearObjectUrls();
        this.saveStateNow({ snapshot: false });
        modal.remove();
        this.render();
        this.toast('Snapshot restored.', 'success');
      }
    };
    modal.querySelector('[data-history-save]').onclick = async () => {
      await this.createPersistentSnapshot('Manual snapshot', true);
      modal.remove();
      this.showHistory();
    };
    modal.querySelector('[data-history-clear]').onclick = async () => {
      if (!confirm('Delete all Inspiration Board snapshots?')) return;
      await clearSnapshots();
      modal.remove();
      this.showHistory();
    };
  }

  async backupAll() {
    const progress = this.showProgressModal('Creating backup', 'Reading stored images…');
    try {
      const images = await listImages();
      const serialized = [];
      for (let index = 0; index < images.length; index++) {
        const image = images[index];
        progress.update(`Packing image ${index + 1} of ${images.length}…`);
        const bytes = new Uint8Array(await image.blob.arrayBuffer());
        serialized.push({
          id: image.id,
          name: image.name,
          mime: image.mime,
          size: image.size,
          hash: image.hash,
          dhash: image.dhash,
          width: image.width,
          height: image.height,
          sourceUrl: image.sourceUrl || '',
          createdAt: image.createdAt,
          updatedAt: image.updatedAt,
          data: bytesToBase64(bytes),
        });
      }
      const backup = {
        format: 'sillytavern-inspiration-board',
        version: 2,
        exportedAt: Date.now(),
        extensionVersion: VERSION,
        state: this.state,
        images: serialized,
      };
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${sanitizeFilename(this.activeBoard().name, 'inspiration-board')}-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.toast('Backup exported.', 'success');
    } catch (error) {
      console.error('[Inspiration Board] backup failed', error);
      this.toast('Could not create the backup.', 'error');
    } finally {
      progress.close();
    }
  }

  async restoreBackup(file) {
    const progress = this.showProgressModal('Restoring backup', 'Reading backup file…');
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.format !== 'sillytavern-inspiration-board' || ![1, 2].includes(Number(backup.version))) throw new Error('Unsupported backup format.');
      progress.close();
      if (!confirm('Restore this backup? Current boards and stored images will be replaced after a safety snapshot is created.')) return;
      await this.createPersistentSnapshot('Before backup restore', true);
      progress.open('Restoring backup', 'Replacing image storage…');
      await clearImages();
      for (let index = 0; index < (backup.images || []).length; index++) {
        const image = backup.images[index];
        progress.update(`Restoring image ${index + 1} of ${backup.images.length}…`);
        const bytes = base64ToBytes(image.data);
        const blob = new Blob([bytes], { type: image.mime || 'image/jpeg' });
        const thumbnail = await makeThumbnail(blob);
        const record = {
          ...image,
          blob,
          thumbnail: thumbnail.blob,
          thumbnailWidth: thumbnail.width,
          thumbnailHeight: thumbnail.height,
        };
        delete record.data;
        await putImage(record);
      }
      this.state = normalizeState(backup.state);
      this.selectedIds.clear();
      this.inboxSelectedIds.clear();
      this.history = [];
      this.future = [];
      this.clearObjectUrls();
      this.saveStateNow({ snapshot: false });
      this.render();
      this.toast('Backup restored.', 'success');
    } catch (error) {
      console.error('[Inspiration Board] restore failed', error);
      this.toast(error instanceof Error ? error.message : 'Could not restore that backup.', 'error');
    } finally {
      progress.close();
    }
  }

  async cleanUnusedImages() {
    const used = new Set();
    for (const board of this.state.boards) {
      board.items.filter(item => item.type === 'image').forEach(item => used.add(item.imageId));
      board.inbox.forEach(entry => used.add(entry.imageId));
    }
    const all = await listImages();
    const unused = all.filter(image => !used.has(image.id));
    if (!unused.length) return this.toast('No unused stored images were found.', 'info');
    if (!confirm(`Delete ${unused.length} unused stored image${unused.length === 1 ? '' : 's'}? This cannot be undone without a backup.`)) return;
    await this.createPersistentSnapshot('Before image cleanup', true);
    for (const image of unused) await deleteImage(image.id);
    this.clearObjectUrls();
    this.toast(`Deleted ${unused.length} unused image${unused.length === 1 ? '' : 's'}.`, 'success');
  }

  async exportBoardImage() {
    const progress = this.showProgressModal('Exporting moodboard', 'Rendering the canvas…');
    try {
      await exportBoardAsPng(this.activeBoard(), {
        onProgress: update => progress.update(`Rendering item ${update.index + 1} of ${update.total}…`),
      });
      this.toast('Moodboard image exported.', 'success');
    } catch (error) {
      console.error('[Inspiration Board] PNG export failed', error);
      this.toast('Could not export the moodboard image.', 'error');
    } finally {
      progress.close();
    }
  }

  showSettings() {
    const settings = this.state.settings;
    const modal = this.showModal('Inspiration Board settings', `
      <div class="ib2-settings-grid">
        <label>Toolbar position<select data-setting="toolbarPosition"><option value="left" ${settings.toolbarPosition === 'left' ? 'selected' : ''}>Left side</option><option value="bottom" ${settings.toolbarPosition === 'bottom' ? 'selected' : ''}>Bottom</option></select></label>
        <label class="ib2-check"><input type="checkbox" data-setting="removeInboxAfterPlace" ${settings.removeInboxAfterPlace !== false ? 'checked' : ''}> Remove inbox photos after placing them on the board</label>
        <label class="ib2-check"><input type="checkbox" data-setting="confirmDelete" ${settings.confirmDelete ? 'checked' : ''}> Confirm item deletion</label>
        <label class="ib2-check"><input type="checkbox" data-setting="autoOpenLinkedBoard" ${settings.autoOpenLinkedBoard ? 'checked' : ''}> Automatically select the board linked to the current character</label>
        <label>Autosave snapshot interval<input type="number" min="1" max="60" data-setting="autoSnapshotMinutes" value="${settings.autoSnapshotMinutes}"><span>minutes</span></label>
        <label>Snapshots kept<input type="number" min="3" max="30" data-setting="maxSnapshots" value="${settings.maxSnapshots}"></label>
        <label>Near-duplicate sensitivity<input type="range" min="0" max="20" data-setting="duplicateDistance" value="${settings.duplicateDistance}"><output>${settings.duplicateDistance}</output></label>
        <label>AI images per analysis<input type="number" min="1" max="12" data-setting="aiMaxImages" value="${settings.aiMaxImages}"></label>
      </div>
      <p class="ib2-muted">Lower duplicate sensitivity numbers only catch very close matches. AI analysis uses SillyTavern’s Image Captioning configuration.</p>
      <div class="ib2-modal-actions"><button data-settings-cancel>Cancel</button><button class="primary" data-settings-save>Save settings</button></div>
    `);
    const range = modal.querySelector('[data-setting="duplicateDistance"]');
    range.oninput = () => { range.nextElementSibling.textContent = range.value; };
    modal.querySelector('[data-settings-cancel]').onclick = () => modal.remove();
    modal.querySelector('[data-settings-save]').onclick = () => {
      this.snapshotUndo();
      settings.toolbarPosition = modal.querySelector('[data-setting="toolbarPosition"]').value;
      settings.removeInboxAfterPlace = modal.querySelector('[data-setting="removeInboxAfterPlace"]').checked;
      settings.confirmDelete = modal.querySelector('[data-setting="confirmDelete"]').checked;
      settings.autoOpenLinkedBoard = modal.querySelector('[data-setting="autoOpenLinkedBoard"]').checked;
      settings.autoSnapshotMinutes = clamp(Number(modal.querySelector('[data-setting="autoSnapshotMinutes"]').value) || 3, 1, 60);
      settings.maxSnapshots = clamp(Number(modal.querySelector('[data-setting="maxSnapshots"]').value) || 10, 3, 30);
      settings.duplicateDistance = clamp(Number(range.value) || 7, 0, 20);
      settings.aiMaxImages = clamp(Number(modal.querySelector('[data-setting="aiMaxImages"]').value) || 6, 1, 12);
      this.scheduleSave();
      modal.remove();
      this.applyLayoutSettings();
    };
  }

  applyLayoutSettings() {
    if (!this.root) return;
    this.root.classList.toggle('ib2-toolbar-bottom', this.state.settings.toolbarPosition === 'bottom');
    this.root.classList.toggle('ib2-canvas-only', this.activeBoard().canvasOnly);
  }

  render() {
    if (!this.root) return;
    this.renderBoardPicker();
    this.applyLayoutSettings();
    this.applyWorldTransform();
    this.updateZoomLabel();
    this.renderMode();
    this.renderInboxButton();
    this.renderItems();
    this.renderDrawer();
  }

  buildUi() {
    document.getElementById('st-inspiration-board')?.remove();
    const root = document.createElement('div');
    root.id = 'st-inspiration-board';
    root.className = 'ib2-shell';
    root.innerHTML = `
      <header class="ib2-topbar">
        <div class="ib2-brand"><span>✦</span><div><b>Inspiration Board</b><small data-save-status>Saved</small></div></div>
        <select data-board-picker aria-label="Current board"></select>
        <button data-cmd="new-board" title="New board">＋</button>
        <button data-cmd="rename-board" title="Rename board">✎</button>
        <button data-cmd="mode" title="Pan / lasso mode">✋</button>
        <button data-cmd="canvas-only" title="Canvas-only mode">▣</button>
        <label class="ib2-search"><span>⌕</span><input data-search placeholder="Search images, tags, notes…"></label>
        <select data-role-filter aria-label="Filter reference type"><option value="all">All types</option>${ROLE_OPTIONS.map(role => `<option value="${role}">${ROLE_LABELS[role]}</option>`).join('')}</select>
        <button data-cmd="favorite-filter" title="Show favorites">☆</button>
        <button data-cmd="inbox" class="ib2-inbox-button" title="Image inbox">▥<span data-inbox-count>0</span></button>
        <button data-cmd="history" title="Board history">◴</button>
        <button data-cmd="settings" title="Settings">⚙</button>
        <button data-cmd="undo" title="Undo">↶</button>
        <button data-cmd="redo" title="Redo">↷</button>
        <button data-cmd="close" class="ib2-close" title="Close">×</button>
      </header>
      <div class="ib2-body">
        <aside class="ib2-rail">
          <button data-cmd="photos" class="primary"><span>＋</span><label>Add Photos</label></button>
          <button data-cmd="inbox"><span>▥</span><label>Inbox</label><em data-inbox-count>0</em></button>
          <button data-cmd="url"><span>⌁</span><label>Image URL</label></button>
          <button data-cmd="note"><span>▤</span><label>Note</label></button>
          <button data-cmd="frame"><span>▱</span><label>Group</label></button>
          <button data-cmd="smart"><span>✦</span><label>Arrange</label></button>
          <button data-cmd="fit"><span>⊙</span><label>Fit</label></button>
          <button data-cmd="drawer"><span>♙</span><label>References</label></button>
          <button data-cmd="ai"><span>✧</span><label>AI Draft</label></button>
          <button data-cmd="link"><span>⛓</span><label>Link Char</label></button>
          <div class="ib2-rail-spacer"></div>
          <button data-cmd="export"><span>▧</span><label>Export PNG</label></button>
          <button data-cmd="history"><span>◴</span><label>History</label></button>
          <button data-cmd="backup"><span>⇩</span><label>Backup</label></button>
          <button data-cmd="restore"><span>⇧</span><label>Restore</label></button>
          <button data-cmd="clean"><span>⌫</span><label>Clean</label></button>
          <button data-cmd="delete-board" class="danger"><span>🗑</span><label>Board</label></button>
        </aside>
        <main class="ib2-canvas" tabindex="0">
          <div class="ib2-world"></div>
          <div class="ib2-lasso"></div>
          <div class="ib2-canvas-hint">Pan mode: drag empty space · Select mode: draw a lasso · Long-press an item for options · Pinch to zoom</div>
          <div class="ib2-minimap"><div class="ib2-minimap-inner"></div></div>
          <div class="ib2-zoom"><button data-cmd="zoom-out">−</button><span data-zoom-label>100%</span><button data-cmd="zoom-in">＋</button></div>
          <div class="ib2-selection-tools"><span data-selection-count>0 items</span><button data-cmd="duplicate" title="Duplicate">⧉</button><button data-cmd="delete" title="Trash">🗑</button></div>
          <div class="ib2-bulk-bar">
            <span data-selection-count>0 selected</span>
            <select data-bulk-role>${ROLE_OPTIONS.map(role => `<option value="${role}">${ROLE_LABELS[role]}</option>`).join('')}</select>
            <button data-cmd="bulk-role">Set type</button>
            <button data-cmd="bulk-reference">✦ References</button>
            <button data-cmd="bulk-tags"># Tags</button>
            <button data-cmd="bulk-frame">▱ Group</button>
            <button data-cmd="duplicate">⧉</button>
            <button data-cmd="delete" class="danger">🗑</button>
          </div>
          <button class="ib2-fab" data-cmd="photos" title="Add multiple photos">＋</button>
        </main>
      </div>
      <section class="ib2-character-drawer">
        <button class="ib2-drawer-handle" data-cmd="drawer"><span></span><b>Character Creator</b><em data-ref-count>0 references</em><i>⌃</i></button>
        <div class="ib2-drawer-content">
          <div class="ib2-character-link-row">
            <b data-linked-character>Not linked to a SillyTavern character</b>
            <button data-cmd="link-current">Link current</button>
            <button data-cmd="link-choose">Choose</button>
            <button data-cmd="link-import">Import fields</button>
            <button data-cmd="link-open">Open chat</button>
            <button data-cmd="link-unlink">Unlink</button>
          </div>
          <div class="ib2-reference-basket"></div>
          <div class="ib2-drawer-actions"><button data-cmd="ai">✧ Analyze References</button><button data-cmd="send-character" class="primary">Send Draft to SillyTavern Creator →</button></div>
          <div class="ib2-form-grid">
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
        </div>
      </section>
      <div class="ib2-context-menu"></div>
      <div class="ib2-modal-host"></div>
      <input class="ib2-hidden-input" data-photo-input type="file" accept="image/*" multiple>
      <input class="ib2-hidden-input" data-replace-input type="file" accept="image/*">
      <input class="ib2-hidden-input" data-backup-input type="file" accept="application/json,.json">
    `;
    document.body.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('.ib2-canvas');
    this.world = root.querySelector('.ib2-world');
    this.bindUi();
  }

  bindUi() {
    this.root.addEventListener('click', event => {
      const commandButton = event.target.closest('[data-cmd]');
      if (commandButton) {
        event.preventDefault();
        event.stopPropagation();
        this.runCommand(commandButton.dataset.cmd, commandButton);
        return;
      }
      const frameToggle = event.target.closest('[data-frame-toggle]');
      if (frameToggle) {
        const frame = this.itemById(frameToggle.closest('.ib2-item')?.dataset.itemId);
        if (frame?.type === 'frame') {
          this.snapshotUndo();
          frame.collapsed = !frame.collapsed;
          this.scheduleSave();
          this.renderItems();
        }
        return;
      }
      const menuButton = event.target.closest('.ib2-item-menu');
      if (menuButton) {
        const itemElement = menuButton.closest('.ib2-item');
        this.openContextMenu(itemElement.dataset.itemId, event.clientX, event.clientY);
        return;
      }
      const menuAction = event.target.closest('.ib2-context-menu button');
      if (menuAction) {
        void this.handleContextAction(menuAction);
        return;
      }
      const referenceAction = event.target.closest('[data-ref-action]');
      if (referenceAction) {
        this.handleReferenceAction(referenceAction);
        return;
      }
      if (!event.target.closest('.ib2-context-menu')) this.closeContextMenu();
    });

    this.root.querySelector('[data-photo-input]').addEventListener('change', async event => {
      await this.ingestFiles(event.target.files);
      event.target.value = '';
    });
    this.root.querySelector('[data-replace-input]').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      const itemId = event.target.dataset.replaceItemId;
      if (file && itemId) await this.replaceItemImage(itemId, file);
      event.target.value = '';
      event.target.dataset.replaceItemId = '';
    });
    this.root.querySelector('[data-backup-input]').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (file) await this.restoreBackup(file);
      event.target.value = '';
    });
    this.root.querySelector('[data-board-picker]').addEventListener('change', event => this.selectBoard(event.target.value));
    this.root.querySelector('[data-search]').addEventListener('input', event => {
      this.searchText = event.target.value.trim();
      this.renderItems();
    });
    this.root.querySelector('[data-role-filter]').addEventListener('change', event => {
      this.filterRole = event.target.value;
      this.renderItems();
    });
    this.root.querySelectorAll('[data-char-field]').forEach(input => input.addEventListener('input', event => {
      this.activeBoard().character[event.target.dataset.charField] = event.target.value;
      this.activeBoard().updatedAt = Date.now();
      this.scheduleSave();
    }));

    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    this.canvas.addEventListener('contextmenu', event => {
      const item = event.target.closest('.ib2-item');
      if (!item) return;
      event.preventDefault();
      this.openContextMenu(item.dataset.itemId, event.clientX, event.clientY);
    });
    this.canvas.addEventListener('pointerdown', event => this.onPointerDown(event));
    this.canvas.addEventListener('pointermove', event => this.onPointerMove(event));
    this.canvas.addEventListener('pointerup', event => this.onPointerUp(event));
    this.canvas.addEventListener('pointercancel', event => this.onPointerUp(event));
    this.canvas.addEventListener('dragover', event => { event.preventDefault(); this.canvas.classList.add('dragover'); });
    this.canvas.addEventListener('dragleave', () => this.canvas.classList.remove('dragover'));
    this.canvas.addEventListener('drop', event => {
      event.preventDefault();
      this.canvas.classList.remove('dragover');
      if (event.dataTransfer?.files?.length) void this.ingestFiles(event.dataTransfer.files);
    });
  }

  runCommand(command, button) {
    if (command === 'photos') this.root.querySelector('[data-photo-input]').click();
    else if (command === 'inbox') this.openInboxPanel();
    else if (command === 'url') void this.importImageUrl();
    else if (command === 'note') this.addNote();
    else if (command === 'frame') void this.addFrame();
    else if (command === 'smart') this.smartArrange();
    else if (command === 'fit') this.fitBoard();
    else if (command === 'drawer') { this.drawerOpen = !this.drawerOpen; this.renderDrawer(); }
    else if (command === 'ai') void this.analyzeReferences();
    else if (command === 'link') void this.chooseLinkedCharacter();
    else if (command === 'export') void this.exportBoardImage();
    else if (command === 'history') void this.showHistory();
    else if (command === 'settings') this.showSettings();
    else if (command === 'backup') void this.backupAll();
    else if (command === 'restore') this.root.querySelector('[data-backup-input]').click();
    else if (command === 'clean') void this.cleanUnusedImages();
    else if (command === 'delete-board') void this.deleteBoard();
    else if (command === 'new-board') void this.addBoard();
    else if (command === 'rename-board') this.renameBoard();
    else if (command === 'mode') this.toggleMode();
    else if (command === 'canvas-only') this.toggleCanvasOnly();
    else if (command === 'favorite-filter') {
      this.filterFavorite = !this.filterFavorite;
      button.classList.toggle('active', this.filterFavorite);
      button.textContent = this.filterFavorite ? '★' : '☆';
      this.renderItems();
    } else if (command === 'undo') this.undo();
    else if (command === 'redo') this.redo();
    else if (command === 'close') this.closeBoard();
    else if (command === 'zoom-in' || command === 'zoom-out') {
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, command === 'zoom-in' ? 1.2 : 1 / 1.2);
    } else if (command === 'duplicate') this.duplicateSelected();
    else if (command === 'delete') void this.deleteSelected();
    else if (command === 'bulk-role') this.bulkSetRole(this.root.querySelector('[data-bulk-role]').value);
    else if (command === 'bulk-reference') this.bulkToggleReferences();
    else if (command === 'bulk-tags') this.bulkEditTags();
    else if (command === 'bulk-frame') this.bulkAssignFrame();
    else if (command === 'send-character') void this.sendToCharacterCreator();
    else if (command === 'link-current') this.linkCurrentCharacter();
    else if (command === 'link-choose') void this.chooseLinkedCharacter();
    else if (command === 'link-import') this.importLinkedCharacterFields();
    else if (command === 'link-open') this.openLinkedCharacter();
    else if (command === 'link-unlink') this.unlinkCharacter();
  }

  cancelLongPress() {
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (event.target.closest('button,input,select,textarea,.ib2-context-menu,.ib2-bulk-bar')) return;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.cancelLongPress();

    if (this.activePointers.size === 2) {
      const points = [...this.activePointers.values()];
      this.pinchStart = {
        distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)),
        zoom: this.activeBoard().view.zoom,
        x: this.activeBoard().view.x,
        y: this.activeBoard().view.y,
        centerX: (points[0].x + points[1].x) / 2,
        centerY: (points[0].y + points[1].y) / 2,
      };
      this.pointerMode = { type: 'pinch', moved: true };
      return;
    }

    const itemElement = event.target.closest('.ib2-item');
    if (itemElement) {
      const item = this.itemById(itemElement.dataset.itemId);
      if (!item) return;
      const additive = event.ctrlKey || event.metaKey || event.shiftKey || this.activeBoard().interactionMode === 'select';
      this.toggleSelection(item.id, additive);
      if (!this.selectedIds.has(item.id)) return;
      const start = { x: event.clientX, y: event.clientY };
      this.longPressTimer = setTimeout(() => {
        if (this.pointerMode && !this.pointerMode.moved) {
          this.pointerMode.longPressed = true;
          this.openContextMenu(item.id, event.clientX, event.clientY);
          navigator.vibrate?.(20);
        }
      }, 560);

      if (event.target.closest('.ib2-resize-handle') && !item.locked) {
        this.snapshotUndo();
        this.pointerMode = {
          type: 'resize', id: item.id, startX: start.x, startY: start.y,
          width: item.width, height: item.height, moved: false, longPressed: false, downItemId: item.id,
        };
      } else if (!item.locked) {
        this.snapshotUndo();
        const selected = this.activeBoard().items.filter(entry => this.selectedIds.has(entry.id) && !entry.locked);
        const moving = new Map(selected.map(entry => [entry.id, entry]));
        const movedFrames = selected.filter(entry => entry.type === 'frame');
        for (const frame of movedFrames) {
          for (const member of getFrameMembers(this.activeBoard(), frame.id)) if (!member.locked) moving.set(member.id, member);
        }
        this.pointerMode = {
          type: 'move', startX: start.x, startY: start.y, moved: false, longPressed: false, downItemId: item.id,
          movedFrameIds: new Set(movedFrames.map(frame => frame.id)),
          items: [...moving.values()].map(entry => ({ id: entry.id, x: entry.x, y: entry.y })),
        };
      } else {
        this.pointerMode = { type: 'tap', itemId: item.id, downItemId: item.id, startX: start.x, startY: start.y, moved: false, longPressed: false };
      }
      event.stopPropagation();
      return;
    }

    this.selectedIds.clear();
    this.updateSelectionStyles();
    if (this.activeBoard().interactionMode === 'select') {
      const rect = this.canvas.getBoundingClientRect();
      this.pointerMode = {
        type: 'lasso', startX: event.clientX, startY: event.clientY,
        left: event.clientX - rect.left, top: event.clientY - rect.top,
        moved: false,
      };
      const lasso = this.root.querySelector('.ib2-lasso');
      lasso.style.left = `${this.pointerMode.left}px`;
      lasso.style.top = `${this.pointerMode.top}px`;
      lasso.style.width = '0px';
      lasso.style.height = '0px';
      lasso.classList.add('open');
    } else {
      this.pointerMode = {
        type: 'pan', startX: event.clientX, startY: event.clientY,
        x: this.activeBoard().view.x, y: this.activeBoard().view.y, moved: false,
      };
    }
  }

  onPointerMove(event) {
    if (this.activePointers.has(event.pointerId)) this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!this.pointerMode) return;
    const distance = Math.hypot(event.clientX - (this.pointerMode.startX || event.clientX), event.clientY - (this.pointerMode.startY || event.clientY));
    if (distance > 7) {
      this.pointerMode.moved = true;
      this.cancelLongPress();
    }

    if (this.pointerMode.type === 'pinch' && this.activePointers.size >= 2 && this.pinchStart) {
      const points = [...this.activePointers.values()];
      const nextDistance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      const factor = nextDistance / this.pinchStart.distance;
      const rect = this.canvas.getBoundingClientRect();
      const centerX = (points[0].x + points[1].x) / 2;
      const centerY = (points[0].y + points[1].y) / 2;
      const px = this.pinchStart.centerX - rect.left;
      const py = this.pinchStart.centerY - rect.top;
      const worldX = (px - this.pinchStart.x) / this.pinchStart.zoom;
      const worldY = (py - this.pinchStart.y) / this.pinchStart.zoom;
      const zoom = clamp(this.pinchStart.zoom * factor, 0.08, 4);
      this.setView({ zoom, x: centerX - rect.left - worldX * zoom, y: centerY - rect.top - worldY * zoom }, false);
      return;
    }

    if (this.pointerMode.type === 'pan') {
      this.setView({
        ...this.activeBoard().view,
        x: this.pointerMode.x + event.clientX - this.pointerMode.startX,
        y: this.pointerMode.y + event.clientY - this.pointerMode.startY,
      }, false);
    } else if (this.pointerMode.type === 'move') {
      const zoom = this.activeBoard().view.zoom;
      const dx = (event.clientX - this.pointerMode.startX) / zoom;
      const dy = (event.clientY - this.pointerMode.startY) / zoom;
      for (const start of this.pointerMode.items) {
        const item = this.itemById(start.id);
        if (item) { item.x = start.x + dx; item.y = start.y + dy; }
      }
      this.renderItemPositions();
    } else if (this.pointerMode.type === 'resize') {
      const item = this.itemById(this.pointerMode.id);
      if (item) {
        const zoom = this.activeBoard().view.zoom;
        item.width = clamp(this.pointerMode.width + (event.clientX - this.pointerMode.startX) / zoom, item.type === 'frame' ? 260 : 90, 3000);
        item.height = clamp(this.pointerMode.height + (event.clientY - this.pointerMode.startY) / zoom, item.type === 'frame' ? 160 : 70, 3000);
        this.renderItemPositions();
      }
    } else if (this.pointerMode.type === 'lasso') {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const left = Math.min(this.pointerMode.left, x);
      const top = Math.min(this.pointerMode.top, y);
      const width = Math.abs(x - this.pointerMode.left);
      const height = Math.abs(y - this.pointerMode.top);
      const lasso = this.root.querySelector('.ib2-lasso');
      lasso.style.left = `${left}px`;
      lasso.style.top = `${top}px`;
      lasso.style.width = `${width}px`;
      lasso.style.height = `${height}px`;
    }
  }

  finishLasso(event) {
    const rect = this.canvas.getBoundingClientRect();
    const view = this.activeBoard().view;
    const x1 = (this.pointerMode.startX - rect.left - view.x) / view.zoom;
    const y1 = (this.pointerMode.startY - rect.top - view.y) / view.zoom;
    const x2 = (event.clientX - rect.left - view.x) / view.zoom;
    const y2 = (event.clientY - rect.top - view.y) / view.zoom;
    const selection = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    this.selectedIds = new Set(getVisibleItems(this.activeBoard())
      .filter(item => rectIntersects(selection, { x: item.x, y: item.y, width: item.width, height: item.type === 'frame' && item.collapsed ? 52 : item.height }))
      .map(item => item.id));
    const lasso = this.root.querySelector('.ib2-lasso');
    lasso.classList.remove('open');
    this.updateSelectionStyles();
  }

  handleDoubleTap(itemId, clientX, clientY) {
    const now = Date.now();
    const closeEnough = Math.hypot(clientX - this.lastTap.x, clientY - this.lastTap.y) < 42;
    if (now - this.lastTap.time < 360 && this.lastTap.itemId === itemId && closeEnough) {
      if (itemId) this.focusItem(this.itemById(itemId));
      else this.fitBoard();
      this.lastTap = { time: 0, itemId: null, x: 0, y: 0 };
    } else {
      this.lastTap = { time: now, itemId, x: clientX, y: clientY };
    }
  }

  onPointerUp(event) {
    this.cancelLongPress();
    this.activePointers.delete(event.pointerId);
    const mode = this.pointerMode;
    if (!mode) return;

    if (mode.type === 'move' && mode.moved) {
      const ids = mode.items.map(entry => entry.id).filter(id => {
        const item = this.itemById(id);
        return item?.type !== 'frame' && !mode.movedFrameIds?.has(item?.frameId);
      });
      assignItemsToFrames(this.activeBoard(), ids);
      this.activeBoard().updatedAt = Date.now();
      this.scheduleSave();
      this.renderItems();
    } else if (mode.type === 'resize' && mode.moved) {
      this.activeBoard().updatedAt = Date.now();
      this.scheduleSave();
      this.renderMinimap();
    } else if (mode.type === 'pan' && mode.moved) {
      this.scheduleSave();
    } else if (mode.type === 'lasso') {
      this.finishLasso(event);
    } else if (!mode.longPressed && !mode.moved) {
      this.handleDoubleTap(mode.downItemId || mode.itemId || null, event.clientX, event.clientY);
    }

    if (this.activePointers.size < 2) this.pinchStart = null;
    if (this.activePointers.size === 0) this.pointerMode = null;
  }

  async onPaste(event) {
    if (!this.isOpen) return;
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      await this.ingestFiles(files);
    }
  }

  onKeyDown(event) {
    if (!this.isOpen) return;
    const modal = this.root?.querySelector('.ib2-modal');
    const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (event.key === 'Escape') {
      if (modal) this.closeModal();
      else if (this.contextItemId) this.closeContextMenu();
      else this.closeBoard();
    } else if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      void this.deleteSelected();
    } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
    } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.duplicateSelected();
    } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selectedIds = new Set(getVisibleItems(this.activeBoard()).map(item => item.id));
      this.updateSelectionStyles();
    }
  }

  onPopState() {
    if (this.isOpen) this.closeBoard({ fromPop: true });
  }

  showModal(title, content, className = '') {
    this.closeModal();
    const modal = document.createElement('div');
    modal.className = `ib2-modal ${className}`;
    modal.innerHTML = `<div class="ib2-modal-card"><header><h2>${escapeHtml(title)}</h2><button data-modal-close aria-label="Close">×</button></header><div class="ib2-modal-body">${content}</div></div>`;
    this.root.querySelector('.ib2-modal-host').appendChild(modal);
    modal.querySelector('[data-modal-close]').onclick = () => modal.remove();
    requestAnimationFrame(() => modal.classList.add('open'));
    return modal;
  }

  closeModal() {
    this.root?.querySelector('.ib2-modal')?.remove();
  }

  showProgressModal(title, message) {
    let modal = null;
    const api = {
      open: (nextTitle = title, nextMessage = message) => {
        modal?.remove();
        modal = this.showModal(nextTitle, `<div class="ib2-progress"><div class="ib2-spinner"></div><p data-progress-message>${escapeHtml(nextMessage)}</p></div>`, 'ib2-progress-modal');
        modal.querySelector('[data-modal-close]').style.display = 'none';
      },
      update: nextMessage => {
        const element = modal?.querySelector('[data-progress-message]');
        if (element) element.textContent = nextMessage;
      },
      close: () => { modal?.remove(); modal = null; },
    };
    api.open(title, message);
    return api;
  }

  openBoard() {
    if (!this.root) this.buildUi();
    this.autoSelectLinkedBoard();
    this.isOpen = true;
    this.root.classList.add('open');
    document.documentElement.classList.add('ib2-open');
    document.body.classList.add('ib2-open');
    this.render();
    document.addEventListener('paste', this.boundPaste);
    document.addEventListener('keydown', this.boundKeydown);
    window.addEventListener('popstate', this.boundPopstate);
    if (!history.state?.__inspirationBoardV2) history.pushState({ ...(history.state || {}), __inspirationBoardV2: true }, '', location.href);
    setTimeout(() => this.canvas.focus(), 0);
  }

  closeBoard({ fromPop = false } = {}) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root?.classList.remove('open');
    document.documentElement.classList.remove('ib2-open');
    document.body.classList.remove('ib2-open');
    this.closeContextMenu();
    this.closeModal();
    this.saveStateNow();
    document.removeEventListener('paste', this.boundPaste);
    document.removeEventListener('keydown', this.boundKeydown);
    window.removeEventListener('popstate', this.boundPopstate);
    if (!fromPop && history.state?.__inspirationBoardV2) {
      this.closingFromPop = true;
      history.back();
      setTimeout(() => { this.closingFromPop = false; }, 300);
    }
  }
}

const app = new InspirationBoardApp();

export function openBoard() {
  app.openBoard();
}

export function closeBoard() {
  app.closeBoard();
}

export function getApp() {
  return app;
}

export const version = VERSION;
