#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
/* Lays out the waze-on-cluster tool the Store installs from this repository
 * (mgu-repo.json "tools"): store/waze-on-cluster, a component.json with no
 * build step naming committed files, from native/waze-on-cluster's sources
 * and a prebuilt waze-on-cluster binary.
 *
 *   node tools/stage_waze_on_cluster.js --binary <file>   take this binary
 *   node tools/stage_waze_on_cluster.js                   keep the staged one
 *   node tools/stage_waze_on_cluster.js --check           exit 1 if the staged
 *                                                          tool is not the sources'
 *
 * The binary is upstream's release build (waze-on-cluster@0.9.14.tgz of
 * robertnisipeanu/idrive-apps, files/waze-on-cluster) until this fork
 * changes the C++ sources; then build it with `make -C native/waze-on-cluster
 * target` (Docker) and pass build/target/waze-on-cluster. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'native', 'waze-on-cluster');
const OUT = path.join(ROOT, 'store', 'waze-on-cluster');
const BINARY = 'waze-on-cluster';

const args = process.argv.slice(2);
const check = args.includes('--check');
const bi = args.indexOf('--binary');
const binaryFrom = bi >= 0 ? args[bi + 1] : path.join(OUT, 'files', BINARY);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* rel (in OUT) -> bytes, and the component.json that names them. */
function layout() {
    const src = JSON.parse(fs.readFileSync(path.join(SRC, 'component.json'), 'utf8'));
    const out = new Map();
    const comp = Object.assign({}, src);
    delete comp.build;
    comp.files = src.files.map((f) => {
        const data = f.path === BINARY ? fs.readFileSync(binaryFrom) : fs.readFileSync(path.join(SRC, f.from));
        const rel = `files/${f.path}`;
        out.set(rel, data);
        return { path: f.path, mode: f.mode, sha256: sha(data), from: rel };
    });
    comp.units = src.units.map((u) => {
        const rel = `units/${u.name}`;
        out.set(rel, fs.readFileSync(path.join(SRC, u.from)));
        return Object.assign({}, u, { from: rel });
    });
    comp.dropins = (src.dropins || []).map((d) => {
        const rel = `dropins/${d.unit}.d/${d.name}`;
        out.set(rel, fs.readFileSync(path.join(SRC, d.from)));
        return Object.assign({}, d, { from: rel });
    });
    out.set('component.json', Buffer.from(JSON.stringify(comp, null, 2) + '\n'));
    return out;
}

/* Every file under dir, relative, '/'-separated. */
function walk(dir, base = dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
    });
}

if (!fs.existsSync(binaryFrom)) {
    console.error(`stage_waze_on_cluster: no binary at ${binaryFrom}; pass --binary <file>`);
    process.exit(2);
}
const want = layout();
const have = walk(OUT);
if (check) {
    const bad = [...want].filter(([rel, data]) => !fs.existsSync(path.join(OUT, rel)) || !fs.readFileSync(path.join(OUT, rel)).equals(data))
        .map(([rel]) => rel).concat(have.filter((rel) => !want.has(rel)));
    if (bad.length) {
        console.error(`store/waze-on-cluster is not the sources' (run node tools/stage_waze_on_cluster.js): ${bad.join(', ')}`);
        process.exit(1);
    }
    console.log(`store/waze-on-cluster matches the sources (${want.size} files)`);
    process.exit(0);
}
const binary = fs.readFileSync(binaryFrom);
have.filter((rel) => !want.has(rel)).forEach((rel) => fs.unlinkSync(path.join(OUT, rel)));
for (const [rel, data] of want) {
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), data);
}
console.log(`staged store/waze-on-cluster: ${want.size} files, ${BINARY} sha256 ${sha(binary)}`);
