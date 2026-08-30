from pathlib import Path

patcher_path = Path('tools/apply_v060_fixed.py')
text = patcher_path.read_text()

# A raw triple-quoted string kept the line-continuation backslash as literal JS.
text = text.replace("dedent(r'''\\\nconst entries", "dedent(r'''\nconst entries", 1)

# Keep the helper aligned with the actual bridge constant.
text = text.replace('MAX_REFERENCE_DATA_CHARS', 'MAX_REFERENCE_CHARS')

# Current Kling O3 reference-to-video API examples use image_urls for scene references.
text = text.replace('payload.scene_image_urls', 'payload.image_urls')

patcher_path.write_text(text)

# Keep the regression test aligned with the current Kling scene field.
test_path = Path('tests/venice-media-v060.test.mjs')
test = test_path.read_text()
test = test.replace("assert.match(bridge, /scene_image_urls/);", "assert.match(bridge, /image_urls/);")
test_path.write_text(test)
