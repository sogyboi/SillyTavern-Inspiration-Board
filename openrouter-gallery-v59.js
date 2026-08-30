const VERSION = '0.5.9';
const VIEWER_ID = 'ib59-generated-viewer';
const STYLE_ID = 'ib59-generated-gallery-style';
const enhancedResults = new WeakSet();
let documentObserver = null;
let activeGallery = null;
let activeIndex = 0;
let swipeStartX = null;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ib59-gallery-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 0 8px;padding:9px 11px;border:1px solid var(--ib2-line,#343446);border-radius:11px;background:#101018;font-size:10px;color:#d8d4e5}.ib59-gallery-heading[hidden]{display:none!important}.ib59-gallery-heading b{font-size:11px;color:#fff}.ib59-gallery-heading span{color:var(--ib2-muted,#aaa)}
    [data-or-results].ib59-generated-gallery{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:16px!important;overflow:visible!important;min-height:0!important;padding:0 0 8px!important;width:100%!important}
    [data-or-results].ib59-generated-gallery .ib2-or-result{display:flex!important;flex:none!important;width:100%!important;max-width:none!important;box-sizing:border-box;padding:10px;border:1px solid var(--ib2-line,#343446);border-radius:14px;background:#0d0d14;gap:9px!important}
    [data-or-results].ib59-generated-gallery .ib2-or-result img{display:block!important;width:100%!important;height:auto!important;max-height:none!important;object-fit:contain!important;border-radius:11px!important;background:#07070b;cursor:zoom-in;touch-action:pan-y pinch-zoom}
    [data-or-results].ib59-generated-gallery .ib2-or-result img:focus-visible{outline:2px solid #9d7cff;outline-offset:3px}
    [data-or-results].ib59-generated-gallery .ib2-or-result-actions{display:grid!important;grid-template-columns:1fr 1fr;gap:7px!important}.ib59-view-full{font-weight:700!important}
    #${VIEWER_ID}{position:fixed;inset:0;z-index:1000005;background:rgba(3,3,7,.96);display:grid;grid-template-columns:minmax(44px,72px) minmax(0,1fr) minmax(44px,72px);grid-template-rows:auto minmax(0,1fr) auto;align-items:center;justify-items:center;padding:max(10px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));box-sizing:border-box;backdrop-filter:blur(8px)}
    #${VIEWER_ID}[hidden]{display:none!important}#${VIEWER_ID} .ib59-viewer-top{grid-column:1/-1;width:100%;display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:10px;padding:4px 8px 10px;box-sizing:border-box;color:#fff}#${VIEWER_ID} .ib59-viewer-title{font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#${VIEWER_ID} .ib59-viewer-count{font-size:10px;color:#bbb}#${VIEWER_ID} button{min-width:44px;min-height:44px;border:1px solid #45415b;border-radius:12px;background:#161520;color:#fff;font-size:22px;cursor:pointer}#${VIEWER_ID} .ib59-viewer-close{font-size:20px}#${VIEWER_ID} .ib59-viewer-stage{grid-column:2;grid-row:2;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;overscroll-behavior:contain}#${VIEWER_ID} .ib59-viewer-image{display:block;max-width:100%;max-height:calc(100dvh - 118px);width:auto;height:auto;object-fit:contain;border-radius:9px;box-shadow:0 14px 50px rgba(0,0,0,.45);touch-action:pinch-zoom}#${VIEWER_ID} .ib59-viewer-prev{grid-column:1;grid-row:2}#${VIEWER_ID} .ib59-viewer-next{grid-column:3;grid-row:2}#${VIEWER_ID} .ib59-viewer-help{grid-column:1/-1;grid-row:3;padding-top:8px;font-size:9px;color:#aaa;text-align:center}
    @media(max-width:700px){#${VIEWER_ID}{grid-template-columns:48px minmax(0,1fr) 48px;padding-left:4px;padding-right:4px}#${VIEWER_ID} .ib59-viewer-image{max-height:calc(100dvh - 104px)}.ib59-gallery-heading{align-items:flex-start;flex-direction:column;gap:2px}}
  `;
  document.head.appendChild(style);
}

function galleryImages(results) {
  return [...results.querySelectorAll('.ib2-or-result img')].filter(image => image.src);
}

function ensureViewer() {
  let viewer = document.getElementById(VIEWER_ID);
  if (viewer) return viewer;
  viewer = document.createElement('div');
  viewer.id = VIEWER_ID;
  viewer.hidden = true;
  viewer.tabIndex = -1;
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-label', 'Generated image viewer');
  viewer.innerHTML = `
    <div class="ib59-viewer-top">
      <div class="ib59-viewer-title" data-ib59-viewer-title>Generated image</div>
      <div class="ib59-viewer-count" data-ib59-viewer-count></div>
      <button class="ib59-viewer-close" data-ib59-viewer-close aria-label="Close full image">×</button>
    </div>
    <button class="ib59-viewer-prev" data-ib59-viewer-prev aria-label="Previous generated image">‹</button>
    <div class="ib59-viewer-stage" data-ib59-viewer-stage><img class="ib59-viewer-image" data-ib59-viewer-image alt="Generated image full view"></div>
    <button class="ib59-viewer-next" data-ib59-viewer-next aria-label="Next generated image">›</button>
    <div class="ib59-viewer-help">Swipe or use arrows to move between generated images · pinch to zoom</div>`;
  document.body.appendChild(viewer);

  viewer.querySelector('[data-ib59-viewer-close]').onclick = closeViewer;
  viewer.querySelector('[data-ib59-viewer-prev]').onclick = () => stepViewer(-1);
  viewer.querySelector('[data-ib59-viewer-next]').onclick = () => stepViewer(1);
  viewer.querySelector('[data-ib59-viewer-stage]').onclick = event => {
    if (event.target === event.currentTarget) closeViewer();
  };
  const image = viewer.querySelector('[data-ib59-viewer-image]');
  image.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    swipeStartX = event.clientX;
  });
  image.addEventListener('pointerup', event => {
    if (swipeStartX === null || event.pointerType === 'mouse') return;
    const delta = event.clientX - swipeStartX;
    swipeStartX = null;
    if (Math.abs(delta) >= 55) stepViewer(delta > 0 ? -1 : 1);
  });
  return viewer;
}

function renderViewer() {
  const viewer = ensureViewer();
  const images = activeGallery ? galleryImages(activeGallery) : [];
  if (!images.length) return closeViewer();
  activeIndex = ((activeIndex % images.length) + images.length) % images.length;
  const source = images[activeIndex];
  const full = viewer.querySelector('[data-ib59-viewer-image]');
  full.src = source.src;
  full.alt = source.alt || `Generated image ${activeIndex + 1}`;
  viewer.querySelector('[data-ib59-viewer-title]').textContent = source.alt || 'Generated image';
  viewer.querySelector('[data-ib59-viewer-count]').textContent = `${activeIndex + 1} / ${images.length}`;
  const multi = images.length > 1;
  viewer.querySelector('[data-ib59-viewer-prev]').hidden = !multi;
  viewer.querySelector('[data-ib59-viewer-next]').hidden = !multi;
}

function openViewer(results, index = 0) {
  activeGallery = results;
  activeIndex = index;
  const viewer = ensureViewer();
  viewer.hidden = false;
  renderViewer();
  viewer.focus({ preventScroll: true });
}

function closeViewer() {
  const viewer = document.getElementById(VIEWER_ID);
  if (!viewer || viewer.hidden) return;
  viewer.hidden = true;
  viewer.querySelector('[data-ib59-viewer-image]').removeAttribute('src');
  activeGallery = null;
  activeIndex = 0;
  swipeStartX = null;
}

function stepViewer(delta) {
  if (!activeGallery) return;
  activeIndex += delta;
  renderViewer();
}

function updateGallery(results, heading) {
  const cards = [...results.querySelectorAll('.ib2-or-result')];
  heading.hidden = cards.length === 0;
  heading.innerHTML = cards.length
    ? `<b>Generated images · ${cards.length}</b><span>Tap an image or View full to inspect it here without leaving Generate.</span>`
    : '';

  cards.forEach((card, index) => {
    const image = card.querySelector('img');
    if (image) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `View generated image ${index + 1} full screen`);
      image.dataset.ib59GalleryIndex = String(index);
    }
    const actions = card.querySelector('.ib2-or-result-actions');
    if (actions && !actions.querySelector('[data-ib59-view]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ib59-view-full';
      button.dataset.ib59View = String(index);
      button.textContent = 'View full';
      actions.prepend(button);
    }
    const viewButton = actions?.querySelector('[data-ib59-view]');
    if (viewButton) viewButton.dataset.ib59View = String(index);
  });
}

function enhanceResults(results) {
  if (!results || enhancedResults.has(results)) return;
  enhancedResults.add(results);
  results.classList.add('ib59-generated-gallery');

  let heading = results.previousElementSibling;
  if (!heading?.classList?.contains('ib59-gallery-heading')) {
    heading = document.createElement('div');
    heading.className = 'ib59-gallery-heading';
    heading.hidden = true;
    results.before(heading);
  }

  const refresh = () => updateGallery(results, heading);
  results.addEventListener('click', event => {
    const viewButton = event.target.closest?.('[data-ib59-view]');
    const image = event.target.closest?.('.ib2-or-result img');
    if (!viewButton && !image) return;
    event.preventDefault();
    event.stopPropagation();
    const target = viewButton || image;
    const index = Number(target.dataset.ib59View ?? target.dataset.ib59GalleryIndex ?? 0) || 0;
    openViewer(results, index);
  });
  results.addEventListener('keydown', event => {
    if (!event.target.matches?.('.ib2-or-result img')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openViewer(results, Number(event.target.dataset.ib59GalleryIndex || 0) || 0);
  });

  const observer = new MutationObserver(refresh);
  observer.observe(results, { childList: true, subtree: true });
  refresh();
}

function scan() {
  document.querySelectorAll('[data-or-results]').forEach(enhanceResults);
}

function onDocumentKeydown(event) {
  const viewer = document.getElementById(VIEWER_ID);
  if (!viewer || viewer.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeViewer();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    stepViewer(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    stepViewer(1);
  }
}

export function installGeneratedGallery() {
  ensureStyles();
  ensureViewer();
  scan();
  if (!documentObserver) {
    documentObserver = new MutationObserver(scan);
    documentObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', onDocumentKeydown, true);
  }
  globalThis.InspirationBoardGeneratedGallery = {
    version: VERSION,
    open(results, index = 0) { openViewer(results, index); },
    close: closeViewer,
  };
  return true;
}
