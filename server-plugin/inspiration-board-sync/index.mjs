import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { installOpenRouterImagesBridge } from './openrouter-images-v58.mjs';

export const info = Object.freeze({
  id: 'inspiration-board-sync',
  name: 'Inspiration Board Sync',
  description: 'Per-user server storage, Android share-target inbox, and safe remote image/page bridge for SillyTavern Inspiration Board.',
});

const VERSION = '0.5.8';
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(PLUGIN_DIR, 'public');
const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const MAX_REMOTE_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_NATIVE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_NATIVE_REQUEST_BYTES = 20 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 18_000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 32, fileSize: 40 * 1024 * 1024, fields: 24 },
  fileFilter(_req, file, callback) {
    callback(null, String(file.mimetype || '').startsWith('image/'));
  },
});

function safeId(value, fallback = 'workspace') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return clean || fallback;
}

function userRoot(req) {
  const root = req.user?.directories?.root;
  if (typeof root === 'string' && root) return root;
  return path.join(process.cwd(), 'data', safeId(req.user?.profile?.handle || 'default-user'));
}

function storageRoot(req) {
  return path.join(userRoot(req), 'inspiration-board-sync');
}

function workspaceRoot(req) {
  return path.join(storageRoot(req), 'workspaces');
}

function shareRoot(req) {
  return path.join(storageRoot(req), 'shares');
}

async function ensureDirectories(req) {
  await Promise.all([
    fs.mkdir(workspaceRoot(req), { recursive: true }),
    fs.mkdir(shareRoot(req), { recursive: true }),
  ]);
}

async function atomicWrite(filename, data) {
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, filename);
}

async function readJson(filename, fallback = null) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch { return fallback; }
}

function firstHttpUrl(...values) {
  for (const value of values) {
    const match = String(value || '').match(/https?:\/\/[^\s<>"'\]\)]+/i);
    if (match) return match[0].slice(0, 4000);
  }
  return '';
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  const type = net.isIP(value);
  if (type === 4) return isPrivateIpv4(value);
  if (type !== 6) return true;
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith('ff')) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

async function validateRemoteUrl(value) {
  let url;
  try { url = new URL(String(value || '')); }
  catch { throw new Error('Invalid remote URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs are allowed.');
  if (url.username || url.password) throw new Error('Remote URLs with embedded credentials are not allowed.');
  if (url.href.length > 5000) throw new Error('Remote URL is too long.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Local/private hosts are not allowed.');
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error('Local/private network addresses are not allowed.');
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) throw new Error('Remote host resolved to a local/private network address.');
  url.hash = '';
  return url;
}

async function readResponseBytes(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Remote response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Remote response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchRemote(value, { accept = '*/*', maxBytes = MAX_PAGE_BYTES } = {}) {
  let current = await validateRemoteUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: accept,
          'Accept-Language': 'en-US,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36 InspirationBoard/0.4',
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Remote site returned a redirect without a destination.');
      current = await validateRemoteUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error(`Remote site returned HTTP ${response.status}.`);
    return {
      url: current.href,
      response,
      bytes: await readResponseBytes(response, maxBytes),
      contentType: String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
    };
  }
  throw new Error('Remote site redirected too many times.');
}

function decodeMarkup(value = '') {
  return String(value)
    .replace(/\\u002F/gi, '/')
    .replace(/\\u003A/gi, ':')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function tagAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeMarkup(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function metaValue(html, key) {
  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    const property = tagAttribute(tag, 'property') || tagAttribute(tag, 'name');
    if (property.toLowerCase() === String(key).toLowerCase()) return tagAttribute(tag, 'content');
  }
  return '';
}

function pageTitle(html) {
  return (metaValue(html, 'og:title') || decodeMarkup(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')).replace(/<[^>]+>/g, '').trim().slice(0, 300);
}

function pageDescription(html) {
  return (metaValue(html, 'og:description') || metaValue(html, 'description') || '').trim().slice(0, 2000);
}

function providerFor(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('pinterest.') || host === 'pin.it' || host.endsWith('.pinimg.com')) return 'pinterest';
    if (host === 'cosmos.so' || host.endsWith('.cosmos.so')) return 'cosmos';
  } catch {}
  return 'web';
}

function normalizeImageUrl(value, baseUrl) {
  const decoded = decodeMarkup(value).trim().replace(/^['"]|['"]$/g, '');
  if (!decoded || decoded.startsWith('data:') || decoded.startsWith('blob:')) return '';
  try {
    const url = new URL(decoded, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    if (url.hostname.endsWith('pinimg.com')) url.pathname = url.pathname.replace(/\/(?:236x|474x|564x|736x)\//, '/originals/');
    return url.href;
  } catch {
    return '';
  }
}

function extractImagesFromHtml(html, pageUrl) {
  const title = pageTitle(html);
  const description = pageDescription(html);
  const provider = providerFor(pageUrl);
  const seen = new Set();
  const images = [];
  const add = (value, extra = {}) => {
    const url = normalizeImageUrl(value, pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({
      url,
      pageUrl,
      provider,
      title: String(extra.title || title || '').slice(0, 240),
      description: String(extra.description || description || '').slice(0, 2000),
      alt: String(extra.alt || '').slice(0, 500),
      width: Math.max(0, Number(extra.width) || 0),
      height: Math.max(0, Number(extra.height) || 0),
      source: extra.source || 'page',
    });
  };

  for (const key of ['og:image', 'twitter:image', 'twitter:image:src']) {
    const value = metaValue(html, key);
    if (value) add(value, { source: key });
  }
  for (const tag of html.match(/<(?:img|source)\b[^>]*>/gi) || []) {
    for (const attr of ['src', 'data-src', 'data-lazy-src']) {
      const value = tagAttribute(tag, attr);
      if (value) add(value, { alt: tagAttribute(tag, 'alt'), width: tagAttribute(tag, 'width'), height: tagAttribute(tag, 'height'), source: attr });
    }
    const srcset = tagAttribute(tag, 'srcset') || tagAttribute(tag, 'data-srcset');
    if (srcset) {
      const entries = srcset.split(',').map(entry => entry.trim().split(/\s+/)[0]).filter(Boolean);
      if (entries.length) add(entries.at(-1), { alt: tagAttribute(tag, 'alt'), source: 'srcset' });
    }
  }

  const decoded = decodeMarkup(html);
  const urlPattern = /https?:\/\/[^\s"'<>\\]+/gi;
  for (const match of decoded.match(urlPattern) || []) {
    const clean = match.replace(/[),.;]+$/, '');
    if (/pinimg\.com/i.test(clean) || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#][^\s]*)?$/i.test(clean)) add(clean, { source: 'page-data' });
    if (images.length >= 160) break;
  }

  return { title, description, provider, images: images.slice(0, 120) };
}

async function workspaceList(req) {
  await ensureDirectories(req);
  const root = workspaceRoot(req);
  const names = await fs.readdir(root);
  const rows = [];
  for (const name of names.filter(entry => entry.endsWith('.ibsync'))) {
    const id = name.slice(0, -'.ibsync'.length);
    const filename = path.join(root, name);
    const stat = await fs.stat(filename);
    const metadata = await readJson(path.join(root, `${id}.json`), {});
    rows.push({
      id,
      name: metadata.name || id,
      encoding: metadata.encoding || 'identity',
      size: stat.size,
      createdAt: metadata.createdAt || stat.birthtimeMs,
      updatedAt: metadata.updatedAt || stat.mtimeMs,
    });
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function shareList(req) {
  await ensureDirectories(req);
  const root = shareRoot(req);
  const names = await fs.readdir(root);
  const rows = [];
  for (const name of names) {
    const folder = path.join(root, name);
    const stat = await fs.stat(folder).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const metadata = await readJson(path.join(folder, 'metadata.json'), null);
    if (!metadata) continue;
    rows.push({
      id: name,
      title: metadata.title || 'Android share',
      text: metadata.text || '',
      url: metadata.url || '',
      createdAt: metadata.createdAt || stat.birthtimeMs,
      fileCount: Array.isArray(metadata.files) ? metadata.files.length : 0,
    });
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}


async function readNativeCapturePayload(req) {
  const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/x-inspiration-board-capture') {
    return req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_NATIVE_REQUEST_BYTES) {
      const error = new Error('Native capture request is larger than 20 MB.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  if (!total) return {};

  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    const error = new Error('Native capture request is not valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

export async function init(router) {
  installOpenRouterImagesBridge(router);
  router.use('/app', express.static(PUBLIC_DIR, {
    index: 'index.html',
    fallthrough: true,
    maxAge: '5m',
  }));

  router.get('/status', async (req, res) => {
    try {
      const [workspaces, shares] = await Promise.all([workspaceList(req), shareList(req)]);
      res.json({
        ok: true,
        version: VERSION,
        workspaceCount: workspaces.length,
        pendingShareCount: shares.length,
        shareTargetUrl: `/api/plugins/${info.id}/app/`,
        capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy', 'native-json-capture', 'native-raw-capture', 'openrouter-image-api'],
      });
    } catch (error) {
      console.error('[Inspiration Board Sync] status failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/resolve-page', async (req, res) => {
    try {
      const requested = String(req.query.url || '');
      const remote = await fetchRemote(requested, { accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*;q=0.8,*/*;q=0.5', maxBytes: MAX_PAGE_BYTES });
      if (remote.contentType.startsWith('image/')) {
        return res.json({
          requestedUrl: requested,
          finalUrl: remote.url,
          provider: providerFor(remote.url),
          title: '',
          description: '',
          images: [{ url: remote.url, pageUrl: remote.url, provider: providerFor(remote.url), title: '', description: '', width: 0, height: 0, source: 'direct-image' }],
        });
      }
      if (!remote.contentType.includes('html') && !remote.contentType.startsWith('text/')) return res.status(415).json({ error: `Unsupported page content type: ${remote.contentType || 'unknown'}` });
      const html = remote.bytes.toString('utf8');
      const extracted = extractImagesFromHtml(html, remote.url);
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.json({ requestedUrl: requested, finalUrl: remote.url, ...extracted });
    } catch (error) {
      console.warn('[Inspiration Board Sync] page resolve failed', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/remote-image', async (req, res) => {
    try {
      const remote = await fetchRemote(String(req.query.url || ''), { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8', maxBytes: MAX_REMOTE_IMAGE_BYTES });
      if (!remote.contentType.startsWith('image/')) return res.status(415).json({ error: 'Remote URL did not return an image.' });
      res.setHeader('Content-Type', remote.contentType);
      res.setHeader('Content-Length', remote.bytes.length);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(remote.bytes);
    } catch (error) {
      console.warn('[Inspiration Board Sync] remote image failed', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/workspaces', async (req, res) => {
    try { res.json(await workspaceList(req)); }
    catch (error) { console.error(error); res.status(500).json({ error: error.message }); }
  });

  router.put('/workspaces/:id', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
    try {
      await ensureDirectories(req);
      const id = safeId(req.params.id);
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Workspace body is empty.' });
      const root = workspaceRoot(req);
      const filename = path.join(root, `${id}.ibsync`);
      const existing = await readJson(path.join(root, `${id}.json`), {});
      const now = Date.now();
      const metadata = {
        id,
        name: decodeURIComponent(String(req.get('X-Inspiration-Name') || id)).slice(0, 160),
        encoding: req.get('X-Inspiration-Encoding') === 'gzip' ? 'gzip' : 'identity',
        createdAt: existing.createdAt || now,
        updatedAt: now,
        size: req.body.length,
      };
      await atomicWrite(filename, req.body);
      await atomicWrite(path.join(root, `${id}.json`), JSON.stringify(metadata, null, 2));
      res.json(metadata);
    } catch (error) {
      console.error('[Inspiration Board Sync] workspace save failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/workspaces/:id', async (req, res) => {
    try {
      await ensureDirectories(req);
      const id = safeId(req.params.id);
      const root = workspaceRoot(req);
      const metadata = await readJson(path.join(root, `${id}.json`), null);
      const filename = path.join(root, `${id}.ibsync`);
      const data = await fs.readFile(filename);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', data.length);
      res.setHeader('X-Inspiration-Encoding', metadata?.encoding || 'identity');
      res.setHeader('Cache-Control', 'no-store');
      res.send(data);
    } catch (error) {
      if (error?.code === 'ENOENT') return res.status(404).json({ error: 'Workspace not found.' });
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/workspaces/:id', async (req, res) => {
    try {
      const id = safeId(req.params.id);
      const root = workspaceRoot(req);
      await Promise.all([
        fs.rm(path.join(root, `${id}.ibsync`), { force: true }),
        fs.rm(path.join(root, `${id}.json`), { force: true }),
      ]);
      res.json({ deleted: true, id });
    } catch (error) { console.error(error); res.status(500).json({ error: error.message }); }
  });

// SillyTavern globally parses application/json before server plugins are mounted.
// Do not attach a second JSON body parser here: re-reading an already-consumed request
// stream can throw before this handler's try/catch and surface as Express's generic HTML 500.
router.post('/capture-native', async (req, res) => {
  try {
    const body = await readNativeCapturePayload(req);
    if (body.probe === true) return res.json({ ok: true, probe: true, version: VERSION });
    await ensureDirectories(req);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const folder = path.join(shareRoot(req), id);
    await fs.mkdir(folder, { recursive: true });
    const files = [];

    if (body.image && typeof body.image === 'object' && body.image.data) {
      const mime = String(body.image.mime || '').slice(0, 120).toLowerCase();
      if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Native capture image type is not an image.' });
      const encoded = String(body.image.data || '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return res.status(400).json({ error: 'Native capture image data is not valid base64.' });
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length) return res.status(400).json({ error: 'Native capture image is empty.' });
      if (bytes.length > MAX_NATIVE_IMAGE_BYTES) return res.status(413).json({ error: 'Native capture image is larger than 12 MB.' });
      const rawName = String(body.image.name || 'capture.jpg').slice(0, 220);
      const extFromName = path.extname(rawName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 9);
      const extFromMime = mime.includes('png') ? '.png'
        : mime.includes('webp') ? '.webp'
        : mime.includes('gif') ? '.gif'
        : mime.includes('avif') ? '.avif'
        : '.jpg';
      const extension = extFromName || extFromMime;
      const stem = safeId(path.basename(rawName, path.extname(rawName)), 'capture');
      const filename = `01-${stem}${extension}`;
      await fs.writeFile(path.join(folder, filename), bytes);
      files.push({ filename, name: rawName, type: mime, size: bytes.length });
    }

    const text = String(body.text || '').slice(0, 20_000);
    const metadata = {
      id,
      title: String(body.title || 'Captured inspiration').slice(0, 200),
      text,
      url: firstHttpUrl(body.url, text),
      createdAt: Date.now(),
      files,
    };
    await atomicWrite(path.join(folder, 'metadata.json'), JSON.stringify(metadata, null, 2));
    res.json({ ok: true, id, fileCount: files.length });
  } catch (error) {
    console.error('[Inspiration Board Sync] native capture failed', error);
    const status = Number(error?.statusCode) || 500;
    res.status(status).json({ error: `Could not save native capture: ${error.message}` });
  }
});

  router.post('/share-target', upload.array('media', 32), async (req, res) => {
    try {
      await ensureDirectories(req);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      const folder = path.join(shareRoot(req), id);
      await fs.mkdir(folder, { recursive: true });
      const files = [];
      for (let index = 0; index < (req.files || []).length; index++) {
        const file = req.files[index];
        const extension = String(file.originalname || '').split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'img';
        const filename = `${String(index + 1).padStart(2, '0')}-${safeId(path.basename(file.originalname || `shared.${extension}`, path.extname(file.originalname || '')))}.${extension}`;
        await fs.writeFile(path.join(folder, filename), file.buffer);
        files.push({ filename, name: file.originalname || filename, type: file.mimetype || 'image/jpeg', size: file.size });
      }
      const text = String(req.body?.text || '').slice(0, 20_000);
      const metadata = {
        id,
        title: String(req.body?.title || 'Shared inspiration').slice(0, 200),
        text,
        url: firstHttpUrl(req.body?.url, text),
        createdAt: Date.now(),
        files,
      };
      await atomicWrite(path.join(folder, 'metadata.json'), JSON.stringify(metadata, null, 2));
      res.redirect(303, `/api/plugins/${info.id}/app/?received=${encodeURIComponent(id)}`);
    } catch (error) {
      console.error('[Inspiration Board Sync] share target failed', error);
      res.status(500).send(`Could not save shared images: ${error.message}`);
    }
  });

  router.get('/shares', async (req, res) => {
    try { res.json(await shareList(req)); }
    catch (error) { console.error(error); res.status(500).json({ error: error.message }); }
  });

  router.get('/shares/:id', async (req, res) => {
    try {
      const id = safeId(req.params.id);
      const folder = path.join(shareRoot(req), id);
      const metadata = await readJson(path.join(folder, 'metadata.json'), null);
      if (!metadata) return res.status(404).json({ error: 'Share bundle not found.' });
      const files = [];
      for (const file of metadata.files || []) {
        const data = await fs.readFile(path.join(folder, path.basename(file.filename)));
        files.push({ name: file.name, type: file.type, size: data.length, data: data.toString('base64') });
      }
      res.json({ ...metadata, files });
    } catch (error) { console.error(error); res.status(500).json({ error: error.message }); }
  });

  router.delete('/shares/:id', async (req, res) => {
    try {
      const id = safeId(req.params.id);
      await fs.rm(path.join(shareRoot(req), id), { recursive: true, force: true });
      res.json({ deleted: true, id });
    } catch (error) { console.error(error); res.status(500).json({ error: error.message }); }
  });

  console.log(`[Inspiration Board Sync] v${VERSION} ready`);
}
