import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimateGenerationCost, getModelImagePrice, makeQueueJob } from '../studio-core-v3.js';
import { summarizeOpenRouterImagePricing } from '../studio-openrouter-v3.js';

const studioSource = fs.readFileSync(new URL('../studio-v3.js', import.meta.url), 'utf8');
const routerSource = fs.readFileSync(new URL('../studio-openrouter-v3.js', import.meta.url), 'utf8');

const payload = pricing => ({ data: { endpoints: [{ provider_name: 'test', pricing }] } });

test('flat output-image pricing becomes an exact per-picture price', () => {
  const summary = summarizeOpenRouterImagePricing(payload([
    { billable: 'output_image', unit: 'image', cost_usd: 0.04 },
    { billable: 'input_image', unit: 'image', cost_usd: 0.01 },
  ]));
  assert.equal(summary.label, '$0.04/img');
  assert.equal(summary.exactFlat, true);
  assert.equal(summary.flatPerImage, 0.04);
  assert.equal(summary.inputReferencePrice, 0.01);
  assert.equal(getModelImagePrice({ priceSummary: summary }), 0.04);
  assert.deepEqual(estimateGenerationCost({ modelMetadata: { priceSummary: summary }, count: 3 }), { known: true, perImage: 0.04, total: 0.12 });
});

test('quality/provider ranges are labeled from-price rather than falsely exact', () => {
  const summary = summarizeOpenRouterImagePricing({ data: { endpoints: [
    { pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }] },
    { pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.08 }] },
  ] } });
  assert.equal(summary.label, 'from $0.04/img');
  assert.equal(summary.exactFlat, false);
  assert.equal(summary.minimumPerImage, 0.04);
  assert.equal(getModelImagePrice({ priceSummary: summary }), null);
});

test('megapixel and token image pricing are not misreported as picture prices', () => {
  const mp = summarizeOpenRouterImagePricing(payload([{ billable: 'output_image', unit: 'megapixel', cost_usd: 0.03 }]));
  const token = summarizeOpenRouterImagePricing(payload([{ billable: 'output_image', unit: 'token', cost_usd: 0.00001 }]));
  assert.equal(mp.label, 'from $0.03/MP');
  assert.equal(token.label, 'token-priced');
  assert.equal(getModelImagePrice({ pricing: { image: 0.01, image_output: 0.00001 } }), null);
});

test('generation jobs persist transport lifecycle fields', () => {
  const job = makeQueueJob({ model: 'x-ai/test' });
  assert.equal(job.progressPhase, 'queued');
  assert.equal(job.dispatchedAt, null);
  assert.equal(job.responseAt, null);
  assert.equal(job.lastHttpStatus, null);
});

test('Studio exposes searchable model pricing and a persistent generation status chip', () => {
  assert.match(studioSource, /data-model-search/);
  assert.match(studioSource, /data-model-result/);
  assert.match(studioSource, /dataset\.ib3LiveJob/);
  assert.match(studioSource, /Request dispatched ✓/);
  assert.match(studioSource, /OpenRouter responded ✓/);
  assert.match(routerSource, /phase: 'dispatched'/);
  assert.match(routerSource, /phase: 'response'/);
  assert.match(routerSource, /api\/v1\/images\/models/);
});
