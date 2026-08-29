import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BLUEPRINT,
  STUDIO_VERSION,
  applyRecipeToDraft,
  buildGenerationPrompt,
  detectReferenceConflicts,
  ensureStudio,
  estimateGenerationCost,
  generationTree,
  getDailySpend,
  inferModelCapabilities,
  makeGenerationRecord,
  makePromptDraft,
  makeQueueJob,
  normalizeReferenceConfig,
  prioritizeReferences,
  recordSpend,
} from '../studio-core-v3.js';

test('ensureStudio adds a complete versioned workspace without replacing board data', () => {
  const board = { id: 'b1', name: 'Althea', items: [{ id: 'i1' }], character: {} };
  const studio = ensureStudio(board);
  assert.equal(studio.version, 3);
  assert.equal(STUDIO_VERSION, '0.5.7');
  assert.equal(board.items.length, 1);
  assert.equal(studio.promptDraft.recipeId, 'portrait');
  assert.ok(Array.isArray(studio.queue));
  assert.ok(Array.isArray(studio.generations));
  assert.equal(studio.settings.dailyLimit, 5);
});

test('reference configuration clamps strength and validates purpose', () => {
  assert.deepEqual(normalizeReferenceConfig({ purpose: 'hair', strength: 130, strictness: 'strict', mustPreserve: true }), {
    purpose: 'hair',
    strength: 100,
    strictness: 'strict',
    cropOnly: false,
    ignoreBackground: true,
    mustPreserve: true,
    notes: '',
  });
  assert.equal(normalizeReferenceConfig({ purpose: 'bad', strength: -5 }, 'identity').purpose, 'identity');
  assert.equal(normalizeReferenceConfig({ purpose: 'bad', strength: -5 }, 'identity').strength, 0);
});

test('recipes fill useful defaults while preserving user-entered fields', () => {
  const draft = { ...makePromptDraft(), pose: 'kneeling' };
  const next = applyRecipeToDraft(draft, 'full-body');
  assert.equal(next.recipeId, 'full-body');
  assert.equal(next.aspectRatio, '2:3');
  assert.equal(next.pose, 'kneeling');
  assert.match(next.camera, /full-body/i);
});

test('generation prompt combines blueprint, structured fields, chat and reference rules', () => {
  const draft = {
    ...makePromptDraft(),
    subject: 'Althea in a rainy alley',
    expression: 'quiet smile',
    useChatScene: true,
    negative: 'extra fingers',
    model: 'openai/gpt-image-1',
  };
  const built = buildGenerationPrompt({
    blueprint: {
      ...DEFAULT_BLUEPRINT,
      identity: 'adult dark-fantasy mage',
      face: 'narrow face, violet eyes',
      hair: 'long black wavy hair',
      mustKeep: 'violet eyes and crescent earrings',
    },
    draft,
    chatScene: 'Althea stands below a neon sign while rain falls.',
    references: [{ name: 'face.png', purpose: 'face', strength: 95, strictness: 'strict', mustPreserve: true }],
  });
  assert.match(built.prompt, /CHARACTER BLUEPRINT/);
  assert.match(built.prompt, /violet eyes/);
  assert.match(built.prompt, /CURRENT CHAT SCENE NOTES/);
  assert.match(built.prompt, /Reference 1/);
  assert.match(built.negative, /extra fingers/);
});

test('reference prioritization keeps must-preserve and high-strength references first', () => {
  const refs = [
    { name: 'mood', purpose: 'mood', strength: 100 },
    { name: 'face', purpose: 'face', strength: 70, mustPreserve: true },
    { name: 'hair', purpose: 'hair', strength: 90 },
  ];
  const result = prioritizeReferences(refs, 2);
  assert.equal(result[0].name, 'face');
  assert.equal(result[1].name, 'mood');
});

test('conflict detection catches competing color cues and missing identity', () => {
  const warnings = detectReferenceConflicts({
    blueprint: { ...DEFAULT_BLUEPRINT, hair: 'black hair' },
    draft: { subject: 'same character with blonde hair' },
    references: [
      { purpose: 'hair', notes: 'black hair', strength: 80, item: { name: 'black hair' } },
      { purpose: 'hair', notes: 'blonde hair', strength: 80, item: { name: 'blonde hair' } },
    ],
  });
  assert.ok(warnings.some(warning => warning.code === 'conflict-hair-color'));
  assert.ok(warnings.some(warning => warning.code === 'blueprint-hair-change'));
  assert.ok(warnings.some(warning => warning.code === 'no-identity'));
});

test('model capability inference distinguishes image-edit and text-only style clues', () => {
  const gptImage = inferModelCapabilities('openai/gpt-image-1');
  assert.equal(gptImage.imageInput, true);
  assert.equal(gptImage.editing, true);
  assert.equal(gptImage.maxReferences, 8);
  const anime = inferModelCapabilities('vendor/illustrious-anime-image');
  assert.equal(anime.promptStyle, 'tags');
  assert.equal(anime.imageOutput, true);
});

test('cost estimation and daily spend bookkeeping are deterministic', () => {
  const estimate = estimateGenerationCost({ modelMetadata: { priceSummary: { exactFlat: true, flatPerImage: 0.04 } }, count: 3 });
  assert.equal(estimate.known, true);
  assert.equal(estimate.total, 0.12);
  const studio = ensureStudio({ id: 'b', items: [], character: {} });
  recordSpend(studio, 0.12, Date.UTC(2026, 7, 28));
  recordSpend(studio, 0.08, Date.UTC(2026, 7, 28));
  assert.equal(getDailySpend(studio, Date.UTC(2026, 7, 28)), 0.2);
});

test('generation records form a parent-child variation tree', () => {
  const rootJob = makeQueueJob({ boardId: 'b', finalPrompt: 'root' });
  const root = makeGenerationRecord(rootJob, { id: 'g-root' });
  const childJob = makeQueueJob({ boardId: 'b', finalPrompt: 'variant', parentGenerationId: root.id });
  const child = makeGenerationRecord(childJob, { id: 'g-child' });
  const tree = generationTree([root, child]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 'g-root');
  assert.equal(tree[0].children[0].id, 'g-child');
});
