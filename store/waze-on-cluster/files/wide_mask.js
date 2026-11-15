// SPDX-License-Identifier: GPL-3.0-or-later
/* wide_mask.js (fork): shapes the wide Waze map on the cluster.
 *
 * With Android Auto's wide layout the render draws the map stretched in a
 * rect of cluster-render's whole-panel target (slot 0x203), over BMW's own
 * drawing. This service puts two layers of its own over that rect, above
 * the map (class overlay), while the map shows:
 *
 *   - a vignette (an effect layer, blended): the map fades to black over
 *     the `feather` pixels inside a rounded rectangle of corner `radius`,
 *     black outside it;
 *   - a cut (a mesh layer, its part drawn with blending off): every pixel
 *     outside the rounded rectangle written fully transparent, so where the
 *     KOMBI composes the panel by its alpha, BMW's gauges, speed and gear
 *     show there; where it does not, the vignette's black stays.
 *
 * It follows the running render, not the settings on disk: the rect is the
 * `-s map_rect=` of the waze-on-cluster process when it also has
 * `-s target=panel` (a change to the wide layout runs from the next
 * head-unit start), and the layers show only while the render's status
 * (status.json, written each second) says the map shows on the panel.
 * Without the wide layout it connects to nothing and only reads, every
 * second, a small file and, every 10 s, the process list.
 *
 * Runs as hmi_5000 (waze-on-cluster-mask.service), Node 8, no dependencies
 * but cluster-render's client, shipped beside it. Each change of what it
 * shows is logged once. */
'use strict';

var fs = require('fs');
var path = require('path');

var STATUS = process.env.WOC_STATUS_JSON || '/run/waze-on-cluster/status.json';
var PROC = process.env.WOC_PROC || '/proc';
var RENDER_SOCK = process.env.WOC_RENDER_SOCK || '/dev/shm/cluster-render/render.sock';
var TICK_MS = 250;
var IDLE_TICK_MS = 1000;
var PROC_EVERY_MS = 10000;
var STALE_MS = 3000;
var SHOWN = ['showing', 'frozen'];

var aapdConf = require('./aapd_conf.js');

/* ---- the shape ---------------------------------------------------------------- */

/* GLSL ES 1.00. The signed distance (in units of 100 px) of p, from the
 * rect's centre, to the rounded rectangle of half-size b and corner r:
 * negative inside. Units of 100 px keep every square well within mediump. */
function sdf(rect, mask) {
    var u = function (v) { return (v / 100).toFixed(4); };
    return 'float woc_d(vec2 uv){' +
        'vec2 p=(uv-vec2(0.5))*vec2(' + u(rect.w) + ',' + u(rect.h) + ');' +
        'vec2 q=abs(p)-vec2(' + u(rect.w / 2 - mask.radius) + ',' + u(rect.h / 2 - mask.radius) + ');' +
        'return min(max(q.x,q.y),0.0)+length(max(q,vec2(0.0)))-' + u(mask.radius) + ';}';
}

/* The vignette's fragment shader (an effect layer: v_uv from the top-left). */
function vignetteFs(rect, mask) {
    return 'precision mediump float;varying vec2 v_uv;' + sdf(rect, mask) +
        'void main(){float a=smoothstep(-' + (mask.feather / 100).toFixed(4) + ',0.0,woc_d(v_uv));gl_FragColor=vec4(0.0,0.0,0.0,a);}';
}

/* The cut's shaders (a mesh part, blending off): inside the shape nothing
 * is written, outside it a transparent pixel. */
var CUT_VS = 'attribute vec3 a_position;attribute vec2 a_texcoord;uniform mat4 u_mvp;varying vec2 v_uv;' +
    'void main(){v_uv=a_texcoord;gl_Position=u_mvp*vec4(a_position,1.0);}';
function cutFs(rect, mask) {
    return 'precision mediump float;varying vec2 v_uv;' + sdf(rect, mask) +
        'void main(){if(woc_d(v_uv)<0.0)discard;gl_FragColor=vec4(0.0);}';
}

/* The cut's quad: the whole rect, seen by an orthographic camera 2 units
 * high at the rect's aspect, 1 unit in front of it; texcoords from the
 * top-left, as an effect layer's v_uv. */
function cutQuad(rect) {
    var x = rect.w / rect.h;
    return {
        positions: [-x, 1, -1, x, 1, -1, -x, -1, -1, x, -1, -1],
        texcoords: [0, 0, 1, 0, 0, 1, 1, 1],
        indices: [0, 2, 1, 1, 2, 3],
    };
}

/* The same distance in JavaScript, in pixels, for the tests. */
function distance(rect, mask, px, py) {
    var p = [px - (rect.x + rect.w / 2), py - (rect.y + rect.h / 2)];
    var q = [Math.abs(p[0]) - (rect.w / 2 - mask.radius), Math.abs(p[1]) - (rect.h / 2 - mask.radius)];
    return Math.min(Math.max(q[0], q[1]), 0) + Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0)) - mask.radius;
}

/* ---- what runs ------------------------------------------------------------------ */

/* The wide rect of a waze-on-cluster command line (its arguments), or null:
 * the last -s target= and -s map_rect= win, as the render reads them. */
function wideRect(args) {
    var target = null, rect = null;
    for (var i = 0; i + 1 < args.length; i++) {
        if (args[i] !== '-s') continue;
        var kv = args[i + 1], eq = kv.indexOf('=');
        if (eq < 0) continue;
        var k = kv.slice(0, eq), v = kv.slice(eq + 1);
        if (k === 'target') target = v;
        else if (k === 'map_rect') rect = v;
    }
    var m = target === 'panel' && rect && /^(\d+),(\d+),(\d+),(\d+)$/.exec(rect);
    if (!m) return null;
    var r = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
    return r.w >= 16 && r.h >= 16 && r.x + r.w <= 1920 && r.y + r.h <= 720 ? r : null;
}

/* The arguments of the running waze-on-cluster process, or null. */
function renderArgs(proc) {
    var names;
    try { names = fs.readdirSync(proc); } catch (e) { return null; }
    for (var i = 0; i < names.length; i++) {
        if (!/^\d+$/.test(names[i])) continue;
        try {
            if (fs.readFileSync(path.join(proc, names[i], 'comm'), 'utf8').trim() !== 'waze-on-cluster') continue;
            var args = fs.readFileSync(path.join(proc, names[i], 'cmdline'), 'utf8').split('\0');
            if (args[args.length - 1] === '') args.pop();
            /* the service, not `waze-on-cluster run` or bench-pack from a shell */
            if (args.indexOf('run') < 0 && args.indexOf('bench-pack') < 0) return args.slice(1);
        } catch (e) { /* gone meanwhile */ }
    }
    return null;
}

/* The map shows on the panel, from the render's status file at `now`. */
function mapShown(file, now) {
    try {
        var st = fs.statSync(file);
        if (now - st.mtime.getTime() > STALE_MS) return false;
        var s = JSON.parse(fs.readFileSync(file, 'utf8'));
        return s.target === 'panel' && SHOWN.indexOf(s.state) >= 0;
    } catch (e) { return false; }
}

/* ---- the layers ------------------------------------------------------------------ */

/* Shows and hides the two layers on a cluster-render client made by
 * makeClient() at the first rect; a new rect makes them again. */
function Mask(makeClient, mask, log) {
    this.makeClient = makeClient;
    this.mask = mask;
    this.log = log || function () {};
    this.cr = null;
    this.rect = null;
    this.refs = null;
    this.shown = false;
}

Mask.prototype.update = function (rect, show) {
    var same = rect && this.rect && ['x', 'y', 'w', 'h'].every(function (k) { return rect[k] === this.rect[k]; }, this);
    if (rect && !same) this._make(rect);
    var want = !!(rect && show);
    if (this.refs && want !== this.shown) {
        this.cr.set(this.refs.vignette, { visible: want });
        this.cr.set(this.refs.cut, { visible: want });
        this.log('wide map ' + (want ? 'shown: the mask over ' : 'gone: the mask hidden, at ') + [this.rect.x, this.rect.y, this.rect.w, this.rect.h].join(','));
    }
    this.shown = want && !!this.refs;
};

Mask.prototype._make = function (rect) {
    if (!this.cr) {
        this.cr = this.makeClient();
        var log = this.log;
        this.cr.on('refused', function (op, ref, reason) { log('cluster-render refused ' + op + ' of layer ' + ref + ': ' + reason); });
        this.cr.connect();
    }
    if (this.refs) { this.cr.drop(this.refs.vignette); this.cr.drop(this.refs.cut); }
    var base = { target: 'panel', klass: 'overlay', x: rect.x, y: rect.y, w: rect.w, h: rect.h, visible: false };
    var vignette = this.cr.effect(Object.assign({ z: 0, fs: vignetteFs(rect, this.mask) }, base));
    var cut = this.cr.mesh(Object.assign({ z: 1, projection: 'ortho', ortho_h: 2, near: 0.1, far: 10 }, base));
    this.cr.part(cut, 1, { vs: CUT_VS, fs: cutFs(rect, this.mask), depth: false, cull: 'none', blend: 'none' });
    this.cr.geometry(cut, 1, cutQuad(rect));
    this.refs = { vignette: vignette, cut: cut };
    this.rect = rect;
    this.shown = false;
    this.log('wide map rect ' + [rect.x, rect.y, rect.w, rect.h].join(',') + ': mask made, corner ' + this.mask.radius + ' px, fade ' + this.mask.feather + ' px');
};

/* ---- the service ----------------------------------------------------------------- */

function main() {
    function log(line) { process.stdout.write('wide-mask: ' + line + '\n'); }
    var mask = new Mask(function () {
        var ClusterRender = require('./cluster_render_client.js').ClusterRender;
        return new ClusterRender('waze-on-cluster-mask', RENDER_SOCK);
    }, aapdConf.WIDE.mask, log);
    var rect = null, procAt = 0;
    function tick() {
        var now = Date.now();
        if (now - procAt >= PROC_EVERY_MS) {
            procAt = now;
            var args = renderArgs(PROC);
            rect = args ? wideRect(args) : null;
        }
        mask.update(rect, rect ? mapShown(STATUS, now) : false);
        setTimeout(tick, rect ? TICK_MS : IDLE_TICK_MS);
    }
    process.on('SIGTERM', function () { process.exit(0); });
    log('started');
    tick();
}

module.exports = { sdf: sdf, vignetteFs: vignetteFs, cutFs: cutFs, CUT_VS: CUT_VS, cutQuad: cutQuad, distance: distance,
    wideRect: wideRect, renderArgs: renderArgs, mapShown: mapShown, Mask: Mask, STALE_MS: STALE_MS };

if (require.main === module) main();
