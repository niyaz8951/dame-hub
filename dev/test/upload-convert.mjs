// Tests for supabase/functions/tile-upload/convert.ts (no network: a fake fetcher serves the "CDN").
// Usage: node dev/test/upload-convert.mjs
import { convertTool, rel, decodeEntities, svgSafe } from '../../supabase/functions/tile-upload/convert.ts';

const enc = new TextEncoder(), dec = new TextDecoder();
let bad = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { bad++; console.log('  ✗ ' + m); } };
const CDN = {
  'https://cdn.example.test/chart.umd.min.js': { type: 'text/javascript', body: 'window.Chart=function(){};' },
  'https://fonts.example.test/css2?family=Inter': { type: 'text/css; charset=utf-8', body: '@font-face{font-family:Inter;src:url(https://fonts.example.test/s/inter.woff2) format("woff2")}' },
  'https://fonts.example.test/s/inter.woff2': { type: 'font/woff2', body: 'WOFF2' },
  'https://img.example.test/logo.png': { type: 'image/png', body: 'PNG' }
};
const fetcher = async (u) => CDN[u] ? { ok: true, status: 200, bytes: enc.encode(CDN[u].body), type: CDN[u].type } : { ok: false, status: 404, bytes: new Uint8Array(0), type: '' };
const opts = { tile: 'pmo', supabaseUrl: 'https://abc.supabase.co', fetcher };
const f = (path, text) => ({ path, bytes: enc.encode(text) });
const get = (r, p) => { const x = r.files.find((y) => y.path === p); return x ? dec.decode(x.bytes) : null; };

console.log('paths');
ok(rel('index.html', '_dame/js/a.js') === '_dame/js/a.js', 'rel from root');
ok(rel('sub/page.html', '_dame/js/a.js') === '../_dame/js/a.js', 'rel from a folder');
ok(rel('_dame/vendor/h/x/y.css', '_dame/vendor/h/s/z.woff2') === '../s/z.woff2', 'rel between vendored files');
ok(decodeEntities('a &amp;&amp; b &quot;x&quot; &#39;y&#x27; &lt;') === 'a && b "x" \'y\' <', 'entities');

console.log('a typical one-file tool');
const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src *">
<title>PMO tracker</title>
<link rel="manifest" href="manifest.json">
<link rel="icon" href="favicon.ico">
<link rel="preconnect" href="https://fonts.example.test">
<link href="https://fonts.example.test/css2?family=Inter" rel="stylesheet">
<script src="https://cdn.example.test/chart.umd.min.js" integrity="sha384-x" crossorigin="anonymous"></script>
<style>body{font-family:Inter} .hero{background:url(https://img.example.test/logo.png)}</style>
</head>
<body onload="init()">
<h1 style="color: #0a7bc2">PMO</h1>
<button onclick="add(&quot;row&quot;); return false;" class="b">Add</button>
<a href="javascript:void(0)" onclick="toggle(this)">Toggle</a>
<input oninput='this.nextElementSibling.textContent = this.value'><span></span>
<img src="https://img.example.test/logo.png" alt="">
<svg><style>.s{fill:red}</style><circle class="s" r="4"/></svg>
<script type="application/json" id="data">{"a": "<b>"}</script>
<script>
  function init(){ document.title = 'ready'; }
  function add(x){ var tr = '<tr><td>' + x + '</td><td><button onclick="del()">x</button></td></tr>'; }
  if (1 < 2 && 3 > 2) console.log('ok');
</script>
<script>if ('serviceWorker' in navigator) {}</script>
</body>
</html>`;
let r = await convertTool([f('My Tool/tracker.html', page), f('My Tool/app.css', '.x{background:url(img/a.png)}'), f('My Tool/img/a.png', 'PNG'),
  f('My Tool/sw.js', 'self.addEventListener("fetch",()=>{})'), f('My Tool/.DS_Store', 'x'), f('My Tool/notes.exe', 'MZ')], opts);
const html = get(r, 'index.html.txt') || '';
const shellPage = get(r, 'index.html') || '';
ok(r.ok, 'converted without errors');
ok(!!get(r, 'index.html.txt'), 'single page becomes the start page, stored as text; shared top folder removed');
ok(r.files.filter((x) => /\.html?$/i.test(x.path)).length === 1 && shellPage.indexOf('core/v1/uploaded.js') > 0 && shellPage.indexOf('PMO tracker') < 0, 'the only HTML file is the core shell, with nothing of the upload in it');
ok(shellPage.indexOf("base-uri 'self'; form-action 'self'; frame-src 'self'") > 0 && shellPage.indexOf('<meta name="dame-tile" content="pmo">') > 0, 'shell policy: frames only from the site');
ok(!r.files.some((x) => x.path === 'sw.js' || x.path === 'notes.exe' || /DS_Store/.test(x.path)), 'service worker, .exe and junk left out');
ok(!/default-src/.test(html) && !/rel="manifest"/.test(html) && !/favicon\.ico/.test(html) && !/preconnect/.test(html), 'own CSP, manifest, icon and preconnect removed');
ok((html.match(/<meta charset/gi) || []).length === 1 && (html.match(/name="viewport"/g) || []).length === 1, 'one charset, one viewport');
ok(html.indexOf('<head>\n<meta charset="utf-8">') > 0 && html.indexOf('<!--DAME-BOOT-->\n<script src="/dame-hub/core/v1/sealed.js"></script>') > 0, 'bridge first in <head>, boot mark before it');
ok(!/uploaded\.js|config\.js|api\.js/.test(html), 'the tool page loads no core file that knows the session');
ok(/<link href="_dame\/vendor\/fonts\.example\.test\/css2-[0-9a-f]{8}\.css" rel="stylesheet">/.test(html), 'Google-style font CSS copied in');
const fontCss = r.files.find((x) => /css2-.*\.css$/.test(x.path));
ok(fontCss && /url\("s\/inter\.woff2"\)/.test(dec.decode(fontCss.bytes)) && !!get(r, '_dame/vendor/fonts.example.test/s/inter.woff2'), 'font file copied and linked from the copied CSS');
ok(/<script src="_dame\/vendor\/cdn\.example\.test\/chart\.umd\.min\.js"><\/script>/.test(html), 'CDN script copied, integrity and crossorigin dropped');
ok(/<link rel="stylesheet" href="_dame\/css\/tracker-1\.css">|<link rel="stylesheet" href="_dame\/css\/index-1\.css">/.test(html), 'inline <style> moved to a file');
const css1 = get(r, '_dame/css/tracker-1.css') || get(r, '_dame/css/index-1.css') || '';
ok(/url\("\.\.\/vendor\/img\.example\.test\/logo\.png"\)/.test(css1), 'outside image in CSS copied in, relative path from _dame/css/');
ok(/<img src="_dame\/vendor\/img\.example\.test\/logo\.png" alt="">/.test(html), 'outside <img> copied in');
ok(/<h1 style="color: #0a7bc2">/.test(html), 'style attribute kept (applied by uploaded.js)');
ok(!/onclick=|onload=|oninput=/.test(html), 'handler attributes removed');
ok(/<body data-up-on="1">/.test(html) && /<button class="b" data-up-on="2">/.test(html), 'elements tagged for their handlers');
ok(/<a href="#" data-up-on="3">/.test(html), 'javascript: link turned into a handler');
const on = get(r, '_dame/js/tracker-on.js') || get(r, '_dame/js/index-on.js') || '';
ok(/"window:load": function \(event\)/.test(on) && /add\("row"\); return false;/.test(on) && /event\.preventDefault\(\); with \(document\)/.test(on), 'handlers generated (window load, entities decoded, javascript: link)');
ok(html.indexOf('<script src="_dame/js/' ) > 0 && html.indexOf('-on.js"></script>') < html.indexOf('</head>'), 'handler file loaded in <head>');
ok(/<script type="application\/json" id="data">\{"a": "<b>"\}<\/script>/.test(html), 'JSON data block kept inline');
ok(/<script src="_dame\/js\/(tracker|index)-1\.js"><\/script>/.test(html), 'inline script moved to a file');
ok(/1 < 2 && 3 > 2/.test(get(r, '_dame/js/tracker-1.js') || get(r, '_dame/js/index-1.js') || ''), 'script text unchanged');
ok(html.indexOf('<svg><circle') > 0 && /<link rel="stylesheet" href="_dame\/css\/(tracker|index)-2\.css">\n/.test(html.slice(0, html.indexOf('</head>'))), '<style> inside <svg> goes to <head>');
ok(r.notes.some((n) => n.level === 'warn' && /handler inside the script/.test(n.text)) === true, 'warns about onclick built in script text');
ok(!!get(r, 'app.css') && get(r, 'img/a.png') === 'PNG', 'own files kept');

console.log('refusals');
r = await convertTool([f('a.html', '<p>a</p>'), f('b.html', '<p>b</p>')], opts);
ok(!r.ok && r.notes.some((n) => /none is called index\.html/.test(n.text)), 'several pages, no index.html');
r = await convertTool([f('index.html', '<script>navigator.serviceWorker.register("sw.js")</script>')], opts);
ok(!r.ok && r.notes.some((n) => /service worker/.test(n.text)), 'service worker registration refused');
r = await convertTool([f('index.html', '<script src="https://cdn.example.test/missing.js"></script>')], opts);
ok(!r.ok && r.notes.some((n) => /Could not download/.test(n.text)), 'missing CDN file reported');
r = await convertTool([f('../index.html', 'x')], opts);
ok(!r.ok, 'path with .. refused');
r = await convertTool([f('index.html', 'x'), f('_next/a.js', 'x')], opts);
ok(!r.ok && r.notes.some((n) => /_dame and _next/.test(n.text)), 'reserved folder names refused');
r = await convertTool([f('index.html', '<button onclick="if (">x</button>')], opts);
ok(r.ok && r.notes.some((n) => /syntax error/.test(n.text)), 'broken handler left out with a warning');
r = await convertTool([f('index.html', '<!doctype html><p>bare</p>')], opts);
const bare = get(r, 'index.html.txt') || '';
ok(r.ok && /^<!doctype html>\n<meta charset="utf-8">/.test(bare), 'page without <html>/<head>: doctype first, then the head block');

console.log('nothing that can run is stored');
ok(svgSafe('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" fill="red"/><path d="M0 0"/></svg>'), 'plain SVG passes');
for (const bad of ['<svg><script>x</script></svg>', '<svg onload="x()"></svg>', '<svg><a href="j&#97;vascript:x">a</a></svg>', '<svg><foreignObject><b>x</b></foreignObject></svg>',
  '<svg><image href="x" ONERROR=x /></svg>', '<svg><animate attributeName="href" to="javascript:x"/></svg>', '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>'])
  ok(!svgSafe(bad), 'SVG refused: ' + bad.slice(0, 40));
r = await convertTool([f('index.html', '<p>x</p>'), f('icon.svg', '<svg><script>alert(1)</script></svg>')], opts);
ok(!r.ok && r.notes.some((n) => /SVG has script/.test(n.text)), 'uploaded SVG with script refused');
r = await convertTool([f('index.html', '<p>x</p>'), f('data.xml', '<html xmlns="http://www.w3.org/1999/xhtml"><script>x</script></html>'), f('p.xhtml', 'x')], opts);
ok(r.ok && !r.files.some((x) => /xml|xhtml/.test(x.path)), '.xml and .xhtml left out');
r = await convertTool([f('index.html', '<img src="https://cdn.example.test/evil.html">')], opts);
ok(!r.ok || !r.files.some((x) => /evil\.html$/.test(x.path)), 'an outside .html is never copied in');
r = await convertTool([f('index.html', '<p>x</p>'), f('sub/a.HTML', '<p>y</p>'), f('b.htm', '<p>z</p>')], opts);
ok(r.ok && r.files.filter((x) => /\.html?$/i.test(x.path)).map((x) => x.path).join() === 'index.html' && !!get(r, 'sub/a.HTML.txt') && !!get(r, 'b.htm.txt'), 'every page stored as .txt, whatever the case');

if (bad) { console.log('\n' + bad + ' FAILED'); process.exit(1); }
console.log('\nUPLOAD CONVERT TESTS PASSED');
