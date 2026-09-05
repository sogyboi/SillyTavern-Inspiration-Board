import { referenceImages, settingsWithDefaults } from './server-plugin/character-gallery-api/core.mjs';
import { requestedReferenceIds, referenceSetSnapshot, applyReferenceSet } from './server-plugin/character-gallery-api/collections.mjs';

/** Touch-first collection UI; provider routing remains in the existing generator. */
export class LibraryUi {
    constructor(panel, helpers) {
        this.p = panel; Object.assign(this, helpers); this.bulk = new Set(); this.shelf = 'kept'; this.album = '';
        this.dialogs = new Set(); this.thumbJobs = new Set(); this.thumbTail = Promise.resolve();
        const p = panel, q = s => p.q(s);
        q('[data-page="gallery"] .cgs-filter-row').insertAdjacentHTML('beforebegin', `<nav class="cgs-shelves" aria-label="Image collections"><button data-shelf="kept">Library</button><button data-shelf="review">Review <b data-review-count>0</b></button><button data-shelf="archived">Archived</button><button data-shelf="trash">Recently deleted</button></nav><div class="cgs-album-row"><select data-albums aria-label="Filter by album"><option value="">All albums</option></select><button data-album-manage>Manage albums</button></div>`);
        q('[data-page="gallery"] .cgs-selection').innerHTML = `<span data-selected>0 selected</span><button data-bulk-visible>Select visible</button><button data-bulk-clear>Clear</button><button data-bulk-action="keep">Keep</button><button data-bulk-action="favorite">Favorite</button><button data-bulk-action="archive">Archive</button><button data-bulk-album>Add to album</button><button data-bulk-action="trash" class="cgs-danger">Move to trash</button><button data-bulk-action="restore" hidden>Restore</button><button data-bulk-action="purge" class="cgs-danger" hidden>Delete permanently</button>`;
        q('[data-page="gallery"] .cgs-help').textContent = 'Select boxes for bulk organizing. Ref adds a temporary reference; Identity stays pinned until you remove it. New generations wait in Review.';
        q('[data-page="gallery"]').querySelectorAll('[data-shelf]').forEach(b => b.onclick = () => { this.shelf = b.dataset.shelf; this.bulk.clear(); p.limit = 48; p.renderGallery(true); });
        q('[data-albums]').onchange = e => { this.album = e.target.value; p.limit = 48; p.renderGallery(true); };
        q('[data-album-manage]').onclick = () => this.albumManager();
        q('[data-bulk-visible]').onclick = () => { this.visibleImages().slice(0, p.limit).forEach(i => this.bulk.add(i.id)); p.renderGallery(true); };
        q('[data-bulk-clear]').onclick = () => { this.bulk.clear(); p.renderGallery(true); };
        q('[data-bulk-album]').onclick = () => this.assignAlbum();
        p.dialog.querySelectorAll('[data-bulk-action]').forEach(b => b.onclick = () => void this.action(b.dataset.bulkAction));

        const refs = q('.cgs-reference-box'); refs.id = 'cgs-reference-controls';
        refs.insertAdjacentHTML('afterbegin', `<div class="cgs-set-controls"><label>Saved reference set<select data-reference-sets><option value="">Custom references</option></select></label><div class="cgs-toolbar"><button data-set-save>Save new set</button><button data-set-update>Update set</button><button data-set-delete>Delete set</button><button data-clear-temp>Clear temporary</button></div><p class="cgs-help">Identity refs stay pinned. Temporary refs can change for this generation. Base is sent first. These roles do not guarantee model fidelity.</p><label>Reference guidance (optional)<textarea data-ref-guidance rows="2" maxlength="2000" placeholder="Image 1: character identity. Image 2: outfit only…"></textarea></label><small>Appended to your prompt only when images are sent. Saved with your reference set.</small></div>`);
        q('[data-ref-guidance]').oninput = e => { p.settings.referenceGuidance = e.target.value; p.settingsChanged(); };
        q('[data-set-save]').onclick = () => void this.saveSet(false); q('[data-set-update]').onclick = () => void this.saveSet(true);
        q('[data-set-delete]').onclick = async () => { const set = this.activeSet(); if (set && confirm(`Delete reference set “${set.name}”? Images are kept.`)) { await this.action('set-delete', [], { setId: set.id }); p.settings.activeReferenceSetId = ''; p.settingsChanged(); this.renderSets(); } };
        q('[data-clear-temp]').onclick = () => { p.settings.selectedIds = []; if (!p.settings.identityIds.includes(p.settings.referenceBaseId)) p.settings.referenceBaseId = ''; this.changedRefs(); };
        q('[data-reference-sets]').onchange = e => {
            const set = p.gallery.referenceSets.find(s => s.id === e.target.value);
            if (!set) { p.settings.activeReferenceSetId = ''; p.settingsChanged(); return; }
            try { p.settings = applyReferenceSet(p.settings, set, p.gallery); q('[data-ref-mode]').value = p.settings.referenceMode; this.changedRefs(); p.notice(`Loaded “${set.name}”. Identity and temporary references restored.`); }
            catch (error) { p.notice(error.message, true); this.renderSets(); }
        };

        const advanced = document.createElement('details'); advanced.className = 'cgs-advanced';
        advanced.innerHTML = '<summary>Advanced generation settings</summary>';
        q('[data-params]').before(advanced);
        for (const selector of ['[data-params]', '[data-negative-wrap]', '[data-safe-wrap]']) advanced.append(q(selector));
        const modelPicker = document.createElement('details'); modelPicker.className = 'cgs-model-picker'; modelPicker.open = true;
        modelPicker.innerHTML = '<summary data-model-summary>Choose a model</summary>';
        q('[data-model-search]').closest('.cgs-filter-row').before(modelPicker);
        modelPicker.append(q('[data-model-search]').closest('.cgs-filter-row'), q('[data-ref-only]').closest('.cgs-filter-row'), q('[data-models]'));
        const favorite = document.createElement('label'); favorite.className = 'cgs-check'; favorite.innerHTML = '<input type="checkbox" data-favorite-only> Favorite models only'; modelPicker.querySelector('.cgs-filter-row').after(favorite);
        q('[data-favorite-only]').onchange = () => p.renderModelList();
        this.send = q('.cgs-send-bar'); p.dialog.querySelector('.cgs-footer').before(this.send);
        this.send.insertAdjacentHTML('afterbegin', '<button type="button" data-ref-summary class="cgs-ref-summary" aria-controls="cgs-reference-controls">References</button>');
        q('[data-ref-summary]').onclick = () => refs.scrollIntoView({ block: 'start', behavior: 'smooth' });
        this.send.hidden = true;

        const storage = document.createElement('section'); storage.className = 'cgs-storage-tools';
        storage.innerHTML = `<h3>Backup &amp; character linking</h3><p class="cgs-help">Backups include originals, Review/Archive/Trash, albums, reference sets, prompts, settings and history. API keys are never included. Up to 512 MB of originals per bundle.</p><div class="cgs-toolbar"><button data-export>Export this gallery</button><button data-import>Import backup</button><button data-relink>Attach an existing gallery</button><button data-unlink>Use original gallery</button></div><input type="file" data-backup-file accept=".gz,.cgs,application/gzip" hidden><p class="cgs-help">Import adds copies with new IDs; it never replaces your existing images. Relinking changes only this character’s association, not the source files. Previously linked characters may still share that gallery.</p>`;
        q('[data-page="connections"]').append(storage);
        q('[data-export]').onclick = () => void this.export(); q('[data-import]').onclick = () => q('[data-backup-file]').click();
        q('[data-backup-file]').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) void this.import(file); };
        q('[data-relink]').onclick = () => void this.relink();
        q('[data-unlink]').onclick = async () => {
            if (!p.gallery || p.uploading || !confirm('Return this character to its original avatar-filename gallery? All other galleries and their images will be kept.')) return;
            try { await p.flushSettings(); await this.api('/gallery/unlink', { method: 'POST', body: { avatar: p.character.avatar, confirm: true } }); await this.adopt(); }
            catch (e) { p.notice(e.message, true); }
        };
        if (globalThis.IntersectionObserver) this.observer = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { this.observer.unobserve(e.target); this.loadThumbnail(e.target); } }, { root: q('.cgs-content'), rootMargin: '200px' });
    }
    get g() { return this.p.gallery; }
    allImages() { return [...(this.g?.images || []), ...(this.g?.trash || [])]; }
    onTab(tab) { this.send.hidden = tab !== 'generate'; }
    activeSet() { return this.g?.referenceSets?.find(s => s.id === this.p.settings.activeReferenceSetId); }
    changedRefs() { this.p.settingsChanged(); this.p.refsSignature = ''; this.p.renderRefs(); this.p.renderGallery(true); }
    visibleImages() {
        if (!this.g) return [];
        const term = this.p.q('[data-gallery-search]').value.trim().toLowerCase(), filter = this.p.q('[data-gallery-filter]').value;
        const refs = requestedReferenceIds(this.g, this.p.settings);
        return (this.shelf === 'trash' ? this.g.trash : this.g.images.filter(i => (i.state || 'kept') === this.shelf)).filter(i => (!this.album || i.albumIds.includes(this.album)) && (!term || `${i.name} ${i.notes} ${i.tags.join(' ')}`.toLowerCase().includes(term)) && (filter === 'all' || filter === i.source || filter === i.role || filter === 'favorite' && i.favorite || filter === 'references' && (refs.includes(i.id) || this.g.mainImageId === i.id)));
    }
    renderGallery(force = false) {
        const p = this.p; if (!this.g || p.closed) return;
        this.g.trash ||= []; this.g.albums ||= []; this.g.referenceSets ||= [];
        this.g.images.forEach(i => { i.state ||= 'kept'; i.albumIds ||= []; });
        const rows = this.visibleImages();
        const signature = JSON.stringify([rows.map(i => [i.id, i.name, i.favorite, i.role, i.albumIds, i.thumbnailFilename]), [...this.bulk], p.settings.identityIds, p.settings.selectedIds, this.g.mainImageId, this.g.albums, this.g.referenceSets, p.limit, this.shelf, this.album]);
        p.q('[data-count]').textContent = this.g.images.filter(i => i.state === 'kept').length;
        p.q('[data-review-count]').textContent = this.g.images.filter(i => i.state === 'review').length;
        this.renderSets();
        if (!force && signature === this.signature) return; this.signature = signature;
        this.bulk = new Set([...this.bulk].filter(id => this.allImages().some(i => i.id === id)));
        p.q('[data-selected]').textContent = `${this.bulk.size} selected for organizing`;
        p.dialog.querySelectorAll('[data-shelf]').forEach(b => { b.classList.toggle('active', b.dataset.shelf === this.shelf); b.setAttribute('aria-pressed', String(b.dataset.shelf === this.shelf)); });
        p.dialog.querySelectorAll('[data-bulk-action]').forEach(b => b.hidden = ['restore', 'purge'].includes(b.dataset.bulkAction) !== (this.shelf === 'trash'));
        p.q('[data-bulk-album]').hidden = this.shelf === 'trash';
        p.q('[data-albums]').innerHTML = `<option value="">All albums</option>${this.g.albums.map(a => `<option value="${a.id}">${this.esc(a.name)}</option>`).join('')}`;
        p.q('[data-albums]').value = this.album;
        this.observer?.disconnect();
        p.q('[data-grid]').innerHTML = rows.length ? rows.slice(0, p.limit).map(i => `<article class="cgs-card ${this.bulk.has(i.id) ? 'selected' : ''}"><label class="cgs-select-card"><input type="checkbox" data-bulk="${i.id}" ${this.bulk.has(i.id) ? 'checked' : ''} aria-label="Select ${this.esc(i.name)}"><span>Select</span></label><button type="button" class="cgs-image-open" data-view="${i.id}" aria-label="View ${this.esc(i.name)}"><img data-thumb="${i.id}" loading="lazy" decoding="async" alt="${this.esc(i.name)}">${this.g.mainImageId === i.id ? '<span class="cgs-main-badge">MAIN</span>' : ''}</button><div class="cgs-card-name">${this.esc(i.name)}</div><div class="cgs-card-actions">${this.shelf === 'trash' ? `<button data-single="restore" data-id="${i.id}">Restore</button>` : `<button data-ref="${i.id}" aria-pressed="${p.settings.selectedIds.includes(i.id)}">${p.settings.selectedIds.includes(i.id) ? '✓ Ref' : '＋ Ref'}</button><button data-identity="${i.id}" aria-pressed="${p.settings.identityIds.includes(i.id)}">${p.settings.identityIds.includes(i.id) ? '✓ Identity' : 'Identity'}</button><button data-single="favorite" data-id="${i.id}" aria-label="Favorite ${this.esc(i.name)}" aria-pressed="${i.favorite}">${i.favorite ? '★' : '☆'}</button>`}</div>${this.shelf === 'review' ? `<div class="cgs-card-actions"><button data-single="keep" data-id="${i.id}">Keep</button><button data-single="archive" data-id="${i.id}">Archive</button></div>` : ''}</article>`).join('') : `<div class="cgs-empty"><h3>${{ kept: 'Your character’s library', review: 'All caught up', archived: 'No archived images', trash: 'Nothing recently deleted' }[this.shelf]}</h3><p>${this.shelf === 'review' ? 'New generations appear here and below Generate. Keep your favorites or archive the rest.' : this.shelf === 'trash' ? 'Deleted images can be restored here. Nothing is permanently removed unless you explicitly confirm it.' : 'Upload images, generate new ones, or change your filters.'}</p></div>`;
        p.q('[data-more]').hidden = rows.length <= p.limit;
        p.q('[data-grid]').querySelectorAll('[data-bulk]').forEach(el => el.onchange = () => { el.checked ? this.bulk.add(el.dataset.bulk) : this.bulk.delete(el.dataset.bulk); p.q('[data-selected]').textContent = `${this.bulk.size} selected for organizing`; el.closest('.cgs-card').classList.toggle('selected', el.checked); });
        p.q('[data-grid]').querySelectorAll('[data-view]').forEach(b => b.onclick = () => p.openViewer(b.dataset.view, rows.map(i => i.id)));
        p.q('[data-grid]').querySelectorAll('[data-ref]').forEach(b => b.onclick = () => p.toggleRef(b.dataset.ref));
        p.q('[data-grid]').querySelectorAll('[data-identity]').forEach(b => b.onclick = () => this.toggleIdentity(b.dataset.identity));
        p.q('[data-grid]').querySelectorAll('[data-single]').forEach(b => b.onclick = () => void this.action(b.dataset.single, [b.dataset.id], b.dataset.single === 'favorite' ? { value: !rows.find(i => i.id === b.dataset.id).favorite } : {}));
        p.q('[data-grid]').querySelectorAll('[data-thumb]').forEach(img => this.observer ? this.observer.observe(img) : this.loadThumbnail(img));
    }
    toggleIdentity(id) {
        const s = this.p.settings; s.identityIds = s.identityIds.includes(id) ? s.identityIds.filter(x => x !== id) : [...s.identityIds, id];
        if (s.identityIds.includes(id)) s.selectedIds = s.selectedIds.filter(x => x !== id);
        this.changedRefs();
    }
    async action(action, ids = [...this.bulk], extra = {}) {
        const p = this.p; if (!this.g || this.working) return;
        if (['trash', 'purge'].includes(action) && !ids.length) { p.notice('Select images using the selection boxes first.'); return; }
        if (action === 'trash' && !confirm(`Move ${ids.length} image(s) to Recently deleted? They can be restored.`)) return;
        if (action === 'purge' && !confirm(`Permanently delete ${ids.length} image(s)? This cannot be undone. Back up anything you want to keep first.`)) return;
        this.working = true;
        try {
            await p.flushSettings();
            const result = await this.api(`/gallery/${this.g.id}/organize`, { method: 'POST', body: { action, ids, ...extra, ...(action === 'purge' ? { confirm: 'DELETE' } : {}) } });
            if (action === 'trash') { p.settings.selectedIds = p.settings.selectedIds.filter(i => !ids.includes(i)); p.settings.identityIds = p.settings.identityIds.filter(i => !ids.includes(i)); if (ids.includes(p.settings.referenceBaseId)) p.settings.referenceBaseId = ''; }
            this.bulk.clear(); await p.refresh(true); p.notice(action === 'trash' ? 'Moved to Recently deleted. Restore from that tab any time.' : 'Gallery updated.');
            return result;
        } catch (e) { p.notice(e.message, true); return null; }
        finally { this.working = false; }
    }
    modal(title, markup) {
        const d = document.createElement('dialog'); d.className = 'cgs-picker cgs-manager';
        d.innerHTML = `<header><h2>${this.esc(title)}</h2><button data-dismiss aria-label="Close">✕</button></header>${markup}`;
        const close = () => { d.close(); d.remove(); this.dialogs.delete(d); };
        d.querySelector('[data-dismiss]').onclick = close; d.oncancel = e => { e.preventDefault(); close(); };
        document.body.append(d); this.dialogs.add(d); d.showModal(); return { d, close };
    }
    albumManager() {
        if (!this.g) return;
        const { d, close } = this.modal('Albums', `<p>Albums are labels, not copies. Deleting an album keeps its images.</p><input data-new-album placeholder="New album name" maxlength="80"><button data-create-album>Create album</button>${this.g.albums.map(a => `<div class="cgs-album-item"><span>${this.esc(a.name)}</span><button data-rename="${a.id}">Rename</button><button data-remove="${a.id}">Delete album</button></div>`).join('')}`);
        d.querySelector('[data-create-album]').onclick = async () => { const name = d.querySelector('[data-new-album]').value; if (name.trim() && await this.action('album-create', [], { name })) { close(); this.albumManager(); } };
        d.querySelectorAll('[data-rename]').forEach(b => b.onclick = async () => { const a = this.g.albums.find(a => a.id === b.dataset.rename), name = prompt('Album name', a.name); if (name?.trim() && await this.action('album-rename', [], { albumId: a.id, name })) { close(); this.albumManager(); } });
        d.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => { if (!confirm('Remove this album label? Its images will be kept.')) return; if (await this.action('album-delete', [], { albumId: b.dataset.remove })) { if (this.album === b.dataset.remove) this.album = ''; close(); this.albumManager(); this.p.renderGallery(true); } });
    }
    assignAlbum() {
        if (!this.bulk.size) { this.p.notice('Select images using the selection boxes first.'); return; }
        if (!this.g.albums.length) { this.albumManager(); return; }
        const { d, close } = this.modal('Organize selected images', `<label>Album<select data-destination>${this.g.albums.map(a => `<option value="${a.id}">${this.esc(a.name)}</option>`).join('')}</select></label><button data-add>Add to album</button><button data-remove>Remove from album</button><p>Other album memberships are kept.</p>`);
        for (const [selector, action] of [['[data-add]', 'album-add'], ['[data-remove]', 'album-remove']]) d.querySelector(selector).onclick = async () => { if (await this.action(action, [...this.bulk], { albumId: d.querySelector('[data-destination]').value })) close(); };
    }
    renderSets() {
        if (!this.g) return;
        const select = this.p.q('[data-reference-sets]'), signature = JSON.stringify([this.g.referenceSets, this.g.images.map(i => i.id), this.p.settings.activeReferenceSetId]);
        if (signature === this.setSignature) return; this.setSignature = signature;
        select.innerHTML = '<option value="">Custom references</option>' + this.g.referenceSets.map(s => `<option value="${s.id}">${this.esc(s.name)} · ${new Set([...s.identityIds, ...s.temporaryIds]).size} refs${[...s.identityIds, ...s.temporaryIds].some(id => !this.g.images.some(i => i.id === id)) ? ' · incomplete' : ''}</option>`).join('');
        select.value = this.p.settings.activeReferenceSetId;
        this.p.q('[data-set-update]').disabled = !this.activeSet(); this.p.q('[data-set-delete]').disabled = !this.activeSet();
    }
    async saveSet(update) {
        if (!this.g) return; const previous = update ? this.activeSet() : null;
        if (update && !previous) return;
        const name = prompt(update ? 'Update this reference set (name can be changed)' : 'Name this reference set', previous?.name || 'Default appearance'); if (!name?.trim()) return;
        const set = referenceSetSnapshot(this.p.settings, name, this.g); if (previous) set.id = previous.id;
        const result = await this.action('set-save', [], { set });
        if (result?.set) { this.p.settings.activeReferenceSetId = result.set.id; this.p.settingsChanged(); this.renderSets(); }
    }
    decorateRefs() {
        if (!this.g || this.p.closed) return;
        const p = this.p, refs = referenceImages(this.g, p.settings), identity = p.settings.identityIds;
        this.renderSets();
        if (p.q('[data-ref-guidance]').value !== p.settings.referenceGuidance) p.q('[data-ref-guidance]').value = p.settings.referenceGuidance;
        p.q('[data-ref-summary]').textContent = `${refs.length} ref${refs.length === 1 ? '' : 's'} · ${p.model()?.name || 'Choose model'}`;
        const wanted = requestedReferenceIds(this.g, p.settings), missing = wanted.filter(id => !refs.some(i => i.id === id));
        if (missing.length) { p.q('[data-ref-plan]').textContent = `${missing.length} reference(s) are missing. Restore them or load another set. Generation is blocked.`; p.q('[data-ref-plan]').classList.add('cgs-warning'); }
        p.q('[data-refs]').innerHTML = refs.map((r, i) => `<div class="cgs-ref-tile"><button data-ref-preview="${r.id}" aria-label="View reference ${i + 1}"><img src="${this.imageUrl(this.g, r.id)}" alt="${this.esc(r.name)}"><span>${i + 1}${i === 0 ? ' · Base' : ''} · ${identity.includes(r.id) ? 'Identity' : 'Temporary'}</span></button><div><button data-ref-pin="${r.id}" title="Pin or unpin identity">${identity.includes(r.id) ? 'Unpin' : 'Pin'}</button><button data-base="${r.id}" title="Send first">Base</button><button data-ref-left="${r.id}" aria-label="Move reference earlier">←</button><button data-ref-remove="${r.id}" aria-label="Remove reference">×</button></div></div>`).join('');
        p.q('[data-refs]').querySelectorAll('[data-ref-preview]').forEach(b => b.onclick = () => p.openViewer(b.dataset.refPreview, refs.map(i => i.id)));
        p.q('[data-refs]').querySelectorAll('[data-ref-pin]').forEach(b => b.onclick = () => {
            const id = b.dataset.refPin; if (identity.includes(id)) { p.settings.identityIds = identity.filter(x => x !== id); p.settings.selectedIds = [...new Set([...p.settings.selectedIds, id])]; } else { p.settings.identityIds = [...identity, id]; p.settings.selectedIds = p.settings.selectedIds.filter(x => x !== id); }
            this.changedRefs();
        });
        p.q('[data-refs]').querySelectorAll('[data-base]').forEach(b => b.onclick = () => { p.settings.referenceBaseId = b.dataset.base; this.changedRefs(); });
        p.q('[data-refs]').querySelectorAll('[data-ref-left]').forEach(b => b.onclick = () => { const id = b.dataset.refLeft, key = identity.includes(id) ? 'identityIds' : 'selectedIds', list = [...p.settings[key]], at = list.indexOf(id); if (at > 0) [list[at - 1], list[at]] = [list[at], list[at - 1]]; p.settings[key] = list; this.changedRefs(); });
        p.q('[data-refs]').querySelectorAll('[data-ref-remove]').forEach(b => b.onclick = () => { const id = b.dataset.refRemove; p.settings.identityIds = p.settings.identityIds.filter(x => x !== id); p.settings.selectedIds = p.settings.selectedIds.filter(x => x !== id); if (p.settings.referenceBaseId === id) p.settings.referenceBaseId = ''; if (p.settings.referenceMode === 'main' || !p.settings.identityIds.length && !p.settings.selectedIds.length) p.settings.referenceMode = 'selected'; p.q('[data-ref-mode]').value = p.settings.referenceMode; this.changedRefs(); });
    }
    sortModels(rows) { const stars = this.p.settings.favoriteModels[this.p.settings.provider]; return rows.filter(m => !this.p.q('[data-favorite-only]')?.checked || stars.includes(m.id)).sort((a, b) => Number(stars.includes(b.id)) - Number(stars.includes(a.id))); }
    decorateModels() {
        const p = this.p, stars = p.settings.favoriteModels[p.settings.provider];
        p.q('[data-model-summary]').textContent = p.model()?.name || 'Choose a model';
        p.q('[data-models]').querySelectorAll('[data-model]').forEach(button => {
            const row = document.createElement('div'); row.className = 'cgs-model-row'; button.before(row); row.append(button);
            const star = document.createElement('button'); star.type = 'button'; star.className = 'cgs-model-star'; star.textContent = stars.includes(button.dataset.model) ? '★' : '☆'; star.setAttribute('aria-label', `Favorite ${button.dataset.model}`); star.setAttribute('aria-pressed', String(stars.includes(button.dataset.model)));
            star.onclick = () => { const id = button.dataset.model; p.settings.favoriteModels[p.settings.provider] = stars.includes(id) ? stars.filter(x => x !== id) : [...stars, id]; p.settingsChanged(); p.renderModelList(); }; row.append(star);
        });
    }
    decorateResults(rows) {
        this.p.q('[data-results]').querySelectorAll('article').forEach((article, index) => {
            const image = rows[index]; if (!image) return;
            const actions = document.createElement('div'); actions.className = 'cgs-toolbar cgs-result-review';
            actions.innerHTML = `<span>${image.state === 'review' ? 'Awaiting review' : 'Kept in library'}</span><button data-keep>Keep</button><button data-archive>Archive</button><button data-trash>Trash</button>`;
            for (const [selector, action] of [['[data-keep]', 'keep'], ['[data-archive]', 'archive'], ['[data-trash]', 'trash']]) actions.querySelector(selector).onclick = () => void this.action(action, [image.id]);
            article.append(actions);
        });
    }
    loadThumbnail(img) {
        const gallery = this.g, row = this.allImages().find(i => i.id === img.dataset.thumb); if (!row || !gallery || this.p.closed) return;
        const original = this.imageUrl(gallery, row.id);
        if (row.thumbnailFilename) { img.onerror = () => { img.onerror = null; img.src = original; }; img.src = `${original}/thumbnail`; return; }
        img.src = original;
        const key = `${gallery.id}:${row.id}`; if (this.thumbJobs.has(key)) return; this.thumbJobs.add(key);
        this.thumbTail = this.thumbTail.catch(() => {}).then(async () => {
            if (this.p.closed) return;
            const response = await fetch(original, { credentials: 'same-origin' }); if (!response.ok) return;
            const blob = await response.blob(); if (blob.type === 'image/svg+xml') return;
            const bitmap = await createImageBitmap(blob);
            const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
            const thumb = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .75)); if (!thumb || thumb.size > 256 * 1024) return;
            await this.api(`/gallery/${gallery.id}/image/${row.id}/thumbnail`, { method: 'POST', body: { dataUrl: await this.fileData(thumb) } });
            if (img.isConnected) img.src = `${original}/thumbnail`;
        }).catch(() => {}); // Originals stay usable if a browser cannot build a preview.
    }
    async export() {
        const p = this.p; if (!this.g) return;
        try { await p.flushSettings(); this.clickDownload(`/api/plugins/character-gallery-api/gallery/${this.g.id}/export`, `${p.character.name}.cgs.jsonl.gz`); p.notice('Backup download started. Keep this page open until your browser finishes downloading.'); }
        catch (e) { p.notice(e.message, true); }
    }
    async import(file) {
        const p = this.p; if (!this.g || this.importBusy) return;
        this.importBusy = true; const galleryId = this.g.id;
        try {
            p.notice('Uploading and validating backup. No gallery files have been changed…');
            const headers = { ...(globalThis.SillyTavern?.getContext?.()?.getRequestHeaders?.() || {}), 'Content-Type': 'application/x-character-gallery-backup' };
            const response = await fetch('/api/plugins/character-gallery-api/imports/preview', { method: 'POST', headers, credentials: 'same-origin', body: file });
            const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Backup validation failed.');
            if (p.closed || p.gallery.id !== galleryId) { await this.api(`/imports/${result.token}`, { method: 'DELETE', body: {} }); return; }
            const s = result.summary, { d, close } = this.modal('Import backup', `<p><b>${this.esc(s.name)}</b></p><p>${s.images} live images · ${s.trash} in Recently deleted<br>${s.albums} albums · ${s.referenceSets} reference sets</p><p>These are added to <b>${this.esc(p.character.name)}</b>. Existing images are kept, even if some are duplicates.</p><label class="cgs-check"><input type="checkbox" data-apply-settings> Also restore generation settings and prompt</label><p data-import-error role="status"></p><button data-import-confirm>Import into this gallery</button><button data-import-cancel>Cancel</button>`);
            let committing = false;
            const discard = () => { if (committing) return; void this.api(`/imports/${result.token}`, { method: 'DELETE', body: {} }).catch(() => {}); close(); };
            d.querySelector('[data-dismiss]').onclick = discard; d.querySelector('[data-import-cancel]').onclick = discard; d.oncancel = e => { e.preventDefault(); discard(); };
            d.querySelector('[data-import-confirm]').onclick = async () => {
                if (committing) return; committing = true; d.querySelector('[data-import-confirm]').disabled = true;
                try {
                    await p.flushSettings(); await this.api(`/gallery/${galleryId}/import`, { method: 'POST', body: { token: result.token, applySettings: d.querySelector('[data-apply-settings]').checked } });
                    close(); await this.adopt(); p.notice('Backup imported. Existing images and API keys were not replaced.');
                } catch (e) { d.querySelector('[data-import-error]').textContent = e.message; }
                finally { committing = false; d.querySelector('[data-import-confirm]').disabled = false; }
            };
        } catch (e) { p.notice(e.message, true); } finally { this.importBusy = false; }
    }
    async adopt() {
        const p = this.p; const gallery = await this.api('/gallery/open', { method: 'POST', body: p.character });
        if (p.closed) return; p.catalogEpoch++; p.models = []; p.loadedProvider = ''; p.gallery = gallery; p.settings = settingsWithDefaults(gallery.settings); this.bulk.clear(); this.album = ''; this.shelf = 'kept';
        for (const [selector, value] of [['[data-prompt]', p.settings.prompt], ['[data-negative]', p.settings.negativePrompt], ['[data-ref-mode]', p.settings.referenceMode]]) p.q(selector).value = value;
        p.q('[data-safe]').checked = p.settings.safeMode; p.resultsSignature = p.refsSignature = p.jobsSignature = ''; p.renderGallery(true); p.renderRefs(); p.renderResults(); p.renderJobs(); p.updateProviderButtons(); if (p.tab === 'generate') await p.loadModels();
    }
    async relink() {
        const p = this.p; if (!this.g || p.uploading || this.importBusy) return;
        try {
            await p.flushSettings(); const { galleries } = await this.api('/galleries'); const rows = galleries.filter(g => g.id !== this.g.id);
            if (!rows.length) { p.notice('No other galleries exist for this SillyTavern user yet.'); return; }
            const { d, close } = this.modal('Attach existing gallery', `<p>Choose the gallery to open for <b>${this.esc(p.character.name)}</b>. No images are moved, overwritten or deleted.</p><select data-link-source>${rows.map(g => `<option value="${g.id}">${this.esc(g.name)} · ${this.esc(g.avatar)}</option>`).join('')}</select><p data-link-preview></p><p>This character will use the chosen gallery. Its present gallery is kept and can be reattached later. Another character may already use the chosen gallery.</p><button data-link-confirm>Confirm association</button><p data-link-error role="alert"></p>`);
            const preview = () => { const g = rows.find(g => g.id === d.querySelector('[data-link-source]').value); d.querySelector('[data-link-preview]').textContent = `${g.images} live images · ${g.trash} deleted · ${g.albums} albums · ${g.referenceSets} reference sets`; };
            d.querySelector('[data-link-source]').onchange = preview; preview();
            d.querySelector('[data-link-confirm]').onclick = async e => { e.target.disabled = true; try { await p.flushSettings(); await this.api('/gallery/relink', { method: 'POST', body: { avatar: p.character.avatar, sourceId: d.querySelector('[data-link-source]').value, confirm: true } }); close(); await this.adopt(); p.notice('Gallery association updated. All original galleries are retained.'); } catch (error) { d.querySelector('[data-link-error]').textContent = error.message; e.target.disabled = false; } };
        } catch (e) { p.notice(e.message, true); }
    }
    dispose() { this.observer?.disconnect(); for (const dialog of this.dialogs) { dialog.close(); dialog.remove(); } this.dialogs.clear(); }
}
