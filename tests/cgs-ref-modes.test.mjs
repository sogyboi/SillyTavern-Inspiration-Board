import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceSetSnapshot } from '../server-plugin/character-gallery-api/collections.mjs';
import { settingsWithDefaults } from '../server-plugin/character-gallery-api/core.mjs';
test('saved reference sets match Main-only and None modes rather than hidden selections', () => {
    const gallery = { mainImageId: 'main' };
    const settings = settingsWithDefaults({ referenceMode: 'main', selectedIds: ['other'], identityIds: ['identity'] });
    const main = referenceSetSnapshot(settings, 'Main only', gallery);
    assert.deepEqual(main.identityIds, ['main']);
    assert.deepEqual(main.temporaryIds, []);
    assert.equal(main.baseId, 'main');
    const none = referenceSetSnapshot({ ...settings, referenceMode: 'none' }, 'Empty', gallery);
    assert.deepEqual(none.identityIds, []);
    assert.deepEqual(none.temporaryIds, []);
});
