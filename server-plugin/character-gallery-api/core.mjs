import { uniqueIds, requestedReferenceIds } from './collections.mjs';
export const VERSION = '0.2.0';
export const ROLES = ['general', 'face', 'hair', 'body', 'outfit', 'pose', 'style', 'scene'];
export const DEFAULT_SETTINGS = Object.freeze({ provider: 'openrouter', referenceMode: 'auto', selectedIds: [], identityIds: [], referenceBaseId: '', referenceGuidance: '', activeReferenceSetId: '', favoriteModels: { openrouter: [], venice: [] }, prompt: '', negativePrompt: '', safeMode: true, providers: { openrouter: { model: '', aspect: '', resolution: '', quality: '', format: '', count: 1, seed: '' }, venice: { model: '', aspect: '', resolution: '', quality: '', format: 'webp', count: 1, seed: '' } } });
const validationError = message => Object.assign(new Error(message), { status: 400 });
export const copy = value => JSON.parse(JSON.stringify(value));
export function settingsWithDefaults(input = {}) {
    const result = copy(DEFAULT_SETTINGS);
    result.provider = ['openrouter', 'venice'].includes(input.provider) ? input.provider : 'openrouter';
    result.referenceMode = ['auto', 'main', 'selected', 'none'].includes(input.referenceMode) ? input.referenceMode : 'auto';
    result.selectedIds = Array.isArray(input.selectedIds) ? [...new Set(input.selectedIds.filter(x => typeof x === 'string'))].slice(0, 50) : [];
    result.referenceGuidance = String(input.referenceGuidance || '').slice(0, 2000);
    result.identityIds = uniqueIds(input.identityIds, 50);
    result.referenceBaseId = uniqueIds([input.referenceBaseId], 1)[0] || '';
    result.activeReferenceSetId = uniqueIds([input.activeReferenceSetId], 1)[0] || '';
    result.favoriteModels = {};
    for (const p of ['openrouter', 'venice']) result.favoriteModels[p] = Array.isArray(input.favoriteModels?.[p]) ? [...new Set(input.favoriteModels[p].filter(id => typeof id === 'string').map(id => id.slice(0, 200)))].slice(0, 100) : [];
    result.prompt = String(input.prompt || '').slice(0, 32000);
    result.negativePrompt = String(input.negativePrompt || '').slice(0, 2000);
    result.safeMode = input.safeMode !== false;
    result.providers = {};
    for (const p of ['openrouter', 'venice']) {
        const src = input.providers?.[p] || {}, dst = { ...DEFAULT_SETTINGS.providers[p] };
        for (const field of ['model', 'aspect', 'resolution', 'quality', 'format', 'seed']) dst[field] = String(src[field] ?? dst[field]).slice(0, field === 'model' ? 200 : 30);
        dst.count = Math.max(1, Math.min(8, Math.floor(Number(src.count) || 1)));
        result.providers[p] = dst;
    }
    return result;
}
export function characterFromContext(context, avatar) {
    const chars = context?.characters || [];
    const char = avatar ? chars.find(c => c?.avatar === avatar) : context?.groupId ? null : chars[context?.characterId];
    if (!char?.avatar) return null;
    return { avatar: String(char.avatar), name: String(char.name || 'Character'), description: String(char.description || char.data?.description || '') };
}
export function groupCharacters(context) {
    const group = context?.groups?.find(g => String(g.id) === String(context.groupId));
    return (group?.members || []).map(avatar => characterFromContext(context, avatar)).filter(Boolean);
}
export function referenceImages(gallery, settings) {
    return requestedReferenceIds(gallery, settings).map(id => gallery.images.find(i => i.id === id)).filter(Boolean);
}
export function validateRequest(model, settings, refs) {
    if (!model) throw validationError('Choose an available model.');
    if (!settings.prompt.trim()) throw validationError('Write a prompt first.');
    if (['selected', 'auto'].includes(settings.referenceMode)) {
        const expected = new Set([...(settings.identityIds || []), ...(settings.selectedIds || [])]);
        if (expected.size && (refs.length !== expected.size || [...expected].some(id => !refs.some(r => typeof r === 'string' || r.id === id)))) throw validationError('A selected reference is missing. Restore it or reselect your images before generating.');
    }
    if (['selected', 'main'].includes(settings.referenceMode) && !refs.length) throw validationError('No reference is selected for this reference mode. Choose an image or select None.');
    if (refs.length > model.refs.max) throw validationError(model.refs.max ? `This model accepts at most ${model.refs.max} references. Select fewer images.` : 'This model cannot use reference images. Choose a reference model, or set References to None.');
    if (refs.length < model.refs.min) throw validationError(`This model needs at least ${model.refs.min} reference image(s).`);
    const s = settings.providers[model.provider];
    if (s.count > model.params.maxCount) throw validationError(`This model allows ${model.params.maxCount} output image(s) per request.`);
    for (const [key, values] of [['aspect', model.params.aspects], ['resolution', model.params.resolutions], ['quality', model.params.qualities], ['format', model.params.formats]]) {
        if (s[key] && values.length && !values.includes(s[key])) throw validationError(`The selected ${key} is not supported by this model.`);
    }
    if (s.seed && (!Number.isSafeInteger(Number(s.seed)) || Number(s.seed) < 0 || Number(s.seed) > 2147483647)) throw validationError('Seed must be an integer between 0 and 2147483647, or blank.');
    return true;
}
/** refs must contain the original data URLs. Never truncate or silently discard references. */
export function buildProviderRequest(model, settings, refs) {
    validateRequest(model, settings, refs);
    const s = settings.providers[model.provider];
    const prompt = settings.prompt + (refs.length && settings.referenceGuidance ? `\n\nReference guidance:\n${settings.referenceGuidance}` : '');
    if (model.provider === 'openrouter') {
        const body = { model: model.id, prompt, n: s.count };
        if (refs.length) body.input_references = refs.map(url => ({ type: 'image_url', image_url: { url } }));
        for (const [key, target, supported] of [['aspect', 'aspect_ratio', model.params.aspects], ['resolution', 'resolution', model.params.resolutions], ['quality', 'quality', model.params.qualities], ['format', 'output_format', model.params.formats]]) if (s[key] && supported.length) body[target] = s[key];
        if (s.seed && model.params.seed) body.seed = Number(s.seed);
        if (settings.negativePrompt && model.params.negative) body.negative_prompt = settings.negativePrompt;
        return { path: '/images', body };
    }
    const body = { prompt, safe_mode: settings.safeMode };
    if (s.aspect && model.params.aspects.length) body.aspect_ratio = s.aspect;
    if (s.resolution && model.params.resolutions.length) body.resolution = s.resolution;
    if (s.quality && model.params.qualities.length) body.quality = s.quality;
    if (model.kind === 'edit') {
        body.output_format = s.format || 'webp';
        if (refs.length === 1) { body.model = model.id; body.image = refs[0].split(',')[1]; return { path: '/image/edit', body }; }
        body.modelId = model.id; body.images = refs.map(url => url.split(',')[1]);
        return { path: '/image/multi-edit', body };
    }
    body.model = model.id; body.variants = s.count; body.format = s.format || 'webp';
    if (settings.negativePrompt) body.negative_prompt = settings.negativePrompt;
    if (s.seed) body.seed = Number(s.seed);
    return { path: '/image/generate', body };
}
