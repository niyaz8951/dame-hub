// DAME tile-upload: turns the files a team uploads into a tile that passes the site's rules (docs/STANDARDS.md
// section 13). Pure: no network, no GitHub; outside files come through the fetcher the caller passes in.
//
// What it does to every page:
//   - stores it as <page>.txt and adds the bridge (core/v1/sealed.js); the shell index.html frames it sealed;
//   - moves inline <script> and <style> blocks into files under _dame/;
//   - turns onclick="" and other handler attributes, and javascript: links, into listeners in _dame/js/<page>-on.js
//     (core/v1/sealed.js binds them, also on elements added later);
//   - style="" attributes stay: core/v1/sealed.js applies them through the CSSOM, which the CSP allows;
//   - copies outside scripts, styles, fonts and images (CDNs) into _dame/vendor/, so nothing loads from outside;
//   - drops manifests, service workers, app icons, <base> and the page's own CSP.
// Anything it cannot fix is reported; errors stop the upload, warnings do not.
// Written in plain, erasable TypeScript so the same file runs in Deno (the Edge Function) and Node (the tests).

export type InFile = { path: string; bytes: Uint8Array };
export type Note = { level: 'error' | 'warn' | 'info'; file?: string; text: string };
export type Fetched = { ok: boolean; status: number; bytes: Uint8Array; type: string };
export type Fetcher = (url: string) => Promise<Fetched>;
export type Options = { tile: string; supabaseUrl: string; fetcher: Fetcher };
export type Result = { ok: boolean; files: InFile[]; notes: Note[] };

export const LIMITS = { files: 300, fileBytes: 10 * 1024 * 1024, totalBytes: 20 * 1024 * 1024, downloads: 40, downloadBytes: 5 * 1024 * 1024 };

// Whitelist. Pages (.html, .htm) are stored as <name>.txt so that nothing an uploader writes can run when its
// address is opened directly; the shell loads them into a sealed frame. No .xml, .xhtml (they can run script).
const TEXT_EXT = ['html', 'htm', 'css', 'js', 'mjs', 'json', 'map', 'txt', 'md', 'csv', 'tsv', 'svg'];
const VENDOR_EXT = ['css', 'js', 'mjs', 'json', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'eot'];
const BIN_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf',
  'mp3', 'mp4', 'webm', 'ogg', 'wav', 'xlsx', 'docx', 'pptx'];
const DROP_NAMES = /^(sw|service-?worker|serviceworker)\.m?js$|\.webmanifest$|^apple-touch-icon.*\.png$|^favicon.*\.(ico|png|svg)$|^(\.ds_store|thumbs\.db|desktop\.ini)$/i;
const JS_TYPES = ['', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript', 'application/ecmascript', 'text/jscript'];
const WINDOW_EVENTS = ['afterprint', 'beforeprint', 'beforeunload', 'hashchange', 'languagechange', 'message', 'messageerror',
  'offline', 'online', 'pagehide', 'pageshow', 'popstate', 'rejectionhandled', 'storage', 'unhandledrejection', 'unload',
  'load', 'error', 'resize', 'scroll', 'focus', 'blur'];
const RAW_TEXT = ['script', 'style', 'textarea', 'title'];

const enc = new TextEncoder();
const dec = new TextDecoder();

export const BOOT_MARK = '<!--DAME-BOOT-->';

// True when an SVG holds nothing that can run: opened directly it is a document, so script, handlers, links and
// foreign content are refused outright.
export function svgSafe(text: string): boolean {
  const t = decodeEntities(text).toLowerCase().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return !/<script|<foreignobject|<iframe|<embed|<object|<!entity|<!doctype[^>]*\[|javascript\s*:|data\s*:\s*text\/html|[\s"'\/]on[a-z]+\s*=|<a[\s>\/]|<set[\s>\/]|<animate|<\?xml-stylesheet|<handler|<listener|<use[^>]+href\s*=\s*["']?\s*(https?:|\/\/)/.test(t);
}

// The page GitHub serves at /dame-hub/<tile>/ (and /_next/): the core's own shell. It checks the user, then loads
// the tool's pages (stored as .txt) into a sealed frame. Same for every tile; nothing of the upload is in it.
export function shell(tile: string, supabaseUrl: string): string {
  return '<!doctype html>\n<html lang="en">\n<head>\n' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp(supabaseUrl).replace("base-uri 'none'", "base-uri 'self'") + "; frame-src 'self'" + '">\n' +
    '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#F3F7FA">\n' +
    '<meta name="dame-tile" content="' + tile + '">\n<title>DAME HUB</title>\n' +
    '<link rel="stylesheet" href="/dame-hub/core/v1/uploaded.css">\n' +
    '<link rel="icon" href="/dame-hub/core/v1/icons/favicon.svg" type="image/svg+xml">\n' +
    '<link rel="apple-touch-icon" href="/dame-hub/core/v1/icons/apple-touch-icon.png">\n' +
    '<link rel="manifest" href="/dame-hub/manifest.webmanifest">\n' +
    '<script src="/dame-hub/core/v1/config.js" defer></script>\n<script src="/dame-hub/core/v1/api.js" defer></script>\n' +
    '<script src="/dame-hub/core/v1/uploaded.js" defer></script>\n</head>\n<body>\n</body>\n</html>\n';
}

export function csp(supabaseUrl: string): string {
  const s = supabaseUrl.replace(/\/+$/, '');
  return "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: " + s + "; connect-src 'self' " + s +
    "; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";
}

// ---------- paths ----------
function ext(p: string): string { const m = /\.([a-z0-9]+)$/i.exec(p); return m ? m[1].toLowerCase() : ''; }
function dir(p: string): string { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function base(p: string): string { return p.slice(p.lastIndexOf('/') + 1); }
// Relative link from the file `from` to the file `to` (both paths inside the tile).
export function rel(from: string, to: string): string {
  const a = dir(from) ? dir(from).split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return '../'.repeat(a.length - i) + b.slice(i).join('/');
}
function cleanPath(p: string): string | null {
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  if (!parts.length || parts.length > 8) return null;
  for (const s of parts) if (s === '..' || !/^[A-Za-z0-9 ._()@+-]{1,80}$/.test(s)) return null;
  return parts.join('/');
}
function isOutside(u: string): boolean { return /^(https?:)?\/\//i.test(u.trim()); }
function absolute(u: string, from?: string): string {
  const t = u.trim();
  if (t.indexOf('//') === 0) return 'https:' + t;
  return from ? new URL(t, from).href : t;
}

// ---------- text helpers ----------
function hash8(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', tab: '\t', newline: '\n' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const v = ENT[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}
function escAttr(raw: string): string { return raw.replace(/"/g, '&quot;'); }
function isText(bytes: Uint8Array): boolean {
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch (_e) { return false; }
}
// True when the code compiles as a function body (sloppy mode, as inline handlers are).
function compiles(code: string): boolean {
  try { new Function('event', 'with (document) { with (this.form || {}) { with (this) {\n' + code + '\n} } }'); return true; }
  catch (_e) { return false; }
}

// ---------- the HTML scanner ----------
type Attr = { name: string; raw: string | null };            // raw = value as written (entities kept), null = no value
type Tag = { name: string; attrs: Attr[]; selfClose: boolean; end: boolean };

function parseAttrs(s: string): { attrs: Attr[]; selfClose: boolean } {
  const attrs: Attr[] = [];
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  const selfClose = /\/\s*$/.test(s);
  while ((m = re.exec(s))) {
    const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null;
    attrs.push({ name: m[1].toLowerCase(), raw: v });
  }
  return { attrs, selfClose };
}
function getAttr(t: Tag, n: string): string | null {
  const a = t.attrs.find((x) => x.name === n);
  return a ? (a.raw === null ? '' : decodeEntities(a.raw)) : null;
}
function setAttr(t: Tag, n: string, v: string): void {
  const a = t.attrs.find((x) => x.name === n);
  const raw = v.replace(/&/g, '&amp;');
  if (a) a.raw = raw; else t.attrs.push({ name: n, raw });
}
function dropAttr(t: Tag, n: string): void { t.attrs = t.attrs.filter((x) => x.name !== n); }
function writeTag(t: Tag): string {
  if (t.end) return '</' + t.name + '>';
  return '<' + t.name + t.attrs.map((a) => ' ' + a.name + (a.raw === null ? '' : '="' + escAttr(a.raw) + '"')).join('') + (t.selfClose ? ' />' : '>');
}

// ---------- the conversion ----------
type Ctx = {
  opts: Options; notes: Note[]; out: Map<string, Uint8Array>; downloads: number;
  vendored: Map<string, string | null>;   // absolute URL -> path in the tile (null = failed)
};

function note(ctx: Ctx, level: Note['level'], file: string | undefined, text: string): void {
  if (ctx.notes.length >= 80) return;
  if (ctx.notes.some((n) => n.level === level && n.file === file && n.text === text)) return;
  ctx.notes.push({ level, file, text: text.slice(0, 300) });
}

function vendorPath(url: string, type: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/[^A-Za-z0-9.-]/g, '');
  let p = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponentSafe(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)).join('/');
  const kind = /css/.test(type) ? 'css' : /javascript|ecmascript/.test(type) ? 'js' : '';
  if (!p || p.endsWith('/')) p = (p ? p : '') + 'file';
  if (u.search || !ext(p)) p = p.replace(/\.[a-z0-9]+$/i, '') + '-' + hash8(url) + '.' + (ext(p) || kind || 'bin');
  const parts = p.split('/');
  while (parts.length > 5) parts.splice(0, 1);
  return '_dame/vendor/' + host + '/' + parts.join('/');
}
function decodeURIComponentSafe(s: string): string { try { return decodeURIComponent(s); } catch (_e) { return s; } }

// Copies an outside file into _dame/vendor/ once; CSS files bring their own url(...) and @import along.
async function vendor(ctx: Ctx, url: string, fromFile: string, expect: 'css' | 'js' | 'any', depth = 0): Promise<string | null> {
  let abs: string;
  try { abs = absolute(url); new URL(abs); } catch (_e) { note(ctx, 'warn', fromFile, 'Cannot read the address ' + url.slice(0, 120)); return null; }
  if (!/^https:\/\//i.test(abs)) { note(ctx, 'warn', fromFile, 'Only https addresses can be copied in: ' + abs.slice(0, 120)); return null; }
  if (ctx.vendored.has(abs)) return ctx.vendored.get(abs) || null;
  if (ctx.downloads >= LIMITS.downloads) { note(ctx, 'error', fromFile, 'Too many outside files (more than ' + LIMITS.downloads + '). Include them in the upload instead.'); return null; }
  ctx.downloads++;
  ctx.vendored.set(abs, null);
  let got: Fetched;
  try { got = await ctx.opts.fetcher(abs); } catch (_e) { got = { ok: false, status: 0, bytes: new Uint8Array(0), type: '' }; }
  if (!got.ok) { note(ctx, 'error', fromFile, 'Could not download ' + abs.slice(0, 120) + ' (' + (got.status || 'no answer') + '). Put the file in the upload instead.'); return null; }
  if (got.bytes.length > LIMITS.downloadBytes) { note(ctx, 'error', fromFile, 'Outside file too big: ' + abs.slice(0, 120)); return null; }
  const type = got.type || (expect === 'css' ? 'text/css' : expect === 'js' ? 'text/javascript' : '');
  const path = vendorPath(abs, type);
  if (VENDOR_EXT.indexOf(ext(path)) < 0) { note(ctx, 'error', fromFile, 'Outside file of a type that cannot be copied in: ' + abs.slice(0, 120)); return null; }
  if (ext(path) === 'svg' && !(isText(got.bytes) && svgSafe(dec.decode(got.bytes)))) { note(ctx, 'error', fromFile, 'Outside SVG with script or links in it: ' + abs.slice(0, 120)); return null; }
  ctx.vendored.set(abs, path);
  if (/css/.test(type) || expect === 'css') {
    const css = await fixCss(ctx, dec.decode(got.bytes), path, abs, depth + 1);
    ctx.out.set(path, enc.encode(css));
  } else {
    ctx.out.set(path, got.bytes);
    if (/javascript|ecmascript/.test(type) || expect === 'js') checkJs(ctx, dec.decode(got.bytes), path, true);
  }
  note(ctx, 'info', fromFile, 'Copied in ' + abs.slice(0, 120));
  return path;
}

// url(...) and @import in a style sheet. `file` is where the sheet will live; `from` its original address if outside.
async function fixCss(ctx: Ctx, css: string, file: string, from: string | undefined, depth: number): Promise<string> {
  const jobs: Array<{ m: string; url: string; isImport: boolean }> = [];
  const re = /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?|url\(\s*(["']?)([^"')]+)\3\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const isImport = m[2] !== undefined;
    const url = (isImport ? m[2] : m[4]).trim();
    if (/^(data:|#|blob:)/i.test(url)) continue;
    const outside = isOutside(url) || (from && !/^[a-z]+:/i.test(url));
    if (!outside) { if (url[0] === '/') note(ctx, 'warn', file, 'Address starting with / will not be found: ' + url.slice(0, 80) + '. Use a relative path.'); continue; }
    jobs.push({ m: m[0], url: from && !isOutside(url) ? new URL(url, from).href : absolute(url), isImport });
  }
  for (const j of jobs) {
    if (depth > 3) { note(ctx, 'warn', file, 'Style sheets nested too deep: ' + j.url.slice(0, 100)); continue; }
    const p = await vendor(ctx, j.url, file, j.isImport ? 'css' : 'any', depth);
    if (!p) continue;
    const r = rel(file, p);
    css = css.split(j.m).join(j.isImport ? '@import url("' + r + '")' : 'url("' + r + '")');
  }
  return css;
}

function checkJs(ctx: Ctx, js: string, file: string, vendored = false): void {
  if (vendored) {
    if (/\bimport\s*(?:[\w*{}\s,]+from\s*)?["']https?:/.test(js)) note(ctx, 'warn', file, 'This library loads more code from outside; that part is blocked.');
    return;
  }
  if (/serviceWorker\s*\.\s*register\s*\(/.test(js)) note(ctx, 'error', file, 'Registers a service worker. DAME is one app: remove that code.');
  if (/\beval\s*\(|\bnew\s+Function\s*\(|set(Timeout|Interval)\s*\(\s*["'`]/.test(js)) note(ctx, 'warn', file, 'Runs code from text (eval, new Function or setTimeout with a string); the site blocks that.');
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(js)) note(ctx, 'warn', file, 'Builds HTML with onclick="..." or another handler inside the script; those handlers will not run. Use addEventListener.');
  if (/\bimport\s*(?:[\w*{}\s,]+from\s*)?["']https?:|import\s*\(\s*["']https?:/.test(js)) note(ctx, 'warn', file, 'Imports code from an outside address; that is blocked. Put the library in the upload.');
  if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b[\s\S]{0,200}?["'`](https?|wss?):\/\/(?![a-z0-9-]+\.supabase\.co)/i.test(js)) note(ctx, 'warn', file, 'Seems to call an outside address; calls outside the site are blocked.');
  if (/\bindexedDB\b|document\s*\.\s*cookie|\bcaches\s*\./.test(js)) note(ctx, 'warn', file, 'Uses IndexedDB, cookies or caches; a sealed tool has none. Use localStorage (kept per user by the site) or Dame.save.');
  if (/location\s*(\.\s*href)?\s*=\s*["'`][^"'`]*\.html?|location\s*\.\s*(assign|replace)\s*\(/.test(js)) note(ctx, 'warn', file, 'Changes the page from script (location = ...). Use a normal link, or Dame.go("page.html").');
  if (/\bwindow\s*\.\s*open\s*\(|target\s*=\s*["']_blank/.test(js)) note(ctx, 'info', file, 'Opens new windows; inside the installed app they open in the browser.');
}

async function fixHtml(ctx: Ctx, path: string, html: string, pageNo: number): Promise<string> {
  const tile = ctx.opts.tile;
  const stem = base(path).replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9_-]/g, '_') + (pageNo ? '-' + pageNo : '');
  const handlers: string[] = [];
  let scriptNo = 0, styleNo = 0, handlerNo = 0;
  let out = '';
  let headDone = false;
  let charsetOther = false;
  let svgDepth = 0;
  const headLinks: string[] = [];    // style sheets from <style> inside inline <svg>: they apply to the whole page
  const onFile = '_dame/js/' + stem + '-on.js';
  const HEAD_MARK = '\u0000DAME_HEAD\u0000';

  // A tool page runs inside the sealed frame; the policy comes from the shell that frames it (inherited). BOOT_MARK
  // is where the shell puts <base> and the boot data before it loads the page.
  function headBlock(): string {
    return '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
      BOOT_MARK + '\n' +
      '<script src="/dame-hub/core/v1/sealed.js"></script>\n' +
      HEAD_MARK;
  }

  let i = 0;
  const L = html.length;
  while (i < L) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    i = lt;
    if (html.startsWith('<!--', i)) {
      const e = html.indexOf('-->', i + 4);
      const stop = e < 0 ? L : e + 3;
      out += html.slice(i, stop); i = stop; continue;
    }
    if (/^<[!?]/.test(html.slice(i, i + 2))) {
      const e = html.indexOf('>', i);
      const stop = e < 0 ? L : e + 1;
      out += html.slice(i, stop); i = stop; continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i, i + 64));
    if (!m) { out += '<'; i++; continue; }
    // end of the tag: the first > outside quotes
    let j = i + m[0].length, q = '';
    while (j < L) {
      const c = html[j];
      if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
      j++;
    }
    const inner = html.slice(i + m[0].length, j);
    const tagText = html.slice(i, Math.min(j + 1, L));
    i = Math.min(j + 1, L);
    const name = m[2].toLowerCase();
    const end = m[1] === '/';
    const pa = end ? { attrs: [], selfClose: false } : parseAttrs(inner);
    const t: Tag = { name, attrs: pa.attrs, selfClose: pa.selfClose, end };
    let keep = true, changed = false;

    // raw text content (script, style, textarea, title)
    let content: string | null = null;
    if (!end && RAW_TEXT.indexOf(name) >= 0 && !t.selfClose) {
      const close = new RegExp('</' + name + '\\s*>', 'i');
      const rest = html.slice(i);
      const cm = close.exec(rest);
      content = cm ? rest.slice(0, cm.index) : rest;
      i += cm ? cm.index + cm[0].length : rest.length;
    }

    if (end) {
      if (name === 'head' && !headDone) { out += headBlock(); headDone = true; }
      if (name === 'svg' && svgDepth > 0) svgDepth--;
      out += tagText; continue;
    }
    if (name === 'svg' && !t.selfClose) svgDepth++;

    // handler attributes and javascript: links -> listeners
    const ons = t.attrs.filter((a) => /^on[a-z]+$/.test(a.name) && a.name.length > 2);
    const href = (name === 'a' || name === 'area') ? getAttr(t, 'href') : null;
    const jsHref = href !== null && /^\s*javascript:/i.test(href);
    if (ons.length || jsHref) {
      const parts: string[] = [];
      const asWindow = name === 'body' || name === 'frameset';
      for (const a of ons) {
        const code = decodeEntities(a.raw || '');
        const type = a.name.slice(2);
        if (!code.trim()) continue;
        if (!compiles(code)) { note(ctx, 'warn', path, 'A ' + a.name + ' handler has a syntax error and was left out: ' + code.slice(0, 80)); continue; }
        const key = (asWindow && WINDOW_EVENTS.indexOf(type) >= 0 ? 'window:' : '') + type;
        parts.push(JSON.stringify(key) + ': function (event) { with (document) { with (this.form || {}) { with (this) {\n' + code + '\n} } } }');
      }
      if (jsHref) {
        const code = decodeURIComponentSafe(href!.replace(/^\s*javascript:/i, ''));
        if (compiles(code)) parts.push('"click": function (event) { event.preventDefault(); with (document) { with (this) {\n' + code + '\n} } }');
        else note(ctx, 'warn', path, 'A javascript: link has a syntax error and was left out.');
        setAttr(t, 'href', '#');
      }
      t.attrs = t.attrs.filter((a) => !(/^on[a-z]+$/.test(a.name) && a.name.length > 2));
      if (parts.length) {
        handlerNo++;
        setAttr(t, 'data-up-on', String(handlerNo));
        handlers.push('  ' + JSON.stringify(String(handlerNo)) + ': {\n    ' + parts.join(',\n    ') + '\n  }');
      }
      changed = true;
    }

    if (name === 'head') {
      if (!headDone) { out += writeTag(t) + '\n' + headBlock(); headDone = true; continue; }
    } else if (name === 'body' && !headDone) { out += headBlock(); headDone = true; }
    else if (name === 'meta') {
      const he = (getAttr(t, 'http-equiv') || '').toLowerCase(), nm = (getAttr(t, 'name') || '').toLowerCase();
      const cs = getAttr(t, 'charset');
      if (he === 'content-security-policy') { keep = false; note(ctx, 'info', path, 'The page\'s own security policy was replaced by the site\'s.'); }
      else if (['viewport', 'theme-color', 'robots', 'apple-mobile-web-app-capable', 'mobile-web-app-capable'].indexOf(nm) >= 0) keep = false;
      else if (cs !== null || he === 'content-type') { keep = false; if (cs !== null && !/^utf-?8$/i.test(cs.trim())) charsetOther = true; }
    } else if (name === 'base') { keep = false; note(ctx, 'warn', path, '<base> is not allowed and was removed; links now start from the page itself.'); }
    else if (name === 'link') {
      const r = (getAttr(t, 'rel') || '').toLowerCase().split(/\s+/);
      const h = getAttr(t, 'href') || '';
      if (r.some((x) => ['manifest', 'icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon', 'shortcut'].indexOf(x) >= 0)) keep = false;
      else if (r.some((x) => ['preconnect', 'dns-prefetch', 'prerender', 'prefetch'].indexOf(x) >= 0)) keep = false;
      else if (h && isOutside(h) && r.some((x) => ['stylesheet', 'preload', 'modulepreload'].indexOf(x) >= 0)) {
        const isCss = r.indexOf('stylesheet') >= 0 || (getAttr(t, 'as') || '') === 'style';
        const p = await vendor(ctx, h, path, isCss ? 'css' : (getAttr(t, 'as') === 'script' || r.indexOf('modulepreload') >= 0) ? 'js' : 'any');
        if (p) { setAttr(t, 'href', rel(path, p)); dropAttr(t, 'integrity'); dropAttr(t, 'crossorigin'); changed = true; } else keep = false;
      } else if (h.trim()[0] === '/' && h.trim()[1] !== '/') note(ctx, 'warn', path, 'Address starting with / will not be found: ' + h.slice(0, 80) + '. Use a relative path.');
    } else if (name === 'script') {
      const src = getAttr(t, 'src');
      const type = (getAttr(t, 'type') || '').toLowerCase().trim();
      if (src !== null) {
        if (isOutside(src)) {
          const p = await vendor(ctx, src, path, 'js');
          if (p) { setAttr(t, 'src', rel(path, p)); dropAttr(t, 'integrity'); dropAttr(t, 'crossorigin'); changed = true; } else keep = false;
        } else if (src.trim()[0] === '/') note(ctx, 'warn', path, 'Script address starting with / will not be found: ' + src.slice(0, 80) + '. Use a relative path.');
        if (keep && content && content.trim()) note(ctx, 'info', path, 'Text inside a <script src> tag is ignored by browsers.');
        content = '';
      } else if (JS_TYPES.indexOf(type) >= 0) {
        const code = content || '';
        if (!code.trim()) keep = false;
        else {
          scriptNo++;
          const f = '_dame/js/' + stem + '-' + scriptNo + '.js';
          ctx.out.set(f, enc.encode(code));
          checkJs(ctx, code, path);
          // Inline classic scripts run at once, in order; an external one without defer / async does the same.
          dropAttr(t, 'defer'); dropAttr(t, 'async'); dropAttr(t, 'nonce'); dropAttr(t, 'integrity');
          if (type === 'module') setAttr(t, 'type', 'module'); else dropAttr(t, 'type');
          setAttr(t, 'src', rel(path, f));
          content = ''; changed = true;
        }
      } else if (type === 'importmap') note(ctx, 'warn', path, 'An import map cannot be used on the site; modules that need it will not load.');
      // other types (application/json, text/template ...) are data, not code: kept as they are
    } else if (name === 'style') {
      const css = content || '';
      keep = false;
      if (css.trim()) {
        styleNo++;
        const f = '_dame/css/' + stem + '-' + styleNo + '.css';
        ctx.out.set(f, enc.encode(await fixCss(ctx, css, f, undefined, 0)));
        const link: Tag = { name: 'link', attrs: [{ name: 'rel', raw: 'stylesheet' }, { name: 'href', raw: rel(path, f).replace(/&/g, '&amp;') }], selfClose: false, end: false };
        const media = getAttr(t, 'media'); if (media) setAttr(link, 'media', media);
        if (svgDepth > 0) headLinks.push(writeTag(link) + '\n'); else out += writeTag(link);
      }
      content = null;
    } else if (['img', 'source', 'video', 'audio', 'track', 'input', 'embed'].indexOf(name) >= 0) {
      for (const an of ['src', 'poster']) {
        const v = getAttr(t, an);
        if (v && isOutside(v)) {
          if (name === 'embed') { note(ctx, 'warn', path, 'Embedded outside content is blocked: ' + v.slice(0, 80)); continue; }
          const p = await vendor(ctx, v, path, 'any');
          if (p) { setAttr(t, an, rel(path, p)); dropAttr(t, 'crossorigin'); changed = true; }
        }
      }
      const ss = getAttr(t, 'srcset');
      if (ss && /https?:\/\//i.test(ss)) { dropAttr(t, 'srcset'); changed = true; note(ctx, 'warn', path, 'srcset with outside images was removed; the plain src is used.'); }
    } else if (name === 'iframe' || name === 'frame') {
      const v = getAttr(t, 'src') || '';
      if (isOutside(v)) note(ctx, 'warn', path, 'Outside pages inside a frame are blocked: ' + v.slice(0, 80));
    } else if (name === 'object' || name === 'applet') note(ctx, 'warn', path, '<' + name + '> is blocked on the site.');
    else if (name === 'form') {
      const a = getAttr(t, 'action') || '';
      if (isOutside(a)) note(ctx, 'warn', path, 'A form sends to an outside address; that is blocked: ' + a.slice(0, 80));
    }

    if (keep) out += changed ? writeTag(t) : tagText;
    if (content !== null && keep) out += content + '</' + name + '>';   // raw text was consumed above: close it again
  }

  if (!headDone) {     // no <head> and no <body>: after the doctype and <html>, if any
    const at = /^(\s*<!doctype[^>]*>)?(\s*<html[^>]*>)?/i.exec(out);
    const n = at ? at[0].length : 0;
    out = out.slice(0, n) + '\n' + headBlock() + out.slice(n);
  }
  if (charsetOther) note(ctx, 'warn', path, 'The page said it was not UTF-8. Save it as UTF-8, or some letters may look wrong.');
  let onTag = '';
  if (handlers.length) {
    const js = '/* Generated by DAME tile-upload from the handler attributes of ' + base(path) + '. Bound by core/v1/uploaded.js. */\n' +
      'window.DAME_UP_ON = window.DAME_UP_ON || {};\n' +
      'Object.assign(window.DAME_UP_ON, {\n' + handlers.join(',\n') + '\n});\n';
    ctx.out.set(onFile, enc.encode(js));
    onTag = '<script src="' + rel(path, onFile) + '"></script>\n';
  }
  out = out.split(HEAD_MARK).join(headLinks.join('') + onTag);
  if (!/^\s*<!doctype/i.test(out)) out = '<!doctype html>\n' + out;
  if (!/<html[\s>]/i.test(out)) note(ctx, 'info', path, 'The page has no <html> tag; the browser adds one.');
  return out;
}

export async function convertTool(input: InFile[], opts: Options): Promise<Result> {
  const ctx: Ctx = { opts, notes: [], out: new Map(), downloads: 0, vendored: new Map() };
  // 1. paths: clean, drop junk, strip one shared top folder
  let files: InFile[] = [];
  let total = 0;
  for (const f of input) {
    const raw = f.path.replace(/\\/g, '/');
    if (/(^|\/)(__MACOSX|\.git)(\/|$)/.test(raw) || /(^|\/)\./.test(raw.replace(/^\.\//, ''))) continue;
    const p = cleanPath(raw);
    if (!p) { note(ctx, 'error', raw.slice(0, 120), 'File name not allowed. Use letters, digits, spaces, . _ - ( ) only, at most 8 folders deep.'); continue; }
    total += f.bytes.length;
    if (f.bytes.length > LIMITS.fileBytes) { note(ctx, 'error', p, 'File too big (more than 10 MB).'); continue; }
    files.push({ path: p, bytes: f.bytes });
  }
  if (files.length > LIMITS.files) note(ctx, 'error', undefined, 'Too many files (' + files.length + '; at most ' + LIMITS.files + ').');
  if (total > LIMITS.totalBytes) note(ctx, 'error', undefined, 'The upload is too big (more than 20 MB).');
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (tops.size === 1 && files.every((f) => f.path.indexOf('/') > 0)) {
    const top = files[0].path.split('/')[0] + '/';
    files = files.map((f) => ({ path: f.path.slice(top.length), bytes: f.bytes }));
  }
  const seen = new Set<string>();
  files = files.filter((f) => {
    const k = f.path.toLowerCase();
    if (seen.has(k)) { note(ctx, 'error', f.path, 'Two files with the same name (letters differ only in case).'); return false; }
    seen.add(k);
    const top = f.path.split('/')[0];
    if (ext(f.path) === 'txt' && /\.html?\.txt$/i.test(f.path)) { note(ctx, 'error', f.path, 'A name ending in .html.txt is used by the site. Rename the file.'); return false; }
    if (top === '_dame' || top === '_next') { note(ctx, 'error', f.path, 'The folder names _dame and _next are used by the site. Rename the folder.'); return false; }
    if (DROP_NAMES.test(base(f.path))) { note(ctx, 'info', f.path, 'Left out: DAME is one app, so a tile has no manifest, service worker or app icons of its own.'); return false; }
    const e = ext(f.path);
    if (TEXT_EXT.indexOf(e) < 0 && BIN_EXT.indexOf(e) < 0) { note(ctx, 'warn', f.path, 'Left out: files of type .' + (e || '(none)') + ' are not allowed.'); return false; }
    return true;
  });

  // 2. the start page is index.html
  const pages = files.filter((f) => ext(f.path) === 'html' || ext(f.path) === 'htm');
  let start = files.find((f) => f.path === 'index.html');
  if (!start) {
    const htm = files.find((f) => f.path.toLowerCase() === 'index.htm' || f.path.toLowerCase() === 'index.html');
    const rootPages = pages.filter((f) => f.path.indexOf('/') < 0);
    const only = htm || (rootPages.length === 1 ? rootPages[0] : pages.length === 1 ? pages[0] : null);
    if (only) {
      if (only.path.indexOf('/') >= 0) note(ctx, 'error', only.path, 'The start page must be at the top of the upload, not in a folder.');
      else { note(ctx, 'info', only.path, 'Used as the start page (saved as index.html).'); only.path = 'index.html'; start = only; }
    } else note(ctx, 'error', undefined, pages.length ? 'Several pages and none is called index.html. Rename the start page to index.html.' : 'No HTML page in the upload.');
  }

  // 3. convert
  if (!ctx.notes.some((n) => n.level === 'error')) {
    const stems = new Map<string, number>();
    for (const f of files) {
      const e = ext(f.path);
      if (e === 'html' || e === 'htm') {
        if (!isText(f.bytes)) note(ctx, 'warn', f.path, 'The page is not saved as UTF-8; some letters may look wrong.');
        const stem = base(f.path).replace(/\.[a-z0-9]+$/i, '');
        const n = stems.get(stem) || 0; stems.set(stem, n + 1);
        ctx.out.set(f.path + '.txt', enc.encode(await fixHtml(ctx, f.path, dec.decode(f.bytes), n)));
      } else if (e === 'css') {
        ctx.out.set(f.path, enc.encode(await fixCss(ctx, dec.decode(f.bytes), f.path, undefined, 0)));
      } else {
        if (e === 'js' || e === 'mjs') checkJs(ctx, dec.decode(f.bytes), f.path);
        if (e === 'svg' && !(isText(f.bytes) && svgSafe(dec.decode(f.bytes)))) { note(ctx, 'error', f.path, 'This SVG has script, handlers or links in it. Save it as a plain drawing.'); continue; }
        ctx.out.set(f.path, f.bytes);
      }
    }
  }
  if (ctx.out.has('index.html')) note(ctx, 'error', 'index.html', 'Internal: a page was about to be stored as HTML.');
  ctx.out.set('index.html', enc.encode(shell(opts.tile, opts.supabaseUrl)));
  for (const p of ctx.out.keys()) if (p !== 'index.html' && /\.(x?html?|xht|xml|shtml)$/i.test(p)) note(ctx, 'error', p, 'Internal: a file that could run was about to be stored.');
  const ok = !ctx.notes.some((n) => n.level === 'error');
  const order = { error: 0, warn: 1, info: 2 };
  ctx.notes.sort((a, b) => order[a.level] - order[b.level]);
  return { ok, files: ok ? Array.from(ctx.out, ([path, bytes]) => ({ path, bytes })) : [], notes: ctx.notes };
}
