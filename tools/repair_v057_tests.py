from pathlib import Path

# The live chip is created programmatically via DOM dataset, so assert the actual implementation token.
p = Path('tests/openrouter-pricing-status-v057.test.mjs')
text = p.read_text()
old = "  assert.match(studioSource, /data-ib3-live-job/);\n"
new = "  assert.match(studioSource, /dataset\\.ib3LiveJob/);\n"
if old not in text:
    raise SystemExit('live job dataset assertion not found')
p.write_text(text.replace(old, new, 1))

# Generic OpenRouter pricing.image is ambiguous (often token/input-image pricing), so the legacy
# deterministic cost test should use the new explicit exact-flat price summary.
p = Path('tests/studio-core-v3.test.mjs')
text = p.read_text()
old = "  const estimate = estimateGenerationCost({ modelMetadata: { pricing: { image: '0.04' } }, count: 3 });\n"
new = "  const estimate = estimateGenerationCost({ modelMetadata: { priceSummary: { exactFlat: true, flatPerImage: 0.04 } }, count: 3 });\n"
if old not in text:
    raise SystemExit('legacy ambiguous pricing assertion not found')
p.write_text(text.replace(old, new, 1))
