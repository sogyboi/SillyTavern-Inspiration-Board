import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPTURE_SETTINGS_DEFAULTS,
  defaultCaptureSettings,
  normalizeCaptureSettings,
} from '../capture-core-v41.js';

test('Capture Center compatibility export exists and normalizes settings', () => {
  assert.equal(typeof defaultCaptureSettings, 'function');
  assert.equal(defaultCaptureSettings, defaultCaptureSettings);

  const normalized = defaultCaptureSettings({
    pollSeconds: 1,
    quickTarget: 'not-a-target',
    providerTargets: { pinterest: 'face' },
  });

  assert.deepEqual(normalized, normalizeCaptureSettings({
    pollSeconds: 1,
    quickTarget: 'not-a-target',
    providerTargets: { pinterest: 'face' },
  }));
  assert.equal(normalized.pollSeconds, 15);
  assert.equal(normalized.quickTarget, CAPTURE_SETTINGS_DEFAULTS.quickTarget);
  assert.equal(normalized.providerTargets.pinterest, 'face');
});
