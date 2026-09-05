from playwright.sync_api import sync_playwright, expect
from PIL import Image, ImageDraw
from pathlib import Path
import gzip,json
Path('/tmp/cgs-ui-artifacts').mkdir(exist_ok=True)
for i in range(2):
 im=Image.new('RGB',(480,640),('#505b83','#876257')[i]);d=ImageDraw.Draw(im);d.text((40,40),f'Gallery test reference {i+1}',fill='white');im.save(f'/tmp/cgs-ui-artifacts/cgs-fixture-{i}.png')
Path('/tmp/cgs-ui-artifacts').mkdir(exist_ok=True)
errors=[]
with sync_playwright() as w:
 browser=w.chromium.launch(headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':768,'height':1000},has_touch=True,is_mobile=True,accept_downloads=True)
 page=context.new_page();page.on('pageerror',lambda e:(print('BROWSER ERROR:',e,flush=True),errors.append(str(e))))
 page.goto('http://127.0.0.1:8765/');page.locator('#cgs-floating').click();expect(page.locator('[data-notice]')).not_to_contain_text('Opening')
 page.locator('[data-files]').set_input_files(['/tmp/cgs-ui-artifacts/cgs-fixture-0.png','/tmp/cgs-ui-artifacts/cgs-fixture-1.png']);expect(page.locator('.cgs-card')).to_have_count(2)
 page.locator('[data-identity]').first.click();page.locator('[data-ref]').nth(1).click()
 page.locator('[data-tab="generate"]').click();expect(page.locator('[data-model]')).to_have_count(2)
 page.locator('[data-model="test/ref"]').click()
 expect(page.locator('.cgs-ref-tile')).to_have_count(2)
 page.locator('[data-ref-guidance]').fill('First image identity; second image outfit.')
 page.once('dialog',lambda d:d.accept('Default appearance'));page.locator('[data-set-save]').click()
 expect(page.locator('[data-reference-sets] option')).to_have_count(2)
 expect(page.locator('[data-reference-sets]')).not_to_have_value('');saved=page.locator('[data-reference-sets]').input_value()
 page.locator('[aria-label="Favorite test/ref"]').click();expect(page.locator('[aria-label="Favorite test/ref"]')).to_have_attribute('aria-pressed','true')
 page.locator('[data-clear-temp]').click();expect(page.locator('.cgs-ref-tile')).to_have_count(1)
 page.locator('[data-reference-sets]').select_option(saved);expect(page.locator('.cgs-ref-tile')).to_have_count(2)
 page.locator('[data-prompt]').fill('Test character with a blue coat.')
 box=page.locator('[data-generate]').bounding_box();assert box['y']>=0 and box['y']+box['height']<=1000
 page.locator('[data-generate]').click();expect(page.locator('[data-results] article')).to_have_count(1,timeout=15000)
 page.screenshot(path='/tmp/cgs-ui-artifacts/cgs-fold-generate.png')
 page.locator('[data-tab="gallery"]').click();page.locator('[data-shelf="review"]').click();expect(page.locator('.cgs-card')).to_have_count(1)
 page.locator('[data-single="keep"]').click();expect(page.locator('.cgs-card')).to_have_count(0)
 page.locator('[data-shelf="kept"]').click();expect(page.locator('.cgs-card')).to_have_count(3)
 page.locator('[data-album-manage]').click();page.locator('[data-new-album]').fill('Portraits');page.locator('[data-create-album]').click();expect(page.locator('.cgs-album-item')).to_have_count(1)
 page.locator('.cgs-manager [data-dismiss]').click();page.locator('[data-bulk]').first.check();page.locator('[data-bulk-album]').click();page.locator('[data-add]').click()
 expect(page.locator('.cgs-manager')).to_have_count(0)
 page.once('dialog',lambda d:d.accept());page.locator('[data-bulk]').first.check();page.locator('[data-bulk-action="trash"]').click();expect(page.locator('.cgs-card')).to_have_count(2)
 page.locator('[data-shelf="trash"]').click();expect(page.locator('.cgs-card')).to_have_count(1)
 page.locator('[data-view]').click();expect(page.locator('.cgs-viewer')).to_be_visible();expect(page.locator('[data-v-main]')).to_be_disabled();page.locator('[data-v-close]').click()
 page.locator('[data-single="restore"]').click();expect(page.locator('.cgs-card')).to_have_count(0)
 page.locator('[data-tab="connections"]').click()
 with page.expect_download() as downloaded: page.locator('[data-export]').click()
 archive=downloaded.value;archive.save_as('/tmp/cgs-ui-artifacts/cgs-test-backup.cgs.jsonl.gz')
 lines=gzip.decompress(Path('/tmp/cgs-ui-artifacts/cgs-test-backup.cgs.jsonl.gz').read_bytes()).decode().splitlines();assert json.loads(lines[-1])['kind']=='complete'
 page.locator('[data-backup-file]').set_input_files('/tmp/cgs-ui-artifacts/cgs-test-backup.cgs.jsonl.gz');expect(page.locator('[data-import-confirm]')).to_be_visible();page.locator('[data-import-confirm]').click();expect(page.locator('.cgs-manager')).to_have_count(0)
 page.locator('[data-tab="gallery"]').click();expect(page.locator('.cgs-card')).to_have_count(6)
 page.locator('[data-tab="generate"]').click();expect(page.locator('[data-reference-sets] option')).to_have_count(3)
 expect(page.locator('[data-prompt]')).to_have_value('Test character with a blue coat.')
 page.locator('[data-close]').click();page.evaluate('mockContext.characterId=1');page.locator('#cgs-floating').click();expect(page.locator('.cgs-card')).to_have_count(0)
 page.locator('[data-tab="connections"]').click();page.locator('[data-relink]').click();expect(page.locator('[data-link-preview]')).to_contain_text('6 live images');page.locator('[data-link-confirm]').click();expect(page.locator('.cgs-manager')).to_have_count(0)
 page.locator('[data-tab="gallery"]').click();expect(page.locator('.cgs-card')).to_have_count(6)
 page.locator('[data-view]').first.scroll_into_view_if_needed()
 page.wait_for_function('Array.from(document.querySelectorAll("[data-grid] img")).slice(0,2).every(i=>i.complete && i.naturalWidth>0)')
 page.screenshot(path='/tmp/cgs-ui-artifacts/cgs-fold-gallery.png')
 # Narrow touch viewport: bottom generator remains usable and no horizontal page overflow.
 page.set_viewport_size({'width':360,'height':740});page.locator('[data-tab="generate"]').click();expect(page.locator('[data-model]')).to_have_count(2)
 box=page.locator('[data-generate]').bounding_box();assert box['y']>=0 and box['y']+box['height']<=740
 assert page.evaluate('document.querySelector(".cgs-shell").scrollWidth <= window.innerWidth')
 page.screenshot(path='/tmp/cgs-ui-artifacts/cgs-phone-generate.png')
 print('UI workflow passed: uploads, sets, pinned references, model favorites, mock generation, Review, albums, trash/view/restore, backup round-trip, relink, Fold + narrow phone.')
 print('Browser errors:',errors);assert not errors
 browser.close()
