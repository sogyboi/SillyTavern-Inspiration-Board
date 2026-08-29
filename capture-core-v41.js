import { BROWSE_PROVIDERS, BROWSE_TARGETS, detectBrowseProvider, extractFirstUrl, normalizeRemoteUrl, targetById } from './browse-core-v4.js';

export const CAPTURE_VERSION = '0.4.1';

export const CAPTURE_SETTINGS_DEFAULTS = Object.freeze({
  deleteAfterImport: true,
  autoClipboardPrompt: true,
  pollSeconds: 30,
  nearDuplicateAction: 'ask',
  quickTarget: 'inbox',
  providerTargets: Object.freeze({
    pinterest: 'inbox',
    cosmos: 'inbox',
    web: 'inbox',
  }),
  defaultBoardMode: 'current',
  openProviderAfterImport: false,
});

export const CAPTURE_PROVIDER_ORDER = Object.freeze(['pinterest', 'cosmos', 'web']);

export function normalizeCaptureSettings(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const validTargets = new Set(BROWSE_TARGETS.map(target => target.id));
  const providerTargets = {};
  for (const provider of CAPTURE_PROVIDER_ORDER) {
    const candidate = value.providerTargets?.[provider];
    providerTargets[provider] = validTargets.has(candidate) ? candidate : CAPTURE_SETTINGS_DEFAULTS.providerTargets[provider];
  }
  const nearDuplicateAction = ['ask', 'keep', 'reuse'].includes(value.nearDuplicateAction) ? value.nearDuplicateAction : CAPTURE_SETTINGS_DEFAULTS.nearDuplicateAction;
  return {
    deleteAfterImport: value.deleteAfterImport !== false,
    autoClipboardPrompt: value.autoClipboardPrompt !== false,
    pollSeconds: Math.min(300, Math.max(15, Number(value.pollSeconds) || CAPTURE_SETTINGS_DEFAULTS.pollSeconds)),
    nearDuplicateAction,
    quickTarget: validTargets.has(value.quickTarget) ? value.quickTarget : CAPTURE_SETTINGS_DEFAULTS.quickTarget,
    providerTargets,
    defaultBoardMode: value.defaultBoardMode === 'remembered' ? 'remembered' : 'current',
    openProviderAfterImport: Boolean(value.openProviderAfterImport),
  };
}

export function providerMeta(providerId) {
  return BROWSE_PROVIDERS[providerId] || BROWSE_PROVIDERS.web;
}

export function providerLaunchUrl(providerId, query = '') {
  const provider = providerMeta(providerId);
  const clean = String(query || '').trim();
  if (provider.id === 'pinterest' && clean) return `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(clean)}`;
  if (provider.id === 'cosmos' && clean) return `https://www.cosmos.so/search/elements/${encodeURIComponent(clean)}`;
  if (provider.id === 'web' && clean) return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(clean)}`;
  return provider.homeUrl || provider.exploreUrl;
}

function captureMarker(share = {}) {
  const match = String(share.text || '').match(/\[IBCAPTURE_V1\s+([^\]]+)\]/i);
  if (!match) return null;
  try {
    const params = new URLSearchParams(match[1]);
    return {
      provider: params.get('provider') || '',
      page: normalizeRemoteUrl(params.get('page') || ''),
      image: normalizeRemoteUrl(params.get('image') || ''),
    };
  } catch {
    return null;
  }
}

export function extractCaptureUrl(share = {}) {
  const marker = captureMarker(share);
  return marker?.page || extractFirstUrl(share.url, share.text, share.title) || marker?.image || '';
}

export function captureProvider(share = {}) {
  const marker = captureMarker(share);
  if (CAPTURE_PROVIDER_ORDER.includes(marker?.provider)) return marker.provider;
  return detectBrowseProvider(extractCaptureUrl(share));
}

export function captureSearchText(share = {}) {
  return [share.title, share.text, share.url, captureProvider(share)].filter(Boolean).join(' ').toLowerCase();
}

export function quickTargetForProvider(settings, providerId) {
  const normalized = normalizeCaptureSettings(settings);
  return targetById(normalized.providerTargets[providerId] || normalized.quickTarget);
}

export function rankCandidate(candidate = {}) {
  const url = String(candidate.url || candidate.remoteUrl || '');
  const source = String(candidate.source || '').toLowerCase();
  const title = `${candidate.title || ''} ${candidate.alt || ''}`.toLowerCase();
  const width = Math.max(0, Number(candidate.width) || 0);
  const height = Math.max(0, Number(candidate.height) || 0);
  const area = width * height;
  let score = 0;
  if (source.includes('og:image')) score += 3000;
  if (source.includes('twitter:image')) score += 2200;
  if (source === 'direct-image') score += 3200;
  if (source.includes('srcset')) score += 1400;
  if (/pinimg\.com/i.test(url)) score += 1800;
  if (/\/originals\//i.test(url)) score += 2200;
  if (/\.(?:avif|jpe?g|png|webp)(?:$|[?#])/i.test(url)) score += 600;
  if (area) score += Math.min(5000, Math.sqrt(area) * 2);
  if (width >= 600 && height >= 600) score += 900;
  if (width && width < 180) score -= 1700;
  if (height && height < 180) score -= 1700;
  if (/avatar|icon|logo|favicon|sprite|emoji|badge/i.test(`${url} ${title}`)) score -= 2600;
  if (/\.svg(?:$|[?#])/i.test(url)) score -= 2200;
  return score;
}

export function sortCandidates(candidates = []) {
  return [...candidates].sort((a, b) => rankCandidate(b) - rankCandidate(a));
}

export function pickBestCandidate(candidates = []) {
  return sortCandidates(candidates)[0] || null;
}

export function candidateSourceUrl(candidate = {}, share = {}) {
  return normalizeRemoteUrl(candidate.pageUrl || extractCaptureUrl(share) || candidate.remoteUrl || candidate.url || '');
}

export function relativeCaptureTime(timestamp, now = Date.now()) {
  const delta = Math.max(0, now - (Number(timestamp) || now));
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  try { return new Date(timestamp).toLocaleDateString(); } catch { return ''; }
}

export function shouldOfferClipboard(value, previous = '') {
  const url = extractFirstUrl(value);
  if (!url || url === previous) return '';
  return url;
}

export function makeCaptureHistoryRecord({ share = {}, provider = '', targetId = 'inbox', board = null, count = 1, status = 'imported', error = '' } = {}) {
  const url = extractCaptureUrl(share);
  return {
    id: `capture-history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    shareId: String(share.id || ''),
    title: String(share.title || 'Captured inspiration').slice(0, 240),
    provider: provider || captureProvider(share),
    url,
    targetId: targetById(targetId).id,
    boardId: String(board?.id || ''),
    boardName: String(board?.name || ''),
    count: Math.max(0, Number(count) || 0),
    status: ['imported', 'failed', 'kept'].includes(status) ? status : 'imported',
    error: String(error || '').slice(0, 1000),
    createdAt: Date.now(),
  };
}

export function filterCaptures(captures = [], { query = '', provider = 'all' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return captures.filter(capture => {
    const captureProviderId = captureProvider(capture);
    if (provider !== 'all' && captureProviderId !== provider) return false;
    if (needle && !captureSearchText(capture).includes(needle)) return false;
    return true;
  });
}

export function selectedCaptureIds(captures = [], selection = new Set()) {
  const valid = new Set(captures.map(capture => String(capture.id)));
  return [...selection].map(String).filter(id => valid.has(id));
}

export function summarizeBatch(results = []) {
  const summary = { imported: 0, failed: 0, images: 0, reused: 0 };
  for (const result of results) {
    if (result?.ok) summary.imported++;
    else summary.failed++;
    summary.images += Math.max(0, Number(result?.images) || 0);
    summary.reused += Math.max(0, Number(result?.reused) || 0);
  }
  return summary;
}
