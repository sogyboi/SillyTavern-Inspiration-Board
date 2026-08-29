import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const activity = fs.readFileSync(new URL('../android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/index.mjs', import.meta.url), 'utf8');

test('native v0.5.6 bypasses SillyTavern JSON body parsing with a private media type', () => {
  assert.match(activity, /application\/x-inspiration-board-capture/);
  assert.match(plugin, /application\/x-inspiration-board-capture/);
  assert.match(plugin, /for await \(const chunk of req\)/);
  assert.match(plugin, /MAX_NATIVE_REQUEST_BYTES = 20 \* 1024 \* 1024/);
  assert.doesNotMatch(plugin, /router\.post\('\/capture-native',\s*express\.json/);
});

test('settings Test performs the real CSRF-protected POST probe', () => {
  assert.match(plugin, /native-raw-capture/);
  assert.match(plugin, /body\.probe === true/);
  assert.match(activity, /sendNativePayload\(server, session, JSONObject\(\)\.put\("probe", true\)\)/);
  assert.match(activity, /POST save path verified/);
});

test('CSRF session cookie header de-duplicates cookie names with newest values winning', () => {
  assert.match(activity, /private fun mergeCookieHeader/);
  assert.match(activity, /cookies\[name\] = part/);
  assert.match(activity, /mergeCookieHeader\(existingCookie, setCookies\.joinToString/);
});
