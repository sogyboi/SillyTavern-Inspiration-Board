import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = ['index.js', 'library-ui.js', ...(await fs.readdir('server-plugin/character-gallery-api')).filter(f => f.endsWith('.mjs')).map(f => `server-plugin/character-gallery-api/${f}`)];
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} application modules.`);
