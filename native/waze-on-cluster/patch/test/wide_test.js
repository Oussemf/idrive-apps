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
ok('wide: the safe area between the gauges, the band\'s whole height', [sa.SA_OFFSET_LEFTPIXELS, sa.SA_OFFSET_TOPPIXELS, sa.SA_WIDTHPIXELS,
    sa.SA_HEIGHTPIXELS].join() === '288,0,704,416' && g.safe.x + g.safe.w <= g.ui.w && g.safe.y + g.safe.h <= g.ui.h, JSON.stringify(sa));
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
ok('wide: the slot is a hex KOMBI slot', /^0x[0-9a-f]+$/.test(conf.WIDE.slot), conf.WIDE.slot);
var a = conf.wideArgs();
ok('wide: the render goes to the panel target at the rect', a.render === '-s target=panel -s map_rect=' + [r.x, r.y, r.w, r.h].join(','), a.render);
ok('wide: cluster-render moves panel to the slot and takes it over', a.clusterRender === '-s panel_slot=' + conf.WIDE.slot + ' -s panel_take_over_stock=1',
    a.clusterRender);

/* patchd writes these lines; the units read them unbraced, so systemd
 * splits them into one argument per word. */
var PATCHD = fs.readFileSync(path.join(ROOT, 'patch', 'patchd.js'), 'utf8');
ok('patchd: the wide crop line carries the render\'s settings', /card === 'wide'\) return 'WOC_SRC_CROP=-s src_crop=' \+ aapdConf\.srcCrop\(card, dpi\) \+ ' ' \+ aapdConf\.wideArgs\(\)\.render/.test(PATCHD));
ok('patchd: cluster-render\'s line only for wide', /function crEnv\(card\) \{ return card === 'wide' \? 'WOC_CLUSTER_RENDER_ARGS=' \+ aapdConf\.wideArgs\(\)\.clusterRender/.test(PATCHD));
ok('patchd: a revert removes both files', /unlinkQuiet\(AA_CROP_ENV\); unlinkQuiet\(CR_ENV\);/.test(PATCHD));
var svc = fs.readFileSync(path.join(ROOT, 'systemd', 'waze-on-cluster.service'), 'utf8');
ok('waze-on-cluster.service passes the crop line unbraced', /EnvironmentFile=-\/var\/opt\/waze-on-cluster\/aa-crop\.env/.test(svc) &&
    /^ExecStart=.* \$WOC_SRC_CROP$/m.test(svc));
var dropin = fs.readFileSync(path.join(ROOT, 'systemd', 'cluster-render.service.d', '50-waze-on-cluster.conf'), 'utf8');
var crSvc = fs.readFileSync(path.join(ROOT, '..', 'cluster-render', 'systemd', 'cluster-render.service'), 'utf8');
var stockExec = /^ExecStart=(.*)$/m.exec(crSvc)[1];
ok('the cluster-render drop-in reads patchd\'s file and keeps the stock command, its settings appended unbraced',
    /EnvironmentFile=-\/var\/opt\/waze-on-cluster\/cluster-render\.env/.test(dropin) && /^ExecStart=$/m.test(dropin) &&
    dropin.indexOf('ExecStart=' + stockExec + ' $WOC_CLUSTER_RENDER_ARGS\n') >= 0, stockExec);
var comp = JSON.parse(fs.readFileSync(path.join(ROOT, 'component.json'), 'utf8'));
ok('component.json installs the drop-in', comp.dropins.some(function (d) {
    return d.unit === 'cluster-render.service' && d.name === '50-waze-on-cluster.conf' && d.from === 'systemd/cluster-render.service.d/50-waze-on-cluster.conf';
}));

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
