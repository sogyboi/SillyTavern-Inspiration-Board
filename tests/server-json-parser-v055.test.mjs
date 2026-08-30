import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const plugin = fs.readFileSync(new URL('../server-plugin/inspiration-board-sync/index.mjs', import.meta.url), 'utf8');

test('native capture relies on SillyTavern global JSON parser instead of double parsing the stream', () => {
  assert.match(plugin, /const VERSION = '(?:0\.5\.8|0\.6\.0)'/);
  assert.match(plugin, /router\.post\('\/capture-native', async \(req, res\) =>/);
  assert.doesNotMatch(plugin, /router\.post\('\/capture-native',\s*express\.json/);
  assert.match(plugin, /SillyTavern globally parses application\/json/);
});