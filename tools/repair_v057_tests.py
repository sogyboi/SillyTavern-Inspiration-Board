from pathlib import Path

p = Path('tests/openrouter-pricing-status-v057.test.mjs')
text = p.read_text()
old = "  assert.match(studioSource, /data-ib3-live-job/);\n"
new = "  assert.match(studioSource, /dataset\\.ib3LiveJob/);\n"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('live job assertion is neither legacy nor v0.5.7 form')
p.write_text(text)

p = Path('tests/studio-core-v3.test.mjs')
text = p.read_text()
old = "  const estimate = estimateGenerationCost({ modelMetadata: { pricing: { image: '0.04' } }, count: 3 });\n"
new = "  const estimate = estimateGenerationCost({ modelMetadata: { priceSummary: { exactFlat: true, flatPerImage: 0.04 } }, count: 3 });\n"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('cost test is neither legacy nor v0.5.7 form')
p.write_text(text)
