import { ROLE_LABELS, ROLE_OPTIONS, makeImageItem, staggerPositions } from './core-v2.js';
import { getImage, listImages } from './db-v2.js';
import {
  DEFAULT_STUDIO_SETTINGS,
  GENERATION_RECIPE_LIST,
  PROMPT_FIELDS,
  REFERENCE_PURPOSE_LABELS,
  REFERENCE_PURPOSES,
  STUDIO_VERSION,
  applyRecipeToDraft,
  buildGenerationPrompt,
  detectReferenceConflicts,
  ensureStudio,
  estimateGenerationCost,
  formatMoney,
  generationTree,
  getDailySpend,
  getReferenceConfig,
  inferModelCapabilities,
  makeGenerationRecord,
  makeMultiCharacterSlot,
  makePromptDraft,
  makeQueueJob,
  normalizeBlueprint,
  referencePurposeFromRole,
  recipeById,
  sanitizeFilename,
} from './studio-core-v3.js';
import {
  collectBoardReferenceItems,
  downloadGeneratedRecord,
  executeGenerationJob,
  loadOpenRouterCredits,
  loadOpenRouterModels,
} from './studio-openrouter-v3.js';
import {
  describeSlot,
  getCurrentChatScene,
  sendImageToCurrentChat,
  setImageAsChatBackground,
} from './studio-chat-v3.js';
import { injectMediaStyles, openMediaTools } from './studio-media-v3.js';
import { injectOrganizeStyles, openConflictReport, openOrganizeStudio } from './studio-organize-v3.js';
import { injectSyncStyles, openSyncSharePanel, pollPendingShares } from './studio-sync-v3.js';

const INSTALL_KEY = Symbol.for('inspiration-board-studio-v3');
const runtimes = new WeakMap();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function safeAttr(value = '') {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function formatDate(timestamp) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp)); }
  catch { return new Date(timestamp).toLocaleString(); }
}

function runtimeFor(app) {
  if (!runtimes.has(app)) {
    runtimes.set(app, {
      queueRunning: false,
      controller: null,
      queueModal: null,
      galleryModal: null,
      latestModels: [],
      latestCredits: null,
      installTimer: null,
      sharePollTimer: null,
    });
  }
  return runtimes.get(app);
}

function toast(app, message, type = 'info') {
  app.toast?.(message, type);
}

function currentStudio(app) {
  return ensureStudio(app.activeBoard());
}

function selectedImageItems(app) {
  return [...app.selectedIds].map(id => app.itemById(id)).filter(item => item?.type === 'image');
}

function basketIds(board) {
  const ids = [];
  for (const list of Object.values(board.character?.references || {})) {
    if (!Array.isArray(list)) continue;
    for (const id of list) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function blueprintReferenceItems(app) {
  const board = app.activeBoard();
  const ordered = [];
  const add = item => {
    if (item?.type === 'image' && !ordered.some(existing => existing.id === item.id)) ordered.push(item);
  };
  for (const item of selectedImageItems(app)) add(item);
  if (board.character?.mainImageId) add(app.itemById(board.character.mainImageId));
  for (const id of basketIds(board)) add(app.itemById(id));
  for (const item of board.items.filter(item => item.type === 'image')) {
    if (board.studio?.referenceConfig?.[item.id]) add(item);
  }
  return ordered;
}

function referenceDescriptor(app, item) {
  const config = getReferenceConfig(app.activeBoard(), item);
  return {
    item,
    itemId: item.id,
    imageId: item.imageId,
    name: item.name,
    purpose: config.purpose || referencePurposeFromRole(item.role),
    strength: config.strength,
    strictness: config.strictness,
    cropOnly: config.cropOnly,
    ignoreBackground: config.ignoreBackground,
    mustPreserve: config.mustPreserve,
    notes: config.notes || item.notes || '',
  };
}

function referencesForMode(app, mode = 'configured') {
  const board = app.activeBoard();
  let items;
  if (mode === 'selected') items = selectedImageItems(app);
  else if (mode === 'basket') items = basketIds(board).map(id => app.itemById(id)).filter(Boolean);
  else if (mode === 'main') items = [app.itemById(board.character?.mainImageId)].filter(Boolean);
  else if (mode === 'all') items = board.items.filter(item => item.type === 'image');
  else items = collectBoardReferenceItems(app, { mode: 'configured' });
  return items.map(item => referenceDescriptor(app, item));
}

function injectStudioStyles() {
  if (document.getElementById('ib3-studio-styles')) return;
  const style = document.createElement('style');
  style.id = 'ib3-studio-styles';
  style.textContent = `
    #st-inspiration-board{--ib3-purple:#9170ff;--ib3-purple-dark:#5d40cf;--ib3-cyan:#65d5ff;--ib3-green:#83f1ad;--ib3-gold:#f3c86c;--ib3-red:#ff7f96}
    .ib3-rail-button span{color:#c8b7ff}.ib3-rail-button.primary-studio{background:linear-gradient(145deg,#7557e7,#4d36b1)!important;color:#fff!important}.ib3-rail-button.primary-studio span{color:#fff}
    .ib3-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ib3-form-grid .wide{grid-column:1/-1}.ib3-form-grid label{display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--ib2-muted)}.ib3-form-grid input,.ib3-form-grid textarea,.ib3-form-grid select,.ib3-field input,.ib3-field textarea,.ib3-field select{width:100%;box-sizing:border-box;border:1px solid var(--ib2-line);border-radius:10px;background:#1a1a27;color:var(--ib2-text);padding:9px;font:inherit;outline:none}.ib3-form-grid input:focus,.ib3-form-grid textarea:focus,.ib3-form-grid select:focus,.ib3-field input:focus,.ib3-field textarea:focus,.ib3-field select:focus{border-color:var(--ib3-purple)}
    .ib3-tabs{display:flex;gap:5px;overflow-x:auto;padding:3px;margin-bottom:10px;border-radius:12px;background:#0f0f17}.ib3-tabs button{white-space:nowrap;min-height:36px;border:0;border-radius:9px;padding:0 12px;background:transparent;color:var(--ib2-muted)}.ib3-tabs button.active{background:#2a2542;color:#fff;box-shadow:inset 0 0 0 1px #7258cb}
    .ib3-panel{display:none}.ib3-panel.active{display:block}.ib3-section{padding:12px;border:1px solid var(--ib2-line);border-radius:15px;background:#14141f;margin-bottom:10px}.ib3-section-title{display:flex;align-items:center;gap:8px;margin-bottom:9px}.ib3-section-title b{font-size:13px}.ib3-section-title span{font-size:10px;color:var(--ib2-muted)}
    .ib3-blueprint-hero{display:grid;grid-template-columns:72px 1fr;gap:12px;padding:13px;border:1px solid #4e407b;border-radius:17px;background:radial-gradient(circle at 80% 10%,#8f6cff42,transparent 46%),linear-gradient(135deg,#171522,#101018)}.ib3-blueprint-icon{display:grid;place-items:center;width:72px;height:72px;border-radius:18px;background:linear-gradient(145deg,#9a79ff,#5739c1);font-size:34px;box-shadow:0 10px 26px #5e43cf55}.ib3-blueprint-hero div:last-child{display:flex;flex-direction:column;gap:4px}.ib3-blueprint-hero span{font-size:11px;color:var(--ib2-muted);line-height:1.4}
    .ib3-reference-editor{display:grid;gap:9px;max-height:52vh;overflow:auto}.ib3-ref-row{display:grid;grid-template-columns:64px minmax(0,1fr);gap:9px;padding:9px;border:1px solid var(--ib2-line);border-radius:13px;background:#171722}.ib3-ref-row img{width:64px;height:82px;object-fit:cover;border-radius:9px}.ib3-ref-main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.ib3-ref-main label{font-size:9px}.ib3-ref-flags{display:flex;gap:8px;flex-wrap:wrap}.ib3-ref-flags label{display:flex;flex-direction:row;align-items:center;gap:4px}.ib3-strength{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px}.ib3-strength output{min-width:36px;text-align:right;color:#cbbdff}
    .ib3-recipe-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.ib3-recipe{display:grid;grid-template-columns:34px 1fr;grid-template-rows:auto auto;gap:2px 7px;text-align:left;min-height:70px;padding:9px;border:1px solid var(--ib2-line);border-radius:13px;background:#171722;color:var(--ib2-text)}.ib3-recipe>span{grid-row:1/3;display:grid;place-items:center;font-size:24px;color:#baa7ff}.ib3-recipe small{font-size:9px;color:var(--ib2-muted);line-height:1.25}.ib3-recipe.selected{border-color:#8d6dff;background:linear-gradient(135deg,#33275d,#1b1830);box-shadow:0 0 0 2px #8d6dff22}
    .ib3-studio-layout{display:grid;grid-template-columns:minmax(250px,.8fr) minmax(340px,1.5fr);gap:10px}.ib3-studio-sidebar{max-height:70vh;overflow:auto}.ib3-prompt-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ib3-prompt-fields .wide{grid-column:1/-1}.ib3-field{display:flex;flex-direction:column;gap:4px;color:var(--ib2-muted);font-size:10px}.ib3-field textarea{min-height:70px;resize:vertical}.ib3-final-prompt{width:100%;min-height:170px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;line-height:1.45}
    .ib3-model-row{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:end}.ib3-badges{display:flex;gap:4px;flex-wrap:wrap}.ib3-badge{padding:3px 6px;border-radius:999px;border:1px solid #45445a;font-size:8px;color:#bbb8cb;background:#11111a}.ib3-badge.good{border-color:#326348;color:#91f2b1}.ib3-badge.warn{border-color:#73562f;color:#ffd08b}.ib3-cost-box{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}.ib3-cost-box div{padding:7px;border:1px solid var(--ib2-line);border-radius:10px;background:#101018}.ib3-cost-box span{display:block;font-size:8px;color:var(--ib2-muted)}.ib3-cost-box b{font-size:11px}
    .ib3-ref-groups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.ib3-ref-group{padding:8px;border:1px solid var(--ib2-line);border-radius:11px;background:#11111a;min-width:0}.ib3-ref-group>b{font-size:9px;color:#c3b5f5}.ib3-ref-chips{display:flex;gap:5px;overflow-x:auto;margin-top:6px}.ib3-ref-chip{position:relative;flex:0 0 50px;height:62px;border-radius:8px;overflow:hidden;border:1px solid #3d3c50}.ib3-ref-chip img{width:100%;height:100%;object-fit:cover}.ib3-ref-chip span{position:absolute;left:2px;right:2px;bottom:2px;padding:2px;background:#000c;border-radius:4px;font-size:7px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ib3-warning-list{display:grid;gap:5px}.ib3-warning-line{display:flex;gap:7px;align-items:flex-start;padding:6px 8px;border-radius:9px;background:#3d2915aa;border:1px solid #72522d;font-size:9px;color:#ffd18d}.ib3-warning-line.info{background:#17253aaa;border-color:#355276;color:#a9d2ff}.ib3-ok-line{padding:7px 9px;border-radius:9px;background:#17352299;border:1px solid #326a47;color:#a0ffc0;font-size:9px}
    .ib3-actions{display:flex;gap:7px;flex-wrap:wrap}.ib3-actions button{min-height:42px;padding:0 14px;border:1px solid var(--ib2-line);border-radius:11px;background:#20202e;color:var(--ib2-text)}.ib3-actions button.primary{border:0;background:linear-gradient(135deg,#9270ff,#5f41d1);color:white;font-weight:750}.ib3-actions button.accent{border-color:#397b58;background:#17452c;color:#a8ffc7}.ib3-actions button.danger{border-color:#713847;color:#ff9cad}
    .ib3-queue-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.ib3-queue-summary div{padding:8px;border:1px solid var(--ib2-line);border-radius:11px;background:#11111a}.ib3-queue-summary span{display:block;font-size:8px;color:var(--ib2-muted)}.ib3-queue-list{display:grid;gap:7px;max-height:54vh;overflow:auto;margin-top:9px}.ib3-job{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:9px;border:1px solid var(--ib2-line);border-radius:12px;background:#161621}.ib3-job-status{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#262638}.ib3-job.running{border-color:#6953ba}.ib3-job.done{border-color:#2f6946}.ib3-job.failed{border-color:#723543}.ib3-job-main{display:flex;flex-direction:column;min-width:0}.ib3-job-main b,.ib3-job-main small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ib3-job-main small{font-size:8px;color:var(--ib2-muted)}.ib3-job-actions{display:flex;gap:4px}.ib3-job-actions button{width:31px;height:30px;border:0;border-radius:8px;background:#282837;color:#fff}
    .ib3-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ib3-result-card{display:flex;flex-direction:column;gap:7px;padding:8px;border:1px solid var(--ib2-line);border-radius:14px;background:#13131d}.ib3-result-card img{width:100%;max-height:420px;object-fit:contain;border-radius:10px;background:#09090e}.ib3-result-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.ib3-result-actions button{min-height:34px;border:1px solid var(--ib2-line);border-radius:8px;background:#222230;color:#fff;font-size:9px}.ib3-result-card.favorite{border-color:#d6ad4f;box-shadow:0 0 0 2px #f3c86c22}.ib3-result-card.rejected{opacity:.45;filter:grayscale(.7)}
    .ib3-history-layout{display:grid;grid-template-columns:minmax(230px,.7fr) minmax(320px,1.3fr);gap:10px}.ib3-tree{max-height:65vh;overflow:auto;padding:8px;border:1px solid var(--ib2-line);border-radius:12px;background:#101018}.ib3-tree ul{list-style:none;margin:0;padding-left:15px;border-left:1px solid #39384a}.ib3-tree>ul{padding-left:0;border:0}.ib3-tree button{width:100%;text-align:left;padding:7px;border:0;border-radius:8px;background:transparent;color:var(--ib2-text);font-size:10px}.ib3-tree button:hover,.ib3-tree button.selected{background:#2a2542}.ib3-history-detail{min-height:300px;padding:11px;border:1px solid var(--ib2-line);border-radius:12px;background:#12121b}.ib3-history-images{display:flex;gap:7px;overflow-x:auto}.ib3-history-images img{width:110px;height:140px;object-fit:cover;border-radius:9px}.ib3-metadata{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin:9px 0}.ib3-metadata div{padding:7px;border:1px solid var(--ib2-line);border-radius:8px}.ib3-metadata span{display:block;font-size:8px;color:var(--ib2-muted)}
    .ib3-gallery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;max-height:68vh;overflow:auto}.ib3-gallery-card{position:relative;border:1px solid var(--ib2-line);border-radius:13px;overflow:hidden;background:#11111a}.ib3-gallery-card img{width:100%;aspect-ratio:3/4;object-fit:cover}.ib3-gallery-card>div{padding:7px}.ib3-gallery-card b{display:block;font-size:10px}.ib3-gallery-card small{color:var(--ib2-muted);font-size:8px}.ib3-gallery-card.favorite{border-color:#d5ad50}.ib3-gallery-card button{position:absolute;right:6px;top:6px;width:32px;height:30px;border:0;border-radius:8px;background:#09090dcc;color:white}
    .ib3-slot-list{display:grid;gap:7px}.ib3-slot{display:grid;grid-template-columns:1fr 1fr auto;gap:6px;padding:8px;border:1px solid var(--ib2-line);border-radius:10px}.ib3-slot button{width:34px;border:0;border-radius:8px;background:#3a2130;color:#ff9bad}.ib3-model-preset{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ib3-model-preset .wide{grid-column:1/-1}
    .ib3-modal-footer-note{margin-top:8px;font-size:9px;line-height:1.4;color:var(--ib2-muted)}
    @media(max-width:900px){.ib3-recipe-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ib3-studio-layout,.ib3-history-layout{grid-template-columns:1fr}.ib3-studio-sidebar{max-height:none}.ib3-ref-groups{grid-template-columns:1fr}.ib3-gallery-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:620px){.ib3-form-grid,.ib3-prompt-fields,.ib3-blueprint-hero{grid-template-columns:1fr}.ib3-blueprint-icon{display:none}.ib3-form-grid .wide,.ib3-prompt-fields .wide{grid-column:1}.ib3-ref-main{grid-template-columns:1fr}.ib3-recipe-grid,.ib3-comparison,.ib3-gallery-grid{grid-template-columns:1fr}.ib3-cost-box,.ib3-queue-summary{grid-template-columns:repeat(2,1fr)}.ib3-slot{grid-template-columns:1fr auto}.ib3-slot label:nth-child(2){grid-column:1}.ib3-model-preset{grid-template-columns:1fr}.ib3-model-preset .wide{grid-column:1}}
  `;
  document.head.appendChild(style);
}

function ensureRailButtons(app) {
  if (!app.root) return false;
  const rail = app.root.querySelector('.ib2-rail');
  if (!rail) return false;
  const spacer = rail.querySelector('.ib2-rail-spacer');
  const definitions = [
    ['ib3-blueprint', '⌘', 'Blueprint', () => openBlueprint(app)],
    ['ib3-studio', '✦', 'Studio', () => openGenerationStudio(app), 'primary-studio'],
    ['ib3-queue', '☷', 'Queue', () => openQueue(app)],
    ['ib3-gallery', '▥', 'Gallery', () => openGallery(app)],
    ['ib3-media', '✎', 'Image Lab', () => openMediaTools(app, studioApiFor(app))],
    ['ib3-organize', '⌕', 'Organize', () => openOrganizeStudio(app)],
    ['ib3-sync', '☁', 'Sync', () => openSyncSharePanel(app)],
  ];
  for (const [id, icon, label, action, extraClass] of definitions) {
    let button = rail.querySelector(`#${id}`);
    if (!button) {
      button = document.createElement('button');
      button.id = id;
      button.className = `ib3-rail-button ${extraClass || ''}`;
      button.innerHTML = `<span>${icon}</span><label>${label}</label>`;
      if (spacer) rail.insertBefore(button, spacer); else rail.appendChild(button);
    }
    button.onclick = event => { event.preventDefault(); event.stopPropagation(); void action(); };
    button.onpointerdown = event => { if (event.pointerType !== 'mouse') { event.preventDefault(); event.stopPropagation(); void action(); } };
  }
  return true;
}

async function referenceRowsHtml(app, items) {
  const rows = [];
  for (const item of items) {
    rows.push({ item, config: getReferenceConfig(app.activeBoard(), item), url: await app.imageUrl(item.imageId, true) });
  }
  return rows.map(({ item, config, url }) => `
    <article class="ib3-ref-row" data-ref-id="${item.id}">
      <img src="${url}" alt="${safeAttr(item.name)}">
      <div>
        <div class="ib3-section-title"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(ROLE_LABELS[item.role] || item.role || 'General')}</span></div>
        <div class="ib3-ref-main">
          <label>Purpose<select data-ref-purpose>${REFERENCE_PURPOSES.map(purpose => `<option value="${purpose}" ${config.purpose === purpose ? 'selected' : ''}>${REFERENCE_PURPOSE_LABELS[purpose]}</option>`).join('')}</select></label>
          <label>Strictness<select data-ref-strict><option value="loose" ${config.strictness === 'loose' ? 'selected' : ''}>Loose</option><option value="balanced" ${config.strictness === 'balanced' ? 'selected' : ''}>Balanced</option><option value="strict" ${config.strictness === 'strict' ? 'selected' : ''}>Strict</option></select></label>
          <label>Notes<input data-ref-notes value="${safeAttr(config.notes || '')}" placeholder="What must this reference control?"></label>
        </div>
        <label class="ib3-strength">Influence<input type="range" min="0" max="100" value="${config.strength}" data-ref-strength><output>${config.strength}%</output></label>
        <div class="ib3-ref-flags">
          <label><input type="checkbox" data-ref-preserve ${config.mustPreserve ? 'checked' : ''}> Must preserve</label>
          <label><input type="checkbox" data-ref-crop ${config.cropOnly ? 'checked' : ''}> Crop only</label>
          <label><input type="checkbox" data-ref-ignore-bg ${config.ignoreBackground ? 'checked' : ''}> Ignore background</label>
        </div>
      </div>
    </article>`).join('');
}

export async function openBlueprint(app) {
  const board = app.activeBoard();
  const studio = ensureStudio(board);
  const refs = blueprintReferenceItems(app);
  const modal = app.showModal('Character Blueprint', `
    <div class="ib3-blueprint-hero"><div class="ib3-blueprint-icon">⌘</div><div><b>Define what makes this character stay the same</b><span>The blueprint is automatically included in Generation Studio prompts. Reference controls decide which images own identity, outfit, style, pose, mood, or environment.</span></div></div>
    <div class="ib3-tabs"><button class="active" data-bp-tab="identity">Blueprint</button><button data-bp-tab="references">References · ${refs.length}</button><button data-bp-tab="rules">Rules & Palette</button></div>
    <section class="ib3-panel active" data-bp-panel="identity">
      <div class="ib3-form-grid">
        <label class="wide">Identity summary<textarea data-bp="identity" rows="3" placeholder="Who this character is visually, species/race, age presentation, defining silhouette…">${escapeHtml(studio.blueprint.identity)}</textarea></label>
        <label>Face<textarea data-bp="face" rows="4" placeholder="Face shape, eyes, skin, markings…">${escapeHtml(studio.blueprint.face)}</textarea></label>
        <label>Hair<textarea data-bp="hair" rows="4" placeholder="Color, length, texture, style…">${escapeHtml(studio.blueprint.hair)}</textarea></label>
        <label>Body / build<textarea data-bp="body" rows="4" placeholder="Height, build, proportions, species traits…">${escapeHtml(studio.blueprint.body)}</textarea></label>
        <label>Default outfit<textarea data-bp="outfit" rows="4" placeholder="Canonical clothing and materials…">${escapeHtml(studio.blueprint.outfit)}</textarea></label>
        <label class="wide">Signature accessories<textarea data-bp="accessories" rows="3" placeholder="Jewelry, weapons, glasses, scars, symbols…">${escapeHtml(studio.blueprint.accessories)}</textarea></label>
      </div>
    </section>
    <section class="ib3-panel" data-bp-panel="references">
      <div class="ib3-reference-editor">${refs.length ? await referenceRowsHtml(app, refs) : '<p class="ib2-muted">Select images or add them to the Character Reference Basket, then reopen Blueprint.</p>'}</div>
    </section>
    <section class="ib3-panel" data-bp-panel="rules">
      <div class="ib3-form-grid">
        <label>Canonical palette<input data-bp="palette" value="${safeAttr(studio.blueprint.palette)}" placeholder="#6c4cff, violet eyes, black hair"></label>
        <label>Canonical art style<input data-bp="artStyle" value="${safeAttr(studio.blueprint.artStyle)}" placeholder="Painterly fantasy anime, clean linework…"></label>
        <label class="wide">Must always stay the same<textarea data-bp="mustKeep" rows="4" placeholder="Violet eyes, silver crescent earrings, narrow face…">${escapeHtml(studio.blueprint.mustKeep)}</textarea></label>
        <label class="wide">Allowed to change<textarea data-bp="mayChange" rows="3">${escapeHtml(studio.blueprint.mayChange)}</textarea></label>
        <label class="wide">Always avoid<textarea data-bp="avoid" rows="3">${escapeHtml(studio.blueprint.avoid)}</textarea></label>
        <label class="wide">Private design notes<textarea data-bp="notes" rows="3">${escapeHtml(studio.blueprint.notes)}</textarea></label>
      </div>
    </section>
    <div class="ib3-actions"><button data-bp-import>Import Current Character Text</button><button data-bp-conflicts>Check Conflicts</button><button class="primary" data-bp-save>Save Blueprint</button></div>
  `, 'ib3-blueprint-modal');

  const switchTab = name => {
    modal.querySelectorAll('[data-bp-tab]').forEach(button => button.classList.toggle('active', button.dataset.bpTab === name));
    modal.querySelectorAll('[data-bp-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.bpPanel === name));
  };
  modal.querySelectorAll('[data-bp-tab]').forEach(button => button.onclick = () => switchTab(button.dataset.bpTab));
  modal.querySelectorAll('[data-ref-strength]').forEach(input => input.oninput = () => { input.nextElementSibling.textContent = `${input.value}%`; });
  modal.querySelector('[data-bp-import]').onclick = () => {
    const character = board.character || {};
    if (!modal.querySelector('[data-bp="identity"]').value.trim()) modal.querySelector('[data-bp="identity"]').value = character.description || '';
    if (!modal.querySelector('[data-bp="notes"]').value.trim()) modal.querySelector('[data-bp="notes"]').value = character.creator_notes || '';
    toast(app, 'Imported available character text. Review it before saving.', 'success');
  };
  modal.querySelector('[data-bp-conflicts]').onclick = () => openConflictReport(app);
  modal.querySelector('[data-bp-save]').onclick = () => {
    app.snapshotUndo();
    const next = {};
    modal.querySelectorAll('[data-bp]').forEach(field => { next[field.dataset.bp] = field.value; });
    studio.blueprint = normalizeBlueprint(next);
    modal.querySelectorAll('[data-ref-id]').forEach(row => {
      const item = app.itemById(row.dataset.refId);
      if (!item) return;
      studio.referenceConfig[item.id] = {
        purpose: row.querySelector('[data-ref-purpose]').value,
        strictness: row.querySelector('[data-ref-strict]').value,
        strength: Number(row.querySelector('[data-ref-strength]').value),
        notes: row.querySelector('[data-ref-notes]').value.trim(),
        mustPreserve: row.querySelector('[data-ref-preserve]').checked,
        cropOnly: row.querySelector('[data-ref-crop]').checked,
        ignoreBackground: row.querySelector('[data-ref-ignore-bg]').checked,
      };
    });
    board.updatedAt = Date.now();
    app.scheduleSave();
    modal.remove();
    toast(app, 'Character Blueprint saved.', 'success');
  };
}

function recipeGridHtml(selectedId) {
  return GENERATION_RECIPE_LIST.map(recipe => `<button class="ib3-recipe ${recipe.id === selectedId ? 'selected' : ''}" data-recipe="${recipe.id}"><span>${recipe.icon}</span><b>${escapeHtml(recipe.name)}</b><small>${escapeHtml(recipe.description)}</small></button>`).join('');
}

function promptFieldsHtml(draft) {
  const labels = {
    subject: 'Subject', pose: 'Pose', expression: 'Expression', outfit: 'Outfit', action: 'Action', location: 'Location', camera: 'Camera / Composition', lighting: 'Lighting', artStyle: 'Art Style', extra: 'Extra Instructions', negative: 'Avoid / Negative',
  };
  return PROMPT_FIELDS.map(field => {
    const wide = ['subject','extra','negative'].includes(field) ? 'wide' : '';
    const rows = ['subject','extra','negative'].includes(field) ? 3 : 2;
    return `<label class="ib3-field ${wide}">${labels[field]}<textarea rows="${rows}" data-prompt-field="${field}" placeholder="${field === 'subject' ? 'Describe what you want in plain language.' : ''}">${escapeHtml(draft[field] || '')}</textarea></label>`;
  }).join('');
}

async function referenceGroupsHtml(app, references) {
  const groups = { Identity: [], Design: [], Scene: [] };
  for (const reference of references) {
    const purpose = reference.purpose;
    const group = ['identity','face','hair','body','expression'].includes(purpose) ? 'Identity' : ['outfit','accessory','prop','style','pose'].includes(purpose) ? 'Design' : 'Scene';
    const item = reference.item || app.itemById(reference.itemId);
    if (!item) continue;
    groups[group].push({ reference, item, url: await app.imageUrl(item.imageId, true) });
  }
  return Object.entries(groups).map(([name, rows]) => `<div class="ib3-ref-group"><b>${name} · ${rows.length}</b><div class="ib3-ref-chips">${rows.length ? rows.map(row => `<div class="ib3-ref-chip"><img src="${row.url}" alt=""><span>${escapeHtml(REFERENCE_PURPOSE_LABELS[row.reference.purpose] || row.reference.purpose)}</span></div>`).join('') : '<span class="ib2-muted">None</span>'}</div></div>`).join('');
}

function capabilityBadges(model) {
  const caps = model?.capabilities || inferModelCapabilities(model?.id || model?.value || '');
  return [
    ['Image output', caps.imageOutput, true],
    ['Reference images', caps.imageInput, false],
    ['Editing', caps.editing, false],
    ['Multi-reference', caps.multiReference, false],
    ['Transparency', caps.transparency, false],
  ].map(([label, value, essential]) => `<span class="ib3-badge ${value ? 'good' : essential ? 'warn' : ''}">${value ? '✓' : '–'} ${label}</span>`).join('');
}

function modelOptions(models, selected) {
  const list = [...models];
  if (selected && !list.some(model => model.id === selected)) list.unshift({ id: selected, name: selected, capabilities: inferModelCapabilities(selected), imagePrice: null });
  return list.map(model => `<option value="${safeAttr(model.id)}" ${model.id === selected ? 'selected' : ''}>${escapeHtml(model.name || model.id)}</option>`).join('');
}

function multiSlotsHtml(app, slots) {
  const boards = app.state.boards;
  return `<div class="ib3-slot-list">${slots.map(slot => `<div class="ib3-slot" data-slot-id="${slot.id}">
    <label>Character<select data-slot-board>${boards.map(board => `<option value="${board.id}" ${board.id === slot.boardId ? 'selected' : ''}>${escapeHtml(board.character?.name || board.name)}</option>`).join('')}</select></label>
    <label>Position / action<input data-slot-position value="${safeAttr(slot.position || slot.action || '')}" placeholder="left side, holding a sword…"></label>
    <button data-slot-remove title="Remove">×</button>
  </div>`).join('')}</div><button data-slot-add>+ Add Character Slot</button>`;
}

async function openGenerationStudio(app, options = {}) {
  const board = app.activeBoard();
  const studio = ensureStudio(board);
  let draft = { ...makePromptDraft(), ...studio.promptDraft, ...(options.draft || {}) };
  if (options.recipeId) draft = applyRecipeToDraft(draft, options.recipeId, { preserveUserFields: false });
  if (options.aspectRatio) draft.aspectRatio = options.aspectRatio;
  if (options.prompt) draft.extra = options.prompt;
  if (options.parentGenerationId) draft.parentGenerationId = options.parentGenerationId;
  const runtime = runtimeFor(app);
  const modal = app.showModal('Generation Studio', `
    <div class="ib3-tabs"><button class="active" data-studio-tab="create">Create</button><button data-studio-tab="characters">Characters</button><button data-studio-tab="model">Model Preset</button><button data-studio-tab="preview">Final Prompt</button></div>
    <section class="ib3-panel active" data-studio-panel="create">
      <div class="ib3-studio-layout">
        <aside class="ib3-studio-sidebar">
          <div class="ib3-section"><div class="ib3-section-title"><b>Recipe</b><span>Choose a starting structure</span></div><div class="ib3-recipe-grid" data-recipe-grid>${recipeGridHtml(draft.recipeId)}</div></div>
          <div class="ib3-section"><div class="ib3-section-title"><b>Output</b></div><div class="ib3-form-grid">
            <label>Aspect ratio<select data-studio-aspect>${['1:1','3:4','4:3','2:3','3:2','9:16','16:9'].map(value => `<option value="${value}" ${draft.aspectRatio === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
            <label>Images<select data-studio-count>${[1,2,3,4,5,6,8].map(value => `<option value="${value}" ${Number(draft.count) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
            <label>Save results to<select data-studio-destination><option value="board" ${draft.destination === 'board' ? 'selected' : ''}>Board</option><option value="inbox" ${draft.destination === 'inbox' ? 'selected' : ''}>Inbox</option></select></label>
            <label>References<select data-studio-ref-mode><option value="configured" ${draft.referenceMode === 'configured' ? 'selected' : ''}>Configured / selected</option><option value="selected" ${draft.referenceMode === 'selected' ? 'selected' : ''}>Selected only</option><option value="basket" ${draft.referenceMode === 'basket' ? 'selected' : ''}>Reference basket</option><option value="main" ${draft.referenceMode === 'main' ? 'selected' : ''}>Main portrait</option><option value="all" ${draft.referenceMode === 'all' ? 'selected' : ''}>All board images</option></select></label>
            <label class="ib2-check wide"><input type="checkbox" data-studio-blueprint ${draft.useBlueprint !== false ? 'checked' : ''}> Include Character Blueprint</label>
            <label class="ib2-check wide"><input type="checkbox" data-studio-chat ${draft.useChatScene ? 'checked' : ''}> Include current chat scene</label>
          </div></div>
          <div class="ib3-section"><div class="ib3-section-title"><b>Model</b><span data-model-loading>Loading OpenRouter…</span></div>
            <div class="ib3-model-row"><label class="ib3-field">OpenRouter model<select data-studio-model><option value="${safeAttr(draft.model)}">${escapeHtml(draft.model)}</option></select></label><button data-model-refresh title="Refresh">↻</button></div>
            <div class="ib3-badges" data-model-badges></div>
            <div class="ib3-cost-box"><div><span>Per image</span><b data-cost-each>Unknown</b></div><div><span>Job estimate</span><b data-cost-total>Unknown</b></div><div><span>Credits left</span><b data-credit>Checking…</b></div></div>
          </div>
        </aside>
        <main>
          <div class="ib3-section"><div class="ib3-section-title"><b>Prompt Builder</b><span>Plain language works best for GPT Image, Gemini and Grok</span></div><div class="ib3-prompt-fields">${promptFieldsHtml(draft)}</div></div>
          <div class="ib3-section"><div class="ib3-section-title"><b>References</b><span data-ref-count></span></div><div class="ib3-ref-groups" data-studio-refs></div></div>
          <div class="ib3-section"><div class="ib3-section-title"><b>Checks</b></div><div class="ib3-warning-list" data-studio-warnings></div></div>
        </main>
      </div>
    </section>
    <section class="ib3-panel" data-studio-panel="characters">
      <div class="ib3-section"><div class="ib3-section-title"><b>Multi-character scene</b><span>Each slot uses another board's blueprint and main portrait</span></div><div data-studio-slots>${multiSlotsHtml(app, studio.multiCharacterSlots)}</div></div>
      <div class="ib3-section"><div class="ib3-section-title"><b>Current chat scene</b><span>Recent visible messages only</span></div><textarea class="ib3-final-prompt" data-chat-scene>${escapeHtml(options.chatScene || getCurrentChatScene())}</textarea><div class="ib3-actions"><button data-chat-refresh>Refresh from chat</button></div></div>
    </section>
    <section class="ib3-panel" data-studio-panel="model">
      <div class="ib3-section"><div class="ib3-section-title"><b>Per-model prompt preset</b><span>Saved separately for each OpenRouter model</span></div><div class="ib3-model-preset">
        <label class="ib3-field">Prompt format<select data-preset-style><option value="natural">Natural language</option><option value="structured">Structured brief</option><option value="tags">Tag list</option></select></label>
        <label class="ib3-field">Fallback price per image<input type="number" min="0" step="0.001" data-preset-price placeholder="Used only when metadata has no price"></label>
        <label class="ib3-field wide">Prompt prefix<textarea rows="3" data-preset-prefix placeholder="Optional instructions always sent before this model's prompt"></textarea></label>
        <label class="ib3-field wide">Model-specific avoid list<textarea rows="3" data-preset-negative></textarea></label>
      </div></div>
      <div class="ib3-section"><div class="ib3-section-title"><b>Spending guardrails</b></div><div class="ib3-form-grid">
        <label>Warn over<input type="number" min="0" step="0.01" value="${studio.settings.warnCost}" data-setting-warn></label>
        <label>Block one job over<input type="number" min="0" step="0.01" value="${studio.settings.hardJobLimit}" data-setting-hard></label>
        <label>Daily limit<input type="number" min="0" step="0.10" value="${studio.settings.dailyLimit}" data-setting-daily></label>
        <label class="ib2-check"><input type="checkbox" data-setting-fallback ${studio.settings.autoFallback ? 'checked' : ''}> Automatic provider fallback</label>
      </div></div>
    </section>
    <section class="ib3-panel" data-studio-panel="preview">
      <div class="ib3-section"><div class="ib3-section-title"><b>Exact final prompt</b><span>This is what will be sent to OpenRouter</span></div><textarea class="ib3-final-prompt" data-final-prompt></textarea></div>
      <div class="ib3-section"><div class="ib3-section-title"><b>Request metadata</b></div><pre class="ib3-final-prompt" data-request-json></pre></div>
    </section>
    <div class="ib3-actions"><button data-studio-blueprint-open>Blueprint</button><button data-studio-conflicts>Conflict Report</button><button data-studio-queue-open>Queue · ${studio.queue.filter(job => ['queued','running'].includes(job.status)).length}</button><button class="accent" data-studio-add-queue>Add to Queue</button><button class="primary" data-studio-generate>✦ Generate Now</button></div>
    <div class="ib3-modal-footer-note">Generation uses the OpenRouter API key stored by SillyTavern. Reference support, editing quality, price metadata, and moderation vary by model. The Studio never displays or stores your API key.</div>
  `, 'ib3-studio-modal');

  const switchTab = name => {
    modal.querySelectorAll('[data-studio-tab]').forEach(button => button.classList.toggle('active', button.dataset.studioTab === name));
    modal.querySelectorAll('[data-studio-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.studioPanel === name));
    if (name === 'preview') updatePreview();
  };
  modal.querySelectorAll('[data-studio-tab]').forEach(button => button.onclick = () => switchTab(button.dataset.studioTab));

  let models = [];
  let modelMetadata = null;
  let references = [];
  const modelSelect = modal.querySelector('[data-studio-model]');

  const readDraft = () => {
    const next = { ...draft };
    modal.querySelectorAll('[data-prompt-field]').forEach(field => { next[field.dataset.promptField] = field.value; });
    next.recipeId = modal.querySelector('[data-recipe].selected')?.dataset.recipe || next.recipeId;
    next.aspectRatio = modal.querySelector('[data-studio-aspect]').value;
    next.count = Number(modal.querySelector('[data-studio-count]').value);
    next.destination = modal.querySelector('[data-studio-destination]').value;
    next.referenceMode = modal.querySelector('[data-studio-ref-mode]').value;
    next.useBlueprint = modal.querySelector('[data-studio-blueprint]').checked;
    next.useChatScene = modal.querySelector('[data-studio-chat]').checked;
    next.model = modelSelect.value;
    next.parentGenerationId = draft.parentGenerationId || null;
    return next;
  };

  const readSlots = () => [...modal.querySelectorAll('[data-slot-id]')].map(row => makeMultiCharacterSlot({
    id: row.dataset.slotId,
    boardId: row.querySelector('[data-slot-board]').value,
    position: row.querySelector('[data-slot-position]').value,
  }));

  const modelPreset = modelId => ({ promptStyle: inferModelCapabilities(modelId, modelMetadata).promptStyle, ...(studio.modelPresets[modelId] || {}) });

  const readPreset = () => ({
    promptStyle: modal.querySelector('[data-preset-style]').value,
    prefix: modal.querySelector('[data-preset-prefix]').value,
    negative: modal.querySelector('[data-preset-negative]').value,
    fallbackPrice: Number(modal.querySelector('[data-preset-price]').value) || null,
  });

  const writePreset = modelId => {
    const preset = modelPreset(modelId);
    modal.querySelector('[data-preset-style]').value = preset.promptStyle || 'natural';
    modal.querySelector('[data-preset-prefix]').value = preset.prefix || '';
    modal.querySelector('[data-preset-negative]').value = preset.negative || '';
    modal.querySelector('[data-preset-price]').value = preset.fallbackPrice ?? '';
  };

  const updateSlotsHandlers = () => {
    modal.querySelectorAll('[data-slot-remove]').forEach(button => button.onclick = () => { button.closest('[data-slot-id]').remove(); updatePreview(); });
    modal.querySelectorAll('[data-slot-board],[data-slot-position]').forEach(control => control.oninput = updatePreview);
    modal.querySelector('[data-slot-add]').onclick = () => {
      const wrapper = modal.querySelector('[data-studio-slots]');
      const slots = readSlots();
      slots.push(makeMultiCharacterSlot({ boardId: app.state.boards[0]?.id || null }));
      wrapper.innerHTML = multiSlotsHtml(app, slots);
      updateSlotsHandlers();
    };
  };
  updateSlotsHandlers();

  const refreshReferences = async () => {
    const nextDraft = readDraft();
    references = referencesForMode(app, nextDraft.referenceMode);
    if (options.inlineReference) references.unshift({ ...options.inlineReference, item: null, itemId: null, imageId: null });
    modal.querySelector('[data-ref-count]').textContent = `${references.length} configured`;
    modal.querySelector('[data-studio-refs]').innerHTML = await referenceGroupsHtml(app, references.filter(reference => reference.item));
    updatePreview();
  };

  const updateCost = () => {
    const nextDraft = readDraft();
    modelMetadata = models.find(model => model.id === nextDraft.model) || null;
    const preset = modelPreset(nextDraft.model);
    const estimate = estimateGenerationCost({ modelMetadata, count: nextDraft.count, fallbackPrice: preset.fallbackPrice });
    modal.querySelector('[data-cost-each]').textContent = estimate.known ? formatMoney(estimate.perImage) : 'Unknown';
    modal.querySelector('[data-cost-total]').textContent = estimate.known ? formatMoney(estimate.total) : 'Unknown';
    modal.querySelector('[data-model-badges]').innerHTML = capabilityBadges(modelMetadata || { id: nextDraft.model });
    return estimate;
  };

  function updatePreview() {
    const nextDraft = readDraft();
    const slots = readSlots().map(slot => describeSlot(app, slot)).filter(Boolean);
    const chatScene = modal.querySelector('[data-chat-scene]').value;
    const preset = readPreset();
    const built = buildGenerationPrompt({
      blueprint: studio.blueprint,
      draft: nextDraft,
      recipeId: nextDraft.recipeId,
      references,
      chatScene,
      characterSlots: slots,
      modelId: nextDraft.model,
      modelPreset: preset,
    });
    modal.querySelector('[data-final-prompt]').value = built.prompt;
    const warnings = detectReferenceConflicts({ blueprint: studio.blueprint, references, draft: nextDraft });
    modal.querySelector('[data-studio-warnings]').innerHTML = warnings.length ? warnings.map(warning => `<div class="ib3-warning-line ${warning.level === 'info' ? 'info' : ''}"><span>${warning.level === 'warning' ? '!' : 'i'}</span>${escapeHtml(warning.message)}</div>`).join('') : '<div class="ib3-ok-line">✓ No obvious blueprint/reference conflicts found.</div>';
    const estimate = updateCost();
    modal.querySelector('[data-request-json]').textContent = JSON.stringify({
      model: nextDraft.model,
      recipe: nextDraft.recipeId,
      aspectRatio: nextDraft.aspectRatio,
      images: nextDraft.count,
      destination: nextDraft.destination,
      references: references.map(reference => ({ name: reference.name, purpose: reference.purpose, strength: reference.strength, strictness: reference.strictness })),
      estimatedCost: estimate.total,
      dailySpend: getDailySpend(studio),
      parentGenerationId: nextDraft.parentGenerationId,
    }, null, 2);
    return { nextDraft, slots, chatScene, built, warnings, estimate, preset };
  }

  const chooseRecipe = recipeId => {
    draft = applyRecipeToDraft(readDraft(), recipeId, { preserveUserFields: false });
    modal.querySelectorAll('[data-recipe]').forEach(button => button.classList.toggle('selected', button.dataset.recipe === recipeId));
    modal.querySelector('[data-studio-aspect]').value = draft.aspectRatio;
    for (const field of PROMPT_FIELDS) {
      const element = modal.querySelector(`[data-prompt-field="${field}"]`);
      if (element) element.value = draft[field] || '';
    }
    modal.querySelector('[data-studio-chat]').checked = Boolean(draft.useChatScene);
    updatePreview();
  };
  modal.querySelectorAll('[data-recipe]').forEach(button => button.onclick = () => chooseRecipe(button.dataset.recipe));

  modal.querySelectorAll('[data-prompt-field],[data-studio-aspect],[data-studio-count],[data-studio-destination],[data-studio-blueprint],[data-studio-chat],[data-chat-scene],[data-preset-style],[data-preset-prefix],[data-preset-negative],[data-preset-price]').forEach(control => control.addEventListener('input', updatePreview));
  modal.querySelector('[data-studio-ref-mode]').addEventListener('change', refreshReferences);
  modal.querySelector('[data-chat-refresh]').onclick = () => { modal.querySelector('[data-chat-scene]').value = getCurrentChatScene(); updatePreview(); };
  modal.querySelector('[data-studio-blueprint-open]').onclick = () => openBlueprint(app);
  modal.querySelector('[data-studio-conflicts]').onclick = () => openConflictReport(app, references, readDraft());
  modal.querySelector('[data-studio-queue-open]').onclick = () => openQueue(app);

  const loadModels = async force => {
    modal.querySelector('[data-model-loading]').textContent = 'Loading…';
    try {
      models = await loadOpenRouterModels({ force });
      runtime.latestModels = models;
      modelSelect.innerHTML = modelOptions(models, readDraft().model);
      modelSelect.value = readDraft().model;
      modal.querySelector('[data-model-loading]').textContent = `${models.length} image models`;
      writePreset(modelSelect.value);
      updatePreview();
    } catch (error) {
      modal.querySelector('[data-model-loading]').textContent = error.message;
      toast(app, error.message, 'error');
    }
  };
  modelSelect.onchange = () => { draft.model = modelSelect.value; writePreset(modelSelect.value); updatePreview(); };
  modal.querySelector('[data-model-refresh]').onclick = () => loadModels(true);
  void loadModels(false);
  void loadOpenRouterCredits().then(credits => {
    runtime.latestCredits = credits;
    modal.querySelector('[data-credit]').textContent = formatMoney(credits.remaining);
  }).catch(error => { modal.querySelector('[data-credit]').textContent = 'Unavailable'; modal.querySelector('[data-credit]').title = error.message; });

  await refreshReferences();
  writePreset(draft.model);

  const buildJob = () => {
    const preview = updatePreview();
    const nextDraft = preview.nextDraft;
    studio.modelPresets[nextDraft.model] = preview.preset;
    studio.promptDraft = { ...nextDraft };
    studio.multiCharacterSlots = readSlots();
    studio.settings.warnCost = Number(modal.querySelector('[data-setting-warn]').value) || 0;
    studio.settings.hardJobLimit = Number(modal.querySelector('[data-setting-hard]').value) || 0;
    studio.settings.dailyLimit = Number(modal.querySelector('[data-setting-daily]').value) || 0;
    studio.settings.autoFallback = modal.querySelector('[data-setting-fallback]').checked;
    const job = makeQueueJob({
      boardId: board.id,
      model: nextDraft.model,
      modelMetadata,
      recipeId: nextDraft.recipeId,
      aspectRatio: nextDraft.aspectRatio,
      count: nextDraft.count,
      promptDraft: nextDraft,
      finalPrompt: preview.built.prompt,
      negative: preview.built.negative,
      references,
      characterSlots: preview.slots,
      chatScene: preview.chatScene,
      destination: nextDraft.destination,
      parentGenerationId: nextDraft.parentGenerationId,
      estimatedCost: preview.estimate.total,
    });
    return { job, preview };
  };

  const confirmCost = preview => {
    const total = preview.estimate.total;
    if (total !== null && studio.settings.hardJobLimit > 0 && total > studio.settings.hardJobLimit) {
      toast(app, `Blocked: estimated ${formatMoney(total)} exceeds the ${formatMoney(studio.settings.hardJobLimit)} per-job limit.`, 'error');
      return false;
    }
    if (total !== null && studio.settings.dailyLimit > 0 && getDailySpend(studio) + total > studio.settings.dailyLimit) {
      toast(app, `Blocked: this job may exceed the ${formatMoney(studio.settings.dailyLimit)} daily limit.`, 'error');
      return false;
    }
    if (total !== null && studio.settings.warnCost > 0 && total > studio.settings.warnCost) {
      return confirm(`This job is estimated to cost up to ${formatMoney(total)}. Continue?`);
    }
    return true;
  };

  modal.querySelector('[data-studio-add-queue]').onclick = () => {
    const { job, preview } = buildJob();
    if (!confirmCost(preview)) return;
    studio.queue.push(job);
    app.scheduleSave();
    modal.querySelector('[data-studio-queue-open]').textContent = `Queue · ${studio.queue.filter(entry => ['queued','running'].includes(entry.status)).length}`;
    toast(app, 'Generation job added to the queue.', 'success');
  };
  modal.querySelector('[data-studio-generate]').onclick = async () => {
    const { job, preview } = buildJob();
    if (!confirmCost(preview)) return;
    studio.queue.unshift(job);
    app.scheduleSave();
    modal.remove();
    await runQueue(app, { focusJobId: job.id, showComparison: true });
  };
}

function queueStatusIcon(status) {
  return ({ queued: '○', running: '◌', done: '✓', failed: '!', cancelled: '×', paused: 'Ⅱ' })[status] || '○';
}

async function runQueue(app, { focusJobId = null, showComparison = false } = {}) {
  const runtime = runtimeFor(app);
  const studio = currentStudio(app);
  if (runtime.queueRunning) return;
  studio.queueState.paused = false;
  runtime.queueRunning = true;
  try {
    while (!studio.queueState.paused) {
      const job = studio.queue.find(entry => entry.status === 'queued' && (!focusJobId || entry.id === focusJobId))
        || studio.queue.find(entry => entry.status === 'queued');
      if (!job) break;
      if (job.boardId !== app.activeBoard().id) {
        job.status = 'paused';
        job.error = 'Open this job’s board to continue.';
        continue;
      }
      job.status = 'running';
      job.startedAt = Date.now();
      job.updatedAt = Date.now();
      job.attempt += 1;
      studio.queueState.runningJobId = job.id;
      runtime.controller = new AbortController();
      app.scheduleSave();
      refreshQueueModal(app);
      try {
        const modelMetadata = runtime.latestModels.find(model => model.id === job.model) || job.modelMetadata;
        const result = await executeGenerationJob(app, job, {
          signal: runtime.controller.signal,
          modelMetadata,
          onProgress: progress => {
            job.progress = progress.message || progress.attempt?.reason || 'Working…';
            job.updatedAt = Date.now();
            refreshQueueModal(app);
          },
        });
        job.status = 'done';
        job.completedAt = Date.now();
        job.updatedAt = Date.now();
        job.resultImageIds = result.imageIds;
        job.fallbackLog = result.fallbackLog;
        job.actualCost = result.estimatedCost;
        const generation = makeGenerationRecord(job, {
          resultImageIds: result.imageIds,
          actualCost: result.estimatedCost,
          itemIds: result.itemIds,
        });
        studio.generations.unshift(generation);
        if (studio.generations.length > studio.settings.keepGenerationHistory) studio.generations.length = studio.settings.keepGenerationHistory;
        studio.gallery.unshift(...result.imageIds.map(imageId => ({ imageId, generationId: generation.id, favorite: false, rejected: false, createdAt: Date.now() })));
        app.scheduleSave();
        await app.renderItems?.();
        await app.renderInboxButton?.();
        refreshQueueModal(app);
        if (showComparison || focusJobId === job.id) await openComparison(app, generation);
      } catch (error) {
        job.status = error?.name === 'AbortError' ? 'cancelled' : 'failed';
        job.error = error.message || String(error);
        job.fallbackLog = error.fallbackLog || job.fallbackLog || [];
        job.updatedAt = Date.now();
        app.scheduleSave();
        refreshQueueModal(app);
        if (job.status === 'failed') toast(app, job.error, 'error');
      } finally {
        runtime.controller = null;
        studio.queueState.runningJobId = null;
      }
      focusJobId = null;
    }
  } finally {
    runtime.queueRunning = false;
    studio.queueState.runningJobId = null;
    app.scheduleSave();
    refreshQueueModal(app);
  }
}

function queueModalContent(app) {
  const studio = currentStudio(app);
  const jobs = [...studio.queue].sort((a, b) => b.createdAt - a.createdAt);
  return `
    <div class="ib3-queue-summary"><div><span>Queued</span><b>${jobs.filter(job => job.status === 'queued').length}</b></div><div><span>Running</span><b>${jobs.filter(job => job.status === 'running').length}</b></div><div><span>Finished</span><b>${jobs.filter(job => job.status === 'done').length}</b></div><div><span>Spent today</span><b>${formatMoney(getDailySpend(studio))}</b></div></div>
    <div class="ib3-actions"><button data-queue-run>▶ Run Queue</button><button data-queue-pause>${studio.queueState.paused ? '▶ Resume' : 'Ⅱ Pause'}</button><button data-queue-cancel>■ Cancel Current</button><button data-queue-clear>Clear Finished</button></div>
    <div class="ib3-queue-list">${jobs.length ? jobs.map(job => `<article class="ib3-job ${job.status}" data-job-id="${job.id}"><div class="ib3-job-status">${queueStatusIcon(job.status)}</div><div class="ib3-job-main"><b>${escapeHtml(recipeById(job.recipeId).name)} · ${escapeHtml(job.model.split('/').pop())}</b><small>${job.status}${job.progress ? ` · ${escapeHtml(job.progress)}` : ''}${job.error ? ` · ${escapeHtml(job.error)}` : ''} · ${job.count} image(s) · ${job.estimatedCost === null ? 'cost unknown' : formatMoney(job.estimatedCost)}</small></div><div class="ib3-job-actions">${job.status === 'failed' || job.status === 'cancelled' || job.status === 'paused' ? '<button data-job-retry title="Retry">↻</button>' : ''}${job.status === 'done' ? '<button data-job-view title="View">◉</button>' : ''}<button data-job-remove title="Remove">×</button></div></article>`).join('') : '<p class="ib2-muted">The queue is empty.</p>'}</div>`;
}

function bindQueueModal(app, modal) {
  const studio = currentStudio(app);
  modal.querySelector('[data-queue-run]').onclick = () => runQueue(app);
  modal.querySelector('[data-queue-pause]').onclick = () => {
    studio.queueState.paused = !studio.queueState.paused;
    if (!studio.queueState.paused) void runQueue(app);
    app.scheduleSave(); refreshQueueModal(app);
  };
  modal.querySelector('[data-queue-cancel]').onclick = () => runtimeFor(app).controller?.abort();
  modal.querySelector('[data-queue-clear]').onclick = () => {
    studio.queue = studio.queue.filter(job => !['done','cancelled'].includes(job.status));
    app.scheduleSave(); refreshQueueModal(app);
  };
  modal.querySelectorAll('[data-job-id]').forEach(row => {
    const job = studio.queue.find(entry => entry.id === row.dataset.jobId);
    row.querySelector('[data-job-retry]')?.addEventListener('click', () => { job.status = 'queued'; job.error = null; job.progress = ''; app.scheduleSave(); refreshQueueModal(app); });
    row.querySelector('[data-job-view]')?.addEventListener('click', () => {
      const generation = studio.generations.find(record => record.jobId === job.id);
      if (generation) openComparison(app, generation);
    });
    row.querySelector('[data-job-remove]')?.addEventListener('click', () => { studio.queue = studio.queue.filter(entry => entry.id !== job.id); app.scheduleSave(); refreshQueueModal(app); });
  });
}

function refreshQueueModal(app) {
  const runtime = runtimeFor(app);
  const modal = runtime.queueModal;
  if (!modal?.isConnected) return;
  const body = modal.querySelector('[data-queue-body]');
  if (!body) return;
  body.innerHTML = queueModalContent(app);
  bindQueueModal(app, modal);
}

export function openQueue(app) {
  const runtime = runtimeFor(app);
  const modal = app.showModal('Generation Queue', `<div data-queue-body>${queueModalContent(app)}</div>`, 'ib3-queue-modal');
  runtime.queueModal = modal;
  bindQueueModal(app, modal);
  const observer = new MutationObserver(() => { if (!modal.isConnected) { runtime.queueModal = null; observer.disconnect(); } });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function moveImageToBoard(app, imageId, generation) {
  if (app.activeBoard().items.some(item => item.imageId === imageId)) return app.activeBoard().items.find(item => item.imageId === imageId);
  const record = await getImage(imageId);
  if (!record) throw new Error('Generated image is missing.');
  const ratio = record.width / Math.max(1, record.height);
  const width = ratio >= 1 ? 380 : 300;
  const height = Math.max(190, Math.min(540, width / Math.max(ratio, 0.05)));
  const center = app.canvasCenterWorld();
  const position = staggerPositions(1, center.x, center.y, width, height)[0];
  const item = makeImageItem({ imageId, name: `Generated · ${generation.model.split('/').pop()}`, width, height, x: position.x, y: position.y, sourceUrl: `openrouter:${generation.model}` });
  item.tags = ['generated', 'openrouter', generation.recipeId];
  item.notes = generation.prompt;
  item.generated = { generationId: generation.id, model: generation.model, prompt: generation.prompt };
  app.activeBoard().items.push(item);
  app.scheduleSave();
  await app.renderItems?.();
  return item;
}

async function openComparison(app, generation) {
  const studio = currentStudio(app);
  const rows = [];
  for (const imageId of generation.resultImageIds || []) {
    const record = await getImage(imageId);
    if (!record) continue;
    rows.push({ imageId, record, url: await app.imageUrl(imageId, false), gallery: studio.gallery.find(entry => entry.imageId === imageId) });
  }
  if (!rows.length) return toast(app, 'The generation history exists, but its image files are missing.', 'warning');
  const modal = app.showModal(`Compare Results · ${recipeById(generation.recipeId).name}`, `
    <div class="ib3-comparison">${rows.map((row, index) => `<article class="ib3-result-card ${row.gallery?.favorite ? 'favorite' : ''} ${row.gallery?.rejected ? 'rejected' : ''}" data-result-id="${row.imageId}"><img src="${row.url}" alt="Generated result ${index + 1}"><div class="ib3-result-actions"><button data-result-action="favorite">★ Favorite</button><button data-result-action="reject">× Reject</button><button data-result-action="board">+ Board</button><button data-result-action="main">Main Portrait</button><button data-result-action="reference">Use as Ref</button><button data-result-action="variation">Variation</button><button data-result-action="edit">Edit Prompt</button><button data-result-action="download">Download</button><button data-result-action="chat">Send to Chat</button><button data-result-action="background">Chat BG</button><button data-result-action="creator">Creator</button><button data-result-action="lab">Image Lab</button></div></article>`).join('')}</div>
    <div class="ib3-metadata"><div><span>Model</span><b>${escapeHtml(generation.model)}</b></div><div><span>Created</span><b>${formatDate(generation.createdAt)}</b></div><div><span>Aspect</span><b>${generation.aspectRatio}</b></div><div><span>Cost</span><b>${generation.actualCost === null ? 'Unknown' : formatMoney(generation.actualCost)}</b></div></div>
    <details><summary>Prompt and fallbacks</summary><textarea class="ib3-final-prompt" readonly>${escapeHtml(generation.prompt)}</textarea>${generation.fallbackLog?.length ? `<pre>${escapeHtml(generation.fallbackLog.join('\n'))}</pre>` : ''}</details>
  `, 'ib3-comparison-modal');
  modal.querySelectorAll('[data-result-id]').forEach(card => {
    const imageId = card.dataset.resultId;
    const gallery = studio.gallery.find(entry => entry.imageId === imageId) || { imageId, generationId: generation.id, favorite: false, rejected: false, createdAt: Date.now() };
    if (!studio.gallery.some(entry => entry.imageId === imageId)) studio.gallery.push(gallery);
    const action = async name => {
      if (name === 'favorite') { gallery.favorite = !gallery.favorite; card.classList.toggle('favorite', gallery.favorite); }
      else if (name === 'reject') { gallery.rejected = !gallery.rejected; card.classList.toggle('rejected', gallery.rejected); }
      else if (name === 'board') await moveImageToBoard(app, imageId, generation);
      else if (name === 'main') { const item = await moveImageToBoard(app, imageId, generation); app.activeBoard().character.mainImageId = item.id; }
      else if (name === 'reference') { const item = await moveImageToBoard(app, imageId, generation); const refs = app.activeBoard().character.references.identity || (app.activeBoard().character.references.identity = []); if (!refs.includes(item.id)) refs.push(item.id); ensureStudio(app.activeBoard()).referenceConfig[item.id] = { purpose: 'identity', strength: 90, strictness: 'strict', cropOnly: false, ignoreBackground: true, mustPreserve: true, notes: 'Generated identity reference.' }; }
      else if (name === 'variation') await openGenerationStudio(app, { draft: { ...generationToDraft(generation), parentGenerationId: generation.id } });
      else if (name === 'edit') await openGenerationStudio(app, { draft: generationToDraft(generation) });
      else if (name === 'download') downloadGeneratedRecord(await getImage(imageId), `${sanitizeFilename(app.activeBoard().name)}-${generation.recipeId}.png`);
      else if (name === 'chat') await sendImageToCurrentChat(imageId, { title: recipeById(generation.recipeId).name, messageText: `[Generated image: ${recipeById(generation.recipeId).name}]` });
      else if (name === 'background') await setImageAsChatBackground(imageId);
      else if (name === 'creator') {
        await moveResultToBoard(app, imageId);
        const boardItem = app.activeBoard().items.find(item => item.type === 'image' && item.imageId === imageId);
        if (boardItem) app.activeBoard().character.mainImageId = boardItem.id;
        app.drawerOpen = true;
        app.renderDrawer?.();
        app.scheduleSave();
        toast(app, 'Set as the board main portrait. Use Send to Character Creator in the References drawer.', 'success');
      }
      else if (name === 'lab') { const item = await moveImageToBoard(app, imageId, generation); app.selectedIds = new Set([item.id]); await openMediaTools(app, studioApiFor(app)); }
      app.scheduleSave();
      app.renderDrawer?.();
    };
    card.querySelectorAll('[data-result-action]').forEach(button => button.onclick = () => action(button.dataset.resultAction).catch(error => toast(app, error.message, 'error')));
  });
}

function generationToDraft(generation) {
  return {
    ...makePromptDraft(),
    recipeId: generation.recipeId,
    model: generation.model,
    aspectRatio: generation.aspectRatio,
    extra: generation.notes || '',
    parentGenerationId: generation.parentId || generation.id,
  };
}

function treeHtml(nodes) {
  if (!nodes.length) return '<p class="ib2-muted">No generations yet.</p>';
  return `<ul>${nodes.map(node => `<li><button data-generation-id="${node.id}">${escapeHtml(recipeById(node.recipeId).name)} · ${formatDate(node.createdAt)}</button>${node.children?.length ? treeHtml(node.children) : ''}</li>`).join('')}</ul>`;
}

async function renderHistoryDetail(app, container, generation) {
  if (!generation) { container.innerHTML = '<p class="ib2-muted">Select a generation from the tree.</p>'; return; }
  const images = [];
  for (const id of generation.resultImageIds || []) {
    const record = await getImage(id);
    if (record) images.push({ id, url: await app.imageUrl(id, true) });
  }
  container.innerHTML = `
    <div class="ib3-section-title"><b>${escapeHtml(recipeById(generation.recipeId).name)}</b><span>${formatDate(generation.createdAt)}</span></div>
    <div class="ib3-history-images">${images.map(image => `<img src="${image.url}" data-history-image="${image.id}" alt="">`).join('')}</div>
    <div class="ib3-metadata"><div><span>Model</span><b>${escapeHtml(generation.model)}</b></div><div><span>Aspect</span><b>${generation.aspectRatio}</b></div><div><span>References</span><b>${generation.referenceSummary?.length || 0}</b></div><div><span>Cost</span><b>${generation.actualCost === null ? 'Unknown' : formatMoney(generation.actualCost)}</b></div></div>
    <textarea class="ib3-final-prompt" readonly>${escapeHtml(generation.prompt)}</textarea>
    <div class="ib3-actions"><button data-history-compare>Compare</button><button data-history-variation>Branch Variation</button><button data-history-regenerate>Regenerate</button></div>`;
  container.querySelector('[data-history-compare]').onclick = () => openComparison(app, generation);
  container.querySelector('[data-history-variation]').onclick = () => openGenerationStudio(app, { draft: { ...generationToDraft(generation), parentGenerationId: generation.id } });
  container.querySelector('[data-history-regenerate]').onclick = () => openGenerationStudio(app, { draft: generationToDraft(generation) });
  container.querySelectorAll('[data-history-image]').forEach(image => image.onclick = () => openComparison(app, generation));
}

export function openHistory(app) {
  const studio = currentStudio(app);
  const records = studio.generations;
  const modal = app.showModal('Generation History & Branches', `<div class="ib3-history-layout"><div class="ib3-tree">${treeHtml(generationTree(records))}</div><div class="ib3-history-detail" data-history-detail></div></div><div class="ib3-actions"><button data-history-clear class="danger">Clear History Metadata</button></div>`, 'ib3-history-modal');
  const detail = modal.querySelector('[data-history-detail]');
  modal.querySelectorAll('[data-generation-id]').forEach(button => button.onclick = () => {
    modal.querySelectorAll('[data-generation-id]').forEach(candidate => candidate.classList.toggle('selected', candidate === button));
    renderHistoryDetail(app, detail, records.find(record => record.id === button.dataset.generationId));
  });
  if (records[0]) { const first = modal.querySelector(`[data-generation-id="${records[0].id}"]`) || modal.querySelector('[data-generation-id]'); first?.click(); }
  modal.querySelector('[data-history-clear]').onclick = () => {
    if (!confirm('Clear generation history metadata? Generated image files and board items will remain.')) return;
    studio.generations = []; studio.gallery = []; app.scheduleSave(); modal.remove();
  };
}

export async function openGallery(app) {
  const studio = currentStudio(app);
  const entries = studio.gallery.filter(entry => !entry.rejected);
  const cards = [];
  for (const entry of entries) {
    const record = await getImage(entry.imageId);
    if (!record) continue;
    const generation = studio.generations.find(item => item.id === entry.generationId);
    cards.push({ entry, record, generation, url: await app.imageUrl(entry.imageId, true) });
  }
  const modal = app.showModal('Character Gallery', `<div class="ib3-actions"><button data-gallery-history>Generation Tree</button><button data-gallery-favorites>Show Favorites</button><button data-gallery-all>Show All</button></div><div class="ib3-gallery-grid" data-gallery-grid>${cards.length ? cards.map(card => `<article class="ib3-gallery-card ${card.entry.favorite ? 'favorite' : ''}" data-gallery-id="${card.entry.imageId}" data-favorite="${card.entry.favorite}"><img src="${card.url}" alt=""><button title="Open">⋮</button><div><b>${escapeHtml(card.generation ? recipeById(card.generation.recipeId).name : card.record.name)}</b><small>${card.generation ? escapeHtml(card.generation.model.split('/').pop()) : ''} · ${formatDate(card.entry.createdAt)}</small></div></article>`).join('') : '<p class="ib2-muted">No generated images yet.</p>'}</div>`, 'ib3-gallery-modal');
  const grid = modal.querySelector('[data-gallery-grid]');
  const applyFilter = favoritesOnly => grid.querySelectorAll('[data-gallery-id]').forEach(card => { card.style.display = favoritesOnly && card.dataset.favorite !== 'true' ? 'none' : ''; });
  modal.querySelector('[data-gallery-history]').onclick = () => openHistory(app);
  modal.querySelector('[data-gallery-favorites]').onclick = () => applyFilter(true);
  modal.querySelector('[data-gallery-all]').onclick = () => applyFilter(false);
  modal.querySelectorAll('[data-gallery-id]').forEach(card => card.onclick = () => {
    const entry = studio.gallery.find(item => item.imageId === card.dataset.galleryId);
    const generation = studio.generations.find(item => item.id === entry?.generationId);
    if (generation) openComparison(app, generation);
  });
}

function studioApiFor(app) {
  return {
    openStudio: options => openGenerationStudio(app, options),
    openInlineEditJob: async ({ recipeId, aspectRatio, prompt, inlineReference }) => {
      await openGenerationStudio(app, {
        recipeId,
        aspectRatio,
        prompt,
        draft: {
          recipeId,
          aspectRatio: aspectRatio || recipeById(recipeId).aspectRatio,
          extra: prompt,
          referenceMode: 'selected',
          useBlueprint: true,
        },
        inlineReference,
      });
    },
    runQueue: options => runQueue(app, options),
    openComparison: generation => openComparison(app, generation),
  };
}

function installSettingsPanelEnhancements() {
  const panel = document.querySelector('#inspiration_board_settings .inline-drawer-content');
  if (!panel || panel.querySelector('[data-ib3-shortcuts]')) return;
  const block = document.createElement('div');
  block.dataset.ib3Shortcuts = '';
  block.className = 'ib-v2-settings-actions';
  block.innerHTML = `<button type="button" class="menu_button interactable" data-ib3-open="studio">✦ Generation Studio</button><button type="button" class="menu_button interactable" data-ib3-open="blueprint">⌘ Blueprint</button><button type="button" class="menu_button interactable" data-ib3-open="gallery">▥ Gallery</button>`;
  panel.querySelector('.ib-v2-settings-actions')?.after(block);
  block.querySelector('[data-ib3-open="studio"]').onclick = () => globalThis.InspirationBoard?.app && openGenerationStudio(globalThis.InspirationBoard.app);
  block.querySelector('[data-ib3-open="blueprint"]').onclick = () => globalThis.InspirationBoard?.app && openBlueprint(globalThis.InspirationBoard.app);
  block.querySelector('[data-ib3-open="gallery"]').onclick = () => globalThis.InspirationBoard?.app && openGallery(globalThis.InspirationBoard.app);
}

export function installGenerationStudio(app) {
  if (!app) return false;
  injectStudioStyles();
  injectMediaStyles();
  injectOrganizeStyles();
  injectSyncStyles();
  const runtime = runtimeFor(app);
  ensureStudio(app.activeBoard());
  ensureRailButtons(app);
  installSettingsPanelEnhancements();
  if (!app[INSTALL_KEY]) {
    app[INSTALL_KEY] = true;
    app.openBlueprintStudio = () => openBlueprint(app);
    app.openGenerationStudio = options => openGenerationStudio(app, options);
    app.openGenerationQueue = () => openQueue(app);
    app.openGenerationHistory = () => openHistory(app);
    app.openCharacterGallery = () => openGallery(app);
    app.openOrganizeStudio = () => openOrganizeStudio(app);
    app.openSyncSharePanel = () => openSyncSharePanel(app);
    app.openImageLab = () => openMediaTools(app, studioApiFor(app));
    app.studioV3 = studioApiFor(app);
  }
  clearInterval(runtime.installTimer);
  runtime.installTimer = setInterval(() => {
    if (!app.root?.isConnected) return;
    ensureStudio(app.activeBoard());
    ensureRailButtons(app);
    installSettingsPanelEnhancements();
  }, 900);
  if (!runtime.sharePollTimer) {
    runtime.sharePollTimer = setInterval(() => { if (app.isOpen) void pollPendingShares(app); }, 5 * 60_000);
    setTimeout(() => void pollPendingShares(app), 2500);
  }
  return true;
}

export const GenerationStudio = Object.freeze({
  version: STUDIO_VERSION,
  install: installGenerationStudio,
  openBlueprint,
  openGenerationStudio,
  openQueue,
  openHistory,
  openGallery,
});
