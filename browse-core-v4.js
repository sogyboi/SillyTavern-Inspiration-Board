export const BROWSE_VERSION = '0.4.0';

export const BROWSE_PROVIDERS = Object.freeze({
  pinterest: Object.freeze({
    id: 'pinterest',
    label: 'Pinterest',
    icon: 'P',
    homeUrl: 'https://www.pinterest.com/',
    exploreUrl: 'https://www.pinterest.com/ideas/',
  }),
  cosmos: Object.freeze({
    id: 'cosmos',
    label: 'Cosmos',
    icon: 'C',
    homeUrl: 'https://www.cosmos.so/',
    exploreUrl: 'https://www.cosmos.so/explore',
  }),
  web: Object.freeze({
    id: 'web',
    label: 'Web',
    icon: '⌁',
    homeUrl: 'https://www.google.com/imghp',
    exploreUrl: 'https://www.google.com/imghp',
  }),
});

export const BROWSE_TARGETS = Object.freeze([
  Object.freeze({ id: 'inbox', label: 'Inbox', icon: '▥', placement: 'inbox', role: 'general' }),
  Object.freeze({ id: 'board', label: 'Board', icon: '▧', placement: 'board', role: 'general' }),
  Object.freeze({ id: 'main', label: 'Main portrait', icon: '★', placement: 'board', role: 'face', reference: true, main: true, purpose: 'identity' }),
  Object.freeze({ id: 'face', label: 'Face ref', icon: '◉', placement: 'board', role: 'face', reference: true, purpose: 'face' }),
  Object.freeze({ id: 'hair', label: 'Hair ref', icon: '⌁', placement: 'board', role: 'hair', reference: true, purpose: 'hair' }),
  Object.freeze({ id: 'body', label: 'Body / pose', icon: '♙', placement: 'board', role: 'body', reference: true, purpose: 'body' }),
  Object.freeze({ id: 'outfit', label: 'Outfit ref', icon: '♜', placement: 'board', role: 'outfit', reference: true, purpose: 'outfit' }),
  Object.freeze({ id: 'style', label: 'Art style', icon: '✦', placement: 'board', role: 'mood', reference: true, purpose: 'style' }),
  Object.freeze({ id: 'mood', label: 'Mood / vibe', icon: '◐', placement: 'board', role: 'mood', reference: true, purpose: 'mood' }),
  Object.freeze({ id: 'environment', label: 'Environment', icon: '▰', placement: 'board', role: 'environment', reference: true, purpose: 'environment' }),
  Object.freeze({ id: 'generation', label: 'Generation ref', icon: '✧', placement: 'board', role: 'general', reference: true, studio: true, purpose: 'identity' }),
]);

export function normalizeRemoteUrl(value, baseUrl = undefined) {
  const raw = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return '';
  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

export function extractFirstUrl(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const match = text.match(/https?:\/\/[^\s<>"'\]\)]+/i);
    const normalized = normalizeRemoteUrl(match?.[0] || text);
    if (normalized) return normalized;
  }
  return '';
}

export function detectBrowseProvider(value) {
  const normalized = normalizeRemoteUrl(value);
  if (!normalized) return 'web';
  const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'pin.it' || host === 'pinterest.com' || host.endsWith('.pinterest.com') || host.endsWith('.pinimg.com')) return 'pinterest';
  if (host === 'cosmos.so' || host.endsWith('.cosmos.so')) return 'cosmos';
  return 'web';
}

export function buildProviderSearch(providerId, query = '') {
  const provider = BROWSE_PROVIDERS[providerId] || BROWSE_PROVIDERS.web;
  const clean = String(query || '').trim();
  if (provider.id === 'pinterest') {
    return clean ? `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(clean)}` : provider.exploreUrl;
  }
  if (provider.id === 'cosmos') {
    return clean ? `https://www.cosmos.so/search/elements/${encodeURIComponent(clean)}` : provider.exploreUrl;
  }
  return clean ? `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(clean)}` : provider.exploreUrl;
}

export function isLikelyImageUrl(value) {
  const normalized = normalizeRemoteUrl(value);
  if (!normalized) return false;
  const url = new URL(normalized);
  return /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:$|[?#])/i.test(`${url.pathname}${url.search}`)
    || /(?:pinimg\.com|images?\.|cdn\.)/i.test(url.hostname);
}

export function normalizeCandidate(candidate = {}, page = {}) {
  const pageUrl = normalizeRemoteUrl(candidate.pageUrl || page.url || page.pageUrl || '');
  const imageUrl = normalizeRemoteUrl(candidate.url || candidate.imageUrl || '', pageUrl || undefined);
  if (!imageUrl) return null;
  return {
    id: String(candidate.id || `${detectBrowseProvider(pageUrl || imageUrl)}:${imageUrl}`),
    url: imageUrl,
    pageUrl,
    provider: candidate.provider || page.provider || detectBrowseProvider(pageUrl || imageUrl),
    title: String(candidate.title || page.title || '').trim().slice(0, 240),
    description: String(candidate.description || page.description || '').trim().slice(0, 2000),
    alt: String(candidate.alt || '').trim().slice(0, 500),
    width: Math.max(0, Number(candidate.width) || 0),
    height: Math.max(0, Number(candidate.height) || 0),
    source: String(candidate.source || 'page').slice(0, 80),
  };
}

export function mergeCandidates(candidates = [], page = {}, limit = 100) {
  const seen = new Set();
  const output = [];
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate, page);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

export function targetById(id) {
  return BROWSE_TARGETS.find(target => target.id === id) || BROWSE_TARGETS[0];
}

export function candidateFilename(candidate = {}, mime = '') {
  const title = String(candidate.title || candidate.alt || `${candidate.provider || 'web'}-reference`)
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'web-reference';
  let extension = '';
  try { extension = new URL(candidate.url || '').pathname.split('.').pop()?.toLowerCase() || ''; } catch {}
  if (!/^(?:avif|gif|jpe?g|png|webp)$/.test(extension)) {
    extension = /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : /gif/i.test(mime) ? 'gif' : 'jpg';
  }
  if (extension === 'jpeg') extension = 'jpg';
  return `${title}.${extension}`;
}

export function sourceNote(candidate = {}) {
  const parts = [];
  if (candidate.description) parts.push(candidate.description);
  if (candidate.pageUrl) parts.push(`Source: ${candidate.pageUrl}`);
  else if (candidate.url) parts.push(`Source image: ${candidate.url}`);
  return parts.join('\n\n').slice(0, 6000);
}

export function sourceTags(candidate = {}) {
  return [...new Set(['browse-import', `source:${candidate.provider || 'web'}`])];
}

export function foldLayoutMode({ width = 0, height = 0, orientation = '' } = {}) {
  const portrait = orientation ? String(orientation).startsWith('portrait') : height >= width;
  if (portrait && width >= 560 && width <= 1150 && height / Math.max(width, 1) >= 1.12) return 'fold-portrait';
  if (width < 560) return 'phone';
  if (width >= 1100) return 'desktop';
  return 'tablet';
}
