import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { collectionAction, migrateGallery, text } from './collections.mjs';
import { stageBackup, streamBackup, mergeBackup, backupSummary } from './backup.mjs';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const tokenPattern = /^[a-f0-9-]{36}$/;
const hashAvatar = avatar => createHash('sha256').update(`avatar:${avatar}`).digest('hex');

export function installLibraryApi({ route, root, folder, read, write, edit, locked, imageBytes, atomicJson, isRunning }) {
    const idleImages = (req, g, ids) => {
        if (g.jobs.some(j => isRunning(req, g.id, j.id) && (j.referenceIds || []).some(id => ids.includes(id)))) throw fail('A running job is using one of these references. Wait for it to finish.', 409);
    };
    const organize = async (req, body) => edit(req, req.params.id, async g => {
        if (['trash', 'purge'].includes(body.action)) idleImages(req, g, body.ids || []);
        const result = collectionAction(g, body, randomUUID);
        if (result.purgeFiles) {
            await write(req, g); // metadata first; never leave an image record pointing at a deleted file
            for (const name of result.purgeFiles) if (name === path.basename(name)) await fs.unlink(path.join(folder(req, g.id), name)).catch(() => {});
            delete result.purgeFiles;
        }
        return result;
    });
    route('post', '/gallery/:id/organize', async (req, _res, body) => organize(req, body));
    // Backward compatible DELETE is now recoverable instead of destructive.
    route('delete', '/gallery/:id/images', async (req, _res, body) => { const result = await organize(req, { ...body, action: 'trash' }); return { removed: result.changed, recoverable: true }; });
    route('post', '/gallery/:id/image/:image/thumbnail', async (req, _res, body) => edit(req, req.params.id, async g => {
        const row = [...g.images, ...g.trash].find(i => i.id === req.params.image); if (!row) throw fail('Image not found.', 404);
        const data = imageBytes(body.dataUrl);
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(data.mime) || data.bytes.length > 256 * 1024) throw fail('Thumbnail must be a small raster image.');
        const filename = `${row.id}.thumb.${data.ext}`;
        await fs.writeFile(path.join(folder(req, g.id), filename), data.bytes);
        row.thumbnailFilename = filename; row.thumbnailMime = data.mime;
        return { saved: true };
    }));
    route('get', '/gallery/:id/image/:image/thumbnail', async (req, res) => {
        const g = await read(req, req.params.id), row = [...g.images, ...g.trash].find(i => i.id === req.params.image);
        if (!row?.thumbnailFilename) throw fail('Thumbnail not cached yet.', 404);
        const bytes = await fs.readFile(path.join(folder(req, g.id), row.thumbnailFilename));
        res.setHeader('Content-Type', row.thumbnailMime); res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=86400'); res.send(bytes);
    });
    route('get', '/galleries', async req => {
        await fs.mkdir(root(req), { recursive: true }); const rows = [];
        for (const name of await fs.readdir(root(req))) {
            if (!/^[a-f0-9]{64}$/.test(name)) continue;
            try { const g = await read(req, name); rows.push({ id: g.id, avatar: g.avatar, updatedAt: g.updatedAt, ...backupSummary(g) }); }
            catch { /* A broken unrelated gallery must not make relinking impossible. */ }
        }
        return { galleries: rows.sort((a, b) => b.updatedAt - a.updatedAt) };
    });
    route('post', '/gallery/relink', async (req, _res, body) => {
        const avatar = text(body.avatar, 500).trim();
        if (!avatar || body.confirm !== true) throw fail('Choose a gallery and confirm the new association.');
        const source = await read(req, body.sourceId); // folder/read enforce same-user storage and ID validation
        const bindingsFile = path.join(root(req), 'bindings.json');
        await locked(bindingsFile, async () => {
            const bindings = await readBindings(root(req));
            bindings[hashAvatar(avatar)] = source.id; await atomicJson(bindingsFile, bindings);
        });
        return { gallery: source, message: 'Linked. Existing galleries and files were not deleted or merged.' };
    });
    route('post', '/gallery/unlink', async (req, _res, body) => {
        const avatar = text(body.avatar, 500).trim(); if (!avatar || body.confirm !== true) throw fail('Confirm unlinking this character.');
        const file = path.join(root(req), 'bindings.json');
        await locked(file, async () => { const bindings = await readBindings(root(req)); delete bindings[hashAvatar(avatar)]; await atomicJson(file, bindings); });
        return { unlinked: true };
    });
    route('get', '/gallery/:id/export', async (req, res) => locked(folder(req, req.params.id), async () => {
        const g = await read(req, req.params.id);
        res.setHeader('Content-Type', 'application/gzip'); res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `attachment; filename="${text(g.name, 80).replace(/[^a-zA-Z0-9_-]/g, '_') || 'gallery'}.cgs.jsonl.gz"`);
        await streamBackup(g, folder(req, g.id), res);
    }));
    const staging = (req, token) => { if (!tokenPattern.test(String(token))) throw fail('Invalid import token.'); return path.join(root(req), '.imports', token); };
    const cleanupImports = async req => {
        const dir = path.join(root(req), '.imports');
        for (const name of await fs.readdir(dir).catch(() => [])) {
            if (!tokenPattern.test(name)) continue;
            const file = path.join(dir, name), stat = await fs.stat(file).catch(() => null);
            if (stat && Date.now() - stat.mtimeMs > 3600000) await fs.rm(file, { recursive: true, force: true });
        }
    };
    route('post', '/imports/preview', async req => {
        await cleanupImports(req);
        return stageBackup(req, root(req), imageBytes);
    }, { raw: true });
    route('delete', '/imports/:token', async req => { await fs.rm(staging(req, req.params.token), { recursive: true, force: true }); return { discarded: true }; });
    route('post', '/gallery/:id/import', async (req, _res, body) => {
        const directory = staging(req, body.token);
        return locked(directory, async () => {
            let record;
            try { record = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')); }
            catch { throw fail('Import preview expired or is missing. Choose your backup again.'); }
            if (Date.now() - record.createdAt > 3600000) throw fail('Import preview expired. Choose your backup again.');
            const source = record.gallery;
            const result = await edit(req, req.params.id, async target => {
                migrateGallery(target);
                if (target.albums.length + source.albums.length > 200 || target.referenceSets.length + source.referenceSets.length > 200) throw fail('Import would exceed 200 albums or reference sets.');
                const copied = [];
                try {
                    for (const row of [...source.images, ...source.trash]) {
                        const dest = path.join(folder(req, target.id), row.filename);
                        await fs.copyFile(path.join(directory, row.filename), dest, 1); copied.push(dest);
                    }
                    mergeBackup(target, source, body.applySettings === true);
                } catch (e) { await Promise.all(copied.map(file => fs.unlink(file).catch(() => {}))); throw e; }
                return { imported: source.images.length + source.trash.length, summary: backupSummary(source) };
            });
            await fs.rm(directory, { recursive: true, force: true }); return result;
        });
    });
}
export async function readBindings(root) {
    try { const value = JSON.parse(await fs.readFile(path.join(root, 'bindings.json'), 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
