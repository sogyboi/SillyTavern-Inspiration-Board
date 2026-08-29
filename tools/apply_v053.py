from pathlib import Path
import re
from textwrap import dedent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


activity_path = Path('android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt')
activity = activity_path.read_text()
activity = replace_once(activity, 'import android.os.Bundle\n', 'import android.os.Bundle\nimport android.os.Looper\n', 'Looper import')
activity = replace_once(activity, 'import java.util.UUID\n', 'import java.util.UUID\nimport java.util.concurrent.FutureTask\n', 'FutureTask import')
activity = replace_once(
    activity,
    '    private val prefs by lazy { getSharedPreferences("capture-browser", MODE_PRIVATE) }\n',
    '    private val prefs by lazy { getSharedPreferences("capture-browser", MODE_PRIVATE) }\n\n'
    '    @Volatile\n'
    '    private var browserUserAgent = "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 InspirationBoardCapture/0.5.3"\n',
    'browser user-agent field',
)
activity = replace_once(
    activity,
    '            userAgentString = "$userAgentString InspirationBoardCapture/0.5.2"\n'
    '        }\n'
    '        webView.webChromeClient = WebChromeClient()\n',
    '            userAgentString = "$userAgentString InspirationBoardCapture/0.5.3"\n'
    '        }\n'
    '        // WebView APIs are UI-thread-only. Snapshot the UA once for worker-thread HTTP calls.\n'
    '        browserUserAgent = webView.settings.userAgentString\n'
    '        webView.webChromeClient = WebChromeClient()\n',
    'WebView user-agent snapshot',
)
helper_anchor = dedent('''\
    private fun normalizeServer(value: String): String {
        val clean = value.trim().trimEnd('/')
        return if (clean.isBlank()) "" else clean
    }

''')
helper_insert = helper_anchor + dedent('''\
    private fun <T> uiValue(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val task = FutureTask<T> { block() }
        runOnUiThread(task)
        return task.get()
    }

    private fun cookieFor(url: String): String =
        uiValue { CookieManager.getInstance().getCookie(url).orEmpty() }

    private fun storeCookies(url: String, values: List<String>) {
        if (values.isEmpty()) return
        uiValue {
            val manager = CookieManager.getInstance()
            values.forEach { manager.setCookie(url, it) }
            manager.flush()
        }
    }

''')
activity = replace_once(activity, helper_anchor, helper_insert, 'UI-thread helper insertion')
ua_call = 'connection.setRequestProperty("User-Agent", webView.settings.userAgentString)'
if activity.count(ua_call) != 2:
    raise SystemExit(f'Expected exactly 2 background WebView user-agent reads, found {activity.count(ua_call)}')
activity = activity.replace(ua_call, 'connection.setRequestProperty("User-Agent", browserUserAgent)')
activity = replace_once(
    activity,
    '        val existingCookie = CookieManager.getInstance().getCookie(server).orEmpty()\n',
    '        val existingCookie = cookieFor(server)\n',
    'existing server cookie read',
)
activity = replace_once(
    activity,
    '        for (header in setCookies) CookieManager.getInstance().setCookie(server, header)\n'
    '        CookieManager.getInstance().flush()\n',
    '        storeCookies(server, setCookies)\n',
    'cookie write/flush',
)
activity = replace_once(
    activity,
    '            val webViewCookie = CookieManager.getInstance().getCookie(server).orEmpty()\n',
    '            val webViewCookie = cookieFor(server)\n',
    'post-handshake cookie read',
)
activity = replace_once(
    activity,
    '        CookieManager.getInstance().getCookie(value)?.takeIf { it.isNotBlank() }?.let { connection.setRequestProperty("Cookie", it) }\n',
    '        cookieFor(value).takeIf { it.isNotBlank() }?.let { connection.setRequestProperty("Cookie", it) }\n',
    'image cookie read',
)
activity_path.write_text(activity)

# Android package version.
gradle_path = Path('android-companion/app/build.gradle.kts')
gradle = gradle_path.read_text()
gradle = re.sub(r'versionCode = \d+', 'versionCode = 7', gradle, count=1)
gradle = replace_once(gradle, 'versionName = "0.5.2"', 'versionName = "0.5.3"', 'Android version name')
gradle_path.write_text(gradle)

# Extension bridge and release target.
core_path = Path('capture-browser-core-v5.js')
core = core_path.read_text()
core = replace_once(core, "export const CAPTURE_BROWSER_VERSION = '0.5.2';", "export const CAPTURE_BROWSER_VERSION = '0.5.3';", 'bridge version')
core = replace_once(core, 'capture-browser-v0.5.2', 'capture-browser-v0.5.3', 'bridge release URL')
core_path.write_text(core)

launcher = Path('launcher-v52.js').read_text().replace('0.5.2', '0.5.3')
Path('launcher-v53.js').write_text(launcher)

manifest_path = Path('manifest.json')
manifest = manifest_path.read_text()
manifest = replace_once(manifest, '"launcher-v52.js"', '"launcher-v53.js"', 'manifest launcher')
manifest = replace_once(manifest, '"version": "0.5.2"', '"version": "0.5.3"', 'manifest version')
manifest_path.write_text(manifest)

package_path = Path('package.json')
package = package_path.read_text()
package = replace_once(package, '"version": "0.5.2"', '"version": "0.5.3"', 'package version')
package = replace_once(package, 'node --check launcher-v52.js &&', 'node --check launcher-v52.js && node --check launcher-v53.js &&', 'launcher syntax check')
package_path.write_text(package)

android_workflow_path = Path('.github/workflows/android-capture-browser.yml')
android_workflow = android_workflow_path.read_text().replace('0.5.2', '0.5.3')
android_workflow = android_workflow.replace(
    'CSRF/session-aware native capture saving and real HTTP diagnostics.',
    'CSRF/session-aware native capture saving, UI-thread-safe WebView access, and real HTTP diagnostics.',
)
android_workflow_path.write_text(android_workflow)

native_test_path = Path('tests/android-capture-native-v052.test.mjs')
native_test = native_test_path.read_text().replace('v0.5.2', 'v0.5.3').replace('0\\.5\\.2', '0\\.5\\.3')
native_test_path.write_text(native_test)

core_test_path = Path('tests/capture-browser-core-v5.test.mjs')
core_test = core_test_path.read_text().replace('v0.5.2', 'v0.5.3').replace("'0.5.2'", "'0.5.3'").replace('v0\\.5\\.2', 'v0\\.5\\.3')
core_test_path.write_text(core_test)

Path('tests/android-capture-thread-v053.test.mjs').write_text(dedent('''\
    import test from 'node:test';
    import assert from 'node:assert/strict';
    import fs from 'node:fs';

    const source = fs.readFileSync(new URL('../android-companion/app/src/main/java/com/sogyboi/inspirationboard/capture/CaptureBrowserActivity.kt', import.meta.url), 'utf8');
    const networkStart = source.indexOf('private fun postCapture');
    const networkEnd = source.indexOf('private fun shareFallback');
    const networkSection = source.slice(networkStart, networkEnd);

    test('worker-thread networking never reads WebView or CookieManager directly', () => {
      assert.ok(networkStart > 0 && networkEnd > networkStart);
      assert.doesNotMatch(networkSection, /webView\./);
      assert.doesNotMatch(networkSection, /CookieManager\./);
      assert.match(networkSection, /browserUserAgent/);
      assert.match(networkSection, /cookieFor\(/);
      assert.match(networkSection, /storeCookies\(/);
    });

    test('UI bridge protects CookieManager access used by native networking', () => {
      assert.match(source, /Looper\.myLooper\(\) == Looper\.getMainLooper\(\)/);
      assert.match(source, /FutureTask<T>/);
      assert.match(source, /runOnUiThread\(task\)/);
      assert.match(source, /uiValue \{ CookieManager\.getInstance\(\)\.getCookie/);
      assert.match(source, /values\.forEach \{ manager\.setCookie/);
    });
'''))

docs_path = Path('CAPTURE_BROWSER.md')
docs = docs_path.read_text()
docs = docs.replace('# Android Capture Browser (v0.5.0)', '# Android Capture Browser (v0.5.3)', 1)
thread_note = dedent('''\

## v0.5.3 thread-safety fix

Native HTTP saving now snapshots the WebView user agent on the Android UI thread and marshals all CookieManager access back to that thread before worker-thread network requests. This fixes Android's `All WebView methods must be called on the same thread` failure while retaining the CSRF/session handshake and direct image upload.
''')
if '## v0.5.3 thread-safety fix' not in docs:
    docs = docs.replace('\n## Install\n', thread_note + '\n## Install\n', 1)
docs = docs.replace('v0.5.2', 'v0.5.3')
docs_path.write_text(docs)

changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text()
entry = dedent('''\
    ## 0.5.3

    - Fixed direct saves failing with `All WebView methods must be called on the same thread`.
    - Removed direct WebView and CookieManager access from background network operations.
    - Snapshotted the browser user agent on the UI thread and marshalled cookie reads/writes safely through the UI thread.
    - Preserved the CSRF/session handshake, real HTTP diagnostics, image-byte uploads, and Android Share fallback.
    - Added regression tests that fail if worker-thread networking touches WebView or CookieManager directly.
    - Published `InspirationBoard-CaptureBrowser-v0.5.3.apk`.

''')
if not changelog.startswith('# Changelog\n\n## 0.5.3'):
    changelog = changelog.replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
changelog_path.write_text(changelog)

# Remove the one-shot patch machinery from the finished branch.
Path('.github/workflows/apply-v053-thread-hotfix.yml').unlink(missing_ok=True)
Path('ibv053-thread-trigger.txt').unlink(missing_ok=True)
Path('tools/apply_v053.py').unlink(missing_ok=True)
