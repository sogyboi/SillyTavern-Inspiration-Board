import test from 'node:test';
import assert from 'node:assert/strict';
import { characterFromContext, groupCharacters, settingsWithDefaults, referenceImages, buildProviderRequest, validateRequest } from '../server-plugin/character-gallery-api/core.mjs';
import { normalizeOpenRouter, normalizeVenice, openRouterPrice, priceLabel } from '../server-plugin/character-gallery-api/models.mjs';
import { DATA } from './harness.mjs';

test('character zero is valid, names do not define identity, and groups require an explicit member', () => {
    const ctx = { characterId: 0, characters: [{ name: 'Same', avatar: 'one.png' }, { name: 'Same', avatar: 'two.png' }] };
    assert.equal(characterFromContext(ctx).avatar, 'one.png');
    ctx.characterId = 1; assert.equal(characterFromContext(ctx).avatar, 'two.png');
    ctx.groupId = 'g'; ctx.groups = [{ id: 'g', members: ['two.png'] }];
    assert.equal(characterFromContext(ctx), null); assert.equal(groupCharacters(ctx)[0].avatar, 'two.png');
});
test('selected references retain explicit order; auto uses main only when no selection exists', () => {
    const g = { images: [{ id: 'one' }, { id: 'two' }], mainImageId: 'one' };
    assert.deepEqual(referenceImages(g, settingsWithDefaults({ selectedIds: ['two', 'one'] })).map(i => i.id), ['two', 'one']);
    assert.deepEqual(referenceImages(g, settingsWithDefaults()).map(i => i.id), ['one']);
});
test('image-token and megapixel prices are not falsely labeled as flat picture prices', () => {
    const ep = rows => [{ pricing: rows }];
    assert.equal(priceLabel(openRouterPrice(ep([{ billable: 'output_image', unit: 'image', cost_usd: .04 }]))), '$0.04/img');
    assert.equal(priceLabel(openRouterPrice(ep([{ billable: 'output_image', unit: 'megapixel', cost_usd: .03 }]))), 'from $0.03/MP');
    assert.match(priceLabel(openRouterPrice(ep([{ billable: 'output_image', unit: 'token', cost_usd: .00001 }]))), /variable/);
    assert.equal(openRouterPrice(ep([{ billable: 'output_image', unit: 'image', cost_usd: null }])).min, null);
});
test('Venice respects live maxInputImages and does not infer refs from a price entry', () => {
    const m = normalizeVenice({ id: 'edit', type: 'inpaint', model_spec: { capabilities: { maxInputImages: 8 }, traits: {} } });
    assert.equal(m.refs.max, 8);
    assert.equal(normalizeVenice({ id: 'edit', type: 'inpaint', model_spec: { pricing: { additional_image: { usd: .1 } } } }).refs.max, 1);
    assert.equal(normalizeVenice({ id: 'plain', type: 'image' }).refs.max, 0);
});
test('OpenRouter sends exact original data URLs and reference-unaware models fail closed', () => {
    const model = normalizeOpenRouter({ id: 'm', supported_parameters: { input_references: { min: 0, max: 2 } } });
    const s = settingsWithDefaults({ prompt: 'Keep the same character', referenceMode: 'selected', selectedIds: ['i'] });
    const request = buildProviderRequest(model, s, [DATA]);
    assert.equal(request.body.input_references[0].image_url.url, DATA);
    assert.throws(() => buildProviderRequest(normalizeOpenRouter({ id: 'plain' }), s, [DATA]), /cannot use reference/);
    assert.throws(() => validateRequest(model, s, []), /missing/);
});
test('Venice edit field names and first-image order match each endpoint', () => {
    const model = normalizeVenice({ id: 'edit', type: 'inpaint', model_spec: { capabilities: { maxInputImages: 3 } } });
    const s = settingsWithDefaults({ provider: 'venice', prompt: 'Change jacket', referenceMode: 'auto' });
    const single = buildProviderRequest(model, s, [DATA]);
    assert.equal(single.path, '/image/edit'); assert.equal(single.body.model, 'edit'); assert.equal(single.body.modelId, undefined);
    const multi = buildProviderRequest(model, s, [DATA, DATA]);
    assert.equal(multi.path, '/image/multi-edit'); assert.equal(multi.body.modelId, 'edit'); assert.equal(multi.body.images[0], DATA.split(',')[1]);
    assert.throws(() => buildProviderRequest(model, s, [DATA, DATA, DATA, DATA]), /at most 3/);
});
