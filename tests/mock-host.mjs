// Local-only UI fixture host. Provider calls are mocked; no API credits are used.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { harness, PNG } from './harness.mjs';
const base = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cgs-ui-'));
const { routes } = harness(root);
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{background:#222;color:white;font:16px system-ui}</style><h1>SillyTavern fixture host</h1><div id="extensionsMenu"></div><div id="extensions_settings2"></div><script>window.mockContext={characterId:0,characters:[{name:'Althea',avatar:'Althea.png',description:'An explorer in a blue coat.'},{name:'Fester',avatar:'Fester.png'}],getRequestHeaders:()=>({'X-CSRF-Token':'test'}),event_types:{},eventSource:{on(){}}};window.SillyTavern={getContext:()=>mockContext};window.toastr={info:console.log,success:console.log,error:console.error,warning:console.warn};</script><script type="module" src="/index.js"></script>`;
http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
        if (url.pathname.startsWith('/characters/')) { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from(PNG, 'base64')); return; }
        if (url.pathname.startsWith('/api/plugins/character-gallery-api')) {
            const pathname = url.pathname.replace('/api/plugins/character-gallery-api', '');
            const route = routes.find(r => r.method === req.method.toLowerCase() && new RegExp(`^${r.route.replace(/:[^/]+/g, '([^/]+)')}$`).test(pathname));
            if (!route) { res.statusCode = 404; res.end(); return; }
            const matched = pathname.match(new RegExp(`^${route.route.replace(/:[^/]+/g, '([^/]+)')}$`)); req.params = {};
            [...route.route.matchAll(/:([^/]+)/g)].forEach((m, i) => req.params[m[1]] = matched[i + 1]);
            req.query = Object.fromEntries(url.searchParams); req.user = { directories: { root } };
            res.status = code => { res.statusCode = code; return res; }; res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); }; res.send = bytes => res.end(bytes);
            await route.handler(req, res); return;
        }
        const filename = path.join(base, url.pathname);
        if (!filename.startsWith(`${base}/`)) { res.statusCode = 400; res.end(); return; }
        res.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(filename));
    } catch (error) { res.statusCode = 500; res.end(error.message); }
}).listen(8765, '127.0.0.1', () => console.log('UI fixture host http://127.0.0.1:8765'));
