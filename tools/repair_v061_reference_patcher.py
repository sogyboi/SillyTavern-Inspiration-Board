from pathlib import Path

path = Path('tools/apply_v061_reference_integrity.py')
text = path.read_text()
old_block = '''return_old = """          return res.json({
            id: `venice-edit-${Date.now()}`,
            images: [bytes.toString('base64')],
            format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png',
            blurred: response.headers.get('x-venice-is-blurred') === 'true',
            contentViolation: response.headers.get('x-venice-is-content-violation') === 'true',
          });
"""
return_new = """          return res.json({
            id: `venice-edit-${Date.now()}`,
            images: [bytes.toString('base64')],
            format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png',
            blurred: response.headers.get('x-venice-is-blurred') === 'true',
            contentViolation: response.headers.get('x-venice-is-content-violation') === 'true',
            reference_received: true,
            reference_count: references.length,
            reference_endpoint: references.length === 1 ? '/image/edit' : '/image/multi-edit',
            reference_model_field: references.length === 1 ? 'model' : 'modelId',
          });
"""'''
new_block = '''return_old = """        return res.json({
          id: `venice-edit-${Date.now()}`,
          images: [bytes.toString('base64')],
          format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png',
          blurred: response.headers.get('x-venice-is-blurred') === 'true',
          contentViolation: response.headers.get('x-venice-is-content-violation') === 'true',
        });
"""
return_new = """        return res.json({
          id: `venice-edit-${Date.now()}`,
          images: [bytes.toString('base64')],
          format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png',
          blurred: response.headers.get('x-venice-is-blurred') === 'true',
          contentViolation: response.headers.get('x-venice-is-content-violation') === 'true',
          reference_received: true,
          reference_count: references.length,
          reference_endpoint: references.length === 1 ? '/image/edit' : '/image/multi-edit',
          reference_model_field: references.length === 1 ? 'model' : 'modelId',
        });
"""'''
if old_block not in text:
    raise SystemExit('receipt anchor block not found')
path.write_text(text.replace(old_block, new_block, 1))
