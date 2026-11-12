'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const prepare = require('../native/oussem-browser/prepare-engine');

test('engine preparation streams, verifies and reuses the executable; corrupt archives fail closed', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'idrive-engine-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const data = path.join(root, 'data'), electron = path.join(root, 'electron');
    fs.mkdirSync(data); fs.mkdirSync(electron);
    const content = Buffer.from('fake ELF fixture');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    fs.writeFileSync(path.join(root, 'engine.json'), JSON.stringify({ files: [{ name: 'electron', sha256 }] }));
    fs.writeFileSync(path.join(electron, 'electron.gz'), zlib.gzipSync(content));
    const binary = await prepare(root, data);
    assert.deepEqual(fs.readFileSync(binary), content);
    const before = fs.statSync(binary).mtimeMs;
    await prepare(root, data);
    assert.equal(fs.statSync(binary).mtimeMs, before);
    fs.writeFileSync(binary, 'damaged cache');
    await prepare(root, data);
    assert.deepEqual(fs.readFileSync(binary), content);
    fs.unlinkSync(binary);
    fs.writeFileSync(path.join(electron, 'electron.gz'), zlib.gzipSync(Buffer.from('incorrect digest')));
    await assert.rejects(prepare(root, data), /checksum mismatch/);
    assert.equal(fs.existsSync(binary), false);
});
