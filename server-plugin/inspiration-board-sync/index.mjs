import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';

export const info = Object.freeze({
  id: 'inspiration-board-sync',
  name: 'Inspiration Board Sync',
  description: 'Per-user server storage and Android share-target inbox for SillyTavern Inspiration Board.',
});

const VERSION = '0.3.0';
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(PLUGIN_DIR, 'public');
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

export async function init(router) {
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
        shareTargetUrl: '/api/plugins/inspiration-board-sync/app/',
      });
    } catch (error) {
      console.error('[Inspiration Board Sync] status failed', error);
      res.status(500).json({ error: error.message });
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
      const metadata = {
        id,
        title: String(req.body?.title || 'Shared inspiration').slice(0, 200),
        text: String(req.body?.text || '').slice(0, 20_000),
        url: String(req.body?.url || '').slice(0, 2000),
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
