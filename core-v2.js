export const STATE_VERSION = 2;

export const ROLE_OPTIONS = [
  'general',
  'face',
  'hair',
  'body',
  'outfit',
  'expression',
  'accessory',
  'prop',
  'mood',
  'environment',
];

export const ROLE_LABELS = Object.freeze({
  general: 'General',
  face: 'Face',
  hair: 'Hair',
  body: 'Body',
  outfit: 'Outfit',
  expression: 'Expression',
  accessory: 'Accessory',
  prop: 'Prop',
  mood: 'Mood / Vibe',
  environment: 'Environment',
});

export const FRAME_COLORS = ['purple', 'blue', 'green', 'gold', 'rose', 'slate'];

export function uid(prefix = 'id') {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return `${prefix}-${cryptoObj.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function emptyReferenceMap() {
  return Object.fromEntries(ROLE_OPTIONS.map(role => [role, []]));
}

export function makeCharacterData() {
  return {
    name: '',
    description: '',
    personality: '',
    scenario: '',
    first_message: '',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    tags: '',
    mainImageId: null,
    references: emptyReferenceMap(),
    linkedCharacter: null,
    aiDraft: null,
  };
}

export function makeBoard(name = 'New Character', template = 'blank') {
  const board = {
    id: uid('board'),
    name,
    template,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    view: { x: 0, y: 0, zoom: 1 },
    interactionMode: 'pan',
    canvasOnly: false,
    items: [],
    inbox: [],
    character: makeCharacterData(),
  };
  if (template !== 'blank') board.items.push(...makeTemplateFrames(template));
  return board;
}

export function makeImageItem({
  imageId,
  name = 'Image',
  width = 280,
  height = 380,
  x = 0,
  y = 0,
  role = 'general',
  sourceUrl = '',
}) {
  return {
    id: uid('item'),
    type: 'image',
    imageId,
    name,
    x,
    y,
    width,
    height,
    role: ROLE_OPTIONS.includes(role) ? role : 'general',
    tags: [],
    collection: '',
    frameId: null,
    locked: false,
    favorite: false,
    rating: 0,
    sourceUrl,
    notes: '',
    rotation: 0,
    flipX: false,
    flipY: false,
    crop: { zoom: 1, focalX: 50, focalY: 50 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function makeInboxEntry({
  imageId,
  name = 'Image',
  role = 'general',
  sourceUrl = '',
  favorite = false,
  rating = 0,
}) {
  return {
    id: uid('inbox'),
    imageId,
    name,
    role: ROLE_OPTIONS.includes(role) ? role : 'general',
    tags: [],
    collection: '',
    favorite,
    rating: clamp(Number(rating) || 0, 0, 5),
    sourceUrl,
    notes: '',
    duplicateOf: null,
    createdAt: Date.now(),
  };
}

export function makeNoteItem({ text = 'New note', x = 0, y = 0 }) {
  return {
    id: uid('note'),
    type: 'note',
    text,
    x,
    y,
    width: 240,
    height: 160,
    tags: [],
    collection: '',
    frameId: null,
    locked: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function makeFrameItem({
  title = 'Reference Group',
  x = 0,
  y = 0,
  width = 720,
  height = 520,
  color = 'purple',
}) {
  return {
    id: uid('frame'),
    type: 'frame',
    title,
    x,
    y,
    width,
    height,
    color: FRAME_COLORS.includes(color) ? color : 'purple',
    collapsed: false,
    locked: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function makeTemplateFrames(template = 'character') {
  if (template === 'blank') return [];
  if (template === 'compact') {
    return [
      makeFrameItem({ title: 'Main Look', x: -520, y: -390, width: 1000, height: 720, color: 'purple' }),
      makeFrameItem({ title: 'Mood & Setting', x: 520, y: -390, width: 760, height: 720, color: 'blue' }),
      makeFrameItem({ title: 'Extras', x: -520, y: 390, width: 1800, height: 540, color: 'gold' }),
    ];
  }
  return [
    makeFrameItem({ title: 'Face', x: -1120, y: -820, width: 680, height: 620, color: 'purple' }),
    makeFrameItem({ title: 'Hair', x: -390, y: -820, width: 680, height: 620, color: 'rose' }),
    makeFrameItem({ title: 'Outfit', x: 340, y: -820, width: 820, height: 620, color: 'green' }),
    makeFrameItem({ title: 'Body & Poses', x: -1120, y: -140, width: 850, height: 650, color: 'blue' }),
    makeFrameItem({ title: 'Expressions', x: -220, y: -140, width: 650, height: 650, color: 'gold' }),
    makeFrameItem({ title: 'Accessories & Props', x: 480, y: -140, width: 680, height: 650, color: 'slate' }),
    makeFrameItem({ title: 'Mood, Vibe & Environment', x: -1120, y: 570, width: 2280, height: 620, color: 'purple' }),
  ];
}

export function staggerPositions(count, centerX = 0, centerY = 0, cardW = 280, cardH = 360) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const gapX = 34;
  const gapY = 34;
  const rows = Math.ceil(count / cols);
  const totalW = cols * cardW + (cols - 1) * gapX;
  const totalH = rows * cardH + (rows - 1) * gapY;
  const startX = centerX - totalW / 2;
  const startY = centerY - totalH / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index % cols) * (cardW + gapX),
    y: startY + Math.floor(index / cols) * (cardH + gapY),
  }));
}

export function itemRect(item) {
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function rectIntersects(a, b) {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
}

export function rectContains(outer, inner, padding = 0) {
  return inner.x >= outer.x + padding
    && inner.y >= outer.y + padding
    && inner.x + inner.width <= outer.x + outer.width - padding
    && inner.y + inner.height <= outer.y + outer.height - padding;
}

export function getFrameMembers(board, frameId) {
  return board.items.filter(item => item.type !== 'frame' && item.frameId === frameId);
}

export function findContainingFrame(board, item, padding = 12) {
  if (item.type === 'frame') return null;
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;
  const frames = board.items
    .filter(candidate => candidate.type === 'frame' && !candidate.collapsed)
    .filter(frame => pointInRect(centerX, centerY, {
      x: frame.x + padding,
      y: frame.y + 44 + padding,
      width: Math.max(0, frame.width - padding * 2),
      height: Math.max(0, frame.height - 44 - padding * 2),
    }))
    .sort((a, b) => (a.width * a.height) - (b.width * b.height));
  return frames[0] || null;
}

export function assignItemsToFrames(board, itemIds) {
  const changed = [];
  for (const id of itemIds) {
    const item = board.items.find(entry => entry.id === id);
    if (!item || item.type === 'frame') continue;
    const frame = findContainingFrame(board, item);
    const nextId = frame?.id || null;
    if (item.frameId !== nextId) {
      item.frameId = nextId;
      item.updatedAt = Date.now();
      changed.push(item.id);
    }
  }
  return changed;
}

export function getVisibleItems(board) {
  const collapsed = new Set(board.items.filter(item => item.type === 'frame' && item.collapsed).map(item => item.id));
  return board.items.filter(item => item.type === 'frame' || !item.frameId || !collapsed.has(item.frameId));
}

export function getBounds(items, includeFrames = true) {
  const filtered = includeFrames ? items : items.filter(item => item.type !== 'frame');
  if (!filtered.length) return null;
  const minX = Math.min(...filtered.map(item => item.x));
  const minY = Math.min(...filtered.map(item => item.y));
  const maxX = Math.max(...filtered.map(item => item.x + item.width));
  const maxY = Math.max(...filtered.map(item => item.y + item.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function fitItems(items, viewportWidth, viewportHeight, padding = 80) {
  const bounds = getBounds(items);
  if (!bounds) return { x: 0, y: 0, zoom: 1 };
  const zoom = clamp(
    Math.min(
      Math.max(1, viewportWidth - padding * 2) / bounds.width,
      Math.max(1, viewportHeight - padding * 2) / bounds.height,
    ),
    0.08,
    2.5,
  );
  return {
    zoom,
    x: viewportWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: viewportHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

export function normalizeReferenceMap(value, items = []) {
  const refs = emptyReferenceMap();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const role of ROLE_OPTIONS) refs[role] = Array.isArray(value[role]) ? [...new Set(value[role])] : [];
  }
  const valid = new Set(items.filter(item => item.type === 'image').map(item => item.id));
  for (const role of ROLE_OPTIONS) refs[role] = refs[role].filter(id => valid.has(id));
  return refs;
}

function normalizeItem(item) {
  item.tags = Array.isArray(item.tags) ? item.tags : [];
  item.collection = typeof item.collection === 'string' ? item.collection : '';
  item.locked = Boolean(item.locked);
  item.frameId ??= null;
  item.width = clamp(Number(item.width) || (item.type === 'note' ? 240 : 280), 80, 3000);
  item.height = clamp(Number(item.height) || (item.type === 'note' ? 160 : 380), 60, 3000);
  item.x = Number(item.x) || 0;
  item.y = Number(item.y) || 0;
  item.updatedAt ??= item.createdAt ?? Date.now();
  if (item.type === 'image') {
    if (!ROLE_OPTIONS.includes(item.role)) item.role = 'general';
    item.favorite = Boolean(item.favorite);
    item.rating = clamp(Number(item.rating) || 0, 0, 5);
    item.sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl : '';
    item.notes = typeof item.notes === 'string' ? item.notes : '';
    item.rotation = ((Number(item.rotation) || 0) % 360 + 360) % 360;
    item.flipX = Boolean(item.flipX);
    item.flipY = Boolean(item.flipY);
    item.crop = {
      zoom: clamp(Number(item.crop?.zoom) || 1, 1, 4),
      focalX: clamp(Number(item.crop?.focalX) || 50, 0, 100),
      focalY: clamp(Number(item.crop?.focalY) || 50, 0, 100),
    };
  } else if (item.type === 'frame') {
    item.title = String(item.title || 'Reference Group');
    item.color = FRAME_COLORS.includes(item.color) ? item.color : 'purple';
    item.collapsed = Boolean(item.collapsed);
    delete item.frameId;
  } else if (item.type === 'note') {
    item.text = String(item.text || 'New note');
  }
  return item;
}

function migrateLegacyCharacter(character, items) {
  const next = { ...makeCharacterData(), ...(character || {}) };
  const legacyRefs = Array.isArray(character?.referenceIds) ? character.referenceIds : [];
  next.references = normalizeReferenceMap(character?.references, items);
  for (const id of legacyRefs) {
    const item = items.find(entry => entry.id === id && entry.type === 'image');
    if (!item) continue;
    const role = ROLE_OPTIONS.includes(item.role) ? item.role : 'general';
    if (!next.references[role].includes(id)) next.references[role].push(id);
  }
  delete next.referenceIds;
  const validIds = new Set(items.filter(item => item.type === 'image').map(item => item.id));
  if (!validIds.has(next.mainImageId)) next.mainImageId = null;
  return next;
}

export function normalizeState(input) {
  const state = input && typeof input === 'object' ? deepClone(input) : {};
  state.version = STATE_VERSION;
  if (!Array.isArray(state.boards)) state.boards = [];
  if (!state.boards.length) state.boards.push(makeBoard('My Character', 'blank'));
  if (!state.activeBoardId || !state.boards.some(board => board.id === state.activeBoardId)) state.activeBoardId = state.boards[0].id;
  if (!Array.isArray(state.collections)) state.collections = [];
  if (!Array.isArray(state.trash)) state.trash = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  state.settings = {
    confirmDelete: false,
    uploadDestination: 'inbox',
    removeInboxAfterPlace: true,
    toolbarPosition: 'left',
    autoSnapshotMinutes: 3,
    maxSnapshots: 10,
    autoOpenLinkedBoard: true,
    duplicateDistance: 7,
    aiMaxImages: 6,
    ...state.settings,
  };
  state.settings.maxSnapshots = clamp(Number(state.settings.maxSnapshots) || 10, 3, 30);
  state.settings.autoSnapshotMinutes = clamp(Number(state.settings.autoSnapshotMinutes) || 3, 1, 60);
  state.settings.duplicateDistance = clamp(Number(state.settings.duplicateDistance) || 7, 0, 20);
  state.settings.aiMaxImages = clamp(Number(state.settings.aiMaxImages) || 6, 1, 12);

  for (const board of state.boards) {
    board.id ||= uid('board');
    board.name = String(board.name || 'Character Board');
    board.template ||= 'blank';
    board.items = Array.isArray(board.items) ? board.items.map(normalizeItem) : [];
    board.inbox = Array.isArray(board.inbox) ? board.inbox : [];
    board.inbox = board.inbox.map(entry => ({
      ...makeInboxEntry({ imageId: entry.imageId, name: entry.name || 'Image' }),
      ...entry,
      role: ROLE_OPTIONS.includes(entry.role) ? entry.role : 'general',
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      favorite: Boolean(entry.favorite),
      rating: clamp(Number(entry.rating) || 0, 0, 5),
    }));
    board.view = {
      x: Number(board.view?.x) || 0,
      y: Number(board.view?.y) || 0,
      zoom: clamp(Number(board.view?.zoom) || 1, 0.08, 4),
    };
    board.interactionMode = board.interactionMode === 'select' ? 'select' : 'pan';
    board.canvasOnly = Boolean(board.canvasOnly);
    board.character = migrateLegacyCharacter(board.character, board.items);
    board.createdAt ??= Date.now();
    board.updatedAt ??= board.createdAt;

    const validFrames = new Set(board.items.filter(item => item.type === 'frame').map(item => item.id));
    for (const item of board.items) {
      if (item.type !== 'frame' && item.frameId && !validFrames.has(item.frameId)) item.frameId = null;
    }
  }
  return state;
}

export function duplicateItem(item, offset = 36) {
  const copy = deepClone(item);
  copy.id = uid(item.type === 'note' ? 'note' : item.type === 'frame' ? 'frame' : 'item');
  copy.x += offset;
  copy.y += offset;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  if (copy.type === 'frame') copy.title = `${copy.title} copy`;
  return copy;
}

export function allReferenceIds(character) {
  const ids = [];
  for (const role of ROLE_OPTIONS) ids.push(...(character?.references?.[role] || []));
  return [...new Set(ids)];
}

export function addReference(character, itemId, role = 'general') {
  if (!ROLE_OPTIONS.includes(role)) role = 'general';
  character.references = normalizeReferenceMap(character.references);
  for (const key of ROLE_OPTIONS) character.references[key] = character.references[key].filter(id => id !== itemId);
  character.references[role].push(itemId);
}

export function removeReference(character, itemId) {
  character.references = normalizeReferenceMap(character.references);
  for (const role of ROLE_OPTIONS) character.references[role] = character.references[role].filter(id => id !== itemId);
  if (character.mainImageId === itemId) character.mainImageId = null;
}

export function toggleReference(character, itemId, role = 'general') {
  const existingRole = ROLE_OPTIONS.find(key => character.references?.[key]?.includes(itemId));
  if (existingRole) {
    removeReference(character, itemId);
    return false;
  }
  addReference(character, itemId, role);
  return true;
}

export function createBoardFromTemplate(name, template = 'character') {
  return makeBoard(name, template);
}

export function sanitizeFilename(value, fallback = 'inspiration-board') {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

export function hammingDistanceHex(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let value = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (value) {
      distance += value & 1;
      value >>>= 1;
    }
  }
  return distance;
}

export function snapshotState(state) {
  const copy = deepClone(state);
  delete copy.transient;
  return copy;
}
