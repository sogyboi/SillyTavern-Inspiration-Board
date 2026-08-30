from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    updated, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {count}")
    return updated


# ----- Venice client v0.6.1 -----
src = Path('venice-gen-v60.js').read_text()
ui = replace_once(src, "const VERSION = '0.6.0';", "const VERSION = '0.6.1';", 'client version')

privacy_anchor = "function privacy(model) { return String(modelSpec(model)?.privacy || '').toLowerCase(); }\n"
helpers = privacy_anchor + r'''
function modelCapabilities(model) {
  const value = modelSpec(model)?.capabilities;
  return value && typeof value === 'object' ? value : {};
}

const DOCUMENTED_MULTI_EDIT_MODELS = new Set([
  'flux-2-max-edit',
  'gpt-image-1-5-edit',
  'gpt-image-2-edit',
  'grok-imagine-edit',
  'grok-imagine-image-2-0-edit',
  'grok-imagine-quality-edit',
  'qwen-image-3-edit',
  'qwen-image-3-pro-edit',
  'seedream-v5-pro-edit',
]);

function pricingMentionsExtraImage(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, entry] of Object.entries(value)) {
    if (/extra.*image|additional.*image|image.*extra|image.*additional/i.test(key)) return true;
    if (entry && typeof entry === 'object' && pricingMentionsExtraImage(entry)) return true;
  }
  return false;
}

export function veniceEditReferenceLimit(model) {
  if (model?._kind !== 'inpaint') return 0;
  const capabilities = modelCapabilities(model);
  if (capabilities.supportsMultipleImages === true) return 3;
  if (capabilities.supportsMultipleImages === false) return 1;
  if (pricingMentionsExtraImage(modelSpec(model)?.pricing)) return 3;
  if (DOCUMENTED_MULTI_EDIT_MODELS.has(String(model?.id || '').toLowerCase())) return 3;
  return 1;
}
'''
ui = replace_once(ui, privacy_anchor, helpers, 'client capability helpers')

get_refs_pattern = r"function getReferenceItems\(app, source = 'auto'\) \{.*?\n\}\n\nasync function referenceData"
get_refs_replacement = r'''export function orderVeniceReferenceItems({ selected = [], basket = [], main = null, source = 'auto' } = {}) {
  const roleRank = { general: 0, face: 1, body: 2, hair: 3, outfit: 4, expression: 5, accessory: 6, prop: 7, mood: 8, environment: 9 };
  const sortedBasket = [...basket].sort((a, b) => (roleRank[a?.role] ?? 50) - (roleRank[b?.role] ?? 50));
  const unique = rows => {
    const seen = new Set();
    return rows.filter(item => {
      if (!item?.imageId) return false;
      if (seen.has(item.imageId)) return false;
      seen.add(item.imageId);
      return true;
    });
  };
  if (source === 'main') return main?.imageId ? [main] : [];
  if (source === 'basket') return unique(sortedBasket);
  if (source === 'selected') {
    const selectedHasMain = Boolean(main?.imageId && selected.some(item => item?.imageId === main.imageId));
    return unique(selectedHasMain ? [main, ...selected] : selected);
  }
  if (selected.length) {
    const selectedHasMain = Boolean(main?.imageId && selected.some(item => item?.imageId === main.imageId));
    return unique(selectedHasMain ? [main, ...selected] : selected);
  }
  if (main?.imageId) return unique([main, ...sortedBasket]);
  return unique(sortedBasket);
}

function getReferenceItems(app, source = 'auto') {
  const board = app.activeBoard();
  const selected = [...app.selectedIds].map(id => app.itemById(id)).filter(item => item?.type === 'image');
  const basket = allBasketIds(board).map(id => app.itemById(id)).filter(item => item?.type === 'image');
  const main = board.character?.mainImageId ? app.itemById(board.character.mainImageId) : null;
  return orderVeniceReferenceItems({ selected, basket, main, source }).slice(0, MAX_REFS);
}

function referenceItemLabel(app, item) {
  const board = app.activeBoard();
  if (item?.imageId && item.imageId === board.character?.mainImageId) return 'Main portrait';
  const role = ROLE_LABELS[item?.role] || item?.role || 'Reference';
  return item?.name ? `${role} · ${item.name}` : role;
}

function editReferencePlan(app, items, model) {
  const limit = veniceEditReferenceLimit(model);
  const sent = items.slice(0, limit);
  if (!sent.length) return { limit, sent, text: 'Reference ACTIVE · no source image is currently available.' };
  const base = referenceItemLabel(app, sent[0]);
  const extras = Math.max(0, items.length - sent.length);
  return {
    limit,
    sent,
    text: `Reference ACTIVE · ${sent.length} source image${sent.length === 1 ? '' : 's'} will be sent · Base: ${base}${extras ? ` · ${extras} extra board ref${extras === 1 ? '' : 's'} not sent to this model` : ''}`,
  };
}

async function referenceData'''
ui = regex_once(ui, get_refs_pattern, get_refs_replacement, 'reference ordering')

refresh_old = """    const requiresRefs = modelTask === 'edit' || modelTask === 'image-to-video' || modelTask === 'reference-to-video';
    refsStrip.style.opacity = requiresRefs ? '1' : '.55';
    if (media === 'video') scheduleQuote();
    else quoteBox.textContent = `${price}${uncensored ? ' · Venice documents this as an uncensored/adult-capable model or variant.' : ''}${safeMode.checked ? ' · Safe mode ON: adult output can be blurred.' : ' · Safe mode OFF: raw output requested.'}`;
    persist();
"""
refresh_new = """    const requiresRefs = modelTask === 'edit' || modelTask === 'image-to-video' || modelTask === 'reference-to-video';
    if (media === 'image') {
      if (modelTask === 'edit') {
        const plan = editReferencePlan(app, currentRefs, model);
        refsStrip.style.opacity = '1';
        refSource.disabled = false;
        quoteBox.textContent = `${price} · ${plan.text}${uncensored ? ' · Uncensored/NSFW-capable model.' : ''}${safeMode.checked ? ' · Safe mode ON.' : ' · Safe mode OFF.'}`;
      } else {
        refsStrip.style.opacity = '.35';
        refSource.disabled = true;
        quoteBox.textContent = `${price} · References NOT sent for this model. Venice text-to-image generation uses /image/generate and does not accept board reference images. Choose an Edit / reference model to use a source image.${uncensored ? ' · Uncensored/NSFW-capable model.' : ''}`;
      }
    } else {
      refsStrip.style.opacity = requiresRefs ? '1' : '.35';
      refSource.disabled = modelTask === 'text-to-video';
      scheduleQuote();
    }
    persist();
"""
ui = replace_once(ui, refresh_old, refresh_new, 'reference state UI')

image_send_old = """        const needsRefs = modelTask === 'edit';
        const refs = needsRefs ? await referenceData(app, currentRefs, 3) : [];
        if (needsRefs && !refs.length) throw new Error('This Venice edit/reference model needs at least one board reference image.');
        setStatus(`Sending Venice image request · ${modelName(model)}${veniceModelIsUncensored(model, traits) ? ' · uncensored model' : ''}…`);
"""
image_send_new = """        const needsRefs = modelTask === 'edit';
        const referenceLimit = needsRefs ? veniceEditReferenceLimit(model) : 0;
        const refs = needsRefs ? await referenceData(app, currentRefs, referenceLimit) : [];
        if (needsRefs && !refs.length) throw new Error('This Venice edit/reference model needs at least one board reference image.');
        const referenceSendText = needsRefs ? ` · attaching ${refs.length} source image${refs.length === 1 ? '' : 's'} · Base: ${referenceItemLabel(app, refs[0].item)}` : ' · text-to-image · no references sent';
        setStatus(`Sending Venice image request · ${modelName(model)}${referenceSendText}${veniceModelIsUncensored(model, traits) ? ' · uncensored model' : ''}…`);
"""
ui = replace_once(ui, image_send_old, image_send_new, 'image send receipt preflight')

status_old = """        const moderation = data.blurred ? ' · output was blurred by Safe Venice' : data.contentViolation ? ' · Venice flagged a content violation' : '';
        setStatus(`${images.length} Venice image${images.length === 1 ? '' : 's'} finished${moderation}.`, data.blurred ? '' : 'good');
"""
status_new = """        const moderation = data.blurred ? ' · output was blurred by Safe Venice' : data.contentViolation ? ' · Venice flagged a content violation' : '';
        const referenceReceipt = needsRefs
          ? ` · reference receipt: ${Number(data.reference_count ?? refs.length)} source image${Number(data.reference_count ?? refs.length) === 1 ? '' : 's'} via ${data.reference_endpoint || (refs.length > 1 ? '/image/multi-edit' : '/image/edit')}`
          : ' · no reference input';
        setStatus(`${images.length} Venice image${images.length === 1 ? '' : 's'} finished${referenceReceipt}${moderation}.`, data.blurred ? '' : 'good');
"""
ui = replace_once(ui, status_old, status_new, 'image response receipt')

Path('venice-gen-v61.js').write_text(ui)


# ----- Server Venice bridge v0.6.1 -----
bridge = Path('server-plugin/inspiration-board-sync/venice-media-v60.mjs').read_text()
bridge = replace_once(bridge, "version: '0.6.0'", "version: '0.6.1'", 'bridge version')
edit_body_old = """        const editBody = {
          prompt: cleanText(source.prompt, 32_768),
          modelId: cleanText(source.model, 300),
          safe_mode: source.safe_mode !== false,
        };
"""
edit_body_new = """        const editModel = cleanText(source.model, 300);
        const editBody = {
          prompt: cleanText(source.prompt, 32_768),
          safe_mode: source.safe_mode !== false,
        };
"""
bridge = replace_once(bridge, edit_body_old, edit_body_new, 'edit model field prep')
bridge = replace_once(bridge, "body: { ...editBody, image: stripDataUrl(references[0]) },", "body: { ...editBody, model: editModel, image: stripDataUrl(references[0]) },", 'single edit model field')
bridge = replace_once(bridge, "body: { ...editBody, images: references.map(stripDataUrl) },", "body: { ...editBody, modelId: editModel, images: references.map(stripDataUrl) },", 'multi edit model field')
return_old = """          return res.json({
            id: `venice-edit-${Date.now()}`,
            images: [bytes.toString('base64')],
            format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png',
            blurred: response.headers.get('x-venice-is-blurred') === 'true',
            contentViolation: response.headers.get('x-venice-is-content-violation') === 'true',
          });
"""
return_new = """          return res.json({
            id: `venice-edit-${Date.now()}`,
            images: [bytes.toString('base64')],
            format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png',
            blurred: response.headers.get('x-venice-is-blurred') === 'true',
            contentViolation: response.headers.get('x-venice-is-content-violation') === 'true',
            reference_received: true,
            reference_count: references.length,
            reference_endpoint: references.length === 1 ? '/image/edit' : '/image/multi-edit',
            reference_model_field: references.length === 1 ? 'model' : 'modelId',
          });
"""
bridge = replace_once(bridge, return_old, return_new, 'reference receipt response')
Path('server-plugin/inspiration-board-sync/venice-media-v61.mjs').write_text(bridge)


# ----- Plugin runtime -----
index_path = Path('server-plugin/inspiration-board-sync/index.mjs')
index = index_path.read_text()
index = replace_once(index, "import { installVeniceMediaBridge } from './venice-media-v60.mjs';", "import { installVeniceMediaBridge } from './venice-media-v61.mjs';", 'bridge import')
index = replace_once(index, "const VERSION = '0.6.0';", "const VERSION = '0.6.1';", 'plugin version')
index = replace_once(index, "'venice-image-video']", "'venice-image-video', 'venice-reference-receipts']", 'plugin capability')
index_path.write_text(index)

plugin_package = Path('server-plugin/inspiration-board-sync/package.json')
pkg_text = plugin_package.read_text()
pkg_text = re.sub(r'"version":\s*"[^"]+"', '"version": "0.6.1"', pkg_text, count=1)
plugin_package.write_text(pkg_text)


# ----- Launcher + release metadata -----
launcher = Path('launcher-v60.js').read_text()
launcher = launcher.replace('?v=0.6.0', '?v=0.6.1')
launcher = replace_once(launcher, "./venice-gen-v60.js?v=0.6.1", "./venice-gen-v61.js?v=0.6.1", 'v61 client import')
launcher = replace_once(launcher, "const VERSION = '0.6.0';", "const VERSION = '0.6.1';", 'launcher version')
launcher = launcher.replace('Generate now supports sorted OpenRouter image models plus Venice image/video generation, live capability filters, uncensored/NSFW model badges, server-side Venice key storage, exact video quotes, async job status, and inline media results.', 'Generate now includes reference-integrity checks for Venice: text-to-image clearly disables references, Edit/Ref models show the exact base/source plan, and completed edits report the reference endpoint/count actually sent.')
Path('launcher-v61.js').write_text(launcher)

manifest = Path('manifest.json').read_text()
manifest = replace_once(manifest, '"js": "launcher-v60.js"', '"js": "launcher-v61.js"', 'manifest launcher')
manifest = replace_once(manifest, '"version": "0.6.0"', '"version": "0.6.1"', 'manifest version')
Path('manifest.json').write_text(manifest)

package = Path('package.json').read_text()
package = replace_once(package, '"version": "0.6.0"', '"version": "0.6.1"', 'package version')
package = replace_once(package, 'node --check launcher-v60.js &&', 'node --check launcher-v60.js && node --check launcher-v61.js &&', 'launcher syntax check')
package = replace_once(package, 'node --check venice-gen-v60.js &&', 'node --check venice-gen-v60.js && node --check venice-gen-v61.js &&', 'client syntax check')
package = replace_once(package, 'node --check server-plugin/inspiration-board-sync/venice-media-v60.mjs &&', 'node --check server-plugin/inspiration-board-sync/venice-media-v60.mjs && node --check server-plugin/inspiration-board-sync/venice-media-v61.mjs &&', 'bridge syntax check')
Path('package.json').write_text(package)

changelog = Path('CHANGELOG.md').read_text()
entry = """## 0.6.1\n\n- Fixed Venice reference integrity: text-to-image Generation models now clearly show **References NOT sent** instead of displaying an active-looking reference strip for an API path that cannot accept images.\n- Edit / reference models now show an explicit **Reference ACTIVE** plan with the exact source-image count and which board image will be the base.\n- Auto reference selection now prioritizes the board's Main portrait as the base image when there is no explicit selection, then adds role-sorted basket references behind it.\n- Multi-image edit input is only used when live capabilities, pricing metadata, or a currently documented multi-edit model indicate multiple image inputs; otherwise one base image is sent for reliability.\n- Single-image `/image/edit` now uses Venice's current `model` field; `/image/multi-edit` keeps the documented `modelId` field.\n- Successful edit responses now include a local reference receipt (`reference_count`, endpoint, and model-field mode), and the Generate UI displays that receipt so you can verify the bridge actually sent the source image.\n- Original stored image blobs continue to be sent, never board thumbnails.\n- Inspiration Board Sync is now **v0.6.1** and must be recopied/restarted once for the reference receipt and current edit routing.\n\n"""
changelog = replace_once(changelog, '# Changelog\n\n', '# Changelog\n\n' + entry, 'changelog entry')
Path('CHANGELOG.md').write_text(changelog)


# ----- Tests -----
old_test_path = Path('tests/venice-media-v060.test.mjs')
old_test = old_test_path.read_text()
old_test = old_test.replace("const launcher = fs.readFileSync(new URL('../launcher-v60.js', import.meta.url), 'utf8');", "const launcher = fs.readFileSync(new URL('../launcher-v61.js', import.meta.url), 'utf8');")
old_test = old_test.replace("const veniceUi = fs.readFileSync(new URL('../venice-gen-v60.js', import.meta.url), 'utf8');", "const veniceUi = fs.readFileSync(new URL('../venice-gen-v61.js', import.meta.url), 'utf8');")
old_test = old_test.replace("const bridge = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/venice-media-v60.mjs', import.meta.url), 'utf8');", "const bridge = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/venice-media-v61.mjs', import.meta.url), 'utf8');")
old_test = old_test.replace("test('v0.6.0 launcher exposes provider switching without importing the v0.5.9 capture handler'", "test('v0.6.x launcher exposes provider switching without importing the v0.5.9 capture handler'")
old_test = old_test.replace("assert.equal(manifest.version, '0.6.0');", "assert.equal(manifest.version, '0.6.1');")
old_test = old_test.replace("assert.equal(manifest.js, 'launcher-v60.js');", "assert.equal(manifest.js, 'launcher-v61.js');")
old_test = old_test.replace("test('server plugin advertises Venice media capability at v0.6.0'", "test('server plugin advertises Venice media capability under v0.6.1'")
old_test = old_test.replace("assert.match(plugin, /const VERSION = '0\\.6\\.0'/);", "assert.match(plugin, /const VERSION = '0\\.6\\.1'/);")
old_test_path.write_text(old_test)

new_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orderVeniceReferenceItems, veniceEditReferenceLimit } from '../venice-gen-v61.js';

const ui = fs.readFileSync(new URL('../venice-gen-v61.js', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/venice-media-v61.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const img = (id, role = 'general') => ({ id, imageId: id, type: 'image', role, name: id });

test('v0.6.1 release is the reference-integrity launcher', () => {
  assert.equal(manifest.version, '0.6.1');
  assert.equal(manifest.js, 'launcher-v61.js');
});

test('Auto reference ordering uses Main portrait as base before basket refs', () => {
  const main = img('main', 'general');
  const hair = img('hair', 'hair');
  const face = img('face', 'face');
  assert.deepEqual(orderVeniceReferenceItems({ selected: [], basket: [hair, face], main, source: 'auto' }).map(x => x.imageId), ['main', 'face', 'hair']);
});

test('explicit selection remains authoritative and main only moves first when selected', () => {
  const main = img('main');
  const a = img('a', 'outfit');
  const b = img('b', 'face');
  assert.deepEqual(orderVeniceReferenceItems({ selected: [a, b], basket: [], main, source: 'auto' }).map(x => x.imageId), ['a', 'b']);
  assert.deepEqual(orderVeniceReferenceItems({ selected: [a, main, b], basket: [], main, source: 'auto' }).map(x => x.imageId), ['main', 'a', 'b']);
});

test('edit reference limits avoid accidental multi-edit on single-image models', () => {
  assert.equal(veniceEditReferenceLimit({ _kind: 'image', id: 'lustify-v8', model_spec: {} }), 0);
  assert.equal(veniceEditReferenceLimit({ _kind: 'inpaint', id: 'single-edit', model_spec: { capabilities: { supportsMultipleImages: false } } }), 1);
  assert.equal(veniceEditReferenceLimit({ _kind: 'inpaint', id: 'multi-edit', model_spec: { capabilities: { supportsMultipleImages: true } } }), 3);
  assert.equal(veniceEditReferenceLimit({ _kind: 'inpaint', id: 'grok-imagine-edit', model_spec: {} }), 3);
});

test('Generation models visibly disable refs instead of implying they are sent', () => {
  assert.match(ui, /References NOT sent for this model/);
  assert.match(ui, /Venice text-to-image generation uses \/image\/generate/);
  assert.match(ui, /refSource\.disabled = true/);
  assert.match(ui, /needsRefs = modelTask === 'edit'/);
});

test('Edit models expose a visible reference plan and send originals', () => {
  assert.match(ui, /Reference ACTIVE/);
  assert.match(ui, /Base:/);
  assert.match(ui, /blobToDataUrl\(record\.blob\)/);
  assert.match(ui, /reference receipt:/);
});

test('single edit uses current model field and multi-edit keeps modelId', () => {
  assert.match(bridge, /body: \{ \.\.\.editBody, model: editModel, image:/);
  assert.match(bridge, /body: \{ \.\.\.editBody, modelId: editModel, images:/);
  assert.match(bridge, /reference_received: true/);
  assert.match(bridge, /reference_count: references\.length/);
  assert.match(bridge, /reference_endpoint:/);
  assert.match(bridge, /reference_model_field:/);
});
'''
Path('tests/venice-reference-v061.test.mjs').write_text(new_test)

print('v0.6.1 reference-integrity patch applied')
