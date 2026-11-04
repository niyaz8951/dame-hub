#!/usr/bin/env node
// Local server with the GitHub Pages layout:
//   http://localhost:8080/dame-hub/   -> this repo
//   http://localhost:8080/<tile-id>/  -> the sibling folder ../<tile-id> (a tile repo cloned next to dame-hub),
//                                        or, for a tile kept inside this repo (the demo), ./<tile-id>
// No dependencies. Run from anywhere: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hub = resolve(here, '..');
const parent = resolve(hub, '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf' };

function root(id) {
  if (id === 'dame-hub') return hub;
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(id)) return null;
  const sibling = join(parent, id);
  if (existsSync(join(sibling, 'index.html'))) return sibling;
  const inside = join(hub, id);
  if (existsSync(join(inside, 'index.html'))) return inside;
  return null;
}

async function send(res, file, status = 200) {
  const body = await readFile(file);
  res.writeHead(status, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') { res.writeHead(302, { Location: '/dame-hub/' }); return res.end(); }
    const [, id, ...rest] = path.split('/');
    const base = root(id);
    if (!base) return send(res, join(hub, '404.html'), 404);
    let rel = rest.join('/');
    let file = resolve(base, rel);
    if (!file.startsWith(base)) return send(res, join(hub, '404.html'), 404);
    let info = await stat(file).catch(() => null);
    if (info && info.isDirectory()) {
      if (!path.endsWith('/')) { res.writeHead(302, { Location: path + '/' }); return res.end(); }
      file = join(file, 'index.html'); info = await stat(file).catch(() => null);
    }
    if (!info && !extname(file) && existsSync(file + '.html')) { file += '.html'; info = await stat(file); }
    if (!info) return send(res, join(hub, '404.html'), 404);
    await send(res, file);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('error: ' + e.message);
  }
}).listen(port, () => {
  console.log(`DAME local: http://localhost:${port}/dame-hub/   (tiles: sibling folders of ${hub})`);
});
