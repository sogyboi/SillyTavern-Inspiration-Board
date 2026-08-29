from pathlib import Path

path = Path('tests/native-json-capture-v054.test.mjs')
text = path.read_text()
old = "  assert.match(activity, /server plugin .* is too old; update inspiration-board-sync in Termux/);\n"
new = "  assert.match(activity, /server plugin .* is too old for verified native saves; update inspiration-board-sync in Termux/);\n"
if old not in text:
    raise SystemExit('stale native plugin warning assertion not found')
path.write_text(text.replace(old, new, 1))
