import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isStyleReferenceModel,
  modelAspectRatios,
  modelBatchEstimate,
  modelOutputLimit,
  modelReferenceCapability,
} from '../openrouter-gen-v58.js';

const quickSource = fs.readFileSync(new URL('../openrouter-gen-v58.js', import.meta.url), 'utf8');
const launcherSource = fs.readFileSync(new URL('../launcher-v58.js', import.meta.url), 'utf8');
const bridgeSource = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/openrouter-images-v58.mjs', import.meta.url), 'utf8');
const pluginIndexSource = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/index.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const recraftStyle = {
  id: 'recraft/recraft-v4-styles-vector',
  name: 'Recraft V4 Styles Vector',
  dedicatedImage: {
    description: 'Style-consistent generation. Every generation requires at least one style reference image of at least 256 px.',
    supported_parameters: {
      input_references: { type: 'range', min: 1, max: 10 },
      n: { type: 'range', min: 1, max: 6 },
      aspect_ratio: { type: 'enum', values: ['1:1', '2:1', '1:2'] },
      output_format: { type: 'enum', values: ['svg'] },
    },
  },
};

test('Recraft-style capability uses live supported_parameters instead of model-name guesses', () => {
  assert.deepEqual(modelReferenceCapability(recraftStyle), { supported: true, required: true, min: 1, max: 10 });
  assert.equal(modelOutputLimit(recraftStyle), 6);
  assert.deepEqual(modelAspectRatios(recraftStyle), ['1:1', '2:1', '1:2']);
  assert.equal(isStyleReferenceModel(recraftStyle), true);
});

test('unsupported models do not advertise reference input', () => {
  assert.deepEqual(modelReferenceCapability({ dedicatedImage: { supported_parameters: {} } }), { supported: false, required: false, min: 0, max: 0 });
});

test('variable non-flat pricing never turns null into a fake zero-dollar batch estimate', () => {
  assert.equal(modelBatchEstimate({ priceSummary: { exactFlat: false, minimumPerImage: null } }, 2), null);
});

test('Quick Generate persists controls and prompt as they change', () => {
  assert.match(quickSource, /prompt:\s*''/);
  assert.match(quickSource, /modelSelect\.onchange/);
  assert.match(quickSource, /aspectSelect\.onchange = persist/);
  assert.match(quickSource, /countSelect\.onchange/);
  assert.match(quickSource, /promptInput\.addEventListener\('input'/);
  assert.match(quickSource, /MutationObserver/);
});

test('Quick Generate sends original image blobs and dedicated input_references', () => {
  assert.match(quickSource, /blobToDataUrl\(record\.blob\)/);
  assert.doesNotMatch(quickSource, /record\.thumbnail\s*\|\|\s*record\.blob/);
  assert.match(quickSource, /input_references/);
  assert.match(quickSource, /openrouter-images/);
  assert.match(quickSource, /supported_parameters/);
});

test('server bridge uses SillyTavern OpenRouter secret and canonical Images API', () => {
  assert.match(bridgeSource, /readSecret, SECRET_KEYS/);
  assert.match(bridgeSource, /SECRET_KEYS\.OPENROUTER/);
  assert.match(bridgeSource, /https:\/\/openrouter\.ai\/api\/v1\/images/);
  assert.match(bridgeSource, /input_references/);
});

test('server plugin and v0.5.8 Quick Generate bridge remain available under newer launchers', () => {
  assert.match(pluginIndexSource, /openrouter-image-api/);
  assert.match(pluginIndexSource, /installOpenRouterImagesBridge/);
  assert.match(launcherSource, /__ibOpenRouterTouchFallback/);
  assert.match(launcherSource, /stopImmediatePropagation/);
  assert.match(launcherSource, /openrouter-gen-v58\.js\?v=0\.5\.8/);
  assert.ok(['0.5.9', '0.6.0'].includes(manifest.version));
  assert.ok(['launcher-v59.js', 'launcher-v60.js'].includes(manifest.js));
});