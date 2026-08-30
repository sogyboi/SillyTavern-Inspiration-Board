import { readSecret, writeSecret, deleteSecret } from '../../src/endpoints/secrets.js';

const VENICE_BASE = 'https://api.venice.ai/api/v1';
const VENICE_SECRET_KEY = 'api_key_venice';
const REQUEST_TIMEOUT_MS = 300_000;
const MAX_REFERENCE_CHARS = 72 * 1024 * 1024;
const videoJobs = new Map();

function userJobKey(req, queueId) {
  const root = req.user?.directories?.root || req.user?.profile?.handle || 'default-user';
  return `${root}:${queueId}`;
}

function getKey(req) {
  return readSecret(req.user?.directories, VENICE_SECRET_KEY);
}

function cleanText(value, max = 10_000) {
  return String(value || '').slice(0, max);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function requireKey(req, res) {
  const key = getKey(req);
  if (!key) {
    res.status(400).json({ error: 'No Venice API key is saved. Add it in Inspiration Board → Generate → Venice.' });
    return null;
  }
  return key;
}

async function responsePayload(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }
  return response.text().catch(() => '');
}

function payloadError(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload.slice(0, 1600) || fallback;
  return String(payload?.error?.message || payload?.error || payload?.message || payload?.detail || fallback || '').slice(0, 1600);
}

async function veniceFetch(key, path, { method = 'GET', body = null, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(`${VENICE_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: '*/*',
        ...(body !== null ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeImageInputs(value, max = 7) {
  if (!Array.isArray(value)) return [];
  const rows = value
    .slice(0, max)
    .map(entry => String(entry || '').trim())
    .filter(entry => /^(?:data:image\/[a-zA-Z0-9.+-]+;base64,|https?:\/\/)/.test(entry));
  const total = rows.reduce((sum, row) => sum + row.length, 0);
  if (total > MAX_REFERENCE_CHARS) {
    const error = new Error('Reference images are too large for one Venice request.');
    error.statusCode = 413;
    throw error;
  }
  return rows;
}

function stripDataUrl(value) {
  const input = String(value || '');
  const marker = ';base64,';
  const index = input.indexOf(marker);
  return index >= 0 ? input.slice(index + marker.length) : input;
}

function safeGenerationBody(body) {
  const source = asObject(body);
  const payload = {
    model: cleanText(source.model, 300),
    prompt: cleanText(source.prompt, 32_768),
    format: ['jpeg', 'png', 'webp'].includes(source.format) ? source.format : 'webp',
    return_binary: false,
    safe_mode: source.safe_mode !== false,
  };
  if (source.negative_prompt) payload.negative_prompt = cleanText(source.negative_prompt, 32_768);
  if (source.aspect_ratio) payload.aspect_ratio = cleanText(source.aspect_ratio, 24);
  if (source.resolution) payload.resolution = cleanText(source.resolution, 12);
  if (Number.isFinite(Number(source.width))) payload.width = Math.max(64, Math.min(4096, Number(source.width)));
  if (Number.isFinite(Number(source.height))) payload.height = Math.max(64, Math.min(4096, Number(source.height)));
  if (Number.isFinite(Number(source.variants))) payload.variants = Math.max(1, Math.min(4, Number(source.variants)));
  if (Number.isFinite(Number(source.seed))) payload.seed = Math.trunc(Number(source.seed));
  if (Number.isFinite(Number(source.steps))) payload.steps = Math.max(1, Math.min(100, Number(source.steps)));
  if (Number.isFinite(Number(source.cfg_scale))) payload.cfg_scale = Number(source.cfg_scale);
  if (source.style_preset) payload.style_preset = cleanText(source.style_preset, 120);
  if (source.quality && ['low', 'medium', 'high'].includes(source.quality)) payload.quality = source.quality;
  if (source.enable_web_search === true) payload.enable_web_search = true;
  return payload;
}

function safeVideoBody(body) {
  const source = asObject(body);
  const payload = {
    model: cleanText(source.model, 300),
    prompt: cleanText(source.prompt, 10_000),
    duration: cleanText(source.duration || '5s', 12),
  };
  if (source.negative_prompt) payload.negative_prompt = cleanText(source.negative_prompt, 10_000);
  if (source.aspect_ratio) payload.aspect_ratio = cleanText(source.aspect_ratio, 24);
  if (source.resolution) payload.resolution = cleanText(source.resolution, 24);
  if (typeof source.audio === 'boolean') payload.audio = source.audio;
  if (source.bitrate_mode) payload.bitrate_mode = cleanText(source.bitrate_mode, 24);
  if (source.image_url) payload.image_url = cleanText(source.image_url, MAX_REFERENCE_CHARS);
  if (source.end_image_url) payload.end_image_url = cleanText(source.end_image_url, MAX_REFERENCE_CHARS);

  const refs = normalizeImageInputs(source.reference_images, 7);
  const model = payload.model.toLowerCase();
  if (refs.length) {
    if (model.includes('grok-imagine') && model.includes('reference-to-video')) {
      payload.referenceImageUrls = refs;
    } else if (model.includes('kling-o3') && model.includes('reference-to-video')) {
      payload.scene_image_urls = refs.slice(0, 4);
    } else {
      payload.reference_image_urls = refs;
    }
  }
  return payload;
}

function safeQuoteBody(body) {
  const source = asObject(body);
  const payload = {
    model: cleanText(source.model, 300),
    duration: cleanText(source.duration || '5s', 12),
  };
  if (source.resolution) payload.resolution = cleanText(source.resolution, 24);
  if (source.aspect_ratio) payload.aspect_ratio = cleanText(source.aspect_ratio, 24);
  if (typeof source.audio === 'boolean') payload.audio = source.audio;
  return payload;
}

export function installVeniceMediaBridge(router) {
  router.get('/venice/status', async (req, res) => {
    const configured = Boolean(getKey(req));
    return res.json({ ok: true, configured, secretStorage: 'SillyTavern secrets.json', version: '0.6.0' });
  });

  router.post('/venice/key', async (req, res) => {
    const key = cleanText(req.body?.key, 500).trim();
    if (!key) return res.status(400).json({ error: 'Paste a Venice API key first.' });
    try {
      const response = await veniceFetch(key, '/models?type=image', { timeout: 20_000 });
      const payload = await responsePayload(response);
      if (!response.ok) return res.status(response.status).json({ error: payloadError(payload, `Venice rejected the key (HTTP ${response.status}).`) });
      writeSecret(req.user?.directories, VENICE_SECRET_KEY, key);
      return res.json({ ok: true, configured: true });
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Venice key validation timed out.' : error.message;
      return res.status(502).json({ error: message });
    }
  });

  router.delete('/venice/key', async (req, res) => {
    deleteSecret(req.user?.directories, VENICE_SECRET_KEY);
    return res.json({ ok: true, configured: false });
  });

  router.get('/venice/models', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    const type = ['image', 'video', 'inpaint'].includes(String(req.query.type || '')) ? String(req.query.type) : 'image';
    try {
      const [modelsResponse, traitsResponse] = await Promise.all([
        veniceFetch(key, `/models?type=${encodeURIComponent(type)}`, { timeout: 30_000 }),
        veniceFetch(key, `/models/traits?type=${encodeURIComponent(type)}`, { timeout: 30_000 }),
      ]);
      const models = await responsePayload(modelsResponse);
      const traits = await responsePayload(traitsResponse);
      if (!modelsResponse.ok) return res.status(modelsResponse.status).json({ error: payloadError(models, `Could not load Venice ${type} models.`) });
      return res.json({
        type,
        data: Array.isArray(models?.data) ? models.data : [],
        traits: traitsResponse.ok && traits?.data && typeof traits.data === 'object' ? traits.data : {},
      });
    } catch (error) {
      return res.status(502).json({ error: error?.name === 'AbortError' ? 'Venice model lookup timed out.' : error.message });
    }
  });

  router.get('/venice/balance', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    try {
      const response = await veniceFetch(key, '/billing/balance', { timeout: 20_000 });
      const payload = await responsePayload(response);
      if (!response.ok) return res.status(response.status).json({ error: payloadError(payload, 'Could not load Venice balance.') });
      return res.json(payload);
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  });

  router.post('/venice/image', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    const source = asObject(req.body);
    try {
      const references = normalizeImageInputs(source.references, 3);
      if (references.length) {
        const editBody = {
          prompt: cleanText(source.prompt, 32_768),
          modelId: cleanText(source.model, 300),
          safe_mode: source.safe_mode !== false,
        };
        if (source.aspect_ratio) editBody.aspect_ratio = cleanText(source.aspect_ratio, 24);
        if (source.resolution) editBody.resolution = cleanText(source.resolution, 12);
        if (source.format) editBody.output_format = ['jpeg', 'png', 'webp'].includes(source.format) ? source.format : 'png';
        let response;
        if (references.length === 1) {
          response = await veniceFetch(key, '/image/edit', {
            method: 'POST',
            body: { ...editBody, image: stripDataUrl(references[0]) },
          });
        } else {
          response = await veniceFetch(key, '/image/multi-edit', {
            method: 'POST',
            body: { ...editBody, images: references.map(stripDataUrl) },
          });
        }
        if (!response.ok) {
          const payload = await responsePayload(response);
          return res.status(response.status).json({ error: payloadError(payload, `Venice image edit failed (HTTP ${response.status}).`) });
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        const mime = String(response.headers.get('content-type') || 'image/png').split(';')[0];
        return res.json({
          id: `venice-edit-${Date.now()}`,
          images: [bytes.toString('base64')],
          format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png',
          blurred: response.headers.get('x-venice-is-blurred') === 'true',
          contentViolation: response.headers.get('x-venice-is-content-violation') === 'true',
        });
      }

      const response = await veniceFetch(key, '/image/generate', { method: 'POST', body: safeGenerationBody(source) });
      const payload = await responsePayload(response);
      if (!response.ok) return res.status(response.status).json({ error: payloadError(payload, `Venice image generation failed (HTTP ${response.status}).`) });
      return res.json({
        ...payload,
        format: source.format || 'webp',
        blurred: response.headers.get('x-venice-is-blurred') === 'true',
        contentViolation: response.headers.get('x-venice-is-content-violation') === 'true',
      });
    } catch (error) {
      const status = Number(error?.statusCode) || (error?.name === 'AbortError' ? 504 : 500);
      return res.status(status).json({ error: error?.name === 'AbortError' ? 'Venice image request timed out.' : error.message });
    }
  });

  router.post('/venice/video/quote', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    try {
      const response = await veniceFetch(key, '/video/quote', { method: 'POST', body: safeQuoteBody(req.body), timeout: 30_000 });
      const payload = await responsePayload(response);
      if (!response.ok) return res.status(response.status).json({ error: payloadError(payload, 'Venice video quote failed.') });
      return res.json(payload);
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  });

  router.post('/venice/video/queue', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    try {
      const body = safeVideoBody(req.body);
      const response = await veniceFetch(key, '/video/queue', { method: 'POST', body });
      const payload = await responsePayload(response);
      if (!response.ok) return res.status(response.status).json({ error: payloadError(payload, `Venice video queue failed (HTTP ${response.status}).`) });
      const queueId = String(payload?.queue_id || payload?.id || '');
      if (!queueId) return res.status(502).json({ error: 'Venice queued the request without returning a queue ID.' });
      videoJobs.set(userJobKey(req, queueId), {
        model: String(payload?.model || body.model),
        queueId,
        downloadUrl: String(payload?.download_url || ''),
        createdAt: Date.now(),
      });
      return res.json({ ...payload, queue_id: queueId });
    } catch (error) {
      return res.status(error?.name === 'AbortError' ? 504 : 500).json({ error: error?.name === 'AbortError' ? 'Venice video queue timed out.' : error.message });
    }
  });

  router.post('/venice/video/retrieve', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    const queueId = cleanText(req.body?.queue_id, 200);
    const model = cleanText(req.body?.model, 300);
    if (!queueId || !model) return res.status(400).json({ error: 'Video model and queue ID are required.' });
    try {
      const response = await veniceFetch(key, '/video/retrieve', { method: 'POST', body: { model, queue_id: queueId }, timeout: 90_000 });
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok) {
        const payload = await responsePayload(response);
        return res.status(response.status).json({ error: payloadError(payload, `Venice video retrieve failed (HTTP ${response.status}).`) });
      }
      if (type.includes('video/mp4')) {
        const bytes = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', bytes.length);
        res.setHeader('Cache-Control', 'no-store');
        return res.send(bytes);
      }

      const payload = await responsePayload(response);
      if (String(payload?.status || '').toUpperCase() === 'COMPLETED') {
        const job = videoJobs.get(userJobKey(req, queueId));
        if (job?.downloadUrl) {
          const download = await fetch(job.downloadUrl, { redirect: 'follow' });
          if (!download.ok) return res.status(502).json({ error: `Venice video download returned HTTP ${download.status}.` });
          const bytes = Buffer.from(await download.arrayBuffer());
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Length', bytes.length);
          res.setHeader('Cache-Control', 'no-store');
          return res.send(bytes);
        }
      }
      return res.json(payload);
    } catch (error) {
      return res.status(error?.name === 'AbortError' ? 504 : 500).json({ error: error?.name === 'AbortError' ? 'Venice video status request timed out.' : error.message });
    }
  });

  router.post('/venice/video/complete', async (req, res) => {
    const key = requireKey(req, res);
    if (!key) return;
    const queueId = cleanText(req.body?.queue_id, 200);
    const model = cleanText(req.body?.model, 300);
    try {
      const response = await veniceFetch(key, '/video/complete', { method: 'POST', body: { model, queue_id: queueId }, timeout: 30_000 });
      const payload = await responsePayload(response);
      videoJobs.delete(userJobKey(req, queueId));
      if (!response.ok) return res.status(response.status).json({ error: payloadError(payload, 'Venice video cleanup failed.') });
      return res.json(payload);
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  });
}
