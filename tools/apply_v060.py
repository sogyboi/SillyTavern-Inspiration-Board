from pathlib import Path
import re
from textwrap import dedent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 regex match, found {count}')
    return updated


# Wire the Venice bridge into the server plugin.
index_path = Path('server-plugin/inspiration-board-sync/index.mjs')
index = index_path.read_text()
index = replace_once(
    index,
    "import { installOpenRouterImagesBridge } from './openrouter-images-v58.mjs';\n",
    "import { installOpenRouterImagesBridge } from './openrouter-images-v58.mjs';\nimport { installVeniceMediaBridge } from './venice-media-v60.mjs';\n",
    'Venice server import',
)
index = replace_once(index, "const VERSION = '0.5.8';", "const VERSION = '0.6.0';", 'server plugin version')
index = replace_once(
    index,
    "export async function init(router) {\n  installOpenRouterImagesBridge(router);\n",
    "export async function init(router) {\n  installOpenRouterImagesBridge(router);\n  installVeniceMediaBridge(router);\n",
    'Venice server init',
)
index = replace_once(
    index,
    "        capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy', 'native-json-capture', 'native-raw-capture', 'openrouter-image-api'],\n",
    "        capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy', 'native-json-capture', 'native-raw-capture', 'openrouter-image-api', 'venice-image-video'],\n",
    'Venice server capability',
)
index_path.write_text(index)


# Harden model-family-specific reference-to-video payload routing.
bridge_path = Path('server-plugin/inspiration-board-sync/venice-media-v60.mjs')
bridge = bridge_path.read_text()
anchor = dedent('''\
function stripDataUrl(value) {
  const input = String(value || '');
  const marker = ';base64,';
  const index = input.indexOf(marker);
  return index >= 0 ? input.slice(index + marker.length) : input;
}

''')
helper = anchor + dedent('''\
function normalizeReferenceEntries(value, max = 7) {
  if (!Array.isArray(value)) return [];
  const rows = value.slice(0, max).map(entry => ({
    url: String(entry?.url || entry?.dataUrl || '').trim(),
    role: String(entry?.role || 'general').toLowerCase().slice(0, 60),
  })).filter(entry => /^(?:data:image\/[a-zA-Z0-9.+-]+;base64,|https?:\/\/)/.test(entry.url));
  const total = rows.reduce((sum, entry) => sum + entry.url.length, 0);
  if (total > MAX_REFERENCE_CHARS) {
    const error = new Error('Reference images are too large for one Venice request.');
    error.statusCode = 413;
    throw error;
  }
  return rows;
}

''')
bridge = replace_once(bridge, anchor, helper, 'Venice structured reference helper')
bridge = replace_once(
    bridge,
    "    prompt: cleanText(source.prompt, 10_000),\n",
    "    prompt: cleanText(source.prompt, 2500),\n",
    'Venice video prompt limit',
)
old_routing = dedent('''\
  const refs = normalizeImageInputs(source.reference_images, 7);
  const model = payload.model.toLowerCase();
  if (refs.length) {
    if (model.includes('grok-imagine') && model.includes('reference-to-video')) {
      payload.referenceImageUrls = refs;
    } else if (model.includes('kling-o3') && model.includes('reference-to-video')) {
      payload.scene_image_urls = refs.slice(0, 4);
    } else {
      payload.reference_image_urls = refs;
    }
  }
  return payload;
''')
new_routing = dedent('''\
  const entries = normalizeReferenceEntries(source.reference_entries, 7);
  const refs = entries.length ? entries.map(entry => entry.url) : normalizeImageInputs(source.reference_images, 7);
  const model = payload.model.toLowerCase();
  if (refs.length) {
    if (model.includes('grok-imagine') && model.includes('reference-to-video')) {
      // Grok Imagine R2V uses Venice's flat camelCase reference list.
      payload.referenceImageUrls = refs;
    } else if (model.includes('kling-o3') && model.includes('reference-to-video')) {
      // Kling O3 R2V uses structured identity Elements plus scene references.
      const sourceEntries = entries.length ? entries : refs.map(url => ({ url, role: 'general' }));
      const sceneRoles = new Set(['environment', 'mood', 'setting', 'scene', 'background']);
      const identity = sourceEntries.filter(entry => !sceneRoles.has(entry.role));
      const scenes = sourceEntries.filter(entry => sceneRoles.has(entry.role));
      if (identity.length) {
        const primary = identity.slice(0, 4);
        payload.elements = [{
          frontal_image_url: primary[0].url,
          ...(primary.length > 1 ? { reference_image_urls: primary.slice(1).map(entry => entry.url) } : {}),
        }];
        // Extra identity references become additional one-image elements while keeping the
        // combined Venice visual-input ceiling at seven.
        for (const entry of identity.slice(4, 7)) payload.elements.push({ frontal_image_url: entry.url });
        if (!/@Element1\b/i.test(payload.prompt)) payload.prompt = `@Element1 ${payload.prompt}`;
      }
      const usedIdentity = identity.length;
      const roomForScenes = Math.max(0, 7 - usedIdentity);
      if (scenes.length && roomForScenes) {
        payload.scene_image_urls = scenes.slice(0, Math.min(4, roomForScenes)).map(entry => entry.url);
        if (!/@Image1\b/i.test(payload.prompt)) payload.prompt = `${payload.prompt} Use @Image1 as a scene/style reference.`;
      } else if (!identity.length) {
        payload.scene_image_urls = refs.slice(0, 4);
      }
    } else {
      // Seedance/Wan/other flat R2V families use the documented snake_case list.
      payload.reference_image_urls = refs;
    }
  }
  return payload;
''')
bridge = replace_once(bridge, old_routing, new_routing, 'Venice R2V routing')
bridge_path.write_text(bridge)


# Improve Venice client capability handling and persistence.
ui_path = Path('venice-gen-v60.js')
ui = ui_path.read_text()
old_task = dedent('''\
export function veniceModelTask(model) {
  if (model?._kind === 'inpaint') return 'edit';
  if (model?.type !== 'video' && model?._kind !== 'video') return 'generate';
  const raw = String(constraints(model)?.model_type || model?.id || '').toLowerCase();
  if (raw.includes('reference-to-video')) return 'reference-to-video';
  if (raw.includes('image-to-video')) return 'image-to-video';
  if (raw.includes('upscale')) return 'upscale';
  return 'text-to-video';
}
''')
new_task = dedent('''\
export function veniceModelTask(model) {
  if (model?._kind === 'inpaint') return 'edit';
  if (model?.type !== 'video' && model?._kind !== 'video') return 'generate';
  const id = String(model?.id || '').toLowerCase();
  // R2V models are often reported by the generic model_type as image-to-video, so the
  // model ID must be checked first or reference-capable models get misclassified.
  if (id.includes('reference-to-video')) return 'reference-to-video';
  const raw = String(constraints(model)?.model_type || id).toLowerCase();
  if (raw.includes('reference-to-video')) return 'reference-to-video';
  if (raw.includes('image-to-video')) return 'image-to-video';
  if (raw.includes('upscale')) return 'upscale';
  return 'text-to-video';
}
''')
ui = replace_once(ui, old_task, new_task, 'Venice task classification')
ui = replace_once(
    ui,
    "  const candidates = [payload?.balance?.usd, payload?.usd, payload?.balance, payload?.available_balance, payload?.available];\n",
    "  const candidates = [payload?.balances?.usd, payload?.balance?.usd, payload?.usd, payload?.balance, payload?.available_balance, payload?.available];\n",
    'Venice balance shape',
)
old_persist = dedent('''\
  const persist = () => saveSettings({
    ...settings,
    media,
    imageModel: media === 'image' ? modelSelect.value : settings.imageModel,
    videoModel: media === 'video' ? modelSelect.value : settings.videoModel,
    search: search.value,
    task: task.value,
    safety: safety.value,
    sort: sort.value,
    aspectRatio: aspect.value,
    resolution: resolution.value,
    duration: duration.value,
    variants: Number(variants.value) || 1,
    safeMode: safeMode.checked,
    audio: audio.checked,
    referenceSource: refSource.value,
    addToBoard: addBoard.checked,
    prompt: prompt.value,
    negativePrompt: negative.value,
  });
''')
new_persist = dedent('''\
  const persist = () => {
    const next = {
      ...settings,
      media,
      imageModel: media === 'image' ? modelSelect.value : settings.imageModel,
      videoModel: media === 'video' ? modelSelect.value : settings.videoModel,
      search: search.value,
      task: task.value,
      safety: safety.value,
      sort: sort.value,
      aspectRatio: aspect.value,
      resolution: resolution.value,
      duration: duration.value,
      variants: Number(variants.value) || 1,
      safeMode: safeMode.checked,
      audio: audio.checked,
      referenceSource: refSource.value,
      addToBoard: addBoard.checked,
      prompt: prompt.value,
      negativePrompt: negative.value,
    };
    Object.assign(settings, next);
    saveSettings(next);
  };
''')
ui = replace_once(ui, old_persist, new_persist, 'Venice live settings persistence')
ui = replace_once(
    ui,
    "    q('[data-v-audio-wrap]').hidden = media !== 'video' || !(c.audio || c.audio_configurable);\n",
    "    const supportsAudioConfig = c.audio_configurable === true || c.supportsAudioConfig === true;\n    q('[data-v-audio-wrap]').hidden = media !== 'video' || !supportsAudioConfig;\n",
    'Venice audio capability UI',
)
old_quote_fn = regex_once(
    ui,
    r"  const scheduleQuote = \(\) => \{.*?\n  \};\n\n  const loadCatalog",
    dedent('''\
  const scheduleQuote = () => {
    clearTimeout(quoteTimer);
    const model = selectedModel();
    if (!configured || media !== 'video' || !model) return;
    const c = constraints(model);
    const modelAspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
    const modelResolutions = listConstraint(model, 'resolutions');
    const supportsAudioConfig = c.audio_configurable === true || c.supportsAudioConfig === true;
    quoteBox.textContent = 'Checking exact Venice video quote…';
    quoteTimer = setTimeout(async () => {
      try {
        const response = await api('/venice/video/quote', {
          method: 'POST',
          body: {
            model: model.id,
            duration: duration.value,
            resolution: modelResolutions.length ? resolution.value : undefined,
            aspect_ratio: modelAspects.length ? aspect.value : undefined,
            audio: supportsAudioConfig ? audio.checked : undefined,
          },
        });
        const data = await response.json();
        quoteBox.textContent = Number.isFinite(Number(data?.quote)) ? `Exact Venice quote: $${Number(data.quote).toFixed(3)} for this video.` : 'Venice returned a quote response without a numeric USD value.';
      } catch (error) {
        quoteBox.textContent = `Quote unavailable: ${error.message}`;
      }
    }, 280);
  };

  const loadCatalog'''),
    'Venice quote capability routing',
)
ui = old_quote_fn
old_image_call = dedent('''\
        const response = await api('/venice/image', { method: 'POST', body: {
          model: model.id,
          prompt: text,
          negative_prompt: negative.value.trim(),
          aspect_ratio: aspect.value || undefined,
          resolution: resolution.value || undefined,
          variants: needsRefs ? 1 : Number(variants.value) || 1,
          safe_mode: safeMode.checked,
          format: 'webp',
          references: refs.map(entry => entry.dataUrl),
        } });
''')
new_image_call = dedent('''\
        const modelAspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
        const modelResolutions = listConstraint(model, 'resolutions');
        const response = await api('/venice/image', { method: 'POST', body: {
          model: model.id,
          prompt: text,
          negative_prompt: negative.value.trim(),
          aspect_ratio: modelAspects.length ? aspect.value : undefined,
          resolution: modelResolutions.length ? resolution.value : undefined,
          variants: needsRefs ? 1 : Number(variants.value) || 1,
          safe_mode: safeMode.checked,
          format: 'webp',
          references: refs.map(entry => entry.dataUrl),
        } });
''')
ui = replace_once(ui, old_image_call, new_image_call, 'Venice image model-specific sizing')
old_video_quote = dedent('''\
          const quoteData = await (await api('/venice/video/quote', { method: 'POST', body: { model: model.id, duration: duration.value, resolution: resolution.value || undefined, aspect_ratio: aspect.value || undefined, audio: audio.checked } })).json();
''')
new_video_quote = dedent('''\
          const videoConstraints = constraints(model);
          const modelAspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
          const modelResolutions = listConstraint(model, 'resolutions');
          const supportsAudioConfig = videoConstraints.audio_configurable === true || videoConstraints.supportsAudioConfig === true;
          const quoteData = await (await api('/venice/video/quote', { method: 'POST', body: {
            model: model.id,
            duration: duration.value,
            resolution: modelResolutions.length ? resolution.value : undefined,
            aspect_ratio: modelAspects.length ? aspect.value : undefined,
            audio: supportsAudioConfig ? audio.checked : undefined,
          } })).json();
''')
ui = replace_once(ui, old_video_quote, new_video_quote, 'Venice generate-time video quote')
old_queue = dedent('''\
        const queueData = await (await api('/venice/video/queue', { method: 'POST', body: {
          model: model.id,
          prompt: text,
          negative_prompt: negative.value.trim(),
          duration: duration.value,
          resolution: resolution.value || undefined,
          aspect_ratio: aspect.value || undefined,
          audio: audio.checked,
          image_url: modelTask === 'image-to-video' ? refs[0]?.dataUrl : undefined,
          reference_images: modelTask === 'reference-to-video' ? refs.map(entry => entry.dataUrl) : [],
        } })).json();
''')
new_queue = dedent('''\
        const videoConstraints = constraints(model);
        const videoAspects = listConstraint(model, 'aspectRatios', 'aspect_ratios');
        const videoResolutions = listConstraint(model, 'resolutions');
        const videoAudioConfigurable = videoConstraints.audio_configurable === true || videoConstraints.supportsAudioConfig === true;
        const queueData = await (await api('/venice/video/queue', { method: 'POST', body: {
          model: model.id,
          prompt: text,
          negative_prompt: negative.value.trim(),
          duration: duration.value,
          resolution: videoResolutions.length ? resolution.value : undefined,
          aspect_ratio: videoAspects.length ? aspect.value : undefined,
          audio: videoAudioConfigurable ? audio.checked : undefined,
          image_url: modelTask === 'image-to-video' ? refs[0]?.dataUrl : undefined,
          reference_entries: modelTask === 'reference-to-video' ? refs.map(entry => ({ url: entry.dataUrl, role: entry.item?.role || 'general' })) : [],
        } })).json();
''')
ui = replace_once(ui, old_queue, new_queue, 'Venice video reference routing')
ui_path.write_text(ui)


# Extension release metadata.
manifest_path = Path('manifest.json')
manifest = manifest_path.read_text()
manifest = replace_once(manifest, '"js": "launcher-v59.js"', '"js": "launcher-v60.js"', 'manifest launcher')
manifest = replace_once(manifest, '"version": "0.5.9"', '"version": "0.6.0"', 'manifest version')
manifest_path.write_text(manifest)

package_path = Path('package.json')
package = package_path.read_text()
package = replace_once(package, '"version": "0.5.9"', '"version": "0.6.0"', 'package version')
package = replace_once(package, 'node --check launcher-v59.js &&', 'node --check launcher-v59.js && node --check launcher-v60.js &&', 'launcher v60 syntax check')
package = replace_once(package, 'node --check openrouter-gallery-v59.js &&', 'node --check openrouter-gallery-v59.js && node --check openrouter-browser-v60.js && node --check venice-gen-v60.js &&', 'v60 client syntax checks')
package = replace_once(package, 'node --check server-plugin/inspiration-board-sync/openrouter-images-v58.mjs &&', 'node --check server-plugin/inspiration-board-sync/openrouter-images-v58.mjs && node --check server-plugin/inspiration-board-sync/venice-media-v60.mjs &&', 'Venice bridge syntax check')
package_path.write_text(package)


# Changelog.
changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text()
entry = dedent('''\
## 0.6.0

- Added **Venice** as a second Generate provider beside OpenRouter, with native image generation, image edit/reference generation, text-to-video, image-to-video, and reference-to-video.
- Added server-side Venice API-key storage through SillyTavern's own `secrets.json`; the Venice key is never returned to browser JavaScript after saving.
- Added live Venice model discovery instead of a hardcoded catalog, including availability, privacy, task capabilities, image price metadata, and live model traits.
- Added explicit **Uncensored / NSFW-capable** badges and filters for Venice models/variants advertised as uncensored, including the live `most_uncensored` image trait and explicit uncensored variants. Image Safe mode can be switched off for raw model output; video uncensored support stays model-specific.
- Added exact Venice video quotes before queueing, persistent async video job status, polling, finished inline video previews, fullscreen playback, and MP4 save actions.
- Routed video references by model family: Grok flat references, Seedance/Wan flat `reference_image_urls`, and Kling O3 structured Elements plus scene references based on board reference roles.
- Added provider-first model browsing so OpenRouter and Venice are separate catalogs instead of one giant list.
- Added OpenRouter search, price/name/newest sorting, reference-support filtering, explicit uncensored/NSFW labeling when advertised, and honest `Unmoderated`/`Moderated` badges from OpenRouter's live `top_provider.is_moderated` metadata.
- Generate remembers the last provider and continues to preserve all provider-specific controls/prompts between visits.
- Inspiration Board Sync is now **v0.6.0** and must be recopied/restarted once to enable Venice. The Android Capture Browser APK remains compatible at v0.5.6.

''')
if not changelog.startswith('# Changelog\n\n## 0.6.0'):
    changelog = replace_once(changelog, '# Changelog\n\n', '# Changelog\n\n' + entry, 'changelog header')
changelog_path.write_text(changelog)


# Server-plugin documentation.
readme_path = Path('server-plugin/inspiration-board-sync/README.md')
readme = readme_path.read_text()
readme = replace_once(
    readme,
    '- The **v0.5.8 OpenRouter Images API bridge** used by Quick Generate for real `input_references` support.\n',
    '- The **OpenRouter Images API bridge** used by Quick Generate for real `input_references` support.\n- The **v0.6.0 Venice media bridge** for live image/video models, secure Venice API-key storage, image generation/editing, exact video quotes, and async video jobs.\n',
    'server README Venice bullet',
)
readme = replace_once(
    readme,
    'The plugin runtime is **v0.5.8**. Inspiration Board itself can still open without it, but **Quick Generate reference-image requests require this v0.5.8+ server plugin**. Older plugin copies only know the legacy SillyTavern/OpenRouter generation route and cannot correctly send current Image API `input_references`.\n',
    'The plugin runtime is **v0.6.0**. Inspiration Board itself can still open without it, but **OpenRouter reference-image requests require v0.5.8+ and Venice image/video generation requires v0.6.0+**. Updating the browser extension does not update a manually copied server plugin.\n',
    'server README runtime',
)
readme = replace_once(
    readme,
    'After restart, `/api/plugins/inspiration-board-sync/status` should report version `0.5.8` or newer and include the capability `openrouter-image-api`.\n',
    'After restart, `/api/plugins/inspiration-board-sync/status` should report version `0.6.0` or newer and include both `openrouter-image-api` and `venice-image-video`.\n',
    'server README status',
)
venice_section = dedent('''\

## Venice image + video generation

The Venice bridge keeps the Venice API key server-side. In **Generate → Venice**, save the key once; the browser sends it to this plugin over the authenticated SillyTavern session, the plugin validates it, then stores it in SillyTavern's `secrets.json` under `api_key_venice`. The key is never returned to browser JavaScript.

The bridge exposes local authenticated routes for live Venice model metadata/traits, balance, image generation/editing, exact video quotes, queue/retrieve/complete, and model-family-specific reference routing. See `VENICE_MEDIA_GENERATION.md` in the repository root for the user workflow.
''')
if '## Venice image + video generation' not in readme:
    readme = readme.replace('\n## Android share target\n', venice_section + '\n## Android share target\n', 1)
readme_path.write_text(readme)
