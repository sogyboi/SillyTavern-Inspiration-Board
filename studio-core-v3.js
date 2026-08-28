export const STUDIO_VERSION = '0.3.0';

export const REFERENCE_PURPOSES = Object.freeze([
  'identity',
  'face',
  'hair',
  'body',
  'outfit',
  'accessory',
  'prop',
  'pose',
  'expression',
  'style',
  'mood',
  'environment',
]);

export const REFERENCE_PURPOSE_LABELS = Object.freeze({
  identity: 'Identity',
  face: 'Face',
  hair: 'Hair',
  body: 'Body / Build',
  outfit: 'Outfit',
  accessory: 'Accessory',
  prop: 'Prop / Weapon',
  pose: 'Pose',
  expression: 'Expression',
  style: 'Art Style',
  mood: 'Mood / Lighting',
  environment: 'Environment',
});

export const PROMPT_FIELDS = Object.freeze([
  'subject',
  'pose',
  'expression',
  'outfit',
  'action',
  'location',
  'camera',
  'lighting',
  'artStyle',
  'extra',
  'negative',
]);

export const DEFAULT_BLUEPRINT = Object.freeze({
  identity: '',
  face: '',
  hair: '',
  body: '',
  outfit: '',
  accessories: '',
  palette: '',
  artStyle: '',
  mustKeep: '',
  mayChange: 'Clothing, expression, pose, camera angle, lighting, and location may change unless a generation request says otherwise.',
  avoid: 'Do not merge characters, change the character identity, add text or watermarks, or create a collage.',
  notes: '',
});

export const DEFAULT_STUDIO_SETTINGS = Object.freeze({
  maxReferences: 8,
  warnCost: 0.10,
  hardJobLimit: 1.00,
  dailyLimit: 5.00,
  autoFallback: true,
  retryWithoutReferences: true,
  retrySquare: true,
  queueConcurrency: 1,
  keepGenerationHistory: 120,
  addResultsTo: 'board',
  autoFavoriteBest: false,
  modelMetadataUrl: 'https://openrouter.ai/api/v1/models?output_modalities=image',
  serverSyncEnabled: false,
  serverWorkspaceId: '',
  syncAllBoards: true,
  shareTargetPolling: true,
  backgroundTolerance: 46,
  backgroundFeather: 2,
});

const RECIPE_LIST = [
  {
    id: 'portrait',
    name: 'Main Portrait',
    icon: '◉',
    aspectRatio: '3:4',
    description: 'A polished bust or waist-up portrait for a character card.',
    fields: { camera: 'waist-up portrait, eye-level camera, centered composition', lighting: 'soft cinematic key light and subtle rim light' },
    instruction: 'Create a polished single-character portrait. Keep the face and identity highly consistent with the identity references.',
  },
  {
    id: 'full-body',
    name: 'Full Body',
    icon: '♙',
    aspectRatio: '2:3',
    description: 'Full-body character art with a readable silhouette.',
    fields: { camera: 'full-body framing, entire character visible from head to feet', pose: 'natural readable standing pose' },
    instruction: 'Create a single full-body character illustration with the entire body visible and no cropped feet.',
  },
  {
    id: 'card-art',
    name: 'Character Card Art',
    icon: '◆',
    aspectRatio: '2:3',
    description: 'Dramatic vertical art suitable for a character card.',
    fields: { camera: 'dynamic vertical composition', lighting: 'dramatic fantasy lighting, clear focal point' },
    instruction: 'Create dramatic character card artwork with one clear subject and enough negative space for optional UI framing. Do not add text.',
  },
  {
    id: 'avatar',
    name: 'Avatar',
    icon: '●',
    aspectRatio: '1:1',
    description: 'Square close-up avatar with a strong face read.',
    fields: { camera: 'close-up face portrait, square composition, face centered', expression: 'clear readable expression' },
    instruction: 'Create a square avatar. Preserve facial identity and avoid cropping important hair or accessories.',
  },
  {
    id: 'expression-sheet',
    name: 'Expression Sheet',
    icon: '☺',
    aspectRatio: '4:3',
    description: 'Several expressions arranged as a clean reference sheet.',
    fields: { camera: 'clean character expression reference sheet', extra: 'six distinct facial expressions, consistent head angle and identity' },
    instruction: 'Create a clean expression reference sheet of the same character. Keep identity, hair, and outfit consistent across every expression. No labels or text.',
  },
  {
    id: 'outfit-sheet',
    name: 'Outfit Concepts',
    icon: '♜',
    aspectRatio: '4:3',
    description: 'Multiple outfit ideas while preserving character identity.',
    fields: { camera: 'fashion concept sheet, full-body front views', extra: 'four distinct outfit variations with a shared design language' },
    instruction: 'Create an outfit concept sheet for the same character. Keep face, hair, body, and signature accessories consistent. No text or labels.',
  },
  {
    id: 'pose-sheet',
    name: 'Pose Sheet',
    icon: '⌁',
    aspectRatio: '4:3',
    description: 'Several readable poses for animation or roleplay art.',
    fields: { camera: 'clean pose reference sheet', extra: 'six distinct full-body poses, consistent character design' },
    instruction: 'Create a pose sheet of one consistent character. Keep clothing and identity unchanged across all poses. No text.',
  },
  {
    id: 'turnaround',
    name: 'Turnaround',
    icon: '↻',
    aspectRatio: '16:9',
    description: 'Front, side, three-quarter, and back design views.',
    fields: { camera: 'orthographic character turnaround sheet', extra: 'front, three-quarter, side, and back views, neutral pose' },
    instruction: 'Create a production-style turnaround sheet with consistent proportions and design across views. No text or labels.',
  },
  {
    id: 'chibi',
    name: 'Chibi Version',
    icon: '✿',
    aspectRatio: '1:1',
    description: 'A simplified chibi version that keeps key identity traits.',
    fields: { artStyle: 'cute polished chibi character art', pose: 'energetic compact pose' },
    instruction: 'Create a chibi interpretation while preserving the recognizable face, hair, palette, outfit motifs, and signature accessories.',
  },
  {
    id: 'sprite-concept',
    name: 'Sprite Concept',
    icon: '▦',
    aspectRatio: '1:1',
    description: 'Readable game sprite concept with a clear silhouette.',
    fields: { artStyle: 'clean game sprite concept, readable silhouette, limited detail', camera: 'three-quarter full-body view' },
    instruction: 'Create a clean game sprite concept on a simple or transparent-looking background. Do not add text or UI.',
  },
  {
    id: 'scene',
    name: 'Character Scene',
    icon: '▣',
    aspectRatio: '16:9',
    description: 'The character placed naturally in a complete environment.',
    fields: { camera: 'cinematic environmental composition', lighting: 'scene-appropriate cinematic lighting' },
    instruction: 'Create a coherent scene with the character naturally integrated into the environment. Keep identity consistent and avoid a pasted-on look.',
  },
  {
    id: 'chat-scene',
    name: 'Current Chat Scene',
    icon: '☵',
    aspectRatio: '16:9',
    description: 'Build a visual prompt from the latest SillyTavern chat messages.',
    fields: { camera: 'cinematic scene composition', extra: 'follow the current roleplay scene details' },
    instruction: 'Illustrate the current roleplay scene. Prioritize visible actions, character positions, setting, time, weather, and lighting from the supplied chat scene notes.',
    usesChat: true,
  },
  {
    id: 'background',
    name: 'Background Only',
    icon: '▤',
    aspectRatio: '16:9',
    description: 'Generate scenery without a character.',
    fields: { camera: 'wide establishing shot', extra: 'environment only, no people or characters' },
    instruction: 'Create an environment-only image. Do not include people, characters, text, or UI.',
    ignoreIdentity: true,
  },
  {
    id: 'transparent',
    name: 'Transparent Asset',
    icon: '◇',
    aspectRatio: '2:3',
    description: 'A clean character asset intended for background removal.',
    fields: { camera: 'full-body isolated character', extra: 'plain high-contrast background, clean edges, no cast shadow' },
    instruction: 'Create one isolated full-body character with clean edges and no environment. Use a plain high-contrast background suitable for removal. Do not add text.',
  },
  {
    id: 'wallpaper',
    name: 'Phone Wallpaper',
    icon: '▯',
    aspectRatio: '9:16',
    description: 'Tall composition designed for a phone screen.',
    fields: { camera: 'vertical phone-wallpaper composition', extra: 'leave breathing room near the top and bottom for phone UI' },
    instruction: 'Create a tall phone wallpaper with the subject placed away from common clock and navigation UI areas. No text.',
  },
  {
    id: 'alternate-form',
    name: 'Alternate Form',
    icon: '✦',
    aspectRatio: '2:3',
    description: 'An evolution or alternate version that still reads as the same character.',
    fields: { extra: 'alternate form or evolution, stronger design motifs and effects' },
    instruction: 'Create an alternate or evolved form of the same character. Preserve core facial identity, hair identity, palette anchors, and signature motifs while making the requested changes clear.',
  },
  {
    id: 'edit',
    name: 'Reference Edit',
    icon: '✎',
    aspectRatio: '1:1',
    description: 'Edit a supplied image while preserving everything else.',
    fields: {},
    instruction: 'Edit the supplied reference image according to the request. Preserve all unrequested details, composition, and identity as closely as possible.',
    editMode: true,
  },
  {
    id: 'outpaint',
    name: 'Outpaint',
    icon: '↔',
    aspectRatio: '16:9',
    description: 'Extend an existing image beyond its current edges.',
    fields: {},
    instruction: 'Extend the supplied image naturally into the blank or transparent surrounding area. Preserve the original central image and continue lighting, perspective, environment, and style seamlessly.',
    editMode: true,
  },
  {
    id: 'remove-background-ai',
    name: 'AI Background Removal',
    icon: '◌',
    aspectRatio: '2:3',
    description: 'Regenerate an isolated subject on a plain removable background.',
    fields: { extra: 'isolated subject, plain solid contrasting background, clean silhouette, no shadows' },
    instruction: 'Recreate the supplied subject exactly while removing the original environment. Put the subject on a plain solid contrasting background with clean edges and no cast shadow.',
    editMode: true,
  },
];

export const GENERATION_RECIPES = Object.freeze(Object.fromEntries(RECIPE_LIST.map(recipe => [recipe.id, Object.freeze(recipe)])));
export const GENERATION_RECIPE_LIST = Object.freeze(RECIPE_LIST);

const COLOR_WORDS = [
  'black', 'white', 'silver', 'gray', 'grey', 'red', 'crimson', 'scarlet', 'orange', 'gold', 'yellow',
  'green', 'teal', 'cyan', 'blue', 'navy', 'indigo', 'violet', 'purple', 'pink', 'magenta', 'brown',
  'blonde', 'blond', 'auburn', 'ginger', 'turquoise', 'lavender', 'emerald', 'amber', 'hazel',
];

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function uid(prefix = 'studio') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampNumber(value, min, max, fallback = min) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map(entry => entry.trim()).filter(Boolean);
  return String(value || '')
    .split(/[\n,;|]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function normalizeBlueprint(input = {}) {
  const blueprint = { ...DEFAULT_BLUEPRINT, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(DEFAULT_BLUEPRINT)) blueprint[key] = String(blueprint[key] || '').trim();
  return blueprint;
}

export function normalizeReferenceConfig(input = {}, fallbackPurpose = 'identity') {
  const purpose = REFERENCE_PURPOSES.includes(input?.purpose) ? input.purpose : fallbackPurpose;
  return {
    purpose,
    strength: clampNumber(input?.strength, 0, 100, 75),
    strictness: ['loose', 'balanced', 'strict'].includes(input?.strictness) ? input.strictness : 'balanced',
    cropOnly: Boolean(input?.cropOnly),
    ignoreBackground: input?.ignoreBackground !== false,
    mustPreserve: Boolean(input?.mustPreserve),
    notes: String(input?.notes || '').trim(),
  };
}

export function makePromptDraft() {
  return {
    recipeId: 'portrait',
    subject: '',
    pose: '',
    expression: '',
    outfit: '',
    action: '',
    location: '',
    camera: '',
    lighting: '',
    artStyle: '',
    extra: '',
    negative: '',
    aspectRatio: '3:4',
    count: 1,
    model: 'openai/gpt-image-1',
    destination: 'board',
    useBlueprint: true,
    useChatScene: false,
    referenceMode: 'configured',
    showAdvanced: false,
    parentGenerationId: null,
  };
}

export function ensureStudio(board) {
  if (!board || typeof board !== 'object') throw new Error('A board is required.');
  const current = board.studio && typeof board.studio === 'object' ? board.studio : {};
  current.version = 3;
  current.blueprint = normalizeBlueprint(current.blueprint);
  current.referenceConfig = current.referenceConfig && typeof current.referenceConfig === 'object' ? current.referenceConfig : {};
  for (const [itemId, value] of Object.entries(current.referenceConfig)) {
    current.referenceConfig[itemId] = normalizeReferenceConfig(value, value?.purpose || 'identity');
  }
  current.promptDraft = { ...makePromptDraft(), ...(current.promptDraft || {}) };
  current.modelPresets = current.modelPresets && typeof current.modelPresets === 'object' ? current.modelPresets : {};
  current.queue = Array.isArray(current.queue) ? current.queue : [];
  current.generations = Array.isArray(current.generations) ? current.generations : [];
  current.gallery = Array.isArray(current.gallery) ? current.gallery : [];
  current.multiCharacterSlots = Array.isArray(current.multiCharacterSlots) ? current.multiCharacterSlots : [];
  current.dailySpend = current.dailySpend && typeof current.dailySpend === 'object' ? current.dailySpend : {};
  current.sync = current.sync && typeof current.sync === 'object' ? current.sync : {};
  current.settings = { ...DEFAULT_STUDIO_SETTINGS, ...(current.settings || {}) };
  current.queueState = {
    paused: Boolean(current.queueState?.paused),
    runningJobId: current.queueState?.runningJobId || null,
    updatedAt: Number(current.queueState?.updatedAt) || Date.now(),
  };
  board.studio = current;
  return current;
}

export function referencePurposeFromRole(role = 'general') {
  const mapping = {
    general: 'identity',
    face: 'face',
    hair: 'hair',
    body: 'body',
    outfit: 'outfit',
    expression: 'expression',
    accessory: 'accessory',
    prop: 'prop',
    mood: 'mood',
    environment: 'environment',
  };
  return mapping[role] || 'identity';
}

export function getReferenceConfig(board, item) {
  const studio = ensureStudio(board);
  const fallback = referencePurposeFromRole(item?.role);
  const existing = studio.referenceConfig[item?.id];
  const normalized = normalizeReferenceConfig(existing, fallback);
  studio.referenceConfig[item?.id] = normalized;
  return normalized;
}

export function recipeById(recipeId) {
  return GENERATION_RECIPES[recipeId] || GENERATION_RECIPES.portrait;
}

export function applyRecipeToDraft(draft, recipeId, { preserveUserFields = true } = {}) {
  const recipe = recipeById(recipeId);
  const next = { ...makePromptDraft(), ...(draft || {}) };
  next.recipeId = recipe.id;
  next.aspectRatio = recipe.aspectRatio || next.aspectRatio;
  for (const [field, value] of Object.entries(recipe.fields || {})) {
    if (!preserveUserFields || !String(next[field] || '').trim()) next[field] = value;
  }
  if (recipe.usesChat) next.useChatScene = true;
  return next;
}

export function inferPromptStyle(modelId = '') {
  const id = String(modelId).toLowerCase();
  if (/stable|sdxl|pony|illustrious|nai|novel|anime/.test(id)) return 'tags';
  if (/flux|ideogram/.test(id)) return 'structured';
  return 'natural';
}

export function inferModelCapabilities(modelId = '', metadata = null) {
  const id = String(modelId || metadata?.id || '').toLowerCase();
  const inputModalities = metadata?.architecture?.input_modalities || metadata?.input_modalities || [];
  const outputModalities = metadata?.architecture?.output_modalities || metadata?.output_modalities || [];
  const explicitImageInput = Array.isArray(inputModalities) && inputModalities.includes('image');
  const explicitImageOutput = Array.isArray(outputModalities) && outputModalities.includes('image');
  const imageInput = explicitImageInput || /gpt-image|image-1|image-2|gemini.*image|grok.*image|grok-imagine|seedream|flux.*kontext|qwen.*image.*edit|edit/.test(id);
  const imageOutput = explicitImageOutput || /image|imagine|seedream|flux|ideogram|recraft|dall-e|dalle/.test(id);
  const editing = /gpt-image|image-1|image-2|gemini.*image|grok.*image|grok-imagine|flux.*kontext|edit|seedream/.test(id);
  const multiReference = /gpt-image|image-1|image-2|gemini.*image|grok.*image|grok-imagine|flux.*kontext|seedream/.test(id);
  const transparency = /gpt-image|image-1|image-2|recraft|transparent/.test(id);
  const likelyModeration = /openai|google|gemini|x-ai|grok/.test(id) ? 'standard' : 'provider';
  let maxReferences = imageInput ? 4 : 0;
  if (/gpt-image|image-1|image-2|gemini.*image/.test(id)) maxReferences = 8;
  if (/flux.*kontext/.test(id)) maxReferences = 2;
  return {
    id: modelId,
    imageInput,
    imageOutput,
    editing,
    multiReference,
    transparency,
    maxReferences,
    promptStyle: inferPromptStyle(modelId),
    moderation: likelyModeration,
    supportsAspectRatio: true,
  };
}

export function parsePriceNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getModelImagePrice(metadata = {}) {
  const pricing = metadata?.pricing || metadata?.cost || {};
  const candidates = [
    pricing.image,
    pricing.images,
    pricing.request,
    pricing.output_image,
    pricing.image_output,
    metadata?.image_price,
    metadata?.price_per_image,
  ];
  for (const value of candidates) {
    const parsed = parsePriceNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function estimateGenerationCost({ modelMetadata = null, count = 1, fallbackPrice = null } = {}) {
  const price = getModelImagePrice(modelMetadata) ?? parsePriceNumber(fallbackPrice);
  if (price === null) return { known: false, perImage: null, total: null };
  const total = price * Math.max(1, Number(count) || 1);
  return { known: true, perImage: price, total };
}

export function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Unknown';
  if (number < 0.01) return `$${number.toFixed(4)}`;
  return `$${number.toFixed(2)}`;
}

export function buildReferenceInstruction(reference) {
  const purpose = REFERENCE_PURPOSE_LABELS[reference.purpose] || reference.purpose || 'Reference';
  const strength = clampNumber(reference.strength, 0, 100, 75);
  const strictness = reference.strictness || 'balanced';
  const rules = [];
  if (reference.mustPreserve) rules.push('must preserve');
  if (reference.cropOnly) rules.push('use only the visible crop');
  if (reference.ignoreBackground) rules.push('ignore its background');
  if (reference.notes) rules.push(reference.notes);
  return `${purpose} reference; influence ${strength}%; ${strictness}${rules.length ? `; ${rules.join('; ')}` : ''}`;
}

function nonEmptyLine(label, value) {
  const text = String(value || '').trim();
  return text ? `${label}: ${text}` : '';
}

export function buildGenerationPrompt({
  blueprint = DEFAULT_BLUEPRINT,
  draft = makePromptDraft(),
  recipeId = draft.recipeId,
  references = [],
  chatScene = '',
  characterSlots = [],
  modelId = draft.model,
  modelPreset = null,
} = {}) {
  const bp = normalizeBlueprint(blueprint);
  const recipe = recipeById(recipeId);
  const style = modelPreset?.promptStyle || inferPromptStyle(modelId);
  const useBlueprint = draft.useBlueprint !== false && !recipe.ignoreIdentity;
  const sections = [];

  sections.push(recipe.instruction);

  if (useBlueprint) {
    const blueprintLines = [
      nonEmptyLine('Identity', bp.identity),
      nonEmptyLine('Face', bp.face),
      nonEmptyLine('Hair', bp.hair),
      nonEmptyLine('Body / build', bp.body),
      nonEmptyLine('Default outfit', bp.outfit),
      nonEmptyLine('Signature accessories', bp.accessories),
      nonEmptyLine('Color palette', bp.palette),
      nonEmptyLine('Canonical art style', bp.artStyle),
      nonEmptyLine('Must keep', bp.mustKeep),
      nonEmptyLine('May change', bp.mayChange),
      nonEmptyLine('Blueprint notes', bp.notes),
    ].filter(Boolean);
    if (blueprintLines.length) sections.push(`CHARACTER BLUEPRINT\n${blueprintLines.join('\n')}`);
  }

  if (characterSlots.length) {
    const slotText = characterSlots.map((slot, index) => {
      const lines = [
        `Character ${index + 1}: ${slot.name || `Character ${index + 1}`}`,
        slot.position ? `Position / role in scene: ${slot.position}` : '',
        slot.action ? `Action: ${slot.action}` : '',
        slot.blueprint ? `Blueprint: ${slot.blueprint}` : '',
      ].filter(Boolean);
      return lines.join('\n');
    }).join('\n\n');
    sections.push(`MULTI-CHARACTER SCENE\n${slotText}\nKeep every character visually distinct. Do not merge faces, bodies, clothing, or accessories.`);
  }

  const requestLines = [
    nonEmptyLine('Subject', draft.subject),
    nonEmptyLine('Pose', draft.pose),
    nonEmptyLine('Expression', draft.expression),
    nonEmptyLine('Outfit', draft.outfit),
    nonEmptyLine('Action', draft.action),
    nonEmptyLine('Location', draft.location),
    nonEmptyLine('Camera / composition', draft.camera),
    nonEmptyLine('Lighting', draft.lighting),
    nonEmptyLine('Art style', draft.artStyle),
    nonEmptyLine('Extra instructions', draft.extra),
  ].filter(Boolean);
  if (requestLines.length) sections.push(`IMAGE REQUEST\n${requestLines.join('\n')}`);

  if (draft.useChatScene && String(chatScene || '').trim()) {
    sections.push(`CURRENT CHAT SCENE NOTES\n${String(chatScene).trim()}\nUse only visible scene details. Ignore dialogue that cannot be shown in a still image.`);
  }

  if (references.length) {
    const refLines = references.map((reference, index) => `Reference ${index + 1}${reference.name ? ` (${reference.name})` : ''}: ${buildReferenceInstruction(reference)}`);
    sections.push(`REFERENCE RULES\n${refLines.join('\n')}\nReferences are guides, not collage panels. Use identity references for identity, style references for rendering style, and scene references for environment only.`);
  }

  const avoid = [bp.avoid, draft.negative, modelPreset?.negative].filter(Boolean).join(', ');
  if (avoid) sections.push(`AVOID\n${avoid}`);

  let prompt = sections.join('\n\n').trim();
  const prefix = String(modelPreset?.prefix || '').trim();
  if (prefix) prompt = `${prefix}\n\n${prompt}`;

  if (style === 'tags') {
    prompt = prompt
      .replace(/\n+/g, ', ')
      .replace(/:\s*/g, ', ')
      .replace(/\s{2,}/g, ' ')
      .replace(/,+/g, ',')
      .trim();
  } else if (style === 'structured') {
    prompt = `Create one finished image using this structured brief.\n\n${prompt}`;
  }

  return {
    prompt,
    negative: avoid,
    promptStyle: style,
    recipe,
  };
}

function wordsFrom(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function colorsIn(value) {
  const words = new Set(wordsFrom(value));
  return COLOR_WORDS.filter(color => words.has(color));
}

function descriptorsForItem(item = {}) {
  return [item.name, item.notes, item.tags?.join(' '), item.generated?.prompt, item.sourceUrl].filter(Boolean).join(' ');
}

export function detectReferenceConflicts({ blueprint = DEFAULT_BLUEPRINT, references = [], draft = {} } = {}) {
  const warnings = [];
  const bp = normalizeBlueprint(blueprint);
  const byPurpose = new Map();
  for (const reference of references) {
    const list = byPurpose.get(reference.purpose) || [];
    list.push(reference);
    byPurpose.set(reference.purpose, list);
  }

  for (const purpose of ['hair', 'face', 'identity', 'outfit']) {
    const list = byPurpose.get(purpose) || [];
    const colorSets = list.map(reference => ({ reference, colors: colorsIn(`${reference.notes || ''} ${descriptorsForItem(reference.item)}`) })).filter(entry => entry.colors.length);
    const unique = [...new Set(colorSets.flatMap(entry => entry.colors))];
    if (unique.length > 1) warnings.push({ level: 'warning', code: `conflict-${purpose}-color`, message: `${REFERENCE_PURPOSE_LABELS[purpose]} references contain several color cues: ${unique.join(', ')}. Set one reference to Strict or clarify the blueprint.` });
  }

  const blueprintHair = colorsIn(bp.hair);
  const requestedHair = colorsIn(`${draft.subject || ''} ${draft.extra || ''}`);
  if (blueprintHair.length && requestedHair.length && !requestedHair.some(color => blueprintHair.includes(color))) {
    warnings.push({ level: 'warning', code: 'blueprint-hair-change', message: `The request mentions ${requestedHair.join(', ')} while the blueprint hair mentions ${blueprintHair.join(', ')}.` });
  }

  const blueprintFace = colorsIn(bp.face);
  const requestedFace = colorsIn(`${draft.subject || ''} ${draft.extra || ''}`);
  if (blueprintFace.length && requestedFace.length && !requestedFace.some(color => blueprintFace.includes(color))) {
    warnings.push({ level: 'info', code: 'blueprint-face-color', message: 'The request may conflict with face or eye color cues in the blueprint.' });
  }

  const strictReferences = references.filter(reference => reference.strictness === 'strict' || reference.mustPreserve);
  if (strictReferences.length > 4) warnings.push({ level: 'info', code: 'many-strict', message: 'Many references are marked Strict or Must Preserve. Some models may struggle to satisfy every constraint.' });
  if (references.length > 8) warnings.push({ level: 'warning', code: 'too-many-references', message: 'More than eight references are selected. The generator will trim them based on strength and purpose.' });
  if (!references.some(reference => ['identity', 'face'].includes(reference.purpose)) && !String(bp.identity || bp.face).trim()) {
    warnings.push({ level: 'info', code: 'no-identity', message: 'No identity or face reference is configured. Character consistency may be weaker.' });
  }
  return warnings;
}

export function prioritizeReferences(references = [], maxReferences = 8) {
  const purposeOrder = ['identity', 'face', 'hair', 'body', 'outfit', 'accessory', 'prop', 'pose', 'expression', 'style', 'mood', 'environment'];
  const purposeRank = new Map(purposeOrder.map((purpose, index) => [purpose, index]));
  return [...references]
    .sort((a, b) => {
      if (Boolean(b.mustPreserve) !== Boolean(a.mustPreserve)) return Number(Boolean(b.mustPreserve)) - Number(Boolean(a.mustPreserve));
      if ((b.strength || 0) !== (a.strength || 0)) return (b.strength || 0) - (a.strength || 0);
      return (purposeRank.get(a.purpose) ?? 99) - (purposeRank.get(b.purpose) ?? 99);
    })
    .slice(0, Math.max(0, maxReferences));
}

export function makeQueueJob(input = {}) {
  const now = Date.now();
  return {
    id: uid('job'),
    boardId: input.boardId || null,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    attempt: 0,
    model: input.model || 'openai/gpt-image-1',
    modelMetadata: input.modelMetadata || null,
    recipeId: input.recipeId || 'portrait',
    aspectRatio: input.aspectRatio || '1:1',
    count: clampNumber(input.count, 1, 8, 1),
    promptDraft: { ...makePromptDraft(), ...(input.promptDraft || {}) },
    finalPrompt: input.finalPrompt || '',
    negative: input.negative || '',
    references: Array.isArray(input.references) ? clone(input.references) : [],
    characterSlots: Array.isArray(input.characterSlots) ? clone(input.characterSlots) : [],
    chatScene: String(input.chatScene || ''),
    destination: input.destination || 'board',
    parentGenerationId: input.parentGenerationId || null,
    estimatedCost: input.estimatedCost ?? null,
    actualCost: input.actualCost ?? null,
    resultImageIds: [],
    error: null,
    fallbackLog: [],
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
  };
}

export function makeGenerationRecord(job, overrides = {}) {
  return {
    id: uid('generation'),
    jobId: job.id,
    parentId: job.parentGenerationId || null,
    boardId: job.boardId,
    createdAt: Date.now(),
    model: job.model,
    recipeId: job.recipeId,
    aspectRatio: job.aspectRatio,
    prompt: job.finalPrompt,
    negative: job.negative,
    referenceSummary: job.references.map(reference => ({
      itemId: reference.itemId || reference.id || null,
      imageId: reference.imageId || null,
      name: reference.name || '',
      purpose: reference.purpose || 'identity',
      strength: reference.strength ?? 75,
      strictness: reference.strictness || 'balanced',
    })),
    resultImageIds: [...(job.resultImageIds || [])],
    estimatedCost: job.estimatedCost ?? null,
    actualCost: job.actualCost ?? null,
    favorite: false,
    rejected: false,
    notes: '',
    provider: 'openrouter',
    fallbackLog: [...(job.fallbackLog || [])],
    ...overrides,
  };
}

export function generationChildren(records = [], parentId = null) {
  return records.filter(record => (record.parentId || null) === (parentId || null));
}

export function generationTree(records = []) {
  const build = parentId => generationChildren(records, parentId).map(record => ({ ...record, children: build(record.id) }));
  return build(null);
}

export function dailySpendKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function recordSpend(studio, amount, timestamp = Date.now()) {
  if (!Number.isFinite(Number(amount))) return;
  const key = dailySpendKey(timestamp);
  studio.dailySpend[key] = (Number(studio.dailySpend[key]) || 0) + Number(amount);
  const keys = Object.keys(studio.dailySpend).sort().reverse();
  for (const stale of keys.slice(14)) delete studio.dailySpend[stale];
}

export function getDailySpend(studio, timestamp = Date.now()) {
  return Number(studio?.dailySpend?.[dailySpendKey(timestamp)]) || 0;
}

export function makeMultiCharacterSlot(input = {}) {
  return {
    id: input.id || uid('slot'),
    boardId: input.boardId || null,
    name: String(input.name || ''),
    position: String(input.position || ''),
    action: String(input.action || ''),
    referenceItemId: input.referenceItemId || null,
  };
}

export function sanitizeFilename(value, fallback = 'inspiration-board') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return clean || fallback;
}

export function parseCaptionTags(value, max = 24) {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim());
    const tags = Array.isArray(parsed) ? parsed : parsed.tags;
    if (Array.isArray(tags)) return [...new Set(tags.map(String).map(tag => tag.trim().toLowerCase()).filter(Boolean))].slice(0, max);
  } catch {}
  return [...new Set(text.split(/[\n,;|]+/).map(tag => tag.trim().toLowerCase()).filter(Boolean))].slice(0, max);
}

export function textSearchScore(item, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return 1;
  const haystack = [item.name, item.notes, item.collection, item.role, ...(item.tags || [])].filter(Boolean).join(' ').toLowerCase();
  if (haystack.includes(needle)) return 100;
  const terms = needle.split(/\s+/).filter(Boolean);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 10 : 0), 0);
}

export function dominantTags(items = [], limit = 12) {
  const counts = new Map();
  for (const item of items) {
    for (const tag of item.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

export function groupForSmartCluster(item) {
  if (item.type !== 'image') return item.type || 'other';
  const role = item.role || 'general';
  if (role !== 'general') return role;
  const text = `${item.name || ''} ${(item.tags || []).join(' ')} ${item.notes || ''}`.toLowerCase();
  for (const purpose of REFERENCE_PURPOSES) {
    if (text.includes(purpose)) return purpose;
  }
  return 'general';
}

export function cropPresets() {
  return [
    { id: 'avatar', name: 'Avatar', ratio: 1, width: 1024, height: 1024 },
    { id: 'portrait', name: 'Portrait', ratio: 3 / 4, width: 1152, height: 1536 },
    { id: 'bust', name: 'Bust', ratio: 4 / 5, width: 1024, height: 1280 },
    { id: 'card', name: 'Card Art', ratio: 2 / 3, width: 1024, height: 1536 },
    { id: 'wallpaper', name: 'Phone Wallpaper', ratio: 9 / 16, width: 1080, height: 1920 },
    { id: 'banner', name: 'Banner', ratio: 16 / 9, width: 1920, height: 1080 },
  ];
}
