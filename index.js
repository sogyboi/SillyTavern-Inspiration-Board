import { LibraryUi } from './library-ui.js';
import { VERSION, ROLES, copy, settingsWithDefaults, characterFromContext, groupCharacters, referenceImages, validateRequest } from './server-plugin/character-gallery-api/core.mjs';
import { filteredModels, priceLabel } from './server-plugin/character-gallery-api/models.mjs';

const API = '/api/plugins/character-gallery-api';
const ACTIVE = new Set(['queued', 'preparing', 'sending', 'saving']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const context = () => globalThis.SillyTavern?.getContext?.();
const toast = (text, kind = 'info') => globalThis.toastr?.[kind]?.(text, 'Character Gallery');
let openPanel = null;

async function api(path, { method = 'GET', body, signal } = {}) {
    const headers = { ...(context()?.getRequestHeaders?.() || {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/x-character-gallery';
    const response = await fetch(`${API}${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store', signal, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
        let message;
        try { message = (await response.json()).error; } catch {}
        throw new Error(message || (response.status === 404 ? 'Character Gallery API is not installed. Copy the bundled server plugin and restart SillyTavern.' : `Gallery request failed (HTTP ${response.status}).`));
    }
    return response.json();
}
const imageUrl = (gallery, id) => `${API}/gallery/${gallery.id}/image/${id}`;
const formatBytes = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
function fileData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(`Could not read ${file.name}`)); reader.readAsDataURL(file); }); }
function dimensions(url) { return new Promise(resolve => { const img = new Image(); img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = () => resolve({ width: 0, height: 0 }); img.src = url; }); }
function clickDownload(href, filename) { const a = document.createElement('a'); a.href = href; a.download = filename; document.body.append(a); a.click(); a.remove(); }
async function downloadImage(gallery, image) {
    const response = await fetch(imageUrl(gallery, image.id), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not download this image.');
    const url = URL.createObjectURL(await response.blob());
    clickDownload(url, `${image.name.replace(/[^\w .-]/g, '_') || 'image'}.${image.filename.split('.').pop()}`);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function bind(dialog, selector, callback) { dialog.querySelector(selector)?.addEventListener('click', callback); }
function options(values, selected = '') { return `<option value="">Provider default</option>${values.map(x => `<option value="${esc(x)}" ${x === selected ? 'selected' : ''}>${esc(x)}</option>`).join('')}`; }

function chooseGroupCharacter(chars) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'cgs-picker';
        dialog.innerHTML = `<h2>Whose gallery?</h2><p>Choose a character from this group.</p>${chars.map((c, i) => `<button type="button" data-pick="${i}">${esc(c.name)}</button>`).join('')}<button type="button" data-dismiss>Cancel</button>`;
        document.body.append(dialog);
        const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
        dialog.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => finish(chars[Number(b.dataset.pick)]));
        bind(dialog, '[data-dismiss]', () => finish(null)); dialog.oncancel = e => { e.preventDefault(); finish(null); }; dialog.showModal();
    });
}
async function openCurrentGallery() {
    let character = characterFromContext(context());
    if (!character && context()?.groupId) character = await chooseGroupCharacter(groupCharacters(context()));
    if (!character) { toast('Open a character chat first.'); return; }
    if (openPanel?.character.avatar === character.avatar) { openPanel.dialog.focus(); return; }
    await openPanel?.close();
    openPanel = new GalleryPanel(character);
    await openPanel.open();
}

class GalleryPanel {
    constructor(character) {
        this.character = character; this.gallery = null; this.settings = settingsWithDefaults(); this.models = [];
        this.tab = 'gallery'; this.closed = false; this.busy = false; this.uploading = false; this.limit = 48;
        this.saveTail = Promise.resolve(); this.catalogEpoch = 0; this.gallerySignature = ''; this.status = {};
        this.filters = { search: '', sort: 'name', safety: 'all', referenceOnly: false };
    }
    q(selector) { return this.dialog.querySelector(selector); }
    async open() {
        const dialog = this.dialog = document.createElement('dialog'); dialog.className = 'cgs-shell';
        dialog.setAttribute('aria-label', `${this.character.name} · Character Gallery Studio`);
        dialog.innerHTML = `
        <header class="cgs-header"><div><span class="cgs-eyebrow">CHARACTER GALLERY STUDIO <small>v${VERSION}</small></span><h2>${esc(this.character.name)}</h2></div><button type="button" class="cgs-icon" data-close aria-label="Close gallery">✕</button></header>
        <nav class="cgs-tabs" aria-label="Gallery sections"><button type="button" data-tab="gallery" class="active">Gallery <span data-count>0</span></button><button type="button" data-tab="generate">Generate <span data-running></span></button><button type="button" data-tab="connections">Connections</button></nav>
        <div class="cgs-notice" data-notice role="status" aria-live="polite">Opening this character’s gallery…</div>
        <main class="cgs-content">
        <section data-page="gallery">
          <div class="cgs-toolbar"><button type="button" class="cgs-primary" data-upload>＋ Upload images</button><button type="button" data-avatar>Import character avatar</button><button type="button" data-refresh>Refresh</button><input type="file" data-files accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml" multiple hidden></div>
          <p class="cgs-help">Originals stay in this character’s private gallery. Tap an image to view it. Use Ref to select it for generation.</p>
          <div class="cgs-filter-row"><input data-gallery-search type="search" placeholder="Search names, tags or notes…" aria-label="Search gallery"><select data-gallery-filter aria-label="Gallery filter"><option value="all">All images</option><option value="generated">Generated</option><option value="upload">Uploaded</option><option value="favorite">Favorites</option><option value="references">Selected / main refs</option>${ROLES.map(r => `<option value="${r}">${r[0].toUpperCase() + r.slice(1)} references</option>`).join('')}</select></div>
          <div class="cgs-selection"><span data-selected>0 selected</span><button type="button" data-use-selected>Generate with selected</button><button type="button" data-clear-selected>Clear</button><button type="button" data-delete-selected class="cgs-danger">Delete selected</button></div>
          <div class="cgs-grid" data-grid></div><button type="button" data-more hidden>Show more images</button>
        </section>
        <section data-page="generate" hidden>
          <div class="cgs-provider-tabs"><button type="button" data-provider="openrouter">OpenRouter</button><button type="button" data-provider="venice">Venice</button></div>
          <div class="cgs-filter-row"><input data-model-search type="search" placeholder="Search image models…" aria-label="Search models"><select data-model-sort aria-label="Sort models"><option value="name">Name</option><option value="price">Price / image · low first</option><option value="newest">Newest</option></select></div>
          <div class="cgs-filter-row"><label class="cgs-check"><input type="checkbox" data-ref-only> Reference-capable only</label><select data-safety-filter aria-label="Model policy filter"><option value="all">All model policies</option><option value="uncensored">Advertised uncensored / NSFW</option><option value="unmoderated">Unmoderated (OpenRouter)</option></select></div>
          <div class="cgs-models" data-models role="listbox" aria-label="Image models"><p>Select Generate to load the live catalog.</p></div>
          <div class="cgs-model-info" data-model-info></div>
          <div class="cgs-gen-options" data-params></div>
          <div class="cgs-reference-box"><div class="cgs-field"><label for="cgs-ref-mode">Reference images</label><select id="cgs-ref-mode" data-ref-mode><option value="auto">Auto: selected, otherwise main</option><option value="selected">Selected images only</option><option value="main">Main reference only</option><option value="none">None · prompt only</option></select></div><div data-ref-plan class="cgs-help"></div><div data-refs class="cgs-refs"></div><button type="button" data-pick-refs>Choose from gallery</button></div>
          <div class="cgs-field"><label for="cgs-prompt">What should the image show?</label><textarea id="cgs-prompt" data-prompt rows="5" maxlength="32000" placeholder="Describe the image or the changes to your references…"></textarea></div>
          <div class="cgs-presets"><button type="button" data-preset="portrait">Portrait</button><button type="button" data-preset="full">Full body</button><button type="button" data-preset="outfit">New outfit</button><button type="button" data-character-notes>Copy character description</button></div>
          <div class="cgs-field" data-negative-wrap hidden><label for="cgs-negative">Negative prompt</label><textarea id="cgs-negative" data-negative rows="2" maxlength="2000" placeholder="What to avoid…"></textarea></div>
          <label class="cgs-check" data-safe-wrap hidden><input type="checkbox" data-safe> Venice safe mode (provider may blur adult output)</label>
          <div class="cgs-send-bar"><span data-estimate>Cost depends on the selected model.</span><button type="button" data-generate class="cgs-primary">Generate image</button></div>
          <p class="cgs-help">Generation uses paid API credits. Only your prompt and chosen image references are sent. Chat messages are not sent automatically.</p>
          <section class="cgs-results" data-results aria-label="Completed generation images"></section>
          <details class="cgs-history" open><summary>Recent generation jobs</summary><div data-jobs></div></details>
        </section>
        <section data-page="connections" hidden>
          <h3>Provider connections</h3><p class="cgs-help">Uses the same server-side OpenRouter and Venice keys as Inspiration Board. Saving a key here also changes that provider’s shared SillyTavern key. Keys are never stored in your gallery or returned by this plugin.</p>
          <div data-connection-status></div>
          <form data-key-form class="cgs-key-form"><label>Provider<select data-key-provider><option value="openrouter">OpenRouter</option><option value="venice">Venice</option></select></label><label>API key<input type="password" data-key autocomplete="new-password" spellcheck="false" placeholder="Paste key only to add or replace it"></label><button type="submit" class="cgs-primary">Save + test key</button></form>
          <h3>Storage</h3><p>Images, prompts, main references and settings are stored on your SillyTavern server, separately for each user and character avatar filename. Your images are not uploaded to GitHub.</p><p class="cgs-help">Renaming the character display name keeps the gallery. Replacing or renaming its avatar filename starts a different gallery; the old files are kept on the server.</p>
          <h3>Server plugin</h3><p data-server-status>Checking connection…</p><p class="cgs-help">Install the bundled <code>server-plugin/character-gallery-api</code> folder into <code>SillyTavern/plugins/</code>, enable server plugins and restart SillyTavern. This does not replace Inspiration Board Sync.</p>
        </section>
        </main><footer class="cgs-footer"><span>Gallery stays with <b>${esc(this.character.name)}</b>, even while jobs run.</span><span data-save-state>Server storage</span></footer>`;
        document.body.append(dialog); dialog.showModal();
        dialog.oncancel = e => { e.preventDefault(); void this.close(); };
        bind(dialog, '[data-close]', () => void this.close());
        dialog.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => this.showTab(b.dataset.tab));
        dialog.querySelectorAll('[data-provider]').forEach(b => b.onclick = () => { this.settings.provider = b.dataset.provider; this.settingsChanged(); this.updateProviderButtons(); void this.loadModels(); });
        bind(dialog, '[data-upload]', () => this.q('[data-files]').click());
        this.q('[data-files]').onchange = e => { const files = [...e.target.files]; e.target.value = ''; void this.upload(files); };
        bind(dialog, '[data-avatar]', () => void this.importAvatar());
        bind(dialog, '[data-refresh]', () => void this.refresh(true));
        this.q('[data-gallery-search]').oninput = () => { this.limit = 48; this.renderGallery(true); };
        this.q('[data-gallery-filter]').onchange = () => { this.limit = 48; this.renderGallery(true); };
        bind(dialog, '[data-more]', () => { this.limit += 48; this.renderGallery(true); });
        bind(dialog, '[data-use-selected]', () => { this.settings.referenceMode = 'selected'; this.q('[data-ref-mode]').value = 'selected'; this.settingsChanged(); this.showTab('generate'); this.renderRefs(); });
        bind(dialog, '[data-clear-selected]', () => { this.settings.selectedIds = []; this.settingsChanged(); this.renderGallery(true); this.renderRefs(); });
        bind(dialog, '[data-delete-selected]', () => void this.deleteSelected());
        bind(dialog, '[data-pick-refs]', () => this.showTab('gallery'));
        this.q('[data-model-search]').oninput = e => { this.filters.search = e.target.value; this.renderModelList(); };
        this.q('[data-model-sort]').onchange = e => { this.filters.sort = e.target.value; this.renderModelList(); };
        this.q('[data-safety-filter]').onchange = e => { this.filters.safety = e.target.value; this.renderModelList(); };
        this.q('[data-ref-only]').onchange = e => { this.filters.referenceOnly = e.target.checked; this.renderModelList(); };
        this.q('[data-ref-mode]').onchange = e => { this.settings.referenceMode = e.target.value; this.settingsChanged(); this.renderRefs(); };
        this.q('[data-prompt]').oninput = e => { this.settings.prompt = e.target.value; this.settingsChanged(); };
        this.q('[data-negative]').oninput = e => { this.settings.negativePrompt = e.target.value; this.settingsChanged(); };
        this.q('[data-safe]').onchange = e => { this.settings.safeMode = e.target.checked; this.settingsChanged(); };
        dialog.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
            const presets = { portrait: 'A detailed portrait of the character in the reference image. Keep the same face, hair and visual style.', full: 'A full-body image of the character in the reference image, from head to feet. Keep the same identity and visual style.', outfit: 'Keep the character’s identity and art style from the reference. Change the outfit to: ' };
            this.settings.prompt = presets[b.dataset.preset]; this.q('[data-prompt]').value = this.settings.prompt; this.settingsChanged(); this.q('[data-prompt]').focus();
        });
        bind(dialog, '[data-character-notes]', () => { this.settings.prompt = this.character.description.slice(0, 32000); this.q('[data-prompt]').value = this.settings.prompt; this.settingsChanged(); });
        bind(dialog, '[data-generate]', () => void this.generate());
        this.q('[data-key-form]').onsubmit = e => { e.preventDefault(); void this.saveKey(); };
        dialog.ondragover = e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); };
        dialog.ondrop = e => { if (e.dataTransfer.files.length) { e.preventDefault(); void this.upload([...e.dataTransfer.files]); } };
        this.library = new LibraryUi(this, { api, imageUrl, fileData, clickDownload, esc });
        try {
            await this.checkConnection();
            if (!this.status.features?.includes('collections-v2')) throw new Error('Update the bundled Character Gallery API server plugin to v0.2.0 and restart SillyTavern. Your gallery data is unchanged.');
            this.gallery = await api('/gallery/open', { method: 'POST', body: this.character });
            if (this.closed) return;
            this.settings = settingsWithDefaults(this.gallery.settings);
            this.q('[data-prompt]').value = this.settings.prompt; this.q('[data-negative]').value = this.settings.negativePrompt;
            this.q('[data-safe]').checked = this.settings.safeMode; this.q('[data-ref-mode]').value = this.settings.referenceMode;
            this.renderGallery(true); this.renderJobs(); this.renderResults(); this.updateProviderButtons();
            this.notice(this.gallery.images.length ? 'Gallery ready.' : 'Start by uploading images or importing the character avatar.');
            this.poll();
        } catch (error) { this.notice(error.message, true); this.showTab('connections'); }
    }
    notice(message, error = false) { if (this.closed) return; const el = this.q('[data-notice]'); el.textContent = message; el.classList.toggle('error', error); }
    async checkConnection() {
        this.status = await api('/status');
        this.q('[data-server-status]').textContent = `Connected · Character Gallery API ${this.status.version}`;
        this.q('[data-connection-status]').innerHTML = ['openrouter', 'venice'].map(p => `<p class="cgs-connection">${p === 'venice' ? 'Venice' : 'OpenRouter'} <b>${this.status.configured[p] ? 'Key saved' : 'Not configured'}</b></p>`).join('');
    }
    settingsChanged() {
        if (!this.gallery) return;
        this.q('[data-save-state]').textContent = 'Saving settings…'; this.dirty = true;
        clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => void this.flushSettings().catch(() => {}), 300);
    }
    flushSettings() {
        clearTimeout(this.saveTimer);
        if (!this.gallery || !this.dirty) return this.saveTail;
        this.dirty = false;
        const snapshot = copy(this.settings), galleryId = this.gallery.id;
        this.saveTail = this.saveTail.catch(() => {}).then(() => api(`/gallery/${galleryId}/settings`, { method: 'PATCH', body: { settings: snapshot } })).then(() => {
            if (!this.closed && !this.dirty) this.q('[data-save-state]').textContent = 'Settings saved';
        }).catch(error => { this.dirty = true; if (!this.closed) this.q('[data-save-state]').textContent = 'Settings not saved'; this.notice(error.message, true); throw error; });
        return this.saveTail;
    }
    async close() {
        try { await this.flushSettings(); } catch { toast('Settings could not be saved. Check your server connection.', 'warning'); }
        this.library?.dispose();
        this.closed = true; clearTimeout(this.pollTimer); clearTimeout(this.saveTimer); this.catalogEpoch++;
        this.viewer?.close(); this.viewer?.remove(); this.dialog.close(); this.dialog.remove();
        if (openPanel === this) openPanel = null;
    }
    showTab(tab) {
        this.library?.onTab(tab);
        this.tab = tab; this.dialog.querySelectorAll('[data-page]').forEach(p => p.hidden = p.dataset.page !== tab);
        this.dialog.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
        if (tab === 'generate') { if (!this.models.length || this.loadedProvider !== this.settings.provider) void this.loadModels(); this.renderRefs(); this.renderResults(); this.renderJobs(); }
    }
    updateProviderButtons() { this.dialog.querySelectorAll('[data-provider]').forEach(b => b.classList.toggle('active', b.dataset.provider === this.settings.provider)); }
    async refresh(force = false) {
        if (!this.gallery || this.closed) return;
        try {
            const galleryId = this.gallery.id;
            const fresh = await api(`/gallery/${galleryId}`);
            if (this.closed || this.gallery.id !== galleryId) return;
            this.gallery = fresh;
            // Do not overwrite controls/drafts while a job is polling.
            this.renderGallery(force); this.renderJobs(); this.renderResults(); this.renderRefs();
            if (force) this.notice('Gallery refreshed.');
        } catch (error) { this.notice(error.message, true); }
    }
    poll() {
        if (this.closed) return;
        this.pollTimer = setTimeout(async () => { await this.refresh(); this.poll(); }, this.gallery?.jobs.some(j => ACTIVE.has(j.status)) ? 2000 : 10000);
    }
    async upload(files) {
        if (!this.gallery || this.uploading) return;
        this.uploading = true; this.q('[data-upload]').disabled = true;
        const targetId = this.gallery.id; let uploaded = 0; const errors = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i]; this.notice(`Uploading ${i + 1} / ${files.length}: ${file.name}`);
            try {
                if (file.size > 25 * 1024 * 1024) throw new Error('File is larger than 25 MB.');
                if (!/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(file.type)) throw new Error('Unsupported image format.');
                const dataUrl = await fileData(file), size = await dimensions(dataUrl);
                await api(`/gallery/${targetId}/images`, { method: 'POST', body: { dataUrl, name: file.name, ...size } }); uploaded++;
            } catch (error) { errors.push(`${file.name}: ${error.message}`); }
        }
        this.uploading = false;
        if (!this.closed) { this.q('[data-upload]').disabled = false; await this.refresh(true); this.notice(`${uploaded} image(s) uploaded.${errors.length ? ` ${errors.length} failed: ${errors.join(' · ')}` : ''}`, errors.length > 0); }
    }
    async importAvatar() {
        if (!this.gallery) return;
        try {
            const response = await fetch(`/characters/${encodeURIComponent(this.character.avatar)}`, { credentials: 'same-origin' });
            if (!response.ok) throw new Error('Could not load the original character avatar. Upload its image instead.');
            const blob = await response.blob(); await this.upload([new File([blob], this.character.avatar, { type: blob.type || 'image/png' })]);
        } catch (error) { this.notice(error.message, true); }
    }
    toggleRef(id) {
        const ids = this.settings.selectedIds;
        this.settings.selectedIds = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
        this.settingsChanged(); this.renderGallery(true); this.renderRefs();
    }
    visibleImages() {
        if (this.library) return this.library.visibleImages();
        if (!this.gallery) return [];
        const term = this.q('[data-gallery-search]').value.trim().toLowerCase(), filter = this.q('[data-gallery-filter]').value;
        return this.gallery.images.filter(i => (!term || `${i.name} ${i.notes} ${i.tags.join(' ')}`.toLowerCase().includes(term)) && (filter === 'all' || filter === i.source || filter === i.role || filter === 'favorite' && i.favorite || filter === 'references' && (this.settings.selectedIds.includes(i.id) || this.gallery.mainImageId === i.id)));
    }
    renderGallery(force = false) {
        if (this.library) return this.library.renderGallery(force);
        if (!this.gallery || this.closed) return;
        this.q('[data-count]').textContent = this.gallery.images.length;
        this.q('[data-selected]').textContent = `${this.settings.selectedIds.length} reference(s) selected`;
        const rows = this.visibleImages(), signature = JSON.stringify([rows.map(i => [i.id, i.name, i.favorite, i.role]), this.settings.selectedIds, this.gallery.mainImageId, this.limit]);
        if (!force && signature === this.gallerySignature) return; this.gallerySignature = signature;
        this.q('[data-grid]').innerHTML = rows.length ? rows.slice(0, this.limit).map(i => `<article class="cgs-card ${this.settings.selectedIds.includes(i.id) ? 'selected' : ''}"><button type="button" class="cgs-image-open" data-view="${i.id}" aria-label="View ${esc(i.name)}"><img loading="lazy" decoding="async" src="${imageUrl(this.gallery, i.id)}" alt="${esc(i.name)}">${this.gallery.mainImageId === i.id ? '<span class="cgs-main-badge">MAIN</span>' : ''}</button><div class="cgs-card-name" title="${esc(i.name)}">${esc(i.name)}</div><div class="cgs-card-actions"><button type="button" data-ref="${i.id}" aria-pressed="${this.settings.selectedIds.includes(i.id)}">${this.settings.selectedIds.includes(i.id) ? '✓ Ref' : '＋ Ref'}</button><button type="button" data-favorite="${i.id}" aria-label="Toggle favorite" aria-pressed="${i.favorite}">${i.favorite ? '★' : '☆'}</button><span>${esc(i.role)}</span></div></article>`).join('') : '<div class="cgs-empty"><h3>Your character’s image space</h3><p>Upload references, collect outfit ideas, and keep generated images together here.</p></div>';
        this.q('[data-more]').hidden = rows.length <= this.limit;
        this.q('[data-grid]').querySelectorAll('[data-view]').forEach(b => b.onclick = () => this.openViewer(b.dataset.view, rows.map(i => i.id)));
        this.q('[data-grid]').querySelectorAll('[data-ref]').forEach(b => b.onclick = () => this.toggleRef(b.dataset.ref));
        this.q('[data-grid]').querySelectorAll('[data-favorite]').forEach(b => b.onclick = async () => {
            const image = this.gallery.images.find(i => i.id === b.dataset.favorite);
            try { await api(`/gallery/${this.gallery.id}/image/${image.id}`, { method: 'PATCH', body: { favorite: !image.favorite } }); await this.refresh(true); } catch (e) { this.notice(e.message, true); }
        });
    }
    async deleteSelected() {
        if (this.library) return this.library.action('trash');
        const ids = [...this.settings.selectedIds]; if (!ids.length || !confirm(`Delete ${ids.length} selected image(s) from ${this.character.name}’s gallery? This cannot be undone.`)) return;
        try { await api(`/gallery/${this.gallery.id}/images`, { method: 'DELETE', body: { ids } }); this.settings.selectedIds = []; this.settingsChanged(); await this.refresh(true); }
        catch (e) { this.notice(e.message, true); }
    }
    model() { return this.models.find(m => m.id === this.settings.providers[this.settings.provider].model); }
    async loadModels() {
        const provider = this.settings.provider, epoch = ++this.catalogEpoch;
        this.updateProviderButtons(); this.q('[data-models]').innerHTML = '<p>Loading live models and per-image prices…</p>';
        if (!this.gallery) return;
        try {
            const data = await api(`/models/${provider}`);
            if (this.closed || epoch !== this.catalogEpoch) return;
            this.models = data.models || []; this.loadedProvider = provider;
            if (!this.settings.providers[provider].model && this.models.length) { this.settings.providers[provider].model = this.models[0].id; this.settingsChanged(); }
            this.renderModelList(); this.renderModel();
        } catch (e) { if (epoch === this.catalogEpoch && !this.closed) { this.models = []; this.q('[data-models]').textContent = e.message; this.notice(e.message, true); this.renderModel(); } }
    }
    renderModelList() {
        const selected = this.settings.providers[this.settings.provider].model, rows = this.library ? this.library.sortModels(filteredModels(this.models, this.filters)) : filteredModels(this.models, this.filters);
        this.q('[data-models]').innerHTML = rows.length ? rows.map(m => `<button type="button" role="option" aria-selected="${m.id === selected}" data-model="${esc(m.id)}" class="cgs-model-option ${m.id === selected ? 'active' : ''}"><span><strong>${esc(m.name)}</strong><small>${m.refs.max ? `${m.refs.min ? 'Requires' : 'Supports'} refs · max ${m.refs.max}` : 'Prompt only'}${m.uncensored ? ' · Uncensored / NSFW' : ''}</small></span><b>${esc(priceLabel(m.price))}</b></button>`).join('') : '<p>No models match these filters. Your previous selection is kept.</p>';
        this.q('[data-models]').querySelectorAll('[data-model]').forEach(b => b.onclick = () => { this.settings.providers[this.settings.provider].model = b.dataset.model; this.settingsChanged(); this.renderModelList(); this.renderModel(); });
        this.library?.decorateModels();
    }
    renderModel() {
        const m = this.model(), s = this.settings.providers[this.settings.provider];
        if (!m) { this.q('[data-model-info]').textContent = 'Select a model from the live catalog.'; this.q('[data-params]').innerHTML = ''; this.renderRefs(); return; }
        for (const [key, values] of [['aspect', m.params.aspects], ['resolution', m.params.resolutions], ['quality', m.params.qualities], ['format', m.params.formats]]) if (s[key] && !values.includes(s[key])) s[key] = '';
        s.count = Math.min(s.count, m.params.maxCount);
        this.q('[data-model-info]').innerHTML = `<strong>${esc(m.name)}</strong><div class="cgs-badges"><span>${esc(priceLabel(m.price))}</span><span>${m.refs.max ? `Reference input · ${m.refs.min}–${m.refs.max}` : 'No reference input'}</span><span>${esc(m.moderation)}</span></div><p>${esc(m.description)}</p>${m.refs.style ? '<p class="cgs-warning">Style-reference model: copies visual style, not necessarily character identity.</p>' : ''}`;
        this.q('[data-params]').innerHTML = [['aspect', 'Aspect ratio', m.params.aspects], ['resolution', 'Resolution', m.params.resolutions], ['quality', 'Quality', m.params.qualities], ['format', 'Output format', m.params.formats]].filter(([, , values]) => values.length).map(([key, label, values]) => `<label>${label}<select data-param="${key}">${options(values, s[key])}</select></label>`).join('') + `<label>Image count<select data-param="count">${Array.from({ length: m.params.maxCount }, (_, i) => `<option ${s.count === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>${m.params.seed ? `<label>Seed (optional)<input type="number" min="0" max="2147483647" data-param="seed" value="${esc(s.seed)}" placeholder="Random"></label>` : ''}`;
        this.q('[data-params]').querySelectorAll('[data-param]').forEach(el => el.onchange = () => { s[el.dataset.param] = el.dataset.param === 'count' ? Number(el.value) : el.value; this.settingsChanged(); this.renderEstimate(); });
        this.q('[data-negative-wrap]').hidden = !m.params.negative; this.q('[data-safe-wrap]').hidden = m.provider !== 'venice';
        this.renderRefs(); this.renderEstimate(); this.settingsChanged();
        const summary = this.q('[data-model-summary]'); if (summary) summary.textContent = m.name;
    }
    renderEstimate() {
        const m = this.model(); if (!m) return;
        const count = this.settings.providers[m.provider].count;
        this.q('[data-estimate]').textContent = m.price?.unit === 'img' && m.price.min !== null ? `${m.price.exact ? 'Base estimate' : 'From'}: $${(m.price.min * count).toFixed(3)} / ${count} image(s)${m.price.extra ? ' + input charges' : ''}. Quality / resolution may change cost.` : `${priceLabel(m.price)} · no reliable flat total.`;
    }
    renderRefs() {
        if (!this.gallery || this.closed) return;
        const refs = referenceImages(this.gallery, this.settings), m = this.model();
        const text = !m ? 'Choose a model to check reference support.' : !m.refs.max ? refs.length ? 'NOT SENT: this model cannot use your selected images. Switch models or choose None before generating.' : 'Prompt-only model. No references will be sent.' : refs.length ? `${refs.length} original image(s) selected. First source: ${refs[0].name}. This model allows up to ${m.refs.max}.` : `No source selected.${m.refs.min ? ' This model requires a reference.' : ' Select references in Gallery, or set a main reference.'}`;
        this.q('[data-ref-plan]').textContent = text;
        this.q('[data-ref-plan]').classList.toggle('cgs-warning', Boolean(m && (refs.length > m.refs.max || refs.length < m.refs.min)));
        const signature = JSON.stringify([refs.map(r => r.id), m?.id]);
        if (signature !== this.refsSignature) {
            this.refsSignature = signature; this.q('[data-refs]').innerHTML = refs.map((r, i) => `<button type="button" data-ref-preview="${r.id}" title="${esc(r.name)}"><img src="${imageUrl(this.gallery, r.id)}" alt="${esc(r.name)}"><span>${i + 1}${i === 0 ? ' · Base' : ''}</span></button>`).join('');
            this.q('[data-refs]').querySelectorAll('[data-ref-preview]').forEach(b => b.onclick = () => this.openViewer(b.dataset.refPreview, refs.map(r => r.id)));
        }
        this.library?.decorateRefs();
    }
    async generate() {
        if (!this.gallery || this.busy) return;
        const button = this.q('[data-generate]'); this.busy = true; button.disabled = true; button.textContent = 'Sending…';
        try {
            const settings = copy(this.settings); validateRequest(this.model(), settings, referenceImages(this.gallery, settings));
            await this.flushSettings();
            const { job } = await api(`/gallery/${this.gallery.id}/generate`, { method: 'POST', body: { settings } });
            this.notice(`Job accepted by your server ✓ · ${job.id.slice(0, 8)}. Reference preparation is starting.`);
            await this.refresh(); clearTimeout(this.pollTimer); this.poll();
        } catch (e) { this.notice(e.message, true); }
        finally { this.busy = false; if (!this.closed) { button.disabled = this.gallery?.jobs.some(j => ACTIVE.has(j.status)); button.textContent = button.disabled ? 'Generation running…' : 'Generate image'; } }
    }
    renderJobs() {
        if (!this.gallery || this.closed) return;
        const active = this.gallery.jobs.filter(j => ACTIVE.has(j.status)); this.q('[data-running]').textContent = active.length ? '• Running' : '';
        const button = this.q('[data-generate]'); if (!this.busy) { button.disabled = active.length > 0; button.textContent = active.length ? 'Generation running…' : 'Generate image'; }
        const jobs = this.gallery.jobs;
        const signature = JSON.stringify(jobs.map(j => [j.id, j.status, j.message]));
        if (signature === this.jobsSignature) return; this.jobsSignature = signature;
        this.q('[data-jobs]').innerHTML = jobs.length ? jobs.map(j => `<article class="cgs-job ${esc(j.status)}"><div><strong>${esc(j.modelName)}</strong><span class="cgs-job-status">${ACTIVE.has(j.status) ? '<i class="cgs-spinner"></i>' : ''}${esc(j.status)}</span></div><p>${esc(j.message)}</p><small>${new Date(j.createdAt).toLocaleString()} · ${esc(j.characterName)}</small><details><summary>Prompt and request details</summary><p>${esc(j.settings.prompt)}</p><p>Job ${esc(j.id)}${j.responseId ? ` · Provider response ${esc(j.responseId)}` : ''}</p>${j.receipt ? `<p>${esc(j.receipt.endpoint)} · ${j.receipt.referenceCount} original reference(s) attached</p>${j.receipt.originals.map(r => `<p>${esc(r.id.slice(0, 8))} · ${formatBytes(r.bytes)} · SHA-256 ${esc(r.sha256.slice(0, 12))}…</p>`).join('')}<small>${esc(j.receipt.meaning)}</small>` : '<p>The provider request has not been dispatched yet.</p>'}</details>${ACTIVE.has(j.status) ? `<button type="button" data-cancel-job="${j.id}">Stop waiting</button>` : ['failed', 'canceled', 'interrupted'].includes(j.status) ? `<button type="button" data-retry-job="${j.id}">Load settings to retry</button>` : ''}</article>`).join('') : '<p class="cgs-help">Your generation history will appear here.</p>';
        this.q('[data-jobs]').querySelectorAll('[data-cancel-job]').forEach(b => b.onclick = async () => {
            if (!confirm('Stop waiting locally? The provider may still process and charge for this request.')) return;
            try { await api(`/gallery/${this.gallery.id}/job/${b.dataset.cancelJob}/cancel`, { method: 'POST', body: {} }); await this.refresh(); } catch (e) { this.notice(e.message, true); }
        });
        this.q('[data-jobs]').querySelectorAll('[data-retry-job]').forEach(b => b.onclick = () => {
            const job = jobs.find(j => j.id === b.dataset.retryJob); this.settings = settingsWithDefaults(job.settings);
            this.q('[data-prompt]').value = this.settings.prompt; this.q('[data-negative]').value = this.settings.negativePrompt; this.q('[data-safe]').checked = this.settings.safeMode; this.q('[data-ref-mode]').value = this.settings.referenceMode;
            this.settingsChanged(); void this.loadModels(); this.notice('Previous settings loaded. Review them, then press Generate. No automatic paid retry was sent.');
        });
    }
    renderResults() {
        if (!this.gallery || this.closed) return;
        const rows = this.gallery.images.filter(i => i.source === 'generated' && i.state !== 'archived').slice(0, 8), signature = rows.map(i => `${i.id}:${i.state}`).join();
        if (signature === this.resultsSignature) return; this.resultsSignature = signature;
        this.q('[data-results]').innerHTML = rows.length ? `<h3>Recent results</h3><p class="cgs-help">Saved in ${esc(this.character.name)}’s gallery. Tap to view full size.</p>${rows.map(i => `<article><button type="button" class="cgs-result-image" data-result="${i.id}"><img src="${imageUrl(this.gallery, i.id)}" loading="lazy" alt="${esc(i.name)}"></button><div class="cgs-toolbar"><button type="button" data-result="${i.id}">View full</button><button type="button" data-result-ref="${i.id}">Use as reference</button><button type="button" data-download="${i.id}">Download</button></div></article>`).join('')}` : '';
        this.q('[data-results]').querySelectorAll('[data-result]').forEach(b => b.onclick = () => this.openViewer(b.dataset.result, rows.map(i => i.id)));
        this.q('[data-results]').querySelectorAll('[data-result-ref]').forEach(b => b.onclick = () => { this.settings.selectedIds = [b.dataset.resultRef]; this.settings.referenceMode = 'selected'; this.q('[data-ref-mode]').value = 'selected'; this.settingsChanged(); this.renderRefs(); this.renderGallery(true); this.notice('Result selected as the next reference.'); });
        this.q('[data-results]').querySelectorAll('[data-download]').forEach(b => b.onclick = () => downloadImage(this.gallery, rows.find(i => i.id === b.dataset.download)).catch(e => this.notice(e.message, true)));
        this.library?.decorateResults(rows);
    }
    async saveKey() {
        const form = this.q('[data-key-form]'), button = form.querySelector('button'); button.disabled = true;
        try {
            await api('/key', { method: 'POST', body: { provider: this.q('[data-key-provider]').value, key: this.q('[data-key]').value.trim() } });
            this.q('[data-key]').value = ''; await this.checkConnection(); this.notice('API key saved on the server and tested.');
            if (!this.gallery) { this.gallery = await api('/gallery/open', { method: 'POST', body: this.character }); this.settings = settingsWithDefaults(this.gallery.settings); }
            await this.loadModels();
        } catch (e) { this.notice(e.message, true); } finally { button.disabled = false; }
    }
    openViewer(id, ids = this.gallery.images.map(i => i.id)) {
        this.viewer?.close(); this.viewer?.remove();
        const view = this.viewer = document.createElement('dialog'); view.className = 'cgs-viewer';
        view.innerHTML = `<header><strong data-v-title></strong><button type="button" data-v-close aria-label="Close image">✕</button></header><div class="cgs-view-stage" data-stage><img data-v-image alt=""></div><div class="cgs-view-toolbar"><button type="button" data-prev aria-label="Previous image">‹</button><button type="button" data-next aria-label="Next image">›</button><button type="button" data-zoom-out aria-label="Zoom out">−</button><button type="button" data-zoom-in aria-label="Zoom in">＋</button><button type="button" data-fit>Fit</button><button type="button" data-v-download>Download</button><button type="button" data-v-main>Set main ref</button><button type="button" data-v-ref>Use ref</button></div><details class="cgs-edit-info"><summary>Image details / tags</summary><label>Name<input data-v-name></label><label>Role<select data-v-role>${ROLES.map(r => `<option>${r}</option>`).join('')}</select></label><label>Tags (comma separated)<input data-v-tags></label><label>Notes<textarea data-v-notes rows="2"></textarea></label><button type="button" data-v-save>Save details</button><p data-v-info></p></details>`;
        document.body.append(view); view.showModal();
        const q = s => view.querySelector(s), stage = q('[data-stage]'), img = q('[data-v-image]');
        let at = Math.max(0, ids.indexOf(id)), zoom = 1, x = 0, y = 0, start = null, pinch = null; const pointers = new Map();
        const current = () => (this.library?.allImages() || this.gallery.images).find(i => i.id === ids[at]);
        const transform = () => img.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
        const fit = () => { zoom = 1; x = y = 0; transform(); };
        const show = delta => {
            at = (at + delta + ids.length) % ids.length; const image = current(); if (!image) return;
            for (const selector of ['[data-v-main]', '[data-v-ref]', '[data-v-save]']) q(selector).disabled = Boolean(image.deletedAt);
            fit(); img.src = imageUrl(this.gallery, image.id); img.alt = image.name; q('[data-v-title]').textContent = `${at + 1} / ${ids.length} · ${image.name}`;
            q('[data-v-name]').value = image.name; q('[data-v-role]').value = image.role; q('[data-v-tags]').value = image.tags.join(', '); q('[data-v-notes]').value = image.notes;
            q('[data-v-info]').textContent = `${formatBytes(image.bytes)} · ${image.mime}${image.generation ? ` · ${image.generation.provider} / ${image.generation.model}` : ''}`;
            q('[data-v-main]').textContent = image.id === this.gallery.mainImageId ? '✓ Main ref' : 'Set main ref';
            q('[data-v-ref]').textContent = this.settings.selectedIds.includes(image.id) ? '✓ Ref selected' : 'Use ref';
        };
        const dismiss = () => { view.close(); view.remove(); if (this.viewer === view) this.viewer = null; };
        q('[data-v-close]').onclick = dismiss; view.oncancel = e => { e.preventDefault(); dismiss(); };
        q('[data-prev]').onclick = () => show(-1); q('[data-next]').onclick = () => show(1); q('[data-fit]').onclick = fit;
        const scale = factor => { zoom = Math.max(1, Math.min(6, zoom * factor)); if (zoom === 1) x = y = 0; transform(); };
        q('[data-zoom-in]').onclick = () => scale(1.4); q('[data-zoom-out]').onclick = () => scale(1 / 1.4);
        stage.onwheel = e => { e.preventDefault(); scale(e.deltaY < 0 ? 1.1 : 1 / 1.1); };
        stage.onpointerdown = e => { stage.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 1) start = { px: e.clientX, py: e.clientY, x, y, zoom }; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom }; start = null; } };
        stage.onpointermove = e => {
            if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 2 && pinch) { const [a, b] = [...pointers.values()]; zoom = Math.max(1, Math.min(6, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.distance))); transform(); }
            else if (start && zoom > 1) { x = start.x + e.clientX - start.px; y = start.y + e.clientY - start.py; transform(); }
        };
        const release = e => { if (start && start.zoom === 1 && zoom === 1 && Math.abs(e.clientX - start.px) > 60 && Math.abs(e.clientY - start.py) < 80) show(e.clientX < start.px ? 1 : -1); pointers.delete(e.pointerId); pinch = null; start = null; };
        stage.onpointerup = release; stage.onpointercancel = () => { pointers.clear(); start = pinch = null; };
        view.onkeydown = e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if (e.key === 'ArrowLeft') { e.preventDefault(); show(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); show(1); } };
        q('[data-v-download]').onclick = () => downloadImage(this.gallery, current()).catch(e => toast(e.message, 'error'));
        q('[data-v-ref]').onclick = () => { this.toggleRef(current().id); show(0); };
        q('[data-v-main]').onclick = async () => { try { await api(`/gallery/${this.gallery.id}/main`, { method: 'POST', body: { imageId: current().id } }); await this.refresh(true); show(0); } catch (e) { toast(e.message, 'error'); } };
        q('[data-v-save]').onclick = async () => { try { await api(`/gallery/${this.gallery.id}/image/${current().id}`, { method: 'PATCH', body: { name: q('[data-v-name]').value, role: q('[data-v-role]').value, tags: q('[data-v-tags]').value.split(',').map(x => x.trim()), notes: q('[data-v-notes]').value } }); await this.refresh(true); show(0); toast('Image details saved.', 'success'); } catch (e) { toast(e.message, 'error'); } };
        show(0);
    }
}

function installLaunchers() {
    const menu = document.getElementById('extensionsMenu');
    if (menu && !document.getElementById('cgs-menu-button')) {
        const button = document.createElement('div'); button.id = 'cgs-menu-button'; button.className = 'list-group-item flex-container'; button.tabIndex = 0; button.setAttribute('role', 'button');
        button.innerHTML = '<span class="fa-solid fa-images"></span><span>Character Gallery Studio</span>'; button.onclick = () => void openCurrentGallery(); button.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openCurrentGallery(); } }; menu.append(button);
    }
    const settings = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (settings && !document.getElementById('cgs-extension-settings')) {
        const panel = document.createElement('details'); panel.id = 'cgs-extension-settings'; panel.innerHTML = `<summary>Character Gallery Studio · ${VERSION}</summary><p>Per-character images, references and generation.</p><button type="button" data-cgs-open>Open current character gallery</button><label><input type="checkbox" data-cgs-floating> Show floating Gallery button</label>`; settings.append(panel);
        panel.querySelector('[data-cgs-open]').onclick = () => void openCurrentGallery();
        const toggle = panel.querySelector('[data-cgs-floating]'); toggle.checked = localStorage.getItem('cgs-floating') !== 'false';
        toggle.onchange = () => { localStorage.setItem('cgs-floating', String(toggle.checked)); installLaunchers(); };
    }
    let floating = document.getElementById('cgs-floating');
    if (!floating) { floating = document.createElement('button'); floating.id = 'cgs-floating'; floating.type = 'button'; floating.textContent = '▧ Gallery'; floating.title = 'Open the current character’s gallery'; floating.onclick = () => void openCurrentGallery(); document.body.append(floating); }
    floating.hidden = localStorage.getItem('cgs-floating') === 'false';
}
function boot() {
    if (globalThis.__characterGalleryStudio) return;
    globalThis.__characterGalleryStudio = { version: VERSION, open: openCurrentGallery };
    installLaunchers();
    const c = context();
    for (const name of ['APP_READY', 'CHAT_CHANGED']) if (c?.event_types?.[name]) c.eventSource?.on(c.event_types[name], () => installLaunchers());
    // Bounded startup retries cover older ST versions without a permanent polling loop.
    let attempts = 0; const timer = setInterval(() => { installLaunchers(); if (++attempts >= 15 || document.getElementById('cgs-menu-button') && document.getElementById('cgs-extension-settings')) clearInterval(timer); }, 1000);
    console.info(`[Character Gallery Studio] v${VERSION} ready`);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
