import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_BROWSER_RELEASE,
  CAPTURE_BROWSER_VERSION,
  buildCaptureMarker,
  captureImportUrl,
  companionBrowseUrl,
  normalizeServerBase,
  parseCaptureMarker,
  providerExternalUrl,
  shouldInterceptQuickSave,
  targetLabel,
} from '../capture-browser-core-v5.js';

test('Capture Browser version and release point to v0.5.2', () => {
  assert.equal(CAPTURE_BROWSER_VERSION, '0.5.2');
  assert.match(CAPTURE_BROWSER_RELEASE, /capture-browser-v0\.5\.2$/);
});

test('normalizes local SillyTavern server URLs', () => {
  assert.equal(normalizeServerBase('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000');
  assert.equal(normalizeServerBase('https://example.com/st/#x'), 'https://example.com/st');
  assert.equal(normalizeServerBase('javascript:alert(1)'), '');
});

test('builds companion deep link with active board context and provider URL', () => {
  const value = companionBrowseUrl({
    provider: 'pinterest',
    server: 'http://127.0.0.1:8000/',
    boardId: 'board-12',
    boardName: 'Althea',
  });
  const url = new URL(value);
  assert.equal(url.protocol, 'inspirationboard:');
  assert.equal(url.hostname, 'browse');
  assert.equal(url.searchParams.get('provider'), 'pinterest');
  assert.equal(url.searchParams.get('server'), 'http://127.0.0.1:8000');
  assert.equal(url.searchParams.get('boardId'), 'board-12');
  assert.equal(url.searchParams.get('boardName'), 'Althea');
  assert.equal(url.searchParams.get('url'), 'https://www.pinterest.com/');
});

test('capture marker round trips target and source URLs', () => {
  const marker = buildCaptureMarker({
    target: 'outfit',
    boardId: 'board-a',
    boardName: 'My Character',
    provider: 'pinterest',
    page: 'https://www.pinterest.com/pin/123/',
    image: 'https://i.pinimg.com/originals/a/b/c/image.jpg',
  });
  const parsed = parseCaptureMarker(marker);
  assert.equal(parsed.target, 'outfit');
  assert.equal(parsed.boardId, 'board-a');
  assert.equal(parsed.boardName, 'My Character');
  assert.equal(parsed.provider, 'pinterest');
  assert.equal(parsed.page, 'https://www.pinterest.com/pin/123/');
  assert.equal(parsed.image, 'https://i.pinimg.com/originals/a/b/c/image.jpg');
});

test('capture import prefers selected image in companion marker', () => {
  const marker = parseCaptureMarker(buildCaptureMarker({
    page: 'https://www.pinterest.com/pin/42/',
    image: 'https://i.pinimg.com/originals/x/y/z.jpg',
  }));
  assert.equal(captureImportUrl({ url: 'https://fallback.example/page' }, marker), 'https://i.pinimg.com/originals/x/y/z.jpg');
});

test('marked quick save is detected while normal shares are untouched', () => {
  const normal = shouldInterceptQuickSave({ text: 'cool image', url: 'https://example.com/image.jpg' });
  assert.equal(normal, null);
  const text = buildCaptureMarker({ target: 'face', image: 'https://example.com/face.jpg' });
  const marked = shouldInterceptQuickSave({ text });
  assert.equal(marked.marker.target, 'face');
  assert.equal(marked.url, 'https://example.com/face.jpg');
});

test('provider and target labels have useful fallbacks', () => {
  assert.equal(providerExternalUrl('cosmos'), 'https://www.cosmos.so/');
  assert.equal(providerExternalUrl('unknown'), 'https://www.google.com/imghp');
  assert.equal(targetLabel('generation'), 'Generation Studio');
  assert.equal(targetLabel('custom'), 'custom');
});
