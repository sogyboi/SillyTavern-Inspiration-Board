import { readSecret, SECRET_KEYS } from '../../src/endpoints/secrets.js';

const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
const MAX_REFERENCES = 16;
const MAX_REFERENCE_DATA_CHARS = 48 * 1024 * 1024;
const MAX_PROMPT_CHARS = 60_000;
const REQUEST_TIMEOUT_MS = 240_000;

function safeText(value, max) {
  return String(value || '').slice(0, max);
}

function normalizeReference(reference) {
  const url = typeof reference === 'string'
    ? reference
    : reference?.image_url?.url || reference?.url || '';
  const value = String(url || '');
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(value)) return null;
  return { type: 'image_url', image_url: { url: value.replace(/\s+/g, '') } };
}

function normalizedReferences(value) {
  if (!Array.isArray(value)) return [];
  const rows = value.slice(0, MAX_REFERENCES).map(normalizeReference).filter(Boolean);
  const totalChars = rows.reduce((sum, entry) => sum + entry.image_url.url.length, 0);
  if (totalChars > MAX_REFERENCE_DATA_CHARS) {
    const error = new Error('Reference images are too large for one OpenRouter request.');
    error.statusCode = 413;
    throw error;
  }
  return rows;
}

function errorMessage(payload, fallback = '') {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload.slice(0, 1500);
  return String(payload?.error?.message || payload?.error || payload?.message || payload?.detail || fallback || '').slice(0, 1500);
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return text; }
}

export function installOpenRouterImagesBridge(router) {
  router.post('/openrouter-images', async (req, res) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const key = readSecret(req.user?.directories, SECRET_KEYS.OPENROUTER);
      if (!key) return res.status(400).json({ error: 'No OpenRouter API key is saved in SillyTavern.' });

      const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
      const model = safeText(body.model, 300).trim();
      const prompt = safeText(body.prompt, MAX_PROMPT_CHARS).trim();
      if (!model || !prompt) return res.status(400).json({ error: 'Model and prompt are required.' });

      const references = normalizedReferences(body.input_references);
      const n = Math.max(1, Math.min(10, Number(body.n) || 1));
      const payload = { model, prompt, n };
      if (body.aspect_ratio) payload.aspect_ratio = safeText(body.aspect_ratio, 24);
      if (references.length) payload.input_references = references;

      const response = await fetch(OPENROUTER_IMAGES_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'HTTP-Referer': 'https://github.com/sogyboi/SillyTavern-Inspiration-Board',
          'X-Title': 'SillyTavern Inspiration Board',
        },
        body: JSON.stringify(payload),
      });
      const data = await responsePayload(response);
      if (!response.ok) {
        const message = errorMessage(data, `OpenRouter returned HTTP ${response.status}.`);
        console.warn('[Inspiration Board Sync] OpenRouter Images API failed', response.status, message);
        return res.status(response.status).json({ error: message, openrouterStatus: response.status });
      }
      if (!Array.isArray(data?.data) || !data.data.some(entry => entry?.b64_json)) {
        return res.status(502).json({ error: 'OpenRouter returned no generated image data.' });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json(data);
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      const status = Number(error?.statusCode) || (aborted ? 504 : 500);
      const message = aborted ? 'OpenRouter image request timed out.' : error.message;
      console.error('[Inspiration Board Sync] OpenRouter Images bridge failed', error);
      return res.status(status).json({ error: message });
    } finally {
      clearTimeout(timer);
    }
  });
}
