from pathlib import Path

path = Path('tools/apply_v057.py')
text = path.read_text()
for name in ('old_update_cost', 'new_update_cost', 'old_load_models', 'new_load_models'):
    needle = f"{name} = dedent("
    replacement = f"{name} = ("
    if needle not in text:
        raise SystemExit(f'missing {needle}')
    text = text.replace(needle, replacement, 1)
path.write_text(text)
