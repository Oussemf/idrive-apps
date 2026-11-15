#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
/* wide_mask.js (fork) without a car: which render it follows (its command
 * line, its status file), the shape against the cluster's readouts and the
 * phone's safe area, the layers it makes on a cluster-render socket of its
 * own here (the real client, the protocol's messages), and the shaders
 * through glslangValidator when it is installed (GLSL ES 1.00).
 *
 *   node patch/test/wide_mask_test.js */
'use strict';

var cp = require('child_process');
var fs = require('fs');
var net = require('net');
var os = require('os');
var path = require('path');
var EventEmitter = require('events');
var wm = require('../wide_mask.js');
var conf = require('../aapd_conf.js');

var failed = 0;
function ok(name, cond, detail) {
    process.stdout.write((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail === undefined ? '' : '  — ' + detail) + '\n');
    if (!cond) failed++;
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var R = conf.WIDE.rect, M = conf.WIDE.mask;
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-mask-'));

/* ---- what it follows ---- */
var wideArgs = ['-c', '/var/opt/waze-on-cluster/current/waze-on-cluster.conf'].concat(
    ('-s src_crop=1280x720:0,0,1280,416 ' + conf.wideArgs().render).split(' '));
ok('the wide render\'s command line gives the rect', JSON.stringify(wm.wideRect(wideArgs)) === JSON.stringify(R), JSON.stringify(wm.wideRect(wideArgs)));
ok('the shipped command line (no -s) and a hidden card\'s crop give none', wm.wideRect(['-c', 'x.conf']) === null &&
    wm.wideRect(['-c', 'x.conf', '-s', 'src_crop=1280x720:0,156,1280,564']) === null);
ok('the last -s wins, as the render reads them', wm.wideRect(wideArgs.concat(['-s', 'target=map'])) === null &&
    JSON.stringify(wm.wideRect(['-s', 'map_rect=1,1,1,1', '-s', 'target=panel', '-s', 'map_rect=10,20,300,200'])) === '{"x":10,"y":20,"w":300,"h":200}');
ok('a rect outside the panel is none', wm.wideRect(['-s', 'target=panel', '-s', 'map_rect=1000,0,1000,100']) === null);

var proc = path.join(dir, 'proc');
function fakeProc(pid, comm, args) {
    fs.mkdirSync(path.join(proc, String(pid)), { recursive: true });
    fs.writeFileSync(path.join(proc, String(pid), 'comm'), comm + '\n');
    fs.writeFileSync(path.join(proc, String(pid), 'cmdline'), args.join('\0') + '\0');
}
fs.mkdirSync(proc);
fs.mkdirSync(path.join(proc, 'self'));
ok('no render running: none', wm.renderArgs(proc) === null);
fakeProc(10, 'node', ['/usr/bin/node', 'patchd.js']);
fakeProc(20, 'waze-on-cluster', ['/var/opt/waze-on-cluster/current/waze-on-cluster', '-c', 'x.conf', 'run', 'panel']);
ok('a `waze-on-cluster run` from a shell is not the render', wm.renderArgs(proc) === null);
fakeProc(30, 'waze-on-cluster', ['/var/opt/waze-on-cluster/current/waze-on-cluster'].concat(wideArgs));
ok('the render\'s arguments, its program left out', JSON.stringify(wm.renderArgs(proc)) === JSON.stringify(wideArgs), JSON.stringify(wm.renderArgs(proc)));

var status = path.join(dir, 'status.json');
function writeStatus(st, ageMs) {
    fs.writeFileSync(status, JSON.stringify(Object.assign({ ev: 'status', page: 'Waze' }, st)));
    var t = (Date.now() - (ageMs || 0)) / 1000;
    fs.utimesSync(status, t, t);
}
ok('no status file: not shown', wm.mapShown(status, Date.now()) === false);
writeStatus({ state: 'showing', target: 'panel' });
ok('showing on the panel: shown', wm.mapShown(status, Date.now()) === true);
writeStatus({ state: 'frozen', target: 'panel' });
ok('frozen (the last picture held): shown', wm.mapShown(status, Date.now()) === true);
['idle', 'starting', 'error'].forEach(function (s) {
    writeStatus({ state: s, target: 'panel' });
    ok(s + ': not shown', wm.mapShown(status, Date.now()) === false);
});
writeStatus({ state: 'showing', target: 'map' });
ok('showing in the map slot: not shown', wm.mapShown(status, Date.now()) === false);
writeStatus({ state: 'showing', target: 'panel' }, wm.STALE_MS + 1000);
ok('a status the render stopped writing: not shown', wm.mapShown(status, Date.now()) === false);
fs.writeFileSync(status, '{"state":"show');
ok('a status cut short: not shown', wm.mapShown(status, Date.now()) === false);

/* ---- the shape ---- */
var d = function (x, y) { return wm.distance(R, M, x, y); };
ok('the middle of the map is untouched', d(960, 330) < -M.feather);
ok('the rect\'s corners are cut (transparent), its edges\' middles faded to black', [[R.x, R.y], [R.x + R.w - 1, R.y], [R.x, R.y + R.h - 1],
    [R.x + R.w - 1, R.y + R.h - 1]].every(function (p) { return d(p[0], p[1]) > 0; }) && Math.abs(d(960, R.y)) < 1 && Math.abs(d(R.x, 330)) < 1);
var scale = R.w / 1280, sf = conf.GEOMETRY.wide.safe;
var safeCorners = [[sf.x, sf.y], [sf.x + sf.w, sf.y], [sf.x, sf.y + sf.h], [sf.x + sf.w, sf.y + sf.h]].map(function (p) {
    return [R.x + p[0] * scale, R.y + p[1] * scale];
});
ok('the phone\'s safe area is wholly clear of the fade', safeCorners.every(function (p) { return d(p[0], p[1]) <= -M.feather; }),
    JSON.stringify(safeCorners.map(function (p) { return d(p[0], p[1]).toFixed(1); })));
/* Where a G21's cluster shows its readouts (photos, in panel pixels): the
 * speed and rpm values at the gauges' feet, the gear and the bottom row. */
var readouts = { speed: [360, 630], rpm: [1560, 630], 'speed limit': [542, 637], gear: [1300, 686], 'scale 0 km/h': [180, 560] };
Object.keys(readouts).forEach(function (k) {
    var p = readouts[k];
    ok('the ' + k + ' readout is outside the map', p[0] < R.x || p[0] >= R.x + R.w || p[1] < R.y || p[1] >= R.y + R.h || d(p[0], p[1]) > 0);
});

/* ---- the layers, through a fake client ---- */
function FakeClient() { EventEmitter.call(this); this.calls = []; this.next = 1; }
FakeClient.prototype = Object.create(EventEmitter.prototype);
['connect', 'set', 'drop', 'part', 'geometry'].forEach(function (k) {
    FakeClient.prototype[k] = function () { this.calls.push([k].concat(Array.prototype.slice.call(arguments))); return true; };
});
['effect', 'mesh'].forEach(function (k) {
    FakeClient.prototype[k] = function (o) { var ref = this.next++; this.calls.push([k, o, ref]); return ref; };
});
var made = 0, fc = null;
var mask = new wm.Mask(function () { made++; fc = new FakeClient(); return fc; }, M);
mask.update(null, true);
ok('without the wide render: no client, no connection', made === 0);
mask.update(R, false);
var kinds = fc.calls.map(function (c) { return c[0]; }).join(',');
ok('the wide render: one client, connected, a vignette and a cut made hidden', made === 1 && kinds === 'connect,effect,mesh,part,geometry', kinds);
var eff = fc.calls[1][1], mesh = fc.calls[2][1], part = fc.calls[3][3];
ok('both on the panel over the rect, above the map (overlay), hidden, the cut on top', [eff, mesh].every(function (o) {
    return o.target === 'panel' && o.klass === 'overlay' && o.visible === false && o.x === R.x && o.y === R.y && o.w === R.w && o.h === R.h;
}) && eff.z === 0 && mesh.z === 1);
ok('the cut: blending off, no depth, both faces, orthographic 2 units high', part.blend === 'none' && part.depth === false && part.cull === 'none' &&
    mesh.projection === 'ortho' && mesh.ortho_h === 2 && fc.calls[3][2] === 1);
var quad = fc.calls[4][3];
ok('the cut\'s quad: the rect\'s aspect, in front of the camera, texcoords from the top-left', quad.positions[3] / quad.positions[1] === R.w / R.h &&
    quad.positions.filter(function (v, i) { return i % 3 === 2; }).every(function (z) { return z === -1; }) &&
    quad.texcoords.slice(0, 2).join() === '0,0' && quad.positions[1] === 1);
fc.calls = [];
mask.update(R, true);
ok('the map shows: both layers shown', JSON.stringify(fc.calls) === JSON.stringify([['set', 1, { visible: true }], ['set', 2, { visible: true }]]),
    JSON.stringify(fc.calls));
fc.calls = [];
mask.update(R, true);
ok('again: nothing sent', fc.calls.length === 0);
mask.update(R, false);
ok('the map goes: both hidden', JSON.stringify(fc.calls) === JSON.stringify([['set', 1, { visible: false }], ['set', 2, { visible: false }]]));
fc.calls = [];
var R2 = { x: 300, y: 100, w: 1320, h: 430 };
mask.update(R2, true);
kinds = fc.calls.map(function (c) { return c[0]; }).join(',');
ok('another rect: the old layers dropped, new ones made and shown, the same client', made === 1 && kinds === 'drop,drop,effect,mesh,part,geometry,set,set', kinds);
fc.calls = [];
mask.update(null, false);
ok('the render no longer wide: the layers hidden', JSON.stringify(fc.calls) === JSON.stringify([['set', 3, { visible: false }], ['set', 4, { visible: false }]]));

/* ---- the shaders ---- */
var shaders = { 'vignette.frag': wm.vignetteFs(R, M), 'cut.vert': wm.CUT_VS, 'cut.frag': wm.cutFs(R, M) };
ok('the shaders use only the reserved uniform u_mvp, and carry the shape\'s numbers', !/uniform (?!mat4 u_mvp)/.test(shaders['cut.vert']) &&
    !/uniform/.test(shaders['vignette.frag'] + shaders['cut.frag']) && shaders['cut.frag'].indexOf((M.radius / 100).toFixed(4)) >= 0);
var glslang = cp.spawnSync('glslangValidator', ['--version'], { encoding: 'utf8' });
if (glslang.status === 0) {
    Object.keys(shaders).forEach(function (name) {
        var f = path.join(dir, name);
        fs.writeFileSync(f, '#version 100\n' + shaders[name] + '\n');
        var r = cp.spawnSync('glslangValidator', [f], { encoding: 'utf8' });
        ok('GLSL ES 1.00: ' + name + ' compiles', r.status === 0, r.stdout + r.stderr);
    });
} else {
    console.log('SKIP the shaders\' compile: no glslangValidator (apt install glslang-tools)');
}

/* ---- on a cluster-render socket, with the real client ---- */
(async function () {
    var sockPath = path.join(dir, 'render.sock'), msgs = [], meshes = 0;
    var server = net.createServer(function (s) {
        var buf = Buffer.alloc(0);
        s.on('data', function (d) {
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 5 && buf.length >= 4 + buf.readUInt32LE(0)) {
                var len = buf.readUInt32LE(0), type = buf[4], body = buf.slice(5, 4 + len);
                buf = buf.slice(4 + len);
                if (type === 0x4d) { meshes++; continue; }
                var m = JSON.parse(body.toString('utf8'));
                msgs.push(m);
                if (m.op === 'hello') {
                    var ev = Buffer.from(JSON.stringify({ ev: 'hello', backend: 'test', targets: 'map,panel,hud' }));
                    var out = Buffer.alloc(5 + ev.length);
                    out.writeUInt32LE(ev.length + 1, 0);
                    out[4] = 0x4a;
                    ev.copy(out, 5);
                    s.write(out);
                }
            }
        });
    });
    await new Promise(function (r) { server.listen(sockPath, r); });
    var ClusterRender = require('../../../cluster-render/js/cluster_render_client.js').ClusterRender;
    var real = new wm.Mask(function () { return new ClusterRender('waze-on-cluster-mask', sockPath); }, M);
    real.update(R, false);
    for (var t = 0; t < 100 && meshes < 1; t++) await sleep(20);
    real.update(R, true);
    for (t = 0; t < 100 && !msgs.some(function (m) { return m.op === 'set'; }); t++) await sleep(20);
    await sleep(100);
    var ops = msgs.map(function (m) { return m.op + (m.kind ? ':' + m.kind : ''); }).join(',');
    ok('on the socket: hello, the vignette and the cut as layers, the cut\'s part and its geometry, then shown', /^hello,layer:effect,layer:mesh,part/.test(ops) &&
        meshes === 1 && msgs.filter(function (m) { return m.op === 'set' && m.visible === 1; }).length === 2, ops + ' meshes ' + meshes);
    var layer = msgs.filter(function (m) { return m.op === 'layer'; });
    ok('the layers as the protocol has them: class overlay, hidden until shown', layer.every(function (m) {
        return m['class'] === 'overlay' && m.visible === 0 && m.target === 'panel' && m.w === R.w && m.h === R.h;
    }) && layer[0].fs === wm.vignetteFs(R, M), JSON.stringify(layer));
    var p = msgs.filter(function (m) { return m.op === 'part'; })[0];
    ok('the cut\'s part: blend none, depth 0, cull none, its shaders', p.blend === 'none' && p.depth === 0 && p.cull === 'none' &&
        p.vs === wm.CUT_VS && p.fs === wm.cutFs(R, M), JSON.stringify(p));
    real.cr.close();
    server.close();
    console.log(failed ? failed + ' failed' : 'all passed');
    process.exit(failed ? 1 : 0);
})().catch(function (e) { console.log('FAIL ' + e.stack); process.exit(1); });
