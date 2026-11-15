// SPDX-License-Identifier: GPL-3.0-or-later
/* The wide map layout (fork) without the unit's files: aapd_conf.js on a
 * made-up aapd.conf of the same shape (its numbers invented), the start
 * settings patchd writes for it, and the units that read them.
 *
 *   node patch/test/wide_test.js */
'use strict';

var fs = require('fs');
var path = require('path');
var conf = require('../aapd_conf.js');

var ROOT = path.join(__dirname, '..', '..');
var failed = 0;
function ok(name, cond, detail) {
    console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail === undefined ? '' : '  — ' + detail));
    if (!cond) failed++;
}

var CODEC = {
    CODEC_WIDTH: 1920, CODEC_HEIGHT: 1080, REPORTED_SCREEN_DENSITY: 200, REAL_SCREEN_DENSITY: 200, HORIZONTAL_MARGIN_SIZE: 0,
    VERTICAL_MARGIN_SIZE: 100, OFFSET_LEFT_TARGET_VIEWPORT: 0, OFFSET_TOP_TARGET_VIEWPORT: 2, WIDTH_TARGET_VIEWPORT: 1920, HEIGHT_TARGET_VIEWPORT: 980,
};
var TEXT = JSON.stringify({
    OTHER: { KEEP: 1 },
    SCREENS: {
        KOMBI_DISPLAY: {
            CODEC_SUPPORTED: { '12.3': ['HIGH_1080P'] },
            CODEC_DEFINITION: { HIGH_1080P: CODEC, MID_1080P: CODEC },
            DIMENSIONS: {
                '12.3': { SA_PHYSICALDENSITY: 200, SA_OFFSET_LEFTPIXELS: 500, SA_OFFSET_TOPPIXELS: 200, SA_WIDTHPIXELS: 600, SA_HEIGHTPIXELS: 500,
                    SA_WIDTH: 76.2, SA_HEIGHT: 63.5 },
            },
        },
    },
}, null, 2) + '\n';

ok('the made-up conf is one the edit takes', conf.check(TEXT) === null, conf.check(TEXT));

var out = conf.transform(TEXT, 200, 'wide'), j = JSON.parse(out).SCREENS.KOMBI_DISPLAY;
var c = j.CODEC_DEFINITION.HIGH_1080P, sa = j.DIMENSIONS['12.3'], g = conf.GEOMETRY.wide;
ok('wide: a 1280x720 stream with the UI in its top 1280x416', c.CODEC_WIDTH === 1280 && c.CODEC_HEIGHT === 720 && c.WIDTH_TARGET_VIEWPORT === 1280 &&
    c.HEIGHT_TARGET_VIEWPORT === 416 && c.VERTICAL_MARGIN_SIZE === 304 && c.HORIZONTAL_MARGIN_SIZE === 0 && c.OFFSET_TOP_TARGET_VIEWPORT === 0, JSON.stringify(c));
ok('wide: the safe area clear of the mask\'s faded edge, inside the band', [sa.SA_OFFSET_LEFTPIXELS, sa.SA_OFFSET_TOPPIXELS, sa.SA_WIDTHPIXELS,
    sa.SA_HEIGHTPIXELS].join() === '288,58,704,300' && g.safe.x + g.safe.w <= g.ui.w && g.safe.y + g.safe.h <= g.ui.h, JSON.stringify(sa));
ok('wide: only the 12.3" codec and safe area change', JSON.stringify(JSON.parse(out).OTHER) === '{"KEEP":1}' &&
    JSON.stringify(j.CODEC_DEFINITION.MID_1080P) === JSON.stringify(CODEC) && conf.otherFile(out, TEXT) === null);

var every = true;
conf.DENSITIES.forEach(function (d) {
    conf.CARDS.forEach(function (card) {
        var e = conf.edited(TEXT, conf.transform(TEXT, d, card));
        if (!e || e.dpi !== d || e.card !== card) every = false;
    });
});
ok('every density of every layout, wide included, is recognised as ours (so Remove patch undoes it)', every);
ok('wide differs from shown and hidden', conf.transform(TEXT, 180, 'wide') !== conf.transform(TEXT, 180, 'shown') &&
    conf.transform(TEXT, 180, 'wide') !== conf.transform(TEXT, 180, 'hidden'));
ok('shown and hidden unchanged by the fork', conf.srcCrop('shown', 180) === '1280x720:0,0,1280,564' &&
    conf.srcCrop('hidden', 240) === '1280x720:4,160,1270,560' && conf.CARDS.slice(0, 2).join() === 'shown,hidden' && conf.DEFAULT_CARD === 'shown');

var r = conf.WIDE.rect, crop = conf.srcCrop('wide', 180).split(':')[1].split(',').map(Number);
ok('wide: the crop is the band at every density', conf.DENSITIES.every(function (d) { return conf.srcCrop('wide', d) === '1280x720:0,0,1280,416'; }));
ok('wide: the rect has the band\'s shape, inside the 1920x720 panel, every number even', r.w * crop[3] === r.h * crop[2] &&
    r.x + r.w <= 1920 && r.y + r.h <= 720 && [r.x, r.y, r.w, r.h].every(function (v) { return v % 2 === 0; }), JSON.stringify(r));
ok('wide: the rect centred, above the gauges\' readouts (from y 590 on a G21)', r.x * 2 + r.w === 1920 && r.y + r.h < 590, JSON.stringify(r));
var m = conf.WIDE.mask, scale = r.w / 1280;
ok('wide: the safe area is clear of the mask\'s fade and corners', g.safe.y * scale >= m.feather && (416 - g.safe.y - g.safe.h) * scale >= m.feather &&
    g.safe.x * scale >= m.radius && (1280 - g.safe.x - g.safe.w) * scale >= m.radius, JSON.stringify(m));
var a = conf.wideArgs();
ok('wide: the render goes to the panel target (its own slot) at the rect, nothing else', JSON.stringify(a) ===
    JSON.stringify({ render: '-s target=panel -s map_rect=' + [r.x, r.y, r.w, r.h].join(',') }), JSON.stringify(a));

/* patchd writes these lines; the units read them unbraced, so systemd
 * splits them into one argument per word. */
var PATCHD = fs.readFileSync(path.join(ROOT, 'patch', 'patchd.js'), 'utf8');
ok('patchd: the wide crop line carries the render\'s settings', /card === 'wide'\) return 'WOC_SRC_CROP=-s src_crop=' \+ aapdConf\.srcCrop\(card, dpi\) \+ ' ' \+ aapdConf\.wideArgs\(\)\.render/.test(PATCHD));
ok('patchd: nothing for cluster-render, and 0.10.0\'s slot file removed at start and install',
    !/WOC_CLUSTER_RENDER_ARGS|panel_slot/.test(PATCHD) && (PATCHD.match(/unlinkQuiet\(CR_ENV_OLD\)/g) || []).length === 2);
var svc = fs.readFileSync(path.join(ROOT, 'systemd', 'waze-on-cluster.service'), 'utf8');
ok('waze-on-cluster.service passes the crop line unbraced', /EnvironmentFile=-\/var\/opt\/waze-on-cluster\/aa-crop\.env/.test(svc) &&
    /^ExecStart=.* \$WOC_SRC_CROP$/m.test(svc));
var comp = JSON.parse(fs.readFileSync(path.join(ROOT, 'component.json'), 'utf8'));
ok('component.json: no drop-in for cluster-render', !comp.dropins.some(function (d) { return d.unit === 'cluster-render.service'; }) &&
    !fs.existsSync(path.join(ROOT, 'systemd', 'cluster-render.service.d')));
ok('component.json ships the mask, its client and its service, enabled, in recmgr\'s lists, restarted on update',
    ['wide_mask.js', 'cluster_render_client.js'].every(function (p) { return comp.files.some(function (f) { return f.path === p && fs.existsSync(path.join(ROOT, f.from)); }); }) &&
    comp.units.some(function (u) { return u.name === 'waze-on-cluster-mask.service'; }) &&
    comp.enable.some(function (e) { return e.unit === 'waze-on-cluster-mask.service' && e.target === 'multi-user.target'; }) &&
    comp.recmgr.indexOf('waze-on-cluster-mask') >= 0 && comp.restart.indexOf('waze-on-cluster-mask.service') >= 0);
var mask = fs.readFileSync(path.join(ROOT, 'systemd', 'waze-on-cluster-mask.service'), 'utf8');
ok('the mask service: hmi_5000 with tm_oap_app, restarted on failure, the shipped script', /^User=hmi_5000$/m.test(mask) &&
    /^SupplementaryGroups=tm_oap_app$/m.test(mask) && /^Restart=on-failure$/m.test(mask) &&
    /^ExecStart=\/usr\/bin\/node \/var\/opt\/waze-on-cluster\/current\/wide_mask\.js$/m.test(mask) && mask.indexOf('\r') < 0);

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
