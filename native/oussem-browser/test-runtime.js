'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var net = require('net');
var cp = require('child_process');
var prefix = '/var/opt/oussem-browser/current';
var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-check-'));
var socket = path.join(directory, 'renderer.sock');
var safety = path.join(directory, 'safety.json');
var frames = 0, peer = null, child = null, log = '', finished = false;
var hostFilters = fs.readFileSync('/proc/self/status', 'utf8').match(/^Seccomp_filters:\s+(\d+)$/m);
if (!hostFilters) throw new Error('Host does not expose seccomp filter counts for sandbox validation');
var inheritedFilters = Number(hostFilters[1]);
var now = Date.now();
fs.writeFileSync(safety, JSON.stringify({
    updated: now, speedUpdated: now, speedKmh: 0, foreground: true, mode: 'native'
}));

function message(type, values) {
    var b = Buffer.alloc(8 + values.length * 4);
    b.writeUInt32LE(type, 0); b.writeUInt32LE(values.length * 4, 4);
    values.forEach(function (value, index) { b.writeUInt32LE(value, 8 + index * 4); });
    return b;
}

var server = net.createServer(function (client) {
    peer = client;
    var pending = Buffer.alloc(0);
    client.on('error', function (error) { if (!finished) fail(error.message); });
    client.on('data', function (chunk) {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 8) {
            var type = pending.readUInt32LE(0), length = pending.readUInt32LE(4);
            if (pending.length < 8 + length) return;
            pending = pending.slice(8 + length);
            if (type === 1) {
                client.write(message(0x4d520101, [1, 1, 15, 0, 0, 0, 0, 84, 0, 1836, 720, 2048, 60000]));
                client.write(message(101, [4, 1920, 720, 1]));
                client.write(message(0x4d520102, [1, 1, 1]));
            }
            if (type === 7) {
                frames++;
                if (!finished) client.write(message(102, [frames, frames * 50]));
            }
        }
    });
});
var heartbeat = setInterval(function () {
    var t = Date.now();
    fs.writeFileSync(safety + '.tmp', JSON.stringify({
        updated: t, speedUpdated: t, speedKmh: 0, foreground: true, mode: 'native'
    }));
    fs.renameSync(safety + '.tmp', safety);
}, 400);
var deadline = setTimeout(function () { fail('No sandboxed browser frames within 45s:\n' + log); }, 45000);

function cleanup() {
    clearInterval(heartbeat); clearTimeout(deadline);
    if (peer) peer.destroy();
    server.close();
}
function fail(message) {
    if (finished) return;
    finished = true; console.error(message); process.exitCode = 1;
    if (child) child.kill('SIGTERM');
    cleanup();
}

server.listen(socket, function () {
    child = cp.spawn(path.join(prefix, 'launch.sh'), [path.join(prefix, 'project'),
        '--mgu', '--safety-file', safety, '--data-dir', directory], {
        env: Object.assign({}, process.env, { MGU_APP_ID: 'oussem_youtube', MGU_RENDERD_SOCKET: socket }),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', function (data) { log += data; process.stdout.write(data); });
    child.stderr.on('data', function (data) { log += data; process.stderr.write(data); });
    child.on('error', function (error) { fail(error.message); });
    child.on('exit', function (code) {
        if (!finished) fail('Companion exited early: ' + code + '\n' + log);
    });
});

var check = setInterval(function () {
    if (finished) { clearInterval(check); return; }
    if (frames < 2 || log.indexOf('Browser companion ready: Chromium') < 0) return;
    var renderer = fs.readdirSync('/proc').filter(function (name) { return /^\d+$/.test(name); }).some(function (pid) {
        try {
            var cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8');
            var status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
            var filters = status.match(/^Seccomp_filters:\s+(\d+)$/m);
            return cmd.indexOf('--type=renderer') >= 0 && cmd.indexOf('--no-sandbox') < 0 &&
                /^Uid:\s+12345\s/m.test(status) && /^NoNewPrivs:\s+1$/m.test(status) &&
                /^Seccomp:\s+2$/m.test(status) && filters && Number(filters[1]) > inheritedFilters;
        } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ESRCH') return false;
            throw error;
        }
    });
    if (!renderer) return fail('No non-root, seccomp-sandboxed Chromium renderer found');
    console.log('PASS: glibc 2.27 host, stock Node 8 launcher, ' + frames +
        ' GPU frames, sandboxed non-root Chromium, private authenticated X display.');
    finished = true;
    child.kill('SIGTERM'); cleanup(); clearInterval(check);
}, 250);
