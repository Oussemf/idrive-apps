'use strict';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com',
    'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']);

function videoId(input) {
    if (typeof input !== 'string') throw new Error('Une URL ou un identifiant video est requis.');
    const text = input.trim();
    if (VIDEO_ID.test(text)) return text;
    let url;
    try { url = new URL(text); } catch (error) {
        throw new Error('URL YouTube invalide.');
    }
    if (url.protocol !== 'https:' || !VIDEO_HOSTS.has(url.hostname) ||
        url.username || url.password || (url.port && url.port !== '443')) {
        throw new Error('Utilisez une URL HTTPS YouTube officielle.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const id = url.hostname === 'youtu.be' ? parts[0] :
        url.pathname === '/watch' ? url.searchParams.get('v') :
            ['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null;
    if (!id || !VIDEO_ID.test(id)) throw new Error('Identifiant video YouTube invalide.');
    return id;
}

function domainMatches(host, domain) {
    return host === domain || host.endsWith('.' + domain);
}

function networkHost(host) {
    return ['youtube.com', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com',
        'google.com', 'googleapis.com', 'gstatic.com', 'ggpht.com',
        'googleusercontent.com', 'doubleclick.net', 'googleadservices.com',
        'googlesyndication.com'].some(domain => domainMatches(host, domain));
}

function tvNavigation(input) {
    let url;
    try { url = new URL(input); } catch (error) { return false; }
    return url.protocol === 'https:' && !url.username && !url.password &&
        (!url.port || url.port === '443') &&
        (domainMatches(url.hostname, 'youtube.com') || url.hostname === 'accounts.google.com');
}

module.exports = { videoId, networkHost, tvNavigation };
