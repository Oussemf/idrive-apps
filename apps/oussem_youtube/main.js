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
        function report(message, detail, diagnostic) {
            log.error(diagnostic || message);
            ui.text('STATUS', message); ui.text('RUNTIME_STATUS', message);
            ui.text('RUNTIME_DETAIL', detail || 'See the app log for technical details.');
        }
        function stop() {
            garageTest = false;
            garagePendingUntil = 0;
            publish({ updated: Date.now(), foreground: false, speedKmh: null, speedUpdated: 0 });
            if (child) child.kill('SIGTERM');
        }
        function launch() {
            let config, stage = 'config-read', installedCompanion = false;
            const configFile = path.join(ctx.dataDir, 'runtime.json');
            try {
                let text;
                try { text = fs.readFileSync(configFile, 'utf8'); } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                    installedCompanion = true;
                    config = {
                        executable: '/var/opt/oussem-browser/current/launch.sh',
                        project: '/var/opt/oussem-browser/current/project'
                    };
                }
                if (!installedCompanion) {
                    stage = 'config-parse';
                    config = JSON.parse(text);
                }
                if (!config || typeof config !== 'object' || Array.isArray(config)) {
                    throw new Error('runtime.json must contain a configuration object');
                }
                for (const key of ['executable', 'project']) {
                    if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) {
                        throw new Error('runtime.json: absolute ' + key + ' required');
                    }
                }
                stage = 'executable';
                if (!fs.statSync(config.executable).isFile()) throw new Error('Executable is not a file');
                stage = 'project';
                if (!fs.statSync(path.join(config.project, 'runtime', 'main.js')).isFile()) {
                    throw new Error('Runtime entry point is not a file');
                }
            } catch (error) {
                failed = true;
                let message, detail;
                if (installedCompanion) {
                    message = 'Install YouTube browser companion in the Store.';
                    detail = 'Source Oussemf/idrive-apps: select Releases, then install the browser tool.';
                } else if (stage === 'config-read') {
                    message = 'Cannot read runtime.json (' + (error.code || 'read error') + ').';
                    detail = 'Check the app data configuration and its read permissions.';
                } else if (stage === 'config-parse') {
                    message = 'Invalid runtime.json configuration.';
                    detail = 'Expected JSON with absolute executable and project paths.';
                } else if (stage === 'executable') {
                    message = 'Configured browser executable is unavailable.';
                    detail = 'Install a validated MGU-compatible companion; a config file alone is not enough.';
                } else {
                    message = 'Configured browser project is unavailable.';
                    detail = 'The project path must contain runtime/main.js and the companion sources.';
                }
                report(message, detail, 'Runtime setup [' + stage + '] ' + configFile + ': ' + error.message);
                return;
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
            let browserError = '';
            child.stdout.on('data', data => log.info('browser: ' + data.toString().slice(0, 2048)));
            child.stderr.on('data', data => {
                const text = data.toString().slice(0, 2048);
                log.warn('browser: ' + text);
                const diagnostic = text.split('\n').find(line =>
                    /Browser companion:|error while loading shared libraries|GLIBC_|FATAL|No usable sandbox/.test(line));
                if (diagnostic && !browserError) browserError = diagnostic.slice(0, 350);
            });
            child.on('error', error => { failed = true; report('Browser start failed: ' + error.message); });
            child.on('exit', (code, signal) => {
                child = null;
                if (code !== 0 && signal !== 'SIGTERM') {
                    failed = true; report('Browser stopped: code ' + code + ', signal ' + signal,
                        browserError || 'The browser could not start. See the app log for technical details.');
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
