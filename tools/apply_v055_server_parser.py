from pathlib import Path

PLUGIN = Path('server-plugin/inspiration-board-sync/index.mjs')
text = PLUGIN.read_text()
old_route = "router.post('/capture-native', express.json({ limit: '20mb' }), async (req, res) => {"
new_route = "// SillyTavern globally parses application/json before server plugins are mounted.\n// Do not attach a second JSON body parser here: re-reading an already-consumed request\n// stream can throw before this handler's try/catch and surface as Express's generic HTML 500.\nrouter.post('/capture-native', async (req, res) => {"
if old_route not in text:
    raise SystemExit('capture-native route-level JSON parser not found')
text = text.replace("const VERSION = '0.5.4';", "const VERSION = '0.5.5';", 1)
text = text.replace(old_route, new_route, 1)
PLUGIN.write_text(text)

p = Path('server-plugin/inspiration-board-sync/package.json')
text = p.read_text().replace('"version": "0.5.4"', '"version": "0.5.5"', 1)
p.write_text(text)

# Extension release marker; the Android companion itself stays on v0.5.4 and remains compatible.
base = Path('launcher-v54.js').read_text()
launcher = base.replace("import './launcher-v41.js?v=0.5.4';", "import './launcher-v41.js?v=0.5.5';", 1)
launcher = launcher.replace("import { installCaptureBrowserBridge } from './capture-browser-v5.js?v=0.5.4';", "import { installCaptureBrowserBridge } from './capture-browser-v5.js?v=0.5.5';", 1)
launcher = launcher.replace("const VERSION = '0.5.4';", "const VERSION = '0.5.5';", 1)
launcher = launcher.replace(
    "Capture-first character workspace with Android Capture Browser v0.5.4: direct native saves now negotiate SillyTavern CSRF/session data automatically, with Android Share kept as the fallback.",
    "Capture-first character workspace. v0.5.5 fixes the SillyTavern server JSON save path; Android Capture Browser v0.5.4 remains compatible and Android Share stays available as fallback.",
    1,
)
Path('launcher-v55.js').write_text(launcher)

p = Path('manifest.json')
text = p.read_text().replace('"js": "launcher-v54.js"', '"js": "launcher-v55.js"', 1).replace('"version": "0.5.4"', '"version": "0.5.5"', 1)
p.write_text(text)

p = Path('package.json')
text = p.read_text().replace('"version": "0.5.4"', '"version": "0.5.5"', 1)
text = text.replace('node --check launcher-v54.js &&', 'node --check launcher-v54.js && node --check launcher-v55.js &&', 1)
p.write_text(text)

# Regression test: ST owns JSON parsing globally, so capture-native must not install another parser.
test = Path('tests/server-json-parser-v055.test.mjs')
test.write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const plugin = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/index.mjs', import.meta.url), 'utf8');

test('native capture relies on SillyTavern global JSON parser instead of double parsing the stream', () => {
  assert.match(plugin, /const VERSION = '0\\.5\\.5'/);
  assert.match(plugin, /router\\.post\\('\/capture-native', async \\(req, res\\) =>/);
  assert.doesNotMatch(plugin, /router\\.post\\('\/capture-native',\\s*express\\.json/);
  assert.match(plugin, /SillyTavern globally parses application\/json/);
});
""")

p = Path('CHANGELOG.md')
text = p.read_text()
entry = """## 0.5.5\n\n- Fixed the v0.5.4 native JSON save route throwing SillyTavern's generic HTML HTTP 500 before the plugin handler could run.\n- Removed the redundant route-level `express.json()` middleware from `/capture-native`; SillyTavern already parses JSON globally before server plugins are mounted.\n- Added a regression test preventing the native capture route from double-parsing SillyTavern request streams again.\n- Android Capture Browser v0.5.4 remains compatible; no APK reinstall is required for this server-side hotfix.\n- The installed `inspiration-board-sync` server plugin must be replaced with v0.5.5 and SillyTavern restarted.\n\n"""
if not text.startswith('# Changelog\n\n## 0.5.5'):
    text = text.replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
p.write_text(text)
