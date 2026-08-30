import { ROLE_LABELS, clamp, makeImageItem, staggerPositions } from './core-v2.js';
import { blobToDataUrl, createImageRecord, getImage, putImage } from './db-v2.js';

const VERSION = '0.6.1';
const PLUGIN_BASE = '/api/plugins/inspiration-board-sync';
const SETTINGS_KEY = 'st_inspiration_board_venice_gen_v60';
const PROVIDER_KEY = 'st_inspiration_board_media_provider_v60';
const MAX_REFS = 7;
const completedVideos = [];
let openOpenRouterCallback = null;
let lastApp = null;

const defaults = Object.freeze({
  media: 'image',
  imageModel: '',
  videoModel: '',
  search: '',
  task: 'all',
  safety: 'all',
  sort: 'recommended',
  aspectRatio: '1:1',
  resolution: '',
  duration: '5s',
  variants: 1,
  safeMode: false,
  audio: false,
  referenceSource: 'auto',
  addToBoard: true,
  prompt: '',
  negativePrompt: '',
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function getHeaders() {
  const context = globalThis.SillyTavern?.getContext?.();
  return context?.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
}

function loadSettings() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...defaults }; }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaults, ...settings }));
}

async function api(path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`${PLUGIN_BASE}${path}`, {
    method,
    headers: getHeaders(),
    cache: 'no-store',
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.clone().json();
      detail = data?.error?.message || data?.error || data?.message || '';
    } catch {
      try { detail = await response.text(); } catch {}
    }
    throw new Error(`${detail || `HTTP ${response.status}`}`);
  }
  return response;
}

function modelSpec(model) { return model?.model_spec || {}; }
function constraints(model) { return modelSpec(model)?.constraints || {}; }
function modelName(model) { return modelSpec(model)?.name || model?.name || model?.id || 'Unknown model'; }
function privacy(model) { return String(modelSpec(model)?.privacy || '').toLowerCase(); }

function modelCapabilities(model) {
  const value = modelSpec(model)?.capabilities;
  return value && typeof value === 'object' ? value : {};
}

const DOCUMENTED_MULTI_EDIT_MODELS = new Set([
  'flux-2-max-edit',
  'gpt-image-1-5-edit',
  'gpt-image-2-edit',
  'grok-imagine-edit',
  'grok-imagine-image-2-0-edit',
  'grok-imagine-quality-edit',
  'qwen-image-3-edit',
  'qwen-image-3-pro-edit',
  'seedream-v5-pro-edit',
]);

function pricingMentionsExtraImage(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, entry] of Object.entries(value)) {
    if (/extra.*image|additional.*image|image.*extra|image.*additional/i.test(key)) return true;
    if (entry && typeof entry === 'object' && pricingMentionsExtraImage(entry)) return true;
  }
  return false;
}

export function veniceEditReferenceLimit(model) {
  if (model?._kind !== 'inpaint') return 0;
  const capabilities = modelCapabilities(model);
  if (capabilities.supportsMultipleImages === true) return 3;
  if (capabilities.supportsMultipleImages === false) return 1;
  if (pricingMentionsExtraImage(modelSpec(model)?.pricing)) return 3;
  if (DOCUMENTED_MULTI_EDIT_MODELS.has(String(model?.id || '').toLowerCase())) return 3;
  return 1;
}

export function veniceModelTask(model) {
  if (model?._kind === 'inpaint') return 'edit';
  if (model?.type !== 'video' && model?._kind !== 'video') return 'generate';
  const id = String(model?.id || '').toLowerCase();
  // Reference-to-video models can still report the broad model_type as image-to-video.
  if (id.includes('reference-to-video')) return 'reference-to-video';
  const raw = String(constraints(model)?.model_type || id).toLowerCase();
  if (raw.includes('reference-to-video')) return 'reference-to-video';
  if (raw.includes('image-to-video')) return 'image-to-video';
  if (raw.includes('upscale')) return 'upscale';
  return 'text-to-video';
}

export function veniceModelIsUncensored(model, traits = {}) {
  const id = String(model?.id || '').toLowerCase();
  const modelTraits = Array.isArray(modelSpec(model)?.traits) ? modelSpec(model).traits.map(value => String(value).toLowerCase()) : [];
  if (traits?.most_uncensored && String(traits.most_uncensored) === String(model?.id || '')) return true;
  if (modelTraits.some(value => value.includes('uncensored'))) return true;
  if (id.includes('uncensored') || id.startsWith('lustify-') || id.includes('wan-2-7-enhanced')) return true;
  const description = String(modelSpec(model)?.description || '').toLowerCase();
  return description.includes('uncensored') || description.includes('adult generation');
}

export function veniceImagePrice(model) {
  const pricing = modelSpec(model)?.pricing || {};
  const direct = model?._kind === 'inpaint' ? pricing?.inpaint?.usd : pricing?.generation?.usd;
  if (Number.isFinite(Number(direct))) return { min: Number(direct), max: Number(direct), exact: true };
  const rows = Object.values(pricing?.resolutions || {}).map(value => Number(value?.usd)).filter(Number.isFinite);
  const qualityRows = Object.values(pricing?.quality || {}).flatMap(tier => Object.values(tier || {}).map(value => Number(value?.usd))).filter(Number.isFinite);
  const prices = [...rows, ...qualityRows];
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices), exact: Math.min(...prices) === Math.max(...prices) };
}

function priceText(model) {
  const price = veniceImagePrice(model);
  if (!price) return model?.type === 'video' || model?._kind === 'video' ? 'quote on select' : 'price unavailable';
  if (price.exact) return `$${price.min < 0.01 ? price.min.toFixed(4) : price.min.toFixed(2)}/img`;
  return `from $${price.min < 0.01 ? price.min.toFixed(4) : price.min.toFixed(2)}/img`;
}

function taskLabel(task) {
  return ({ generate: 'Image', edit: 'Edit / Ref', 'text-to-video': 'Text→Video', 'image-to-video': 'Image→Video', 'reference-to-video': 'Reference→Video', upscale: 'Upscale' })[task] || task;
}

function modelLabel(model, traits) {
  const badges = [priceText(model), taskLabel(veniceModelTask(model))];
  if (veniceModelIsUncensored(model, traits)) badges.push('🔓 Uncensored/NSFW');
  const privacyValue = privacy(model);
  if (privacyValue) badges.push(privacyValue === 'private' ? 'Private' : privacyValue === 'anonymized' ? 'Anonymized' : privacyValue);
  return `${modelName(model)} · ${badges.join(' · ')}`;
}

function listConstraint(model, ...keys) {
  const c = constraints(model);
  for (const key of keys) {
    const value = c?.[key];
    if (Array.isArray(value) && value.length) return value.map(String);
  }
  return [];
}

function allBasketIds(board) {
  const refs = board?.character?.references || {};
  return [...new Set(Object.values(refs).flatMap(value => Array.isArray(value) ? value : []).filter(Boolean))];
}

export function orderVeniceReferenceItems({ selected = [], basket = [], main = null, source = 'auto' } = {}) {
  const roleRank = { general: 0, face: 1, body: 2, hair: 3, outfit: 4, expression: 5, accessory: 6, prop: 7, mood: 8, environment: 9 };
  const sortedBasket = [...basket].sort((a, b) => (roleRank[a?.role] ?? 50) - (roleRank[b?.role] ?? 50));
  const unique = rows => {
    const seen = new Set();
    return rows.filter(item => {
      if (!item?.imageId) return false;
      if (seen.has(item.imageId)) return false;
      seen.add(item.imageId);
      return true;
    });
  };
  if (source === 'main') return main?.imageId ? [main] : [];
  if (source === 'basket') return unique(sortedBasket);
  if (source === 'selected') {
    const selectedHasMain = Boolean(main?.imageId && selected.some(item => item?.imageId === main.imageId));
    return unique(selectedHasMain ? [main, ...selected] : selected);
  }
  if (selected.length) {
    const selectedHasMain = Boolean(main?.imageId && selected.some(item => item?.imageId === main.imageId));
    return unique(selectedHasMain ? [main, ...selected] : selected);
  }
  if (main?.imageId) return unique([main, ...sortedBasket]);
  return unique(sortedBasket);
}

function getReferenceItems(app, source = 'auto') {
  const board = app.activeBoard();
  const selected = [...app.selectedIds].map(id => app.itemById(id)).filter(item => item?.type === 'image');
  const basket = allBasketIds(board).map(id => app.itemById(id)).filter(item => item?.type === 'image');
  const main = board.character?.mainImageId ? app.itemById(board.character.mainImageId) : null;
  return orderVeniceReferenceItems({ selected, basket, main, source }).slice(0, MAX_REFS);
}

function referenceItemLabel(app, item) {
  const board = app.activeBoard();
  if (item?.imageId && item.imageId === board.character?.mainImageId) return 'Main portrait';
  const role = ROLE_LABELS[item?.role] || item?.role || 'Reference';
  return item?.name ? `${role} · ${item.name}` : role;
}

function editReferencePlan(app, items, model) {
  const limit = veniceEditReferenceLimit(model);
  const sent = items.slice(0, limit);
  if (!sent.length) return { limit, sent, text: 'Reference ACTIVE · no source image is currently available.' };
  const base = referenceItemLabel(app, sent[0]);
  const extras = Math.max(0, items.length - sent.length);
  return {
    limit,
    sent,
    text: `Reference ACTIVE · ${sent.length} source image${sent.length === 1 ? '' : 's'} will be sent · Base: ${base}${extras ? ` · ${extras} extra board ref${extras === 1 ? '' : 's'} not sent to this model` : ''}`,
  };
}

async function referenceData(app, items, max = MAX_REFS) {
  const rows = [];
  for (const item of items.slice(0, max)) {
    const record = await getImage(item.imageId);
    if (!record?.blob) continue;
    rows.push({ item, record, dataUrl: await blobToDataUrl(record.blob) });
  }
  return rows;
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function storeImage(app, result, metadata, addToBoard, index, total) {
  const ext = result.format === 'jpeg' ? 'jpg' : result.format;
  const mime = result.format === 'jpeg' ? 'image/jpeg' : result.format === 'png' ? 'image/png' : 'image/webp';
  const blob = base64ToBlob(result.image, mime);
  const file = new File([blob], `venice-${Date.now()}-${index + 1}.${ext}`, { type: mime });
  const record = await createImageRecord(file, { sourceUrl: `venice:${metadata.model}` });
  record.generated = { provider: 'venice', ...metadata, createdAt: Date.now() };
  await putImage(record);
  if (!addToBoard) {
    const entry = app.ensureInboxEntry(record, { sourceUrl: `venice:${metadata.model}` });
    entry.tags = ['generated', 'venice'];
    entry.notes = metadata.prompt;
    return;
  }
  const board = app.activeBoard();
  const ratio = record.width / Math.max(1, record.height);
  const width = ratio >= 1 ? 360 : 290;
  const height = clamp(width / Math.max(ratio, 0.05), 190, 500);
  const center = app.canvasCenterWorld();
  const pos = staggerPositions(total, center.x, center.y, width, height)[index] || center;
  const item = makeImageItem({ imageId: record.id, name: `Venice · ${metadata.model.split('/').pop() || metadata.model}`, width, height, x: pos.x, y: pos.y, sourceUrl: `venice:${metadata.model}` });
  item.tags = ['generated', 'venice'];
  item.notes = metadata.prompt;
  item.generated = record.generated;
  board.items.push(item);
  board.updatedAt = Date.now();
}

function ensureStyles() {
  if (document.getElementById('ib60-venice-style')) return;
  const style = document.createElement('style');
  style.id = 'ib60-venice-style';
  style.textContent = `
    .ib60-venice-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.ib60-venice-grid .wide{grid-column:1/-1}.ib60-provider-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ib60-provider-tabs button{min-height:38px;border:1px solid var(--ib2-line,#343446);border-radius:11px;background:#15151f;color:#ddd;font-weight:700}.ib60-provider-tabs button.active{background:linear-gradient(135deg,#906cff,#6244d6);color:#fff;border-color:#8f73ef}.ib60-media-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ib60-media-tabs button.active{background:#2b214a;color:#fff;border-color:#765cc8}
    .ib60-venice-tools{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ib60-venice-tools .search{grid-column:1/-1}.ib60-model-list{width:100%;min-height:168px;max-height:245px}.ib60-model-info{padding:9px;border:1px solid var(--ib2-line,#343446);border-radius:11px;background:#101018;font-size:10px;line-height:1.45}.ib60-model-info b{color:#fff}.ib60-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.ib60-badge{padding:3px 6px;border-radius:999px;background:#201d2b;border:1px solid #3b3650;font-size:9px}.ib60-badge.uncensored{background:#3a172d;border-color:#813864;color:#ffb7dc}.ib60-badge.private{background:#173126;border-color:#315f4b;color:#a9f2c9}
    .ib60-key-box{padding:10px;border:1px solid #514378;border-radius:12px;background:#171326}.ib60-key-row{display:grid;grid-template-columns:1fr auto;gap:7px}.ib60-status{padding:9px 10px;border:1px solid var(--ib2-line,#343446);border-radius:10px;background:#11111a;font-size:10px;line-height:1.45}.ib60-status.good{color:#9effbd;border-color:#28583b}.ib60-status.error{color:#ff9ca8;border-color:#713441}.ib60-ref-strip{display:flex;gap:7px;overflow-x:auto;min-height:72px}.ib60-ref{position:relative;flex:0 0 62px;height:78px;border-radius:9px;overflow:hidden;border:1px solid #343446}.ib60-ref img{width:100%;height:100%;object-fit:cover}.ib60-ref span{position:absolute;left:2px;right:2px;bottom:2px;background:#09090cdd;border-radius:5px;padding:2px;font-size:8px;text-align:center}
    .ib60-video-results{display:grid;gap:14px}.ib60-video-card{padding:10px;border:1px solid #343446;border-radius:14px;background:#0d0d14}.ib60-video-card video{width:100%;max-height:72vh;background:#060609;border-radius:10px}.ib60-video-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.ib60-job-chip{position:fixed;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:1000001;max-width:min(360px,calc(100vw - 24px));padding:9px 12px;border:1px solid #5b4d85;border-radius:999px;background:#171326ee;color:#fff;font-size:10px;box-shadow:0 8px 24px #0008;display:none}.ib60-job-chip.show{display:block}
    @media(max-width:700px){.ib60-venice-grid{grid-template-columns:1fr}.ib60-venice-grid .wide{grid-column:1}.ib60-venice-tools{grid-template-columns:1fr 1fr}.ib60-key-row{grid-template-columns:1fr}.ib60-job-chip{bottom:calc(68px + env(safe-area-inset-bottom))}}
  `;
  document.head.appendChild(style);
}

function ensureJobChip() {
  let chip = document.querySelector('[data-ib60-venice-job]');
  if (chip) return chip;
  chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'ib60-job-chip';
  chip.dataset.ib60VeniceJob = '1';
  chip.onclick = () => lastApp && openVeniceGenerator(lastApp, { openOpenRouter: openOpenRouterCallback });
  document.body.appendChild(chip);
  return chip;
}

function jobStatus(message, done = false) {
  const chip = ensureJobChip();
  chip.textContent = message;
  chip.classList.add('show');
  if (done) setTimeout(() => chip.classList.remove('show'), 12_000);
}

function renderCompletedVideos(container) {
  if (!container) return;
  container.innerHTML = completedVideos.map((entry, index) => `
    <div class="ib60-video-card">
      <video controls playsinline src="${entry.url}"></video>
      <div class="ib60-video-actions"><button data-v-video-full="${index}">View full</button><button data-v-video-save="${index}">Save MP4</button></div>
      <div class="ib2-muted">${escapeHtml(entry.model)}${entry.quote != null ? ` · $${Number(entry.quote).toFixed(3)}` : ''}</div>
    </div>`).join('');
  container.querySelectorAll('[data-v-video-full]').forEach(button => button.onclick = () => container.querySelectorAll('video')[Number(button.dataset.vVideoFull)]?.requestFullscreen?.());
  container.querySelectorAll('[data-v-video-save]').forEach(button => button.onclick = () => {
    const entry = completedVideos[Number(button.dataset.vVideoSave)];
    if (!entry) return;
    const anchor = document.createElement('a');
    anchor.href = entry.url;
    anchor.download = `venice-${Date.now()}.mp4`;
    anchor.click();
  });
}

function optionHtml(values, selected) {
  return values.map(value => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
}

async function renderRefs(app, container, source) {
  const items = getReferenceItems(app, source);
  if (!items.length) {
    container.innerHTML = '<span class="ib2-muted">No board references found for this source.</span>';
    return items;
  }
  const rows = await Promise.all(items.map(async item => ({ item, url: await app.imageUrl(item.imageId, true) })));
  container.innerHTML = rows.map(({ item, url }) => `<div class="ib60-ref"><img src="${url}" alt=""><span>${escapeHtml(ROLE_LABELS[item.role] || item.role || 'Reference')}</span></div>`).join('');
  return items;
}

function sortModels(models, sortMode) {
  const rows = [...models];
  rows.sort((a, b) => {
    if (sortMode === 'name') return modelName(a).localeCompare(modelName(b));
    if (sortMode === 'newest') return Number(b.created || 0) - Number(a.created || 0);
    if (sortMode.startsWith('price')) {
      const pa = veniceImagePrice(a)?.min ?? Number.POSITIVE_INFINITY;
      const pb = veniceImagePrice(b)?.min ?? Number.POSITIVE_INFINITY;
      return sortMode === 'price-desc' ? pb - pa : pa - pb;
    }
    const aOffline = modelSpec(a)?.offline ? 1 : 0;
    const bOffline = modelSpec(b)?.offline ? 1 : 0;
    return aOffline - bOffline || modelName(a).localeCompare(modelName(b));
  });
  return rows;
}

function balanceText(payload) {
  const candidates = [payload?.balances?.usd, payload?.balance?.usd, payload?.usd, payload?.balance, payload?.available_balance, payload?.available];
  const value = candidates.map(Number).find(Number.isFinite);
  return Number.isFinite(value) ? `$${value.toFixed(2)} Venice balance` : '';
}

export async function openVeniceGenerator(app, { openOpenRouter } = {}) {
  if (!app) return false;
  lastApp = app;
  if (typeof openOpenRouter === 'function') openOpenRouterCallback = openOpenRouter;
  localStorage.setItem(PROVIDER_KEY, 'venice');
  ensureStyles();
  ensureJobChip();
  const settings = loadSettings();
  const modal = app.showModal('Generate media · Venice', `
    <div class="ib60-venice-grid">
      <div class="wide ib60-provider-tabs"><button type="button" data-v-provider-or>OpenRouter</button><button type="button" class="active">Venice</button></div>
      <div class="wide ib60-media-tabs"><button type="button" data-v-media="image" class="${settings.media === 'image' ? 'active' : ''}">Image</button><button type="button" data-v-media="video" class="${settings.media === 'video' ? 'active' : ''}">Video</button></div>
      <div class="wide ib60-status" data-v-status>Checking Venice API setup…</div>
      <div class="wide ib60-key-box" data-v-key-box hidden>
        <b>Venice API key</b><div class="ib2-muted">Stored server-side in SillyTavern secrets.json. It is never returned to this browser after saving.</div>
        <div class="ib60-key-row"><input type="password" data-v-key placeholder="Paste Venice API key"><button type="button" data-v-save-key>Save + test key</button></div>
      </div>
      <div class="wide ib60-venice-tools" data-v-tools hidden>
        <input class="search" type="search" data-v-search placeholder="Search Venice models…" value="${escapeHtml(settings.search)}">
        <select data-v-task></select><select data-v-safety><option value="all">All safety modes</option><option value="uncensored">Uncensored / NSFW-capable</option><option value="standard">Standard / other</option></select>
        <select data-v-sort><option value="recommended">Recommended / available</option><option value="price-asc">Price · low to high</option><option value="price-desc">Price · high to low</option><option value="newest">Newest</option><option value="name">Name</option></select>
        <button type="button" data-v-refresh>Refresh models</button>
      </div>
      <label class="wide" data-v-model-wrap hidden>Model<select class="ib60-model-list" size="7" data-v-model></select></label>
      <div class="wide ib60-model-info" data-v-model-info hidden></div>
      <div class="wide" data-v-params hidden>
        <div class="ib60-venice-grid">
          <label data-v-aspect-wrap>Aspect ratio<select data-v-aspect></select></label>
          <label data-v-resolution-wrap>Resolution<select data-v-resolution></select></label>
          <label data-v-duration-wrap hidden>Duration<select data-v-duration></select></label>
          <label data-v-variants-wrap>Images<select data-v-variants>${optionHtml(['1','2','3','4'], settings.variants)}</select></label>
          <label class="ib2-check" data-v-safe-wrap><input type="checkbox" data-v-safe ${settings.safeMode ? 'checked' : ''}> Safe mode · blur adult content</label>
          <label class="ib2-check" data-v-audio-wrap hidden><input type="checkbox" data-v-audio ${settings.audio ? 'checked' : ''}> Generate audio when supported</label>
          <label>Reference source<select data-v-ref-source><option value="auto">Auto · selected, basket, main</option><option value="selected">Selected images</option><option value="basket">Reference basket</option><option value="main">Main portrait</option></select></label>
          <label class="ib2-check" data-v-board-wrap><input type="checkbox" data-v-board ${settings.addToBoard ? 'checked' : ''}> Put finished images on board</label>
          <div class="wide ib60-ref-strip" data-v-refs></div>
          <label class="wide">Prompt<textarea rows="5" data-v-prompt placeholder="Describe the image or video…">${escapeHtml(settings.prompt)}</textarea></label>
          <label class="wide">Negative prompt <span class="ib2-muted">(optional)</span><textarea rows="2" data-v-negative>${escapeHtml(settings.negativePrompt)}</textarea></label>
          <div class="wide ib60-status" data-v-quote>Choose a model to see pricing and capabilities.</div>
          <div class="wide ib2-modal-actions"><button type="button" data-v-remove-key>Remove Venice key</button><button type="button" class="primary" data-v-generate>Generate</button></div>
          <div class="wide" data-or-results></div>
          <div class="wide ib60-video-results" data-v-video-results></div>
        </div>
      </div>
    </div>`, 'ib60-venice-modal');

  const q = selector => modal.querySelector(selector);
  const status = q('[data-v-status]');
  const keyBox = q('[data-v-key-box]');
  const tools = q('[data-v-tools]');
  const modelWrap = q('[data-v-model-wrap]');
  const modelSelect = q('[data-v-model]');
  const modelInfo = q('[data-v-model-info]');
  const params = q('[data-v-params]');
  const search = q('[data-v-search]');
  const task = q('[data-v-task]');
  const safety = q('[data-v-safety]');
  const sort = q('[data-v-sort]');
  const aspect = q('[data-v-aspect]');
  const resolution = q('[data-v-resolution]');
  const duration = q('[data-v-duration]');
  const variants = q('[data-v-variants]');
  const safeMode = q('[data-v-safe]');
  const audio = q('[data-v-audio]');
  const refSource = q('[data-v-ref-source]');
  const addBoard = q('[data-v-board]');
  const refsStrip = q('[data-v-refs]');
  const prompt = q('[data-v-prompt]');
  const negative = q('[data-v-negative]');
  const quoteBox = q('[data-v-quote]');
  const generate = q('[data-v-generate]');
  const imageResults = q('[data-or-results]');
  const videoResults = q('[data-v-video-results]');
  safety.value = settings.safety;
  sort.value = settings.sort;
  refSource.value = settings.referenceSource;
  let configured = false;
  let media = settings.media === 'video' ? 'video' : 'image';
  let models = [];
  let traits = {};
  let currentRefs = await renderRefs(app, refsStrip, refSource.value);
  let quoteTimer = null;

  const setStatus = (text, type = '') => {
    status.textContent = text;
    status.classList.toggle('good', type === 'good');
    status.classList.toggle('error', type === 'error');
  };

  const selectedModel = () => models.find(model => model.id === modelSelect.value) || null;
  const persist = () => {
    const next = {
      ...settings,
      media,
      imageModel: media === 'image' ? modelSelect.value : settings.imageModel,
      videoModel: media === 'video' ? modelSelect.value : settings.videoModel,
      search: search.value,
      task: task.value,
      safety: safety.value,
      sort: sort.value,
      aspectRatio: aspect.value,
      resolution: resolution.value,
      duration: duration.value,
      variants: Number(variants.value) || 1,
      safeMode: safeMode.checked,
      audio: audio.checked,
      referenceSource: refSource.value,
      addToBoard: addBoard.checked,
      prompt: prompt.value,
      negativePrompt: negative.value,
    };
    Object.assign(settings, next);
    saveSettings(next);
  };

  const updateTaskOptions = () => {
    const options = media === 'image'
      ? [['all','All image tasks'],['generate','Generate'],['edit','Edit / reference']]
      : [['all','All video tasks'],['text-to-video','Text → Video'],['image-to-video','Image → Video'],['reference-to-video','Reference → Video']];
    task.innerHTML = options.map(([value,label]) => `<option value="${value}" ${settings.task === value ? 'selected' : ''}>${label}</option>`).join('');
    if (![...task.options].some(option => option.value === settings.task)) task.value = 'all';
  };

  const filteredModels = () => {
    const query = search.value.trim().toLowerCase();
    return sortModels(models.filter(model => {
      if (modelSpec(model)?.offline) return false;
      const modelTask = veniceModelTask(model);
      if (task.value !== 'all' && modelTask !== task.value) return false;
      const uncensored = veniceModelIsUncensored(model, traits);
      if (safety.value === 'uncensored' && !uncensored) return false;
      if (safety.value === 'standard' && uncensored) return false;
      if (query && !`${modelName(model)} ${model.id} ${modelSpec(model)?.description || ''}`.toLowerCase().includes(query)) return false;
      return true;
    }), sort.value);
  };

  const refreshModelList = () => {
    const rows = filteredModels();
    const wanted = media === 'image' ? (settings.imageModel || modelSelect.value) : (settings.videoModel || modelSelect.value);
    modelSelect.innerHTML = rows.map(model => `<option value="${escapeHtml(model.id)}" ${model.id === wanted ? 'selected' : ''}>${escapeHtml(modelLabel(model, traits))}</option>`).join('');
    if (!modelSelect.value && rows.length) modelSelect.value = rows[0].id;
    refreshSelectedModel();
  };

  const refreshSelectedModel = () => {
    const model = selectedModel();
    if (!model) {
      modelInfo.innerHTML = 'No model matches these filters.';
      generate.disabled = true;
      return;
    }
    generate.disabled = false;
    const c = constraints(model);
    const uncensored = veniceModelIsUncensored(model, traits);
    const modelTask = veniceModelTask(model);
    const price = priceText(model);
    const privacyValue = privacy(model);
    modelInfo.innerHTML = `<b>${escapeHtml(modelName(model))}</b><div>${escapeHtml(modelSpec(model)?.description || '')}</div><div class="ib60-badges"><span class="ib60-badge">${escapeHtml(taskLabel(modelTask))}</span><span class="ib60-badge">${escapeHtml(price)}</span>${uncensored ? '<span class="ib60-badge uncensored">Uncensored / NSFW-capable</span>' : ''}${privacyValue ? `<span class="ib60-badge ${privacyValue === 'private' ? 'private' : ''}">${escapeHtml(privacyValue)}</span>` : ''}</div>`;

    const aspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
    const resolutions = listConstraint(model, 'resolutions');
    const durations = listConstraint(model, 'durations');
    q('[data-v-aspect-wrap]').hidden = !aspects.length;
    q('[data-v-resolution-wrap]').hidden = !resolutions.length;
    q('[data-v-duration-wrap]').hidden = media !== 'video';
    q('[data-v-variants-wrap]').hidden = media !== 'image' || modelTask === 'edit';
    q('[data-v-safe-wrap]').hidden = media !== 'image';
    const supportsAudioConfig = c.audio_configurable === true || c.supportsAudioConfig === true;
    q('[data-v-audio-wrap]').hidden = media !== 'video' || !supportsAudioConfig;
    q('[data-v-board-wrap]').hidden = media !== 'image';
    aspect.innerHTML = optionHtml(aspects.length ? aspects : ['1:1'], aspects.includes(settings.aspectRatio) ? settings.aspectRatio : aspects[0] || '1:1');
    resolution.innerHTML = optionHtml(resolutions.length ? resolutions : [''], resolutions.includes(settings.resolution) ? settings.resolution : resolutions[0] || '');
    duration.innerHTML = optionHtml(durations.length ? durations : ['5s','10s'], durations.includes(settings.duration) ? settings.duration : durations[0] || '5s');
    const requiresRefs = modelTask === 'edit' || modelTask === 'image-to-video' || modelTask === 'reference-to-video';
    if (media === 'image') {
      if (modelTask === 'edit') {
        const plan = editReferencePlan(app, currentRefs, model);
        refsStrip.style.opacity = '1';
        refSource.disabled = false;
        quoteBox.textContent = `${price} · ${plan.text}${uncensored ? ' · Uncensored/NSFW-capable model.' : ''}${safeMode.checked ? ' · Safe mode ON.' : ' · Safe mode OFF.'}`;
      } else {
        refsStrip.style.opacity = '.35';
        refSource.disabled = true;
        quoteBox.textContent = `${price} · References NOT sent for this model. Venice text-to-image generation uses /image/generate and does not accept board reference images. Choose an Edit / reference model to use a source image.${uncensored ? ' · Uncensored/NSFW-capable model.' : ''}`;
      }
    } else {
      refsStrip.style.opacity = requiresRefs ? '1' : '.35';
      refSource.disabled = modelTask === 'text-to-video';
      scheduleQuote();
    }
    persist();
  };

  const scheduleQuote = () => {
    clearTimeout(quoteTimer);
    const model = selectedModel();
    if (!configured || media !== 'video' || !model) return;
    const c = constraints(model);
    const modelAspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
    const modelResolutions = listConstraint(model, 'resolutions');
    const supportsAudioConfig = c.audio_configurable === true || c.supportsAudioConfig === true;
    quoteBox.textContent = 'Checking exact Venice video quote…';
    quoteTimer = setTimeout(async () => {
      try {
        const response = await api('/venice/video/quote', {
          method: 'POST',
          body: {
            model: model.id,
            duration: duration.value,
            resolution: modelResolutions.length ? resolution.value : undefined,
            aspect_ratio: modelAspects.length ? aspect.value : undefined,
            audio: supportsAudioConfig ? audio.checked : undefined,
          },
        });
        const data = await response.json();
        quoteBox.textContent = Number.isFinite(Number(data?.quote)) ? `Exact Venice quote: $${Number(data.quote).toFixed(3)} for this video.` : 'Venice returned a quote response without a numeric USD value.';
      } catch (error) {
        quoteBox.textContent = `Quote unavailable: ${error.message}`;
      }
    }, 280);
  };

  const loadCatalog = async () => {
    if (!configured) return;
    setStatus(`Loading Venice ${media} models…`);
    modelWrap.hidden = false;
    tools.hidden = false;
    modelInfo.hidden = false;
    params.hidden = false;
    try {
      if (media === 'image') {
        const [generationResponse, editResponse] = await Promise.all([api('/venice/models?type=image'), api('/venice/models?type=inpaint')]);
        const generation = await generationResponse.json();
        const edits = await editResponse.json();
        models = [...(generation.data || []).map(model => ({ ...model, _kind: 'image' })), ...(edits.data || []).map(model => ({ ...model, _kind: 'inpaint' }))];
        traits = { ...(generation.traits || {}), ...(edits.traits || {}) };
      } else {
        const response = await api('/venice/models?type=video');
        const data = await response.json();
        models = (data.data || []).map(model => ({ ...model, _kind: 'video' }));
        traits = data.traits || {};
      }
      updateTaskOptions();
      refreshModelList();
      let balance = '';
      try { balance = balanceText(await (await api('/venice/balance')).json()); } catch {}
      setStatus(`Venice ready · ${models.length} ${media} models${balance ? ` · ${balance}` : ''}`, 'good');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  };

  const checkSetup = async () => {
    try {
      const data = await (await api('/venice/status')).json();
      configured = Boolean(data.configured);
      keyBox.hidden = configured;
      if (!configured) {
        tools.hidden = true; modelWrap.hidden = true; modelInfo.hidden = true; params.hidden = true;
        setStatus('Venice support is installed, but no Venice API key is saved.');
      } else {
        await loadCatalog();
      }
    } catch (error) {
      configured = false;
      keyBox.hidden = false;
      setStatus(`Venice requires Inspiration Board Sync v0.6.0. Update the server plugin and restart SillyTavern. ${error.message}`, 'error');
    }
  };

  q('[data-v-provider-or]').onclick = () => {
    localStorage.setItem(PROVIDER_KEY, 'openrouter');
    modal.remove();
    openOpenRouterCallback?.(app);
  };
  modal.querySelectorAll('[data-v-media]').forEach(button => button.onclick = () => {
    media = button.dataset.vMedia;
    settings.media = media;
    modal.querySelectorAll('[data-v-media]').forEach(candidate => candidate.classList.toggle('active', candidate === button));
    imageResults.innerHTML = '';
    updateTaskOptions();
    persist();
    void loadCatalog();
  });
  q('[data-v-save-key]').onclick = async () => {
    const input = q('[data-v-key]');
    const key = input.value.trim();
    if (!key) return setStatus('Paste a Venice API key first.', 'error');
    setStatus('Testing Venice API key…');
    try {
      await api('/venice/key', { method: 'POST', body: { key } });
      input.value = '';
      configured = true;
      keyBox.hidden = true;
      await loadCatalog();
    } catch (error) { setStatus(error.message, 'error'); }
  };
  q('[data-v-remove-key]').onclick = async () => {
    try {
      await api('/venice/key', { method: 'DELETE' });
      configured = false;
      keyBox.hidden = false;
      tools.hidden = true; modelWrap.hidden = true; modelInfo.hidden = true; params.hidden = true;
      setStatus('Venice API key removed.');
    } catch (error) { setStatus(error.message, 'error'); }
  };
  q('[data-v-refresh]').onclick = () => void loadCatalog();
  [search].forEach(control => control.addEventListener('input', () => { persist(); refreshModelList(); }));
  [task, safety, sort].forEach(control => control.addEventListener('change', () => { persist(); refreshModelList(); }));
  modelSelect.onchange = () => { if (media === 'image') settings.imageModel = modelSelect.value; else settings.videoModel = modelSelect.value; refreshSelectedModel(); };
  [aspect, resolution, duration, variants, safeMode, audio, addBoard].forEach(control => control.addEventListener('change', () => { persist(); refreshSelectedModel(); }));
  refSource.onchange = async () => { currentRefs = await renderRefs(app, refsStrip, refSource.value); persist(); refreshSelectedModel(); };
  prompt.addEventListener('input', persist);
  negative.addEventListener('input', persist);

  generate.onclick = async () => {
    const model = selectedModel();
    const text = prompt.value.trim();
    if (!model || !text) return setStatus(!text ? 'Write a prompt first.' : 'Choose a model first.', 'error');
    persist();
    generate.disabled = true;
    generate.textContent = media === 'video' ? 'Queueing…' : 'Generating…';
    try {
      const modelTask = veniceModelTask(model);
      if (media === 'image') {
        const needsRefs = modelTask === 'edit';
        const referenceLimit = needsRefs ? veniceEditReferenceLimit(model) : 0;
        const refs = needsRefs ? await referenceData(app, currentRefs, referenceLimit) : [];
        if (needsRefs && !refs.length) throw new Error('This Venice edit/reference model needs at least one board reference image.');
        const referenceSendText = needsRefs ? ` · attaching ${refs.length} source image${refs.length === 1 ? '' : 's'} · Base: ${referenceItemLabel(app, refs[0].item)}` : ' · text-to-image · no references sent';
        setStatus(`Sending Venice image request · ${modelName(model)}${referenceSendText}${veniceModelIsUncensored(model, traits) ? ' · uncensored model' : ''}…`);
        const modelAspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
        const modelResolutions = listConstraint(model, 'resolutions');
        const response = await api('/venice/image', { method: 'POST', body: {
          model: model.id,
          prompt: text,
          negative_prompt: negative.value.trim(),
          aspect_ratio: modelAspects.length ? aspect.value : undefined,
          resolution: modelResolutions.length ? resolution.value : undefined,
          variants: needsRefs ? 1 : Number(variants.value) || 1,
          safe_mode: safeMode.checked,
          format: 'webp',
          references: refs.map(entry => entry.dataUrl),
        } });
        const data = await response.json();
        const images = (data.images || []).map(image => ({ image, format: data.format || 'webp' }));
        if (!images.length) throw new Error('Venice returned no image data.');
        app.snapshotUndo();
        await app.createPersistentSnapshot?.('Before Venice generation', true);
        imageResults.innerHTML = '';
        for (let index = 0; index < images.length; index++) {
          const result = images[index];
          await storeImage(app, result, { model: model.id, prompt: text, safeMode: safeMode.checked, total: images.length }, addBoard.checked, index, images.length);
          const mime = result.format === 'jpeg' ? 'image/jpeg' : result.format === 'png' ? 'image/png' : 'image/webp';
          const dataUrl = `data:${mime};base64,${result.image}`;
          imageResults.insertAdjacentHTML('beforeend', `<div class="ib2-or-result"><img src="${dataUrl}" alt="Venice generated image"><div class="ib2-or-result-actions"><button data-v-save-image="${index}">Save</button></div></div>`);
        }
        imageResults.querySelectorAll('[data-v-save-image]').forEach(button => button.onclick = () => {
          const result = images[Number(button.dataset.vSaveImage)];
          const mime = result.format === 'jpeg' ? 'image/jpeg' : result.format === 'png' ? 'image/png' : 'image/webp';
          const anchor = document.createElement('a'); anchor.href = `data:${mime};base64,${result.image}`; anchor.download = `venice-${Date.now()}.${result.format === 'jpeg' ? 'jpg' : result.format}`; anchor.click();
        });
        app.scheduleSave();
        await app.renderItems?.(); app.renderDrawer?.(); app.renderInboxButton?.(); app.renderMinimap?.();
        const moderation = data.blurred ? ' · output was blurred by Safe Venice' : data.contentViolation ? ' · Venice flagged a content violation' : '';
        const referenceReceipt = needsRefs
          ? ` · reference receipt: ${Number(data.reference_count ?? refs.length)} source image${Number(data.reference_count ?? refs.length) === 1 ? '' : 's'} via ${data.reference_endpoint || (refs.length > 1 ? '/image/multi-edit' : '/image/edit')}`
          : ' · no reference input';
        setStatus(`${images.length} Venice image${images.length === 1 ? '' : 's'} finished${referenceReceipt}${moderation}.`, data.blurred ? '' : 'good');
      } else {
        const refs = await referenceData(app, currentRefs, modelTask === 'reference-to-video' ? 7 : 1);
        if ((modelTask === 'image-to-video' || modelTask === 'reference-to-video') && !refs.length) throw new Error(`${taskLabel(modelTask)} requires at least one board reference image.`);
        let quote = null;
        try {
          const videoConstraints = constraints(model);
          const modelAspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
          const modelResolutions = listConstraint(model, 'resolutions');
          const supportsAudioConfig = videoConstraints.audio_configurable === true || videoConstraints.supportsAudioConfig === true;
          const quoteData = await (await api('/venice/video/quote', { method: 'POST', body: {
            model: model.id,
            duration: duration.value,
            resolution: modelResolutions.length ? resolution.value : undefined,
            aspect_ratio: modelAspects.length ? aspect.value : undefined,
            audio: supportsAudioConfig ? audio.checked : undefined,
          } })).json();
          quote = Number.isFinite(Number(quoteData?.quote)) ? Number(quoteData.quote) : null;
        } catch {}
        setStatus(`Queueing Venice video${quote != null ? ` · exact quote $${quote.toFixed(3)}` : ''}…`);
        jobStatus(`Venice video · queueing${quote != null ? ` · $${quote.toFixed(3)}` : ''}`);
        const videoConstraints = constraints(model);
        const videoAspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
        const videoResolutions = listConstraint(model, 'resolutions');
        const videoAudioConfigurable = videoConstraints.audio_configurable === true || videoConstraints.supportsAudioConfig === true;
        const queueData = await (await api('/venice/video/queue', { method: 'POST', body: {
          model: model.id,
          prompt: text,
          negative_prompt: negative.value.trim(),
          duration: duration.value,
          resolution: videoResolutions.length ? resolution.value : undefined,
          aspect_ratio: videoAspects.length ? aspect.value : undefined,
          audio: videoAudioConfigurable ? audio.checked : undefined,
          image_url: modelTask === 'image-to-video' ? refs[0]?.dataUrl : undefined,
          reference_entries: modelTask === 'reference-to-video' ? refs.map(entry => ({ url: entry.dataUrl, role: entry.item?.role || 'general' })) : [],
        } })).json();
        const queueId = queueData.queue_id;
        const queuedModel = queueData.model || model.id;
        setStatus(`Video queued ✓ · ${queueId.slice(0, 8)}… · waiting for Venice.`,'good');
        jobStatus(`Venice video · queued ✓ · ${modelName(model)}`);
        let attempts = 0;
        let videoBlob = null;
        while (attempts++ < 180) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          const response = await api('/venice/video/retrieve', { method: 'POST', body: { model: queuedModel, queue_id: queueId } });
          const type = String(response.headers.get('content-type') || '').toLowerCase();
          if (type.includes('video/mp4')) {
            videoBlob = await response.blob();
            break;
          }
          const data = await response.json();
          const execution = Number(data?.execution_duration || 0);
          const average = Number(data?.average_execution_time || 0);
          const remaining = average > execution ? Math.max(1, Math.round((average - execution) / 1000)) : null;
          const phase = String(data?.status || 'PROCESSING');
          setStatus(`Venice video · ${phase}${remaining ? ` · ~${remaining}s remaining` : ''}`);
          jobStatus(`Venice video · ${phase}${remaining ? ` · ~${remaining}s` : ''}`);
        }
        if (!videoBlob) throw new Error('Venice video did not finish before the 15-minute local polling limit. The queue may still be processing.');
        const url = URL.createObjectURL(videoBlob);
        completedVideos.unshift({ url, blob: videoBlob, model: queuedModel, quote, createdAt: Date.now() });
        renderCompletedVideos(videoResults);
        setStatus(`Venice video finished ✓${quote != null ? ` · $${quote.toFixed(3)}` : ''}`, 'good');
        jobStatus(`Venice video · Done ✓ · tap to view`, true);
        app.toast?.('Venice video generation finished.', 'success');
        void api('/venice/video/complete', { method: 'POST', body: { model: queuedModel, queue_id: queueId } }).catch(() => {});
      }
    } catch (error) {
      console.error('[Inspiration Board] Venice generation failed', error);
      setStatus(error.message, 'error');
      jobStatus(`Venice · Failed · ${error.message}`, true);
      app.toast?.(error.message, 'error');
    } finally {
      generate.disabled = false;
      generate.textContent = 'Generate';
    }
  };

  renderCompletedVideos(videoResults);
  await checkSetup();
  return true;
}

export function installVeniceGenerator({ openOpenRouter } = {}) {
  if (typeof openOpenRouter === 'function') openOpenRouterCallback = openOpenRouter;
  ensureStyles();
  ensureJobChip();
  return true;
}
