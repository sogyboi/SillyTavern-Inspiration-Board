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

function cleanBadge(label) {
  return String(label || '').replace(/\s+·\s+(?:Unmoderated|Moderated|Moderation unknown)$/i, '');
}

function optionLabel(entry) {
  const base = cleanBadge(entry.label);
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
  providerTabs.innerHTML = '<button type="button" class="active">OpenRouter</button><button type="button" data-ib60-open-venice>Venice · Image + Video</button>';
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
    <select data-ib60-or-moderation aria-label="Filter moderation">
      <option value="all">All moderation</option>
      <option value="unmoderated">Unmoderated endpoints</option>
      <option value="moderated">Moderated endpoints</option>
      <option value="unknown">Unknown moderation</option>
    </select>`;
  label?.before(tools);

  const disclaimer = document.createElement('div');
  disclaimer.className = 'ib60-or-disclaimer wide';
  disclaimer.textContent = 'OpenRouter moderation labels use its live top_provider.is_moderated metadata. “Unmoderated” means OpenRouter reports moderation off for the top route; it is not a guarantee that every fallback/provider accepts every NSFW prompt.';
  tools.after(disclaimer);

  const search = tools.querySelector('[data-ib60-or-search]');
  const sort = tools.querySelector('[data-ib60-or-sort]');
  const refs = tools.querySelector('[data-ib60-or-refs]');
  const moderation = tools.querySelector('[data-ib60-or-moderation]');
  const count = modal.querySelector('[data-ib60-or-count]');
  let entries = [];
  let metadata = new Map();
  let rebuilding = false;

  const syncOptions = () => {
    if (rebuilding) return;
    const previous = new Map(entries.map(entry => [entry.value, entry]));
    for (const option of select.options) {
      const value = option.value;
      const old = previous.get(value);
      const currentLabel = cleanBadge(option.textContent || value);
      if (old) old.label = currentLabel;
      else entries.push({ value, label: currentLabel, originalIndex: entries.length, meta: metadata.get(value) || null });
    }
  };

  const apply = () => {
    syncOptions();
    const query = search.value.trim().toLowerCase();
    const refFilter = refs.value;
    const moderationFilter = moderation.value;
    const selected = select.value;
    let rows = entries.map(entry => ({ ...entry, meta: metadata.get(entry.value) || entry.meta || null }));
    rows = rows.filter(entry => {
      const text = `${entry.label} ${entry.value} ${entry.meta?.description || ''}`.toLowerCase();
      const matchesQuery = !query || text.includes(query);
      const ref = referenceKind(entry.label);
      const matchesRef = refFilter === 'all' || ref === refFilter || entry.value === selected;
      const mod = moderationKind(entry.meta);
      const matchesModeration = moderationFilter === 'all' || mod === moderationFilter || entry.value === selected;
      return matchesQuery && matchesRef && matchesModeration;
    });
    const mode = sort.value;
    rows.sort((a, b) => {
      if (a.value === selected) return -1;
      if (b.value === selected) return 1;
      if (mode === 'name') return a.label.localeCompare(b.label);
      if (mode === 'newest') return Number(b.meta?.created || 0) - Number(a.meta?.created || 0);
      if (mode === 'price-asc') return parsePrice(a.label) - parsePrice(b.label) || a.label.localeCompare(b.label);
      if (mode === 'price-desc') return parsePrice(b.label) - parsePrice(a.label) || a.label.localeCompare(b.label);
      return a.originalIndex - b.originalIndex;
    });
    rebuilding = true;
    select.innerHTML = rows.map(entry => `<option value="${entry.value.replace(/"/g, '&quot;')}" ${entry.value === selected ? 'selected' : ''}>${optionLabel(entry)}</option>`).join('');
    rebuilding = false;
    if (count) count.textContent = `${rows.length} shown / ${entries.length}`;
  };

  const selectObserver = new MutationObserver(() => {
    if (rebuilding) return;
    syncOptions();
    apply();
  });
  selectObserver.observe(select, { childList: true, subtree: true, characterData: true });
  modal.addEventListener('remove', () => selectObserver.disconnect(), { once: true });

  [search, sort, refs, moderation].forEach(control => control.addEventListener(control === search ? 'input' : 'change', apply));
  syncOptions();
  apply();
  void getMetadata().then(map => {
    metadata = map;
    entries.forEach(entry => { entry.meta = metadata.get(entry.value) || null; });
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
