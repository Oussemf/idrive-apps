'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { permit, decodeSpeed } = require('../shared/safety');
const { videoId, tvNavigation, networkHost } = require('../shared/youtube');
const { Gpu, rgba } = require('../runtime/gpu');
const { RenderClient } = require('../vendor/mgu-render/mgu_render_client');
const { createServer } = require('../runtime/server');
const { createProxy, lookupForLease, search } = require('../runtime/network');

test('playback fails closed on unknown, stale, future, hidden or any non-zero speed', () => {
    const now = 10000;
    const value = { speedKmh: 0, speedUpdated: now, updated: now, foreground: true };
    assert.equal(permit(value, now), true);
    for (const change of [{ speedKmh: null }, { speedKmh: 0.015625 }, { speedKmh: -1 },
        { foreground: false }, { foreground: 1 }, { updated: now - 2501 },
        { updated: now + 1 }, { speedUpdated: now - 5001 }, { speedUpdated: now + 1 },
        { speedUpdated: NaN }, { updated: null }, { speedKmh: '0' }]) {
        assert.equal(permit({ ...value, ...change }, now), false, JSON.stringify(change));
    }
    assert.equal(permit(null, now), false);
    assert.equal(permit({ ...value, updated: now - 2500, speedUpdated: now - 5000 }, now), true);
});

test('MGU speed signal scaling and sentinel validation', () => {
    assert.equal(decodeSpeed({ speedVehicleCentreOfGravity: 64 }), 1);
    assert.equal(decodeSpeed({ speedVehicleCentreOfGravity: 0 }), 0);
    for (const raw of [65535, -1, 1.5, '0', undefined, Infinity]) {
        assert.equal(decodeSpeed({ speedVehicleCentreOfGravity: raw }), null);
    }
    assert.equal(decodeSpeed(null), null);
});

test('official YouTube URL formats and ids', () => {
    const id = 'dQw4w9WgXcQ';
    for (const input of [id, `https://youtu.be/${id}?t=1`,
        `https://www.youtube.com/watch?v=${id}&t=2`, `https://youtube.com/shorts/${id}`,
        `https://m.youtube.com/live/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) {
        assert.equal(videoId(input), id);
    }
    for (const input of ['', 'short', 'javascript:alert(1)', 'http://youtu.be/' + id,
        'https://youtube.com.evil.test/watch?v=' + id, 'https://evil@youtube.com/watch?v=' + id,
        'https://youtube.com:444/watch?v=' + id, 'https://youtube.com/playlist?list=x', null]) {
        assert.throws(() => videoId(input));
    }
});

test('TV is top-level HTTPS navigation with a narrow login allowlist', () => {
    assert.equal(tvNavigation('https://www.youtube.com/tv'), true);
    assert.equal(tvNavigation('https://accounts.google.com/ServiceLogin'), true);
    for (const url of ['https://youtube.com.evil.org/tv', 'file:///etc/passwd',
        'https://google.com', 'https://youtube.com:444/tv', 'javascript:alert(1)']) {
        assert.equal(tvNavigation(url), false);
    }
    assert.equal(networkHost('rr1.googlevideo.com'), true);
    assert.equal(networkHost('youtube.com.evil.org'), false);
    assert.equal(networkHost('127.0.0.1'), false);
});

test('BGRA offscreen pixels become opaque RGBA without modifying the source', () => {
    const source = Buffer.from([1, 2, 3, 0, 5, 6, 7, 255]);
    assert.deepEqual([...rgba(source)], [3, 2, 1, 255, 7, 6, 5, 255]);
    assert.equal(source[0], 1);
});

test('MGU fullscreen expands only within the negotiated app area, never uses an unavailable HMI template', t => {
    t.mock.method(RenderClient.prototype, 'connect', function () { return this; });
    const gpu = new Gpu('test_app', console, {
        ready() {}, error(message) { assert.fail(message); }, resize() {}
    });
    t.after(() => gpu.close());
    const area = { x: 84, y: 80, w: 1836, h: 560 };
    gpu.client.emit('ready', { w: 1920, h: 720 }, {
        pixmap: true, frontGate: true, modes: ['layer', 'embed'], appArea: area
    });
    assert.equal(gpu.client.mode(), 'layer');
    assert.ok(gpu.box.x > area.x);
    assert.ok(gpu.box.w < area.w);
    gpu.fullscreen(true);
    assert.deepEqual(gpu.box, area);
    assert.equal(gpu.client.mode(), 'layer');
    assert.equal(gpu.size.w, 1280);
});

test('MGU DNS has no system-DNS fallback when the Store lease is missing', async () => {
    await assert.rejects(new Promise((resolve, reject) => {
        lookupForLease('nonexistent-lease.json', true)('youtube.com', {}, error => error ? reject(error) : resolve());
    }), /Connexion Store indisponible/);
});

test('search reports missing credentials and invalid queries without network traffic', async () => {
    await assert.rejects(search('music', '', null), /YOUTUBE_API_KEY/);
    await assert.rejects(search('', 'test-key', null), /200 caracteres/);
    await assert.rejects(search('a'.repeat(201), 'test-key', null), /200 caracteres/);
});

test('native search requests embeddable videos and returns metadata without exposing the API key', async t => {
    let requestUrl;
    t.mock.method(https, 'get', (url, _options, callback) => {
        requestUrl = url;
        const request = new EventEmitter();
        queueMicrotask(() => {
            const response = new EventEmitter();
            response.statusCode = 200;
            response.setEncoding = () => {};
            callback(response);
            response.emit('data', JSON.stringify({ items: [
                { id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: '<title>', channelTitle: 'Channel' } },
                { id: { channelId: 'channel' }, snippet: { title: 'Not a video' } }
            ] }));
            response.emit('end');
        });
        return request;
    });
    const result = await search(' music ', 'test-only-key', () => {});
    assert.equal(requestUrl.hostname, 'www.googleapis.com');
    assert.equal(requestUrl.searchParams.get('videoEmbeddable'), 'true');
    assert.equal(requestUrl.searchParams.get('q'), 'music');
    assert.equal(requestUrl.searchParams.get('maxResults'), '12');
    assert.deepEqual(result, [{ id: 'dQw4w9WgXcQ', title: '<title>', channel: 'Channel' }]);
    assert.ok(!JSON.stringify(result).includes('test-only-key'));
});

test('local UI serves only known resources and refuses DNS rebinding hosts', async t => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    const base = 'http://127.0.0.1:' + server.address().port;
    const ok = await fetch(base);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await ok.text(), /Interface originale/);
    assert.equal((await fetch(base + '/package.json')).status, 404);
    const rebinding = await new Promise(resolve => {
        http.get(base, { headers: { Host: 'attacker.test' } }, response => {
            response.resume(); resolve(response.statusCode);
        });
    });
    assert.equal(rebinding, 404);
});

test('HTTPS proxy refuses arbitrary destinations and plaintext requests', async t => {
    const proxy = createProxy(() => { throw new Error('DNS must not be used'); }, console);
    const port = await proxy.listen();
    t.after(() => proxy.close());
    assert.equal((await fetch('http://127.0.0.1:' + port)).status, 405);
    const reply = await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
            socket.write('CONNECT attacker.test:443 HTTP/1.1\r\nHost: attacker.test\r\n\r\n');
        });
        socket.on('data', data => { resolve(data.toString()); socket.destroy(); });
        socket.on('error', reject);
    });
    assert.match(reply, /403 Forbidden/);
});
