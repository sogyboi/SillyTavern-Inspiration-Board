export const ROLE_OPTIONS = ['general', 'face', 'outfit', 'hair', 'accessory', 'mood'];

export function uid(prefix = 'id') {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return `${prefix}-${cryptoObj.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function makeBoard(name = 'New Character') {
  return {
    id: uid('board'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    view: { x: 0, y: 0, zoom: 1 },
    items: [],
    character: {
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
      referenceIds: []
    }
  };
}

export function makeImageItem({ imageId, name = 'Image', width = 280, height = 380, x = 0, y = 0 }) {
  return {
    id: uid('item'),
    type: 'image',
    imageId,
    name,
    x,
    y,
    width,
    height,
    role: 'general',
    tags: [],
    collection: '',
    locked: false,
    createdAt: Date.now()
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
    locked: false,
    createdAt: Date.now()
  };
}

export function staggerPositions(count, centerX = 0, centerY = 0) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const gapX = 40;
  const gapY = 40;
  const cardW = 280;
  const cardH = 360;
  const rows = Math.ceil(count / cols);
  const totalW = cols * cardW + (cols - 1) * gapX;
  const totalH = rows * cardH + (rows - 1) * gapY;
  const startX = centerX - totalW / 2;
  const startY = centerY - totalH / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index % cols) * (cardW + gapX),
    y: startY + Math.floor(index / cols) * (cardH + gapY)
  }));
}

export function fitItems(items, viewportWidth, viewportHeight, padding = 80) {
  if (!items.length) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...items.map(i => i.x));
  const minY = Math.min(...items.map(i => i.y));
  const maxX = Math.max(...items.map(i => i.x + i.width));
  const maxY = Math.max(...items.map(i => i.y + i.height));
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const zoom = clamp(Math.min((viewportWidth - padding * 2) / contentW, (viewportHeight - padding * 2) / contentH), 0.15, 2.5);
  const centerX = minX + contentW / 2;
  const centerY = minY + contentH / 2;
  return {
    zoom,
    x: viewportWidth / 2 - centerX * zoom,
    y: viewportHeight / 2 - centerY * zoom
  };
}

export function normalizeState(input) {
  const state = input && typeof input === 'object' ? structuredClone(input) : {};
  if (!Array.isArray(state.boards)) state.boards = [];
  if (!state.boards.length) state.boards.push(makeBoard('My Character'));
  if (!state.activeBoardId || !state.boards.some(b => b.id === state.activeBoardId)) state.activeBoardId = state.boards[0].id;
  if (!Array.isArray(state.collections)) state.collections = [];
  if (!Array.isArray(state.trash)) state.trash = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  state.settings = { confirmDelete: false, ...state.settings };
  for (const board of state.boards) {
    board.items ??= [];
    board.view ??= { x: 0, y: 0, zoom: 1 };
    board.character ??= makeBoard().character;
    board.character.referenceIds ??= [];
    for (const item of board.items) {
      item.tags ??= [];
      item.collection ??= '';
      item.locked ??= false;
      if (item.type === 'image' && !ROLE_OPTIONS.includes(item.role)) item.role = 'general';
    }
  }
  return state;
}

export function duplicateItem(item, offset = 36) {
  const copy = structuredClone(item);
  copy.id = uid(item.type === 'note' ? 'note' : 'item');
  copy.x += offset;
  copy.y += offset;
  copy.createdAt = Date.now();
  return copy;
}
