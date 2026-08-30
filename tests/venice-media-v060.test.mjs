import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { veniceImagePrice, veniceModelIsUncensored, veniceModelTask } from '../venice-gen-v60.js';

const launcher = fs.readFileSync(new URL('../launcher-v60.js', import.meta.url), 'utf8');
const veniceUi = fs.readFileSync(new URL('../venice-gen-v60.js', import.meta.url), 'utf8');
const openRouterBrowser = fs.readFileSync(new URL('../openrouter-browser-v60.js', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/venice-media-v60.mjs', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/index.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const video = (id, model_type = 'text-to-video') => ({ id, type: 'video', model_spec: { name: id, constraints: { model_type } } });

test('v0.6.0 launcher exposes provider switching without importing the v0.5.9 capture handler', () => {
  assert.equal(manifest.version, '0.6.0');
  assert.equal(manifest.js, 'launcher-v60.js');
  assert.match(launcher, /openVeniceGenerator/);
  assert.match(launcher, /openOpenRouterGenerator/);
  assert.match(launcher, /st_inspiration_board_media_provider_v60/);
  assert.doesNotMatch(launcher, /import '.\/launcher-v59\.js/);
});

test('Venice model classification distinguishes video modes before generic model_type', () => {
  assert.equal(veniceModelTask(video('seedance-2-0-text-to-video')), 'text-to-video');
  assert.equal(veniceModelTask(video('seedance-2-0-image-to-video', 'image-to-video')), 'image-to-video');
  assert.equal(veniceModelTask(video('seedance-2-0-reference-to-video', 'image-to-video')), 'reference-to-video');
});

test('Venice uncensored filter uses traits plus explicit current model variants', () => {
  assert.equal(veniceModelIsUncensored({ id: 'lustify-v8', model_spec: {} }, {}), true);
  assert.equal(veniceModelIsUncensored({ id: 'qwen-edit-uncensored', model_spec: {} }, {}), true);
  assert.equal(veniceModelIsUncensored(video('wan-2-7-enhanced-text-to-video'), {}), true);
  assert.equal(veniceModelIsUncensored({ id: 'some-image', model_spec: {} }, { most_uncensored: 'some-image' }), true);
  assert.equal(veniceModelIsUncensored({ id: 'ordinary-safe-model', model_spec: {} }, {}), false);
});

test('Venice image price is read from live model_spec pricing', () => {
  assert.deepEqual(veniceImagePrice({ model_spec: { pricing: { generation: { usd: 0.01 } } } }), { min: 0.01, max: 0.01, exact: true });
  assert.deepEqual(veniceImagePrice({ _kind: 'inpaint', model_spec: { pricing: { inpaint: { usd: 0.04 } } } }), { min: 0.04, max: 0.04, exact: true });
});

test('Venice API key stays server-side in SillyTavern secret storage', () => {
  assert.match(bridge, /api_key_venice/);
  assert.match(bridge, /readSecret/);
  assert.match(bridge, /writeSecret/);
  assert.match(bridge, /deleteSecret/);
  assert.match(bridge, /router\.post\('\/venice\/key'/);
  assert.doesNotMatch(veniceUi, /Authorization:\s*`Bearer/);
});

test('Venice bridge covers live models, image generation and async video lifecycle', () => {
  assert.match(bridge, /\/models\?type=/);
  assert.match(bridge, /\/models\/traits\?type=/);
  assert.match(bridge, /\/image\/generate/);
  assert.match(bridge, /\/image\/edit/);
  assert.match(bridge, /\/image\/multi-edit/);
  assert.match(bridge, /\/video\/quote/);
  assert.match(bridge, /\/video\/queue/);
  assert.match(bridge, /\/video\/retrieve/);
  assert.match(bridge, /\/video\/complete/);
  assert.match(bridge, /referenceImageUrls/);
  assert.match(bridge, /reference_image_urls/);
  assert.match(bridge, /elements/);
  assert.match(bridge, /image_urls/);
});

test('Venice client exposes model search/sorting, NSFW filter, exact quote and video status', () => {
  assert.match(veniceUi, /Search Venice models/);
  assert.match(veniceUi, /Uncensored \/ NSFW-capable/);
  assert.match(veniceUi, /Price · low to high/);
  assert.match(veniceUi, /Text → Video/);
  assert.match(veniceUi, /Image → Video/);
  assert.match(veniceUi, /Reference → Video/);
  assert.match(veniceUi, /Exact Venice quote/);
  assert.match(veniceUi, /jobStatus/);
  assert.match(veniceUi, /data-v-video-results/);
});

test('OpenRouter model browser avoids one giant unsorted list and labels moderation honestly', () => {
  assert.match(openRouterBrowser, /Search OpenRouter image models/);
  assert.match(openRouterBrowser, /Price · low to high/);
  assert.match(openRouterBrowser, /Reference-capable only/);
  assert.match(openRouterBrowser, /top_provider/);
  assert.match(openRouterBrowser, /is_moderated/);
  assert.match(openRouterBrowser, /Unmoderated/);
  assert.match(openRouterBrowser, /not a guarantee/);
});

test('server plugin advertises Venice media capability at v0.6.0', () => {
  assert.match(plugin, /const VERSION = '0\.6\.0'/);
  assert.match(plugin, /installVeniceMediaBridge/);
  assert.match(plugin, /venice-image-video/);
});
