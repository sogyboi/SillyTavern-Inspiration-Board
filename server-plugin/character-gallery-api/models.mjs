/** Live provider metadata -> one honest image-model shape. No private keys here. */
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
export function venicePrice(model) {
    const spec = model.model_spec || {}, p = spec.pricing || {};
    const direct = model.type === 'inpaint' ? p.inpaint?.usd : p.generation?.usd;
    const tiers = [...allUsd(p.resolutions), ...allUsd(p.quality)];
    const prices = tiers.length ? tiers : number(direct) !== null ? [number(direct)] : [];
    return prices.length ? { min: Math.min(...prices), max: Math.max(...prices), unit: 'img', exact: Math.min(...prices) === Math.max(...prices), extra: /extra.*image|additional.*image/i.test(JSON.stringify(p)) } : null;
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
        created: number(raw.created) || 0, kind: 'image',
        refs: { min: max ? Math.max(0, number(ref.min) || 0) : 0, max, style: /style.reference|style.consistent/i.test(description) },
        params: { aspects: descriptor(p, 'aspect_ratio'), resolutions: descriptor(p, 'resolution'), qualities: descriptor(p, 'quality'), formats: descriptor(p, 'output_format'), maxCount: Math.max(1, Math.min(8, number(p.n?.max) || 1)), seed: Boolean(p.seed), negative: Boolean(p.negative_prompt) },
        uncensored: /\buncensored\b|\bnsfw\b/i.test(`${raw.name || ''} ${description}`),
        moderation: moderation === true ? 'Moderated' : moderation === false ? 'Unmoderated (not an NSFW guarantee)' : 'Moderation not specified',
        price: openRouterPrice(endpoints), raw,
    };
}
export function normalizeVenice(raw, traits = {}) {
    const spec = raw.model_spec || {}, c = spec.constraints || {}, cap = spec.capabilities || {};
    const edit = raw.type === 'inpaint';
    const declared = number(cap.maxInputImages ?? c.maxInputImages);
    // Unknown edit capability is restricted to a single source, never guessed from pricing.
    const max = edit ? Math.max(1, Math.min(16, declared ?? (cap.supportsMultipleImages === true ? 3 : 1))) : 0;
    const text = `${raw.id} ${spec.name || ''} ${spec.description || ''} ${strings(spec.traits).join(' ')}`;
    return {
        provider: 'venice', id: raw.id, name: spec.name || raw.id, description: spec.description || '',
        created: number(raw.created) || Date.parse(spec.modelSource || '') || 0,
        kind: edit ? 'edit' : 'image', refs: { min: edit ? 1 : 0, max, style: false },
        params: { aspects: strings(c.aspectRatios || c.aspect_ratios), resolutions: strings(c.resolutions), qualities: Object.keys(spec.pricing?.quality || {}), formats: ['webp', 'png', 'jpeg'], maxCount: edit ? 1 : Math.max(1, Math.min(4, number(c.maxVariants) || 4)), seed: !edit, negative: !edit },
        uncensored: /uncensored|\bnsfw\b/i.test(text) || traits.most_uncensored === raw.id,
        moderation: 'Provider/model policy applies', price: venicePrice(raw), raw,
    };
}
export function filteredModels(models, { search = '', referenceOnly = false, safety = 'all', sort = 'name' } = {}) {
    const term = search.trim().toLowerCase();
    const rows = models.filter(m => (!term || `${m.name} ${m.id} ${m.description}`.toLowerCase().includes(term)) && (!referenceOnly || m.refs.max > 0) && (safety !== 'uncensored' || m.uncensored) && (safety !== 'unmoderated' || m.moderation.startsWith('Unmoderated')));
    return rows.sort((a, b) => {
        if (sort === 'price') {
            const av = a.price?.unit === 'img' ? a.price.min ?? Infinity : Infinity;
            const bv = b.price?.unit === 'img' ? b.price.min ?? Infinity : Infinity;
            if (av !== bv) return av - bv;
        }
        if (sort === 'newest' && a.created !== b.created) return b.created - a.created;
        return a.name.localeCompare(b.name);
    });
}
