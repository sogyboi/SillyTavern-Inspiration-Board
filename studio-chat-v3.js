import { blobToDataUrl, getImage } from './db-v2.js';
import { ensureStudio, makeMultiCharacterSlot, sanitizeFilename } from './studio-core-v3.js';

function stripMarkup(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCurrentChatScene({ maxMessages = 8, maxChars = 5000 } = {}) {
  const context = globalThis.SillyTavern?.getContext?.();
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const visible = chat
    .filter(message => message && !message.is_system && String(message.mes || '').trim())
    .slice(-Math.max(1, maxMessages));
  const lines = visible.map(message => {
    const speaker = message.is_user ? (context?.name1 || message.name || 'User') : (message.name || context?.name2 || 'Character');
    return `${speaker}: ${stripMarkup(message.mes)}`;
  });
  const joined = lines.join('\n').slice(-maxChars);
  return joined;
}

export function currentCharacterIdentity() {
  const context = globalThis.SillyTavern?.getContext?.();
  const index = Number(context?.characterId);
  const character = Number.isFinite(index) ? context?.characters?.[index] : null;
  return {
    index: Number.isFinite(index) ? index : null,
    name: character?.name || context?.name2 || '',
    avatar: character?.avatar || '',
    character,
  };
}

export function boardsAsCharacterSlots(app, selectedBoardIds = []) {
  return selectedBoardIds
    .map(boardId => app.state.boards.find(board => board.id === boardId))
    .filter(Boolean)
    .map(board => makeMultiCharacterSlot({
      boardId: board.id,
      name: board.character?.name || board.name,
      referenceItemId: board.character?.mainImageId || null,
    }));
}

export function describeSlot(app, slot) {
  const board = app.state.boards.find(candidate => candidate.id === slot.boardId);
  if (!board) return null;
  const studio = ensureStudio(board);
  const blueprint = studio.blueprint;
  return {
    ...slot,
    name: slot.name || board.character?.name || board.name,
    blueprint: [
      blueprint.identity,
      blueprint.face,
      blueprint.hair,
      blueprint.body,
      blueprint.outfit,
      blueprint.accessories,
      blueprint.mustKeep,
    ].filter(Boolean).join('; '),
    referenceItemId: slot.referenceItemId || board.character?.mainImageId || null,
  };
}

async function saveBlobToSillyTavern(record, preferredName = '') {
  const { saveBase64AsFile } = await import('/scripts/utils.js');
  if (typeof saveBase64AsFile !== 'function') throw new Error('This SillyTavern version does not expose saveBase64AsFile().');
  const context = globalThis.SillyTavern?.getContext?.();
  const dataUrl = await blobToDataUrl(record.blob);
  const base64 = dataUrl.split(',')[1];
  const extension = record.mime === 'image/jpeg' ? 'jpg' : record.mime === 'image/webp' ? 'webp' : 'png';
  const filename = `${Date.now()}_${sanitizeFilename(preferredName || record.name || 'inspiration-board')}`;
  return saveBase64AsFile(base64, context?.name2 || 'Inspiration Board', filename, extension);
}

export async function sendImageToCurrentChat(imageId, {
  title = 'Generated image',
  messageText = '',
  asCharacter = true,
} = {}) {
  const context = globalThis.SillyTavern?.getContext?.();
  if (!context?.chat || typeof context.addOneMessage !== 'function') throw new Error('No active SillyTavern chat is available.');
  const record = await getImage(imageId);
  if (!record?.blob) throw new Error('The selected image is missing from browser storage.');
  const url = await saveBlobToSillyTavern(record, title);
  let MEDIA_TYPE = { IMAGE: 'image' };
  let MEDIA_SOURCE = { GENERATED: 'generated' };
  try {
    const constants = await import('/scripts/constants.js');
    MEDIA_TYPE = constants.MEDIA_TYPE || MEDIA_TYPE;
    MEDIA_SOURCE = constants.MEDIA_SOURCE || MEDIA_SOURCE;
  } catch {}

  const characterName = context.name2 || currentCharacterIdentity().name || 'Character';
  const message = {
    name: asCharacter ? characterName : 'Inspiration Board',
    is_user: false,
    is_system: !asCharacter,
    send_date: new Date().toISOString(),
    mes: messageText || `[${title}]`,
    extra: {
      inline_image: true,
      media: [{
        url,
        type: MEDIA_TYPE.IMAGE || 'image',
        title,
        source: MEDIA_SOURCE.GENERATED || 'generated',
      }],
      media_index: 0,
      inspiration_board: { imageId, title },
    },
  };
  context.chat.push(message);
  await context.addOneMessage(message);
  await context.saveChat?.();
  context.scrollChatToBottom?.();
  return message;
}

export async function setImageAsChatBackground(imageId) {
  const context = globalThis.SillyTavern?.getContext?.();
  const record = await getImage(imageId);
  if (!record?.blob) throw new Error('The selected image is missing.');
  const url = await saveBlobToSillyTavern(record, 'inspiration-board-background');
  if (!context?.chatMetadata) throw new Error('No active chat metadata is available.');
  context.chatMetadata.chat_background = url;
  context.chatMetadata.chat_backgrounds = [url];
  await context.saveMetadata?.();
  await context.updateChatMetadata?.({ chat_background: url, chat_backgrounds: [url] });
  return url;
}

export async function setImageAsCharacterAvatar(imageId) {
  const context = globalThis.SillyTavern?.getContext?.();
  const identity = currentCharacterIdentity();
  if (!identity.character || identity.index === null) throw new Error('Select a SillyTavern character first.');
  const record = await getImage(imageId);
  if (!record?.blob) throw new Error('The selected image is missing.');
  const dataUrl = await blobToDataUrl(record.blob);
  const file = new File([record.blob], record.name || 'avatar.png', { type: record.mime || 'image/png' });

  // Prefer the public character form so SillyTavern handles cropping, upload paths and card updates.
  const contextData = {
    name: identity.character.name,
    description: identity.character.description || identity.character.data?.description || '',
    personality: identity.character.personality || identity.character.data?.personality || '',
    scenario: identity.character.scenario || identity.character.data?.scenario || '',
    first_message: identity.character.first_mes || identity.character.data?.first_mes || '',
    avatar: file,
    avatarDataUrl: dataUrl,
  };
  if (typeof context.createCharacterData === 'function') {
    await context.createCharacterData(contextData);
    return true;
  }
  throw new Error('This SillyTavern version does not expose character avatar updates to extensions.');
}

export function buildCurrentSceneDraft(baseDraft = {}) {
  const scene = getCurrentChatScene();
  return {
    ...baseDraft,
    recipeId: 'chat-scene',
    useChatScene: true,
    chatScene: scene,
  };
}
