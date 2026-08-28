import { ROLE_LABELS, makeImageItem, staggerPositions, clamp } from './core-v2.js';
import { blobToDataUrl, createImageRecord, getImage, putImage } from './db-v2.js';

const SETTINGS_KEY = 'st_inspiration_board_openrouter_gen_v1';
const DEFAULT_MODEL = 'openai/gpt-image-1';
const MAX_REFERENCES = 8;

const defaultSettings = Object.freeze({
  model: DEFAULT_MODEL,
  aspectRatio: '1:1',
  count: 1,
  referenceSource: 'auto',
  useReferences: true,
  addToBoard: true,
});

let installedFor = null;

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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
  }).slice(0, MAX_REFERENCES);
}

async function referencePayload(app, items) {
  const board = app.activeBoard();
  const payload = [];
  for (const item of items) {
    const record = await getImage(item.imageId);
    if (!record) continue;
    const blob = record.thumbnail || record.blob;
    const dataUrl = await blobToDataUrl(blob);
    payload.push({
      item,
      role: roleForReference(board, item.id) || item.role || 'general',
      dataUrl,
    });
  }
  return payload;
}

function buildPrompt(userPrompt, refs) {
  if (!refs.length) return userPrompt.trim();
  const guide = refs.map((entry, index) => {
    const label = ROLE_LABELS[entry.role] || entry.role || 'Reference';
    return `Reference ${index + 1}: ${label}${entry.item.name ? ` (${entry.item.name})` : ''}`;
  }).join('\n');

  return [
    'Use the attached images as visual references for the requested image.',
    'Preserve character identity from face, hair, and body references. Use outfit references for clothing, accessory/prop references for details, and mood/environment references for atmosphere and setting.',
    'Do not turn the references into a collage and do not add extra characters unless the request asks for them.',
    guide,
    '',
    `Image request: ${userPrompt.trim()}`,
  ].join('\n');
}

async function fetchModels() {
  const response = await fetch('/api/openrouter/models/image', {
    method: 'POST',
    headers: getRequestHeaders(),
  });
  if (!response.ok) throw new Error(`Could not load OpenRouter image models (HTTP ${response.status}).`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchCredits() {
  const response = await fetch('/api/openrouter/credits', {
    method: 'POST',
    headers: getRequestHeaders(),
  });
  if (response.status === 400) throw new Error('No OpenRouter API key is saved in SillyTavern. Add it in API Connections first.');
  if (!response.ok) throw new Error(`Could not check OpenRouter credits (HTTP ${response.status}).`);
  return response.json();
}

async function requestImage({ model, prompt, refs, aspectRatio, signal }) {
  const content = refs.length ? [
    { type: 'text', text: prompt },
    ...refs.map(entry => ({
      type: 'image_url',
      image_url: { url: entry.dataUrl },
    })),
  ] : prompt;

  const response = await fetch('/api/openrouter/image/generate', {
    method: 'POST',
    headers: getRequestHeaders(),
    signal,
    body: JSON.stringify({
      model,
      prompt: content,
      aspect_ratio: aspectRatio,
    }),
  });

  if (!response.ok) {
    if (response.status === 400) throw new Error('OpenRouter API key is missing or the request is invalid. Configure OpenRouter in SillyTavern API Connections.');
    if (refs.length) throw new Error(`OpenRouter generation failed (HTTP ${response.status}). The selected model may not accept reference images. Try GPT Image or disable references.`);
    throw new Error(`OpenRouter generation failed (HTTP ${response.status}).`);
  }

  const result = await response.json();
  if (!result?.image) throw new Error('OpenRouter returned no image data.');
  const format = String(result.format || 'png').toLowerCase();
  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  return {
    ...result,
    format,
    mime,
    dataUrl: `data:${mime};base64,${result.image}`,
  };
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
  if (document.getElementById('ib2-openrouter-style')) return;
  const style = document.createElement('style');
  style.id = 'ib2-openrouter-style';
  style.textContent = `
    .ib2-or-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ib2-or-grid .wide{grid-column:1/-1}
    .ib2-or-ref-strip,.ib2-or-results{display:flex;gap:8px;overflow-x:auto;padding:6px 0;min-height:76px}
    .ib2-or-ref{position:relative;flex:0 0 66px;height:82px;border:1px solid var(--ib2-line,#343446);border-radius:10px;overflow:hidden;background:#181824}
    .ib2-or-ref img{width:100%;height:100%;object-fit:cover}.ib2-or-ref span{position:absolute;left:3px;right:3px;bottom:3px;padding:2px 3px;background:#08080bd9;border-radius:5px;font-size:8px;text-align:center}
    .ib2-or-result{flex:0 0 min(260px,70vw);display:flex;flex-direction:column;gap:6px}.ib2-or-result img{width:100%;max-height:310px;object-fit:contain;border-radius:12px;background:#090910}
    .ib2-or-result-actions{display:flex;gap:6px}.ib2-or-result-actions button{flex:1}
    .ib2-or-status{padding:8px 10px;border:1px solid var(--ib2-line,#343446);border-radius:10px;background:#11111a;font-size:11px;line-height:1.4}
    .ib2-or-status.error{color:#ff98a7;border-color:#7b3945}.ib2-or-status.good{color:#9effbd;border-color:#28583b}
    .ib2-or-generate{background:linear-gradient(135deg,#906cff,#6244d6)!important;color:#fff!important;font-weight:700!important}
    @media(max-width:700px){.ib2-or-grid{grid-template-columns:1fr}.ib2-or-grid .wide{grid-column:1}}
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
  container.innerHTML = rows.map(({ item, url }) => `<div class="ib2-or-ref"><img src="${url}" alt=""><span>${ROLE_LABELS[item.role] || item.role || 'Reference'}</span></div>`).join('');
  return items;
}

function modelOptions(models, selected) {
  const list = [...models];
  if (selected && !list.some(model => model.value === selected)) list.unshift({ value: selected, text: selected });
  return list.map(model => `<option value="${String(model.value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" ${model.value === selected ? 'selected' : ''}>${String(model.text || model.value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</option>`).join('');
}

export async function openOpenRouterGenerator(app) {
  injectGeneratorStyles();
  const settings = loadSettings();
  const referenceItems = getReferenceItems(app, settings.referenceSource);
  const modal = app.showModal('Generate image · OpenRouter', `
    <div class="ib2-or-grid">
      <div class="wide ib2-or-status" data-or-status>Checking SillyTavern's OpenRouter connection…</div>
      <label>Model<select data-or-model><option value="${settings.model}">${settings.model}</option></select></label>
      <label>Aspect ratio<select data-or-aspect>
        ${['1:1','3:4','4:3','9:16','16:9','2:3','3:2'].map(value => `<option value="${value}" ${settings.aspectRatio === value ? 'selected' : ''}>${value}</option>`).join('')}
      </select></label>
      <label>Images to generate<select data-or-count>${[1,2,3,4].map(value => `<option value="${value}" ${Number(settings.count) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label>Reference source<select data-or-ref-source>
        <option value="auto" ${settings.referenceSource === 'auto' ? 'selected' : ''}>Auto · selected first, then basket</option>
        <option value="selected" ${settings.referenceSource === 'selected' ? 'selected' : ''}>Selected canvas images</option>
        <option value="basket" ${settings.referenceSource === 'basket' ? 'selected' : ''}>Character reference basket</option>
        <option value="main" ${settings.referenceSource === 'main' ? 'selected' : ''}>Main portrait only</option>
      </select></label>
      <label class="wide">What do you want?<textarea data-or-prompt rows="5" placeholder="Example: Put this character in a rainy neon alley at night, full body, cinematic lighting."></textarea></label>
      <label class="ib2-check wide"><input type="checkbox" data-or-use-refs ${settings.useReferences !== false && referenceItems.length ? 'checked' : ''}> Send the reference images to the generation model (${referenceItems.length} available)</label>
      <div class="wide">
        <div class="ib2-muted">References sent to OpenRouter · up to ${MAX_REFERENCES}. Reference-image support varies by model.</div>
        <div class="ib2-or-ref-strip" data-or-refs></div>
      </div>
      <label class="ib2-check wide"><input type="checkbox" data-or-add-board ${settings.addToBoard !== false ? 'checked' : ''}> Put finished images directly on this board (off = save them to the Inbox)</label>
      <div class="ib2-modal-actions wide">
        <button data-or-refresh>Refresh models</button>
        <button class="primary ib2-or-generate" data-or-generate>✦ Generate</button>
      </div>
      <div class="wide ib2-or-results" data-or-results></div>
      <div class="wide ib2-muted">Uses the OpenRouter API key already stored by SillyTavern. The Inspiration Board never saves or displays the key. Image generation uses OpenRouter credits.</div>
    </div>
  `, 'ib2-openrouter-modal');

  const status = modal.querySelector('[data-or-status]');
  const modelSelect = modal.querySelector('[data-or-model]');
  const refStrip = modal.querySelector('[data-or-refs]');
  const results = modal.querySelector('[data-or-results]');
  const generateButton = modal.querySelector('[data-or-generate]');
  let models = [];
  let currentRefs = referenceItems;
  let controller = null;

  const setStatus = (message, type = '') => {
    status.textContent = message;
    status.classList.toggle('error', type === 'error');
    status.classList.toggle('good', type === 'good');
  };

  const refreshRefs = async () => {
    const source = modal.querySelector('[data-or-ref-source]').value;
    currentRefs = await renderReferenceStrip(app, refStrip, source);
    const checkbox = modal.querySelector('[data-or-use-refs]');
    checkbox.disabled = currentRefs.length === 0;
    if (!currentRefs.length) checkbox.checked = false;
    checkbox.parentElement.lastChild.textContent = ` Send the reference images to the generation model (${currentRefs.length} available)`;
  };

  const refreshModels = async () => {
    setStatus('Loading OpenRouter image models…');
    try {
      models = await fetchModels();
      const selected = modelSelect.value || settings.model || DEFAULT_MODEL;
      modelSelect.innerHTML = modelOptions(models, selected);
      if (!modelSelect.value && models.length) modelSelect.value = models[0].value;
      const credits = await fetchCredits();
      const remaining = Number(credits.remaining);
      setStatus(Number.isFinite(remaining) ? `OpenRouter ready · $${remaining.toFixed(2)} credit remaining · ${models.length} image models` : `OpenRouter ready · ${models.length} image models`, 'good');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  await refreshRefs();
  void refreshModels();

  modal.querySelector('[data-or-ref-source]').onchange = () => void refreshRefs();
  modal.querySelector('[data-or-refresh]').onclick = () => void refreshModels();

  generateButton.onclick = async () => {
    const userPrompt = modal.querySelector('[data-or-prompt]').value.trim();
    if (!userPrompt) return setStatus('Write a prompt first.', 'error');
    const model = modelSelect.value.trim();
    if (!model) return setStatus('Choose an OpenRouter image model.', 'error');
    const aspectRatio = modal.querySelector('[data-or-aspect]').value;
    const count = clamp(Number(modal.querySelector('[data-or-count]').value) || 1, 1, 4);
    const source = modal.querySelector('[data-or-ref-source]').value;
    const useReferences = modal.querySelector('[data-or-use-refs]').checked && currentRefs.length > 0;
    const addToBoard = modal.querySelector('[data-or-add-board]').checked;

    const nextSettings = { model, aspectRatio, count, referenceSource: source, useReferences, addToBoard };
    saveSettings(nextSettings);
    generateButton.disabled = true;
    results.innerHTML = '';
    controller?.abort();
    controller = new AbortController();

    try {
      const refs = useReferences ? await referencePayload(app, currentRefs) : [];
      const prompt = buildPrompt(userPrompt, refs);
      setStatus(`Generating ${count} image${count === 1 ? '' : 's'} with ${model}${refs.length ? ` using ${refs.length} reference${refs.length === 1 ? '' : 's'}` : ''}…`);

      app.snapshotUndo();
      await app.createPersistentSnapshot?.('Before OpenRouter generation', true);
      const generated = [];
      for (let index = 0; index < count; index++) {
        setStatus(`Generating ${index + 1} of ${count} · ${model}…`);
        const result = await requestImage({ model, prompt, refs, aspectRatio, signal: controller.signal });
        const metadata = { model, userPrompt, prompt, aspectRatio, referenceItemIds: currentRefs.map(item => item.id), total: count };
        if (addToBoard) await storeGeneratedResult(app, result, metadata, index);
        else await storeGeneratedInbox(app, result, metadata, index);
        generated.push(result);
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
      setStatus(`${generated.length} image${generated.length === 1 ? '' : 's'} generated and ${addToBoard ? 'added to the board' : 'saved to the Inbox'}.`, 'good');
      app.toast(`OpenRouter generated ${generated.length} image${generated.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      if (error?.name === 'AbortError') setStatus('Generation cancelled.', 'error');
      else {
        console.error('[Inspiration Board] OpenRouter generation failed', error);
        setStatus(error instanceof Error ? error.message : String(error), 'error');
        app.toast(error instanceof Error ? error.message : 'OpenRouter generation failed.', 'error');
      }
    } finally {
      generateButton.disabled = false;
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
  button.onpointerdown = event => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
  };
  return true;
}

export function installOpenRouterGenerator(app) {
  if (!app) return false;
  injectGeneratorStyles();
  ensureRailButton(app);
  if (installedFor !== app) installedFor = app;
  return true;
}
