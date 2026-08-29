import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSE_TARGETS,
  buildProviderSearch,
  candidateFilename,
  detectBrowseProvider,
  extractFirstUrl,
  foldLayoutMode,
  isLikelyImageUrl,
  mergeCandidates,
  normalizeRemoteUrl,
  sourceNote,
  targetById,
} from '../browse-core-v4.js';

test('detectBrowseProvider recognizes Pinterest, pinimg, Cosmos, and web URLs', () => {
  assert.equal(detectBrowseProvider('https://www.pinterest.com/pin/123456/'), 'pinterest');
  assert.equal(detectBrowseProvider('https://i.pinimg.com/originals/aa/bb/cc/example.jpg'), 'pinterest');
  assert.equal(detectBrowseProvider('https://www.cosmos.so/e/abc123'), 'cosmos');
  assert.equal(detectBrowseProvider('https://example.com/gallery'), 'web');
});

test('buildProviderSearch creates useful provider searches', () => {
  const pinterest = buildProviderSearch('pinterest', 'gothic anime girl');
  assert.match(pinterest, /^https:\/\/www\.pinterest\.com\/search\/pins\/\?q=/);
  assert.ok(pinterest.includes('gothic%20anime%20girl'));

  const cosmos = buildProviderSearch('cosmos', 'dark fantasy');
  assert.equal(cosmos, 'https://www.cosmos.so/search/elements/dark%20fantasy');

  const web = buildProviderSearch('web', 'character reference');
  assert.match(web, /google\.com\/search\?tbm=isch/);
});

test('extractFirstUrl finds a shared URL inside text', () => {
  assert.equal(
    extractFirstUrl('Check this out https://www.pinterest.com/pin/987654/?utm_source=share thanks'),
    'https://www.pinterest.com/pin/987654/?utm_source=share',
  );
  assert.equal(extractFirstUrl('no link here'), '');
});

test('normalizeRemoteUrl only allows http and https', () => {
  assert.equal(normalizeRemoteUrl('javascript:alert(1)'), '');
  assert.equal(normalizeRemoteUrl('file:///tmp/image.png'), '');
  assert.equal(normalizeRemoteUrl('/image.jpg', 'https://example.com/page'), 'https://example.com/image.jpg');
});

test('mergeCandidates normalizes and de-duplicates image candidates', () => {
  const images = mergeCandidates([
    { url: '/a.jpg', title: 'A', width: 800, height: 1200 },
    { url: 'https://example.com/a.jpg', title: 'Duplicate A' },
    { url: 'https://example.com/b.png', title: 'B' },
  ], { url: 'https://example.com/page', provider: 'web' });
  assert.equal(images.length, 2);
  assert.equal(images[0].url, 'https://example.com/a.jpg');
  assert.equal(images[1].url, 'https://example.com/b.png');
});

test('browse targets expose expected board/reference destinations', () => {
  assert.ok(BROWSE_TARGETS.length >= 10);
  assert.equal(targetById('inbox').placement, 'inbox');
  assert.equal(targetById('face').role, 'face');
  assert.equal(targetById('face').reference, true);
  assert.equal(targetById('style').purpose, 'style');
  assert.equal(targetById('generation').studio, true);
  assert.equal(targetById('missing').id, 'inbox');
});

test('candidateFilename produces safe practical image filenames', () => {
  assert.equal(
    candidateFilename({ title: 'Red Witch / Portrait!', provider: 'pinterest', url: 'https://i.pinimg.com/originals/x/y/file.jpeg' }, 'image/jpeg'),
    'Red-Witch-Portrait.jpg',
  );
  assert.equal(candidateFilename({ title: '', provider: 'cosmos', url: 'https://example.com/noext' }, 'image/png'), 'cosmos-reference.png');
});

test('sourceNote preserves description and original page', () => {
  const note = sourceNote({ description: 'Reference description', pageUrl: 'https://www.cosmos.so/e/abc' });
  assert.match(note, /Reference description/);
  assert.match(note, /Source: https:\/\/www\.cosmos\.so\/e\/abc/);
});

test('isLikelyImageUrl catches direct images', () => {
  assert.equal(isLikelyImageUrl('https://example.com/reference.webp'), true);
  assert.equal(isLikelyImageUrl('https://i.pinimg.com/736x/aa/bb/cc/photo.jpg'), true);
  assert.equal(isLikelyImageUrl('https://example.com/gallery'), false);
});

test('foldLayoutMode distinguishes unfolded portrait Fold from phone and desktop', () => {
  assert.equal(foldLayoutMode({ width: 690, height: 1000, orientation: 'portrait-primary' }), 'fold-portrait');
  assert.equal(foldLayoutMode({ width: 390, height: 850, orientation: 'portrait-primary' }), 'phone');
  assert.equal(foldLayoutMode({ width: 1440, height: 900, orientation: 'landscape-primary' }), 'desktop');
  assert.equal(foldLayoutMode({ width: 800, height: 700, orientation: 'landscape-primary' }), 'tablet');
});
