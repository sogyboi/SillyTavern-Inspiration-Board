from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)

# Fix the Quick Generate minimum-price estimate: Number(null) is 0 and must not
# become a fake zero-dollar estimate for token/megapixel-priced models.
quick_path = Path('openrouter-gen-v58.js')
quick = quick_path.read_text()
quick = replace_once(
    quick,
    "  if (Number.isFinite(Number(summary.minimumPerImage))) {\n",
    "  if (summary.minimumPerImage !== null && summary.minimumPerImage !== undefined && Number.isFinite(Number(summary.minimumPerImage))) {\n",
    'Quick Generate null price guard',
)
quick_path.write_text(quick)

# Wire the dedicated OpenRouter Images API bridge into the installed server plugin.
plugin_path = Path('server-plugin/inspiration-board-sync/index.mjs')
plugin = plugin_path.read_text()
plugin = replace_once(
    plugin,
    "import multer from 'multer';\n",
    "import multer from 'multer';\nimport { installOpenRouterImagesBridge } from './openrouter-images-v58.mjs';\n",
    'plugin bridge import',
)
plugin = replace_once(plugin, "const VERSION = '0.5.6';", "const VERSION = '0.5.8';", 'plugin version')
plugin = replace_once(
    plugin,
    "export async function init(router) {\n",
    "export async function init(router) {\n  installOpenRouterImagesBridge(router);\n",
    'plugin bridge installer',
)
plugin = replace_once(
    plugin,
    "        capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy', 'native-json-capture', 'native-raw-capture'],\n",
    "        capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy', 'native-json-capture', 'native-raw-capture', 'openrouter-image-api'],\n",
    'plugin capability flag',
)
plugin_path.write_text(plugin)

# Changelog.
changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text()
entry = """## 0.5.8\n\n- Fixed the board's original **Generate image · OpenRouter** / Quick Generate modal so it now shows the same live OpenRouter image pricing added to Generation Studio in v0.5.7.\n- Model choices now show unit-aware price text plus live reference support (`no refs`, optional maximum, or required minimum/maximum).\n- Quick Generate now remembers model, aspect ratio, image count, reference source, reference toggle, board/Inbox destination, and the prompt itself as soon as they change instead of only after a successful Generate click.\n- Reference compatibility is read from OpenRouter's dedicated Image API `supported_parameters.input_references` metadata instead of guessed from model names. Supported aspect ratios and output-count limits also follow each model's live capability record.\n- Added a dedicated OpenRouter Images API server bridge using SillyTavern's existing server-side OpenRouter secret, so reference-guided generation uses `POST /api/v1/images` with `input_references` instead of SillyTavern's older chat-completions image path.\n- Generation references now use the original stored image rather than the board thumbnail, preventing minimum-reference-size failures on providers such as Recraft Styles.\n- Added explicit style-reference handling for models such as Recraft V4 Styles Vector: the UI marks style matching as the model's purpose instead of promising identity-preserving editing.\n- Inspiration Board Sync is now v0.5.8 and must be recopied/restarted for modern reference generation. Non-reference Quick Generate can still fall back to SillyTavern's legacy route if the bridge is unavailable.\n\n"""
if not changelog.startswith('# Changelog\n\n## 0.5.8'):
    changelog = replace_once(changelog, '# Changelog\n\n', '# Changelog\n\n' + entry, 'changelog header')
changelog_path.write_text(changelog)

# Refresh the old Quick Generate documentation so it no longer describes the legacy path.
doc_path = Path('OPENROUTER_IMAGE_GENERATION.md')
doc = doc_path.read_text()
intro_old = "Inspiration Board v0.2.1 can generate images from inside the board with OpenRouter.\n"
intro_new = "Inspiration Board v0.5.8 can generate images from inside the board with OpenRouter. Quick Generate now reads OpenRouter's live Image API model capabilities and pricing before it sends a request.\n"
doc = replace_once(doc, intro_old, intro_new, 'OpenRouter doc intro')
old_route = "The extension does **not** store or display the OpenRouter API key. Requests are sent through SillyTavern's existing `/api/openrouter/*` server routes, which use SillyTavern's server-side secret storage.\n"
new_route = "The extension does **not** store or display the OpenRouter API key. Reference-guided Quick Generate requests use the v0.5.8 `inspiration-board-sync` server plugin, which reads SillyTavern's existing server-side OpenRouter secret and forwards the request to OpenRouter's dedicated `/api/v1/images` endpoint.\n"
doc = replace_once(doc, old_route, new_route, 'OpenRouter doc route')
old_refs = "Up to eight references are attached. The prompt tells the model how each role should be used (face, hair, outfit, accessory, mood, environment, and so on).\n\nReference-image support depends on the selected OpenRouter image model. If a model rejects image input, use a model that supports image inputs (for example an appropriate GPT Image model) or turn off **Send reference images**.\n"
new_refs = "Quick Generate reads `supported_parameters.input_references` from OpenRouter's dedicated image-model catalog. The UI shows whether references are unsupported, optional, or required and enforces the model's current min/max. The original stored image is sent rather than a downsized board thumbnail.\n\nStyle-reference models are labeled separately. For example, a Recraft Styles model uses references to match rendering style; that does not mean it is the best model for exact character-identity preservation.\n"
doc = replace_once(doc, old_refs, new_refs, 'OpenRouter doc refs')
old_controls = "- 1-4 outputs per run\n"
new_controls = "- output count constrained to the selected model's live `n` limit\n"
doc = replace_once(doc, old_controls, new_controls, 'OpenRouter doc count')
addition = """\n## v0.5.8 server-plugin requirement\n\nIf Quick Generate is sending reference images, copy the current `server-plugin/inspiration-board-sync` folder into `SillyTavern/plugins/inspiration-board-sync` and fully restart SillyTavern. `/api/plugins/inspiration-board-sync/status` should report v0.5.8+ and include `openrouter-image-api`. Updating the browser extension does not update a manually copied server plugin.\n\nQuick Generate persists its controls and prompt in local browser storage immediately, so reopening the panel restores the last working setup.\n"""
if '## v0.5.8 server-plugin requirement' not in doc:
    doc += addition
doc_path.write_text(doc)
