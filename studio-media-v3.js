import { clamp, makeImageItem, staggerPositions } from './core-v2.js';
import { blobToDataUrl, createImageRecord, getImage, putImage } from './db-v2.js';
import { cropPresets, sanitizeFilename } from './studio-core-v3.js';

async function loadDrawable(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw(context, ...args) { context.drawImage(bitmap, ...args); },
        close() { bitmap.close?.(); },
      };
    } catch {}
  }
  const url = URL.createObjectURL(blob);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not decode the image.'));
    element.src = url;
  });
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    draw(context, ...args) { context.drawImage(image, ...args); },
    close() { URL.revokeObjectURL(url); },
  };
}

function canvasBlob(canvas, type = 'image/png', quality = 0.94) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the image.')), type, quality));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function cropRect(sourceWidth, sourceHeight, targetRatio, focalX = 50, focalY = 50, zoom = 1) {
  const sourceRatio = sourceWidth / sourceHeight;
  let width;
  let height;
  if (sourceRatio > targetRatio) {
    height = sourceHeight / zoom;
    width = height * targetRatio;
  } else {
    width = sourceWidth / zoom;
    height = width / targetRatio;
  }
  width = Math.min(sourceWidth, width);
  height = Math.min(sourceHeight, height);
  const centerX = (focalX / 100) * sourceWidth;
  const centerY = (focalY / 100) * sourceHeight;
  const x = clamp(centerX - width / 2, 0, sourceWidth - width);
  const y = clamp(centerY - height / 2, 0, sourceHeight - height);
  return { x, y, width, height };
}

async function saveDerivedImage(app, blob, {
  name,
  sourceItem = null,
  destination = 'board',
  tags = [],
  notes = '',
  positionIndex = 0,
  total = 1,
} = {}) {
  const file = new File([blob], `${sanitizeFilename(name || 'derived-image')}.png`, { type: blob.type || 'image/png' });
  const record = await createImageRecord(file, { sourceUrl: sourceItem?.sourceUrl || '' });
  record.derivedFrom = sourceItem ? { itemId: sourceItem.id, imageId: sourceItem.imageId } : null;
  await putImage(record);

  if (destination === 'inbox') {
    const entry = app.ensureInboxEntry(record);
    entry.tags = [...new Set([...(entry.tags || []), ...tags])];
    entry.notes = notes;
    return { record, entry, item: null };
  }

  const ratio = record.width / Math.max(1, record.height);
  const width = ratio >= 1 ? 360 : 286;
  const height = clamp(width / Math.max(ratio, 0.05), 180, 520);
  const center = app.canvasCenterWorld();
  const position = staggerPositions(total, center.x, center.y, width, height)[positionIndex] || center;
  const item = makeImageItem({
    imageId: record.id,
    name: name || record.name,
    width,
    height,
    x: position.x,
    y: position.y,
    sourceUrl: sourceItem?.sourceUrl || '',
  });
  item.tags = [...new Set(tags)];
  item.notes = notes;
  item.derivedFrom = record.derivedFrom;
  app.activeBoard().items.push(item);
  return { record, item, entry: null };
}

export async function createCropVariant(record, item, preset) {
  const drawable = await loadDrawable(record.blob);
  try {
    const ratio = preset.width / preset.height;
    const focalX = item?.crop?.focalX ?? 50;
    const focalY = item?.crop?.focalY ?? 50;
    const zoom = clamp(Number(item?.crop?.zoom) || 1, 1, 4);
    const source = cropRect(drawable.width, drawable.height, ratio, focalX, focalY, zoom);
    const canvas = document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;
    const context = canvas.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.save();
    if (item?.flipX || item?.flipY) {
      context.translate(item.flipX ? canvas.width : 0, item.flipY ? canvas.height : 0);
      context.scale(item.flipX ? -1 : 1, item.flipY ? -1 : 1);
    }
    drawable.draw(context, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
    context.restore();
    return canvasBlob(canvas, 'image/png');
  } finally {
    drawable.close();
  }
}

export async function createAllCrops(app, item, { destination = 'inbox', selectedPresets = null } = {}) {
  if (!item?.imageId) throw new Error('Select one image first.');
  const record = await getImage(item.imageId);
  if (!record?.blob) throw new Error('The selected image is missing.');
  const presets = cropPresets().filter(preset => !selectedPresets || selectedPresets.includes(preset.id));
  const results = [];
  for (let index = 0; index < presets.length; index++) {
    const preset = presets[index];
    const blob = await createCropVariant(record, item, preset);
    results.push(await saveDerivedImage(app, blob, {
      name: `${item.name || 'Character'} · ${preset.name}`,
      sourceItem: item,
      destination,
      tags: ['derived', 'crop', preset.id],
      notes: `Automatic ${preset.name.toLowerCase()} crop from ${item.name || 'source image'}.`,
      positionIndex: index,
      total: presets.length,
    }));
  }
  app.scheduleSave();
  await app.renderItems?.();
  await app.renderInboxButton?.();
  return results;
}

function colorDistance(data, offset, color) {
  const dr = data[offset] - color[0];
  const dg = data[offset + 1] - color[1];
  const db = data[offset + 2] - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function cornerColors(data, width, height) {
  const offsets = [
    0,
    (width - 1) * 4,
    ((height - 1) * width) * 4,
    ((height * width) - 1) * 4,
  ];
  return offsets.map(offset => [data[offset], data[offset + 1], data[offset + 2]]);
}

function featherAlpha(data, width, height, passes = 1) {
  for (let pass = 0; pass < passes; pass++) {
    const copy = new Uint8ClampedArray(data);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = (y * width + x) * 4;
        if (copy[index + 3] === 0) continue;
        let transparent = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            if (copy[((y + oy) * width + (x + ox)) * 4 + 3] === 0) transparent++;
          }
        }
        if (transparent) data[index + 3] = Math.max(40, 255 - transparent * 26);
      }
    }
  }
}

export async function removeBackgroundLocal(record, { tolerance = 46, feather = 2, maxSize = 2048 } = {}) {
  const drawable = await loadDrawable(record.blob);
  try {
    const scale = Math.min(1, maxSize / Math.max(drawable.width, drawable.height));
    const width = Math.max(1, Math.round(drawable.width * scale));
    const height = Math.max(1, Math.round(drawable.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    drawable.draw(context, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    const colors = cornerColors(data, width, height);
    const visited = new Uint8Array(width * height);
    const queue = [];
    const enqueue = (x, y) => {
      const position = y * width + x;
      if (visited[position]) return;
      visited[position] = 1;
      queue.push(position);
    };
    enqueue(0, 0);
    enqueue(width - 1, 0);
    enqueue(0, height - 1);
    enqueue(width - 1, height - 1);

    let cursor = 0;
    while (cursor < queue.length) {
      const position = queue[cursor++];
      const x = position % width;
      const y = Math.floor(position / width);
      const offset = position * 4;
      const close = colors.some(color => colorDistance(data, offset, color) <= tolerance);
      if (!close) continue;
      data[offset + 3] = 0;
      if (x > 0) enqueue(x - 1, y);
      if (x + 1 < width) enqueue(x + 1, y);
      if (y > 0) enqueue(x, y - 1);
      if (y + 1 < height) enqueue(x, y + 1);
    }
    featherAlpha(data, width, height, Math.max(0, Math.min(5, feather)));
    context.putImageData(imageData, 0, 0);
    return canvasBlob(canvas, 'image/png');
  } finally {
    drawable.close();
  }
}

export async function createOutpaintCanvas(record, {
  aspectRatio = '16:9',
  placement = 'center',
  padding = 0.18,
  maxSize = 1600,
} = {}) {
  const [rw, rh] = String(aspectRatio).split(':').map(Number);
  const targetRatio = rw > 0 && rh > 0 ? rw / rh : 16 / 9;
  const drawable = await loadDrawable(record.blob);
  try {
    let width = drawable.width;
    let height = drawable.height;
    if (width / height < targetRatio) width = Math.round(height * targetRatio);
    else height = Math.round(width / targetRatio);
    width = Math.round(width * (1 + padding * 2));
    height = Math.round(height * (1 + padding * 2));
    const scale = Math.min(1, maxSize / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const imageScale = Math.min((width * (1 - padding * 2)) / drawable.width, (height * (1 - padding * 2)) / drawable.height);
    const imageWidth = Math.round(drawable.width * imageScale);
    const imageHeight = Math.round(drawable.height * imageScale);
    let x = (width - imageWidth) / 2;
    let y = (height - imageHeight) / 2;
    if (placement === 'left') x = Math.round(width * padding * 0.45);
    if (placement === 'right') x = width - imageWidth - Math.round(width * padding * 0.45);
    if (placement === 'top') y = Math.round(height * padding * 0.45);
    if (placement === 'bottom') y = height - imageHeight - Math.round(height * padding * 0.45);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    context.clearRect(0, 0, width, height);
    drawable.draw(context, x, y, imageWidth, imageHeight);
    return { blob: await canvasBlob(canvas, 'image/png'), canvas, bounds: { x, y, width: imageWidth, height: imageHeight } };
  } finally {
    drawable.close();
  }
}

function setupPainter(canvas, overlay, image) {
  const context = canvas.getContext('2d');
  const maskContext = overlay.getContext('2d');
  const state = { drawing: false, brush: 36, history: [] };
  const resize = () => {
    const maxWidth = Math.min(760, window.innerWidth - 56);
    const scale = Math.min(1, maxWidth / image.naturalWidth, 520 / image.naturalHeight);
    canvas.width = overlay.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = overlay.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    maskContext.clearRect(0, 0, overlay.width, overlay.height);
  };
  resize();
  const point = event => {
    const rect = overlay.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (overlay.width / rect.width),
      y: (event.clientY - rect.top) * (overlay.height / rect.height),
    };
  };
  const draw = event => {
    if (!state.drawing) return;
    const p = point(event);
    maskContext.fillStyle = 'rgba(255, 0, 170, .72)';
    maskContext.beginPath();
    maskContext.arc(p.x, p.y, state.brush / 2, 0, Math.PI * 2);
    maskContext.fill();
  };
  overlay.onpointerdown = event => {
    state.history.push(maskContext.getImageData(0, 0, overlay.width, overlay.height));
    state.drawing = true;
    overlay.setPointerCapture?.(event.pointerId);
    draw(event);
  };
  overlay.onpointermove = draw;
  overlay.onpointerup = overlay.onpointercancel = () => { state.drawing = false; };
  return {
    state,
    clear() { state.history.push(maskContext.getImageData(0, 0, overlay.width, overlay.height)); maskContext.clearRect(0, 0, overlay.width, overlay.height); },
    undo() { const previous = state.history.pop(); if (previous) maskContext.putImageData(previous, 0, 0); },
    setBrush(value) { state.brush = clamp(Number(value) || 36, 6, 180); },
    async compositeBlob() {
      const output = document.createElement('canvas');
      output.width = canvas.width;
      output.height = canvas.height;
      const out = output.getContext('2d');
      out.drawImage(canvas, 0, 0);
      out.drawImage(overlay, 0, 0);
      return canvasBlob(output, 'image/png');
    },
    maskIsEmpty() {
      const data = maskContext.getImageData(0, 0, overlay.width, overlay.height).data;
      for (let index = 3; index < data.length; index += 4) if (data[index] > 0) return false;
      return true;
    },
  };
}

export async function openInpaintPainter(app, item, onGenerate) {
  const record = await getImage(item.imageId);
  if (!record?.blob) throw new Error('The selected image is missing.');
  const dataUrl = await blobToDataUrl(record.blob);
  const modal = app.showModal('Paint the area to change', `
    <div class="ib3-painter">
      <div class="ib3-painter-stage"><canvas data-paint-image></canvas><canvas data-paint-mask></canvas></div>
      <div class="ib3-painter-controls">
        <label>Brush size<input type="range" min="6" max="180" value="36" data-paint-brush></label>
        <button data-paint-undo>Undo</button><button data-paint-clear>Clear</button>
      </div>
      <label>What should replace the painted area?<textarea rows="4" data-paint-prompt placeholder="Example: Replace the jacket with the red coat from the outfit reference. Preserve everything outside the pink mask."></textarea></label>
      <div class="ib2-modal-actions"><button data-paint-cancel>Cancel</button><button class="primary" data-paint-generate>Generate Edit</button></div>
      <p class="ib2-muted">The pink mask is sent as part of the reference image. Editing quality depends on the selected OpenRouter model.</p>
    </div>
  `, 'ib3-painter-modal');
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
  const painter = setupPainter(modal.querySelector('[data-paint-image]'), modal.querySelector('[data-paint-mask]'), image);
  modal.querySelector('[data-paint-brush]').oninput = event => painter.setBrush(event.target.value);
  modal.querySelector('[data-paint-undo]').onclick = () => painter.undo();
  modal.querySelector('[data-paint-clear]').onclick = () => painter.clear();
  modal.querySelector('[data-paint-cancel]').onclick = () => modal.remove();
  modal.querySelector('[data-paint-generate]').onclick = async () => {
    const prompt = modal.querySelector('[data-paint-prompt]').value.trim();
    if (!prompt) return app.toast('Describe the edit first.', 'warning');
    if (painter.maskIsEmpty()) return app.toast('Paint the area you want to change.', 'warning');
    const blob = await painter.compositeBlob();
    const referenceDataUrl = await blobToDataUrl(blob);
    modal.remove();
    await onGenerate({
      recipeId: 'edit',
      prompt,
      inlineReference: {
        dataUrl: referenceDataUrl,
        name: `${item.name} · pink edit mask`,
        purpose: 'identity',
        strength: 100,
        strictness: 'strict',
        mustPreserve: true,
        ignoreBackground: false,
        notes: 'Pink-painted pixels are the only area to change. Preserve every unpainted pixel and detail as closely as possible.',
      },
    });
  };
}

export async function openOutpaintForm(app, item, onGenerate) {
  const record = await getImage(item.imageId);
  if (!record?.blob) throw new Error('The selected image is missing.');
  const modal = app.showModal('Outpaint image', `
    <div class="ib3-form-grid">
      <label>Target ratio<select data-outpaint-ratio>${['16:9','9:16','4:3','3:4','1:1','3:2','2:3'].map(value => `<option value="${value}">${value}</option>`).join('')}</select></label>
      <label>Keep original toward<select data-outpaint-placement>${['center','left','right','top','bottom'].map(value => `<option value="${value}">${value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select></label>
      <label>Extra canvas<select data-outpaint-padding><option value="0.1">Small</option><option value="0.18" selected>Medium</option><option value="0.3">Large</option></select></label>
      <label class="wide">What should fill the new space?<textarea data-outpaint-prompt rows="4" placeholder="Example: Continue the rainy neon alley with matching perspective and lighting."></textarea></label>
    </div>
    <div class="ib2-modal-actions"><button data-outpaint-cancel>Cancel</button><button class="primary" data-outpaint-go>Create Outpaint Job</button></div>
  `);
  modal.querySelector('[data-outpaint-cancel]').onclick = () => modal.remove();
  modal.querySelector('[data-outpaint-go]').onclick = async () => {
    const aspectRatio = modal.querySelector('[data-outpaint-ratio]').value;
    const placement = modal.querySelector('[data-outpaint-placement]').value;
    const padding = Number(modal.querySelector('[data-outpaint-padding]').value);
    const prompt = modal.querySelector('[data-outpaint-prompt]').value.trim() || 'Continue the image naturally into the blank space.';
    const prepared = await createOutpaintCanvas(record, { aspectRatio, placement, padding });
    const dataUrl = await blobToDataUrl(prepared.blob);
    modal.remove();
    await onGenerate({
      recipeId: 'outpaint',
      aspectRatio,
      prompt,
      inlineReference: {
        dataUrl,
        name: `${item.name} · outpaint guide`,
        purpose: 'environment',
        strength: 100,
        strictness: 'strict',
        mustPreserve: true,
        ignoreBackground: false,
        notes: 'Preserve the existing non-transparent image exactly and generate only the transparent surrounding area.',
      },
    });
  };
}

export async function openMediaTools(app, studioApi) {
  const selected = [...app.selectedIds].map(id => app.itemById(id)).filter(item => item?.type === 'image');
  if (selected.length !== 1) return app.toast('Select exactly one image to use the image editing tools.', 'warning');
  const item = selected[0];
  const url = await app.imageUrl(item.imageId, true);
  const modal = app.showModal('Image Lab', `
    <div class="ib3-media-lab">
      <div class="ib3-media-hero"><img src="${url}" alt=""><div><b>${item.name}</b><span>Local tools create new copies and never overwrite the source.</span></div></div>
      <div class="ib3-tool-cards">
        <button data-media-tool="inpaint"><span>✎</span><b>Inpaint</b><small>Paint only the area the model should change.</small></button>
        <button data-media-tool="outpaint"><span>↔</span><b>Outpaint</b><small>Extend the image to a wider or taller ratio.</small></button>
        <button data-media-tool="remove"><span>◌</span><b>Local Background Removal</b><small>Fast corner-color removal for simple backgrounds.</small></button>
        <button data-media-tool="remove-ai"><span>✦</span><b>AI Isolated Asset</b><small>Regenerate the subject on a plain removable background.</small></button>
        <button data-media-tool="crops"><span>▦</span><b>Automatic Crops</b><small>Create avatar, portrait, card, wallpaper and banner versions.</small></button>
        <button data-media-tool="download"><span>⇩</span><b>Download Original</b><small>Save the stored source image to this device.</small></button>
      </div>
    </div>
  `, 'ib3-media-modal');

  modal.querySelector('[data-media-tool="inpaint"]').onclick = () => openInpaintPainter(app, item, studioApi.openInlineEditJob);
  modal.querySelector('[data-media-tool="outpaint"]').onclick = () => openOutpaintForm(app, item, studioApi.openInlineEditJob);
  modal.querySelector('[data-media-tool="remove-ai"]').onclick = async () => {
    const record = await getImage(item.imageId);
    const dataUrl = await blobToDataUrl(record.blob);
    modal.remove();
    await studioApi.openInlineEditJob({
      recipeId: 'remove-background-ai',
      aspectRatio: record.width >= record.height ? '1:1' : '2:3',
      prompt: 'Isolate this exact character or subject on a plain solid contrasting background. Preserve identity, proportions, clothing, accessories, and pose.',
      inlineReference: {
        dataUrl,
        name: item.name,
        purpose: 'identity',
        strength: 100,
        strictness: 'strict',
        mustPreserve: true,
        ignoreBackground: true,
      },
    });
  };
  modal.querySelector('[data-media-tool="remove"]').onclick = async () => {
    const record = await getImage(item.imageId);
    const progress = app.showProgressModal('Removing background', 'Flood-filling the corner background…');
    try {
      const studio = app.activeBoard().studio;
      const blob = await removeBackgroundLocal(record, {
        tolerance: studio?.settings?.backgroundTolerance ?? 46,
        feather: studio?.settings?.backgroundFeather ?? 2,
      });
      await saveDerivedImage(app, blob, {
        name: `${item.name} · Background Removed`,
        sourceItem: item,
        destination: 'board',
        tags: ['derived', 'background-removed', 'transparent'],
        notes: 'Background removed locally from colors connected to the image corners.',
      });
      app.scheduleSave();
      await app.renderItems?.();
      app.toast('Transparent copy added to the board.', 'success');
    } finally { progress.close(); }
  };
  modal.querySelector('[data-media-tool="crops"]').onclick = async () => {
    const choice = app.showModal('Automatic crops', `
      <p class="ib2-muted">Choose the crops to create. They use the image focal point from Image Details.</p>
      <div class="ib3-crop-grid">${cropPresets().map(preset => `<label><input type="checkbox" value="${preset.id}" checked><b>${preset.name}</b><span>${preset.width} × ${preset.height}</span></label>`).join('')}</div>
      <label>Save to<select data-crop-destination><option value="inbox">Inbox</option><option value="board">Board</option></select></label>
      <div class="ib2-modal-actions"><button data-crop-cancel>Cancel</button><button class="primary" data-crop-create>Create Crops</button></div>
    `);
    choice.querySelector('[data-crop-cancel]').onclick = () => choice.remove();
    choice.querySelector('[data-crop-create]').onclick = async () => {
      const ids = [...choice.querySelectorAll('.ib3-crop-grid input:checked')].map(input => input.value);
      const destination = choice.querySelector('[data-crop-destination]').value;
      choice.remove();
      const progress = app.showProgressModal('Creating crops', `Rendering ${ids.length} crop${ids.length === 1 ? '' : 's'}…`);
      try {
        await createAllCrops(app, item, { destination, selectedPresets: ids });
        app.toast(`${ids.length} crop${ids.length === 1 ? '' : 's'} created.`, 'success');
      } finally { progress.close(); }
    };
  };
  modal.querySelector('[data-media-tool="download"]').onclick = async () => {
    const record = await getImage(item.imageId);
    downloadBlob(record.blob, record.name || `${sanitizeFilename(item.name)}.png`);
  };
}

export function injectMediaStyles() {
  if (document.getElementById('ib3-media-styles')) return;
  const style = document.createElement('style');
  style.id = 'ib3-media-styles';
  style.textContent = `
    .ib3-media-hero{display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--ib2-line);border-radius:16px;background:#11111a}.ib3-media-hero img{width:88px;height:100px;object-fit:cover;border-radius:12px}.ib3-media-hero div{display:flex;flex-direction:column;gap:4px}.ib3-media-hero span{font-size:11px;color:var(--ib2-muted)}
    .ib3-tool-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.ib3-tool-cards button{display:grid;grid-template-columns:38px 1fr;grid-template-rows:auto auto;text-align:left;gap:2px 8px;min-height:78px;padding:10px;border:1px solid var(--ib2-line);border-radius:14px;background:#181824;color:var(--ib2-text)}.ib3-tool-cards button>span{grid-row:1/3;display:grid;place-items:center;font-size:26px;color:#b9a4ff}.ib3-tool-cards small{color:var(--ib2-muted);line-height:1.25}
    .ib3-painter-stage{position:relative;display:inline-block;max-width:100%;border:1px solid var(--ib2-line);border-radius:14px;overflow:hidden;background:repeating-conic-gradient(#7772 0 25%,#2222 0 50%) 50%/18px 18px}.ib3-painter-stage canvas{display:block;max-width:100%;height:auto}.ib3-painter-stage canvas[data-paint-mask]{position:absolute;inset:0;touch-action:none;cursor:crosshair}.ib3-painter-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.ib3-painter-controls label{flex:1;min-width:180px}
    .ib3-crop-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}.ib3-crop-grid label{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;gap:2px 8px;padding:9px;border:1px solid var(--ib2-line);border-radius:11px;background:#161621}.ib3-crop-grid input{grid-row:1/3}.ib3-crop-grid span{font-size:10px;color:var(--ib2-muted)}
    @media(max-width:620px){.ib3-tool-cards,.ib3-crop-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}
