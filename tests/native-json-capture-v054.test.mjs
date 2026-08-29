import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const activity = fs.readFileSync(new URL('../android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/index.mjs', import.meta.url), 'utf8');
const pluginPackage = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/package.json', import.meta.url), 'utf8');
const start = activity.indexOf('private fun postCapture');
const end = activity.indexOf('private fun fetchCsrfSession');
const post = activity.slice(start, end);

test('native direct save uses JSON instead of multipart', () => {
  assert.match(post, /capture-native/);
  assert.match(post, /application\/json; charset=utf-8/);
  assert.match(post, /Base64\.encodeToString/);
  assert.doesNotMatch(post, /multipart\/form-data/);
  assert.doesNotMatch(post, /writeField\(/);
  assert.doesNotMatch(post, /writeFile\(/);
});

test('server plugin exposes CSRF-protected native JSON capture route', () => {
  assert.match(plugin, /router\.post\('\/capture-native', express\.json\(\{ limit: '20mb' \}\)/);
  assert.match(plugin, /native-json-capture/);
  assert.match(plugin, /MAX_NATIVE_IMAGE_BYTES = 12 \* 1024 \* 1024/);
  assert.match(plugin, /Could not save native capture/);
  assert.match(pluginPackage, /"version": "0\.5\.4"/);
});

test('native test warns when installed server plugin is too old', () => {
  assert.match(activity, /server plugin .* is too old; update inspiration-board-sync in Termux/);
  assert.match(activity, /native save ready/);
});
