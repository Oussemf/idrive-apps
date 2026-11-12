'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const code = fs.readFileSync(path.join(__dirname, '..', 'native', 'oussem-browser', 'launch.js'), 'utf8');

function run(uid) {
    const files = new Map(), spawned = [], events = {}, errors = [];
    const data = path.resolve('test-browser-data');
    const proc = {
        argv: ['node', 'launch.js', '/project', '--mgu', '--data-dir', data],
        getuid: () => uid, env: { MGU_APP_ID: 'test_app', LD_PRELOAD: '/untrusted/preload',
            LD_LIBRARY_PATH: '/untrusted/libs' },
        on(name, fn) { events[name] = fn; }
    };
    const mocks = {
        path, crypto, './prepare-engine': async () => path.resolve('prepared-electron'),
        fs: {
            mkdtempSync: prefix => prefix + 'test', chmodSync() {},
            writeFileSync(file, value) { files.set(file, value); },
            readdirSync() { return []; }, rmdirSync() {}
        },
        child_process: {
            spawnSync: () => ({ status: 0 }),
            spawn(executable, args, options) {
                const child = new EventEmitter();
                child.stderr = new EventEmitter();
                child.stdio = [null, null, null, new EventEmitter()];
                child.kill = signal => { child.signal = signal; };
                spawned.push({ executable, args, options, child });
                return child;
            }
        }
    };
    vm.runInNewContext(code, {
        __dirname: path.resolve('installed-browser'),
        require(name) { assert.ok(mocks[name], name); return mocks[name]; },
        process: proc, Buffer, console: { error: message => errors.push(message) },
        setTimeout() { return { unref() {} }; }, clearTimeout() {}
    });
    return { spawned, files, events, errors, proc };
}

test('browser companion refuses root and does not start a display or browser', async () => {
    const result = run(0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.proc.exitCode, 1);
    assert.equal(result.spawned.length, 0);
    assert.match(result.errors[0], /never root/);
});

test('private display uses a random cookie, no TCP, explicit sandbox and bounded caches', async () => {
    const result = run(12345);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.spawned.length, 1);
    const display = result.spawned[0];
    assert.ok(display.executable.endsWith(path.join('bin', 'Xvfb')));
    assert.ok(display.args.includes('-auth'));
    assert.equal(display.args[display.args.indexOf('-nolisten') + 1], 'tcp');
    assert.equal(display.options.env.LD_PRELOAD, undefined);
    assert.equal(display.options.env.LD_LIBRARY_PATH, undefined);
    const auth = result.files.get(display.options.env.XAUTHORITY);
    assert.equal(auth.readUInt16BE(0), 65535);
    assert.ok(auth.includes(Buffer.from('MIT-MAGIC-COOKIE-1')));
    display.child.stdio[3].emit('data', Buffer.from('81\n'));
    assert.equal(result.spawned.length, 2);
    const browser = result.spawned[1];
    assert.equal(browser.options.env.DISPLAY, ':81');
    assert.ok(browser.options.env.CHROME_DEVEL_SANDBOX.endsWith(path.join('electron', 'chrome-sandbox')));
    assert.ok(!browser.args.includes('--no-sandbox'));
    assert.ok(browser.args.includes('--disk-cache-size=33554432'));
    result.events.SIGTERM();
    assert.equal(browser.child.signal, 'SIGTERM');
    assert.equal(display.child.signal, 'SIGTERM');
    assert.equal(result.proc.exitCode, 0);
});
