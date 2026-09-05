/** Pure collection helpers shared by the browser and server. No provider calls. */
export const LIBRARY_SCHEMA = 2;
export const text = (v, n = 200) => String(v ?? '').slice(0, n);
export const uniqueIds = (value, max = 10000) => Array.isArray(value) ? [...new Set(value.filter(v => typeof v === 'string' && /^[\w-]{1,100}$/.test(v)))].slice(0, max) : [];
const fail = message => Object.assign(new Error(message), { status: 400 });
const states = ['kept', 'review', 'archived'];
export function migrateGallery(g) {
    g.images ||= []; g.jobs ||= []; g.trash ||= []; g.albums ||= []; g.referenceSets ||= [];
    for (const image of [...g.images, ...g.trash]) {
        // Existing results remain in the library, not retroactively moved to Review.
        image.state = states.includes(image.state) ? image.state : 'kept';
        image.albumIds = uniqueIds(image.albumIds, 200);
    }
    g.schema = LIBRARY_SCHEMA;
    return g;
}
export function requestedReferenceIds(g, s) {
    if (s.referenceMode === 'none') return [];
    if (s.referenceMode === 'main') return g.mainImageId ? [g.mainImageId] : [];
    const identity = uniqueIds(s.identityIds, 50), temporary = uniqueIds(s.selectedIds, 50);
    let ids = [...new Set([...identity, ...temporary])];
    if (!ids.length && s.referenceMode === 'auto' && g.mainImageId) ids = [g.mainImageId];
    if (s.referenceBaseId && ids.includes(s.referenceBaseId)) ids = [s.referenceBaseId, ...ids.filter(id => id !== s.referenceBaseId)];
    return ids;
}
export function referenceSetSnapshot(s, name, gallery) {
    const identityIds = uniqueIds(s.identityIds, 50);
    const temporaryIds = uniqueIds(s.selectedIds, 50).filter(id => !identityIds.includes(id));
    if (!identityIds.length && !temporaryIds.length && s.referenceMode === 'auto' && gallery.mainImageId) identityIds.push(gallery.mainImageId);
    const ids = [...identityIds, ...temporaryIds];
    return { name: text(name, 80).trim(), guidance: text(s.referenceGuidance, 2000), identityIds, temporaryIds, baseId: ids.includes(s.referenceBaseId) ? s.referenceBaseId : ids[0] || '' };
}
export function applyReferenceSet(settings, set, gallery) {
    const ids = [...set.identityIds, ...set.temporaryIds];
    if (!ids.length || ids.some(id => !gallery.images.some(i => i.id === id))) throw fail('This set has missing or deleted images. Restore them or update the set first.');
    return { ...settings, referenceGuidance: text(set.guidance, 2000), identityIds: [...set.identityIds], selectedIds: [...set.temporaryIds], referenceBaseId: set.baseId, activeReferenceSetId: set.id, referenceMode: 'selected' };
}
export function collectionAction(g, body, makeId, now = Date.now()) {
    migrateGallery(g);
    const action = body.action, ids = uniqueIds(body.ids), picked = new Set(ids);
    const needImages = (source = g.images) => {
        if (!ids.length || ids.some(id => !source.some(i => i.id === id))) throw fail('Select existing images from this gallery.');
        return source.filter(i => picked.has(i.id));
    };
    if (['keep', 'review', 'archive', 'favorite', 'album-add', 'album-remove'].includes(action)) {
        const images = needImages();
        if (action.startsWith('album-') && !g.albums.some(a => a.id === body.albumId)) throw fail('Album not found.');
        for (const image of images) {
            if (action === 'favorite') image.favorite = body.value !== false;
            else if (action === 'album-add') image.albumIds = uniqueIds([...image.albumIds, body.albumId], 200);
            else if (action === 'album-remove') image.albumIds = image.albumIds.filter(id => id !== body.albumId);
            else image.state = { keep: 'kept', review: 'review', archive: 'archived' }[action];
        }
        return { changed: images.length };
    }
    if (action === 'trash') {
        const images = needImages();
        for (const image of images) {
            image.deletedAt = now; image.wasMain = g.mainImageId === image.id;
        }
        g.trash.unshift(...images); g.images = g.images.filter(i => !picked.has(i.id));
        g.settings.selectedIds = (g.settings.selectedIds || []).filter(id => !picked.has(id));
        g.settings.identityIds = (g.settings.identityIds || []).filter(id => !picked.has(id));
        if (picked.has(g.mainImageId)) g.mainImageId = null;
        if (picked.has(g.settings.referenceBaseId)) g.settings.referenceBaseId = '';
        // Saved sets keep their IDs: they become incomplete until images are restored.
        return { changed: images.length };
    }
    if (action === 'restore') {
        const images = needImages(g.trash);
        for (const image of images) {
            if (image.wasMain && !g.mainImageId) g.mainImageId = image.id;
            delete image.deletedAt; delete image.wasMain;
        }
        g.images.unshift(...images); g.trash = g.trash.filter(i => !picked.has(i.id));
        return { changed: images.length };
    }
    if (action === 'purge') {
        if (body.confirm !== 'DELETE') throw fail('Permanent deletion needs confirmation.');
        const images = needImages(g.trash);
        g.trash = g.trash.filter(i => !picked.has(i.id));
        return { changed: images.length, purgeFiles: images.flatMap(i => [i.filename, i.thumbnailFilename].filter(Boolean)) };
    }
    if (['album-create', 'album-rename', 'album-delete'].includes(action)) {
        const name = text(body.name, 80).trim();
        if (action !== 'album-delete' && !name) throw fail('Give the album a name.');
        if (action === 'album-create') {
            if (g.albums.length >= 200) throw fail('This gallery already has 200 albums.');
            const album = { id: makeId(), name, createdAt: now }; g.albums.push(album); return { album };
        }
        const album = g.albums.find(a => a.id === body.albumId); if (!album) throw fail('Album not found.');
        if (action === 'album-rename') album.name = name;
        else { g.albums = g.albums.filter(a => a.id !== album.id); for (const i of [...g.images, ...g.trash]) i.albumIds = i.albumIds.filter(id => id !== album.id); }
        return { changed: 1 };
    }
    if (action === 'set-save') {
        const src = body.set || {}, name = text(src.name, 80).trim();
        const identityIds = uniqueIds(src.identityIds, 50), temporaryIds = uniqueIds(src.temporaryIds, 50).filter(id => !identityIds.includes(id));
        const refs = [...identityIds, ...temporaryIds];
        if (!name || !refs.length || refs.length > 50) throw fail('Name the reference set and choose 1–50 images.');
        if (refs.some(id => !g.images.some(i => i.id === id))) throw fail('A reference image is missing or in Recently deleted.');
        if (src.baseId && !refs.includes(src.baseId)) throw fail('The base image must belong to the set.');
        let set = src.id ? g.referenceSets.find(s => s.id === src.id) : null;
        if (src.id && !set) throw fail('Reference set not found.');
        if (!set) { if (g.referenceSets.length >= 200) throw fail('Maximum reference sets reached.'); set = { id: makeId(), createdAt: now }; g.referenceSets.push(set); }
        Object.assign(set, { name, guidance: text(src.guidance, 2000), identityIds, temporaryIds, baseId: src.baseId || refs[0], updatedAt: now });
        return { set };
    }
    if (action === 'set-delete') {
        g.referenceSets = g.referenceSets.filter(s => s.id !== body.setId);
        if (g.settings.activeReferenceSetId === body.setId) g.settings.activeReferenceSetId = '';
        return { changed: 1 };
    }
    throw fail('Unknown library action.');
}
