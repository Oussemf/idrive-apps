'use strict';

const { test, expect, _electron } = require('@playwright/test');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

function message(type, values) {
    const body = Buffer.from(new Uint32Array(values).buffer);
    const result = Buffer.alloc(8 + body.length);
    result.writeUInt32LE(type); result.writeUInt32LE(body.length, 4); body.copy(result, 8);
    return result;
}

for (const garageTest of [false, true]) {
test('MGU protocol, focus and heartbeat in ' + (garageTest ? 'garage validation' : 'speed-gated mode'), async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'idrive-mgu-test-'));
    const socketPath = process.platform === 'win32' ?
        '\\\\.\\pipe\\idrive-mgu-' + process.pid :
        path.join(directory, 'renderer.sock');
    let peer, electron, heartbeat, ticks = new Set(), pixels = 0, frames = 0;
    const server = net.createServer(socket => {
        peer = socket;
        let pending = Buffer.alloc(0);
        socket.on('error', () => { /* Test shutdown can interrupt an in-flight frame. */ });
        socket.on('data', data => {
            pending = Buffer.concat([pending, data]);
            while (pending.length >= 8) {
                const type = pending.readUInt32LE(0), length = pending.readUInt32LE(4);
                if (pending.length < 8 + length) return;
                pending = pending.subarray(8 + length);
                if (type === 1) {
                    socket.write(message(0x4d520101, [1, 3, 15, 84, 80, 1836, 560,
                        84, 0, 1836, 720, 2048, 60000]));
                    socket.write(message(101, [4, 1920, 720, 1]));
                    socket.write(message(0x4d520102, [1, 0, 1]));
                }
                if (type === 0x4d520004) pixels++;
                if (type === 7) {
                    frames++;
                    const tick = setTimeout(() => {
                        ticks.delete(tick);
                        if (!socket.destroyed) socket.write(message(102, [frames, frames * 50]));
                    }, 50);
                    ticks.add(tick);
                }
            }
        });
    });
    await new Promise(resolve => server.listen(socketPath, resolve));
    const safetyFile = path.join(directory, 'safety.json');
    let speed = null, foreground = true;
    async function publish() {
        const now = Date.now();
        await fs.writeFile(safetyFile + '.tmp', JSON.stringify({
            speedKmh: speed, speedUpdated: now, updated: now, foreground, mode: 'native', garageTest
        }));
        await fs.rename(safetyFile + '.tmp', safetyFile);
    }
    try {
        await publish();
        heartbeat = setInterval(() => publish().catch(error => { throw error; }), 400);
        electron = await _electron.launch({
            args: [path.join(__dirname, '..', '..'), '--mgu', '--safety-file', safetyFile,
                '--data-dir', directory, ...(garageTest ? ['--garage-test'] : [])],
            env: { ...process.env, MGU_APP_ID: 'oussem_youtube',
                MGU_RENDERD_SOCKET: socketPath, YOUTUBE_API_KEY: '' }
        });
        const page = await electron.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        const allowed = () => page.evaluate(async () => (await window.idrive.state()).data.allowed);
        const expectAllowed = value => expect(async () => {
            expect(await allowed()).toBe(value);
        }).toPass({ timeout: 5000 });
        await expectAllowed(garageTest);
        if (garageTest) {
            await expect(page.locator('#status')).toContainText('vitesse non verifiee');
            await expect.poll(() => pixels).toBeGreaterThan(0);
        }
        expect(await page.evaluate(async () => (await window.idrive.confirmParked(true)).ok)).toBe(false);
        speed = 0;
        await publish();
        await expectAllowed(true);
        await expect.poll(() => pixels).toBeGreaterThan(0);
        await expect.poll(() => frames).toBeGreaterThan(0);
        speed = 1 / 64;
        await publish();
        await expectAllowed(garageTest);
        speed = 0;
        await publish();
        await expectAllowed(true);
        peer.write(message(0x4d520102, [1, 0, 0]));
        await expectAllowed(false);
        peer.write(message(0x4d520102, [1, 1, 1]));
        await expectAllowed(true);
        clearInterval(heartbeat); heartbeat = null;
        await fs.writeFile(safetyFile, JSON.stringify({
            speedKmh: 0, speedUpdated: Date.now(), updated: Date.now() - 3000,
            foreground: true, mode: 'native', garageTest
        }));
        await expectAllowed(false);
    } finally {
        clearInterval(heartbeat);
        ticks.forEach(tick => clearTimeout(tick));
        if (electron) await electron.close();
        if (peer) peer.destroy();
        await new Promise(resolve => server.close(resolve));
        await fs.rm(directory, { recursive: true, force: true });
    }
});
}
