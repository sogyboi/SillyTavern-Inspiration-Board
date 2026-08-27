import { ROLE_LABELS, ROLE_OPTIONS, allReferenceIds } from './core-v2.js';
import { blobToDataUrl, getImage } from './db-v2.js';

function cleanJsonText(text) {
  const value = String(text || '').trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || value).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);
  return candidate;
}

function normalizeResult(result, captions) {
  const normalized = {
    description: String(result?.description || ''),
    personality: String(result?.personality || ''),
    scenario: String(result?.scenario || ''),
    creator_notes: String(result?.creator_notes || ''),
    tags: Array.isArray(result?.tags) ? result.tags.map(String).filter(Boolean).slice(0, 24) : [],
    captions,
    generatedAt: Date.now(),
  };
  if (!normalized.creator_notes) {
    normalized.creator_notes = captions.map(entry => `${ROLE_LABELS[entry.role] || entry.role}: ${entry.caption}`).join('\n\n');
  }
  return normalized;
}

export async function analyzeCharacterReferences({ board, getItemById, maxImages = 6, onProgress = () => {} }) {
  const context = globalThis.SillyTavern?.getContext?.();
  if (!context) throw new Error('SillyTavern context is not available.');

  let getMultimodalCaption;
  try {
    ({ getMultimodalCaption } = await import('../../shared.js'));
  } catch (error) {
    console.error('[Inspiration Board] Could not import multimodal helper', error);
    throw new Error('SillyTavern’s Image Captioning extension is unavailable. Enable and configure Image Captioning first.');
  }
  if (typeof getMultimodalCaption !== 'function') throw new Error('The configured SillyTavern version does not expose multimodal captioning.');

  const orderedIds = [];
  if (board.character.mainImageId) orderedIds.push(board.character.mainImageId);
  for (const role of ROLE_OPTIONS) {
    for (const id of board.character.references?.[role] || []) if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  const imageItems = orderedIds.map(getItemById).filter(item => item?.type === 'image').slice(0, maxImages);
  if (!imageItems.length) throw new Error('Add at least one image to the Character Reference Basket first.');

  const captions = [];
  for (let index = 0; index < imageItems.length; index++) {
    const item = imageItems[index];
    onProgress({ phase: 'vision', index, total: imageItems.length, message: `Analyzing ${index + 1} of ${imageItems.length}: ${item.name}` });
    const record = await getImage(item.imageId);
    if (!record?.blob) continue;
    const dataUrl = await blobToDataUrl(record.blob);
    const prompt = [
      'Analyze this image only as visual inspiration for creating a fictional roleplay character.',
      `The user categorized it as: ${ROLE_LABELS[item.role] || item.role}.`,
      'Describe visible design details concisely. Focus on appearance, hair, face, clothing, accessories, expression, pose, mood, lighting, and environment when relevant.',
      'Do not identify a real person or claim hidden facts. Do not infer sensitive traits. Return plain text under 180 words.',
    ].join(' ');
    const caption = await getMultimodalCaption(dataUrl, prompt);
    captions.push({ id: item.id, name: item.name, role: item.role, caption: String(caption || '').trim() });
  }

  if (!captions.length) throw new Error('No image analysis was returned. Check the Image Captioning model and API settings.');
  onProgress({ phase: 'draft', index: captions.length, total: captions.length, message: 'Building character suggestions…' });

  const current = board.character;
  const prompt = `You are helping design a fictional SillyTavern roleplay character from visual references.\n\nVISUAL NOTES:\n${captions.map((entry, i) => `${i + 1}. [${ROLE_LABELS[entry.role] || entry.role}] ${entry.caption}`).join('\n')}\n\nEXISTING USER TEXT (preserve useful choices and do not contradict them):\nName: ${current.name || '(none)'}\nDescription: ${current.description || '(none)'}\nPersonality: ${current.personality || '(none)'}\nScenario: ${current.scenario || '(none)'}\n\nReturn ONLY one valid JSON object with these keys:\n{\n  "description": "A concrete physical appearance and clothing description. No unsupported biography.",\n  "personality": "A suggested personality framed as inspiration, not facts derived from looks.",\n  "scenario": "A short optional roleplay scenario matching the visual mood.",\n  "creator_notes": "Useful design notes and any contradictions between references.",\n  "tags": ["short", "searchable", "tags"]\n}\nKeep each text field under 220 words. Do not use markdown fences.`;

  let generated = '';
  try {
    if (typeof context.generateQuietPrompt === 'function') {
      generated = await context.generateQuietPrompt({ quietPrompt: prompt, skipWIAN: true });
    }
  } catch (error) {
    console.warn('[Inspiration Board] Text synthesis failed; returning captions only.', error);
  }

  if (!generated) return normalizeResult({}, captions);
  try {
    return normalizeResult(JSON.parse(cleanJsonText(generated)), captions);
  } catch (error) {
    console.warn('[Inspiration Board] Could not parse AI JSON; preserving raw result.', error);
    return normalizeResult({ creator_notes: `${generated}\n\nVisual captions:\n${captions.map(entry => `• ${entry.caption}`).join('\n')}` }, captions);
  }
}

export function applyAiSuggestions(character, suggestions, fields = ['description', 'personality', 'scenario', 'creator_notes', 'tags']) {
  if (!suggestions) return;
  if (fields.includes('description') && suggestions.description) character.description = suggestions.description;
  if (fields.includes('personality') && suggestions.personality) character.personality = suggestions.personality;
  if (fields.includes('scenario') && suggestions.scenario) character.scenario = suggestions.scenario;
  if (fields.includes('creator_notes') && suggestions.creator_notes) character.creator_notes = suggestions.creator_notes;
  if (fields.includes('tags') && suggestions.tags?.length) character.tags = suggestions.tags.join(', ');
  character.aiDraft = suggestions;
}
