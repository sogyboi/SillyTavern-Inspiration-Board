const STYLE_ID = 'ib60-openrouter-browser-style';
const PROVIDER_KEY = 'st_inspiration_board_media_provider_v60';
const METADATA_URL = 'https://openrouter.ai/api/v1/models?output_modalities=image';
const enhanced = new WeakSet();
let metadataPromise = null;
let observer = null;
let openVeniceCallback = null;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ib60-provider-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px}.ib60-provider-tabs button{min-height:38px;border:1px solid var(--ib2-line,#343446);border-radius:11px;background:#15151f;color:#ddd;font-weight:700}.ib60-provider-tabs button.active{background:linear-gradient(135deg,#906cff,#6244d6);color:#fff;border-color:#8f73ef}
    .ib60-or-tools{display:grid;grid-template-columns:minmax(0,1fr) minmax(105px,.55fr);gap:7px;margin:2px 0 4px}.ib60-or-tools input,.ib60-or-tools select{width:100%;min-height:36px}.ib60-or-tools .wide{grid-column:1/-1}.ib60-or-disclaimer{font-size:9px;line-height:1.35;color:var(--ib2-muted,#aaa);padding:3px 1px 7px}.ib60-or-model-label{display:flex;align-items:center;justify-content:space-between;gap:8px}.ib60-or-count{font-size:9px;color:#aaa;font-weight:400}
    @media(max-width:700px){.ib60-or-tools{grid-template-columns:1fr 1fr}.ib60-or-tools .search{grid-column:1/-1}}
  `;
  document.head.appendChild(style);
}

function getMetadata() {
  if (metadataPromise) return metadataPromise;
  metadataPromise = fetch(METADATA_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(response => response.ok ? response.json() : { data: [] })
    .then(payload => new Map((Array.isArray(payload?.data) ? payload.data : []).map(model => [String(model.id), model])))
    .catch(() => new Map());
  return metadataPromise;
}

function parsePrice(label) {
  const match = String(label || '').match(/(?:from\s+)?\$([0-9]+(?:\.[0-9]+)?)\s*\/(?:img|image)/i);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function referenceKind(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('no refs')) return 'none';
  if (text.includes('ref')) return 'refs';
  return 'unknown';
}

function moderationKind(model) {
  const value = model?.top_provider?.is_moderated;
  if (value === false) return 'unmoderated';
  if (value === true) return 'moderated';
  return 'unknown';
}

function explicitlyUncensored(model, value = '') {
  const text = `${value} ${model?.id || ''} ${model?.name || ''}`.toLowerCase();
  return /(?:^|[^a-z])(uncensored|nsfw)(?:[^a-z]|$)/i.test(text) || text.includes('lustify');
}

function stripBrowserBadge(label) {
  let value = String(label || '');
  const pattern = /\s+·\s+(?:🔓\s*)?(?:Uncensored\/NSFW|Unmoderated|Moderated|Moderation unknown)$/i;
  while (pattern.test(value)) value = value.replace(pattern, '');
  return value;
}

function optionLabel(entry) {
  const base = stripBrowserBadge(entry.baseLabel || entry.option?.textContent || entry.value);
  if (explicitlyUncensored(entry.meta, entry.value)) return `${base} · 🔓 Uncensored/NSFW`;
  const moderation = moderationKind(entry.meta);
  if (moderation === 'unmoderated') return `${base} · Unmoderated`;
  if (moderation === 'moderated') return `${base} · Moderated`;
  return base;
}

function enhanceModal(modal) {
  if (!modal || enhanced.has(modal)) return;
  enhanced.add(modal);
  ensureStyles();

  const grid = modal.querySelector('.ib2-or-grid') || modal.firstElementChild;
  const select = modal.querySelector('[data-or-model]');
  if (!grid || !select) return;

  const providerTabs = document.createElement('div');
  providerTabs.className = 'ib60-provider-tabs wide';
  providerTabs.innerHTML = '<button type="button" class="active">OpenRouter · Images</button><button type="button" data-ib60-open-venice>Venice · Image + Video</button>';
  grid.prepend(providerTabs);
  providerTabs.querySelector('[data-ib60-open-venice]').onclick = () => {
    localStorage.setItem(PROVIDER_KEY, 'venice');
    modal.remove();
    openVeniceCallback?.(globalThis.InspirationBoard?.app || null);
  };

  const label = select.closest('label');
  if (label) {
    const title = document.createElement('div');
    title.className = 'ib60-or-model-label';
    title.innerHTML = '<b>OpenRouter image model</b><span class="ib60-or-count" data-ib60-or-count></span>';
    label.prepend(title);
  }

  const tools = document.createElement('div');
  tools.className = 'ib60-or-tools wide';
  tools.innerHTML = `
    <input class="search" data-ib60-or-search type="search" placeholder="Search OpenRouter image models…">
    <select data-ib60-or-sort aria-label="Sort OpenRouter models">
      <option value="original">Recommended / current order</option>
      <option value="price-asc">Price · low to high</option>
      <option value="price-desc">Price · high to low</option>
      <option value="newest">Newest</option>
      <option value="name">Name</option>
    </select>
    <select data-ib60-or-refs aria-label="Filter reference support">
      <option value="all">All reference support</option>
      <option value="refs">Reference-capable only</option>
      <option value="none">No-reference models</option>
    </select>
    <select data-ib60-or-safety aria-label="Filter model safety/moderation">
      <option value="all">All safety / moderation</option>
      <option value="explicit">Explicit Uncensored / NSFW labels</option>
      <option value="unmoderated">Unmoderated top route</option>
      <option value="moderated">Moderated top route</option>
      <option value="unknown">Unknown moderation</option>
    </select>`;
  label?.before(tools);

  const disclaimer = document.createElement('div');
  disclaimer.className = 'ib60-or-disclaimer wide';
  disclaimer.textContent = 'OpenRouter safety labels use live model names plus top_provider.is_moderated. “Unmoderated” means the top OpenRouter route reports moderation off; it is not a guarantee that every fallback/provider accepts every NSFW prompt.';
  tools.after(disclaimer);

  const search = tools.querySelector('[data-ib60-or-search]');
  const sort = tools.querySelector('[data-ib60-or-sort]');
  const refs = tools.querySelector('[data-ib60-or-refs]');
  const safety = tools.querySelector('[data-ib60-or-safety]');
  const count = modal.querySelector('[data-ib60-or-count]');
  const entries = new Map();
  let metadata = new Map();
  let originalCounter = 0;

  const syncOptions = () => {
    for (const option of [...select.options]) {
      const value = option.value;
      let entry = entries.get(value);
      const current = stripBrowserBadge(option.textContent || value);
      if (!entry) {
        entry = { value, option, baseLabel: current, originalIndex: originalCounter++, meta: metadata.get(value) || null };
        entries.set(value, entry);
      } else {
        entry.option = option;
        entry.meta = metadata.get(value) || entry.meta || null;
        // OpenRouter's v0.5.8 pricing loader updates option text asynchronously.
        // Capture those updates while stripping only badges added by this module.
        if (current && current !== stripBrowserBadge(optionLabel(entry))) entry.baseLabel = current;
      }
    }
  };

  const matchesSafety = entry => {
    const filter = safety.value;
    if (filter === 'all') return true;
    if (filter === 'explicit') return explicitlyUncensored(entry.meta, entry.value);
    return moderationKind(entry.meta) === filter;
  };

  const apply = () => {
    syncOptions();
    const query = search.value.trim().toLowerCase();
    const selected = select.value;
    const rows = [...entries.values()].filter(entry => entry.option?.isConnected || [...select.options].includes(entry.option));

    for (const entry of rows) {
      entry.meta = metadata.get(entry.value) || entry.meta || null;
      const ref = referenceKind(entry.baseLabel);
      const searchable = `${entry.baseLabel} ${entry.value} ${entry.meta?.name || ''} ${entry.meta?.description || ''}`.toLowerCase();
      const visible = entry.value === selected
        || ((!query || searchable.includes(query))
          && (refs.value === 'all' || ref === refs.value)
          && matchesSafety(entry));
      entry.option.hidden = !visible;
      entry.option.disabled = !visible;
      entry.option.style.display = visible ? '' : 'none';
      entry.option.textContent = optionLabel(entry);
    }

    const mode = sort.value;
    const ordered = [...rows].sort((a, b) => {
      if (mode === 'name') return a.baseLabel.localeCompare(b.baseLabel);
      if (mode === 'newest') return Number(b.meta?.created || 0) - Number(a.meta?.created || 0) || a.baseLabel.localeCompare(b.baseLabel);
      if (mode === 'price-asc') return parsePrice(a.baseLabel) - parsePrice(b.baseLabel) || a.baseLabel.localeCompare(b.baseLabel);
      if (mode === 'price-desc') return parsePrice(b.baseLabel) - parsePrice(a.baseLabel) || a.baseLabel.localeCompare(b.baseLabel);
      return a.originalIndex - b.originalIndex;
    });
    const fragment = document.createDocumentFragment();
    ordered.forEach(entry => fragment.appendChild(entry.option));
    select.appendChild(fragment);
    if (selected && [...select.options].some(option => option.value === selected)) select.value = selected;
    const shown = ordered.filter(entry => !entry.option.hidden).length;
    if (count) count.textContent = `${shown} shown / ${ordered.length}`;
  };

  [search, sort, refs, safety].forEach(control => control.addEventListener(control === search ? 'input' : 'change', apply));
  syncOptions();
  apply();

  // Keep all real option nodes in the select so the existing v0.5.8 pricing loader can
  // continue updating them. A small poll captures those text updates without a MutationObserver loop.
  const refreshTimer = setInterval(() => {
    if (!modal.isConnected) {
      clearInterval(refreshTimer);
      return;
    }
    apply();
  }, 450);

  void getMetadata().then(map => {
    metadata = map;
    for (const entry of entries.values()) entry.meta = metadata.get(entry.value) || null;
    apply();
  });
}

function scan() {
  document.querySelectorAll('.ib2-openrouter-modal').forEach(enhanceModal);
}

export function installOpenRouterModelBrowser({ openVenice } = {}) {
  openVeniceCallback = typeof openVenice === 'function' ? openVenice : openVeniceCallback;
  ensureStyles();
  scan();
  if (!observer) {
    observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  return true;
}
