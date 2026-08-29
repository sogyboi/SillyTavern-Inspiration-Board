from pathlib import Path
import re
from textwrap import dedent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)


# ---------------- studio-core-v3.js ----------------
core_path = Path('studio-core-v3.js')
core = core_path.read_text()
core = replace_once(core, "export const STUDIO_VERSION = '0.3.0';", "export const STUDIO_VERSION = '0.5.7';", 'studio version')
old_price = dedent('''\
export function getModelImagePrice(metadata = {}) {
  const pricing = metadata?.pricing || metadata?.cost || {};
  const candidates = [
    pricing.image,
    pricing.images,
    pricing.request,
    pricing.output_image,
    pricing.image_output,
    metadata?.image_price,
    metadata?.price_per_image,
  ];
  for (const value of candidates) {
    const parsed = parsePriceNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}
''')
new_price = dedent('''\
export function getModelImagePrice(metadata = {}) {
  // Only treat a value as a literal per-generated-image price when we can prove its unit.
  // OpenRouter's general model catalog also exposes image/token rates that are NOT the
  // final price of one generated image, so those intentionally stay out of this helper.
  const summary = metadata?.priceSummary;
  if (summary?.exactFlat === true) {
    const exact = parsePriceNumber(summary.flatPerImage);
    if (exact !== null) return exact;
  }
  for (const value of [metadata?.image_price, metadata?.price_per_image]) {
    const parsed = parsePriceNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}
''')
core = replace_once(core, old_price, new_price, 'safe image price parser')
old_job = """    error: null,\n    fallbackLog: [],\n    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},\n"""
new_job = """    error: null,\n    fallbackLog: [],\n    progress: String(input.progress || ''),\n    progressPhase: input.progressPhase || 'queued',\n    dispatchedAt: input.dispatchedAt || null,\n    responseAt: input.responseAt || null,\n    lastHttpStatus: input.lastHttpStatus ?? null,\n    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},\n"""
core = replace_once(core, old_job, new_job, 'queue transport fields')
core_path.write_text(core)


# ---------------- studio-openrouter-v3.js ----------------
router_path = Path('studio-openrouter-v3.js')
router = router_path.read_text()
old_constants = """const PUBLIC_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=image';\nconst MODEL_CACHE_MS = 10 * 60_000;\nlet modelCache = null;\nlet modelCacheAt = 0;\n"""
new_constants = """const PUBLIC_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=image';\nconst IMAGE_MODELS_URL = 'https://openrouter.ai/api/v1/images/models';\nconst MODEL_CACHE_MS = 10 * 60_000;\nconst PRICE_CACHE_MS = 15 * 60_000;\nlet modelCache = null;\nlet modelCacheAt = 0;\nlet dedicatedCatalogCache = null;\nlet dedicatedCatalogAt = 0;\nconst endpointPricingCache = new Map();\n"""
router = replace_once(router, old_constants, new_constants, 'OpenRouter image API constants')

anchor = """async function fetchSillyTavernModels() {\n"""
pricing_helpers = dedent('''\
async function fetchDedicatedImageCatalog({ force = false } = {}) {
  if (!force && dedicatedCatalogCache && Date.now() - dedicatedCatalogAt < MODEL_CACHE_MS) return dedicatedCatalogCache;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(IMAGE_MODELS_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const data = await response.json();
    const rows = Array.isArray(data?.data) ? data.data.map(normalizeModelEntry) : [];
    dedicatedCatalogCache = rows;
    dedicatedCatalogAt = Date.now();
    return rows;
  } catch (error) {
    console.info('[Inspiration Board] OpenRouter dedicated image catalog unavailable; pricing will fall back gracefully.', error);
    return dedicatedCatalogCache || [];
  } finally {
    clearTimeout(timer);
  }
}

function endpointRows(payload) {
  if (Array.isArray(payload?.data?.endpoints)) return payload.data.endpoints;
  if (Array.isArray(payload?.endpoints)) return payload.endpoints;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === 'object') return [payload.data];
  if (payload && typeof payload === 'object' && Array.isArray(payload.pricing)) return [payload];
  return [];
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number < 0.01) return `$${number.toFixed(4)}`;
  return `$${number.toFixed(2)}`;
}

export function summarizeOpenRouterImagePricing(payload = {}) {
  const endpoints = endpointRows(payload);
  const lines = endpoints.flatMap(endpoint => Array.isArray(endpoint?.pricing) ? endpoint.pricing : []);
  const normalized = lines.map(line => ({
    billable: String(line?.billable || '').toLowerCase(),
    unit: String(line?.unit || '').toLowerCase(),
    cost: Number(line?.cost_usd),
    variant: line?.variant || line?.conditions || line?.tier || null,
  })).filter(line => Number.isFinite(line.cost) && line.cost >= 0);

  const isOutputImage = line => line.billable === 'output_image' || (line.billable.includes('output') && line.billable.includes('image'));
  const output = normalized.filter(isOutputImage);
  const request = normalized.filter(line => line.billable === 'request' && ['request', 'call'].includes(line.unit));
  const inputImages = normalized.filter(line => (line.billable === 'input_image' || (line.billable.includes('input') && line.billable.includes('image'))) && line.unit === 'image');
  const requestMin = request.length ? Math.min(...request.map(line => line.cost)) : 0;
  const requestMax = request.length ? Math.max(...request.map(line => line.cost)) : 0;
  const inputReferencePrice = inputImages.length ? Math.min(...inputImages.map(line => line.cost)) : null;
  const details = [];

  const flat = output.filter(line => line.unit === 'image');
  const megapixel = output.filter(line => ['megapixel', 'mp'].includes(line.unit));
  const token = output.filter(line => line.unit.includes('token'));
  const other = output.filter(line => !['image', 'megapixel', 'mp'].includes(line.unit) && !line.unit.includes('token'));

  if (flat.length) {
    const outputMin = Math.min(...flat.map(line => line.cost));
    const outputMax = Math.max(...flat.map(line => line.cost));
    const min = outputMin + requestMin;
    const max = outputMax + requestMax;
    const variable = Math.abs(max - min) > 1e-12 || megapixel.length > 0 || token.length > 0 || other.length > 0;
    const formattedMin = money(min);
    const formattedMax = money(max);
    if (variable && formattedMax && formattedMax !== formattedMin) details.push(`${formattedMin}–${formattedMax} per output image depending on provider, quality, or resolution.`);
    else details.push(`${formattedMin} per output image${requestMin ? ' including the minimum request fee' : ''}.`);
    if (megapixel.length) details.push(`Other endpoints bill by megapixel.`);
    if (token.length) details.push(`Other endpoints bill image output by token.`);
    if (inputReferencePrice !== null) details.push(`Reference-image input can add from ${money(inputReferencePrice)} per input image.`);
    return {
      kind: variable ? 'mixed' : 'image',
      unit: 'image',
      label: variable ? `from ${formattedMin}/img` : `${formattedMin}/img`,
      detail: details.join(' '),
      exactFlat: !variable,
      flatPerImage: !variable ? min : null,
      minimumPerImage: min,
      maximumPerImage: max,
      inputReferencePrice,
      variable,
      endpointCount: endpoints.length,
    };
  }

  if (megapixel.length) {
    const min = Math.min(...megapixel.map(line => line.cost));
    const max = Math.max(...megapixel.map(line => line.cost));
    details.push(`${money(min)}${max !== min ? `–${money(max)}` : ''} per megapixel; final cost depends on rendered resolution.`);
    if (inputReferencePrice !== null) details.push(`Reference-image input can add from ${money(inputReferencePrice)} per input image.`);
    return {
      kind: 'megapixel', unit: 'megapixel', label: `from ${money(min)}/MP`, detail: details.join(' '),
      exactFlat: false, flatPerImage: null, minimumPerImage: null, maximumPerImage: null,
      inputReferencePrice, variable: true, endpointCount: endpoints.length,
    };
  }

  if (token.length) {
    const min = Math.min(...token.map(line => line.cost));
    details.push(`Image output is token-priced (from ${money(min)} per image-output token); the final picture cost varies with the model and output.`);
    if (inputReferencePrice !== null) details.push(`Reference-image input can add from ${money(inputReferencePrice)} per input image.`);
    return {
      kind: 'token', unit: 'token', label: 'token-priced', detail: details.join(' '),
      exactFlat: false, flatPerImage: null, minimumPerImage: null, maximumPerImage: null,
      inputReferencePrice, variable: true, endpointCount: endpoints.length,
    };
  }

  if (output.length || request.length) {
    const units = [...new Set([...output, ...request].map(line => line.unit).filter(Boolean))];
    return {
      kind: 'variable', unit: units.join(',') || 'variable', label: 'price varies',
      detail: `OpenRouter reports variable image pricing${units.length ? ` (${units.join(', ')})` : ''}.`,
      exactFlat: false, flatPerImage: null, minimumPerImage: null, maximumPerImage: null,
      inputReferencePrice, variable: true, endpointCount: endpoints.length,
    };
  }

  return null;
}

export function formatOpenRouterImagePrice(summary) {
  return summary?.label || 'price unavailable';
}

async function fetchEndpointPricing(model) {
  const id = String(model?.id || '');
  if (!id) return null;
  const cached = endpointPricingCache.get(id);
  if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.summary;
  const endpointPath = model?.dedicatedImage?.endpoints || model?.endpoints;
  if (!endpointPath) return null;
  const url = new URL(endpointPath, 'https://openrouter.ai').href;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const summary = summarizeOpenRouterImagePricing(await response.json());
    endpointPricingCache.set(id, { at: Date.now(), summary });
    return summary;
  } catch (error) {
    console.info(`[Inspiration Board] Could not load exact OpenRouter image pricing for ${id}.`, error);
    return cached?.summary || null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichOpenRouterImagePricing(models = [], {
  selectedId = '',
  concurrency = 5,
  onUpdate = () => {},
} = {}) {
  const eligible = models.filter(model => model?.dedicatedImage?.endpoints);
  const ordered = [
    ...eligible.filter(model => model.id === selectedId),
    ...eligible.filter(model => model.id !== selectedId),
  ];
  let cursor = 0;
  let loaded = 0;
  const total = ordered.length;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, total)) }, async () => {
    while (cursor < ordered.length) {
      const index = cursor++;
      const model = ordered[index];
      model.pricingStatus = 'loading';
      onUpdate(model, { loaded, total });
      const summary = await fetchEndpointPricing(model);
      model.priceSummary = summary;
      model.imagePrice = summary?.exactFlat ? summary.flatPerImage : null;
      model.pricingStatus = summary ? 'ready' : 'unavailable';
      loaded += 1;
      onUpdate(model, { loaded, total });
    }
  });
  await Promise.all(workers);
  return models;
}

''')
router = replace_once(router, anchor, pricing_helpers + anchor, 'dedicated pricing helpers')

old_loader = dedent('''\
export async function loadOpenRouterModels({ force = false } = {}) {
  if (!force && modelCache && Date.now() - modelCacheAt < MODEL_CACHE_MS) return modelCache;
  const [basic, detailed] = await Promise.all([
    fetchSillyTavernModels(),
    fetchPublicModelMetadata(),
  ]);
  const detailMap = new Map(detailed.map(model => [model.id, model]));
  const merged = basic.map(model => {
    const metadata = detailMap.get(model.id);
    const mergedModel = normalizeModelEntry({ ...metadata, ...model, id: model.id });
    mergedModel.capabilities = inferModelCapabilities(model.id, metadata || model);
    mergedModel.imagePrice = getModelImagePrice(metadata || model);
    return mergedModel;
  });
  for (const model of detailed) {
    if (!merged.some(existing => existing.id === model.id)) {
      const normalized = normalizeModelEntry(model);
      normalized.capabilities = inferModelCapabilities(normalized.id, model);
      normalized.imagePrice = getModelImagePrice(model);
      merged.push(normalized);
    }
  }
  merged.sort((a, b) => a.name.localeCompare(b.name));
  modelCache = merged;
  modelCacheAt = Date.now();
  return merged;
}
''')
new_loader = dedent('''\
export async function loadOpenRouterModels({ force = false } = {}) {
  if (!force && modelCache && Date.now() - modelCacheAt < MODEL_CACHE_MS) return modelCache;
  const [basic, detailed, dedicated] = await Promise.all([
    fetchSillyTavernModels(),
    fetchPublicModelMetadata(),
    fetchDedicatedImageCatalog({ force }),
  ]);
  const detailMap = new Map(detailed.map(model => [model.id, model]));
  const dedicatedMap = new Map(dedicated.map(model => [model.id, model]));
  const decorate = model => {
    const dedicatedImage = dedicatedMap.get(model.id) || null;
    model.dedicatedImage = dedicatedImage;
    model.capabilities = inferModelCapabilities(model.id, dedicatedImage || detailMap.get(model.id) || model);
    const cached = endpointPricingCache.get(model.id);
    model.priceSummary = cached && Date.now() - cached.at < PRICE_CACHE_MS ? cached.summary : null;
    model.imagePrice = getModelImagePrice(model);
    model.pricingStatus = model.priceSummary ? 'ready' : (dedicatedImage?.endpoints ? 'idle' : 'unavailable');
    return model;
  };
  const merged = basic.map(model => {
    const metadata = detailMap.get(model.id);
    return decorate(normalizeModelEntry({ ...metadata, ...model, id: model.id }));
  });
  for (const model of detailed) {
    if (!merged.some(existing => existing.id === model.id)) merged.push(decorate(normalizeModelEntry(model)));
  }
  merged.sort((a, b) => a.name.localeCompare(b.name));
  modelCache = merged;
  modelCacheAt = Date.now();
  return merged;
}
''')
router = replace_once(router, old_loader, new_loader, 'model loader with dedicated catalog')

old_request_sig = "async function requestImage({ model, prompt, references, aspectRatio, signal }) {\n  const response = await fetch('/api/openrouter/image/generate', {"
new_request_sig = "async function requestImage({ model, prompt, references, aspectRatio, signal, onTransport = () => {} }) {\n  onTransport({ phase: 'sending', message: 'Sending request to SillyTavern…' });\n  const requestPromise = fetch('/api/openrouter/image/generate', {"
router = replace_once(router, old_request_sig, new_request_sig, 'request transport start')
old_fetch_end = """    }),\n  });\n  if (!response.ok) {\n"""
new_fetch_end = """    }),\n  });\n  const dispatchedAt = Date.now();\n  onTransport({ phase: 'dispatched', dispatchedAt, message: 'Request dispatched ✓ · waiting for OpenRouter…' });\n  const response = await requestPromise;\n  const responseAt = Date.now();\n  onTransport({ phase: 'response', responseAt, httpStatus: response.status, message: `OpenRouter response received · HTTP ${response.status}` });\n  if (!response.ok) {\n"""
# This exact block appears only in requestImage near this point.
router = replace_once(router, old_fetch_end, new_fetch_end, 'request dispatch/response transport')
old_image_return = """  const format = String(data.format || 'png').toLowerCase();\n  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';\n  return { ...data, format, mime, dataUrl: `data:${mime};base64,${data.image}` };\n"""
new_image_return = """  const format = String(data.format || 'png').toLowerCase();\n  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';\n  onTransport({ phase: 'received', httpStatus: response.status, message: 'Image received ✓ · preparing save…' });\n  return { ...data, format, mime, dataUrl: `data:${mime};base64,${data.image}` };\n"""
router = replace_once(router, old_image_return, new_image_return, 'image received transport')

old_fallback_sig = """  onAttempt = () => {},\n}) {\n"""
new_fallback_sig = """  onAttempt = () => {},\n  onTransport = () => {},\n}) {\n"""
router = replace_once(router, old_fallback_sig, new_fallback_sig, 'fallback transport callback')
old_request_call = """      const result = await requestImage({ model, prompt, references: attempt.refs, aspectRatio: attempt.ratio, signal });\n"""
new_request_call = """      const result = await requestImage({ model, prompt, references: attempt.refs, aspectRatio: attempt.ratio, signal, onTransport });\n"""
router = replace_once(router, old_request_call, new_request_call, 'pass transport callback')

old_exec_start = """  const capabilities = inferModelCapabilities(job.model, modelMetadata || job.modelMetadata);\n  const references = await prepareReferences(app, job.references || [], capabilities);\n"""
new_exec_start = """  const capabilities = inferModelCapabilities(job.model, modelMetadata || job.modelMetadata);\n  onProgress({ phase: 'preparing', message: 'Preparing references and request…' });\n  const references = await prepareReferences(app, job.references || [], capabilities);\n  onProgress({ phase: 'ready', message: `${references.length ? `${references.length} reference(s) prepared · ` : ''}ready to send` });\n"""
router = replace_once(router, old_exec_start, new_exec_start, 'generation prepare progress')
old_exec_request = """    onProgress({ phase: 'request', index, total, message: `Generating ${index + 1} of ${total}…` });\n"""
new_exec_request = """    onProgress({ phase: 'sending', index, total, message: `Sending image ${index + 1} of ${total}…` });\n"""
router = replace_once(router, old_exec_request, new_exec_request, 'generation sending progress')
old_attempt = """      onAttempt: attempt => onProgress({ phase: 'attempt', index, total, attempt }),\n    });\n"""
new_attempt = """      onAttempt: attempt => onProgress({ phase: 'attempt', index, total, attempt }),\n      onTransport: transport => onProgress({ ...transport, index, total }),\n    });\n"""
router = replace_once(router, old_attempt, new_attempt, 'generation transport relay')
router_path.write_text(router)


# ---------------- studio-v3.js ----------------
studio_path = Path('studio-v3.js')
studio = studio_path.read_text()
old_import = """  executeGenerationJob,\n  loadOpenRouterCredits,\n  loadOpenRouterModels,\n} from './studio-openrouter-v3.js';\n"""
new_import = """  enrichOpenRouterImagePricing,\n  executeGenerationJob,\n  formatOpenRouterImagePrice,\n  loadOpenRouterCredits,\n  loadOpenRouterModels,\n} from './studio-openrouter-v3.js';\n"""
studio = replace_once(studio, old_import, new_import, 'studio pricing imports')
old_runtime = """      sharePollTimer: null,\n    });\n"""
new_runtime = """      sharePollTimer: null,\n      liveJobChip: null,\n      lastDispatchToastJobId: null,\n    });\n"""
studio = replace_once(studio, old_runtime, new_runtime, 'runtime live job fields')

style_anchor = """    .ib3-model-row{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:end}.ib3-badges{display:flex;gap:4px;flex-wrap:wrap}.ib3-badge{padding:3px 6px;border-radius:999px;border:1px solid #45445a;font-size:8px;color:#bbb8cb;background:#11111a}.ib3-badge.good{border-color:#326348;color:#91f2b1}.ib3-badge.warn{border-color:#73562f;color:#ffd08b}.ib3-cost-box{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}.ib3-cost-box div{padding:7px;border:1px solid var(--ib2-line);border-radius:10px;background:#101018}.ib3-cost-box span{display:block;font-size:8px;color:var(--ib2-muted)}.ib3-cost-box b{font-size:11px}\n"""
style_replacement = style_anchor + """    .ib3-model-search-wrap{position:relative;margin-top:7px}.ib3-model-search{width:100%;box-sizing:border-box;border:1px solid var(--ib2-line);border-radius:10px;background:#11111a;color:var(--ib2-text);padding:9px 10px;outline:none}.ib3-model-search:focus{border-color:var(--ib3-purple)}.ib3-model-results{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:12;display:grid;gap:3px;max-height:290px;overflow:auto;padding:5px;border:1px solid #46415e;border-radius:11px;background:#0e0e16;box-shadow:0 16px 35px #000a}.ib3-model-results[hidden]{display:none}.ib3-model-result{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;width:100%;padding:8px 9px;border:0;border-radius:8px;background:#171722;color:var(--ib2-text);text-align:left}.ib3-model-result:hover,.ib3-model-result.selected{background:#2b2447}.ib3-model-result span{display:flex;flex-direction:column;min-width:0}.ib3-model-result b,.ib3-model-result small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib3-model-result b{font-size:10px}.ib3-model-result small{font-size:8px;color:var(--ib2-muted)}.ib3-model-price{font-size:9px;color:#a9f3c3;white-space:nowrap}.ib3-model-price.pending{color:#bbb8cb}.ib3-price-detail{margin-top:6px;min-height:18px;font-size:8px;line-height:1.35;color:var(--ib2-muted)}\n    .ib3-live-job{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(16px,calc(env(safe-area-inset-bottom) + 10px));z-index:2147482000;display:grid;grid-template-columns:34px minmax(0,1fr);gap:9px;align-items:center;width:min(330px,calc(100vw - 28px));padding:9px 11px;border:1px solid #5d4c93;border-radius:15px;background:#151421f2;color:#fff;box-shadow:0 12px 36px #000b;backdrop-filter:blur(12px);text-align:left}.ib3-live-job[hidden]{display:none}.ib3-live-job.done{border-color:#377451}.ib3-live-job.failed,.ib3-live-job.cancelled{border-color:#8b3e51}.ib3-live-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#29253b;font-size:18px}.ib3-live-job.running .ib3-live-icon{animation:ib3-pulse 1.1s ease-in-out infinite}.ib3-live-copy{display:flex;flex-direction:column;gap:2px;min-width:0}.ib3-live-copy b,.ib3-live-copy small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib3-live-copy b{font-size:10px}.ib3-live-copy small{font-size:8px;color:#c1bdd0}@keyframes ib3-pulse{50%{transform:scale(.88);opacity:.65}}\n"""
studio = replace_once(studio, style_anchor, style_replacement, 'model search/live status styles')

current_anchor = """function currentStudio(app) {\n  return ensureStudio(app.activeBoard());\n}\n\n"""
status_helpers = current_anchor + dedent('''\
function elapsedLabel(job) {
  const start = job?.dispatchedAt || job?.startedAt || job?.createdAt;
  if (!start || !['running'].includes(job?.status)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return `${seconds}s`;
}

function liveStatusJob(studio) {
  const jobs = studio?.queue || [];
  const running = jobs.find(job => job.status === 'running');
  if (running) return running;
  const queued = jobs.filter(job => job.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0];
  if (queued) return queued;
  return jobs
    .filter(job => ['done', 'failed', 'cancelled'].includes(job.status) && Date.now() - (job.updatedAt || 0) < 10_000)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
}

function liveJobTitle(job) {
  if (!job) return '';
  if (job.status === 'queued') return 'Queued · waiting to send';
  if (job.status === 'done') return `Done ✓ · ${job.resultImageIds?.length || job.count || 1} image(s)`;
  if (job.status === 'failed') return 'Generation failed';
  if (job.status === 'cancelled') return 'Generation cancelled';
  const phase = job.progressPhase || '';
  if (phase === 'preparing' || phase === 'ready') return 'Preparing request';
  if (phase === 'sending') return 'Sending request…';
  if (phase === 'dispatched') return 'Request dispatched ✓';
  if (phase === 'response') return 'OpenRouter responded ✓';
  if (phase === 'received' || phase === 'store') return 'Image received · saving';
  if (phase === 'attempt') return 'Generating · fallback attempt';
  return 'Generating…';
}

function refreshLiveJobChip(app) {
  const runtime = runtimeFor(app);
  if (!app?.root?.isConnected) {
    if (runtime.liveJobChip) runtime.liveJobChip.hidden = true;
    return;
  }
  let chip = runtime.liveJobChip;
  if (!chip?.isConnected) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ib3-live-job';
    chip.dataset.ib3LiveJob = '';
    chip.hidden = true;
    chip.onclick = () => openQueue(app);
    document.body.appendChild(chip);
    runtime.liveJobChip = chip;
  }
  const job = liveStatusJob(currentStudio(app));
  if (!job) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.className = `ib3-live-job ${job.status}`;
  const icon = queueStatusIcon(job.status);
  const elapsed = elapsedLabel(job);
  const model = String(job.model || '').split('/').pop() || 'OpenRouter';
  const detail = job.error || job.progress || `${job.count || 1} image(s)`;
  chip.innerHTML = `<span class="ib3-live-icon">${icon}</span><span class="ib3-live-copy"><b>${escapeHtml(liveJobTitle(job))}${elapsed ? ` · ${elapsed}` : ''}</b><small>${escapeHtml(model)} · ${escapeHtml(detail)}</small></span>`;
}

''')
studio = replace_once(studio, current_anchor, status_helpers, 'live job status helpers')

old_model_options = dedent('''\
function modelOptions(models, selected) {
  const list = [...models];
  if (selected && !list.some(model => model.id === selected)) list.unshift({ id: selected, name: selected, capabilities: inferModelCapabilities(selected), imagePrice: null });
  return list.map(model => `<option value="${safeAttr(model.id)}" ${model.id === selected ? 'selected' : ''}>${escapeHtml(model.name || model.id)}</option>`).join('');
}
''')
new_model_options = dedent('''\
function modelPriceLabel(model) {
  if (model?.priceSummary) return formatOpenRouterImagePrice(model.priceSummary);
  if (model?.pricingStatus === 'loading' || model?.pricingStatus === 'idle') return 'checking price…';
  return 'price unavailable';
}

function modelOptionLabel(model) {
  return `${model.name || model.id} · ${modelPriceLabel(model)}`;
}

function modelOptions(models, selected) {
  const list = [...models];
  if (selected && !list.some(model => model.id === selected)) list.unshift({ id: selected, name: selected, capabilities: inferModelCapabilities(selected), imagePrice: null, pricingStatus: 'unavailable' });
  return list.map(model => `<option value="${safeAttr(model.id)}" ${model.id === selected ? 'selected' : ''}>${escapeHtml(modelOptionLabel(model))}</option>`).join('');
}

function modelSearchResultsHtml(models, query, selected) {
  const needle = String(query || '').trim().toLowerCase();
  const rows = models.filter(model => {
    if (!needle) return true;
    const haystack = `${model.name || ''} ${model.id || ''} ${modelPriceLabel(model)}`.toLowerCase();
    return needle.split(/\\s+/).every(term => haystack.includes(term));
  }).slice(0, 40);
  if (!rows.length) return '<div class="ib2-muted" style="padding:8px">No image models match.</div>';
  return rows.map(model => {
    const price = modelPriceLabel(model);
    const priceClass = model.priceSummary ? '' : ' pending';
    return `<button type="button" class="ib3-model-result ${model.id === selected ? 'selected' : ''}" data-model-result="${safeAttr(model.id)}"><span><b>${escapeHtml(model.name || model.id)}</b><small>${escapeHtml(model.id)}</small></span><strong class="ib3-model-price${priceClass}">${escapeHtml(price)}</strong></button>`;
  }).join('');
}
''')
studio = replace_once(studio, old_model_options, new_model_options, 'searchable model option helpers')

old_model_html = """            <div class=\"ib3-model-row\"><label class=\"ib3-field\">OpenRouter model<select data-studio-model><option value=\"${safeAttr(draft.model)}\">${escapeHtml(draft.model)}</option></select></label><button data-model-refresh title=\"Refresh\">↻</button></div>\n            <div class=\"ib3-badges\" data-model-badges></div>\n            <div class=\"ib3-cost-box\"><div><span>Per image</span><b data-cost-each>Unknown</b></div><div><span>Job estimate</span><b data-cost-total>Unknown</b></div><div><span>Credits left</span><b data-credit>Checking…</b></div></div>\n"""
new_model_html = """            <div class=\"ib3-model-row\"><label class=\"ib3-field\">OpenRouter model<select data-studio-model><option value=\"${safeAttr(draft.model)}\">${escapeHtml(draft.model)}</option></select></label><button data-model-refresh title=\"Refresh\">↻</button></div>\n            <div class=\"ib3-model-search-wrap\"><input class=\"ib3-model-search\" type=\"search\" data-model-search placeholder=\"Search models, provider, $/img, token-priced…\" autocomplete=\"off\"><div class=\"ib3-model-results\" data-model-results hidden></div></div>\n            <div class=\"ib3-price-detail\" data-model-price-detail>OpenRouter image pricing will appear as it loads.</div>\n            <div class=\"ib3-badges\" data-model-badges></div>\n            <div class=\"ib3-cost-box\"><div><span>Per image</span><b data-cost-each>Unknown</b></div><div><span>Job estimate</span><b data-cost-total>Unknown</b></div><div><span>Credits left</span><b data-credit>Checking…</b></div></div>\n"""
studio = replace_once(studio, old_model_html, new_model_html, 'model search HTML')

old_model_vars = """  const modelSelect = modal.querySelector('[data-studio-model]');\n\n  const readDraft = () => {\n"""
new_model_vars = """  const modelSelect = modal.querySelector('[data-studio-model]');\n  const modelSearch = modal.querySelector('[data-model-search]');\n  const modelResults = modal.querySelector('[data-model-results]');\n\n  const readDraft = () => {\n"""
studio = replace_once(studio, old_model_vars, new_model_vars, 'model search DOM refs')

old_update_cost = dedent('''\
  const updateCost = () => {
    const nextDraft = readDraft();
    modelMetadata = models.find(model => model.id === nextDraft.model) || null;
    const preset = modelPreset(nextDraft.model);
    const estimate = estimateGenerationCost({ modelMetadata, count: nextDraft.count, fallbackPrice: preset.fallbackPrice });
    modal.querySelector('[data-cost-each]').textContent = estimate.known ? formatMoney(estimate.perImage) : 'Unknown';
    modal.querySelector('[data-cost-total]').textContent = estimate.known ? formatMoney(estimate.total) : 'Unknown';
    modal.querySelector('[data-model-badges]').innerHTML = capabilityBadges(modelMetadata || { id: nextDraft.model });
    return estimate;
  };
''')
new_update_cost = dedent('''\
  const updateCost = () => {
    const nextDraft = readDraft();
    modelMetadata = models.find(model => model.id === nextDraft.model) || null;
    const preset = modelPreset(nextDraft.model);
    const estimate = estimateGenerationCost({ modelMetadata, count: nextDraft.count, fallbackPrice: preset.fallbackPrice });
    const summary = modelMetadata?.priceSummary;
    const eachNode = modal.querySelector('[data-cost-each]');
    const totalNode = modal.querySelector('[data-cost-total]');
    const detailNode = modal.querySelector('[data-model-price-detail]');
    if (summary?.exactFlat) {
      eachNode.textContent = formatMoney(summary.flatPerImage);
      totalNode.textContent = formatMoney(summary.flatPerImage * Math.max(1, nextDraft.count));
    } else if (summary?.minimumPerImage !== null && summary?.minimumPerImage !== undefined) {
      eachNode.textContent = summary.label;
      totalNode.textContent = `from ${formatMoney(summary.minimumPerImage * Math.max(1, nextDraft.count))}`;
    } else if (summary) {
      eachNode.textContent = summary.label;
      totalNode.textContent = 'Varies';
    } else {
      eachNode.textContent = estimate.known ? formatMoney(estimate.perImage) : (modelMetadata?.pricingStatus === 'loading' ? 'Checking…' : 'Unknown');
      totalNode.textContent = estimate.known ? formatMoney(estimate.total) : (modelMetadata?.pricingStatus === 'loading' ? 'Checking…' : 'Unknown');
    }
    if (detailNode) detailNode.textContent = summary?.detail || (modelMetadata?.pricingStatus === 'loading' ? 'Checking OpenRouter provider pricing…' : 'Exact per-picture pricing is unavailable for this model. You can set a manual fallback price in Model Preset.');
    modal.querySelector('[data-model-badges]').innerHTML = capabilityBadges(modelMetadata || { id: nextDraft.model });
    return estimate;
  };
''')
studio = replace_once(studio, old_update_cost, new_update_cost, 'accurate selected model price display')

old_load_models = dedent('''\
  const loadModels = async force => {
    modal.querySelector('[data-model-loading]').textContent = 'Loading…';
    try {
      models = await loadOpenRouterModels({ force });
      runtime.latestModels = models;
      modelSelect.innerHTML = modelOptions(models, readDraft().model);
      modelSelect.value = readDraft().model;
      modal.querySelector('[data-model-loading]').textContent = `${models.length} image models`;
      writePreset(modelSelect.value);
      updatePreview();
    } catch (error) {
      modal.querySelector('[data-model-loading]').textContent = error.message;
      toast(app, error.message, 'error');
    }
  };
  modelSelect.onchange = () => { draft.model = modelSelect.value; writePreset(modelSelect.value); updatePreview(); };
  modal.querySelector('[data-model-refresh]').onclick = () => loadModels(true);
''')
new_load_models = dedent('''\
  const syncModelOption = model => {
    const option = [...modelSelect.options].find(candidate => candidate.value === model.id);
    if (option) option.textContent = modelOptionLabel(model);
  };

  const renderModelResults = () => {
    if (!modelResults) return;
    modelResults.innerHTML = modelSearchResultsHtml(models, modelSearch?.value || '', modelSelect.value);
    modelResults.querySelectorAll('[data-model-result]').forEach(button => button.onclick = () => {
      modelSelect.value = button.dataset.modelResult;
      draft.model = modelSelect.value;
      writePreset(modelSelect.value);
      if (modelSearch) modelSearch.value = '';
      modelResults.hidden = true;
      updatePreview();
    });
  };

  if (modelSearch) {
    modelSearch.addEventListener('focus', () => { renderModelResults(); modelResults.hidden = false; });
    modelSearch.addEventListener('input', () => { renderModelResults(); modelResults.hidden = false; });
    modelSearch.addEventListener('keydown', event => { if (event.key === 'Escape') { modelResults.hidden = true; modelSearch.blur(); } });
    modelSearch.addEventListener('blur', () => setTimeout(() => { if (modelResults) modelResults.hidden = true; }, 160));
  }

  const loadModels = async force => {
    modal.querySelector('[data-model-loading]').textContent = 'Loading…';
    try {
      models = await loadOpenRouterModels({ force });
      runtime.latestModels = models;
      modelSelect.innerHTML = modelOptions(models, readDraft().model);
      modelSelect.value = readDraft().model;
      modal.querySelector('[data-model-loading]').textContent = `${models.length} image models · loading prices…`;
      writePreset(modelSelect.value);
      renderModelResults();
      updatePreview();
      void enrichOpenRouterImagePricing(models, {
        selectedId: modelSelect.value,
        onUpdate: (model, progress) => {
          if (!modal.isConnected) return;
          syncModelOption(model);
          if (model.id === modelSelect.value) updatePreview();
          if (!modelResults.hidden) renderModelResults();
          const known = models.filter(entry => entry.priceSummary).length;
          modal.querySelector('[data-model-loading]').textContent = progress.loaded >= progress.total
            ? `${models.length} image models · ${known} priced`
            : `${models.length} image models · pricing ${progress.loaded}/${progress.total}`;
        },
      }).then(() => {
        if (!modal.isConnected) return;
        const known = models.filter(entry => entry.priceSummary).length;
        modal.querySelector('[data-model-loading]').textContent = `${models.length} image models · ${known} priced`;
        renderModelResults();
        updatePreview();
      });
    } catch (error) {
      modal.querySelector('[data-model-loading]').textContent = error.message;
      toast(app, error.message, 'error');
    }
  };
  modelSelect.onchange = () => { draft.model = modelSelect.value; writePreset(modelSelect.value); renderModelResults(); updatePreview(); };
  modal.querySelector('[data-model-refresh]').onclick = () => loadModels(true);
''')
studio = replace_once(studio, old_load_models, new_load_models, 'background model pricing/search behavior')

old_add_queue = """    studio.queue.push(job);\n    app.scheduleSave();\n    modal.querySelector('[data-studio-queue-open]').textContent = `Queue · ${studio.queue.filter(entry => ['queued','running'].includes(entry.status)).length}`;\n    toast(app, 'Generation job added to the queue.', 'success');\n"""
new_add_queue = """    job.progressPhase = 'queued';\n    job.progress = 'Queued · waiting to send';\n    studio.queue.push(job);\n    app.scheduleSave();\n    refreshLiveJobChip(app);\n    modal.querySelector('[data-studio-queue-open]').textContent = `Queue · ${studio.queue.filter(entry => ['queued','running'].includes(entry.status)).length}`;\n    toast(app, 'Generation job queued · status is visible at the bottom of the board.', 'success');\n"""
studio = replace_once(studio, old_add_queue, new_add_queue, 'queue status on add')
old_generate = """  modal.querySelector('[data-studio-generate]').onclick = async () => {\n    const { job, preview } = buildJob();\n    if (!confirmCost(preview)) return;\n    studio.queue.unshift(job);\n    app.scheduleSave();\n    modal.remove();\n    await runQueue(app, { focusJobId: job.id, showComparison: true });\n  };\n"""
new_generate = """  modal.querySelector('[data-studio-generate]').onclick = async event => {\n    const button = event.currentTarget;\n    const { job, preview } = buildJob();\n    if (!confirmCost(preview)) return;\n    button.disabled = true;\n    button.textContent = '↗ Sending…';\n    job.progressPhase = 'queued';\n    job.progress = 'Queued · preparing to send';\n    studio.queue.unshift(job);\n    app.scheduleSave();\n    refreshLiveJobChip(app);\n    modal.remove();\n    await runQueue(app, { focusJobId: job.id, showComparison: true });\n  };\n"""
studio = replace_once(studio, old_generate, new_generate, 'generate button immediate feedback')

old_running = """      job.status = 'running';\n      job.startedAt = Date.now();\n      job.updatedAt = Date.now();\n      job.attempt += 1;\n"""
new_running = """      job.status = 'running';\n      job.startedAt = Date.now();\n      job.updatedAt = Date.now();\n      job.progressPhase = 'preparing';\n      job.progress = 'Preparing references and request…';\n      job.dispatchedAt = null;\n      job.responseAt = null;\n      job.lastHttpStatus = null;\n      job.attempt += 1;\n"""
studio = replace_once(studio, old_running, new_running, 'running job initial phase')
old_progress = """          onProgress: progress => {\n            job.progress = progress.message || progress.attempt?.reason || 'Working…';\n            job.updatedAt = Date.now();\n            refreshQueueModal(app);\n          },\n"""
new_progress = """          onProgress: progress => {\n            job.progressPhase = progress.phase || job.progressPhase || 'running';\n            job.progress = progress.message || progress.attempt?.reason || 'Working…';\n            if (progress.dispatchedAt) job.dispatchedAt = progress.dispatchedAt;\n            if (progress.responseAt) job.responseAt = progress.responseAt;\n            if (progress.httpStatus !== undefined) job.lastHttpStatus = progress.httpStatus;\n            job.updatedAt = Date.now();\n            if (progress.phase === 'dispatched' && runtime.lastDispatchToastJobId !== job.id) {\n              runtime.lastDispatchToastJobId = job.id;\n              toast(app, 'Image request dispatched ✓ · waiting for OpenRouter.', 'success');\n            }\n            refreshQueueModal(app);\n            refreshLiveJobChip(app);\n          },\n"""
studio = replace_once(studio, old_progress, new_progress, 'persist transport progress')
old_done = """        job.status = 'done';\n        job.completedAt = Date.now();\n        job.updatedAt = Date.now();\n        job.resultImageIds = result.imageIds;\n"""
new_done = """        job.status = 'done';\n        job.completedAt = Date.now();\n        job.updatedAt = Date.now();\n        job.progressPhase = 'done';\n        job.progress = `${result.imageIds.length} image(s) saved`;\n        job.resultImageIds = result.imageIds;\n"""
studio = replace_once(studio, old_done, new_done, 'done job phase')
old_after_done = """        refreshQueueModal(app);\n        if (showComparison || focusJobId === job.id) await openComparison(app, generation);\n"""
new_after_done = """        refreshQueueModal(app);\n        refreshLiveJobChip(app);\n        toast(app, `Generation complete ✓ · ${result.imageIds.length} image(s) saved.`, 'success');\n        if (showComparison || focusJobId === job.id) await openComparison(app, generation);\n"""
studio = replace_once(studio, old_after_done, new_after_done, 'completion toast/status')
old_failure = """        job.status = error?.name === 'AbortError' ? 'cancelled' : 'failed';\n        job.error = error.message || String(error);\n        job.fallbackLog = error.fallbackLog || job.fallbackLog || [];\n        job.updatedAt = Date.now();\n"""
new_failure = """        job.status = error?.name === 'AbortError' ? 'cancelled' : 'failed';\n        job.progressPhase = job.status;\n        job.error = error.message || String(error);\n        job.progress = job.status === 'cancelled' ? 'Cancelled' : 'Failed';\n        job.fallbackLog = error.fallbackLog || job.fallbackLog || [];\n        job.updatedAt = Date.now();\n"""
studio = replace_once(studio, old_failure, new_failure, 'failed/cancelled phase')
old_failure_refresh = """        refreshQueueModal(app);\n        if (job.status === 'failed') toast(app, job.error, 'error');\n"""
new_failure_refresh = """        refreshQueueModal(app);\n        refreshLiveJobChip(app);\n        if (job.status === 'failed') toast(app, job.error, 'error');\n"""
studio = replace_once(studio, old_failure_refresh, new_failure_refresh, 'failure live chip refresh')

old_queue_row = """<small>${job.status}${job.progress ? ` · ${escapeHtml(job.progress)}` : ''}${job.error ? ` · ${escapeHtml(job.error)}` : ''} · ${job.count} image(s) · ${job.estimatedCost === null ? 'cost unknown' : formatMoney(job.estimatedCost)}</small>"""
new_queue_row = """<small>${liveJobTitle(job)}${elapsedLabel(job) ? ` · ${elapsedLabel(job)}` : ''}${job.progress ? ` · ${escapeHtml(job.progress)}` : ''}${job.lastHttpStatus ? ` · HTTP ${job.lastHttpStatus}` : ''}${job.error ? ` · ${escapeHtml(job.error)}` : ''} · ${job.count} image(s) · ${job.estimatedCost === null ? 'cost unknown' : formatMoney(job.estimatedCost)}</small>"""
studio = replace_once(studio, old_queue_row, new_queue_row, 'queue lifecycle detail')

studio = replace_once(studio, "        await moveResultToBoard(app, imageId);", "        await moveImageToBoard(app, imageId, generation);", 'creator generated image move bug')

old_install_block = """  if (!app[INSTALL_KEY]) {\n    app[INSTALL_KEY] = true;\n    app.openBlueprintStudio = () => openBlueprint(app);\n    app.openGenerationStudio = options => openGenerationStudio(app, options);\n    app.openGenerationQueue = () => openQueue(app);\n    app.openGenerationHistory = () => openHistory(app);\n    app.openCharacterGallery = () => openGallery(app);\n    app.openOrganizeStudio = () => openOrganizeStudio(app);\n    app.openSyncSharePanel = () => openSyncSharePanel(app);\n    app.openImageLab = () => openMediaTools(app, studioApiFor(app));\n    app.studioV3 = studioApiFor(app);\n  }\n"""
new_install_block = """  if (!app[INSTALL_KEY]) app[INSTALL_KEY] = true;\n  // Rebind these on every install so a cache-busted Studio update can replace older closures.\n  app.openBlueprintStudio = () => openBlueprint(app);\n  app.openGenerationStudio = options => openGenerationStudio(app, options);\n  app.openGenerationQueue = () => openQueue(app);\n  app.openGenerationHistory = () => openHistory(app);\n  app.openCharacterGallery = () => openGallery(app);\n  app.openOrganizeStudio = () => openOrganizeStudio(app);\n  app.openSyncSharePanel = () => openSyncSharePanel(app);\n  app.openImageLab = () => openMediaTools(app, studioApiFor(app));\n  app.studioV3 = studioApiFor(app);\n  refreshLiveJobChip(app);\n"""
studio = replace_once(studio, old_install_block, new_install_block, 'rebind updated Studio API')
old_interval = """    ensureStudio(app.activeBoard());\n    ensureRailButtons(app);\n    installSettingsPanelEnhancements();\n  }, 900);\n"""
new_interval = """    ensureStudio(app.activeBoard());\n    ensureRailButtons(app);\n    installSettingsPanelEnhancements();\n    refreshLiveJobChip(app);\n  }, 900);\n"""
studio = replace_once(studio, old_interval, new_interval, 'live chip ticker')
studio_path.write_text(studio)


# ---------------- launcher/version wiring ----------------
launcher56 = Path('launcher-v56.js').read_text()
launcher57 = "import './launcher-v56.js?v=0.5.7';\nimport { installGenerationStudio } from './studio-v3.js?v=0.5.7';\n\nconst VERSION = '0.5.7';\nlet timer = null;\n\nfunction enhance() {\n  const bridge = globalThis.InspirationBoard;\n  if (bridge) bridge.version = VERSION;\n  document.querySelectorAll('[data-ib-v2-status]').forEach(element => {\n    if (!/Loading|Opening|Open|Error/i.test(element.textContent || '')) element.textContent = `Ready · v${VERSION}`;\n  });\n  const note = document.querySelector('#inspiration_board_settings .ib-v2-settings-note');\n  if (note) note.textContent = 'Capture-first character workspace with OpenRouter image price discovery and visible generation lifecycle status. Model prices are labeled honestly as flat per-image, from-price, megapixel, token-priced, or unavailable.';\n  const app = bridge?.app;\n  if (app) installGenerationStudio(app);\n}\n\nfunction boot() {\n  enhance();\n  clearInterval(timer);\n  timer = setInterval(enhance, 700);\n  console.info(`[Inspiration Board] OpenRouter pricing + generation status v${VERSION} ready`);\n}\n\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });\nelse boot();\n"
Path('launcher-v57.js').write_text(launcher57)

manifest_path = Path('manifest.json')
manifest = manifest_path.read_text().replace('"launcher-v56.js"', '"launcher-v57.js"', 1).replace('"version": "0.5.6"', '"version": "0.5.7"', 1)
manifest_path.write_text(manifest)

package_path = Path('package.json')
package = package_path.read_text().replace('"version": "0.5.6"', '"version": "0.5.7"', 1)
package = replace_once(package, 'node --check launcher-v56.js &&', 'node --check launcher-v56.js && node --check launcher-v57.js &&', 'launcher v57 check')
package_path.write_text(package)

# ---------------- tests ----------------
Path('tests/openrouter-pricing-status-v057.test.mjs').write_text(dedent('''\
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimateGenerationCost, getModelImagePrice, makeQueueJob } from '../studio-core-v3.js';
import { summarizeOpenRouterImagePricing } from '../studio-openrouter-v3.js';

const studioSource = fs.readFileSync(new URL('../studio-v3.js', import.meta.url), 'utf8');
const routerSource = fs.readFileSync(new URL('../studio-openrouter-v3.js', import.meta.url), 'utf8');

const payload = pricing => ({ data: { endpoints: [{ provider_name: 'test', pricing }] } });

test('flat output-image pricing becomes an exact per-picture price', () => {
  const summary = summarizeOpenRouterImagePricing(payload([
    { billable: 'output_image', unit: 'image', cost_usd: 0.04 },
    { billable: 'input_image', unit: 'image', cost_usd: 0.01 },
  ]));
  assert.equal(summary.label, '$0.04/img');
  assert.equal(summary.exactFlat, true);
  assert.equal(summary.flatPerImage, 0.04);
  assert.equal(summary.inputReferencePrice, 0.01);
  assert.equal(getModelImagePrice({ priceSummary: summary }), 0.04);
  assert.deepEqual(estimateGenerationCost({ modelMetadata: { priceSummary: summary }, count: 3 }), { known: true, perImage: 0.04, total: 0.12 });
});

test('quality/provider ranges are labeled from-price rather than falsely exact', () => {
  const summary = summarizeOpenRouterImagePricing({ data: { endpoints: [
    { pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }] },
    { pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.08 }] },
  ] } });
  assert.equal(summary.label, 'from $0.04/img');
  assert.equal(summary.exactFlat, false);
  assert.equal(summary.minimumPerImage, 0.04);
  assert.equal(getModelImagePrice({ priceSummary: summary }), null);
});

test('megapixel and token image pricing are not misreported as picture prices', () => {
  const mp = summarizeOpenRouterImagePricing(payload([{ billable: 'output_image', unit: 'megapixel', cost_usd: 0.03 }]));
  const token = summarizeOpenRouterImagePricing(payload([{ billable: 'output_image', unit: 'token', cost_usd: 0.00001 }]));
  assert.equal(mp.label, 'from $0.03/MP');
  assert.equal(token.label, 'token-priced');
  assert.equal(getModelImagePrice({ pricing: { image: 0.01, image_output: 0.00001 } }), null);
});

test('generation jobs persist transport lifecycle fields', () => {
  const job = makeQueueJob({ model: 'x-ai/test' });
  assert.equal(job.progressPhase, 'queued');
  assert.equal(job.dispatchedAt, null);
  assert.equal(job.responseAt, null);
  assert.equal(job.lastHttpStatus, null);
});

test('Studio exposes searchable model pricing and a persistent generation status chip', () => {
  assert.match(studioSource, /data-model-search/);
  assert.match(studioSource, /data-model-result/);
  assert.match(studioSource, /data-ib3-live-job/);
  assert.match(studioSource, /Request dispatched ✓/);
  assert.match(studioSource, /OpenRouter responded ✓/);
  assert.match(routerSource, /phase: 'dispatched'/);
  assert.match(routerSource, /phase: 'response'/);
  assert.match(routerSource, /api\\/v1\\/images\\/models/);
});
'''))

# Keep older Studio tests aligned with the internal Studio version bump if they assert it.
test_core_path = Path('tests/studio-core-v3.test.mjs')
test_core = test_core_path.read_text().replace("'0.3.0'", "'0.5.7'")
test_core_path.write_text(test_core)

# ---------------- docs ----------------
changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text()
entry = dedent('''\
## 0.5.7

- Added a searchable OpenRouter image-model picker with price text directly beside model names.
- Uses OpenRouter's dedicated image-model and per-endpoint pricing metadata in the background; flat output prices render as `$X/img`, ranges as `from $X/img`, megapixel billing as `$X/MP`, and token-priced image output is labeled instead of being misreported as a tiny per-picture price.
- Hardened cost estimation so generic OpenRouter image-token/input-image rates are no longer mistaken for one generated picture.
- Added a persistent live generation chip on the board showing Queued, Preparing, Sending, Request dispatched, OpenRouter response received, Saving, Done, Failed, or Cancelled without requiring the Queue modal to be open.
- Generate Now immediately changes to `Sending…`, and the extension confirms when the browser has dispatched the request and when a result is saved.
- Queue jobs now retain dispatch time, response time, HTTP status, progress phase, and readable progress text for easier troubleshooting.
- Fixed the generated-result `Creator` action to use the existing board-move helper instead of an undefined function.
- No Android Capture Browser or server-plugin update is required for this release; v0.5.6 of those components remains compatible.

''')
if not changelog.startswith('# Changelog\n\n## 0.5.7'):
    changelog = changelog.replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
changelog_path.write_text(changelog)

doc_path = Path('OPENROUTER_IMAGE_GENERATION.md')
doc = doc_path.read_text()
addition = dedent('''\

## v0.5.7 pricing and send status

Generation Studio now enriches the SillyTavern image-model list with OpenRouter's dedicated Image API catalog and per-provider endpoint pricing. Price labels are unit-aware: a true flat output-image price is shown per image, variable flat tiers use a `from` label, megapixel-priced models are shown per MP, and token-priced models are explicitly marked `token-priced`. If pricing metadata cannot be loaded, the Studio keeps working and shows the price as unavailable instead of guessing.

A live status chip stays visible while a generation is queued or running. The client distinguishes between preparing the request, initiating the SillyTavern request, dispatching it, receiving the HTTP response, receiving image data, saving the result, and final success/failure. `Request dispatched` means the browser has handed the request to the SillyTavern generation endpoint; `OpenRouter responded` only appears after an HTTP response returns.
''')
if '## v0.5.7 pricing and send status' not in doc:
    doc += addition
doc_path.write_text(doc)
