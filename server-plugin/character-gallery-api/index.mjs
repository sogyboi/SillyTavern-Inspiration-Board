import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { VERSION, ROLES, settingsWithDefaults, referenceImages, validateRequest, buildProviderRequest } from './core.mjs';
import { migrateGallery } from './collections.mjs';
import { installLibraryApi, readBindings } from './library-api.mjs';
import { normalizeOpenRouter, normalizeVenice } from './models.mjs';

export const info = Object.freeze({ id: 'character-gallery-api', name: 'Character Gallery Studio API', description: 'Private per-user character galleries and OpenRouter/Venice image generation.' });
const BASES = { openrouter: 'https://openrouter.ai/api/v1', venice: 'https://api.venice.ai/api/v1' };
const ACTIVE = new Set(['queued', 'preparing', 'sending', 'saving']);
const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_BODY = 40 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (v, n = 200) => String(v ?? '').slice(0, n);
const mimeExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };

export function imageBytes(dataUrl) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif|avif|svg\+xml));base64,([A-Za-z0-9+/\s]+={0,2})$/.exec(String(dataUrl || ''));
    if (!match) throw fail('The image must be PNG, JPEG, WebP, GIF, AVIF or SVG data.');
    const encoded = match[2].replace(/\s/g, '');
    if (encoded.length > Math.ceil(MAX_IMAGE * 4 / 3) + 4) throw fail('Each image must be 25 MB or smaller.', 413);
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw fail('Invalid or incomplete image data.');
    const mime = sniffMime(bytes);
    if (!mime || mime !== match[1]) throw fail('Image contents do not match the declared file type.');
    if (mime === 'image/svg+xml' && /<script\b|<foreignObject\b|\bon\w+\s*=/i.test(bytes.toString('utf8'))) throw fail('SVG images with active content are not accepted.');
    return { bytes, mime, ext: mimeExt[mime], sha256: hash(bytes) };
}
function sniffMime(bytes) {
    if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (/^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
    if (bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii', 8, 40))) return 'image/avif';
    if (/<svg[\s>]/i.test(bytes.toString('utf8', 0, 1024))) return 'image/svg+xml';
    return null;
}
async function readBody(req) {
    const type = String(req.headers?.['content-type'] || req.get?.('content-type') || '').split(';')[0];
    if (type !== 'application/x-character-gallery') {
        if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && !Array.isArray(req.body)) return req.body;
        throw fail('Expected a Character Gallery JSON request.');
    }
    const chunks = []; let length = 0;
    for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BODY) throw fail('Request too large. Upload images one at a time.', 413);
        chunks.push(chunk);
    }
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 0; return parsed; }
    catch { throw fail('Invalid JSON request.'); }
}
async function atomicJson(file, data) {
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    try { await fs.rename(tmp, file); } finally { await fs.unlink(tmp).catch(() => {}); }
}
async function payload(response) {
    const text = await response.text();
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 800) }; }
}
function errorText(data, status) { return clean(data?.error?.message || data?.error || data?.message || `Provider returned HTTP ${status}.`, 1000); }

/** Injectable keys/network allow offline tests of the actual routes without spending credits. */
export function createGalleryApi({ secretStore, fetchImpl = globalThis.fetch }) {
    const locks = new Map(), running = new Map(), catalogs = new Map();
    function root(req) {
        if (!req.user?.directories?.root) throw fail('A signed-in SillyTavern user is required.', 401);
        return path.join(req.user.directories.root, 'character-gallery-studio');
    }
    function folder(req, id) {
        if (!/^[a-f0-9]{64}$/.test(String(id))) throw fail('Invalid gallery ID.');
        return path.join(root(req), id);
    }
    async function locked(key, work) {
        const prev = locks.get(key) || Promise.resolve();
        const next = prev.catch(() => {}).then(work); locks.set(key, next);
        try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
    }
    async function read(req, id) {
        try { return migrateGallery(JSON.parse(await fs.readFile(path.join(folder(req, id), 'gallery.json'), 'utf8'))); }
        catch (e) { if (e.code === 'ENOENT') throw fail('Gallery not found.', 404); throw e; }
    }
    async function write(req, gallery) {
        gallery.updatedAt = Date.now();
        await atomicJson(path.join(folder(req, gallery.id), 'gallery.json'), gallery);
        return gallery;
    }
    async function edit(req, id, work) {
        return locked(folder(req, id), async () => { const g = await read(req, id); const result = await work(g); await write(req, g); return result ?? g; });
    }
    async function keyFor(req, provider) {
        if (!BASES[provider]) throw fail('Unknown provider.');
        const key = await secretStore.read(req, provider);
        if (!key) throw fail(`Save an ${provider === 'venice' ? 'Venice' : 'OpenRouter'} API key in Connections first.`, 400);
        return key;
    }
    async function request(provider, key, pathname, { body, signal, timeout = 30000 } = {}) {
        const response = await fetchImpl(`${BASES[provider]}${pathname}`, {
            method: body ? 'POST' : 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json', 'HTTP-Referer': 'https://github.com/sogyboi/SillyTavern-Inspiration-Board', 'X-Title': 'Character Gallery Studio' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw fail(errorText(await payload(response), response.status), response.status >= 400 && response.status <= 599 ? response.status : 502);
        return response;
    }
    async function catalog(req, provider, refresh = false) {
        const key = await keyFor(req, provider), cacheKey = `${provider}:${hash(key)}`;
        const cached = catalogs.get(cacheKey);
        if (!refresh && cached && Date.now() - cached.at < 600000) return cached.promise;
        const promise = (async () => {
            if (provider === 'venice') {
                const [gen, editModels, traits] = await Promise.all([
                    request(provider, key, '/models?type=image').then(payload), request(provider, key, '/models?type=inpaint').then(payload),
                    request(provider, key, '/models/traits?type=image').then(payload).catch(() => ({})),
                ]);
                return [...(gen.data || []).map(m => normalizeVenice({ ...m, type: 'image' }, traits.data || {})), ...(editModels.data || []).map(m => normalizeVenice({ ...m, type: 'inpaint' }, traits.data || {}))];
            }
            const [images, chat] = await Promise.all([
                request(provider, key, '/images/models').then(payload), request(provider, key, '/models?output_modalities=image').then(payload).catch(() => ({})),
            ]);
            const rows = Array.isArray(images.data) ? images.data : [], result = [];
            // Bounded catalog enrichment. A failed price lookup does not hide the model.
            for (let i = 0; i < rows.length; i += 4) {
                result.push(...await Promise.all(rows.slice(i, i + 4).map(async m => {
                    const id = String(m.id).split('/').map(encodeURIComponent).join('/');
                    const endpoints = await request(provider, key, `/images/models/${id}/endpoints`, { timeout: 12000 }).then(payload).catch(() => ({}));
                    return normalizeOpenRouter(m, endpoints.endpoints || [], (chat.data || []).find(c => c.id === m.id) || {});
                })));
            }
            return result;
        })();
        catalogs.set(cacheKey, { at: Date.now(), promise });
        try { return await promise; } catch (e) { if (catalogs.get(cacheKey)?.promise === promise) catalogs.delete(cacheKey); throw e; }
    }
    async function addImage(req, gallery, dataUrl, fields = {}) {
        const data = imageBytes(dataUrl), id = randomUUID(), filename = `${id}.${data.ext}`;
        await fs.writeFile(path.join(folder(req, gallery.id), filename), data.bytes);
        const row = { id, filename, name: clean(fields.name || 'Image'), mime: data.mime, bytes: data.bytes.length, sha256: data.sha256, width: Number(fields.width) || 0, height: Number(fields.height) || 0, role: 'general', favorite: false, tags: [], notes: '', source: fields.source || 'upload', state: fields.source === 'generated' ? 'review' : 'kept', albumIds: [], createdAt: Date.now(), ...(fields.generation ? { generation: fields.generation } : {}) };
        gallery.images.unshift(row); return row;
    }
    async function changeJob(req, id, jobId, update) {
        return edit(req, id, g => { const job = g.jobs.find(j => j.id === jobId); if (job) Object.assign(job, update, { updatedAt: Date.now() }); return job; });
    }
    async function runGeneration(req, galleryId, job, model, key, control) {
        const runKey = `${folder(req, galleryId)}:${job.id}`;
        try {
            await changeJob(req, galleryId, job.id, { status: 'preparing', message: 'Reading original reference images…' });
            const g = await read(req, galleryId), originals = [];
            for (const id of job.referenceIds) {
                const row = g.images.find(r => r.id === id);
                if (!row) throw fail('A selected reference is missing. No request was sent.');
                const bytes = await fs.readFile(path.join(folder(req, galleryId), row.filename));
                if (hash(bytes) !== row.sha256) throw fail('A reference failed its integrity check. No request was sent.');
                originals.push({ dataUrl: `data:${row.mime};base64,${bytes.toString('base64')}`, id, bytes: bytes.length, sha256: row.sha256 });
            }
            const outgoing = buildProviderRequest(model, job.settings, originals.map(r => r.dataUrl));
            const receipt = { endpoint: outgoing.path, referenceCount: originals.length, originals: originals.map(({ dataUrl, ...row }) => row), meaning: 'Local outgoing request details; not a guarantee of model fidelity.' };
            if (control.signal.aborted) throw fail('Stopped locally.');
            await changeJob(req, galleryId, job.id, { status: 'sending', sentAt: Date.now(), receipt, message: `Request dispatched with ${originals.length} original reference(s). Waiting for ${model.provider}…` });
            const response = await request(model.provider, key, outgoing.path, { body: outgoing.body, signal: control.signal, timeout: 300000 });
            const contentType = response.headers.get('content-type') || '';
            let encoded = [], responseId = response.headers.get('x-request-id') || '';
            if (contentType.startsWith('image/')) {
                const bytes = Buffer.from(await response.arrayBuffer()), mime = sniffMime(bytes);
                if (!mime) throw fail('Provider returned an unrecognized image.', 502);
                encoded = [`data:${mime};base64,${bytes.toString('base64')}`];
            } else {
                const data = await payload(response); responseId = clean(data.id || responseId);
                const images = model.provider === 'openrouter' ? (data.data || []).map(r => r.b64_json) : data.images || [];
                encoded = images.filter(x => typeof x === 'string' && x).map(x => {
                    if (x.startsWith('data:')) return x;
                    const bytes = Buffer.from(x, 'base64'), mime = sniffMime(bytes);
                    if (!mime) throw fail('Provider returned unsupported image data.', 502);
                    return `data:${mime};base64,${x}`;
                });
            }
            if (!encoded.length) throw fail('The provider returned no image data.', 502);
            await changeJob(req, galleryId, job.id, { status: 'saving', responseAt: Date.now(), responseId, httpStatus: response.status, message: 'Images received. Saving to this character’s gallery…' });
            await edit(req, galleryId, async gallery => {
                const resultIds = [];
                for (let i = 0; i < encoded.length; i++) {
                    const image = await addImage(req, gallery, encoded[i], { source: 'generated', name: `${model.name} · ${i + 1}`, generation: { jobId: job.id, provider: model.provider, model: model.id, prompt: job.settings.prompt, receipt } });
                    resultIds.push(image.id);
                }
                const record = gallery.jobs.find(j => j.id === job.id);
                Object.assign(record, { status: 'done', message: `${resultIds.length} image(s) saved.`, resultIds, finishedAt: Date.now() });
            });
        } catch (error) {
            await changeJob(req, galleryId, job.id, { status: control.signal.aborted ? 'canceled' : 'failed', message: control.signal.aborted ? 'Stopped locally. The provider may still process and charge for this request.' : error.name === 'TimeoutError' ? 'Provider timed out. It may still charge; retry is never automatic.' : clean(error.message, 1000), finishedAt: Date.now() }).catch(() => {});
        } finally { running.delete(runKey); }
    }
    function install(router) {
        const route = (method, url, handler, { raw = false } = {}) => router[method](url, async (req, res) => {
            try {
                root(req); res.setHeader('Cache-Control', 'no-store');
                const body = !raw && ['post', 'patch', 'delete'].includes(method) ? await readBody(req) : {};
                const result = await handler(req, res, body);
                if (result !== undefined && !res.headersSent) res.json(result);
            } catch (error) {
                if (!res.headersSent) res.status(Number(error.status) || 500).json({ error: clean(error.message || 'Gallery request failed.', 1000) });
            }
        });
        installLibraryApi({ route, root, folder, read, write, edit, locked, imageBytes, atomicJson, isRunning: (req, id, job) => running.has(`${folder(req, id)}:${job}`) });
        route('get', '/status', async req => ({ version: VERSION, storage: 'server', features: ['collections-v2', 'backup-v1'], configured: { openrouter: Boolean(await secretStore.read(req, 'openrouter')), venice: Boolean(await secretStore.read(req, 'venice')) } }));
        route('post', '/key', async (req, _res, body) => {
            const provider = body.provider;
            if (!BASES[provider] || !String(body.key || '').trim()) throw fail('Choose a provider and enter its API key.');
            const key = clean(body.key, 1000).trim();
            await request(provider, key, provider === 'venice' ? '/models?type=image' : '/images/models');
            await secretStore.write(req, provider, key); return { configured: true };
        });
        route('get', '/models/:provider', async req => ({ models: await catalog(req, req.params.provider, req.query?.refresh === '1') }));
        route('post', '/gallery/open', async (req, _res, body) => {
            const avatar = clean(body.avatar, 500); if (!avatar) throw fail('Open a character chat first.');
            const bindings = await readBindings(root(req));
            const id = bindings[hash(`avatar:${avatar}`)] || hash(`avatar:${avatar}`), dir = folder(req, id);
            return locked(dir, async () => {
                await fs.mkdir(dir, { recursive: true });
                let gallery;
                try { gallery = await read(req, id); } catch (e) { if (e.status !== 404) throw e; }
                gallery ||= { id, avatar, name: clean(body.name || avatar), mainImageId: null, images: [], jobs: [], settings: settingsWithDefaults(), createdAt: Date.now() };
                gallery.name = clean(body.name || gallery.name); migrateGallery(gallery); return write(req, gallery);
            });
        });
        route('get', '/gallery/:id', async req => locked(folder(req, req.params.id), async () => {
            const g = await read(req, req.params.id); let changed = false;
            for (const job of g.jobs) if (ACTIVE.has(job.status) && !running.has(`${folder(req, g.id)}:${job.id}`)) {
                Object.assign(job, { status: 'interrupted', message: 'Server restarted during this job. It was not automatically resubmitted. Check provider billing before retrying.', finishedAt: Date.now() }); changed = true;
            }
            return changed ? write(req, g) : g;
        }));
        route('patch', '/gallery/:id/settings', async (req, _res, body) => edit(req, req.params.id, g => { g.settings = settingsWithDefaults(body.settings); return { settings: g.settings }; }));
        route('post', '/gallery/:id/images', async (req, _res, body) => edit(req, req.params.id, async g => ({ image: await addImage(req, g, body.dataUrl, { name: body.name, width: body.width, height: body.height }) })));
        route('patch', '/gallery/:id/image/:image', async (req, _res, body) => edit(req, req.params.id, g => {
            const image = g.images.find(i => i.id === req.params.image); if (!image) throw fail('Image not found.', 404);
            if (body.name !== undefined) image.name = clean(body.name);
            if (body.notes !== undefined) image.notes = clean(body.notes, 2000);
            if (ROLES.includes(body.role)) image.role = body.role;
            if (typeof body.favorite === 'boolean') image.favorite = body.favorite;
            if (Array.isArray(body.tags)) image.tags = body.tags.map(t => clean(t, 50)).filter(Boolean).slice(0, 20);
            return image;
        }));
        route('post', '/gallery/:id/main', async (req, _res, body) => edit(req, req.params.id, g => {
            if (body.imageId !== null && !g.images.some(i => i.id === body.imageId)) throw fail('Image not found.', 404);
            g.mainImageId = body.imageId;
        }));
        route('get', '/gallery/:id/image/:image', async (req, res) => {
            const g = await read(req, req.params.id), image = [...g.images, ...g.trash].find(i => i.id === req.params.image);
            if (!image) throw fail('Image not found.', 404);
            const bytes = await fs.readFile(path.join(folder(req, g.id), image.filename));
            res.setHeader('Content-Type', image.mime); res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
            if (req.query?.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${image.filename}"`);
            res.send(bytes);
        });
        route('post', '/gallery/:id/generate', async (req, res, body) => {
            const settings = settingsWithDefaults(body.settings), key = await keyFor(req, settings.provider);
            const model = (await catalog(req, settings.provider)).find(m => m.id === settings.providers[settings.provider].model);
            const control = new AbortController();
            const job = await edit(req, req.params.id, g => {
                if (g.jobs.some(j => ACTIVE.has(j.status) && running.has(`${folder(req, g.id)}:${j.id}`))) throw fail('This character already has a generation running.', 409);
                const refs = referenceImages(g, settings); validateRequest(model, settings, refs);
                const job = { id: randomUUID(), galleryId: g.id, characterName: g.name, status: 'queued', message: 'Queued locally.', provider: model.provider, model: model.id, modelName: model.name, settings, referenceIds: refs.map(r => r.id), resultIds: [], createdAt: Date.now() };
                g.settings = settings; g.jobs = [job, ...g.jobs].slice(0, 30);
                running.set(`${folder(req, g.id)}:${job.id}`, control); return job;
            });
            res.status(202).json({ job });
            void runGeneration(req, req.params.id, job, model, key, control);
        });
        route('post', '/gallery/:id/job/:job/cancel', async req => {
            const control = running.get(`${folder(req, req.params.id)}:${req.params.job}`);
            if (!control) throw fail('This job is no longer active.', 409);
            control.abort(); return { message: 'Stopping locally. Provider charges may still apply.' };
        });
    }
    return { install, catalog };
}
export async function init(router) {
    // When copied to SillyTavern/plugins/character-gallery-api/, this is ST's own secrets API.
    const { readSecret, writeSecret, SECRET_KEYS } = await import('../../src/endpoints/secrets.js');
    const secretName = provider => provider === 'venice' ? 'api_key_venice' : SECRET_KEYS.OPENROUTER;
    const api = createGalleryApi({ secretStore: { read: (req, p) => readSecret(req.user.directories, secretName(p)), write: (req, p, key) => writeSecret(req.user.directories, secretName(p), key) } });
    api.install(router);
    console.info(`[Character Gallery Studio] API v${VERSION} ready`);
}
