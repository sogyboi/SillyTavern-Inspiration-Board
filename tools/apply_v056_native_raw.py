from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)

# ---------------- Server plugin ----------------
plugin_path = Path('server-plugin/inspiration-board-sync/index.mjs')
plugin = plugin_path.read_text()
plugin = replace_once(plugin, "const VERSION = '0.5.5';", "const VERSION = '0.5.6';", 'plugin version')
plugin = replace_once(
    plugin,
    'const MAX_NATIVE_IMAGE_BYTES = 12 * 1024 * 1024;\n',
    'const MAX_NATIVE_IMAGE_BYTES = 12 * 1024 * 1024;\nconst MAX_NATIVE_REQUEST_BYTES = 20 * 1024 * 1024;\n',
    'native request limit',
)
plugin = replace_once(
    plugin,
    "capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy', 'native-json-capture'],",
    "capabilities: ['workspace-sync', 'android-share', 'remote-page-resolver', 'remote-image-proxy', 'native-json-capture', 'native-raw-capture'],",
    'plugin capability',
)
reader = r'''
async function readNativeCapturePayload(req) {
  const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/x-inspiration-board-capture') {
    return req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_NATIVE_REQUEST_BYTES) {
      const error = new Error('Native capture request is larger than 20 MB.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  if (!total) return {};

  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    const error = new Error('Native capture request is not valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

'''
anchor = 'export async function init(router) {'
if reader.strip() not in plugin:
    plugin = replace_once(plugin, anchor, reader + anchor, 'native raw reader insertion')

old_start = """router.post('/capture-native', async (req, res) => {
  try {
    await ensureDirectories(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
"""
new_start = """router.post('/capture-native', async (req, res) => {
  try {
    const body = await readNativeCapturePayload(req);
    if (body.probe === true) return res.json({ ok: true, probe: true, version: VERSION });
    await ensureDirectories(req);
"""
plugin = replace_once(plugin, old_start, new_start, 'capture route body parsing')
old_catch = """  } catch (error) {
    console.error('[Inspiration Board Sync] native capture failed', error);
    res.status(500).json({ error: `Could not save native capture: ${error.message}` });
  }
});
"""
new_catch = """  } catch (error) {
    console.error('[Inspiration Board Sync] native capture failed', error);
    const status = Number(error?.statusCode) || 500;
    res.status(status).json({ error: `Could not save native capture: ${error.message}` });
  }
});
"""
plugin = replace_once(plugin, old_catch, new_catch, 'capture route structured error status')
plugin_path.write_text(plugin)

pkg_path = Path('server-plugin/inspiration-board-sync/package.json')
pkg = pkg_path.read_text().replace('"version": "0.5.5"', '"version": "0.5.6"', 1)
pkg_path.write_text(pkg)

# ---------------- Android companion ----------------
activity_path = Path('android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt')
activity = activity_path.read_text().replace('InspirationBoardCapture/0.5.4', 'InspirationBoardCapture/0.5.6')

post_start = activity.index('private fun postCapture(server: String, context: PageCapture, target: String): SaveResult {')
post_end = activity.index('    private fun fetchCsrfSession(server: String): StSession {', post_start)
new_post = r'''private fun postCapture(server: String, context: PageCapture, target: String): SaveResult {
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

    sendNativePayload(server, session, payload)
    return SaveResult(uploadedImage = downloaded != null)
}

    private fun sendNativePayload(server: String, session: StSession, payload: JSONObject): JSONObject {
        val endpoint = URL("$server/api/plugins/inspiration-board-sync/capture-native")
        val connection = endpoint.openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 12_000
        connection.readTimeout = 25_000
        connection.doOutput = true
        // Deliberately avoid application/json here. SillyTavern owns the global JSON parser;
        // this private media type leaves the stream untouched until the plugin handles it.
        connection.setRequestProperty("Content-Type", "application/x-inspiration-board-capture")
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
        return runCatching { JSONObject(responseText) }.getOrElse { JSONObject().put("ok", true) }
    }

    private fun mergeCookieHeader(vararg values: String): String {
        val cookies = linkedMapOf<String, String>()
        values.forEach { value ->
            value.split(';').map(String::trim).filter { it.contains('=') }.forEach { part ->
                val name = part.substringBefore('=').trim()
                if (name.isNotBlank()) cookies[name] = part
            }
        }
        return cookies.values.joinToString("; ")
    }

'''
activity = activity[:post_start] + new_post + activity[post_end:]
old_cookies = """        val cookies = buildList {
            if (existingCookie.isNotBlank()) add(existingCookie)
            addAll(setCookies)
            val webViewCookie = cookieFor(server)
            if (webViewCookie.isNotBlank()) add(webViewCookie)
        }
            .flatMap { value -> value.split(';').map(String::trim) }
            .filter { it.contains('=') }
            .distinct()
            .joinToString("; ")
"""
new_cookies = """        // Keep one value per cookie name. The Set-Cookie values from this CSRF response
        // are authoritative and override any older WebView/session copy.
        val cookies = mergeCookieHeader(existingCookie, setCookies.joinToString("; "))
"""
activity = replace_once(activity, old_cookies, new_cookies, 'session cookie merge')

test_start = activity.index('    private fun testServer(server: String) {')
test_end = activity.index('    private fun friendlyError(error: Throwable): String {', test_start)
new_test = r'''    private fun testServer(server: String) {
        Toast.makeText(this, "Testing full save path…", Toast.LENGTH_SHORT).show()
        thread {
            try {
                val session = fetchCsrfSession(server)
                val connection = URL("$server/api/plugins/inspiration-board-sync/status").openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 8_000
                connection.readTimeout = 10_000
                connection.setRequestProperty("Accept", "application/json")
                if (session.cookie.isNotBlank()) connection.setRequestProperty("Cookie", session.cookie)
                val code = connection.responseCode
                val body = readConnectionText(connection, code)
                connection.disconnect()
                if (code !in 200..299) throw IllegalStateException("plugin status HTTP $code")
                val status = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
                val version = status.optString("version").ifBlank { "unknown" }
                val capabilities = status.optJSONArray("capabilities")
                val supportsRaw = (0 until (capabilities?.length() ?: 0)).any { capabilities?.optString(it) == "native-raw-capture" }
                if (!supportsRaw) throw IllegalStateException("server plugin $version is too old for verified native saves; update inspiration-board-sync in Termux")

                // Exercise the same CSRF-protected POST transport used by the purple + button.
                val probe = sendNativePayload(server, session, JSONObject().put("probe", true))
                if (!probe.optBoolean("ok") || !probe.optBoolean("probe")) {
                    throw IllegalStateException("native capture POST probe returned an unexpected response")
                }

                runOnUiThread {
                    Toast.makeText(this, "Connected · Sync $version · POST save path verified", Toast.LENGTH_LONG).show()
                    prefs.edit().putString("server", server).apply()
                }
            } catch (error: Throwable) {
                runOnUiThread {
                    AlertDialog.Builder(this)
                        .setTitle("Connection test failed")
                        .setMessage(friendlyError(error))
                        .setPositiveButton("OK", null)
                        .show()
                }
            }
        }
    }

'''
activity = activity[:test_start] + new_test + activity[test_end:]
activity_path.write_text(activity)

gradle_path = Path('android-companion/app/build.gradle.kts')
gradle = gradle_path.read_text()
gradle = re.sub(r'versionCode = \d+', 'versionCode = 9', gradle, count=1)
gradle = replace_once(gradle, 'versionName = "0.5.4"', 'versionName = "0.5.6"', 'android version')
gradle_path.write_text(gradle)

# ---------------- Extension/release wiring ----------------
core_path = Path('capture-browser-core-v5.js')
core = core_path.read_text()
core = replace_once(core, "export const CAPTURE_BROWSER_VERSION = '0.5.4';", "export const CAPTURE_BROWSER_VERSION = '0.5.6';", 'companion bridge version')
core = replace_once(core, 'capture-browser-v0.5.4', 'capture-browser-v0.5.6', 'companion release URL')
core_path.write_text(core)

launcher = Path('launcher-v55.js').read_text().replace('0.5.5', '0.5.6')
launcher = launcher.replace(
    'Capture-first character workspace. v0.5.6 fixes the SillyTavern server JSON save path; Android Capture Browser v0.5.4 remains compatible and Android Share stays available as fallback.',
    'Capture-first character workspace. v0.5.6 uses a private raw native transport that bypasses SillyTavern body parsers, and the companion Test button now verifies the real POST save path.',
)
Path('launcher-v56.js').write_text(launcher)

manifest_path = Path('manifest.json')
manifest = manifest_path.read_text().replace('"launcher-v55.js"', '"launcher-v56.js"', 1).replace('"version": "0.5.5"', '"version": "0.5.6"', 1)
manifest_path.write_text(manifest)

root_pkg_path = Path('package.json')
root_pkg = root_pkg_path.read_text().replace('"version": "0.5.5"', '"version": "0.5.6"', 1)
root_pkg = replace_once(root_pkg, 'node --check launcher-v55.js &&', 'node --check launcher-v55.js && node --check launcher-v56.js &&', 'launcher check')
root_pkg_path.write_text(root_pkg)

# ---------------- Tests ----------------
for test_path in [Path('tests/android-capture-native-v052.test.mjs'), Path('tests/capture-browser-core-v5.test.mjs')]:
    t = test_path.read_text().replace('0.5.4', '0.5.6').replace('0\\.5\\.4', '0\\.5\\.6')
    test_path.write_text(t)

p = Path('tests/native-json-capture-v054.test.mjs')
t = p.read_text()
t = t.replace("test('native direct save uses JSON instead of multipart', () => {", "test('native direct save uses private raw JSON transport instead of multipart or global JSON parsing', () => {")
t = t.replace("  assert.match(post, /application\\/json; charset=utf-8/);", "  assert.match(post, /application\\/x-inspiration-board-capture/);\n  assert.doesNotMatch(post, /application\\/json; charset=utf-8/);")
t = t.replace('"version": "0\\.5\\.5"', '"version": "0\\.5\\.6"')
p.write_text(t)

p = Path('tests/server-json-parser-v055.test.mjs')
t = p.read_text().replace("0\\.5\\.5", "0\\.5\\.6")
p.write_text(t)

Path('tests/native-raw-transport-v056.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const activity = fs.readFileSync(new URL('../android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/index.mjs', import.meta.url), 'utf8');

test('native v0.5.6 bypasses SillyTavern JSON body parsing with a private media type', () => {
  assert.match(activity, /application\/x-inspiration-board-capture/);
  assert.match(plugin, /application\/x-inspiration-board-capture/);
  assert.match(plugin, /for await \(const chunk of req\)/);
  assert.match(plugin, /MAX_NATIVE_REQUEST_BYTES = 20 \* 1024 \* 1024/);
  assert.doesNotMatch(plugin, /router\.post\('\/capture-native',\s*express\.json/);
});

test('settings Test performs the real CSRF-protected POST probe', () => {
  assert.match(plugin, /native-raw-capture/);
  assert.match(plugin, /body\.probe === true/);
  assert.match(activity, /sendNativePayload\(server, session, JSONObject\(\)\.put\("probe", true\)\)/);
  assert.match(activity, /POST save path verified/);
});

test('CSRF session cookie header de-duplicates cookie names with newest values winning', () => {
  assert.match(activity, /private fun mergeCookieHeader/);
  assert.match(activity, /cookies\[name\] = part/);
  assert.match(activity, /mergeCookieHeader\(existingCookie, setCookies\.joinToString/);
});
''')

# Changelog and docs.
p = Path('CHANGELOG.md')
text = p.read_text()
entry = """## 0.5.6\n\n- Reworked native Capture Browser saving to use `application/x-inspiration-board-capture` instead of `application/json`, bypassing SillyTavern's global JSON body parser entirely.\n- Inspiration Board Sync now reads the private native request stream itself inside the route try/catch with a 20 MB request limit and structured 400/413 errors.\n- Added a no-write `probe` mode to `/capture-native`.\n- The companion Settings **Test** button now performs a real CSRF-protected POST probe through the same transport as the purple `+` button; a successful test now verifies the actual save path.\n- Hardened native session cookie construction so duplicate cookie names cannot send stale and fresh SillyTavern session values together.\n- Added regression tests for the private raw transport, POST probe, stream limits, and cookie de-duplication.\n\n"""
if not text.startswith('# Changelog\n\n## 0.5.6'):
    text = text.replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
p.write_text(text)

p = Path('CAPTURE_BROWSER.md')
text = p.read_text()
if '## v0.5.6 verified native transport' not in text:
    text = text.replace('\n## Install\n', '\n## v0.5.6 verified native transport\n\nThe companion now sends direct captures with a private raw content type so SillyTavern does not pre-parse the body. The server plugin parses the payload inside its own guarded handler. Settings → **Test** now performs a real POST probe, so `POST save path verified` confirms the same transport used by the floating **+** is working.\n\n## Install\n', 1)
text = text.replace('v0.5.4', 'v0.5.6')
p.write_text(text)
