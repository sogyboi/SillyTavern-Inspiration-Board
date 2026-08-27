import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_OPTIONS,
  addReference,
  allReferenceIds,
  assignItemsToFrames,
  createBoardFromTemplate,
  findContainingFrame,
  getFrameMembers,
  getVisibleItems,
  hammingDistanceHex,
  makeBoard,
  makeFrameItem,
  makeImageItem,
  normalizeState,
  rectIntersects,
  removeReference,
  toggleReference,
} from '../core-v2.js';

test('legacy v1 referenceIds migrate into role-based reference basket', () => {
  const image = makeImageItem({ imageId: 'image-a', role: 'face' });
  const state = normalizeState({
    boards: [{
      id: 'board-a',
      name: 'Legacy',
      items: [image],
      view: { x: 0, y: 0, zoom: 1 },
      character: { referenceIds: [image.id], mainImageId: image.id },
    }],
    activeBoardId: 'board-a',
  });
  assert.deepEqual(state.boards[0].character.references.face, [image.id]);
  assert.equal(state.boards[0].character.mainImageId, image.id);
});

test('character template creates useful group frames', () => {
  const board = createBoardFromTemplate('Test', 'character');
  const titles = board.items.filter(item => item.type === 'frame').map(item => item.title);
  assert.ok(titles.includes('Face'));
  assert.ok(titles.includes('Outfit'));
  assert.ok(titles.some(title => title.includes('Mood')));
});

test('items are assigned to the smallest containing frame', () => {
  const board = makeBoard('Frames', 'blank');
  const large = makeFrameItem({ title: 'Large', x: 0, y: 0, width: 1000, height: 1000 });
  const small = makeFrameItem({ title: 'Small', x: 100, y: 100, width: 500, height: 500 });
  const image = makeImageItem({ imageId: 'image', x: 200, y: 220, width: 100, height: 100 });
  board.items.push(large, small, image);
  assert.equal(findContainingFrame(board, image)?.id, small.id);
  assignItemsToFrames(board, [image.id]);
  assert.equal(image.frameId, small.id);
  assert.deepEqual(getFrameMembers(board, small.id).map(item => item.id), [image.id]);
});

test('collapsed frame hides members but remains visible', () => {
  const board = makeBoard('Collapsed', 'blank');
  const frame = makeFrameItem({ x: 0, y: 0 });
  const image = makeImageItem({ imageId: 'image', x: 10, y: 70 });
  image.frameId = frame.id;
  frame.collapsed = true;
  board.items.push(frame, image);
  const visible = getVisibleItems(board);
  assert.deepEqual(visible.map(item => item.id), [frame.id]);
});

test('reference basket enforces one role per image', () => {
  const board = makeBoard('Refs', 'blank');
  const image = makeImageItem({ imageId: 'image', role: 'face' });
  board.items.push(image);
  addReference(board.character, image.id, 'face');
  assert.deepEqual(board.character.references.face, [image.id]);
  addReference(board.character, image.id, 'outfit');
  assert.deepEqual(board.character.references.face, []);
  assert.deepEqual(board.character.references.outfit, [image.id]);
  assert.deepEqual(allReferenceIds(board.character), [image.id]);
  assert.equal(toggleReference(board.character, image.id, 'outfit'), false);
  assert.deepEqual(allReferenceIds(board.character), []);
  addReference(board.character, image.id, ROLE_OPTIONS[0]);
  removeReference(board.character, image.id);
  assert.deepEqual(allReferenceIds(board.character), []);
});

test('rectangle intersection and dHash distance are stable', () => {
  assert.equal(rectIntersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 4, height: 4 }), true);
  assert.equal(rectIntersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 11, width: 2, height: 2 }), false);
  assert.equal(hammingDistanceHex('0000', '0000'), 0);
  assert.equal(hammingDistanceHex('0000', '0001'), 1);
  assert.equal(hammingDistanceHex('ffff', '0000'), 16);
});

test('normalization clamps settings and preserves inbox metadata', () => {
  const state = normalizeState({
    settings: { maxSnapshots: 999, autoSnapshotMinutes: 0, duplicateDistance: 99, aiMaxImages: 0 },
    boards: [{
      id: 'board-b', name: 'Inbox', items: [], view: { zoom: 99 },
      inbox: [{ id: 'inbox-a', imageId: 'image-a', name: 'A', role: 'outfit', favorite: true, rating: 9 }],
      character: {},
    }],
    activeBoardId: 'board-b',
  });
  assert.equal(state.settings.maxSnapshots, 30);
  assert.equal(state.settings.autoSnapshotMinutes, 3);
  assert.equal(state.settings.duplicateDistance, 20);
  assert.equal(state.settings.aiMaxImages, 6);
  assert.equal(state.boards[0].view.zoom, 4);
  assert.equal(state.boards[0].inbox[0].role, 'outfit');
  assert.equal(state.boards[0].inbox[0].favorite, true);
  assert.equal(state.boards[0].inbox[0].rating, 5);
});

test('compact and blank templates stay distinct', () => {
  const compact = createBoardFromTemplate('Compact', 'compact');
  const blank = createBoardFromTemplate('Blank', 'blank');
  assert.equal(compact.items.filter(item => item.type === 'frame').length, 3);
  assert.equal(blank.items.length, 0);
});

test('frame membership is cleared when its frame disappears', () => {
  const frame = makeFrameItem({ title: 'Temporary' });
  const image = makeImageItem({ imageId: 'image-x' });
  image.frameId = frame.id;
  const state = normalizeState({
    boards: [{ id: 'board-c', name: 'Broken frame', items: [image], view: {}, character: {} }],
    activeBoardId: 'board-c',
  });
  assert.equal(state.boards[0].items[0].frameId, null);
});
