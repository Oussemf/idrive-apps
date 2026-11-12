'use strict';

const { test, expect, _electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

let electron, page, directory;
test.beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'idrive-ui-'));
    electron = await _electron.launch({
        args: [path.join(__dirname, '..', '..'), '--data-dir', directory],
        env: { ...process.env, YOUTUBE_API_KEY: '' }
    });
    page = await electron.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Real Electron windows, local IPC and fullscreen; only third-party website content is mocked.
    await electron.evaluate(async ({ session }) => {
        await session.defaultSession.protocol.handle('https', () =>
            new Response('<!doctype html><title>YouTube test fixture</title><p>Official site fixture</p>',
                { headers: { 'content-type': 'text/html' } }));
    });
});
test.afterEach(async () => {
    if (electron) await electron.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
});

test('parked confirmation, keyboard entry, embedded URL, back and error reporting', async () => {
    await expect(page.getByRole('button', { name: 'YouTube TV' })).toBeDisabled();
    await page.getByLabel('Je suis stationne').check();
    await page.getByLabel('Ouvrir une URL').pressSequentially('https://youtu.be/dQw4w9WgXcQ');
    await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await expect(page.locator('#player')).toHaveAttribute('src',
        /https:\/\/www.youtube-nocookie.com\/embed\/dQw4w9WgXcQ/);
    await expect(page.locator('#player')).toHaveAttribute('src', /autoplay=0/);
    await expect(page.locator('#player-fullscreen')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.getByRole('button', { name: 'Retour aux videos' }).click();
    await expect(page.locator('#player')).not.toHaveAttribute('src');
    await page.getByLabel('Rechercher une video').fill('Voyage');
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('YOUTUBE_API_KEY');
    await page.getByLabel('Ouvrir une URL').fill('https://evil.test/watch?v=dQw4w9WgXcQ');
    await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('officielle');
});

test('real fullscreen, Escape and actual top-level YouTube TV without privileged preload', async () => {
    await page.getByLabel('Je suis stationne').check();
    await page.locator('#fullscreen').click();
    await expect.poll(() => electron.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => electron.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
    const opened = electron.waitForEvent('window');
    await page.getByRole('button', { name: 'YouTube TV' }).click();
    const tv = await opened;
    await expect(tv).toHaveURL('https://www.youtube.com/tv');
    await tv.waitForLoadState('domcontentloaded');
    await tv.bringToFront();
    expect(await tv.evaluate(() => typeof window.idrive)).toBe('undefined');
    expect(await tv.evaluate(() => typeof require)).toBe('undefined');
    // CDP keyboard events bypass Electron's native before-input-event hook.
    await electron.evaluate(({ BrowserWindow }) => {
        const content = BrowserWindow.getAllWindows().find(w =>
            w.webContents.getURL().includes('youtube.com/tv')).webContents;
        content.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
        content.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
    });
    await expect.poll(() => electron.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('youtube.com/tv')).isFullScreen())).toBe(true);
});

test('unchecking parked confirmation destroys embedded playback and disables controls', async () => {
    await page.getByLabel('Je suis stationne').check();
    await page.getByLabel('Ouvrir une URL').fill('dQw4w9WgXcQ');
    await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await page.getByLabel('Je suis stationne').uncheck();
    await expect(page.locator('#player')).not.toHaveAttribute('src');
    await expect(page.getByRole('button', { name: 'YouTube TV' })).toBeDisabled();
});
