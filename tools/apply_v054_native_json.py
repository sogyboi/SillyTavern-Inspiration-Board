from pathlib import Path
from textwrap import dedent
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

# ----- server plugin -----
plugin_path = Path('server-plugin/inspiration-board-sync/index.mjs')
plugin = plugin_path.read_text()
plugin = replace_once(plugin, "const VERSION = '0.4.0';", "const VERSION = '0.5.4';", 'plugin version')
plugin = replace_once(
    plugin,
    "const MAX_REMOTE_IMAGE_BYTES = 40 * 1024 * 1024;\n",
    "const MAX_REMOTE_IMAGE_BYTES = 40 * 1024 * 1024;\nconst MAX_NATIVE_IMAGE_BYTES = 12 * 1024 * 1024;\n",
    'native image limit',
)
plugin = replace_once(
    plugin,
    "        capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy'],\n",
    "        capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy', 'native-json-capture'],\n",
    'status capability',
)
route_anchor = "  router.post('/share-target', upload.array('media', 32), async (req, res) => {\n"
native_route = dedent('''\
  router.post('/capture-native', express.json({ limit: '20mb' }), async (req, res) => {
    try {
      await ensureDirectories(req);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      const folder = path.join(shareRoot(req), id);
      await fs.mkdir(folder, { recursive: true });
      const files = [];

      if (body.image && typeof body.image === 'object' && body.image.data) {
        const mime = String(body.image.mime || '').slice(0, 120).toLowerCase();
        if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Native capture image type is not an image.' });
        const encoded = String(body.image.data || '').replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return res.status(400).json({ error: 'Native capture image data is not valid base64.' });
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length) return res.status(400).json({ error: 'Native capture image is empty.' });
        if (bytes.length > MAX_NATIVE_IMAGE_BYTES) return res.status(413).json({ error: 'Native capture image is larger than 12 MB.' });
        const rawName = String(body.image.name || 'capture.jpg').slice(0, 220);
        const extFromName = path.extname(rawName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 9);
        const extFromMime = mime.includes('png') ? '.png'
          : mime.includes('webp') ? '.webp'
          : mime.includes('gif') ? '.gif'
          : mime.includes('avif') ? '.avif'
          : '.jpg';
        const extension = extFromName || extFromMime;
        const stem = safeId(path.basename(rawName, path.extname(rawName)), 'capture');
        const filename = `01-${stem}${extension}`;
        await fs.writeFile(path.join(folder, filename), bytes);
        files.push({ filename, name: rawName, type: mime, size: bytes.length });
      }

      const text = String(body.text || '').slice(0, 20_000);
      const metadata = {
        id,
        title: String(body.title || 'Captured inspiration').slice(0, 200),
        text,
        url: firstHttpUrl(body.url, text),
        createdAt: Date.now(),
        files,
      };
      await atomicWrite(path.join(folder, 'metadata.json'), JSON.stringify(metadata, null, 2));
      res.json({ ok: true, id, fileCount: files.length });
    } catch (error) {
      console.error('[Inspiration Board Sync] native capture failed', error);
      res.status(500).json({ error: `Could not save native capture: ${error.message}` });
    }
  });

''')
plugin = replace_once(plugin, route_anchor, native_route + route_anchor, 'native capture route insertion')
plugin_path.write_text(plugin)

plugin_pkg = Path('server-plugin/inspiration-board-sync/package.json')
text = plugin_pkg.read_text()
text = replace_once(text, '"version": "0.4.0"', '"version": "0.5.4"', 'plugin package version')
text = text.replace('safe remote page/image bridge for Inspiration Board', 'safe remote page/image bridge, and native JSON capture endpoint for Inspiration Board')
plugin_pkg.write_text(text)

# ----- Android companion -----
activity_path = Path('android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt')
activity = activity_path.read_text()
activity = replace_once(activity, 'import android.widget.Toast\n', 'import android.widget.Toast\nimport android.util.Base64\n', 'Base64 import')
activity = activity.replace('InspirationBoardCapture/0.5.3', 'InspirationBoardCapture/0.5.4')
old_post_start = activity.index('    private fun postCapture(server: String, context: PageCapture, target: String): SaveResult {')
old_post_end = activity.index('    private fun fetchCsrfSession(server: String): StSession {', old_post_start)
new_post = dedent('''\
    private fun postCapture(server: String, context: PageCapture, target: String): SaveResult {
        val session = fetchCsrfSession(server)
        val downloaded = if (context.imageUrl.startsWith("http://") || context.imageUrl.startsWith("https://")) {
            runCatching { downloadImage(context.imageUrl, context.pageUrl) }.getOrNull()
        } else null

        val payload = JSONObject().apply {
            put("title", context.title.ifBlank { "Captured inspiration" })
            put("text", "${buildMarker(context, target)}\n${context.pageUrl}")
            put("url", context.imageUrl.ifBlank { context.pageUrl })
            if (downloaded != null) {
                put("image", JSONObject().apply {
                    put("name", downloaded.fileName)
                    put("mime", downloaded.mime)
                    put("data", Base64.encodeToString(downloaded.bytes, Base64.NO_WRAP))
                })
            }
        }

        val endpoint = URL("$server/api/plugins/inspiration-board-sync/capture-native")
        val connection = endpoint.openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 12_000
        connection.readTimeout = 25_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("X-CSRF-Token", session.token)
        connection.setRequestProperty("Origin", server)
        connection.setRequestProperty("Referer", "$server/")
        connection.setRequestProperty("User-Agent", browserUserAgent)
        if (session.cookie.isNotBlank()) connection.setRequestProperty("Cookie", session.cookie)

        connection.outputStream.use { output ->
            output.write(payload.toString().toByteArray(Charsets.UTF_8))
        }

        val code = connection.responseCode
        val responseText = readConnectionText(connection, code)
        connection.disconnect()
        if (code !in 200..299) {
            if (code == 404) throw IllegalStateException("Server plugin is too old for native save. Update inspiration-board-sync in Termux")
            val jsonError = runCatching { JSONObject(responseText).optString("error") }.getOrDefault("").trim()
            val fallback = responseText.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim().take(220)
            val detail = jsonError.ifBlank { fallback }
            throw IllegalStateException("SillyTavern HTTP $code${if (detail.isNotBlank()) ": $detail" else ""}")
        }
        return SaveResult(uploadedImage = downloaded != null)
    }

''')
activity = activity[:old_post_start] + new_post + activity[old_post_end:]
activity = replace_once(activity, 'val bytes = readLimited(connection.inputStream, 30 * 1024 * 1024)', 'val bytes = readLimited(connection.inputStream, 12 * 1024 * 1024)', 'native image read limit')
activity = replace_once(activity, 'if (total > limit) throw IllegalStateException("Image is larger than 30 MB")', 'if (total > limit) throw IllegalStateException("Image is larger than 12 MB")', 'native image limit error')
# Test button now explicitly requires the native JSON capability.
old_test_success = '                val version = runCatching { JSONObject(body).optString("version") }.getOrDefault("").ifBlank { "unknown" }\n                runOnUiThread { Toast.makeText(this, "Connected · Inspiration Board Sync $version", Toast.LENGTH_LONG).show() }\n'
new_test_success = '                val status = runCatching { JSONObject(body) }.getOrElse { JSONObject() }\n                val version = status.optString("version").ifBlank { "unknown" }\n                val capabilities = status.optJSONArray("capabilities")\n                val supportsNative = (0 until (capabilities?.length() ?: 0)).any { capabilities?.optString(it) == "native-json-capture" }\n                if (!supportsNative) throw IllegalStateException("server plugin $version is too old; update inspiration-board-sync in Termux")\n                runOnUiThread { Toast.makeText(this, "Connected · Inspiration Board Sync $version · native save ready", Toast.LENGTH_LONG).show() }\n'
if old_test_success not in activity:
    raise SystemExit('Could not find testServer success block')
activity = activity.replace(old_test_success, new_test_success, 1)
activity_path.write_text(activity)

gradle_path = Path('android-companion/app/build.gradle.kts')
gradle = gradle_path.read_text()
gradle = re.sub(r'versionCode = \d+', 'versionCode = 8', gradle, count=1)
gradle = replace_once(gradle, 'versionName = "0.5.3"', 'versionName = "0.5.4"', 'Android version')
gradle_path.write_text(gradle)

# ----- extension version/release wiring -----
core_path = Path('capture-browser-core-v5.js')
core = core_path.read_text()
core = replace_once(core, "export const CAPTURE_BROWSER_VERSION = '0.5.3';", "export const CAPTURE_BROWSER_VERSION = '0.5.4';", 'capture browser version')
core = replace_once(core, 'capture-browser-v0.5.3', 'capture-browser-v0.5.4', 'capture browser release')
core_path.write_text(core)

launcher = Path('launcher-v53.js').read_text().replace('0.5.3', '0.5.4')
Path('launcher-v54.js').write_text(launcher)

manifest_path = Path('manifest.json')
manifest = manifest_path.read_text()
manifest = replace_once(manifest, '"launcher-v53.js"', '"launcher-v54.js"', 'manifest launcher')
manifest = replace_once(manifest, '"version": "0.5.3"', '"version": "0.5.4"', 'manifest version')
manifest_path.write_text(manifest)

package_path = Path('package.json')
package = package_path.read_text()
package = replace_once(package, '"version": "0.5.3"', '"version": "0.5.4"', 'package version')
package = replace_once(package, 'node --check launcher-v53.js &&', 'node --check launcher-v53.js && node --check launcher-v54.js &&', 'launcher check')
package_path.write_text(package)

workflow_path = Path('.github/workflows/android-capture-browser.yml')
workflow = workflow_path.read_text().replace('0.5.3', '0.5.4')
workflow = workflow.replace(
    'Fixes native direct saves failing when WebView or CookieManager APIs were touched from a background thread. The browser user agent is now captured on the Android UI thread and all cookie access is marshalled safely to that thread while preserving the v0.5.2 CSRF/session handshake, direct image upload, HTTP diagnostics, and Android Share fallback.',
    'Moves native direct saving off fragile multipart parsing and onto a CSRF-protected JSON capture endpoint in Inspiration Board Sync. The APK sends optional base64 image bytes plus source metadata, retains UI-thread-safe cookie handling, and keeps Android Share as fallback. Requires the v0.5.4 server plugin copy in Termux.'
)
workflow_path.write_text(workflow)

# ----- tests -----
Path('tests/native-json-capture-v054.test.mjs').write_text(dedent('''\
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const activity = fs.readFileSync(new URL('../android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/index.mjs', import.meta.url), 'utf8');
const pluginPackage = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/package.json', import.meta.url), 'utf8');
const start = activity.indexOf('private fun postCapture');
const end = activity.indexOf('private fun fetchCsrfSession');
const post = activity.slice(start, end);

test('native direct save uses JSON instead of multipart', () => {
  assert.match(post, /capture-native/);
  assert.match(post, /application\/json; charset=utf-8/);
  assert.match(post, /Base64\.encodeToString/);
  assert.doesNotMatch(post, /multipart\/form-data/);
  assert.doesNotMatch(post, /writeField\(/);
  assert.doesNotMatch(post, /writeFile\(/);
});

test('server plugin exposes CSRF-protected native JSON capture route', () => {
  assert.match(plugin, /router\.post\('\/capture-native', express\.json\(\{ limit: '20mb' \}\)/);
  assert.match(plugin, /native-json-capture/);
  assert.match(plugin, /MAX_NATIVE_IMAGE_BYTES = 12 \* 1024 \* 1024/);
  assert.match(plugin, /Could not save native capture/);
  assert.match(pluginPackage, /"version": "0\.5\.4"/);
});

test('native test warns when installed server plugin is too old', () => {
  assert.match(activity, /server plugin .* is too old; update inspiration-board-sync in Termux/);
  assert.match(activity, /native save ready/);
});
'''))

# Update existing version assertions.
for name in ['tests/android-capture-native-v052.test.mjs', 'tests/capture-browser-core-v5.test.mjs']:
    p = Path(name)
    t = p.read_text().replace('v0.5.3', 'v0.5.4').replace('0\\.5\\.3', '0\\.5\\.4').replace("'0.5.3'", "'0.5.4'")
    p.write_text(t)

# ----- docs -----
docs_path = Path('CAPTURE_BROWSER.md')
docs = docs_path.read_text().replace('# Android Capture Browser (v0.5.3)', '# Android Capture Browser (v0.5.4)', 1)
note = dedent('''\

## v0.5.4 native JSON save

The purple `+` direct-save path no longer uses multipart form parsing. The APK performs the existing SillyTavern CSRF/session handshake, then posts JSON to `/api/plugins/inspiration-board-sync/capture-native`, including source metadata and optional base64 image bytes. This avoids native multipart/Multer parser failures. **v0.5.4 requires updating the `inspiration-board-sync` server plugin copy in Termux once.** Android Share/PWA capture remains a fallback and continues to use the existing share-target route.
''')
if '## v0.5.4 native JSON save' not in docs:
    docs = docs.replace('\n## Install\n', note + '\n## Install\n', 1)
docs = docs.replace('v0.5.3', 'v0.5.4')
docs_path.write_text(docs)

changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text()
entry = dedent('''\
## 0.5.4

- Replaced the Android Capture Browser native direct-save multipart request with a dedicated JSON capture path.
- Added server-plugin `POST /capture-native` with a route-local JSON body limit, optional validated base64 image storage, and structured JSON errors.
- Added the `native-json-capture` server capability and bumped Inspiration Board Sync to v0.5.4.
- Kept the SillyTavern CSRF/session handshake and UI-thread-safe cookie handling from v0.5.3.
- Reduced direct native image payloads to 12 MB; larger/blocked images fall back to source-link capture/Android Share.
- Added a companion connection test that explicitly warns when the installed Termux server plugin is too old.
- Added regression tests ensuring the native app no longer uses multipart for its purple `+` direct-save path.
- Published `InspirationBoard-CaptureBrowser-v0.5.4.apk`.

''')
if not changelog.startswith('# Changelog\n\n## 0.5.4'):
    changelog = changelog.replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
changelog_path.write_text(changelog)
