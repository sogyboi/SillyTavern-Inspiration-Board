import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const activityPath = new URL('../android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt', import.meta.url);
const manifestPath = new URL('../android-companion/app/src/main/AndroidManifest.xml', import.meta.url);
const gradlePath = new URL('../android-companion/app/build.gradle.kts', import.meta.url);
const activity = fs.readFileSync(activityPath, 'utf8');
const manifest = fs.readFileSync(manifestPath, 'utf8');
const gradle = fs.readFileSync(gradlePath, 'utf8');

test('native capture performs SillyTavern CSRF handshake before POST', () => {
  assert.match(activity, /\/csrf-token/);
  assert.match(activity, /X-CSRF-Token/);
  assert.match(activity, /Cookie/);
  assert.match(activity, /fetchCsrfSession\(server\)/);
});

test('native capture keeps real HTTP diagnostics instead of opening inputStream blindly', () => {
  assert.match(activity, /readConnectionText\(connection, code\)/);
  assert.match(activity, /SillyTavern HTTP \$code/);
  assert.doesNotMatch(activity, /connection\.inputStream\.takeIf/);
});

test('manifest launches the CSRF-aware v0.5.2 activity', () => {
  assert.match(manifest, /\.CaptureBrowserActivity/);
  assert.match(manifest, /inspirationboard/);
  assert.match(gradle, /versionName = "0\.5\.2"/);
});

test('native capture still preserves Android Share fallback', () => {
  assert.match(activity, /shareFallback\(context, target\)/);
  assert.match(activity, /IBCAPTURE_V1/);
  assert.match(activity, /Android Share fallback/);
});
