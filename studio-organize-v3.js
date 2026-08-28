import { FRAME_COLORS, ROLE_LABELS, hammingDistanceHex, makeFrameItem, staggerPositions } from './core-v2.js';
import { blobToDataUrl, getImage, listImages } from './db-v2.js';
import {
  detectReferenceConflicts,
  dominantTags,
  ensureStudio,
  getReferenceConfig,
  groupForSmartCluster,
  parseCaptionTags,
  textSearchScore,
} from './studio-core-v3.js';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

async function getCaptionHelper() {
  try {
    const module = await import('../../shared.js');
    if (typeof module.getMultimodalCaption === 'function') return module.getMultimodalCaption;
  } catch (error) {
    console.error('[Inspiration Board] caption helper import failed', error);
  }
  throw new Error('Enable and configure SillyTavern Image Captioning before using automatic tags.');
}

function cleanJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

async function analyzeItem(item, captioner) {
  const record = await getImage(item.imageId);
  if (!record?.blob) throw new Error(`Missing image: ${item.name}`);
  const dataUrl = await blobToDataUrl(record.thumbnail || record.blob);
  const prompt = `Analyze this fictional character or art reference for organization. Return ONLY valid JSON with this shape: {"summary":"one concise sentence","tags":["short visual tags"],"role":"face|hair|body|outfit|expression|accessory|prop|mood|environment|general","palette":["#RRGGBB"]}. Use only visible details. Include useful tags for hair color/style, eye color, clothing, expression, pose, art style, lighting, environment, and color palette when visible. Do not identify real people or infer sensitive traits. Maximum 24 tags and 6 palette colors.`;
  const result = await captioner(dataUrl, prompt);
  try {
    const parsed = JSON.parse(cleanJson(result));
    return {
      item,
      summary: String(parsed.summary || '').trim(),
      tags: parseCaptionTags(parsed.tags || [], 24),
      role: ['face','hair','body','outfit','expression','accessory','prop','mood','environment','general'].includes(parsed.role) ? parsed.role : item.role,
      palette: Array.isArray(parsed.palette) ? parsed.palette.map(String).filter(color => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 6) : [],
    };
  } catch {
    return { item, summary: String(result || '').trim(), tags: parseCaptionTags(result, 24), role: item.role, palette: [] };
  }
}

export async function autoTagSelected(app) {
  const items = [...app.selectedIds].map(id => app.itemById(id)).filter(item => item?.type === 'image');
  if (!items.length) return app.toast('Select one or more images to analyze.', 'warning');
  const captioner = await getCaptionHelper();
  const progress = app.showProgressModal('Analyzing references', `Preparing ${items.length} image${items.length === 1 ? '' : 's'}…`);
  const analyses = [];
  try {
    for (let index = 0; index < items.length; index++) {
      progress.update(`Analyzing ${index + 1} of ${items.length}: ${items[index].name}`);
      try { analyses.push(await analyzeItem(items[index], captioner)); }
      catch (error) { console.error(error); analyses.push({ item: items[index], error: error.message, tags: [], palette: [], role: items[index].role, summary: '' }); }
    }
  } finally { progress.close(); }

  const modal = app.showModal('Review automatic tags', `
    <p class="ib2-muted">Nothing is applied until you confirm it. Edit any tags or role guesses first.</p>
    <div class="ib3-tag-review">${analyses.map((analysis, index) => `
      <article data-tag-row="${index}">
        <label class="ib2-check"><input type="checkbox" data-tag-use checked> Apply to <b>${escapeHtml(analysis.item.name)}</b></label>
        ${analysis.error ? `<div class="ib3-warning">${escapeHtml(analysis.error)}</div>` : ''}
        <label>Suggested role<select data-tag-role>${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}" ${analysis.role === role ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Tags<input data-tag-values value="${escapeHtml(analysis.tags.join(', '))}"></label>
        <label>Visual notes<textarea data-tag-summary rows="3">${escapeHtml(analysis.summary)}</textarea></label>
        ${analysis.palette.length ? `<div class="ib3-palette">${analysis.palette.map(color => `<span style="--swatch:${color}" title="${color}">${color}</span>`).join('')}</div>` : ''}
      </article>`).join('')}</div>
    <label class="ib2-check"><input type="checkbox" data-tag-blueprint-palette checked> Add suggested colors to the Character Blueprint palette</label>
    <div class="ib2-modal-actions"><button data-tag-cancel>Cancel</button><button class="primary" data-tag-apply>Apply Reviewed Tags</button></div>
  `, 'ib3-tag-modal');
  modal.querySelector('[data-tag-cancel]').onclick = () => modal.remove();
  modal.querySelector('[data-tag-apply]').onclick = () => {
    app.snapshotUndo();
    const studio = ensureStudio(app.activeBoard());
    const palette = new Set(studio.blueprint.palette.split(/[\s,;]+/).filter(Boolean));
    analyses.forEach((analysis, index) => {
      const row = modal.querySelector(`[data-tag-row="${index}"]`);
      if (!row.querySelector('[data-tag-use]').checked) return;
      const item = analysis.item;
      const tags = row.querySelector('[data-tag-values]').value.split(/[,;\n]+/).map(value => value.trim().toLowerCase()).filter(Boolean);
      item.tags = [...new Set([...(item.tags || []), ...tags])].slice(0, 60);
      item.role = row.querySelector('[data-tag-role]').value;
      const summary = row.querySelector('[data-tag-summary]').value.trim();
      if (summary) item.notes = [item.notes, summary].filter(Boolean).join('\n\n');
      const config = getReferenceConfig(app.activeBoard(), item);
      if (config.purpose === 'identity' && item.role !== 'general') config.purpose = item.role;
      if (modal.querySelector('[data-tag-blueprint-palette]').checked) analysis.palette.forEach(color => palette.add(color));
    });
    studio.blueprint.palette = [...palette].join(', ');
    app.scheduleSave();
    app.renderItems?.();
    modal.remove();
    app.toast('Reviewed tags applied.', 'success');
  };
}

async function averageColor(record) {
  const blob = record.thumbnail || record.blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 24, 24);
    const data = context.getImageData(0, 0, 24, 24).data;
    let r = 0; let g = 0; let b = 0; let count = 0;
    for (let index = 0; index < data.length; index += 16) {
      if (data[index + 3] < 20) continue;
      r += data[index]; g += data[index + 1]; b += data[index + 2]; count++;
    }
    return count ? [r / count, g / count, b / count] : [0, 0, 0];
  } finally { bitmap.close?.(); }
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export async function smartClusterBoard(app, { method = 'role' } = {}) {
  const board = app.activeBoard();
  const images = board.items.filter(item => item.type === 'image' && !item.locked);
  if (!images.length) return app.toast('Add some images to the board first.', 'warning');
  await app.createPersistentSnapshot?.('Before smart clustering', true);
  app.snapshotUndo();
  const groups = new Map();

  if (method === 'visual') {
    const records = new Map((await listImages()).map(record => [record.id, record]));
    const unassigned = new Set(images.map(item => item.id));
    while (unassigned.size) {
      const seedId = unassigned.values().next().value;
      unassigned.delete(seedId);
      const seed = app.itemById(seedId);
      const record = records.get(seed.imageId);
      const cluster = [seed];
      if (record?.dhash) {
        for (const candidateId of [...unassigned]) {
          const candidate = app.itemById(candidateId);
          const candidateRecord = records.get(candidate.imageId);
          if (candidateRecord?.dhash && hammingDistanceHex(record.dhash, candidateRecord.dhash) <= 12) {
            cluster.push(candidate); unassigned.delete(candidateId);
          }
        }
      }
      groups.set(`Visual Set ${groups.size + 1}`, cluster);
    }
  } else if (method === 'color') {
    const records = new Map((await listImages()).map(record => [record.id, record]));
    const colorClusters = [];
    for (const item of images) {
      const record = records.get(item.imageId);
      if (!record) continue;
      const color = await averageColor(record);
      let cluster = colorClusters.find(entry => colorDistance(entry.color, color) < 74);
      if (!cluster) { cluster = { color, items: [], name: `Palette ${colorClusters.length + 1}` }; colorClusters.push(cluster); }
      cluster.items.push(item);
      const n = cluster.items.length;
      cluster.color = cluster.color.map((value, index) => ((value * (n - 1)) + color[index]) / n);
    }
    colorClusters.forEach(cluster => groups.set(cluster.name, cluster.items));
  } else {
    for (const item of images) {
      const key = groupForSmartCluster(item);
      const list = groups.get(key) || [];
      list.push(item); groups.set(key, list);
    }
  }

  const startX = Math.min(...images.map(item => item.x));
  const startY = Math.min(...images.map(item => item.y));
  let cursorX = startX;
  let cursorY = startY;
  let rowHeight = 0;
  const viewportLimit = startX + 2600;
  let colorIndex = 0;
  for (const [name, members] of groups) {
    if (!members.length) continue;
    const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
    const cardWidth = 220;
    const cardHeight = 300;
    const frameWidth = Math.max(520, cols * (cardWidth + 24) + 40);
    const rows = Math.ceil(members.length / cols);
    const frameHeight = Math.max(460, rows * (cardHeight + 24) + 90);
    if (cursorX + frameWidth > viewportLimit) { cursorX = startX; cursorY += rowHeight + 80; rowHeight = 0; }
    const label = ROLE_LABELS[name] || name.replace(/\b\w/g, letter => letter.toUpperCase());
    const frame = makeFrameItem({ title: label, x: cursorX, y: cursorY, width: frameWidth, height: frameHeight, color: FRAME_COLORS[colorIndex++ % FRAME_COLORS.length] });
    board.items.push(frame);
    members.forEach((item, index) => {
      item.x = frame.x + 24 + (index % cols) * (cardWidth + 24);
      item.y = frame.y + 68 + Math.floor(index / cols) * (cardHeight + 24);
      item.width = cardWidth;
      item.height = cardHeight;
      item.frameId = frame.id;
    });
    cursorX += frameWidth + 80;
    rowHeight = Math.max(rowHeight, frameHeight);
  }
  board.updatedAt = Date.now();
  app.scheduleSave();
  await app.renderItems?.();
  setTimeout(() => app.fitBoard?.(), 70);
  app.toast(`${groups.size} smart group${groups.size === 1 ? '' : 's'} created.`, 'success');
}

export async function openVisualSearch(app) {
  const board = app.activeBoard();
  const imageItems = board.items.filter(item => item.type === 'image');
  const modal = app.showModal('Visual Search', `
    <div class="ib3-search-tools">
      <label>Search names, tags and notes<input data-vs-query placeholder="Example: black hair red coat"></label>
      <label>Similar to<select data-vs-similar><option value="">None</option>${imageItems.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}</select></label>
      <label>Maximum visual distance<input type="range" min="0" max="32" value="12" data-vs-distance><span data-vs-distance-label>12</span></label>
      <label class="ib2-check"><input type="checkbox" data-vs-favorites> Favorites only</label>
    </div>
    <div class="ib3-search-results" data-vs-results></div>
  `, 'ib3-search-modal');
  const results = modal.querySelector('[data-vs-results]');
  const queryInput = modal.querySelector('[data-vs-query]');
  const similarSelect = modal.querySelector('[data-vs-similar]');
  const distanceInput = modal.querySelector('[data-vs-distance]');
  const favorites = modal.querySelector('[data-vs-favorites]');
  const records = new Map((await listImages()).map(record => [record.id, record]));

  const render = async () => {
    const query = queryInput.value;
    const seed = app.itemById(similarSelect.value);
    const seedHash = seed ? records.get(seed.imageId)?.dhash : null;
    const maxDistance = Number(distanceInput.value);
    modal.querySelector('[data-vs-distance-label]').textContent = String(maxDistance);
    const rows = imageItems.map(item => {
      const score = textSearchScore(item, query);
      const record = records.get(item.imageId);
      const distance = seedHash && record?.dhash ? hammingDistanceHex(seedHash, record.dhash) : null;
      return { item, score, distance };
    }).filter(row => (!query.trim() || row.score > 0)
      && (!seedHash || (row.distance !== null && row.distance <= maxDistance))
      && (!favorites.checked || row.item.favorite))
      .sort((a, b) => (b.score - a.score) || ((a.distance ?? 999) - (b.distance ?? 999)));
    const rendered = await Promise.all(rows.slice(0, 80).map(async row => ({ ...row, url: await app.imageUrl(row.item.imageId, true) })));
    results.innerHTML = rendered.length ? rendered.map(row => `<button data-vs-item="${row.item.id}"><img src="${row.url}" alt=""><span><b>${escapeHtml(row.item.name)}</b><small>${escapeHtml((row.item.tags || []).slice(0, 6).join(' · '))}${row.distance !== null ? ` · distance ${row.distance}` : ''}</small></span></button>`).join('') : '<p class="ib2-muted">No matching images.</p>';
    results.querySelectorAll('[data-vs-item]').forEach(button => button.onclick = () => {
      const item = app.itemById(button.dataset.vsItem);
      app.selectedIds = new Set([item.id]);
      app.focusItem(item);
      app.renderItems?.();
      modal.remove();
    });
  };
  [queryInput, similarSelect, distanceInput, favorites].forEach(control => control.addEventListener('input', render));
  await render();
}

export function openConflictReport(app, references = null, draft = null) {
  const board = app.activeBoard();
  const studio = ensureStudio(board);
  const items = references || board.items.filter(item => item.type === 'image').map(item => {
    const config = getReferenceConfig(board, item);
    return { ...config, item, name: item.name, purpose: config.purpose };
  });
  const warnings = detectReferenceConflicts({ blueprint: studio.blueprint, references: items, draft: draft || studio.promptDraft });
  const modal = app.showModal('Reference Conflict Check', `
    <div class="ib3-conflict-summary"><b>${warnings.length ? `${warnings.length} possible issue${warnings.length === 1 ? '' : 's'}` : 'No obvious conflicts found'}</b><span>This is a heuristic check. Review the final prompt before spending credits.</span></div>
    <div class="ib3-conflict-list">${warnings.length ? warnings.map(warning => `<article class="${warning.level}"><span>${warning.level === 'warning' ? '!' : 'i'}</span><p>${escapeHtml(warning.message)}</p></article>`).join('') : '<article class="good"><span>✓</span><p>Your current blueprint and reference roles look internally consistent.</p></article>'}</div>
    <div class="ib3-tag-cloud">${dominantTags(board.items.filter(item => item.type === 'image')).map(([tag, count]) => `<span>${escapeHtml(tag)} · ${count}</span>`).join('')}</div>
  `, 'ib3-conflict-modal');
  return modal;
}

export function openOrganizeStudio(app) {
  const modal = app.showModal('Organize & Discover', `
    <div class="ib3-organize-hero"><div><b>Smart organization tools</b><span>Analyze references, search visually, group large boards, and catch conflicting design cues.</span></div></div>
    <div class="ib3-tool-cards">
      <button data-org="tag"><span>#</span><b>Auto Tag Selected</b><small>Use your configured vision model, then review every suggestion.</small></button>
      <button data-org="search"><span>⌕</span><b>Visual Search</b><small>Search text metadata or find images similar to one reference.</small></button>
      <button data-org="role"><span>▦</span><b>Cluster by Purpose</b><small>Create frames for face, hair, outfit, mood, setting and more.</small></button>
      <button data-org="visual"><span>◉</span><b>Cluster Similar Images</b><small>Group visually related or duplicate-like references.</small></button>
      <button data-org="color"><span>◒</span><b>Cluster by Palette</b><small>Group images with similar average colors and visual mood.</small></button>
      <button data-org="conflicts"><span>!</span><b>Conflict Check</b><small>Look for contradictory colors, roles and overly strict references.</small></button>
    </div>
  `, 'ib3-organize-modal');
  modal.querySelector('[data-org="tag"]').onclick = () => autoTagSelected(app);
  modal.querySelector('[data-org="search"]').onclick = () => openVisualSearch(app);
  modal.querySelector('[data-org="role"]').onclick = () => smartClusterBoard(app, { method: 'role' });
  modal.querySelector('[data-org="visual"]').onclick = () => smartClusterBoard(app, { method: 'visual' });
  modal.querySelector('[data-org="color"]').onclick = () => smartClusterBoard(app, { method: 'color' });
  modal.querySelector('[data-org="conflicts"]').onclick = () => openConflictReport(app);
}

export function injectOrganizeStyles() {
  if (document.getElementById('ib3-organize-styles')) return;
  const style = document.createElement('style');
  style.id = 'ib3-organize-styles';
  style.textContent = `
    .ib3-tag-review{display:grid;gap:10px;max-height:58vh;overflow:auto}.ib3-tag-review article{display:grid;gap:7px;padding:11px;border:1px solid var(--ib2-line);border-radius:13px;background:#151520}.ib3-palette{display:flex;gap:5px;flex-wrap:wrap}.ib3-palette span{display:inline-flex;align-items:center;gap:4px;padding:4px 7px;border-radius:8px;background:#0d0d14;font-size:9px}.ib3-palette span:before{content:'';width:16px;height:16px;border-radius:50%;background:var(--swatch);border:1px solid #fff3}
    .ib3-search-tools{display:grid;grid-template-columns:2fr 1fr;gap:9px}.ib3-search-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:58vh;overflow:auto;margin-top:10px}.ib3-search-results button{display:flex;gap:9px;align-items:center;text-align:left;padding:7px;border:1px solid var(--ib2-line);border-radius:12px;background:#151520;color:var(--ib2-text)}.ib3-search-results img{width:58px;height:68px;border-radius:8px;object-fit:cover}.ib3-search-results span{display:flex;flex-direction:column;min-width:0}.ib3-search-results b,.ib3-search-results small{overflow:hidden;text-overflow:ellipsis}.ib3-search-results small{color:var(--ib2-muted);font-size:9px}
    .ib3-conflict-summary{display:flex;flex-direction:column;gap:3px;padding:12px;border-radius:14px;background:linear-gradient(135deg,#2c234a,#171724)}.ib3-conflict-summary span{font-size:10px;color:var(--ib2-muted)}.ib3-conflict-list{display:grid;gap:7px;margin:10px 0}.ib3-conflict-list article{display:flex;gap:9px;align-items:flex-start;padding:9px;border:1px solid var(--ib2-line);border-radius:11px}.ib3-conflict-list article.warning{border-color:#76512f;background:#35241480}.ib3-conflict-list article.info{border-color:#3b4f75;background:#18243a80}.ib3-conflict-list article.good{border-color:#2f6a46;background:#16352280}.ib3-conflict-list article>span{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#0005}.ib3-conflict-list p{margin:1px 0}.ib3-tag-cloud{display:flex;gap:5px;flex-wrap:wrap}.ib3-tag-cloud span{padding:4px 7px;border:1px solid var(--ib2-line);border-radius:999px;font-size:9px;color:var(--ib2-muted)}
    .ib3-organize-hero{padding:14px;border:1px solid #4d3f78;border-radius:15px;background:radial-gradient(circle at top right,#8f6cff33,transparent 45%),#14141f}.ib3-organize-hero div{display:flex;flex-direction:column;gap:3px}.ib3-organize-hero span{font-size:11px;color:var(--ib2-muted)}.ib3-warning{padding:6px 8px;border-radius:8px;background:#6c263550;color:#ff9dac;font-size:10px}
    @media(max-width:650px){.ib3-search-tools,.ib3-search-results{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}
