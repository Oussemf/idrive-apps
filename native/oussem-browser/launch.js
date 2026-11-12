'use strict';

// Runs under the app's stock Node 8, not as a root service.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');
var root = __dirname;
var args = process.argv.slice(2);
var display = null, browser = null, ended = false, startupTimer = null;
var profile = args.indexOf('--data-dir');
var data = profile >= 0 ? args[profile + 1] : null;
var work = null;

function finish(code, message) {
    if (ended) return;
    ended = true;
    if (message) console.error('Browser companion: ' + message);
    clearTimeout(startupTimer);
    if (browser) browser.kill('SIGTERM');
    if (display) display.kill('SIGTERM');
    // Only the two known private files; never recursively delete app data.
    if (work) {
        ['Xauthority', 'fontconfig.xml'].forEach(function (name) {
            var file = path.join(work, name);
            try { fs.unlinkSync(file); } catch (error) {
                if (error.code !== 'ENOENT') console.error('Companion cleanup: ' + error.message);
            }
        });
        try { fs.rmdirSync(work); } catch (error) {
            if (error.code !== 'ENOENT') console.error('Companion directory cleanup: ' + error.message);
        }
    }
    process.exitCode = code;
}

function field(buffer) {
    var length = Buffer.alloc(2);
    length.writeUInt16BE(buffer.length, 0);
    return Buffer.concat([length, buffer]);
}

function start() {
    if (typeof process.getuid !== 'function' || process.getuid() === 0) {
        throw new Error('must run as the OAP app uid, never root');
    }
    if (!data || !path.isAbsolute(data)) throw new Error('--data-dir must be an absolute app data path');
    if (!args.includes('--mgu') || !process.env.MGU_APP_ID) throw new Error('OAP launcher arguments required');
    var interpreter = path.join(root, 'lib', 'ld-linux-x86-64.so.2');
    var probe = cp.spawnSync(interpreter, ['--verify', path.join(root, 'electron', 'electron')], {
        encoding: 'utf8', timeout: 10000
    });
    if (probe.error || probe.status !== 0) {
        throw new Error('bundled loader check failed: ' + (probe.error ? probe.error.message : probe.stderr));
    }
    work = fs.mkdtempSync(path.join(data, 'browser-session-'));
    fs.chmodSync(work, 0o700);
    var auth = path.join(work, 'Xauthority');
    var family = Buffer.from([255, 255]);
    var cookie = crypto.randomBytes(16);
    fs.writeFileSync(auth, Buffer.concat([family, field(Buffer.alloc(0)), field(Buffer.alloc(0)),
        field(Buffer.from('MIT-MAGIC-COOKIE-1')), field(cookie)]), { mode: 0o600 });
    // Avoid the firmware's fontconfig and the system-wide font cache.
    var fonts = path.join(work, 'fontconfig.xml');
    fs.writeFileSync(fonts, '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">' +
        '<fontconfig><dir>' + path.join(root, 'fonts') + '</dir><cachedir>' +
        work + '</cachedir></fontconfig>', { mode: 0o600 });
    var env = Object.assign({}, process.env, {
        XAUTHORITY: auth, FONTCONFIG_FILE: fonts,
        XDG_RUNTIME_DIR: work, TMPDIR: work,
        CHROME_DEVEL_SANDBOX: path.join(root, 'electron', 'chrome-sandbox')
    });
    delete env.LD_PRELOAD;
    delete env.LD_LIBRARY_PATH;
    display = cp.spawn(path.join(root, 'bin', 'Xvfb'), [
        '-displayfd', '3', '-screen', '0', '1280x720x24',
        '-nolisten', 'tcp', '-auth', auth, '-noreset', '-extension', 'GLX'
    ], { env: env, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    display.stderr.on('data', function (chunk) { console.error('Private display: ' + chunk.toString().slice(0, 2048)); });
    display.on('error', function (error) { finish(1, 'private display start failed: ' + error.message); });
    display.on('exit', function (code, signal) {
        if (!ended) finish(1, 'private display exited: ' + code + ' / ' + signal);
    });
    startupTimer = setTimeout(function () { finish(1, 'private display did not start within 15 seconds'); }, 15000);
    var number = '';
    display.stdio[3].on('data', function (chunk) {
        number += chunk.toString();
        if (number.length > 16) return finish(1, 'invalid private display response');
        if (number.indexOf('\n') < 0 || browser || ended) return;
        if (!/^\d+\n$/.test(number)) return finish(1, 'invalid private display number');
        clearTimeout(startupTimer);
        env.DISPLAY = ':' + number.trim();
        browser = cp.spawn(path.join(root, 'electron', 'electron'),
            args.concat(['--disable-gpu', '--disable-dev-shm-usage', '--ozone-platform=x11']), {
                env: env, stdio: ['ignore', 'inherit', 'inherit']
            });
        browser.on('error', function (error) { finish(1, 'Chromium start failed: ' + error.message); });
        browser.on('exit', function (code, signal) {
            finish(code === 0 ? 0 : 1, code === 0 ? null : 'Chromium exited: ' + code + ' / ' + signal);
        });
    });
}

process.on('SIGTERM', function () { finish(0); });
process.on('SIGINT', function () { finish(0); });
try { start(); } catch (error) { finish(1, error.message); }
