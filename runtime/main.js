'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('./server');
const { createProxy, lookupForLease, search } = require('./network');
const { permit } = require('../shared/safety');
const { videoId, tvNavigation } = require('../shared/youtube');

const mgu = process.argv.includes('--mgu');
function argument(name) {
    const index = process.argv.indexOf(name);
    return index < 0 ? null : process.argv[index + 1];
}
const dataDir = argument('--data-dir');
if (dataDir) app.setPath('userData', dataDir);
const safetyFile = argument('--safety-file');
const leaseFile = dataDir ? path.join(dataDir, 'uplink.json') : '/run/mgu-uplink/lease.json';
const lookup = lookupForLease(leaseFile, mgu);
let ui, tv, gpu, server, proxy, origin, timer;
let allowed = false, confirmed = false, full = false, closing = false, lastMode = null;
let status = 'Confirmez que vous etes stationne pour continuer.';

function state() {
    return { allowed, mgu, fullscreen: full, status, hasApiKey: !!process.env.YOUTUBE_API_KEY };
}
function notify() {
    if (ui && !ui.isDestroyed()) ui.webContents.send('state-update', state());
}
function active() { return tv && !tv.isDestroyed() ? tv : ui; }

function options(local) {
    return { width: 1280, height: 600, show: !mgu, backgroundColor: '#0d1117',
        title: local ? 'iDrive Apps - YouTube' : 'YouTube TV',
        webPreferences: {
            preload: local ? path.join(__dirname, 'preload.js') : undefined,
            contextIsolation: true, sandbox: true, nodeIntegration: false,
            webSecurity: true, offscreen: mgu, backgroundThrottling: false
        } };
}

function attach(window, local) {
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
        if (local ? url !== origin + '/' : !tvNavigation(url)) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event, url) => {
        if (local ? url !== origin + '/' : !tvNavigation(url)) event.preventDefault();
    });
    window.webContents.on('render-process-gone', (_event, details) => {
        suspend('Moteur navigateur arrete : ' + details.reason);
    });
    window.on('enter-html-full-screen', () => {
        full = true; if (gpu) gpu.fullscreen(true); notify();
    });
    window.on('leave-html-full-screen', () => {
        full = false; if (gpu) gpu.fullscreen(false); notify();
    });
    if (mgu) {
        window.webContents.setFrameRate(20);
        window.webContents.on('paint', (_event, _dirty, image) => {
            if (gpu && window === active()) gpu.paint(image);
        });
        if (gpu && gpu.size) window.setContentSize(gpu.size.w, gpu.size.h);
    }
}

async function home() {
    if (tv && !tv.isDestroyed()) { tv.destroy(); tv = null; }
    if (!ui || ui.isDestroyed()) {
        ui = new BrowserWindow(options(true));
        attach(ui, true);
        await ui.loadURL(origin + '/');
        ui.on('closed', () => { ui = null; if (!mgu && !closing) app.quit(); });
    }
    if (!mgu) ui.show();
    ui.webContents.invalidate();
    notify();
}

function suspend(reason) {
    allowed = false;
    status = reason;
    if (gpu) gpu.visible(false);
    if (tv && !tv.isDestroyed()) { tv.webContents.setAudioMuted(true); tv.destroy(); tv = null; }
    if (ui && !ui.isDestroyed()) {
        ui.webContents.setAudioMuted(true);
        // Destroying the player document also stops audio and in-flight media requests.
        ui.loadURL(origin + '/').catch(error => console.error('Safety screen: ' + error.message));
    }
    notify();
}

async function openTv() {
    if (!allowed) throw new Error('Lecture reservee au stationnement confirme.');
    if (tv && !tv.isDestroyed()) { if (!mgu) tv.show(); return; }
    tv = new BrowserWindow(options(false));
    attach(tv, false);
    tv.webContents.on('did-navigate', (_event, target) => {
        const url = new URL(target);
        if (url.hostname.endsWith('youtube.com') && !url.pathname.startsWith('/tv')) {
            status = 'YouTube TV a redirige vers le site standard ; navigateur TV non accepte.';
            tv.setTitle('YouTube - redirection du mode TV');
            console.warn(status); notify();
        }
    });
    tv.on('closed', () => {
        tv = null;
        if (ui && !ui.isDestroyed()) { if (!mgu) ui.show(); ui.webContents.invalidate(); }
    });
    tv.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        if (input.key === 'F11') { event.preventDefault(); fullscreen(); }
        if (input.key === 'Escape' && full) { event.preventDefault(); fullscreen(); }
    });
    try { await tv.loadURL('https://www.youtube.com/tv'); } catch (error) {
        if (tv && !tv.isDestroyed()) tv.destroy();
        throw new Error('YouTube TV inaccessible : ' + error.message);
    }
    if (!mgu && ui) ui.hide();
    if (full && !mgu) tv.setFullScreen(true);
}

function fullscreen() {
    if (!allowed) throw new Error('Stationnement non confirme.');
    full = !full;
    if (gpu) gpu.fullscreen(full);
    else active().setFullScreen(full);
    notify();
    return full;
}

function handle(channel, action) {
    ipcMain.handle(channel, async (event, value) => {
        if (!ui || event.sender !== ui.webContents ||
            event.senderFrame !== ui.webContents.mainFrame || event.senderFrame.url !== origin + '/') {
            throw new Error('Untrusted IPC sender');
        }
        try { return { ok: true, data: await action(value) }; } catch (error) {
            console.error(channel + ': ' + error.message);
            return { ok: false, error: error.message };
        }
    });
}

async function start() {
    if (mgu && (!safetyFile || !dataDir || !process.env.MGU_APP_ID)) {
        throw new Error('--mgu exige --safety-file, --data-dir et MGU_APP_ID (lanceur OAP).');
    }
    server = createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    origin = 'http://127.0.0.1:' + server.address().port;
    const browserSession = session.defaultSession;
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.on('will-download', event => event.preventDefault());
    if (mgu) {
        proxy = createProxy(lookup, console);
        const port = await proxy.listen();
        await browserSession.setProxy({ proxyRules: 'http=127.0.0.1:' + port +
            ';https=127.0.0.1:' + port, proxyBypassRules: '<local>;127.0.0.1' });
        const { Gpu } = require('./gpu');
        let knob = null, press = 0, tilt = 0;
        gpu = new Gpu(process.env.MGU_APP_ID, console, {
            ready() { gpu.visible(allowed); },
            error(message) { suspend('GPU : ' + message); },
            suspend() { if (allowed) suspend('Application masquee par le HMI.'); },
            resize(size) {
                for (const window of [ui, tv]) {
                    if (window && !window.isDestroyed()) window.setContentSize(size.w, size.h);
                }
            },
            touch(phase, x, y) {
                if (!allowed) return;
                active().webContents.sendInputEvent({ type: phase === 'down' ? 'mouseDown' :
                    phase === 'up' ? 'mouseUp' : 'mouseMove', x: Math.round(x), y: Math.round(y),
                button: 'left', clickCount: 1 });
            },
            controller(event) {
                if (!allowed) return;
                const delta = knob === null ? 0 : ((event.knob - knob + 32768) & 65535) - 32768;
                knob = event.knob;
                function key(keyCode) {
                    active().webContents.sendInputEvent({ type: 'keyDown', keyCode });
                    active().webContents.sendInputEvent({ type: 'keyUp', keyCode });
                }
                if (delta) {
                    if (tv) key(delta > 0 ? 'Right' : 'Left');
                    else {
                        active().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab',
                            modifiers: delta < 0 ? ['shift'] : [] });
                        active().webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab',
                            modifiers: delta < 0 ? ['shift'] : [] });
                    }
                }
                if (event.press && !press) key('Return');
                if (event.tilt && event.tilt !== tilt) {
                    if ([10, 11].includes(event.tilt)) {
                        if (tv) home().catch(error => suspend(error.message));
                        else key('Escape');
                    } else if (event.tilt === 2) fullscreen();
                    else key([1, 2].includes(event.tilt) ? 'Up' :
                        [7, 8].includes(event.tilt) ? 'Down' : 'Right');
                }
                press = event.press; tilt = event.tilt;
            }
        });
    }
    handle('state', () => state());
    handle('confirm-parked', value => {
        if (mgu) throw new Error('Le mode MGU utilise exclusivement le signal du vehicule.');
        confirmed = value === true;
        allowed = confirmed;
        status = confirmed ? 'Simulation bureau - aucun capteur vehicule.' : 'Stationnement non confirme.';
        if (!confirmed) suspend(status);
        else if (ui) ui.webContents.setAudioMuted(false);
        notify(); return state();
    });
    handle('search', query => {
        if (!allowed) throw new Error('Stationnement non confirme.');
        return search(query, process.env.YOUTUBE_API_KEY, lookup);
    });
    handle('play', input => {
        if (!allowed) throw new Error('Stationnement non confirme.');
        return videoId(input);
    });
    handle('tv', openTv);
    handle('fullscreen', fullscreen);
    await home();
    if (mgu) {
        const poll = () => {
            let snapshot;
            try { snapshot = JSON.parse(fs.readFileSync(safetyFile, 'utf8')); } catch (error) {
                if (allowed) suspend('Signal de securite indisponible : ' + error.message);
                return;
            }
            if (!permit(snapshot) || !gpu.info || !gpu.front) {
                if (allowed) suspend('Lecture arretee : mouvement, signal perime ou app en arriere-plan.');
                return;
            }
            if (!allowed) {
                allowed = true;
                status = 'Vehicule immobile - signal recent. Utilisation a l arret uniquement.';
                if (ui) ui.webContents.setAudioMuted(false);
                gpu.visible(true); notify();
            }
            if (snapshot.mode !== lastMode) {
                lastMode = snapshot.mode;
                const operation = snapshot.mode === 'tv' ? openTv() : home();
                operation.catch(error => suspend(error.message));
            }
        };
        timer = setInterval(poll, 200); poll();
    }
}

app.whenReady().then(start).catch(error => { console.error(error.stack); app.exit(1); });
app.on('window-all-closed', () => { if (!closing) app.quit(); });
app.on('before-quit', () => {
    closing = true; clearInterval(timer);
    if (gpu) gpu.close();
    if (proxy) proxy.close();
    if (server) server.close();
});
