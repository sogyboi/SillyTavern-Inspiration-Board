import { Readable } from 'node:stream';
import { createGalleryApi } from '../server-plugin/character-gallery-api/index.mjs';
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7f8AAAAASUVORK5CYII=';
export const DATA = `data:image/png;base64,${PNG}`;
export const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
export function fakeProvider() {
    const state = { requests: [], gate: null };
    state.fetch = async (url, options = {}) => {
        const u = new URL(url);
        if (options.method === 'POST') {
            state.requests.push({ path: u.pathname, body: JSON.parse(options.body) });
            if (state.gate) await state.gate;
            if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            return u.pathname.endsWith('/images') ? json({ id: 'provider-response-1', data: [{ b64_json: PNG }] }) : u.pathname.endsWith('/image/generate') ? json({ images: [PNG] }) : new Response(Buffer.from(PNG, 'base64'), { headers: { 'content-type': 'image/png', 'x-request-id': 'venice-test-id' } });
        }
        if (u.hostname === 'openrouter.ai') {
            if (u.pathname.endsWith('/images/models')) return json({ data: [{ id: 'test/ref', name: 'Reference Model', description: 'Image editing', supported_parameters: { input_references: { min: 0, max: 4 }, n: { max: 2 }, aspect_ratio: { values: ['1:1', '3:4'] }, output_format: { values: ['png'] } } }, { id: 'test/plain', name: 'Prompt Only', supported_parameters: {} }] });
            if (u.pathname.endsWith('/endpoints')) return json({ endpoints: [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: .04 }] }] });
            return json({ data: [{ id: 'test/ref', top_provider: { is_moderated: false } }] });
        }
        if (u.pathname.endsWith('/traits')) return json({ data: {} });
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
        return json({ data: [{ id: 'test-image', type: 'image', model_spec: { name: 'Test Image', pricing: { generation: { usd: .01 } } } }] });
    };
    return state;
}
export function harness(root, provider = fakeProvider()) {
    const routes = [], keys = new Map();
    const secretStore = { read: (req, p) => keys.get(`${req.user.directories.root}:${p}`) || 'private-test-key', write: (req, p, key) => keys.set(`${req.user.directories.root}:${p}`, key) };
    const router = Object.fromEntries(['get','post','patch','delete'].map(method => [method, (route, handler) => routes.push({ method, route, handler })]));
    createGalleryApi({ secretStore, fetchImpl: provider.fetch }).install(router);
    async function invoke(method, pathname, body = {}, userRoot = root, raw = false) {
        const url = new URL(pathname, 'http://local'), entry = routes.find(r => r.method === method.toLowerCase() && new RegExp(`^${r.route.replace(/:[^/]+/g, '([^/]+)')}$`).test(url.pathname));
        if (!entry) throw new Error(`Missing ${method} ${pathname}`);
        const params = {}, matched = url.pathname.match(new RegExp(`^${entry.route.replace(/:[^/]+/g, '([^/]+)')}$`));
        [...entry.route.matchAll(/:([^/]+)/g)].forEach((m, i) => params[m[1]] = matched[i + 1]);
        const req = raw ? Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]) : {};
        Object.assign(req, { params, query: Object.fromEntries(url.searchParams), user: userRoot ? { directories: { root: userRoot } } : null, body: raw ? undefined : body, headers: { 'content-type': raw ? 'application/x-character-gallery' : 'application/json' } });
        const res = { code: 200, headers: {}, headersSent: false, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.code = n; return this; }, json(data) { this.data = structuredClone(data); this.headersSent = true; return this; }, send(data) { this.data = data; this.headersSent = true; return this; } };
        await entry.handler(req, res); return res;
    }
    return { invoke, provider, routes };
}
export async function waitJob(h, id) {
    for (let n = 0; n < 100; n++) {
        const res = await h.invoke('get', `/gallery/${id}`), job = res.data.jobs[0];
        if (['done', 'failed', 'canceled', 'interrupted'].includes(job?.status)) return res.data;
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Mock generation did not settle.');
}
