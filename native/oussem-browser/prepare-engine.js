'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var crypto = require('crypto');

function digest(file) {
    return new Promise(function (resolve, reject) {
        var hash = crypto.createHash('sha256');
        var input = fs.createReadStream(file);
        input.on('error', reject);
        input.on('data', function (chunk) { hash.update(chunk); });
        input.on('end', function () { resolve(hash.digest('hex')); });
    });
}

function unpack(source, target, expected, mode) {
    return new Promise(function (resolve, reject) {
        var temporary = target + '.tmp';
        var input = fs.createReadStream(source);
        var inflate = zlib.createGunzip();
        var output = fs.createWriteStream(temporary, { mode: mode });
        var hash = crypto.createHash('sha256'), failed = false;
        function fail(error) {
            if (failed) return;
            failed = true;
            input.destroy(); inflate.destroy(); output.destroy();
            reject(error);
        }
        input.on('error', fail); inflate.on('error', fail); output.on('error', fail);
        inflate.on('data', function (chunk) { hash.update(chunk); });
        output.on('finish', function () {
            if (failed) return;
            try {
                if (hash.digest('hex') !== expected) throw new Error('Unpacked browser checksum mismatch');
                fs.chmodSync(temporary, mode);
                fs.renameSync(temporary, target);
                resolve();
            } catch (error) { fail(error); }
        });
        input.pipe(inflate).pipe(output);
    });
}

module.exports = async function (root, data) {
    var manifest = JSON.parse(fs.readFileSync(path.join(root, 'engine.json'), 'utf8'));
    var directory = path.join(data, 'browser-engine');
    try { fs.mkdirSync(directory, 0o700); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('Browser engine cache is not a directory');
    fs.chmodSync(directory, 0o700);
    for (var entry of manifest.files) {
        if (!/^[a-zA-Z0-9._-]+$/.test(entry.name) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
            throw new Error('Invalid compressed browser manifest');
        }
        var target = path.join(directory, entry.name);
        var current = null;
        try { current = await digest(target); } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (current !== entry.sha256) {
            console.log('Preparing browser engine: ' + entry.name);
            await unpack(path.join(root, 'electron', entry.name + '.gz'), target,
                entry.sha256, entry.name === 'electron' ? 0o700 : 0o600);
        }
    }
    // Electron resolves resources relative to its executable, not the JavaScript project.
    for (var name of fs.readdirSync(path.join(root, 'electron'))) {
        if (manifest.files.some(function (entry) { return name === entry.name + '.gz'; })) continue;
        var link = path.join(directory, name);
        try { fs.unlinkSync(link); } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        fs.symlinkSync(path.join(root, 'electron', name), link);
    }
    return path.join(directory, 'electron');
};
