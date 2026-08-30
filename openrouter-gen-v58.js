import { ROLE_LABELS, makeImageItem, staggerPositions, clamp } from './core-v2.js';
import { blobToDataUrl, createImageRecord, getImage, putImage } from './db-v2.js';
import {
  enrichOpenRouterImagePricing,
  formatOpenRouterImagePrice,
  loadOpenRouterCredits,
  loadOpenRouterModels,
} from './studio-openrouter-v3.js';

const SETTINGS_KEY = 'st_inspiration_board_openrouter_gen_v1';
const DEFAULT_MODEL = 'openai/gpt-image-1';
const FALLBACK_ASPECTS = ['1:1','3:4','4:3','9:16','16:9','2:3','3:2'];
const MAX_LOCAL_REFERENCES = 16;
const PLUGIN_BASE = '/api/plugins/inspiration-board-sync';
const REQUIRED_PLUGIN_VERSION = '0.5.8';

const defaultSettings = Object.freeze({
  model: DEFAULT_MODEL,
  aspectRatio: '1:1',
  count: 1,
  referenceSource: 'auto',
  useReferences: true,
  addToBoard: true,
  prompt: '',
});

let installedFor = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function safeAttr(value = '') {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function getRequestHeaders() {
  const context = globalThis.SillyTavern?.getContext?.();
  return context?.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
}

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, ...settings }));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function allBasketIds(board) {
  const refs = board?.character?.references || {};
  return unique(Object.values(refs).flatMap(value => Array.isArray(value) ? value : []));
}

function roleForReference(board, itemId) {
  const refs = board?.character?.references || {};
  for (const [role, ids] of Object.entries(refs)) {
    if (Array.isArray(ids) && ids.includes(itemId)) return role;
  }
  return null;
}

function getReferenceItems(app, source = 'auto') {
  const board = app.activeBoard();
  const selected = [...app.selectedIds]
    .map(id => app.itemById(id))
    .filter(item => item?.type === 'image');
  const basket = allBasketIds(board)
    .map(id => app.itemById(id))
    .filter(item => item?.type === 'image');
  const main = board.character.mainImageId ? app.itemById(board.character.mainImageId) : null;

  let items = [];
  if (source === 'selected') items = selected;
  else if (source === 'basket') items = basket;
  else if (source === 'main') items = main?.type === 'image' ? [main] : [];
  else items = selected.length ? selected : (basket.length ? basket : (main?.type === 'image' ? [main] : []));

  const seen = new Set();
  return items.filter(item => {
    if (!item?.imageId || seen.has(item.imageId)) return false;
    seen.add(item.imageId);
    return true;
  }).slice(0, MAX_LOCAL_REFERENCES);
}

function dedicated(model) {
  return model?.dedicatedImage || model || {};
}

function supportedParameter(model, name) {
  return dedicated(model)?.supported_parameters?.[name] || null;
}

export function modelReferenceCapability(model) {
  const parameter = supportedParameter(model, 'input_references');
  if (!parameter) return { supported: false, required: false, min: 0, max: 0 };
  const min = Math.max(0, Number(parameter.min ?? 0) || 0);
  const max = Math.max(min, Number(parameter.max ?? 1) || 1);
  return { supported: max > 0, required: min > 0, min, max };
}

export function modelOutputLimit(model) {
  const parameter = supportedParameter(model, 'n');
  if (!parameter) return 1;
  return Math.max(1, Number(parameter.max ?? 1) || 1);
}

export function modelAspectRatios(model) {
  const values = supportedParameter(model, 'aspect_ratio')?.values;
  const list = Array.isArray(values) ? values.filter(value => value && value !== 'auto') : [];
  return list.length ? list : FALLBACK_ASPECTS;
}

export function isStyleReferenceModel(model) {
  const description = String(dedicated(model)?.description || model?.description || '').toLowerCase();
  return description.includes('style-consistent') || description.includes('style reference image');
}

function minimumReferencePixels(model) {
  const description = String(dedicated(model)?.description || model?.description || '');
  const match = description.match(/at least\s+(\d+)\s*px/i);
  return match ? Math.max(1, Number(match[1]) || 0) : 0;
}

function outputFormat(model) {
  const values = supportedParameter(model, 'output_format')?.values;
  return Array.isArray(values) && values.length ? values.join(', ').toUpperCase() : 'Image';
}

function priceLabel(model) {
  if (model?.priceSummary) return formatOpenRouterImagePrice(model.priceSummary);
  if (model?.pricingStatus === 'loading' || model?.pricingStatus === 'idle') return 'checking price…';
  return 'price unavailable';
}

function requestFeeFromDescription(model) {
  const text = String(dedicated(model)?.description || model?.description || '');
  const match = text.match(/\$([0-9]+(?:\.[0-9]+)?)\s+(?:style-creation\s+)?charge\s+per\s+request/i)
    || text.match(/one-time\s+\$([0-9]+(?:\.[0-9]+)?)[^\n.]*per\s+request/i);
  return match ? Number(match[1]) : 0;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Unknown';
  return number < 0.01 ? `$${number.toFixed(4)}` : `$${number.toFixed(2)}`;
}

export function modelBatchEstimate(model, count = 1) {
  const summary = model?.priceSummary;
  if (!summary) return null;
  const n = Math.max(1, Number(count) || 1);
  const requestFee = requestFeeFromDescription(model);
  if (summary.exactFlat && Number.isFinite(Number(summary.flatPerImage))) {
    return { exact: true, total: Number(summary.flatPerImage) * n + requestFee };
  }
  if (summary.minimumPerImage !== null && summary.minimumPerImage !== undefined && Number.isFinite(Number(summary.minimumPerImage))) {
    return { exact: false, total: Number(summary.minimumPerImage) * n + requestFee };
  }
  return null;
}

function referenceLabel(model) {
  const cap = modelReferenceCapability(model);
  if (!cap.supported) return 'no refs';
  if (cap.required) return `refs ${cap.min}–${cap.max} required`;
  return cap.max === 1 ? '1 ref' : `up to ${cap.max} refs`;
}

function modelOptionLabel(model) {
  return `${model.name || model.text || model.id || model.value} · ${priceLabel(model)} · ${referenceLabel(model)}`;
}

function modelOptions(models, selected) {
  const list = [...models];
  if (selected && !list.some(model => model.id === selected || model.value === selected)) {
    list.unshift({ id: selected, value: selected, name: selected, text: selected, pricingStatus: 'unavailable' });
  }
  return list.map(model => {
    const id = model.id || model.value;
    return `<option value="${safeAttr(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(modelOptionLabel(model))}</option>`;
  }).join('');
}

function buildPrompt(userPrompt, refs, model) {
  if (!refs.length) return userPrompt.trim();
  const guide = refs.map((entry, index) => {
    const label = ROLE_LABELS[entry.role] || entry.role || 'Reference';
    return `Reference ${index + 1}: ${label}${entry.item.name ? ` (${entry.item.name})` : ''}`;
  }).join('\n');

  if (isStyleReferenceModel(model)) {
    return [
      'Use the attached image(s) as STYLE REFERENCES.',
      'Match their rendering technique, line treatment, color handling, texture, lighting language, and overall visual finish.',
      'This is a new generation, not a literal edit. Follow the written request for subject identity, pose, clothing, and scene.',
      guide,
      '',
      `Image request: ${userPrompt.trim()}`,
    ].join('\n');
  }

  return [
    'Use the attached images as visual references for the requested image.',
    'Preserve character identity from face, hair, and body references. Use outfit references for clothing, accessory/prop references for details, and mood/environment references for atmosphere and setting.',
    'Do not turn the references into a collage and do not add extra characters unless the request asks for them.',
    guide,
    '',
    `Image request: ${userPrompt.trim()}`,
  ].join('\n');
}

async function referencePayload(app, items, model) {
  const board = app.activeBoard();
  const minimumPixels = minimumReferencePixels(model);
  const cap = modelReferenceCapability(model);
  const payload = [];
  for (const item of items.slice(0, cap.supported ? cap.max : 0)) {
    const record = await getImage(item.imageId);
    if (!record?.blob) continue;
    if (minimumPixels && Math.min(Number(record.width) || 0, Number(record.height) || 0) < minimumPixels) {
      throw new Error(`${item.name || 'Reference image'} is too small for ${model.name || model.id}. It needs at least ${minimumPixels}px on its shortest edge.`);
    }
    // Generation references must use the original stored image. Thumbnails can be too small
    // for providers such as Recraft Styles, which currently require >=256 px references.
    const dataUrl = await blobToDataUrl(record.blob);
    payload.push({
      item,
      role: roleForReference(board, item.id) || item.role || 'general',
      dataUrl,
    });
  }
  return payload;
}

async function fetchBridgeStatus() {
  try {
    const response = await fetch(`${PLUGIN_BASE}/status`, { headers: getRequestHeaders(), cache: 'no-store' });
    if (!response.ok) return { ok: false, modernImages: false, version: null };
    const data = await response.json();
    return {
      ok: Boolean(data?.ok),
      version: data?.version || null,
      modernImages: Array.isArray(data?.capabilities) && data.capabilities.includes('openrouter-image-api'),
    };
  } catch {
    return { ok: false, modernImages: false, version: null };
  }
}

async function parseErrorResponse(response) {
  let message = '';
  try {
    const data = await response.clone().json();
    message = data?.error?.message || data?.error || data?.message || data?.detail || '';
  } catch {
    try { message = await response.text(); } catch {}
  }
  return String(message || '').slice(0, 1000);
}

function mimeToFormat(mime = '') {
  const value = String(mime).toLowerCase();
  if (value.includes('svg')) return 'svg';
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpeg';
  if (value.includes('webp')) return 'webp';
  if (value.includes('avif')) return 'avif';
  return 'png';
}

function normalizeImageResult(entry) {
  const image = entry?.b64_json || entry?.image || '';
  if (!image) return null;
  const mime = entry?.media_type || entry?.mime || entry?.mime_type || (mimeToFormat(entry?.format) === 'svg' ? 'image/svg+xml' : 'image/png');
  const format = entry?.format || mimeToFormat(mime);
  return { ...entry, image, mime, format, dataUrl: `data:${mime};base64,${image}` };
}

async function requestModernImages({ model, prompt, refs, aspectRatio, count, signal }) {
  const response = await fetch(`${PLUGIN_BASE}/openrouter-images`, {
    method: 'POST',
    headers: getRequestHeaders(),
    signal,
    body: JSON.stringify({
      model,
      prompt,
      n: count,
      aspect_ratio: aspectRatio,
      input_references: refs.map(entry => ({ type: 'image_url', image_url: { url: entry.dataUrl } })),
    }),
  });
  if (!response.ok) {
    const detail = await parseErrorResponse(response);
    throw new Error(`OpenRouter Images API failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const data = await response.json();
  const images = (Array.isArray(data?.data) ? data.data : []).map(normalizeImageResult).filter(Boolean);
  if (!images.length) throw new Error('OpenRouter returned no image data.');
  return { images, usage: data?.usage || null, providerResponse: data };
}

async function requestLegacyImage({ model, prompt, aspectRatio, signal }) {
  const response = await fetch('/api/openrouter/image/generate', {
    method: 'POST',
    headers: getRequestHeaders(),
    signal,
    body: JSON.stringify({ model, prompt, aspect_ratio: aspectRatio }),
  });
  if (!response.ok) {
    const detail = await parseErrorResponse(response);
    throw new Error(`Legacy OpenRouter generation failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const result = await response.json();
  const normalized = normalizeImageResult(result);
  if (!normalized) throw new Error('OpenRouter returned no image data.');
  return normalized;
}

async function requestImages({ model, prompt, refs, aspectRatio, count, signal, bridge }) {
  if (bridge?.modernImages) return requestModernImages({ model, prompt, refs, aspectRatio, count, signal });
  if (refs.length) {
    throw new Error(`Reference generation now uses OpenRouter's dedicated Images API. Update the Inspiration Board Sync server plugin to v${REQUIRED_PLUGIN_VERSION} or newer, restart SillyTavern, then retry.`);
  }
  const images = [];
  for (let index = 0; index < count; index++) images.push(await requestLegacyImage({ model, prompt, aspectRatio, signal }));
  return { images, usage: null, providerResponse: null };
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function storeGeneratedResult(app, result, metadata, positionIndex = 0) {
  const ext = result.format === 'jpeg' ? 'jpg' : result.format;
  const blob = base64ToBlob(result.image, result.mime);
  const file = new File([blob], `openrouter-${Date.now()}-${positionIndex + 1}.${ext}`, { type: result.mime });
  const record = await createImageRecord(file, { sourceUrl: `openrouter:${metadata.model}` });
  record.generated = { provider: 'openrouter', ...metadata, createdAt: Date.now() };
  await putImage(record);

  const board = app.activeBoard();
  const ratio = record.width / Math.max(1, record.height);
  const width = ratio >= 1 ? 360 : 290;
  const height = clamp(width / Math.max(ratio, 0.05), 190, 500);
  const center = app.canvasCenterWorld();
  const pos = staggerPositions(metadata.total || 1, center.x, center.y, width, height)[positionIndex] || center;
  const item = makeImageItem({
    imageId: record.id,
    name: `OpenRouter · ${metadata.model.split('/').pop() || metadata.model}`,
    width,
    height,
    x: pos.x,
    y: pos.y,
    sourceUrl: `openrouter:${metadata.model}`,
  });
  item.tags = ['generated', 'openrouter'];
  item.notes = metadata.userPrompt;
  item.generated = record.generated;
  board.items.push(item);
  board.updatedAt = Date.now();
  return item;
}

async function storeGeneratedInbox(app, result, metadata, positionIndex = 0) {
  const ext = result.format === 'jpeg' ? 'jpg' : result.format;
  const blob = base64ToBlob(result.image, result.mime);
  const file = new File([blob], `openrouter-${Date.now()}-${positionIndex + 1}.${ext}`, { type: result.mime });
  const record = await createImageRecord(file, { sourceUrl: `openrouter:${metadata.model}` });
  record.generated = { provider: 'openrouter', ...metadata, createdAt: Date.now() };
  await putImage(record);
  const entry = app.ensureInboxEntry(record, { sourceUrl: `openrouter:${metadata.model}` });
  entry.tags = ['generated', 'openrouter'];
  entry.notes = metadata.userPrompt;
  return entry;
}

function injectGeneratorStyles() {
  if (document.getElementById('ib58-openrouter-style')) return;
  const style = document.createElement('style');
  style.id = 'ib58-openrouter-style';
  style.textContent = `
    .ib2-or-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ib2-or-grid .wide{grid-column:1/-1}
    .ib58-or-model-info{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:8px;border:1px solid var(--ib2-line,#343446);border-radius:11px;background:#101018}.ib58-or-model-info>div{min-width:0}.ib58-or-model-info span{display:block;font-size:8px;color:var(--ib2-muted,#aaa)}.ib58-or-model-info b{display:block;font-size:10px;overflow:hidden;text-overflow:ellipsis}.ib58-or-model-note{grid-column:1/-1!important;padding-top:4px;font-size:9px;line-height:1.35;color:#c7c3d6}.ib58-or-model-note.style{color:#c9b2ff}.ib58-or-model-note.warn{color:#ffcb8d}
    .ib2-or-ref-strip,.ib2-or-results{display:flex;gap:8px;overflow-x:auto;padding:6px 0;min-height:76px}.ib2-or-ref{position:relative;flex:0 0 66px;height:82px;border:1px solid var(--ib2-line,#343446);border-radius:10px;overflow:hidden;background:#181824}.ib2-or-ref img{width:100%;height:100%;object-fit:cover}.ib2-or-ref span{position:absolute;left:3px;right:3px;bottom:3px;padding:2px 3px;background:#08080bd9;border-radius:5px;font-size:8px;text-align:center}
    .ib2-or-result{flex:0 0 min(260px,70vw);display:flex;flex-direction:column;gap:6px}.ib2-or-result img{width:100%;max-height:310px;object-fit:contain;border-radius:12px;background:#090910}.ib2-or-result-actions{display:flex;gap:6px}.ib2-or-result-actions button{flex:1}
    .ib2-or-status{padding:8px 10px;border:1px solid var(--ib2-line,#343446);border-radius:10px;background:#11111a;font-size:11px;line-height:1.4}.ib2-or-status.error{color:#ff98a7;border-color:#7b3945}.ib2-or-status.good{color:#9effbd;border-color:#28583b}.ib2-or-generate{background:linear-gradient(135deg,#906cff,#6244d6)!important;color:#fff!important;font-weight:700!important}
    @media(max-width:700px){.ib2-or-grid{grid-template-columns:1fr}.ib2-or-grid .wide{grid-column:1}.ib58-or-model-info{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
}

async function renderReferenceStrip(app, container, source) {
  const items = getReferenceItems(app, source);
  if (!items.length) {
    container.innerHTML = '<span class="ib2-muted">No reference images found for this source.</span>';
    return items;
  }
  const rows = await Promise.all(items.map(async item => ({ item, url: await app.imageUrl(item.imageId, true) })));
  container.innerHTML = rows.map(({ item, url }) => `<div class="ib2-or-ref"><img src="${url}" alt=""><span>${escapeHtml(ROLE_LABELS[item.role] || item.role || 'Reference')}</span></div>`).join('');
  return items;
}

function modelInfoHtml(model, count, availableRefs) {
  if (!model) return '<div class="ib58-or-model-note">Select a model.</div>';
  const refs = modelReferenceCapability(model);
  const estimate = modelBatchEstimate(model, count);
  const estimateLabel = estimate ? `${estimate.exact ? '' : 'from '}${money(estimate.total)}` : 'Varies';
  const refsText = !refs.supported ? 'Not supported' : refs.required ? `Required · ${refs.min}–${refs.max}` : `Optional · up to ${refs.max}`;
  const note = isStyleReferenceModel(model)
    ? 'Style-reference model: excellent for matching rendering style. It creates a new image from the style reference and is not primarily an identity-preserving edit model.'
    : refs.supported
      ? `This model accepts reference images. ${availableRefs > refs.max ? `Only the first ${refs.max} of ${availableRefs} available references will be sent.` : ''}`
      : 'This model does not advertise input_references in OpenRouter’s live Image API capability record.';
  const noteClass = isStyleReferenceModel(model) ? 'style' : refs.supported ? '' : 'warn';
  return `
    <div><span>Price</span><b>${escapeHtml(priceLabel(model))}</b></div>
    <div><span>Batch estimate</span><b>${escapeHtml(estimateLabel)}</b></div>
    <div><span>References</span><b>${escapeHtml(refsText)}</b></div>
    <div><span>Output</span><b>${escapeHtml(outputFormat(model))}</b></div>
    <div class="ib58-or-model-note ${noteClass}">${escapeHtml(note)}</div>`;
}

export async function openOpenRouterGenerator(app) {
  injectGeneratorStyles();
  const settings = loadSettings();
  const referenceItems = getReferenceItems(app, settings.referenceSource);
  const modal = app.showModal('Generate image · OpenRouter', `
    <div class="ib2-or-grid">
      <div class="wide ib2-or-status" data-or-status>Checking SillyTavern's OpenRouter connection…</div>
      <label>Model<select data-or-model><option value="${safeAttr(settings.model)}">${escapeHtml(settings.model)}</option></select></label>
      <label>Aspect ratio<select data-or-aspect>${FALLBACK_ASPECTS.map(value => `<option value="${value}" ${settings.aspectRatio === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label>Images to generate<select data-or-count>${[1,2,3,4].map(value => `<option value="${value}" ${Number(settings.count) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label>Reference source<select data-or-ref-source>
        <option value="auto" ${settings.referenceSource === 'auto' ? 'selected' : ''}>Auto · selected first, then basket</option>
        <option value="selected" ${settings.referenceSource === 'selected' ? 'selected' : ''}>Selected canvas images</option>
        <option value="basket" ${settings.referenceSource === 'basket' ? 'selected' : ''}>Character reference basket</option>
        <option value="main" ${settings.referenceSource === 'main' ? 'selected' : ''}>Main portrait only</option>
      </select></label>
      <div class="wide ib58-or-model-info" data-or-model-info></div>
      <label class="wide">What do you want?<textarea data-or-prompt rows="5" placeholder="Example: Put this character in a rainy neon alley at night, full body, cinematic lighting.">${escapeHtml(settings.prompt || '')}</textarea></label>
      <label class="ib2-check wide"><input type="checkbox" data-or-use-refs ${settings.useReferences !== false && referenceItems.length ? 'checked' : ''}> Send the reference images to the generation model (${referenceItems.length} available)</label>
      <div class="wide">
        <div class="ib2-muted" data-or-ref-note>Reference support is checked against OpenRouter's live Image API model capabilities.</div>
        <div class="ib2-or-ref-strip" data-or-refs></div>
      </div>
      <label class="ib2-check wide"><input type="checkbox" data-or-add-board ${settings.addToBoard !== false ? 'checked' : ''}> Put finished images directly on this board (off = save them to the Inbox)</label>
      <div class="ib2-modal-actions wide">
        <button data-or-refresh>Refresh models + prices</button>
        <button class="primary ib2-or-generate" data-or-generate>✦ Generate</button>
      </div>
      <div class="wide ib2-or-results" data-or-results></div>
      <div class="wide ib2-muted">Uses the OpenRouter API key already stored by SillyTavern. v0.5.8 uses OpenRouter's dedicated Images API when the updated Inspiration Board Sync server plugin is installed.</div>
    </div>
  `, 'ib2-openrouter-modal');

  const status = modal.querySelector('[data-or-status]');
  const modelSelect = modal.querySelector('[data-or-model]');
  const aspectSelect = modal.querySelector('[data-or-aspect]');
  const countSelect = modal.querySelector('[data-or-count]');
  const refSourceSelect = modal.querySelector('[data-or-ref-source]');
  const useRefsCheckbox = modal.querySelector('[data-or-use-refs]');
  const addBoardCheckbox = modal.querySelector('[data-or-add-board]');
  const promptInput = modal.querySelector('[data-or-prompt]');
  const refStrip = modal.querySelector('[data-or-refs]');
  const refNote = modal.querySelector('[data-or-ref-note]');
  const modelInfo = modal.querySelector('[data-or-model-info]');
  const results = modal.querySelector('[data-or-results]');
  const generateButton = modal.querySelector('[data-or-generate]');
  let models = [];
  let currentRefs = referenceItems;
  let bridge = { ok: false, modernImages: false, version: null };
  let controller = null;
  let promptSaveTimer = null;

  const setStatus = (message, type = '') => {
    status.textContent = message;
    status.classList.toggle('error', type === 'error');
    status.classList.toggle('good', type === 'good');
  };

  const selectedModel = () => models.find(model => (model.id || model.value) === modelSelect.value) || null;

  const currentSettings = () => ({
    model: modelSelect.value || DEFAULT_MODEL,
    aspectRatio: aspectSelect.value || '1:1',
    count: Number(countSelect.value) || 1,
    referenceSource: refSourceSelect.value || 'auto',
    useReferences: Boolean(useRefsCheckbox.checked),
    addToBoard: Boolean(addBoardCheckbox.checked),
    prompt: promptInput.value || '',
  });

  const persist = () => saveSettings(currentSettings());

  const rebuildAspectOptions = model => {
    const values = modelAspectRatios(model);
    const preferred = values.includes(aspectSelect.value) ? aspectSelect.value : values.includes(settings.aspectRatio) ? settings.aspectRatio : values[0];
    aspectSelect.innerHTML = values.map(value => `<option value="${safeAttr(value)}" ${value === preferred ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  };

  const rebuildCountOptions = model => {
    const max = Math.min(10, modelOutputLimit(model));
    const values = Array.from({ length: max }, (_, index) => index + 1);
    const current = clamp(Number(countSelect.value) || Number(settings.count) || 1, 1, max);
    countSelect.innerHTML = values.map(value => `<option value="${value}" ${value === current ? 'selected' : ''}>${value}</option>`).join('');
  };

  const refreshModelInfo = () => {
    const model = selectedModel();
    if (!model) return;
    const cap = modelReferenceCapability(model);
    rebuildAspectOptions(model);
    rebuildCountOptions(model);
    const usableRefs = Math.min(currentRefs.length, cap.max || 0);
    useRefsCheckbox.disabled = !cap.supported || currentRefs.length === 0;
    if (!cap.supported) useRefsCheckbox.checked = false;
    if (cap.required && currentRefs.length) useRefsCheckbox.checked = true;
    if (cap.required && currentRefs.length < cap.min) useRefsCheckbox.checked = false;
    const style = isStyleReferenceModel(model);
    refNote.textContent = !cap.supported
      ? 'This model does not support reference images through OpenRouter input_references.'
      : cap.required
        ? `${style ? 'Style references are required' : 'References are required'} · send ${cap.min}–${cap.max}. ${usableRefs}/${currentRefs.length || 0} currently usable.`
        : `References are optional · up to ${cap.max}. ${usableRefs}/${currentRefs.length || 0} currently usable.`;
    modelInfo.innerHTML = modelInfoHtml(model, Number(countSelect.value) || 1, currentRefs.length);
    generateButton.disabled = Boolean(cap.required && (currentRefs.length < cap.min || !useRefsCheckbox.checked));
    persist();
  };

  const refreshRefs = async () => {
    currentRefs = await renderReferenceStrip(app, refStrip, refSourceSelect.value);
    const model = selectedModel();
    if (model) refreshModelInfo();
    else {
      useRefsCheckbox.disabled = currentRefs.length === 0;
      if (!currentRefs.length) useRefsCheckbox.checked = false;
    }
    useRefsCheckbox.parentElement.lastChild.textContent = ` Send the reference images to the generation model (${currentRefs.length} available)`;
    persist();
  };

  const refreshModelOption = model => {
    const id = model.id || model.value;
    const option = [...modelSelect.options].find(candidate => candidate.value === id);
    if (option) option.textContent = modelOptionLabel(model);
  };

  const refreshModels = async (force = false) => {
    setStatus('Loading OpenRouter image models + live capabilities…');
    try {
      const [loadedModels, credits, bridgeStatus] = await Promise.all([
        loadOpenRouterModels({ force }),
        loadOpenRouterCredits(),
        fetchBridgeStatus(),
      ]);
      bridge = bridgeStatus;
      models = loadedModels.filter(model => Boolean(model.dedicatedImage));
      const selected = modelSelect.value || settings.model || DEFAULT_MODEL;
      modelSelect.innerHTML = modelOptions(models, selected);
      if (!modelSelect.value && models.length) modelSelect.value = models[0].id || models[0].value;
      const remaining = Number(credits?.remaining);
      const bridgeText = bridge.modernImages ? `Images bridge v${bridge.version}` : `server plugin ${bridge.version || 'missing/old'} · modern refs unavailable`;
      setStatus(Number.isFinite(remaining)
        ? `OpenRouter ready · $${remaining.toFixed(2)} credit remaining · ${models.length} image models · ${bridgeText}`
        : `OpenRouter ready · ${models.length} image models · ${bridgeText}`, bridge.modernImages ? 'good' : '');
      refreshModelInfo();

      void enrichOpenRouterImagePricing(models, {
        selectedId: modelSelect.value,
        onUpdate: model => {
          if (!modal.isConnected) return;
          refreshModelOption(model);
          if ((model.id || model.value) === modelSelect.value) modelInfo.innerHTML = modelInfoHtml(model, Number(countSelect.value) || 1, currentRefs.length);
        },
      }).then(() => {
        if (!modal.isConnected) return;
        models.forEach(refreshModelOption);
        refreshModelInfo();
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  await refreshRefs();
  void refreshModels(false);

  modelSelect.onchange = () => { refreshModelInfo(); persist(); };
  aspectSelect.onchange = persist;
  countSelect.onchange = () => { modelInfo.innerHTML = modelInfoHtml(selectedModel(), Number(countSelect.value) || 1, currentRefs.length); persist(); };
  refSourceSelect.onchange = () => void refreshRefs();
  useRefsCheckbox.onchange = () => { refreshModelInfo(); persist(); };
  addBoardCheckbox.onchange = persist;
  promptInput.addEventListener('input', () => {
    clearTimeout(promptSaveTimer);
    promptSaveTimer = setTimeout(persist, 180);
  });
  modal.querySelector('[data-or-refresh]').onclick = () => void refreshModels(true);

  const observer = new MutationObserver(() => {
    if (modal.isConnected) return;
    clearTimeout(promptSaveTimer);
    persist();
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  generateButton.onclick = async () => {
    const userPrompt = promptInput.value.trim();
    if (!userPrompt) return setStatus('Write a prompt first.', 'error');
    const modelId = modelSelect.value.trim();
    const model = selectedModel();
    if (!modelId || !model) return setStatus('Choose an OpenRouter image model.', 'error');

    const cap = modelReferenceCapability(model);
    const aspectRatio = aspectSelect.value;
    const count = clamp(Number(countSelect.value) || 1, 1, modelOutputLimit(model));
    const useReferences = useRefsCheckbox.checked && currentRefs.length > 0 && cap.supported;
    const addToBoard = addBoardCheckbox.checked;
    if (cap.required && !useReferences) return setStatus(`${model.name || modelId} requires at least ${cap.min} reference image${cap.min === 1 ? '' : 's'}.`, 'error');
    if (cap.required && currentRefs.length < cap.min) return setStatus(`${model.name || modelId} requires ${cap.min}–${cap.max} references; only ${currentRefs.length} are available.`, 'error');
    if (useReferences && !bridge.modernImages) return setStatus(`Update Inspiration Board Sync to v${REQUIRED_PLUGIN_VERSION}+ and restart SillyTavern. The current server plugin cannot send OpenRouter input_references correctly.`, 'error');

    persist();
    generateButton.disabled = true;
    generateButton.textContent = '↗ Sending…';
    results.innerHTML = '';
    controller?.abort();
    controller = new AbortController();

    try {
      const refs = useReferences ? await referencePayload(app, currentRefs, model) : [];
      if (cap.required && refs.length < cap.min) throw new Error(`${model.name || modelId} requires at least ${cap.min} valid reference image${cap.min === 1 ? '' : 's'}.`);
      const prompt = buildPrompt(userPrompt, refs, model);
      const estimate = modelBatchEstimate(model, count);
      setStatus(`Sending ${count} image${count === 1 ? '' : 's'} · ${model.name || modelId}${refs.length ? ` · ${refs.length} reference${refs.length === 1 ? '' : 's'}` : ''}${estimate ? ` · est. ${estimate.exact ? '' : 'from '}${money(estimate.total)}` : ''}…`);

      app.snapshotUndo();
      await app.createPersistentSnapshot?.('Before OpenRouter generation', true);
      const response = await requestImages({ model: modelId, prompt, refs, aspectRatio, count, signal: controller.signal, bridge });
      const generated = response.images;
      for (let index = 0; index < generated.length; index++) {
        const result = generated[index];
        const metadata = {
          model: modelId,
          userPrompt,
          prompt,
          aspectRatio,
          referenceItemIds: currentRefs.slice(0, cap.max || 0).map(item => item.id),
          total: generated.length,
          usageCost: response.usage?.cost ?? null,
        };
        if (addToBoard) await storeGeneratedResult(app, result, metadata, index);
        else await storeGeneratedInbox(app, result, metadata, index);
        results.insertAdjacentHTML('beforeend', `<div class="ib2-or-result"><img src="${result.dataUrl}" alt="Generated image"><div class="ib2-or-result-actions"><button data-or-download="${index}">Save</button></div></div>`);
      }

      results.querySelectorAll('[data-or-download]').forEach(button => {
        button.onclick = () => {
          const index = Number(button.dataset.orDownload);
          const result = generated[index];
          if (!result) return;
          const anchor = document.createElement('a');
          anchor.href = result.dataUrl;
          anchor.download = `openrouter-${Date.now()}-${index + 1}.${result.format === 'jpeg' ? 'jpg' : result.format}`;
          anchor.click();
        };
      });

      app.scheduleSave();
      await app.renderItems?.();
      app.renderDrawer?.();
      app.renderInboxButton?.();
      app.renderMinimap?.();
      const actualCost = Number(response.usage?.cost);
      const costText = Number.isFinite(actualCost) ? ` · actual cost ${money(actualCost)}` : '';
      setStatus(`${generated.length} image${generated.length === 1 ? '' : 's'} generated and ${addToBoard ? 'added to the board' : 'saved to the Inbox'}${costText}.`, 'good');
      app.toast(`OpenRouter generated ${generated.length} image${generated.length === 1 ? '' : 's'}${costText}.`, 'success');
    } catch (error) {
      if (error?.name === 'AbortError') setStatus('Generation cancelled.', 'error');
      else {
        console.error('[Inspiration Board] OpenRouter Quick Generate failed', error);
        setStatus(error instanceof Error ? error.message : String(error), 'error');
        app.toast(error instanceof Error ? error.message : 'OpenRouter generation failed.', 'error');
      }
    } finally {
      generateButton.textContent = '✦ Generate';
      generateButton.disabled = false;
      refreshModelInfo();
    }
  };
}

function ensureRailButton(app) {
  const root = app.root || document.getElementById('st-inspiration-board');
  const rail = root?.querySelector('.ib2-rail');
  if (!rail) return false;
  let button = rail.querySelector('[data-cmd="openrouter-gen"]');
  if (!button) {
    button = document.createElement('button');
    button.dataset.cmd = 'openrouter-gen';
    button.className = 'ib2-openrouter-rail';
    button.innerHTML = '<span>🎨</span><label>Generate</label>';
    const aiButton = rail.querySelector('[data-cmd="ai"]');
    if (aiButton?.nextSibling) rail.insertBefore(button, aiButton.nextSibling);
    else rail.appendChild(button);
  }
  button.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    void openOpenRouterGenerator(app);
  };
  return true;
}

export function installOpenRouterGenerator(app) {
  if (!app) return false;
  injectGeneratorStyles();
  ensureRailButton(app);
  installedFor = app;
  return Boolean(installedFor);
}
