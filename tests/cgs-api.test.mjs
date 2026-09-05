import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { harness, DATA, PNG, waitJob } from './harness.mjs';
import { settingsWithDefaults } from '../server-plugin/character-gallery-api/core.mjs';

async function setup(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cgs-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return { root, h: harness(root) }; }
async function open(h, avatar = 'Alice.png') { const r = await h.invoke('post', '/gallery/open', { avatar, name: 'Same name' }); assert.equal(r.code, 200); return r.data; }
async function upload(h, id, name = 'Original') { const r = await h.invoke('post', `/gallery/${id}/images`, { dataUrl: DATA, name, width: 1, height: 1 }, undefined, true); assert.equal(r.code, 200); return r.data.image; }
const genSettings = ids => settingsWithDefaults({ prompt: 'Keep reference identity', selectedIds: ids, referenceMode: 'selected', providers: { openrouter: { model: 'test/ref', count: 1 } } });

test('server-side galleries are isolated by avatar filename and by SillyTavern user', async t => {
    const { root, h } = await setup(t), a = await open(h), b = await open(h, 'Bob.png');
    assert.notEqual(a.id, b.id); await upload(h, a.id);
    assert.equal((await h.invoke('get', `/gallery/${b.id}`)).data.images.length, 0);
    assert.equal((await h.invoke('get', `/gallery/${a.id}`, {}, `${root}-other`)).code, 404);
    assert.equal((await h.invoke('get', '/status', {}, null)).code, 401);
    assert.equal((await h.invoke('get', '/gallery/%2Fetc%2Fpasswd')).code, 400);
});
test('concurrent uploads retain every original; private raw transport validates data', async t => {
    const { h } = await setup(t), g = await open(h);
    await Promise.all([upload(h, g.id, 'One'), upload(h, g.id, 'Two')]);
    const images = (await h.invoke('get', `/gallery/${g.id}`)).data.images; assert.equal(images.length, 2);
    const download = await h.invoke('get', `/gallery/${g.id}/image/${images[0].id}`);
    assert.equal(download.data.toString('base64'), PNG); assert.equal(download.headers['x-content-type-options'], 'nosniff');
    assert.equal((await h.invoke('post', `/gallery/${g.id}/images`, '{invalid', undefined, true)).code, 400);
    assert.equal((await h.invoke('post', `/gallery/${g.id}/images`, { dataUrl: 'data:image/png;base64,bm90IGFuIGltYWdl' })).code, 400);
});
test('settings and main reference persist across service instances without touching another character', async t => {
    const { h, root } = await setup(t), a = await open(h), b = await open(h, 'Bob.png'), image = await upload(h, a.id);
    await h.invoke('post', `/gallery/${a.id}/main`, { imageId: image.id });
    await h.invoke('patch', `/gallery/${a.id}/settings`, { settings: genSettings([image.id]) });
    const after = await harness(root).invoke('get', `/gallery/${a.id}`);
    assert.equal(after.data.mainImageId, image.id); assert.equal(after.data.settings.prompt, 'Keep reference identity');
    assert.equal((await h.invoke('get', `/gallery/${b.id}`)).data.settings.prompt, '');
});
test('real generation route forwards original refs, prevents duplicates and saves only to the job character', async t => {
    const { h } = await setup(t), a = await open(h), b = await open(h, 'Bob.png'), image = await upload(h, a.id);
    let release; h.provider.gate = new Promise(resolve => release = resolve);
    const first = await h.invoke('post', `/gallery/${a.id}/generate`, { settings: genSettings([image.id]) }); assert.equal(first.code, 202);
    const duplicate = await h.invoke('post', `/gallery/${a.id}/generate`, { settings: genSettings([image.id]) }); assert.equal(duplicate.code, 409);
    assert.equal((await h.invoke('delete', `/gallery/${a.id}/images`, { ids: [image.id] })).code, 409);
    release(); const result = await waitJob(h, a.id);
    assert.equal(result.jobs[0].status, 'done'); assert.equal(result.images.length, 2);
    assert.equal((await h.invoke('get', `/gallery/${b.id}`)).data.images.length, 0);
    assert.equal(h.provider.requests.length, 1); assert.equal(h.provider.requests[0].body.input_references[0].image_url.url, DATA);
    assert.equal(result.jobs[0].receipt.referenceCount, 1); assert.equal(result.jobs[0].receipt.originals[0].sha256, image.sha256);
    assert.equal(result.jobs[0].responseId, 'provider-response-1'); assert.ok(!JSON.stringify(result).includes('private-test-key'));
});
test('missing or unsupported reference selection does not send a paid request', async t => {
    const { h } = await setup(t), g = await open(h), settings = genSettings(['missing']);
    const r = await h.invoke('post', `/gallery/${g.id}/generate`, { settings });
    assert.equal(r.code, 400); assert.match(r.data.error, /missing/); assert.equal(h.provider.requests.length, 0);
});
test('finished images can be removed without deleting another gallery', async t => {
    const { h } = await setup(t), a = await open(h), b = await open(h, 'Bob.png'), image = await upload(h, a.id), other = await upload(h, b.id);
    await h.invoke('post', `/gallery/${a.id}/main`, { imageId: image.id });
    assert.equal((await h.invoke('post', `/gallery/${a.id}/main`, { imageId: other.id })).code, 404);
    await h.invoke('delete', `/gallery/${a.id}/images`, { ids: [image.id] });
    const after = (await h.invoke('get', `/gallery/${a.id}`)).data; assert.equal(after.images.length, 0); assert.equal(after.mainImageId, null);
    assert.equal((await h.invoke('get', `/gallery/${b.id}`)).data.images.length, 1);
});
test('Venice multi-edit route forwards all chosen sources in order', async t => {
    const { h } = await setup(t), g = await open(h), a = await upload(h, g.id), b = await upload(h, g.id);
    const s = settingsWithDefaults({ provider: 'venice', prompt: 'New jacket', selectedIds: [b.id, a.id], referenceMode: 'selected', providers: { venice: { model: 'test-edit' } } });
    const started = await h.invoke('post', `/gallery/${g.id}/generate`, { settings: s }); assert.equal(started.code, 202);
    const result = await waitJob(h, g.id); assert.equal(result.jobs[0].status, 'done');
    const sent = h.provider.requests[0]; assert.ok(sent.path.endsWith('/image/multi-edit')); assert.equal(sent.body.modelId, 'test-edit'); assert.equal(sent.body.images.length, 2);
    assert.deepEqual(result.jobs[0].receipt.originals.map(i => i.id), [b.id, a.id]);
});

test('interrupted jobs are not resubmitted after server restart', async t => {
    const { h, root } = await setup(t), gallery = await open(h);
    const file = path.join(root, 'character-gallery-studio', gallery.id, 'gallery.json');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    data.jobs = [{ id: 'old-job', status: 'sending', referenceIds: [], resultIds: [], createdAt: Date.now() }];
    await fs.writeFile(file, JSON.stringify(data));
    const restarted = harness(root), res = await restarted.invoke('get', `/gallery/${gallery.id}`);
    assert.equal(res.data.jobs[0].status, 'interrupted');
    assert.equal(restarted.provider.requests.length, 0);
});
