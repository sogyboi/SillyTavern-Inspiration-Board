import { FRAME_COLORS, ROLE_LABELS, clamp, getBounds, getFrameMembers, getVisibleItems, sanitizeFilename } from './core-v2.js';
import { getImage } from './db-v2.js';

const FRAME_PALETTE = Object.freeze({
  purple: { line: '#8d68ff', fill: 'rgba(91,66,177,.18)' },
  blue: { line: '#4f8cff', fill: 'rgba(42,92,177,.18)' },
  green: { line: '#45c58a', fill: 'rgba(42,145,99,.18)' },
  gold: { line: '#e6ba55', fill: 'rgba(170,124,35,.18)' },
  rose: { line: '#e879b4', fill: 'rgba(170,59,115,.18)' },
  slate: { line: '#9aa4bc', fill: 'rgba(91,101,125,.18)' },
});

async function imageSource(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch (error) {
      console.warn('[Inspiration Board] export createImageBitmap fallback', error);
    }
  }
  const url = URL.createObjectURL(blob);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not decode an image for export.'));
    element.src = url;
  });
  return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

function roundedRect(ctx, x, y, width, height, radius = 18) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth, maxLines = 20) {
  const paragraphs = String(text || '').split(/\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines) break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length >= maxLines) break;
  }
  if (lines.length >= maxLines) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, '')}…`;
  return lines.slice(0, maxLines);
}

function drawCover(ctx, source, item, x, y, width, height) {
  const crop = item.crop || { zoom: 1, focalX: 50, focalY: 50 };
  const zoom = clamp(Number(crop.zoom) || 1, 1, 4);
  const baseScale = Math.max(width / source.width, height / source.height) * zoom;
  const sourceWidth = Math.min(source.width, width / baseScale);
  const sourceHeight = Math.min(source.height, height / baseScale);
  const focalX = clamp(Number(crop.focalX) || 50, 0, 100) / 100 * source.width;
  const focalY = clamp(Number(crop.focalY) || 50, 0, 100) / 100 * source.height;
  const sourceX = clamp(focalX - sourceWidth / 2, 0, Math.max(0, source.width - sourceWidth));
  const sourceY = clamp(focalY - sourceHeight / 2, 0, Math.max(0, source.height - sourceHeight));

  ctx.save();
  roundedRect(ctx, x, y, width, height, 16);
  ctx.clip();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate((Number(item.rotation) || 0) * Math.PI / 180);
  ctx.scale(item.flipX ? -1 : 1, item.flipY ? -1 : 1);
  ctx.drawImage(source.image, sourceX, sourceY, sourceWidth, sourceHeight, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawFrame(ctx, frame, offsetX, offsetY, scale, board) {
  const x = (frame.x - offsetX) * scale;
  const y = (frame.y - offsetY) * scale;
  const width = frame.width * scale;
  const height = frame.height * scale;
  const palette = FRAME_PALETTE[frame.color] || FRAME_PALETTE.purple;
  ctx.save();
  roundedRect(ctx, x, y, width, height, 22 * scale);
  ctx.fillStyle = palette.fill;
  ctx.fill();
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.strokeStyle = palette.line;
  ctx.stroke();
  ctx.fillStyle = 'rgba(12,12,19,.92)';
  roundedRect(ctx, x, y, width, Math.min(height, 48 * scale), 20 * scale);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.max(14, 19 * scale)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const count = getFrameMembers(board, frame.id).length;
  ctx.fillText(`${frame.title}${frame.collapsed ? ` · ${count} items` : ''}`, x + 18 * scale, y + Math.min(height, 48 * scale) / 2);
  ctx.restore();
}

function drawNote(ctx, item, offsetX, offsetY, scale) {
  const x = (item.x - offsetX) * scale;
  const y = (item.y - offsetY) * scale;
  const width = item.width * scale;
  const height = item.height * scale;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 18 * scale;
  ctx.shadowOffsetY = 8 * scale;
  roundedRect(ctx, x, y, width, height, 6 * scale);
  ctx.fillStyle = '#f5d26e';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#342611';
  ctx.font = `${Math.max(12, 16 * scale)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  const pad = 16 * scale;
  const lineHeight = Math.max(15, 21 * scale);
  const lines = wrapText(ctx, item.text, width - pad * 2, Math.max(2, Math.floor((height - pad * 2) / lineHeight)));
  lines.forEach((line, index) => ctx.fillText(line, x + pad, y + pad + index * lineHeight));
  ctx.restore();
}

async function drawImage(ctx, item, offsetX, offsetY, scale, board) {
  const record = await getImage(item.imageId);
  if (!record?.blob) return;
  const source = await imageSource(record.thumbnail || record.blob);
  try {
    const x = (item.x - offsetX) * scale;
    const y = (item.y - offsetY) * scale;
    const width = item.width * scale;
    const height = item.height * scale;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 22 * scale;
    ctx.shadowOffsetY = 9 * scale;
    roundedRect(ctx, x, y, width, height, 16 * scale);
    ctx.fillStyle = '#171722';
    ctx.fill();
    ctx.restore();
    drawCover(ctx, source, item, x, y, width, height);

    const topHeight = Math.max(24, 32 * scale);
    ctx.save();
    ctx.fillStyle = 'rgba(8,8,13,.74)';
    roundedRect(ctx, x + 7 * scale, y + 7 * scale, Math.min(width - 14 * scale, 130 * scale), topHeight, 9 * scale);
    ctx.fill();
    ctx.fillStyle = '#f5f1ff';
    ctx.font = `600 ${Math.max(10, 12 * scale)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const isMain = board.character.mainImageId === item.id;
    const label = `${isMain ? '★ ' : ''}${ROLE_LABELS[item.role] || item.role}`;
    ctx.fillText(label, x + 16 * scale, y + 7 * scale + topHeight / 2);

    const footerHeight = Math.max(26, 34 * scale);
    const gradient = ctx.createLinearGradient(0, y + height - footerHeight * 2, 0, y + height);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,.88)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y + height - footerHeight * 2, width, footerHeight * 2);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(10, 12 * scale)}px system-ui, sans-serif`;
    const title = item.name.length > 44 ? `${item.name.slice(0, 42)}…` : item.name;
    ctx.fillText(title, x + 10 * scale, y + height - footerHeight / 2);
    ctx.restore();
  } finally {
    source.close();
  }
}

export async function renderBoardToCanvas(board, { maxDimension = 6000, padding = 80, background = '#101019', onProgress = () => {} } = {}) {
  const visible = getVisibleItems(board);
  const bounds = getBounds(visible);
  const safeBounds = bounds || { x: -500, y: -400, width: 1000, height: 800 };
  const naturalWidth = safeBounds.width + padding * 2;
  const naturalHeight = safeBounds.height + padding * 2;
  const scale = Math.min(1.5, maxDimension / Math.max(naturalWidth, naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const dotGap = Math.max(12, 22 * scale);
  ctx.fillStyle = '#353548';
  for (let y = dotGap / 2; y < canvas.height; y += dotGap) {
    for (let x = dotGap / 2; x < canvas.width; x += dotGap) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.6, scale), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const offsetX = safeBounds.x - padding;
  const offsetY = safeBounds.y - padding;
  const frames = visible.filter(item => item.type === 'frame');
  frames.forEach(frame => drawFrame(ctx, frame, offsetX, offsetY, scale, board));

  const content = visible.filter(item => item.type !== 'frame');
  for (let index = 0; index < content.length; index++) {
    const item = content[index];
    onProgress({ index, total: content.length, item });
    if (item.type === 'image') await drawImage(ctx, item, offsetX, offsetY, scale, board);
    else if (item.type === 'note') drawNote(ctx, item, offsetX, offsetY, scale);
  }
  return canvas;
}

export async function exportBoardAsPng(board, options = {}) {
  const canvas = await renderBoardToCanvas(board, options);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the board image.')), 'image/png');
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sanitizeFilename(board.name, 'inspiration-board')}-${new Date().toISOString().slice(0, 10)}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return blob;
}
