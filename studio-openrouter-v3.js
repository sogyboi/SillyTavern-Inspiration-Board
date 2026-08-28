import { clamp, makeImageItem, staggerPositions, uid as coreUid } from './core-v2.js';
import { blobToDataUrl, createImageRecord, getImage, putImage } from './db-v2.js';
import {
  ensureStudio,
  estimateGenerationCost,
  formatMoney,
  getModelImagePrice,
  inferModelCapabilities,
  prioritizeReferences,
  recordSpend,
} from './studio-core-v3.js';

const PUBLIC_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=image';
const MODEL_CACHE_MS = 10 * 60_000;
let modelCache = null;
let modelCacheAt = 0;

function requestHeaders({ contentType = true } = {}) {
  const context = globalThis.SillyTavern?.getContext?.();
  const headers = context?.getRequestHeaders?.({ omitContentType: !contentType }) || {};
  if (contentType && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return headers;
}

function normalizeModelEntry(entry) {
  const id = String(entry?.id || entry?.value || '');
  return {
    ...entry,
    id,
    value: id,
    name: entry?.name || entry?.text || id,
    text: entry?.name || entry?.text || id,
  };
}

async function fetchPublicModelMetadata() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(PUBLIC_MODELS_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.data) ? data.data.map(normalizeModelEntry) : [];
  } catch (error) {
    console.info('[Inspiration Board] OpenRouter public model metadata unavailable; using SillyTavern model list.', error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSillyTavernModels() {
  const response = await fetch('/api/openrouter/models/image', {
    method: 'POST',
    headers: requestHeaders(),
    body: '{}',
  });
  if (!response.ok) throw new Error(`Could not load OpenRouter image models (HTTP ${response.status}).`);
  const data = await response.json();
  return Array.isArray(data) ? data.map(normalizeModelEntry) : [];
}

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

export async function loadOpenRouterCredits() {
  const response = await fetch('/api/openrouter/credits', {
    method: 'POST',
    headers: requestHeaders(),
    body: '{}',
  });
  if (response.status === 400) throw new Error('No OpenRouter API key is saved in SillyTavern. Add it in API Connections first.');
  if (!response.ok) throw new Error(`Could not check OpenRouter credits (HTTP ${response.status}).`);
  return response.json();
}

function allBasketIds(board) {
  const refs = board?.character?.references || {};
  const ids = [];
  for (const list of Object.values(refs)) {
    if (!Array.isArray(list)) continue;
    for (const id of list) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function itemPurpose(board, item) {
  const studio = ensureStudio(board);
  return studio.referenceConfig?.[item.id]?.purpose || item.role || 'identity';
}

export function collectBoardReferenceItems(app, {
  mode = 'configured',
  includeSelected = true,
  includeBasket = true,
  includeMain = true,
  includeSlots = true,
} = {}) {
  const board = app.activeBoard();
  const studio = ensureStudio(board);
  const items = [];
  const push = item => {
    if (item?.type !== 'image' || items.some(existing => existing.imageId === item.imageId)) return;
    items.push(item);
  };

  if (mode === 'selected' || (mode === 'configured' && includeSelected)) {
    for (const id of app.selectedIds || []) push(app.itemById(id));
  }
  if (mode === 'basket' || (mode === 'configured' && includeBasket)) {
    for (const id of allBasketIds(board)) push(app.itemById(id));
  }
  if (mode === 'main' || (mode === 'configured' && includeMain)) {
    push(app.itemById(board.character?.mainImageId));
  }
  if (mode === 'all') {
    for (const item of board.items) push(item);
  }
  if (includeSlots) {
    for (const slot of studio.multiCharacterSlots || []) {
      const sourceBoard = app.state.boards.find(candidate => candidate.id === slot.boardId);
      if (!sourceBoard) continue;
      const sourceItem = sourceBoard.items.find(item => item.id === slot.referenceItemId)
        || sourceBoard.items.find(item => item.id === sourceBoard.character?.mainImageId);
      push(sourceItem);
    }
  }
  return items;
}

export async function prepareReferences(app, referenceDescriptors = [], modelCapabilities = null) {
  const board = app.activeBoard();
  const studio = ensureStudio(board);
  const max = Math.min(studio.settings.maxReferences || 8, modelCapabilities?.maxReferences || 8);
  const normalized = referenceDescriptors.map(reference => {
    if (reference.dataUrl) return { ...reference };
    const item = reference.item || app.itemById(reference.itemId || reference.id);
    const config = item ? studio.referenceConfig?.[item.id] || {} : {};
    return {
      item,
      itemId: item?.id || reference.itemId || null,
      imageId: item?.imageId || reference.imageId || null,
      name: item?.name || reference.name || '',
      purpose: reference.purpose || config.purpose || itemPurpose(board, item),
      strength: reference.strength ?? config.strength ?? 75,
      strictness: reference.strictness || config.strictness || 'balanced',
      cropOnly: reference.cropOnly ?? config.cropOnly ?? false,
      ignoreBackground: reference.ignoreBackground ?? config.ignoreBackground ?? true,
      mustPreserve: reference.mustPreserve ?? config.mustPreserve ?? false,
      notes: reference.notes || config.notes || item?.notes || '',
    };
  });
  const prioritized = prioritizeReferences(normalized, max);
  const payload = [];
  for (const reference of prioritized) {
    if (reference.dataUrl) {
      payload.push(reference);
      continue;
    }
    if (!reference.imageId) continue;
    const record = await getImage(reference.imageId);
    if (!record?.blob) continue;
    const blob = reference.cropOnly && record.thumbnail ? record.thumbnail : (record.thumbnail || record.blob);
    payload.push({ ...reference, dataUrl: await blobToDataUrl(blob) });
  }
  return payload;
}

function referenceGuide(refs) {
  if (!refs.length) return '';
  return refs.map((reference, index) => {
    const strength = Math.round(reference.strength ?? 75);
    const clauses = [
      `${reference.purpose || 'identity'} reference`,
      `influence ${strength}%`,
      reference.strictness || 'balanced',
      reference.mustPreserve ? 'must preserve' : '',
      reference.ignoreBackground ? 'ignore reference background' : '',
      reference.cropOnly ? 'use visible crop only' : '',
      reference.notes || '',
    ].filter(Boolean);
    return `Image ${index + 1}: ${clauses.join('; ')}`;
  }).join('\n');
}

function multimodalPrompt(prompt, refs) {
  if (!refs.length) return prompt;
  const text = [
    prompt,
    '',
    'Attached image rules:',
    referenceGuide(refs),
    'Treat the images as role-specific references. Do not create a collage. Keep separate characters separate.',
  ].join('\n');
  return [
    { type: 'text', text },
    ...refs.map(reference => ({ type: 'image_url', image_url: { url: reference.dataUrl } })),
  ];
}

async function parseErrorResponse(response) {
  let detail = '';
  try {
    const data = await response.clone().json();
    detail = data?.error?.message || data?.error || data?.message || '';
  } catch {
    try { detail = await response.text(); } catch {}
  }
  return String(detail || '').slice(0, 500);
}

async function requestImage({ model, prompt, references, aspectRatio, signal }) {
  const response = await fetch('/api/openrouter/image/generate', {
    method: 'POST',
    headers: requestHeaders(),
    signal,
    body: JSON.stringify({
      model,
      prompt: multimodalPrompt(prompt, references),
      aspect_ratio: aspectRatio || '1:1',
    }),
  });
  if (!response.ok) {
    const detail = await parseErrorResponse(response);
    const error = new Error(`OpenRouter generation failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  const data = await response.json();
  if (!data?.image) throw new Error('OpenRouter returned no image data.');
  const format = String(data.format || 'png').toLowerCase();
  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  return { ...data, format, mime, dataUrl: `data:${mime};base64,${data.image}` };
}

function shouldTryWithoutReferences(error) {
  const text = `${error?.message || ''} ${error?.detail || ''}`.toLowerCase();
  return /image|reference|multimodal|content|unsupported|modality|invalid/.test(text) || error?.status === 400;
}

function shouldTrySquare(error) {
  const text = `${error?.message || ''} ${error?.detail || ''}`.toLowerCase();
  return /aspect|ratio|size|dimension|image_config/.test(text) || error?.status === 400;
}

export async function requestImageWithFallback({
  model,
  prompt,
  references = [],
  aspectRatio = '1:1',
  signal,
  autoFallback = true,
  retryWithoutReferences = true,
  retrySquare = true,
  onAttempt = () => {},
}) {
  const attempts = [];
  const addAttempt = (refs, ratio, reason) => {
    const key = `${refs.length}:${ratio}`;
    if (!attempts.some(attempt => attempt.key === key)) attempts.push({ key, refs, ratio, reason });
  };
  addAttempt(references, aspectRatio, 'original request');
  if (autoFallback && references.length > 4) addAttempt(references.slice(0, 4), aspectRatio, 'reduced references to four');
  if (autoFallback && references.length > 2) addAttempt(references.slice(0, 2), aspectRatio, 'reduced references to two');
  if (autoFallback && references.length > 1) addAttempt(references.slice(0, 1), aspectRatio, 'reduced references to one');
  if (autoFallback && retryWithoutReferences && references.length) addAttempt([], aspectRatio, 'removed references');
  if (autoFallback && retrySquare && aspectRatio !== '1:1') {
    addAttempt(references.slice(0, Math.min(references.length, 4)), '1:1', 'changed aspect ratio to 1:1');
    if (retryWithoutReferences && references.length) addAttempt([], '1:1', 'changed to 1:1 without references');
  }

  const log = [];
  let lastError = null;
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
    onAttempt({ index, total: attempts.length, references: attempt.refs.length, aspectRatio: attempt.ratio, reason: attempt.reason });
    try {
      const result = await requestImage({ model, prompt, references: attempt.refs, aspectRatio: attempt.ratio, signal });
      if (index > 0) log.push(`Succeeded after fallback: ${attempt.reason}.`);
      return { result, referencesUsed: attempt.refs, aspectRatioUsed: attempt.ratio, fallbackLog: log };
    } catch (error) {
      lastError = error;
      log.push(`Attempt ${index + 1} failed (${attempt.reason}): ${error.message}`);
      if (!autoFallback) break;
      if (attempt.refs.length && !shouldTryWithoutReferences(error) && attempt.ratio === aspectRatio) {
        // Provider errors unrelated to references usually do not improve by trimming every reference count.
        const nextUseful = attempts.findIndex((candidate, candidateIndex) => candidateIndex > index && (candidate.ratio !== attempt.ratio || candidate.refs.length === 0));
        if (nextUseful > index + 1) index = nextUseful - 1;
      }
      if (attempt.ratio !== '1:1' && !shouldTrySquare(error) && !attempt.refs.length) break;
    }
  }
  if (lastError) {
    lastError.fallbackLog = log;
    throw lastError;
  }
  throw new Error('OpenRouter generation failed without returning an error.');
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export async function storeGeneratedImage(app, result, metadata = {}, destination = 'board', positionIndex = 0, total = 1) {
  const ext = result.format === 'jpeg' ? 'jpg' : result.format;
  const blob = base64ToBlob(result.image, result.mime);
  const file = new File([blob], `openrouter-${Date.now()}-${positionIndex + 1}.${ext}`, { type: result.mime });
  const record = await createImageRecord(file, { sourceUrl: `openrouter:${metadata.model || 'unknown'}` });
  record.generated = {
    provider: 'openrouter',
    ...metadata,
    createdAt: Date.now(),
  };
  await putImage(record);
  const board = app.activeBoard();

  if (destination === 'inbox') {
    const entry = app.ensureInboxEntry(record, { sourceUrl: record.sourceUrl });
    entry.tags = [...new Set([...(entry.tags || []), 'generated', 'openrouter', metadata.recipeId].filter(Boolean))];
    entry.notes = metadata.userPrompt || metadata.prompt || '';
    entry.generated = record.generated;
    return { record, entry, item: null };
  }

  const ratio = record.width / Math.max(1, record.height);
  const width = ratio >= 1 ? 380 : 300;
  const height = clamp(width / Math.max(ratio, 0.05), 190, 540);
  const center = app.canvasCenterWorld();
  const pos = staggerPositions(total, center.x, center.y, width, height)[positionIndex] || center;
  const item = makeImageItem({
    imageId: record.id,
    name: `Generated · ${(metadata.model || '').split('/').pop() || 'OpenRouter'}`,
    width,
    height,
    x: pos.x,
    y: pos.y,
    sourceUrl: record.sourceUrl,
  });
  item.tags = [...new Set(['generated', 'openrouter', metadata.recipeId].filter(Boolean))];
  item.notes = metadata.userPrompt || metadata.prompt || '';
  item.generated = record.generated;
  item.favorite = Boolean(metadata.favorite);
  board.items.push(item);
  board.updatedAt = Date.now();
  return { record, item, entry: null };
}

export async function executeGenerationJob(app, job, {
  signal,
  modelMetadata = null,
  onProgress = () => {},
} = {}) {
  const board = app.state.boards.find(candidate => candidate.id === job.boardId) || app.activeBoard();
  const studio = ensureStudio(board);
  const capabilities = inferModelCapabilities(job.model, modelMetadata || job.modelMetadata);
  const references = await prepareReferences(app, job.references || [], capabilities);
  const outputs = [];
  const total = Math.max(1, Number(job.count) || 1);
  let fallbackLog = [];
  let estimatedCost = job.estimatedCost;
  if (estimatedCost === null || estimatedCost === undefined) {
    estimatedCost = estimateGenerationCost({ modelMetadata: modelMetadata || job.modelMetadata, count: total }).total;
  }

  for (let index = 0; index < total; index++) {
    if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
    onProgress({ phase: 'request', index, total, message: `Generating ${index + 1} of ${total}…` });
    const response = await requestImageWithFallback({
      model: job.model,
      prompt: job.finalPrompt,
      references,
      aspectRatio: job.aspectRatio,
      signal,
      autoFallback: studio.settings.autoFallback,
      retryWithoutReferences: studio.settings.retryWithoutReferences,
      retrySquare: studio.settings.retrySquare,
      onAttempt: attempt => onProgress({ phase: 'attempt', index, total, attempt }),
    });
    fallbackLog = [...new Set([...fallbackLog, ...response.fallbackLog])];
    onProgress({ phase: 'store', index, total, message: `Saving result ${index + 1} of ${total}…` });
    const stored = await storeGeneratedImage(app, response.result, {
      model: job.model,
      recipeId: job.recipeId,
      prompt: job.finalPrompt,
      userPrompt: job.promptDraft?.extra || job.promptDraft?.subject || '',
      negative: job.negative,
      referenceSummary: references.map(reference => ({
        itemId: reference.itemId,
        imageId: reference.imageId,
        name: reference.name,
        purpose: reference.purpose,
        strength: reference.strength,
        strictness: reference.strictness,
      })),
      aspectRatioRequested: job.aspectRatio,
      aspectRatioUsed: response.aspectRatioUsed,
      fallbackLog,
      parentGenerationId: job.parentGenerationId,
      jobId: job.id,
    }, job.destination, index, total);
    outputs.push(stored);
  }

  if (estimatedCost !== null && Number.isFinite(Number(estimatedCost))) recordSpend(studio, Number(estimatedCost));
  return {
    outputs,
    imageIds: outputs.map(output => output.record.id),
    itemIds: outputs.map(output => output.item?.id).filter(Boolean),
    fallbackLog,
    estimatedCost,
    costLabel: estimatedCost === null ? 'Unknown' : formatMoney(estimatedCost),
  };
}

export function downloadGeneratedRecord(record, filename = null) {
  if (!record?.blob) return;
  const url = URL.createObjectURL(record.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || record.name || `generated-${coreUid('image')}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
