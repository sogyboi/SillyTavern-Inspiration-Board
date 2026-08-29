from pathlib import Path

path = Path('tools/apply_v057.py')
text = path.read_text()

# Preserve source indentation for exact JavaScript replacement anchors.
for name in ('old_update_cost', 'new_update_cost', 'old_load_models', 'new_load_models'):
    needle = f"{name} = dedent("
    replacement = f"{name} = ("
    if needle in text:
        text = text.replace(needle, replacement, 1)

# The live chip is created programmatically through HTMLElement.dataset, not literal HTML.
old_live = "  assert.match(studioSource, /data-ib3-live-job/);"
new_live = "  assert.match(studioSource, /dataset\\.ib3LiveJob/);"
if old_live not in text:
    raise SystemExit('live-chip generated test anchor not found')
text = text.replace(old_live, new_live, 1)

# Rewrite the legacy cost test after the version-bump rewrite. Generic pricing.image is ambiguous
# on OpenRouter and must no longer be assumed to mean one generated picture.
old_tail = '''test_core = test_core_path.read_text().replace("'0.3.0'", "'0.5.7'")
test_core_path.write_text(test_core)'''
new_tail = '''test_core = test_core_path.read_text().replace("'0.3.0'", "'0.5.7'")
test_core = test_core.replace(
    "  const estimate = estimateGenerationCost({ modelMetadata: { pricing: { image: '0.04' } }, count: 3 });",
    "  const estimate = estimateGenerationCost({ modelMetadata: { priceSummary: { exactFlat: true, flatPerImage: 0.04 } }, count: 3 });",
    1,
)
test_core_path.write_text(test_core)'''
if old_tail not in text:
    raise SystemExit('Studio legacy-test rewrite anchor not found')
text = text.replace(old_tail, new_tail, 1)

path.write_text(text)
