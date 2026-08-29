export const CAPTURE_BROWSER_VERSION = '0.5.3';
export const CAPTURE_BROWSER_PACKAGE = 'com.sogyboi.inspirationboard.capture';
export const CAPTURE_BROWSER_RELEASE = 'https://github.com/sogyboi/SillyTavern-Inspiration-Board/releases/tag/capture-browser-v0.5.3';

const PROVIDER_URLS = Object.freeze({
  pinterest: 'https://www.pinterest.com/',
  cosmos: 'https://www.cosmos.so/',
  web: 'https://www.google.com/imghp',
});

export function normalizeServerBase(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '';
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function companionBrowseUrl({ provider = 'pinterest', server = '', boardId = '', boardName = '', url = '' } = {}) {
  const providerId = PROVIDER_URLS[provider] ? provider : 'web';
  const params = new URLSearchParams();
  params.set('provider', providerId);
  const normalizedServer = normalizeServerBase(server);
  if (normalizedServer) params.set('server', normalizedServer);
  if (boardId) params.set('boardId', String(boardId));
  if (boardName) params.set('boardName', String(boardName));
  // Always include an explicit URL when launched by Inspiration Board so a cold-start
  // honors the provider card that was tapped instead of restoring another provider's last page.
  params.set('url', String(url || PROVIDER_URLS[providerId]));
  return `inspirationboard://browse?${params.toString()}`;
}

export function providerExternalUrl(provider = 'web') {
  return PROVIDER_URLS[provider] || PROVIDER_URLS.web;
}

export function buildCaptureMarker({ target = 'inbox', boardId = '', boardName = '', provider = 'web', page = '', image = '' } = {}) {
  const params = new URLSearchParams();
  params.set('target', String(target || 'inbox'));
  if (boardId) params.set('boardId', String(boardId));
  if (boardName) params.set('boardName', String(boardName));
  if (provider) params.set('provider', String(provider));
  if (page) params.set('page', String(page));
  if (image) params.set('image', String(image));
  return `[IBCAPTURE_V1 ${params.toString()}]`;
}

export function parseCaptureMarker(text = '') {
  const match = String(text || '').match(/\[IBCAPTURE_V1\s+([^\]]+)\]/i);
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  const target = params.get('target') || 'inbox';
  return {
    target,
    boardId: params.get('boardId') || '',
    boardName: params.get('boardName') || '',
    provider: params.get('provider') || 'web',
    page: params.get('page') || '',
    image: params.get('image') || '',
  };
}

export function captureImportUrl(capture = {}, marker = null) {
  const parsed = marker || parseCaptureMarker(capture.text || '');
  return parsed?.image || capture.url || parsed?.page || '';
}

export function targetLabel(target = 'inbox') {
  const labels = {
    inbox: 'Inbox', board: 'Board', main: 'Main portrait', face: 'Face', hair: 'Hair', body: 'Body / pose',
    outfit: 'Outfit', style: 'Art style', mood: 'Mood / vibe', environment: 'Environment', generation: 'Generation Studio',
  };
  return labels[target] || target;
}

export function shouldInterceptQuickSave(capture = {}) {
  const marker = parseCaptureMarker(capture.text || '');
  if (!marker) return null;
  const url = captureImportUrl(capture, marker);
  if (!url) return null;
  return { marker, url };
}
