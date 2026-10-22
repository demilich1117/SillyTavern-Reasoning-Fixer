import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.txt': 'text/plain' };
const server = http.createServer(async (request, response) => {
    try {
        let pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        if (pathname === '/') pathname = '/tests/browser/index.html';
        if (pathname === '/script.js') pathname = '/tests/browser/host.js';
        if (pathname === '/scripts/reasoning.js') pathname = '/tests/browser/reasoning.js';
        const target = path.resolve(root, `.${pathname}`);
        if (!target.startsWith(root) || pathname.includes('/.git') || !['/tests/', '/src/', '/node_modules/', '/index.js', '/style.css'].some(prefix => pathname.startsWith(prefix))) {
            response.writeHead(403); response.end(); return;
        }
        response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-store');
        response.end(await fs.readFile(target));
    } catch { response.writeHead(404); response.end(); }
});
server.listen(18764, '127.0.0.1', () => console.log('Reasoning Fixer browser harness: http://127.0.0.1:18764/?host=st (or host=tt)'));
