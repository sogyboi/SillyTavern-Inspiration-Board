import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { harness } from './harness.mjs';
import { filteredModels, normalizeVenice } from '../server-plugin/character-gallery-api/models.mjs';
import { settingsWithDefaults, validateRequest } from '../server-plugin/character-gallery-api/core.mjs';

test('Venice full catalog keeps every returned model type visible and marks non-image types view-only', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cgs-catalog-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
    const h = harness(root), res = await h.invoke('get', '/models/venice');
    assert.equal(res.code, 200);
    const models = res.data.models, types = new Set(models.map(m => m.catalogType));
    for (const type of ['image','inpaint','upscale','video','text','tts','asr','music','embedding']) assert.ok(types.has(type), `missing ${type}`);
    assert.equal(models.find(m => m.id === 'test-image').usable, true);
    assert.equal(models.find(m => m.id === 'test-edit').usable, true);
    assert.equal(models.find(m => m.id === 'test-upscale').usable, false);
    assert.equal(models.find(m => m.id === 'test-video').usable, false);
});

test('model-type filtering works without deleting view-only Venice catalog entries', () => {
    const rows = [
        normalizeVenice({ id: 'i', type: 'image', model_spec: { name: 'Image' } }),
        normalizeVenice({ id: 'e', type: 'inpaint', model_spec: { name: 'Edit' } }),
        normalizeVenice({ id: 'v', type: 'video', model_spec: { name: 'Video' } }),
    ];
    assert.deepEqual(filteredModels(rows, { type: 'video' }).map(m => m.id), ['v']);
    assert.deepEqual(filteredModels(rows, { type: 'all' }).map(m => m.id).sort(), ['e','i','v']);
});

test('view-only Venice catalog entries can be inspected but cannot be sent to image generation', () => {
    const model = normalizeVenice({ id: 'video', type: 'video', model_spec: { name: 'Video' } });
    const settings = settingsWithDefaults({ provider: 'venice', prompt: 'test', providers: { venice: { model: 'video' } } });
    assert.throws(() => validateRequest(model, settings, []), /shown for catalog completeness|not available/i);
});
