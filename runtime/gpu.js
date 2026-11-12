'use strict';

const { RenderClient, imageOp } = require('../vendor/mgu-render/mgu_render_client');

function rgba(bitmap) {
    const result = Buffer.allocUnsafe(bitmap.length);
    for (let i = 0; i < bitmap.length; i += 4) {
        result[i] = bitmap[i + 2]; result[i + 1] = bitmap[i + 1];
        result[i + 2] = bitmap[i]; result[i + 3] = 255;
    }
    return result;
}

class Gpu {
    constructor(id, log, callbacks) {
        this.client = new RenderClient(id, log);
        this.callbacks = callbacks;
        this.allowed = false;
        this.front = false;
        this.full = false;
        this.box = null;
        this.size = null;
        this.latest = null;
        this.client.on('ready', (screen, info) => {
            if (!info || !info.pixmap || !info.frontGate || !info.modes.includes('layer')) {
                callbacks.error('Renderer natif mgu-render/1 avec pixmaps et foreground gate requis.');
                this.client.show(false); return;
            }
            this.screen = screen; this.info = info;
            this.place();
            this.client.fps(20);
            this.client.grab(true);
            callbacks.ready();
        });
        this.client.on('state', state => {
            this.front = state.front;
            if (!state.front) callbacks.suspend();
        });
        this.client.on('closed', () => { this.allowed = false; callbacks.suspend(); });
        this.client.on('close', () => { this.front = false; callbacks.suspend(); });
        this.client.on('renderer-error', message => callbacks.error(message));
        this.client.on('touch', (phase, x, y) => callbacks.touch(phase, x, y));
        this.client.on('ccu', event => callbacks.controller(event));
        this.client.on('tick', () => this.flush());
        this.heartbeat = setInterval(() => this.flush(), 500);
        this.client.connect();
    }

    place() {
        if (!this.info) return;
        // The OAP launcher uses a stock menu, not the renderer's optional embed template.
        this.client.mode('layer');
        const available = this.info.appArea;
        const marginX = this.full ? 0 : Math.round(available.w * 0.025);
        const marginY = this.full ? 0 : Math.round(available.h * 0.1);
        const area = { x: available.x + marginX, y: available.y + marginY,
            w: available.w - marginX * 2, h: available.h - marginY * 2 };
        this.box = area;
        this.client.place({ x: area.x, y: area.y, w: area.w, h: area.h,
            scale: area.w / 1280, ox: 0, oy: 0 });
        this.size = { w: 1280, h: Math.round(area.h * 1280 / area.w) };
        this.client.pixmap(1, this.size.w, this.size.h, 'rgbx', 'linear');
        this.client.claim([{ x: 0, y: 0, w: this.size.w, h: this.size.h }]);
        this.callbacks.resize(this.size);
    }

    visible(allowed) {
        this.allowed = allowed;
        this.client.show(allowed);
        this.client.grab(allowed);
    }

    paint(image) {
        if (!this.allowed || !this.size) return;
        const size = image.getSize();
        if (size.width !== this.size.w || size.height !== this.size.h) return;
        this.latest = rgba(image.toBitmap());
        this.flush();
    }

    flush() {
        const c = this.client;
        if (!this.allowed || !c.ready || !c.native || !this.latest || !this.size ||
            c.waiting || (c.sock && c.sock.writableLength > 4 * 1024 * 1024)) return;
        c.pixels(1, [{ x: 0, y: 0, w: this.size.w, h: this.size.h }], this.latest);
        c.frameWords(imageOp(1, 0, 0, this.size.w, this.size.h));
    }

    fullscreen(on) { this.full = on; this.latest = null; this.place(); }
    close() { clearInterval(this.heartbeat); this.client.close(); }
}

module.exports = { Gpu, rgba };
