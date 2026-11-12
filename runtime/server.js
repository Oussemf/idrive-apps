'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const FILES = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
    '/style.css': ['style.css', 'text/css'] };

function createServer() {
    return http.createServer((request, response) => {
        const expected = '127.0.0.1:' + response.socket.localPort;
        if (request.headers.host !== expected || request.method !== 'GET' || !FILES[request.url]) {
            response.writeHead(404); response.end('Not found'); return;
        }
        const [file, type] = FILES[request.url];
        response.writeHead(200, {
            'Content-Type': type + '; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; " +
                "frame-src https://www.youtube-nocookie.com; img-src 'self'; connect-src 'self'; " +
                "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        });
        fs.createReadStream(path.join(__dirname, '..', 'web', file)).on('error', error => {
            console.error('UI resource: ' + error.message);
            response.destroy(error);
        }).pipe(response);
    });
}

module.exports = { createServer };
