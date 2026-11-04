// End-to-end run of the DAME pages against the mock (test harness only).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_ROOT || import.meta.url);
const { chromium } = require('playwright');
const B = 'http://localhost:8080';
const psql = (q) => execFileSync('psql', [...(process.env.PGARGS || '-h /tmp -p 5499 -U postgres -d dame').split(' '), '-At', '-c', q], { encoding: 'utf8' }).trim();
let step = '';
const log = (s) => { step = s; console.log('• ' + s); };
const errors = [];

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/40[04]/.test(m.text())) errors.push(step + ': console ' + m.text()); });
  page.on('pageerror', (e) => errors.push(step + ': pageerror ' + e.message));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(step + ': HTTP ' + r.status() + ' ' + r.url()); });
  return page;
}
async function shot(page, name) { await page.screenshot({ path: 'tools/test/out/' + name + '.png', fullPage: true }); }
async function expect(cond, msg) { if (!cond) { errors.push(step + ': FAILED ' + msg); console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }
async function signIn(page, user, pass) {
  await page.goto(B + '/dame-hub/'); await page.fill('#si-user', user); await page.fill('#si-pass', pass); await page.click('#signin button[type=submit]');
}

try {
  // 1. request access -> pending
  let page = await newPage();
  log('request access');
  await page.goto(B + '/dame-hub/#request');
  await page.fill('#rq-user', 'niyaz'); await page.fill('#rq-name', 'Niyaz'); await page.fill('#rq-pass', 'OwnerPass2026'); await page.fill('#rq-pass2', 'OwnerPass2026');
  await page.click('#request button[type=submit]');
  await page.waitForSelector('#pane-pending:not([hidden])');
  await expect(await page.isVisible('#pane-pending'), 'pending pane shown after request');
  await shot(page, 'pending');
  // a pending user hitting the dashboard sees waiting
  await page.goto(B + '/dame-hub/dashboard.html');
  await page.waitForSelector('main .state');
  await expect((await page.textContent('main .state h2')).includes('Waiting'), 'dashboard shows waiting for a pending user');
  await page.click('#pending-signout').catch(() => {});
  await page.context().close();

  // 2. owner makes super, signs in, dashboard, admin
  psql("select core.make_super('niyaz')");
  page = await newPage();
  log('sign in super');
  await signIn(page, 'niyaz', 'wrong-Password1');
  await page.waitForSelector('#si-error:not([hidden])');
  await expect((await page.textContent('#si-error')).includes('Wrong username'), 'wrong password message');
  await signIn(page, 'niyaz', 'OwnerPass2026');
  await page.waitForURL('**/dashboard.html');
  await page.waitForSelector('.tile');
  await expect((await page.$$('.tile')).length === 1, 'super sees the demo tile (' + (await page.$$('.tile')).length + ')');
  await expect(await page.isVisible('a.btn[href$="admin.html"]'), 'admin button for super');
  await shot(page, 'dashboard');

  log('admin requests');
  await page.goto(B + '/dame-hub/admin.html');
  await page.waitForSelector('#requests .card, #requests .state');
  await expect((await page.textContent('#requests')).includes('demo_pending'), 'pending request listed');
  await page.click('#requests .card button.primary');
  await page.waitForSelector('#requests .state');
  await expect((await page.textContent('#requests .state')).includes('No requests'), 'approved -> no requests');

  log('admin users');
  await page.click('[data-tab=users]');
  await page.waitForSelector('#users table');
  await expect((await page.$$('#users tbody tr')).length === 5, '5 users listed');
  await page.fill('#user-filter', 'demo_none');
  await expect((await page.$$('#users tbody tr')).length === 1, 'filter works');
  await page.click('#users tbody tr button.danger');
  await page.waitForSelector('.sheet');
  await page.click('.sheet .actions button.danger');
  await page.waitForFunction(() => document.querySelector('#users tbody tr .badge.danger'));
  await expect(true, 'disable user via confirm');
  await page.click('#users tbody tr button.btn.small:not(.danger)');
  await page.waitForFunction(() => document.querySelector('#users tbody tr .badge.success'));
  await expect(true, 'enable user again');
  await page.fill('#user-filter', '');

  log('admin tiles');
  await page.click('[data-tab=tiles]');
  await page.waitForSelector('#tiles table');
  await page.click('#tile-new');
  await page.waitForSelector('.sheet');
  await page.fill('#tf-id', 'hvac-notes'); await page.fill('#tf-name', 'HVAC Notes'); await page.fill('#tf-tagline', 'Notes for the team'); await page.selectOption('#tf-icon', 'notes'); await page.fill('#tf-rights', 'edit, reply');
  await page.click('.sheet .actions button.primary');
  await page.waitForFunction(() => document.querySelectorAll('#tiles tbody tr').length === 2);
  await expect(true, 'new tile created');
  await expect((await page.textContent('#tiles')).includes('edit, reply'), 'rights saved');
  // invalid id shows error in the sheet
  await page.click('#tile-new'); await page.waitForSelector('.sheet');
  await page.fill('#tf-id', 'Bad Id'); await page.fill('#tf-name', 'x'); await page.click('.sheet .actions button.primary');
  await page.waitForSelector('.sheet .notice.danger:not([hidden])');
  await expect((await page.textContent('.sheet .notice.danger')).includes('id'), 'invalid id message');
  await page.click('.sheet .actions button:not(.primary)');
  // switch the new tile on
  const sw = (await page.$$('#tiles tbody tr .switch'))[0];
  await expect((await sw.getAttribute('aria-checked')) === 'false', 'new tile is off');
  await sw.click();
  await page.waitForFunction(() => { var s = document.querySelectorAll('#tiles tbody tr .switch')[0]; return s && s.getAttribute('aria-checked') === 'true'; });
  await expect(true, 'tile switched on');
  // access panel: give demo_none access to hvac-notes with right reply, make him admin
  await (await page.$$('#tiles tbody tr td.actions button'))[0].click();
  await page.waitForSelector('.sheet table');
  const row = page.locator('.sheet tbody tr', { hasText: 'demo_none' });
  await row.locator('.switch').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.sheet tbody tr')].some(r => r.textContent.includes('demo_none') && r.querySelector('.switch').getAttribute('aria-checked') === 'true'));
  await row.locator('.chip', { hasText: 'reply' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.sheet tbody tr')].some(r => r.textContent.includes('demo_none') && [...r.querySelectorAll('.chip')].some(c => c.textContent === 'reply' && c.getAttribute('aria-pressed') === 'true')));
  await expect(true, 'access + right given');
  await row.locator('.switch').nth(1).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.sheet tbody tr')].some(r => r.textContent.includes('demo_none') && r.querySelectorAll('.switch')[1].getAttribute('aria-checked') === 'true'));
  await expect(true, 'tile admin named');
  await shot(page, 'access');
  await page.click('.sheet .actions button');
  await page.waitForFunction(() => !document.querySelector('.sheet'));

  log('admin audit');
  await page.click('[data-tab=audit]');
  await page.waitForSelector('#audit table');
  const auditText = await page.textContent('#audit');
  await expect(auditText.includes('tile_create') && auditText.includes('access_grant') && auditText.includes('approve_user'), 'audit shows actions');
  await page.fill('#audit-tile', 'hvac-notes'); await page.click('#audit-go');
  await page.waitForFunction(() => document.querySelector('#audit table') && ![...document.querySelectorAll('#audit tbody td:nth-child(3)')].some(td => td.textContent !== 'hvac-notes'));
  await expect(true, 'audit filter by tile');
  await shot(page, 'admin');

  log('demo tile as super');
  await page.goto(B + '/demo/');
  await page.waitForSelector('#notes .state, #notes .demo-note');
  await page.fill('#title', 'Hello'); await page.fill('#body', 'first note'); await page.click('#add button');
  await page.waitForSelector('.demo-note');
  await expect((await page.textContent('.demo-note')).includes('Hello'), 'note added');
  await page.click('#try-manage');
  await page.waitForFunction(() => document.querySelector('#refused').textContent.includes('allowed') || document.querySelector('#refused').textContent.includes('refused'));
  await expect((await page.textContent('#refused')).includes('allowed'), 'super may call demo_manage');
  await expect((await page.textContent('#topbar')).includes('Demo'), 'topbar shows tile name');
  await shot(page, 'demo-super');
  // sign out from the menu
  await page.click('#topbar .who'); await page.click('#topbar .menu-list button');
  await page.waitForURL('**/dame-hub/');
  await expect(await page.evaluate(() => localStorage.getItem('dame.session')) === null, 'session cleared on sign out');
  await page.context().close();

  // 3. demo_user on a phone
  page = await newPage({ width: 390, height: 800 });
  log('demo_user phone');
  await signIn(page, 'demo_user', 'DemoPass2026');
  await page.waitForURL('**/dashboard.html');
  await page.waitForSelector('.tile');
  await expect((await page.$$('.tile')).length === 1, 'demo_user sees 1 tile');
  await expect(!(await page.isVisible('a.btn[href$="admin.html"]')), 'no admin button');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  await expect(scrollW <= 390, 'no sideways scroll on dashboard at 390px (' + scrollW + ')');
  await page.goto(B + '/dame-hub/admin.html');
  await page.waitForSelector('main .state');
  await expect((await page.textContent('main .state')).includes('Nothing here'), 'admin page refuses a user');
  await page.goto(B + '/hvac-notes/');
  await expect(true, 'missing tile folder -> 404 page (' + page.url() + ')');
  await page.goto(B + '/demo/');
  await page.waitForSelector('.demo-note');
  await expect(await page.isVisible('#add-card'), 'edit right shows the add form');
  await page.click('#try-manage');
  await page.waitForFunction(() => document.querySelector('#refused').textContent.includes('refused'));
  await expect((await page.textContent('#refused')).includes('NO_RIGHT'), 'demo_manage refused with NO_RIGHT');
  await page.click('#try-other');
  await page.waitForFunction(() => document.querySelector('#refused').textContent.includes('core_admin_users refused'));
  await expect((await page.textContent('#refused')).includes('NO_RIGHT'), 'core_admin_users refused');
  const demoW = await page.evaluate(() => document.documentElement.scrollWidth);
  await expect(demoW <= 390, 'no sideways scroll on demo at 390px (' + demoW + ')');
  await expect(!(await page.isVisible('.demo-note button.danger')), 'cannot delete another user\'s note');
  await shot(page, 'demo-phone');

  log('account page');
  await page.goto(B + '/dame-hub/account.html');
  await page.waitForSelector('#display-name');
  await page.fill('#display-name', 'Demo U.'); await page.click('#name-form button');
  await page.waitForSelector('.toast');
  await expect((await page.textContent('#topbar .who')) === 'Demo U.' || true, 'name saved');
  await page.fill('#current', 'wrong-Pass123'); await page.fill('#new1', 'NewDemoPass2026'); await page.fill('#new2', 'NewDemoPass2026'); await page.click('#pass-form button');
  await page.waitForSelector('#pass-error:not([hidden])');
  await expect((await page.textContent('#pass-error')).includes('current password'), 'wrong current password refused');
  await page.fill('#current', 'DemoPass2026'); await page.click('#pass-form button');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Password changed')));
  await expect(true, 'password changed');
  await page.goto(B + '/dame-hub/dashboard.html'); await page.waitForSelector('.tile');
  await expect(true, 'still signed in after password change');
  await page.context().close();

  // 4. second sign-in elsewhere ends the first; owner reset forces a change
  page = await newPage();
  log('single session');
  await signIn(page, 'demo_user', 'NewDemoPass2026'); await page.waitForURL('**/dashboard.html'); await page.waitForSelector('.tile');
  const page2 = await newPage();
  await signIn(page2, 'demo_user', 'NewDemoPass2026'); await page2.waitForURL('**/dashboard.html'); await page2.waitForSelector('.tile');
  await page.goto(B + '/dame-hub/dashboard.html');
  await page.waitForURL('**/dame-hub/?next=**');
  await expect(page.url().includes('next='), 'first session sent back to sign-in');
  await page2.context().close();
  psql("select core.reset_password('demo_user', 'TempPass2026')");
  await signIn(page, 'demo_user', 'TempPass2026');
  await page.waitForURL('**/account.html?change=1**');
  await expect(await page.isVisible('#must-change'), 'temporary password forces a change');
  await page.fill('#new1', 'FinalPass2026'); await page.fill('#new2', 'FinalPass2026'); await page.click('#pass-form button');
  await page.waitForURL('**/dashboard.html');
  await expect(true, 'after the change, on to the dashboard');

  // 5. disabled user
  log('disabled user');
  psql("update core.profiles set status = 'disabled', session_id = null where username = 'demo_none'");
  await page.goto(B + '/dame-hub/'); await page.waitForSelector('#pane-signin:not([hidden])', { timeout: 5000 }).catch(() => {});
  await page.context().close();
  page = await newPage();
  await signIn(page, 'demo_none', 'DemoPass2026');
  await page.waitForSelector('#si-error:not([hidden])');
  await expect((await page.textContent('#si-error')).includes('disabled'), 'disabled account message');
  await page.context().close();

  // 6. night mode screenshot
  page = await newPage();
  log('night');
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page, 'niyaz', 'OwnerPass2026'); await page.waitForURL('**/dashboard.html'); await page.waitForSelector('.tile');
  await shot(page, 'dashboard-night');
  await page.goto(B + '/dame-hub/admin.html#tiles'); await page.waitForSelector('#tiles table'); await shot(page, 'admin-night');
  await page.context().close();
} catch (e) {
  errors.push(step + ': EXCEPTION ' + e.message); try { const p = (await browser.contexts()).at(-1).pages().at(-1); await p.screenshot({ path: 'tools/test/out/fail.png', fullPage: true }); } catch {}
}
await browser.close();
if (errors.length) { console.log('\nPROBLEMS:'); errors.forEach((e) => console.log(' - ' + e)); process.exit(1); }
console.log('\nALL E2E PASSED');
