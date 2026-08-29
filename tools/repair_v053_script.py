from pathlib import Path

path = Path('tools/apply_v053.py')
text = path.read_text()
needle = "if helper_anchor not in activity:\n"
if needle not in text:
    raise SystemExit('helper-anchor guard not found in tools/apply_v053.py')
insert = (
    "helper_anchor = ''.join(('    ' + line) if line.strip() else line for line in helper_anchor.splitlines(True))\n"
    "helper_insert = ''.join(('    ' + line) if line.strip() else line for line in helper_insert.splitlines(True))\n"
)
text = text.replace(needle, insert + needle, 1)
path.write_text(text)
