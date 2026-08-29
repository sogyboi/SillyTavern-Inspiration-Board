import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt', import.meta.url), 'utf8');
const networkStart = source.indexOf('private fun postCapture');
const networkEnd = source.indexOf('private fun shareFallback');
const networkSection = source.slice(networkStart, networkEnd);

test('worker-thread networking never reads WebView or CookieManager directly', () => {
  assert.ok(networkStart > 0 && networkEnd > networkStart);
  assert.doesNotMatch(networkSection, /webView\./);
  assert.doesNotMatch(networkSection, /CookieManager\./);
  assert.match(networkSection, /browserUserAgent/);
  assert.match(networkSection, /cookieFor\(/);
  assert.match(networkSection, /storeCookies\(/);
});

test('UI bridge protects CookieManager access used by native networking', () => {
  assert.match(source, /Looper\.myLooper\(\) == Looper\.getMainLooper\(\)/);
  assert.match(source, /FutureTask<T>/);
  assert.match(source, /runOnUiThread\(task\)/);
  assert.match(source, /uiValue \{ CookieManager\.getInstance\(\)\.getCookie/);
  assert.match(source, /values\.forEach \{ manager\.setCookie/);
});
