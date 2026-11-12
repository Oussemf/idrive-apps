'use strict';

const fs = require('node:fs');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { networkHost } = require('../shared/youtube');

function lookupForLease(leaseFile, mgu) {
    return (hostname, options, callback) => {
        if (!mgu) return dns.lookup(hostname, options, callback);
        let lease;
        try {
            lease = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
            if (!Array.isArray(lease.dns) || !lease.dns.length ||
                !lease.dns.every(address => net.isIP(address))) {
                throw new Error('Le bail du Store ne contient pas de DNS valides.');
            }
        } catch (error) {
            callback(new Error('Connexion Store indisponible : ' + error.message));
            return;
        }
        const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
        resolver.setServers(lease.dns);
        resolver.resolve4(hostname, (error, addresses) => {
            if (error) return callback(error);
            if (options && options.all) {
                callback(null, addresses.map(address => ({ address, family: 4 })));
            } else callback(null, addresses[0], 4);
        });
    };
}

function createProxy(lookup, log) {
    const connections = new Set();
    const server = http.createServer((request, response) => {
        response.writeHead(405); response.end('HTTPS CONNECT only');
    });
    server.on('connection', socket => {
        connections.add(socket);
        socket.on('close', () => connections.delete(socket));
    });
    server.on('connect', (request, socket, head) => {
        const match = /^([a-z0-9.-]+):443$/i.exec(request.url);
        if (!match || !networkHost(match[1].toLowerCase())) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        const upstream = net.connect({ host: match[1], port: 443, lookup });
        connections.add(upstream);
        upstream.setTimeout(30000, () => upstream.destroy(new Error('Network timeout')));
        upstream.on('connect', () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            upstream.pipe(socket); socket.pipe(upstream);
        });
        upstream.on('error', error => {
            log.warn('Store proxy: ' + error.message);
            socket.destroy();
        });
        socket.on('error', error => {
            log.warn('Browser proxy connection: ' + error.message);
            upstream.destroy();
        });
        socket.on('close', () => upstream.destroy());
        upstream.on('close', () => { connections.delete(upstream); socket.destroy(); });
    });
    return {
        server,
        close() { connections.forEach(socket => socket.destroy()); server.close(); },
        listen() {
            return new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', () => {
                    server.removeListener('error', reject);
                    resolve(server.address().port);
                });
            });
        }
    };
}

function getJson(url, lookup) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { lookup, timeout: 10000 }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                body += chunk;
                if (body.length > 1024 * 1024) request.destroy(new Error('Reponse API trop volumineuse.'));
            });
            response.on('error', reject);
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    reject(new Error('YouTube API HTTP ' + response.statusCode +
                        ' : verifiez la cle, le quota et la connexion du Store.'));
                    return;
                }
                try { resolve(JSON.parse(body)); } catch (error) {
                    reject(new Error('Reponse JSON YouTube invalide.'));
                }
            });
        });
        request.on('timeout', () => request.destroy(new Error('YouTube API : delai depasse.')));
        request.on('error', reject);
    });
}

async function search(query, apiKey, lookup) {
    if (!apiKey) throw new Error('Configurez YOUTUBE_API_KEY pour rechercher, ou ouvrez une URL video.');
    if (typeof query !== 'string' || !query.trim() || query.length > 200) {
        throw new Error('La recherche doit contenir entre 1 et 200 caracteres.');
    }
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    Object.entries({ part: 'snippet', type: 'video', videoEmbeddable: 'true',
        maxResults: '12', q: query.trim(), key: apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    const result = await getJson(url, lookup);
    if (!Array.isArray(result.items)) throw new Error('Resultats YouTube invalides.');
    return result.items.filter(item => item.id && /^[\w-]{11}$/.test(item.id.videoId) &&
        item.snippet && typeof item.snippet.title === 'string').map(item => ({
        id: item.id.videoId, title: item.snippet.title, channel: item.snippet.channelTitle || ''
    }));
}

module.exports = { lookupForLease, createProxy, search };
