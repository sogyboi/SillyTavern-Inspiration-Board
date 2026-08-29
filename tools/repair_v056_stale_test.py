from pathlib import Path

path = Path('tests/native-json-capture-v054.test.mjs')
text = path.read_text()
replacements = {
    "  assert.match(activity, /server plugin .* is too old; update inspiration-board-sync in Termux/);\n":
        "  assert.match(activity, /server plugin .* is too old for verified native saves; update inspiration-board-sync in Termux/);\n",
    "  assert.match(activity, /native save ready/);\n":
        "  assert.match(activity, /POST save path verified/);\n",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'stale native test assertion not found: {old.strip()}')
    text = text.replace(old, new, 1)
path.write_text(text)
