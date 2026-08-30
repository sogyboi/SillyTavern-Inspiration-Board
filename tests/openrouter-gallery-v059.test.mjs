import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gallery = fs.readFileSync(new URL('../openrouter-gallery-v59.js', import.meta.url), 'utf8');
const launcher = fs.readFileSync(new URL('../launcher-v59.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('v0.5.9 generated gallery remains available under newer launchers', () => {
  assert.ok(['0.5.9', '0.6.0'].includes(manifest.version));
  assert.ok(['launcher-v59.js', 'launcher-v60.js'].includes(manifest.js));
  assert.match(launcher, /installGeneratedGallery/);
  assert.match(launcher, /openrouter-gen-v58\.js\?v=0\.5\.9/);
});

test('generated results render as a large inline gallery under Quick Generate', () => {
  assert.match(gallery, /\[data-or-results\]\.ib59-generated-gallery/);
  assert.match(gallery, /max-height:none!important/);
  assert.match(gallery, /Generated images · \$\{cards\.length\}/);
  assert.match(gallery, /Tap an image or View full/);
});

test('generated gallery supports direct full-screen viewing and navigation', () => {
  assert.match(gallery, /Generated image viewer/);
  assert.match(gallery, /data-ib59-viewer-prev/);
  assert.match(gallery, /data-ib59-viewer-next/);
  assert.match(gallery, /ArrowLeft/);
  assert.match(gallery, /ArrowRight/);
  assert.match(gallery, /Math\.abs\(delta\) >= 55/);
  assert.match(gallery, /pinch to zoom/);
});

test('each generated card receives an explicit View full action', () => {
  assert.match(gallery, /button\.textContent = 'View full'/);
  assert.match(gallery, /image\.setAttribute\('role', 'button'\)/);
  assert.match(gallery, /openViewer\(results, index\)/);
});