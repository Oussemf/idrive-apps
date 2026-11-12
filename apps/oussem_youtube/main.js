'use strict';

const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const mgu = require('./kit/mgu');
const safety = require('./safety');

mgu.run({
    async start(ctx) {
        const ui = ctx.ui, log = ctx.log;
        const safetyFile = path.join(ctx.dataDir, 'youtube-safety.json');
        let speedKmh = null, speedUpdated = 0, mode = 'native', child = null, failed = false;
        let garageTest = false, garagePendingUntil = 0;
        const foreground = () => ui.isVisible('RUNTIME') && ui.hasFocus('RUNTIME');
        function snapshot() {
            return { speedKmh, speedUpdated, mode, garageTest, updated: Date.now(), foreground: foreground() };
        }
        function publish(value) {
            const temporary = safetyFile + '.tmp';
            fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
            fs.renameSync(temporary, safetyFile);
        }
        function report(message) {
            log.error(message);
            ui.text('STATUS', message); ui.text('RUNTIME_STATUS', message);
        }
        function stop() {
            garageTest = false;
            garagePendingUntil = 0;
            publish({ updated: Date.now(), foreground: false, speedKmh: null, speedUpdated: 0 });
            if (child) child.kill('SIGTERM');
        }
        function launch() {
            let config;
            try {
                config = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'runtime.json'), 'utf8'));
                for (const key of ['executable', 'project']) {
                    if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) {
                        throw new Error('runtime.json: absolute ' + key + ' required');
                    }
                }
                if (!fs.statSync(config.executable).isFile() ||
                    !fs.statSync(path.join(config.project, 'runtime', 'main.js')).isFile()) {
                    throw new Error('Compatible Electron executable / project not found');
                }
            } catch (error) {
                failed = true; report('Runtime unavailable: ' + error.message); return;
            }
            const args = [config.project, '--mgu', '--safety-file', safetyFile, '--data-dir', ctx.dataDir];
            if (garageTest) args.push('--garage-test');
            child = spawn(config.executable, args, {
                env: Object.assign({}, process.env, {
                    MGU_APP_ID: ctx.spec.id, YOUTUBE_API_KEY: config.youtubeApiKey || '',
                    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/' + process.getuid()
                }),
                stdio: ['ignore', 'pipe', 'pipe']
            });
            child.stdout.on('data', data => log.info('browser: ' + data.toString().slice(0, 2048)));
            child.stderr.on('data', data => log.warn('browser: ' + data.toString().slice(0, 2048)));
            child.on('error', error => { failed = true; report('Browser start failed: ' + error.message); });
            child.on('exit', (code, signal) => {
                child = null;
                if (code !== 0 && signal !== 'SIGTERM') {
                    failed = true; report('Browser stopped: code ' + code + ', signal ' + signal);
                }
            });
        }
        function tick() {
            try {
                if (garagePendingUntil && Date.now() <= garagePendingUntil && foreground()) {
                    garageTest = true; garagePendingUntil = 0;
                }
                if (Date.now() > garagePendingUntil) garagePendingUntil = 0;
                if (!foreground()) garageTest = false;
                const value = snapshot();
                publish(value);
                const ready = safety.permit(value, undefined, garageTest);
                if (!ready && child) stop();
                if (ready && !child && !failed) launch();
                if (!failed) {
                    const message = garageTest ? 'GARAGE TEST: speed not checked. Keep vehicle parked. BACK/HOME ends test.' :
                        speedKmh === null ? 'No valid speed signal: playback blocked.' :
                        ready ? 'Browser running. BACK/HOME returns to iDrive.' :
                            'Playback blocked: moving, stale speed or app hidden.';
                    ui.text('STATUS', message); ui.text('RUNTIME_STATUS', message);
                }
            } catch (error) {
                failed = true;
                if (child) child.kill('SIGTERM');
                report('Safety heartbeat failed: ' + error.message);
            }
        }
        ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2(value) { speedKmh = safety.decodeSpeed(value); speedUpdated = Date.now(); }
        }, log, { pollMs: 1000 }).then(result => {
            if (result.error) { speedKmh = null; report('Speed subscription: ' + result.error); }
        }).catch(error => { speedKmh = null; report('Speed subscription: ' + error.message); });
        async function open(nextMode, testSession) {
            stop();
            mode = nextMode; failed = false;
            garagePendingUntil = testSession === true ? Date.now() + 3000 : 0;
            await ui.open('RUNTIME');
            tick();
        }
        ui.onClick('BTN_NATIVE', () => open('native'));
        ui.onClick('BTN_TV', () => open('tv'));
        ui.onClick('BTN_GARAGE_NATIVE', () => open('native', true));
        ui.onClick('BTN_GARAGE_TV', () => open('tv', true));
        ui.onClick('BTN_STOP', () => { stop(); ui.open('MAIN'); });
        ui.onVisible(tick); ui.onFocus(tick);
        setInterval(tick, 500);
        process.on('exit', () => {
            if (child) child.kill('SIGTERM');
        });
        tick();
    }
});
