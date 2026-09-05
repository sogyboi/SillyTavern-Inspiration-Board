import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { settingsWithDefaults } from './core.mjs';
import { text, uniqueIds, migrateGallery } from './collections.mjs';

export const BACKUP_FORMAT = 'character-gallery-studio';
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED = Math.ceil(MAX_BACKUP_BYTES * 1.5) + 40 * 1024 * 1024;
const MAX_LINE = 36 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { status: 400 });
const id = value => uniqueIds([value], 1)[0] || '';
const when = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : Date.now();
const pick = (object, keys) => Object.fromEntries(keys.filter(k => object[k] !== undefined).map(k => [k, object[k]]));
function receipt(r) {
    if (!r || typeof r !== 'object') return undefined;
    return { endpoint: text(r.endpoint, 100), referenceCount: Number(r.referenceCount) || 0,
        originals: (Array.isArray(r.originals) ? r.originals : []).slice(0, 50).map(i => ({ id: id(i.id), bytes: Math.max(0, Number(i.bytes) || 0), sha256: text(i.sha256, 64) })), meaning: 'Original outgoing request record, not proof of provider fidelity.' };
}
function generation(g) {
    if (!g || typeof g !== 'object') return undefined;
    return { jobId: id(g.jobId), provider: text(g.provider, 30), model: text(g.model, 200), prompt: text(g.prompt, 32000), receipt: receipt(g.receipt) };
}
/** Whitelisting prevents credentials, paths, or arbitrary settings entering an export/import. */
export function portableGallery(input) {
    const g = migrateGallery(structuredClone(input));
    const image = i => ({ id: id(i.id), name: text(i.name), mime: text(i.mime, 40), sha256: text(i.sha256, 64), bytes: Math.max(0, Number(i.bytes) || 0), width: Math.max(0, Number(i.width) || 0), height: Math.max(0, Number(i.height) || 0), role: text(i.role, 30), favorite: i.favorite === true, tags: (Array.isArray(i.tags) ? i.tags : []).slice(0, 20).map(t => text(t, 50)), notes: text(i.notes, 2000), state: i.state, albumIds: uniqueIds(i.albumIds, 200), source: i.source === 'generated' ? 'generated' : 'upload', createdAt: when(i.createdAt), ...(i.deletedAt ? { deletedAt: when(i.deletedAt), wasMain: i.wasMain === true } : {}), generation: generation(i.generation) });
    return {
        name: text(g.name), avatar: text(g.avatar, 500), createdAt: when(g.createdAt), mainImageId: id(g.mainImageId) || null,
        settings: settingsWithDefaults(g.settings), images: g.images.map(image), trash: g.trash.map(image),
        albums: g.albums.slice(0, 200).map(a => ({ id: id(a.id), name: text(a.name, 80), createdAt: when(a.createdAt) })),
        referenceSets: g.referenceSets.slice(0, 200).map(s => ({ id: id(s.id), name: text(s.name, 80), guidance: text(s.guidance, 2000), identityIds: uniqueIds(s.identityIds, 50), temporaryIds: uniqueIds(s.temporaryIds, 50), baseId: id(s.baseId), createdAt: when(s.createdAt), updatedAt: when(s.updatedAt) })),
        jobs: g.jobs.slice(0, 30).map(j => ({ provider: text(j.provider, 30), model: text(j.model, 200), modelName: text(j.modelName, 200), status: text(j.status, 30), httpStatus: Number(j.httpStatus) || 0, id: id(j.id), characterName: text(j.characterName), message: text(j.message, 1000), settings: settingsWithDefaults(j.settings), referenceIds: uniqueIds(j.referenceIds, 50), resultIds: uniqueIds(j.resultIds), receipt: receipt(j.receipt), createdAt: when(j.createdAt), finishedAt: when(j.finishedAt), responseId: text(j.responseId, 200) })),
    };
}
export function backupSummary(g) { return { name: g.name, images: g.images.length, trash: g.trash.length, albums: g.albums.length, referenceSets: g.referenceSets.length, bytes: [...g.images, ...g.trash].reduce((n, i) => n + i.bytes, 0) }; }
function validateSize(g) {
    if (g.images.length + g.trash.length > 10000 || backupSummary(g).bytes > MAX_BACKUP_BYTES) throw fail('A backup can contain up to 10,000 images and 512 MB of originals.');
}
export async function* backupRecords(gallery, folder) {
    const g = portableGallery(gallery); validateSize(g);
    const rows = [...g.images, ...g.trash], originals = [...gallery.images, ...(gallery.trash || [])];
    yield JSON.stringify({ kind: 'header', format: BACKUP_FORMAT, version: 1, gallery: g }) + '\n';
    for (const row of rows) {
        const original = originals.find(i => i.id === row.id);
        if (!original || path.basename(original.filename) !== original.filename) throw fail('An original image is missing or invalid.');
        const bytes = await fs.readFile(path.join(folder, original.filename));
        if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw fail('Original image integrity check failed.');
        yield JSON.stringify({ kind: 'image', id: row.id, dataUrl: `data:${row.mime};base64,${bytes.toString('base64')}` }) + '\n';
    }
    yield JSON.stringify({ kind: 'complete', count: rows.length }) + '\n';
}
export async function streamBackup(g, folder, output) {
    validateSize(portableGallery(g));
    await pipeline(Readable.from(backupRecords(g, folder)), createGzip(), output);
}
function limiter(max) { let bytes = 0; return new Transform({ transform(chunk, _enc, done) { bytes += chunk.length; done(bytes > max ? fail('Backup exceeds the safe import limit.') : null, chunk); } }); }
async function* lines(stream) {
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]); let at;
        while ((at = buffer.indexOf(10)) >= 0) {
            if (at > MAX_LINE) throw fail('Backup record is too large.');
            const line = buffer.subarray(0, at).toString('utf8'); buffer = buffer.subarray(at + 1);
            if (line.trim()) yield JSON.parse(line);
        }
        if (buffer.length > MAX_LINE) throw fail('Backup record is too large.');
    }
    if (buffer.length) throw fail('Backup is truncated. No images were imported.');
}
export async function stageBackup(input, root, decodeImage) {
    const token = randomUUID(), directory = path.join(root, '.imports', token);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    let rejection;
    let gallery, expected, completed = false, bytes = 0; const seen = new Set();
    try {
        await pipeline(input, limiter(MAX_EXPANDED), createGunzip(), limiter(MAX_EXPANDED), async source => {
            try {
            for await (const record of lines(source)) {
                if (completed) throw fail('Unexpected trailing backup records.');
                if (!gallery) {
                    if (record.kind !== 'header' || record.format !== BACKUP_FORMAT || record.version !== 1 || !record.gallery || !Array.isArray(record.gallery.images)) throw fail('Not a supported Character Gallery backup.');
                    gallery = portableGallery(record.gallery); validateSize(gallery);
                    const rows = [...gallery.images, ...gallery.trash]; expected = new Map(rows.map(i => [i.id, i]));
                    if (expected.size !== rows.length || rows.some(i => !i.id)) throw fail('Backup contains invalid or duplicate image IDs.');
                } else if (record.kind === 'image') {
                    const row = expected.get(record.id); if (!row || seen.has(record.id)) throw fail('Unexpected or duplicate image in backup.');
                    const data = decodeImage(record.dataUrl); bytes += data.bytes.length;
                    if (bytes > MAX_BACKUP_BYTES) throw fail('Backup exceeds 512 MB of originals.');
                    if (data.mime !== row.mime || data.sha256 !== row.sha256 || data.bytes.length !== row.bytes) throw fail('Backup image integrity check failed.');
                    row.filename = `${randomUUID()}.${data.ext}`;
                    await fs.writeFile(path.join(directory, row.filename), data.bytes); seen.add(row.id);
                } else if (record.kind === 'complete') {
                    if (record.count !== expected.size || seen.size !== expected.size) throw fail('Backup is incomplete.');
                    completed = true;
                } else throw fail('Unexpected backup record.');
            }
            } catch (error) { rejection = error; throw error; }
        });
        if (!completed) throw fail('Backup is incomplete. No images were imported.');
        await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ gallery, createdAt: Date.now() }));
        return { token, summary: backupSummary(gallery) };
    } catch (e) { await fs.rm(directory, { recursive: true, force: true }); throw fail(`Import rejected: ${text((rejection || e).message, 300)}`); }
}
export function mergeBackup(target, source, applySettings = false) {
    const images = [...source.images, ...source.trash], mapping = new Map(images.map(i => [i.id, randomUUID()]));
    const missing = old => old ? mapping.get(old) || `missing_${createHash('sha256').update(String(old)).digest('hex').slice(0, 24)}` : '';
    const albums = new Map(source.albums.map(a => [a.id, randomUUID()]));
    const sets = new Map(source.referenceSets.map(s => [s.id, randomUUID()]));
    const jobs = new Map(source.jobs.map(j => [j.id, randomUUID()]));
    const settings = original => {
        const s = settingsWithDefaults(original);
        s.selectedIds = s.selectedIds.map(missing); s.identityIds = s.identityIds.map(missing); s.referenceBaseId = missing(s.referenceBaseId); s.activeReferenceSetId = sets.get(s.activeReferenceSetId) || '';
        return s;
    };
    const remapReceipt = r => r ? { ...r, originals: r.originals.map(o => ({ ...o, id: missing(o.id) })) } : undefined;
    const row = i => ({ ...i, id: mapping.get(i.id), ...(i.generation ? { generation: { ...i.generation, jobId: jobs.get(i.generation.jobId) || '', receipt: remapReceipt(i.generation.receipt) } } : {}), albumIds: i.albumIds.map(a => albums.get(a)).filter(Boolean) });
    target.images.unshift(...source.images.map(row)); target.trash.unshift(...source.trash.map(row));
    target.albums.push(...source.albums.map(a => ({ ...a, id: albums.get(a.id) })));
    target.referenceSets.push(...source.referenceSets.map(s => ({ ...s, id: sets.get(s.id), identityIds: s.identityIds.map(missing), temporaryIds: s.temporaryIds.map(missing), baseId: missing(s.baseId) })));
    target.jobs = [...source.jobs.map(j => ({ ...j, id: jobs.get(j.id), galleryId: target.id, settings: settings(j.settings), referenceIds: j.referenceIds.map(missing), resultIds: j.resultIds.map(missing), receipt: remapReceipt(j.receipt), status: ['done', 'failed', 'canceled', 'interrupted'].includes(j.status) ? j.status : 'interrupted', message: ['done', 'failed', 'canceled', 'interrupted'].includes(j.status) ? j.message : 'Imported history only. Not resubmitted.' })), ...target.jobs].slice(0, 60);
    if (applySettings) target.settings = settings(source.settings);
    if (!target.mainImageId && source.images.some(i => i.id === source.mainImageId)) target.mainImageId = missing(source.mainImageId);
    return target;
}
