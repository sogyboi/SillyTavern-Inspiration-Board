import { hammingDistanceHex, uid } from './core-v2.js';

const DB_NAME = 'st-inspiration-board';
const DB_VERSION = 2;
const IMAGE_STORE = 'images';
const SNAPSHOT_STORE = 'snapshots';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      let images;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        images = db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
      } else {
        images = request.transaction.objectStore(IMAGE_STORE);
      }
      if (!images.indexNames.contains('hash')) images.createIndex('hash', 'hash', { unique: false });
      if (!images.indexNames.contains('dhash')) images.createIndex('dhash', 'dhash', { unique: false });
      if (!images.indexNames.contains('createdAt')) images.createIndex('createdAt', 'createdAt', { unique: false });

      let snapshots;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        snapshots = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
      } else {
        snapshots = request.transaction.objectStore(SNAPSHOT_STORE);
      }
      if (!snapshots.indexNames.contains('createdAt')) snapshots.createIndex('createdAt', 'createdAt', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open Inspiration Board storage.'));
    request.onblocked = () => reject(new Error('Inspiration Board storage upgrade is blocked. Close other SillyTavern tabs and retry.'));
  });
}

function txPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Storage transaction was aborted.'));
  });
}

async function requestResult(storeName, mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = callback(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('Storage request failed.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error || request.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Storage request aborted.')); };
  });
}

export async function hashBlob(blob) {
  const buffer = await blob.arrayBuffer();
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (const byte of new Uint8Array(buffer)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fnv-${(hash >>> 0).toString(16)}`;
}

async function bitmapForBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw(ctx, ...args) { ctx.drawImage(bitmap, ...args); },
        close() { bitmap.close?.(); },
      };
    } catch (error) {
      console.warn('[Inspiration Board] createImageBitmap failed, using Image fallback.', error);
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The browser could not decode this image.'));
      element.src = url;
    });
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      draw(ctx, ...args) { ctx.drawImage(image, ...args); },
      close() { URL.revokeObjectURL(url); },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function getImageDimensions(blob) {
  const bitmap = await bitmapForBlob(blob);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

export async function computeDHash(blob) {
  const bitmap = await bitmapForBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 9, 8);
  ctx.drawImage = ctx.drawImage.bind(ctx);
  bitmap.draw(ctx, 0, 0, 9, 8);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, 9, 8).data;
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = (y * 9 + x) * 4;
      const right = (y * 9 + x + 1) * 4;
      const leftLum = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
      const rightLum = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
      bits += leftLum > rightLum ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export async function createImageRecord(file, { sourceUrl = '' } = {}) {
  const [hash, dhash, dimensions, thumbnail] = await Promise.all([
    hashBlob(file),
    computeDHash(file),
    getImageDimensions(file),
    makeThumbnail(file),
  ]);
  return {
    id: uid('image'),
    name: file.name || `Image ${new Date().toLocaleString()}`,
    mime: file.type || 'image/jpeg',
    size: file.size,
    hash,
    dhash,
    width: dimensions.width,
    height: dimensions.height,
    sourceUrl,
    blob: file,
    thumbnail: thumbnail.blob,
    thumbnailWidth: thumbnail.width,
    thumbnailHeight: thumbnail.height,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function putImage(record) {
  const db = await openDb();
  const tx = db.transaction(IMAGE_STORE, 'readwrite');
  tx.objectStore(IMAGE_STORE).put(record);
  await txPromise(tx);
  db.close();
  return record;
}

export async function getImage(id) {
  return requestResult(IMAGE_STORE, 'readonly', store => store.get(id));
}

export async function getImageByHash(hash) {
  if (!hash) return null;
  return requestResult(IMAGE_STORE, 'readonly', store => store.index('hash').get(hash));
}

export async function getImagesByHash(hash) {
  if (!hash) return [];
  return (await requestResult(IMAGE_STORE, 'readonly', store => store.index('hash').getAll(hash))) || [];
}

export async function deleteImage(id) {
  const db = await openDb();
  const tx = db.transaction(IMAGE_STORE, 'readwrite');
  tx.objectStore(IMAGE_STORE).delete(id);
  await txPromise(tx);
  db.close();
}

export async function listImages() {
  return (await requestResult(IMAGE_STORE, 'readonly', store => store.getAll())) || [];
}

export async function clearImages() {
  const db = await openDb();
  const tx = db.transaction(IMAGE_STORE, 'readwrite');
  tx.objectStore(IMAGE_STORE).clear();
  await txPromise(tx);
  db.close();
}

export async function findNearDuplicates(dhash, maxDistance = 7, excludeIds = []) {
  if (!dhash) return [];
  const excluded = new Set(excludeIds);
  const images = await listImages();
  return images
    .filter(image => image.dhash && !excluded.has(image.id))
    .map(image => ({ image, distance: hammingDistanceHex(dhash, image.dhash) }))
    .filter(result => result.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

export async function makeThumbnail(blob, maxSize = 720) {
  const bitmap = await bitmapForBlob(blob);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, width, height);
  bitmap.draw(ctx, 0, 0, width, height);
  bitmap.close();
  const thumb = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84));
  return { blob: thumb || blob, width, height };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read image.'));
    reader.readAsDataURL(blob);
  });
}

export async function putSnapshot({ state, boardId = null, reason = 'Autosave', label = '' }) {
  const record = {
    id: uid('snapshot'),
    boardId,
    reason,
    label,
    createdAt: Date.now(),
    state,
  };
  const db = await openDb();
  const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
  tx.objectStore(SNAPSHOT_STORE).put(record);
  await txPromise(tx);
  db.close();
  return record;
}

export async function listSnapshots(limit = 10) {
  const all = (await requestResult(SNAPSHOT_STORE, 'readonly', store => store.getAll())) || [];
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function getSnapshot(id) {
  return requestResult(SNAPSHOT_STORE, 'readonly', store => store.get(id));
}

export async function deleteSnapshot(id) {
  const db = await openDb();
  const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
  tx.objectStore(SNAPSHOT_STORE).delete(id);
  await txPromise(tx);
  db.close();
}

export async function pruneSnapshots(maxCount = 10) {
  const all = (await requestResult(SNAPSHOT_STORE, 'readonly', store => store.getAll())) || [];
  all.sort((a, b) => b.createdAt - a.createdAt);
  for (const record of all.slice(maxCount)) await deleteSnapshot(record.id);
}

export async function clearSnapshots() {
  const db = await openDb();
  const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
  tx.objectStore(SNAPSHOT_STORE).clear();
  await txPromise(tx);
  db.close();
}
