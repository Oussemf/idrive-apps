'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const safety = require('../shared/safety');

test('OAP launches only while stationary/foreground and terminates on invalid or stale speed', async t => {
    let implementation, handlers, interval, now = 10000, visible = false, focus = true;
    t.mock.method(Date, 'now', () => now);
    const buttons = {}, files = new Map(), spawned = [], errors = [], labels = {};
    let statFailure = null;
    const data = path.resolve('test-app-data');
    files.set(path.join(data, 'runtime.json'), JSON.stringify({
        executable: path.resolve('fake-electron'), project: path.resolve('test-project')
    }));
    const mocks = {
        fs: {
            readFileSync(file) {
                if (!files.has(file)) { const error = new Error('Missing fixture: ' + file); error.code = 'ENOENT'; throw error; }
                return files.get(file);
            },
            writeFileSync(file, text) { files.set(file, text); },
            renameSync(source, target) { files.set(target, files.get(source)); files.delete(source); },
            statSync(file) {
                if (statFailure && statFailure(file)) throw new Error('Missing test file');
                return { isFile: () => true };
            }
        },
        path,
        child_process: {
            spawn(executable, args, options) {
                const child = new EventEmitter();
                child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
                child.kill = signal => { child.killed = true; child.emit('exit', null, signal); };
                spawned.push({ child, executable, args, options });
                return child;
            }
        },
        './kit/mgu': { run(value) { implementation = value; } },
        './safety': safety
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'apps', 'oussem_youtube', 'main.js'), 'utf8'), {
        require(name) { assert.ok(mocks[name], name); return mocks[name]; },
        Date: { now: () => now },
        process: { env: {}, getuid: () => 12345, on() {} },
        setInterval(fn) { interval = fn; }
    });
    await implementation.start({
        dataDir: data, spec: { id: 'oussem_youtube2' },
        log: { error: message => errors.push(message), warn() {}, info() {} },
        signals: { watch(_name, _instance, value) { handlers = value; return Promise.resolve({}); } },
        ui: {
            isVisible: () => visible, hasFocus: () => focus, text(name, value) { labels[name] = value; },
            open() { visible = true; }, onVisible() {}, onFocus() {},
            onClick(name, fn) { buttons[name] = fn; }
        }
    });
    await buttons.BTN_NATIVE();
    assert.equal(spawned.length, 0);
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 0 }); interval();
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].options.env.MGU_APP_ID, 'oussem_youtube2');
    assert.ok(spawned[0].args.includes('--mgu'));
    assert.equal(JSON.parse(files.get(path.join(data, 'youtube-safety.json'))).foreground, true);
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 1 }); interval();
    assert.equal(spawned[0].child.killed, true);
    assert.equal(spawned.length, 1);
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 65535 }); interval();
    assert.equal(spawned.length, 1);
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 0 }); interval();
    assert.equal(spawned.length, 2);
    focus = false; interval();
    assert.equal(spawned[1].child.killed, true);
    focus = true; interval();
    assert.equal(spawned.length, 3);
    now += 5001; interval();
    assert.equal(spawned[2].child.killed, true);
    assert.equal(spawned.length, 3);
    assert.deepEqual(errors, []);

    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 65535 });
    await buttons.BTN_GARAGE_NATIVE();
    assert.equal(spawned.length, 4);
    assert.ok(spawned[3].args.includes('--garage-test'));
    assert.equal(JSON.parse(files.get(path.join(data, 'youtube-safety.json'))).garageTest, true);
    now += 10000; interval();
    assert.equal(spawned[3].child.killed, undefined);
    focus = false; interval();
    assert.equal(spawned[3].child.killed, true);
    focus = true; interval();
    assert.equal(spawned.length, 4);
    assert.equal(JSON.parse(files.get(path.join(data, 'youtube-safety.json'))).garageTest, false);
    await buttons.BTN_GARAGE_TV();
    assert.equal(spawned.length, 5);
    assert.equal(JSON.parse(files.get(path.join(data, 'youtube-safety.json'))).mode, 'tv');
    buttons.BTN_STOP();
    assert.equal(spawned[4].child.killed, true);

    const configFile = path.join(data, 'runtime.json');
    const validConfig = files.get(configFile);
    files.delete(configFile);
    await buttons.BTN_GARAGE_NATIVE();
    assert.equal(spawned.length, 5);
    assert.equal(labels.RUNTIME_STATUS, 'Setup incomplete: runtime.json is missing.');
    assert.match(labels.RUNTIME_DETAIL, /launcher only/);
    assert.ok(errors.some(message => message.includes(configFile)));
    interval();
    assert.equal(spawned.length, 5);
    for (const invalid of ['{', 'null', '[]', '{}']) {
        files.set(configFile, invalid);
        await buttons.BTN_GARAGE_TV();
        assert.equal(labels.RUNTIME_STATUS, 'Invalid runtime.json configuration.');
        assert.equal(spawned.length, 5);
    }
    files.set(configFile, validConfig);
    statFailure = file => file === path.resolve('fake-electron');
    await buttons.BTN_GARAGE_NATIVE();
    assert.equal(labels.RUNTIME_STATUS, 'Configured browser executable is unavailable.');
    assert.equal(spawned.length, 5);
    statFailure = file => file.endsWith(path.join('runtime', 'main.js'));
    await buttons.BTN_GARAGE_TV();
    assert.equal(labels.RUNTIME_STATUS, 'Configured browser project is unavailable.');
    assert.equal(spawned.length, 5);
    statFailure = null;
    await buttons.BTN_GARAGE_NATIVE();
    assert.equal(spawned.length, 6);
});
