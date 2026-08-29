from pathlib import Path

path = Path('tools/apply_v054_native_json.py')
text = path.read_text()
start = text.index('# Test button now explicitly requires the native JSON capability.')
end = text.index('activity_path.write_text(activity)', start)
replacement = '''# Test button now explicitly requires the native JSON capability.
old_test_success = ''' + '"""' + '''                val version = runCatching { JSONObject(body).optString("version") }.getOrDefault("")
                runOnUiThread {
                    Toast.makeText(this, "Connected · Inspiration Board Sync ${version.ifBlank { "ready" }}", Toast.LENGTH_LONG).show()
                    prefs.edit().putString("server", server).apply()
                }
''' + '"""' + '''
new_test_success = ''' + '"""' + '''                val status = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
                val version = status.optString("version").ifBlank { "unknown" }
                val capabilities = status.optJSONArray("capabilities")
                val supportsNative = (0 until (capabilities?.length() ?: 0)).any { capabilities?.optString(it) == "native-json-capture" }
                if (!supportsNative) throw IllegalStateException("server plugin $version is too old; update inspiration-board-sync in Termux")
                runOnUiThread {
                    Toast.makeText(this, "Connected · Inspiration Board Sync $version · native save ready", Toast.LENGTH_LONG).show()
                    prefs.edit().putString("server", server).apply()
                }
''' + '"""' + '''
if old_test_success not in activity:
    raise SystemExit('Could not find testServer success block')
activity = activity.replace(old_test_success, new_test_success, 1)
'''
text = text[:start] + replacement + text[end:]

# Preserve Kotlin escape sequences inside the Python-generated source.
text = text.replace(
    r'            put("text", "${buildMarker(context, target)}\n${context.pageUrl}")',
    r'            put("text", "${buildMarker(context, target)}\\n${context.pageUrl}")',
)
text = text.replace(
    r'Regex("\\s+")',
    r'Regex("\\\\s+")',
)

path.write_text(text)
