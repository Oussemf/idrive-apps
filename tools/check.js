'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
let count = 0;
for (const directory of ['runtime', 'shared', 'apps', 'tools', 'web', 'tests']) {
    for (const entry of fs.readdirSync(path.join(root, directory), { recursive: true })) {
        if (!entry.endsWith('.js')) continue;
        const result = spawnSync(process.execPath, ['--check', path.join(root, directory, entry)], { stdio: 'inherit' });
        if (result.status !== 0) process.exit(1);
        count++;
    }
}
for (const name of ['package.json', 'mgu-repo.json', 'apps/oussem_youtube/app.json']) {
    JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
}
console.log('Syntax and manifests OK (' + count + ' JavaScript files).');
