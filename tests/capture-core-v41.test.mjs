import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureProvider,
  extractCaptureUrl,
  filterCaptures,
  normalizeCaptureSettings,
  pickBestCandidate,
  providerLaunchUrl,
  quickTargetForProvider,
  relativeCaptureTime,
  shouldOfferClipboard,
  sortCandidates,
  summarizeBatch,
} from '../capture-core-v41.js';

test('normalizes capture settings and provider defaults', () => {
  const settings = normalizeCaptureSettings({ providerTargets: { pinterest: 'face', cosmos: 'bad-target' }, pollSeconds: 3 });
  assert.equal(settings.providerTargets.pinterest, 'face');
  assert.equal(settings.providerTargets.cosmos, 'inbox');
  assert.equal(settings.pollSeconds, 15);
  assert.equal(quickTargetForProvider(settings, 'pinterest').id, 'face');
});

test('detects provider and URL from Android share text', () => {
  const share = { text: 'Look at this https://www.pinterest.com/pin/12345/ nice' };
  assert.equal(extractCaptureUrl(share), 'https://www.pinterest.com/pin/12345/');
  assert.equal(captureProvider(share), 'pinterest');
  assert.equal(captureProvider({ url: 'https://www.cosmos.so/e/abc' }), 'cosmos');
});

test('provider launch URLs use native web destinations', () => {
  assert.match(providerLaunchUrl('pinterest', 'cyberpunk outfit'), /pinterest\.com\/search\/pins/);
  assert.match(providerLaunchUrl('cosmos', 'anime reference'), /cosmos\.so\/search\/elements/);
  assert.match(providerLaunchUrl('web', 'pose reference'), /google\.com\/search/);
});

test('candidate ranking favors originals and large og images', () => {
  const candidates = [
    { url: 'https://site.test/icon.png', source: 'img', width: 64, height: 64, title: 'logo' },
    { url: 'https://i.pinimg.com/736x/aa/bb/image.jpg', source: 'img', width: 736, height: 1000 },
    { url: 'https://i.pinimg.com/originals/aa/bb/image.jpg', source: 'og:image', width: 1400, height: 2000 },
  ];
  assert.equal(pickBestCandidate(candidates).url, candidates[2].url);
  assert.deepEqual(sortCandidates(candidates).map(item => item.url)[0], candidates[2].url);
});

test('clipboard helper ignores the same URL twice', () => {
  const url = 'https://www.pinterest.com/pin/99/';
  assert.equal(shouldOfferClipboard(url, ''), url);
  assert.equal(shouldOfferClipboard(url, url), '');
  assert.equal(shouldOfferClipboard('not a url', ''), '');
});

test('capture filters search and provider', () => {
  const captures = [
    { id: '1', title: 'Red jacket', url: 'https://www.pinterest.com/pin/1/' },
    { id: '2', title: 'Blue room', url: 'https://www.cosmos.so/e/2' },
  ];
  assert.equal(filterCaptures(captures, { query: 'jacket', provider: 'all' }).length, 1);
  assert.equal(filterCaptures(captures, { query: '', provider: 'cosmos' })[0].id, '2');
});

test('relative time is compact for mobile cards', () => {
  const now = 1_000_000;
  assert.equal(relativeCaptureTime(now - 30_000, now), 'just now');
  assert.equal(relativeCaptureTime(now - 5 * 60_000, now), '5m ago');
});

test('batch summary counts imports, failures, images and reuse', () => {
  assert.deepEqual(summarizeBatch([
    { ok: true, images: 2, reused: 1 },
    { ok: false },
    { ok: true, images: 1, reused: 0 },
  ]), { imported: 2, failed: 1, images: 3, reused: 1 });
});
