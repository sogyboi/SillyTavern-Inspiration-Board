import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orderVeniceReferenceItems, veniceEditReferenceLimit } from '../venice-gen-v61.js';

const ui = fs.readFileSync(new URL('../venice-gen-v61.js', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/venice-media-v61.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const img = (id, role = 'general') => ({ id, imageId: id, type: 'image', role, name: id });

test('v0.6.1 release is the reference-integrity launcher', () => {
  assert.equal(manifest.version, '0.6.1');
  assert.equal(manifest.js, 'launcher-v61.js');
});

test('Auto reference ordering uses Main portrait as base before basket refs', () => {
  const main = img('main', 'general');
  const hair = img('hair', 'hair');
  const face = img('face', 'face');
  assert.deepEqual(orderVeniceReferenceItems({ selected: [], basket: [hair, face], main, source: 'auto' }).map(x => x.imageId), ['main', 'face', 'hair']);
});

test('explicit selection remains authoritative and main only moves first when selected', () => {
  const main = img('main');
  const a = img('a', 'outfit');
  const b = img('b', 'face');
  assert.deepEqual(orderVeniceReferenceItems({ selected: [a, b], basket: [], main, source: 'auto' }).map(x => x.imageId), ['a', 'b']);
  assert.deepEqual(orderVeniceReferenceItems({ selected: [a, main, b], basket: [], main, source: 'auto' }).map(x => x.imageId), ['main', 'a', 'b']);
});

test('edit reference limits avoid accidental multi-edit on single-image models', () => {
  assert.equal(veniceEditReferenceLimit({ _kind: 'image', id: 'lustify-v8', model_spec: {} }), 0);
  assert.equal(veniceEditReferenceLimit({ _kind: 'inpaint', id: 'single-edit', model_spec: { capabilities: { supportsMultipleImages: false } } }), 1);
  assert.equal(veniceEditReferenceLimit({ _kind: 'inpaint', id: 'multi-edit', model_spec: { capabilities: { supportsMultipleImages: true } } }), 3);
  assert.equal(veniceEditReferenceLimit({ _kind: 'inpaint', id: 'grok-imagine-edit', model_spec: {} }), 3);
});

test('Generation models visibly disable refs instead of implying they are sent', () => {
  assert.match(ui, /References NOT sent for this model/);
  assert.match(ui, /Venice text-to-image generation uses \/image\/generate/);
  assert.match(ui, /refSource\.disabled = true/);
  assert.match(ui, /needsRefs = modelTask === 'edit'/);
});

test('Edit models expose a visible reference plan and send originals', () => {
  assert.match(ui, /Reference ACTIVE/);
  assert.match(ui, /Base:/);
  assert.match(ui, /blobToDataUrl\(record\.blob\)/);
  assert.match(ui, /reference receipt:/);
});

test('single edit uses current model field and multi-edit keeps modelId', () => {
  assert.match(bridge, /body: \{ \.\.\.editBody, model: editModel, image:/);
  assert.match(bridge, /body: \{ \.\.\.editBody, modelId: editModel, images:/);
  assert.match(bridge, /reference_received: true/);
  assert.match(bridge, /reference_count: references\.length/);
  assert.match(bridge, /reference_endpoint:/);
  assert.match(bridge, /reference_model_field:/);
});
