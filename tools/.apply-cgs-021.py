from pathlib import Path
import json, re


def replace(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        if new in s:
            return
        raise SystemExit(f'anchor missing in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, count))

models = r'''/** Live provider metadata -> one honest catalog/model shape. No private keys here. */
const number = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const strings = value => Array.isArray(value) ? value.map(String) : [];
const money = value => `$${value < .01 ? value.toFixed(4) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
export function priceLabel(price) {
    if (!price || price.min === null) return price?.label || 'Price unavailable';
    return `${price.exact ? '' : 'from '}${money(price.min)}/${price.unit}${price.extra ? ' + inputs' : ''}`;
}
export function openRouterPrice(endpoints = []) {
    const rows = endpoints.flatMap(e => Array.isArray(e.pricing) ? e.pricing : []);
    const output = rows.filter(row => row.billable === 'output_image' && number(row.cost_usd) !== null);
    const flat = output.filter(row => row.unit === 'image');
    const extra = rows.some(row => row.billable !== 'output_image' && (number(row.cost_usd) || 0) > 0);
    if (flat.length && flat.length === output.length) {
        const prices = flat.map(row => number(row.cost_usd));
        return { min: Math.min(...prices), max: Math.max(...prices), exact: Math.min(...prices) === Math.max(...prices), unit: 'img', extra };
    }
    const mp = output.filter(row => /megapixel|^mp$/i.test(row.unit));
    if (mp.length && mp.length === output.length) return { min: Math.min(...mp.map(row => number(row.cost_usd))), exact: false, unit: 'MP', extra };
    return { min: null, exact: false, unit: '', label: output.length ? 'Token / variable pricing' : 'Price unavailable' };
}
function allUsd(value) {
    if (!value || typeof value !== 'object') return [];
    if (number(value.usd) !== null) return [number(value.usd)];
    return Object.values(value).flatMap(allUsd);
}
function veniceVariableLabel(type) {
    if (type === 'video') return 'Variable video pricing';
    if (type === 'text') return 'Token pricing';
    if (type === 'tts') return 'Speech pricing';
    if (type === 'asr') return 'Transcription pricing';
    if (type === 'music') return 'Music pricing';
    if (type === 'embedding') return 'Embedding pricing';
    return 'Price unavailable';
}
export function venicePrice(model) {
    const spec = model.model_spec || {}, p = spec.pricing || {}, type = String(model.type || '').toLowerCase();
    const direct = type === 'inpaint' ? p.inpaint?.usd : type === 'upscale' ? p.upscale?.usd : type === 'image' ? p.generation?.usd : null;
    const tiers = [...allUsd(p.resolutions), ...allUsd(p.quality)];
    const prices = tiers.length ? tiers : number(direct) !== null ? [number(direct)] : [];
    if (prices.length) return { min: Math.min(...prices), max: Math.max(...prices), unit: type === 'upscale' ? 'upscale' : type === 'inpaint' ? 'edit' : 'img', exact: Math.min(...prices) === Math.max(...prices), extra: /extra.*image|additional.*image/i.test(JSON.stringify(p)) };
    return { min: null, exact: false, unit: '', label: veniceVariableLabel(type) };
}
function descriptor(values, key) { return strings(values?.[key]?.values); }
export function normalizeOpenRouter(raw, endpoints = [], chat = {}) {
    const p = raw.supported_parameters || {};
    const ref = p.input_references;
    const max = ref && ref !== false ? Math.max(0, Math.min(16, number(ref.max) ?? 1)) : 0;
    const description = String(raw.description || '');
    const moderation = chat.top_provider?.is_moderated;
    return {
        provider: 'openrouter', id: raw.id, name: raw.name || raw.id, description,
        created: number(raw.created) || 0, kind: 'image', catalogType: 'image', usable: true, usableReason: '',
        refs: { min: max ? Math.max(0, number(ref.min) || 0) : 0, max, style: /style.reference|style.consistent/i.test(description) },
        params: { aspects: descriptor(p, 'aspect_ratio'), resolutions: descriptor(p, 'resolution'), qualities: descriptor(p, 'quality'), formats: descriptor(p, 'output_format'), maxCount: Math.max(1, Math.min(8, number(p.n?.max) || 1)), seed: Boolean(p.seed), negative: Boolean(p.negative_prompt) },
        uncensored: /\buncensored\b|\bnsfw\b/i.test(`${raw.name || ''} ${description}`),
        moderation: moderation === true ? 'Moderated' : moderation === false ? 'Unmoderated (not an NSFW guarantee)' : 'Moderation not specified',
        price: openRouterPrice(endpoints), raw,
    };
}
export function normalizeVenice(raw, traits = {}) {
    const spec = raw.model_spec || {}, c = spec.constraints || {}, cap = spec.capabilities || {};
    const catalogType = String(raw.type || 'unknown').toLowerCase();
    const edit = catalogType === 'inpaint', generate = catalogType === 'image';
    const offline = spec.offline === true || raw.offline === true;
    const usable = (edit || generate) && !offline;
    const declared = number(cap.maxInputImages ?? c.maxInputImages);
    // Unknown edit capability is restricted to a single source, never guessed from pricing.
    const max = edit ? Math.max(1, Math.min(16, declared ?? (cap.supportsMultipleImages === true ? 3 : 1))) : 0;
    const text = `${raw.id} ${spec.name || ''} ${spec.description || ''} ${strings(spec.traits).join(' ')}`;
    const reason = usable ? '' : offline ? 'This model is currently offline in Venice.' : `Venice ${catalogType} model: shown for catalog completeness, but Character Gallery Studio currently sends image generation/edit requests only.`;
    return {
        provider: 'venice', id: raw.id, name: spec.name || raw.id, description: spec.description || '',
        created: number(raw.created) || Date.parse(spec.modelSource || '') || 0,
        kind: edit ? 'edit' : generate ? 'image' : catalogType, catalogType, usable, usableReason: reason,
        refs: { min: edit ? 1 : 0, max, style: false },
        params: usable ? { aspects: strings(c.aspectRatios || c.aspect_ratios), resolutions: strings(c.resolutions), qualities: Object.keys(spec.pricing?.quality || {}), formats: ['webp', 'png', 'jpeg'], maxCount: edit ? 1 : Math.max(1, Math.min(4, number(c.maxVariants) || 4)), seed: !edit, negative: !edit } : { aspects: [], resolutions: [], qualities: [], formats: [], maxCount: 1, seed: false, negative: false },
        uncensored: /uncensored|\bnsfw\b/i.test(text) || traits.most_uncensored === raw.id,
        moderation: 'Provider/model policy applies', price: venicePrice(raw), raw,
    };
}
export function filteredModels(models, { search = '', referenceOnly = false, safety = 'all', sort = 'name', type = 'all' } = {}) {
    const term = search.trim().toLowerCase(), wantedType = String(type || 'all').toLowerCase();
    const rows = models.filter(m => {
        const modelType = String(m.catalogType || m.kind || 'unknown').toLowerCase();
        return (!term || `${m.name} ${m.id} ${m.description} ${modelType}`.toLowerCase().includes(term)) &&
            (wantedType === 'all' || modelType === wantedType) &&
            (!referenceOnly || m.refs.max > 0) &&
            (safety !== 'uncensored' || m.uncensored) &&
            (safety !== 'unmoderated' || m.moderation.startsWith('Unmoderated'));
    });
    return rows.sort((a, b) => {
        if (sort === 'price') {
            const av = ['img', 'edit', 'upscale'].includes(a.price?.unit) ? a.price.min ?? Infinity : Infinity;
            const bv = ['img', 'edit', 'upscale'].includes(b.price?.unit) ? b.price.min ?? Infinity : Infinity;
            if (av !== bv) return av - bv;
        }
        if (sort === 'newest' && a.created !== b.created) return b.created - a.created;
        return a.name.localeCompare(b.name);
    });
}
'''
Path('server-plugin/character-gallery-api/models.mjs').write_text(models)

replace('server-plugin/character-gallery-api/core.mjs', "export const VERSION = '0.2.0';", "export const VERSION = '0.2.1';")
replace('server-plugin/character-gallery-api/core.mjs', "    if (!settings.prompt.trim()) throw validationError('Write a prompt first.');", "    if (model.usable === false) throw validationError(model.usableReason || 'This catalog model is not available in Character Gallery Studio image generation.');\n    if (!settings.prompt.trim()) throw validationError('Write a prompt first.');")

replace('server-plugin/character-gallery-api/index.mjs', """            if (provider === 'venice') {
                const [gen, editModels, traits] = await Promise.all([
                    request(provider, key, '/models?type=image').then(payload), request(provider, key, '/models?type=inpaint').then(payload),
                    request(provider, key, '/models/traits?type=image').then(payload).catch(() => ({})),
                ]);
                return [...(gen.data || []).map(m => normalizeVenice({ ...m, type: 'image' }, traits.data || {})), ...(editModels.data || []).map(m => normalizeVenice({ ...m, type: 'inpaint' }, traits.data || {}))];
            }""", """            if (provider === 'venice') {
                const [all, traits] = await Promise.all([
                    request(provider, key, '/models?type=all').then(payload),
                    request(provider, key, '/models/traits?type=image').then(payload).catch(() => ({})),
                ]);
                const seen = new Set();
                return (Array.isArray(all.data) ? all.data : []).filter(model => {
                    const id = String(model?.id || '');
                    if (!id || seen.has(id)) return false;
                    seen.add(id); return true;
                }).map(model => normalizeVenice(model, traits.data || {}));
            }""")

replace('index.js', "this.filters = { search: '', sort: 'name', safety: 'all', referenceOnly: false };", "this.filters = { search: '', sort: 'name', safety: 'all', referenceOnly: false, type: 'all' };")
replace('index.js', 'placeholder="Search image models…"', 'placeholder="Search provider models…"')
replace('index.js', '<div class="cgs-filter-row"><label class="cgs-check"><input type="checkbox" data-ref-only> Reference-capable only</label><select data-safety-filter aria-label="Model policy filter">', '<div class="cgs-filter-row"><select data-model-type aria-label="Model type"><option value="all">All model types</option><option value="image">Image generation</option><option value="inpaint">Image edit / references</option><option value="upscale">Upscale</option><option value="video">Video</option><option value="text">Text</option><option value="music">Music</option><option value="tts">Text to speech</option><option value="asr">Speech to text</option><option value="embedding">Embedding</option></select><label class="cgs-check"><input type="checkbox" data-ref-only> Reference-capable only</label><select data-safety-filter aria-label="Model policy filter">')
replace('index.js', "this.q('[data-model-sort]').onchange = e => { this.filters.sort = e.target.value; this.renderModelList(); };\n        this.q('[data-safety-filter]').onchange", "this.q('[data-model-sort]').onchange = e => { this.filters.sort = e.target.value; this.renderModelList(); };\n        this.q('[data-model-type]').onchange = e => { this.filters.type = e.target.value; this.renderModelList(); };\n        this.q('[data-safety-filter]').onchange")
replace('index.js', "dialog.querySelectorAll('[data-provider]').forEach(b => b.onclick = () => { this.settings.provider = b.dataset.provider; this.settingsChanged(); this.updateProviderButtons(); void this.loadModels(); });", "dialog.querySelectorAll('[data-provider]').forEach(b => b.onclick = () => { this.settings.provider = b.dataset.provider; this.filters.type = 'all'; const type = this.q('[data-model-type]'); if (type) type.value = 'all'; this.settingsChanged(); this.updateProviderButtons(); void this.loadModels(); });")
replace('index.js', "if (!this.settings.providers[provider].model && this.models.length) { this.settings.providers[provider].model = this.models[0].id; this.settingsChanged(); }", "const saved = this.settings.providers[provider].model;\n            if (!this.models.some(m => m.id === saved)) { const first = this.models.find(m => m.usable !== false) || this.models[0]; if (first) { this.settings.providers[provider].model = first.id; this.settingsChanged(); } }")

p = Path('index.js'); s = p.read_text()
start = s.index('    renderModelList() {')
end = s.index('    renderModel() {', start)
new_fn = r'''    renderModelList() {
        const selected = this.settings.providers[this.settings.provider].model, rows = this.library ? this.library.sortModels(filteredModels(this.models, this.filters)) : filteredModels(this.models, this.filters);
        const labels = { image: 'IMAGE', inpaint: 'EDIT / REF', upscale: 'UPSCALE', video: 'VIDEO', text: 'TEXT', music: 'MUSIC', tts: 'TTS', asr: 'ASR', embedding: 'EMBEDDING' };
        this.q('[data-models]').innerHTML = rows.length ? rows.map(m => {
            const usable = m.usable !== false, type = String(m.catalogType || m.kind || 'image').toLowerCase();
            const capability = usable ? (m.refs.max ? `${m.refs.min ? 'Requires' : 'Supports'} refs · max ${m.refs.max}` : 'Prompt only') : `View only · ${labels[type] || type.toUpperCase()}`;
            return `<button type="button" role="option" aria-selected="${m.id === selected}" aria-disabled="${!usable}" data-model="${esc(m.id)}" class="cgs-model-option ${m.id === selected ? 'active' : ''} ${!usable ? 'view-only' : ''}"><span><strong>${esc(m.name)}</strong><small><em class="cgs-model-type">${esc(labels[type] || type.toUpperCase())}</em> · ${esc(capability)}${m.uncensored ? ' · Uncensored / NSFW' : ''}</small></span><b>${esc(priceLabel(m.price))}</b></button>`;
        }).join('') : '<p>No models match these filters. Your previous selection is kept.</p>';
        this.q('[data-models]').querySelectorAll('[data-model]').forEach(b => b.onclick = () => { this.settings.providers[this.settings.provider].model = b.dataset.model; this.settingsChanged(); this.renderModelList(); this.renderModel(); });
        this.library?.decorateModels();
    }
'''
s = s[:start] + new_fn + s[end:]
p.write_text(s)

replace('index.js', "        if (!m) { this.q('[data-model-info]').textContent = 'Select a model from the live catalog.'; this.q('[data-params]').innerHTML = ''; this.renderRefs(); return; }", "        if (!m) { this.q('[data-model-info]').textContent = 'Select a model from the live catalog.'; this.q('[data-params]').innerHTML = ''; this.renderRefs(); return; }\n        if (m.usable === false) {\n            const type = String(m.catalogType || m.kind || 'unknown').toUpperCase();\n            this.q('[data-model-info]').innerHTML = `<strong>${esc(m.name)}</strong><div class=\"cgs-badges\"><span>${esc(type)}</span><span>View only</span><span>${esc(priceLabel(m.price))}</span></div><p>${esc(m.description)}</p><p class=\"cgs-warning\">${esc(m.usableReason)}</p>`;\n            this.q('[data-params]').innerHTML = ''; this.q('[data-negative-wrap]').hidden = true; this.q('[data-safe-wrap]').hidden = true; this.renderRefs(); this.renderEstimate(); return;\n        }")
replace('index.js', "this.q('[data-model-info]').innerHTML = `<strong>${esc(m.name)}</strong><div class=\"cgs-badges\"><span>${esc(priceLabel(m.price))}</span>", "this.q('[data-model-info]').innerHTML = `<strong>${esc(m.name)}</strong><div class=\"cgs-badges\"><span>${esc(String(m.catalogType || m.kind || 'image').toUpperCase())}</span><span>${esc(priceLabel(m.price))}</span>")
replace('index.js', "        const count = this.settings.providers[m.provider].count;\n        this.q('[data-estimate]').textContent =", "        if (m.usable === false) { this.q('[data-estimate]').textContent = 'Catalog entry only · not available in Character Gallery image generation.'; return; }\n        const count = this.settings.providers[m.provider].count;\n        this.q('[data-estimate]').textContent =")
replace('index.js', "        const button = this.q('[data-generate]'); if (!this.busy) { button.disabled = active.length > 0; button.textContent = active.length ? 'Generation running…' : 'Generate image'; }", "        const button = this.q('[data-generate]'), unsupported = this.model()?.usable === false; if (!this.busy) { button.disabled = active.length > 0 || unsupported; button.textContent = active.length ? 'Generation running…' : unsupported ? 'View-only model' : 'Generate image'; }")

Path('style.css').write_text(Path('style.css').read_text() + "\n.cgs-model-option.view-only{opacity:.72;border-style:dashed}.cgs-model-option.view-only:hover{opacity:.9}.cgs-model-type{font-style:normal;font-size:10px;letter-spacing:.05em;font-weight:800}\n")

# Test fixture now returns a realistic full Venice catalog when type=all is requested.
replace('tests/harness.mjs', """        if (u.pathname.endsWith('/traits')) return json({ data: {} });
        if (u.searchParams.get('type') === 'inpaint') return json({ data: [{ id: 'test-edit', model_spec: { name: 'Test Edit', capabilities: { maxInputImages: 3 }, pricing: { inpaint: { usd: .05 } } } }] });
        return json({ data: [{ id: 'test-image', model_spec: { name: 'Test Image', pricing: { generation: { usd: .01 } } } }] });""", """        if (u.pathname.endsWith('/traits')) return json({ data: {} });
        if (u.searchParams.get('type') === 'all') return json({ data: [
            { id: 'test-image', type: 'image', model_spec: { name: 'Test Image', pricing: { generation: { usd: .01 } } } },
            { id: 'test-edit', type: 'inpaint', model_spec: { name: 'Test Edit', capabilities: { maxInputImages: 3 }, pricing: { inpaint: { usd: .05 } } } },
            { id: 'test-upscale', type: 'upscale', model_spec: { name: 'Test Upscale', pricing: { upscale: { usd: .02 } } } },
            { id: 'test-video', type: 'video', model_spec: { name: 'Test Video' } },
            { id: 'test-text', type: 'text', model_spec: { name: 'Test Text' } },
            { id: 'test-tts', type: 'tts', model_spec: { name: 'Test TTS' } },
            { id: 'test-asr', type: 'asr', model_spec: { name: 'Test ASR' } },
            { id: 'test-music', type: 'music', model_spec: { name: 'Test Music' } },
            { id: 'test-embedding', type: 'embedding', model_spec: { name: 'Test Embedding' } },
        ] });
        if (u.searchParams.get('type') === 'inpaint') return json({ data: [{ id: 'test-edit', type: 'inpaint', model_spec: { name: 'Test Edit', capabilities: { maxInputImages: 3 }, pricing: { inpaint: { usd: .05 } } } }] });
        return json({ data: [{ id: 'test-image', type: 'image', model_spec: { name: 'Test Image', pricing: { generation: { usd: .01 } } } }] });""")

Path('tests/cgs-venice-catalog.test.mjs').write_text(r'''import test from 'node:test';
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
''')

# Release metadata/docs
for file in ['manifest.json', 'package.json', 'server-plugin/character-gallery-api/package.json']:
    p = Path(file); s = p.read_text(); p.write_text(s.replace('"version": "0.2.0"', '"version": "0.2.1"', 1))
replace('README.md', '**Release: 0.2.0.**', '**Release: 0.2.1.**')
replace('README.md', '## New in 0.2.0: organized galleries', '## New in 0.2.1: complete Venice model viewer\n\nVenice now loads its full live `type=all` catalog into the model viewer instead of requesting only generation and edit models. Every model Venice returns remains searchable and can be filtered by its real API type (image, inpaint/edit, upscale, video, text, TTS, ASR, music, or embedding). Image-generation and edit models remain selectable for paid image requests. Other Venice types are clearly marked **View only** and are blocked from the image endpoint, so catalog completeness cannot accidentally send a video/text/upscale model to the wrong API.\n\nThe viewer keeps price/policy metadata where Venice exposes it, includes type names in search, and never hard-codes a Venice model list, so newly added Venice models appear after the normal catalog cache refresh.\n\n## New in 0.2.0: organized galleries')
replace('README.md', '- Separate OpenRouter and Venice catalogs. Search, price-per-image sorting, reference-only filtering, and provider-policy labels.', '- Separate OpenRouter and Venice catalogs. Venice displays the full live catalog with model-type filtering; non-image types remain visible as view-only. Search, image-price sorting, reference-only filtering, and provider-policy labels remain available.')
Path('CHANGELOG.md').write_text("""## 0.2.1 — Complete Venice model catalog\n\n- Venice model discovery now requests the official full `type=all` live catalog rather than only `image` and `inpaint`.\n- The model viewer shows the actual Venice API type and can filter image, edit/inpaint, upscale, video, text, music, TTS, ASR and embedding models.\n- Non-image Venice models remain visible for discovery but are explicitly view-only and validation blocks them from Character Gallery's paid image endpoints.\n- Newly added Venice models no longer require extension code changes; the normal live catalog cache refresh picks them up.\n- Requires extension and `character-gallery-api` 0.2.1; rerun the existing Git-free installer and fully restart SillyTavern.\n\n""" + Path('CHANGELOG.md').read_text())

# Ensure core version is the same as manifest/package.
assert "export const VERSION = '0.2.1';" in Path('server-plugin/character-gallery-api/core.mjs').read_text()
