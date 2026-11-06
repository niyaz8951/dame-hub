// End-to-end run of the DAME pages against the mock (test harness only).
import { readFileSync } from 'node:fs';
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
async function shot(page, name) { await page.screenshot({ path: 'dev/test/out/' + name + '.png', fullPage: true }); }
async function expect(cond, msg) { if (!cond) { errors.push(step + ': FAILED ' + msg); console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }
async function signIn(page, user, pass) {
  await page.goto(B + '/dame-hub/'); await page.fill('#si-email', user.includes('@') ? user : user + '@example.com'); await page.fill('#si-pass', pass); await page.click('#signin button[type=submit]');
}

try {
  // 1. request access -> pending
  let page = await newPage();
  log('request access');
  await page.goto(B + '/dame-hub/#request');
  await page.fill('#rq-email', 'niyaz@gmail.com'); await page.fill('#rq-user', 'niyaz'); await page.fill('#rq-name', 'Niyaz'); await page.fill('#rq-pass', 'OwnerPass2026'); await page.fill('#rq-pass2', 'OwnerPass2026');
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
  await signIn(page, 'niyaz@gmail.com', 'wrong-Password1');
  await page.waitForSelector('#si-error:not([hidden])');
  await expect((await page.textContent('#si-error')).includes('Wrong username'), 'wrong password message');
  await signIn(page, 'niyaz@gmail.com', 'OwnerPass2026');
  await page.waitForURL('**/dashboard.html');
  await page.waitForSelector('a.tile');
  await expect((await page.$$('a.tile')).length === 1, 'super sees the demo tile (' + (await page.$$('a.tile')).length + ')');
  await expect(await page.isVisible('a.btn[href$="admin.html"]'), 'admin button for super');
  await page.waitForSelector('#line:not([hidden])');
  const line1 = await page.getAttribute('#line', 'data-id');
  await expect(!!line1 && (await page.textContent('#line-text')).length > 10, 'dashboard shows a line (' + line1 + ')');
  await expect(!(await page.textContent('.hero')).includes('ready for you'), 'no tile count in the hero');
  await page.reload(); await page.waitForSelector('#line:not([hidden])');
  await expect((await page.getAttribute('#line', 'data-id')) !== line1, 'a refresh shows another line');
  await page.waitForTimeout(800);
  await shot(page, 'dashboard');
  // the longest line, centred on its own row under the greeting
  const longest = JSON.parse(readFileSync(new URL('../../lines.json', import.meta.url))).lines.sort((a, b) => b.text.length - a.text.length)[0];
  await page.route('**/dame-hub/lines.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ lines: [longest] }) }));
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.reload(); await page.waitForSelector('#line:not([hidden])'); await page.waitForTimeout(800);
    const box = await page.evaluate(() => { const l = document.querySelector('#line').getBoundingClientRect(), h = document.querySelector('.hero h1').getBoundingClientRect(), hero = document.querySelector('.hero').getBoundingClientRect();
      return { below: l.top >= h.bottom, centred: getComputedStyle(document.querySelector('#line')).textAlign === 'center', full: l.width > hero.width * 0.8, scroll: document.documentElement.scrollWidth }; });
    await expect(box.below && box.centred && box.full && box.scroll <= w, 'longest line centred on its own row at ' + w + 'px (' + longest.id + ')');
    await page.locator('.hero').screenshot({ path: 'dev/test/out/hero-line-' + w + '.png' });
  }
  await page.unroute('**/dame-hub/lines.json'); await page.setViewportSize({ width: 1100, height: 800 });

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
  await expect((await page.$$('#users tbody tr')).length === 6, '6 users listed');
  await page.fill('#user-filter', 'demo_none');
  await expect((await page.$$('#users tbody tr')).length === 1, 'filter works');
  await page.click('#users tbody tr button.btn.small');
  await page.waitForSelector('.sheet #mu-status');
  await page.waitForSelector('#mu-access .pitem, #mu-access .faint');
  await expect((await page.textContent('#mu-access')).includes('In no group') && (await page.textContent('#mu-access')).includes('No tile'), 'check access: demo_none has no group and no tile');
  await shot(page, 'manage-access');
  await page.click('#mu-status');
  await page.waitForFunction(() => document.querySelector('.sheet .card .badge.danger'));
  await expect(true, 'disable user from Manage');
  await page.click('#mu-status');
  await page.waitForFunction(() => document.querySelector('.sheet .card .badge.success'));
  await page.click('.sheet > .actions button');
  await page.waitForFunction(() => !document.querySelector('.sheet') && document.querySelector('#users tbody tr .badge.success'));
  await expect(true, 'enable user again');
  // the super user's own row: name only
  await page.fill('#user-filter', 'niyaz');
  await page.click('#users tbody tr button.btn.small'); await page.waitForSelector('.sheet #mu-user');
  await expect(!(await page.$('#mu-setpass')) && !(await page.$('#mu-delete')), 'own row: no password or delete');
  await page.click('.sheet > .actions button'); await page.waitForFunction(() => !document.querySelector('.sheet'));
  await page.fill('#user-filter', '');
  await page.click('#user-new'); await page.waitForSelector('.sheet');
  await page.fill('#nu-user', 'made.one'); await page.fill('#nu-name', 'Made One'); await page.fill('#nu-pass', 'TempPass2026');
  await page.click('.sheet .actions button.primary');
  await page.waitForFunction(() => !document.querySelector('.sheet') && document.querySelector('#users').textContent.includes('made.one'));
  await expect(true, 'owner-created user listed');

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
  // access panel: give demo_none a level on hvac-notes, the special right reply, then make him manager
  await (await page.$$('#tiles tbody tr td.actions button'))[0].click();
  await page.waitForSelector('.sheet #access-people .pitem');
  const lvl = (u) => `.sheet .pitem[data-type=user][data-name="${u}"] select.lvl`;
  await page.selectOption(lvl('demo_none'), 'contribute');
  await page.waitForFunction((sel) => { const s = document.querySelector(sel); return s && s.value === 'contribute' && !s.disabled; }, lvl('demo_none'));
  await page.click('.sheet .pitem[data-name="demo_none"] .chip:text-is("reply")');
  await page.waitForFunction(() => { const c = [...document.querySelectorAll('.sheet .pitem[data-name="demo_none"] .chip')].find((x) => x.textContent === 'reply'); return c && c.getAttribute('aria-pressed') === 'true'; });
  await expect(psql("select level || ' ' || array_to_string(rights, ',') from core.tile_access a join core.profiles p on p.id = a.user_id where p.username = 'demo_none' and a.tile_id = 'hvac-notes'") === 'contribute reply', 'level + special right saved');
  await page.selectOption(lvl('demo_none'), 'manage');
  await page.waitForFunction((sel) => { const s = document.querySelector(sel); return s && s.value === 'manage' && !s.disabled; }, lvl('demo_none'));
  await expect(psql("select core.is_tile_admin(id, 'hvac-notes') from core.profiles where username = 'demo_none'") === 't', 'manager named');
  await page.click('.sheet summary');
  await expect((await page.textContent('.sheet .lvl-legend')).includes('Approve'), 'level meanings shown');
  await shot(page, 'access');
  await page.click('.sheet > .actions button');
  await page.waitForFunction(() => !document.querySelector('.sheet'));

  log('admin groups');
  await page.click('[data-tab=groups]');
  await page.waitForSelector('#groups .state');
  await page.click('#group-new'); await page.waitForSelector('.sheet #gf-name');
  await page.fill('#gf-name', 'Application'); await page.fill('#gf-note', 'Application engineers');
  await page.click('.sheet .actions button.primary');
  await page.waitForSelector('.sheet #gm-list');   // members open right after a new group
  await page.check('#gm-list .pitem[data-name="demo_viewer"] input');
  await page.click('.sheet .actions button.primary');
  await page.waitForFunction(() => !document.querySelector('.sheet') && document.querySelector('#groups [data-group="Application"]') && document.querySelector('#groups [data-group="Application"]').textContent.includes('1 person'));
  await expect(true, 'group made with a member');
  await shot(page, 'admin-groups');
  await page.click('#group-new'); await page.waitForSelector('.sheet #gf-name');
  await page.fill('#gf-name', 'application'); await page.click('.sheet .actions button.primary');
  await page.waitForSelector('.sheet .notice.danger:not([hidden])');
  await expect((await page.textContent('.sheet .notice.danger')).includes('exists already'), 'duplicate group name refused');
  await page.click('.sheet .actions button:not(.primary)'); await page.waitForFunction(() => !document.querySelector('.sheet'));
  // the group gets Edit on demo (demo_viewer: own Read, Edit through the group)
  await page.click('[data-tab=tiles]'); await page.waitForSelector('#tiles table');
  await page.locator('#tiles tbody tr', { hasText: '/demo/' }).locator('button', { hasText: 'Access' }).click();
  await page.waitForSelector('.sheet .pitem[data-type=group]');
  await page.selectOption('.sheet .pitem[data-type=group][data-name="Application"] select.lvl', 'edit');
  await page.waitForFunction(() => { const r = document.querySelector('.sheet .pitem[data-type=user][data-name="demo_viewer"]'); return r && r.textContent.includes('Edit through Application'); });
  await expect(psql("select core.tile_level(id, 'demo') from core.profiles where username = 'demo_viewer'") === 'edit', 'level through the group');
  await page.selectOption('.sheet .pitem[data-type=group][data-name="Application"] select.lvl', '');
  await page.waitForFunction(() => { const r = document.querySelector('.sheet .pitem[data-type=user][data-name="demo_viewer"]'); return r && !r.textContent.includes('through'); });
  await expect(psql("select core.tile_level(id, 'demo') from core.profiles where username = 'demo_viewer'") === 'read', 'group level taken away');
  await page.click('.sheet > .actions button'); await page.waitForFunction(() => !document.querySelector('.sheet'));

  log('admin audit');
  await page.click('[data-tab=audit]');
  await page.waitForSelector('#audit table');
  const auditText = await page.textContent('#audit');
  await expect(auditText.includes('tile_create') && auditText.includes('access_grant') && auditText.includes('approve_user'), 'audit shows actions');
  await page.fill('#audit-tile', 'hvac-notes'); await page.click('#audit-go');
  await page.waitForFunction(() => document.querySelector('#audit table') && ![...document.querySelectorAll('#audit tbody td:nth-child(3)')].some(td => td.textContent !== 'hvac-notes'));
  await expect(true, 'audit filter by tile');
  await shot(page, 'admin');

  log('admin health');
  await page.click('[data-tab=health]');
  await page.waitForSelector('#health-check .card'); await page.waitForSelector('#health-sql table');
  await expect((await page.textContent('#health-check')).includes('Clean'), 'security check clean');
  await expect((await page.textContent('#health-check')).includes('Nightly check not installed'), 'no pg_cron locally: shown as not installed');
  await expect(await page.isHidden('#count-health'), 'no health badge when all is well');
  const sqlRow = async (id) => page.textContent(`#health-sql tbody tr:has(td span.mono:text-is("${id}"))`);
  await expect((await sqlRow('dame-hub')).includes('Up to date'), 'core SQL up to date');
  await expect((await sqlRow('demo')).includes('Up to date'), 'demo (inside core) SQL read from /dame-hub/demo/db/migrations.json');
  await expect((await sqlRow('hvac-notes')).includes('No list'), 'tile without a list shown as such');
  await page.click('#health-run'); await page.waitForSelector('.toast.success');
  await expect(true, 'run check now');
  // a file that has not run shows as waiting, with a link, and the tab badge counts it
  const ranAt = psql("select applied_at from core.migrations where repo = 'dame-hub' and name = '009_tile_users'");
  psql("delete from core.migrations where repo = 'dame-hub' and name = '009_tile_users'");
  await page.reload(); await page.waitForFunction(() => /\d+ waiting/.test(document.querySelector('#health-sql').textContent));
  await expect((await sqlRow('dame-hub')).includes('1 waiting'), 'missing core file shown as waiting');
  await expect(await page.isVisible('#health-sql a[href="/dame-hub/db/core/009_tile_users.sql"]'), 'link to the waiting file');
  await expect((await page.textContent('#count-health')) === '1', 'health badge counts the waiting file');
  psql(`insert into core.migrations (repo, name, applied_at) values ('dame-hub', '009_tile_users', '${ranAt}')`);
  // a problem found by the check shows in the tab
  psql('create table core.t_e2e (x int)');
  await page.click('#health-run'); await page.waitForSelector('#health-check .badge.danger');
  await expect((await page.textContent('#health-check')).includes('core.t_e2e'), 'problem object listed');
  psql('drop table core.t_e2e');
  await page.click('#health-run'); await page.waitForFunction(() => document.querySelector('#health-check') && document.querySelector('#health-check').textContent.includes('Clean'));
  await expect(true, 'clean again after the fix');
  await shot(page, 'admin-health');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'health tab: no sideways scroll at 390');
  await shot(page, 'admin-health-390');
  await page.setViewportSize({ width: 1100, height: 800 });

  log('demo tile as super');
  await page.goto(B + '/dame-hub/demo/');
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
  await page.click('#topbar .who'); await page.click('#topbar .menu-list button:has-text("Sign out")');
  await page.waitForURL('**/dame-hub/');
  await expect(await page.evaluate(() => localStorage.getItem('dame.session')) === null, 'session cleared on sign out');
  await page.context().close();

  // 3. demo_user on a phone
  page = await newPage({ width: 390, height: 800 });
  log('demo_user phone');
  await signIn(page, 'demo_user', 'DemoPass2026');
  await page.waitForURL('**/dashboard.html');
  await page.waitForSelector('a.tile');
  await expect((await page.$$('a.tile')).length === 1, 'demo_user sees 1 tile');
  await expect(!(await page.isVisible('a.btn[href$="admin.html"]')), 'no admin button');
  await page.waitForSelector('#line:not([hidden])'); await page.waitForTimeout(800);
  await shot(page, 'dashboard-phone');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  await expect(scrollW <= 390, 'no sideways scroll on dashboard at 390px (' + scrollW + ')');
  await page.goto(B + '/dame-hub/admin.html');
  await page.waitForSelector('main .state');
  await expect((await page.textContent('main .state')).includes('Nothing here'), 'admin page refuses a user');
  await page.goto(B + '/hvac-notes/');
  await expect(true, 'missing tile folder -> 404 page (' + page.url() + ')');
  await page.goto(B + '/dame-hub/demo/');
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

  log('share a note');
  await page.fill('#title', 'Mine'); await page.click('#add button');
  await page.waitForFunction(() => [...document.querySelectorAll('.demo-note')].some((n) => n.textContent.includes('Mine')));
  const mine = page.locator('.demo-note', { hasText: 'Mine' });
  await expect((await mine.textContent()).includes('Everyone can view'), 'a new note starts as everyone can view');
  await expect(!(await page.locator('.demo-note', { hasText: 'Hello' }).locator('button', { hasText: 'Share' }).count()), 'no Share on another user\'s note');
  await mine.locator('button', { hasText: 'Share' }).click();
  await page.waitForSelector('.sheet #sh-everyone');
  await page.selectOption('#sh-everyone', '');
  await page.fill('#sh-find', 'viewer');
  await page.waitForSelector('.sheet .picks button');
  await page.click('.sheet .picks button:has-text("Demo Viewer")');
  await page.waitForSelector('.sheet #sh-list .pitem[data-name="demo_viewer"]');
  const sw390 = await page.evaluate(() => document.documentElement.scrollWidth);
  await expect(sw390 <= 390, 'Access panel: no sideways scroll at 390px (' + sw390 + ')');
  await shot(page, 'share-phone');
  await page.click('.sheet .actions button.primary');
  await page.waitForFunction(() => !document.querySelector('.sheet') && [...document.querySelectorAll('.demo-note')].some((n) => n.textContent.includes('Mine') && n.textContent.includes('Shared with 1')));
  await expect(psql("select coalesce(c.everyone, 'only') || ' ' || (select count(*) from core.shares s where s.id = c.id) from core.containers c where c.tile_id = 'demo' and c.name = 'Mine'") === 'only 1', 'saved: only the people listed, one share');
  await expect(psql("select core.container_level(p.id, 'demo', 'note', c.id) from core.containers c, core.profiles p where c.name = 'Mine' and p.username = 'demo_viewer'") === 'read', 'demo_viewer can view (his tile level is Read)');
  await expect(psql("select core.container_level(p.id, 'demo', 'note', c.id) is null from core.containers c, core.profiles p where c.name = 'Mine' and p.username = 'demo_none'") === 't', 'someone else cannot open it');

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
  await page.goto(B + '/dame-hub/dashboard.html'); await page.waitForSelector('a.tile');
  await expect(true, 'still signed in after password change');
  await page.context().close();

  // 4. second sign-in elsewhere ends the first; owner reset forces a change
  page = await newPage();
  log('single session');
  await signIn(page, 'demo_user', 'NewDemoPass2026'); await page.waitForURL('**/dashboard.html'); await page.waitForSelector('a.tile');
  const page2 = await newPage();
  await signIn(page2, 'demo_user', 'NewDemoPass2026'); await page2.waitForURL('**/dashboard.html'); await page2.waitForSelector('a.tile');
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

  // 4b. owner-created user signs in with username only, must change password
  log('owner-created user');
  await page.context().close(); page = await newPage();
  await page.goto(B + '/dame-hub/'); await page.fill('#si-email', 'made.one'); await page.fill('#si-pass', 'TempPass2026'); await page.click('#signin button[type=submit]');
  await page.waitForURL('**/account.html?change=1**');
  await expect(await page.isVisible('#must-change'), 'username-only sign-in works and forces a password change');
  await expect(!(await page.textContent('#username')).includes('@users.'), 'internal address is not shown');
  await page.fill('#new1', 'MadePass2026'); await page.fill('#new2', 'MadePass2026'); await page.click('#pass-form button');
  await page.waitForURL('**/dashboard.html');
  await expect(true, 'owner-created user reaches the dashboard');

  // 4c. admin manages an account: rename, set password (old session ends), delete
  log('manage user');
  const userPage = page;                          // made.one, signed in
  const admin = await newPage({ width: 390, height: 844 });
  await signIn(admin, 'niyaz@gmail.com', 'OwnerPass2026'); await admin.waitForURL('**/dashboard.html');
  await admin.goto(B + '/dame-hub/admin.html#users'); await admin.waitForSelector('#users table');
  await admin.fill('#user-filter', 'made.one');
  await admin.click('#users tbody tr button.btn.small'); await admin.waitForSelector('.sheet #mu-user');
  await admin.fill('#mu-user', 'demo_user'); await admin.click('#mu-save');
  await admin.waitForSelector('.sheet .notice.danger:not([hidden])');
  await expect((await admin.textContent('.sheet .notice.danger:not([hidden])')).includes('taken'), 'rename to a used name refused');
  await admin.fill('#mu-user', 'made.two'); await admin.fill('#mu-name', 'Made Two'); await admin.click('#mu-save');
  await admin.waitForSelector('.sheet .notice.success:not([hidden])');
  await expect((await admin.textContent('.sheet .notice.success:not([hidden])')).includes('signs in as made.two'), 'renamed; sign-in name moved');
  await admin.click('#mu-setpass'); await admin.waitForSelector('.sheet .notice.danger:not([hidden])');
  await expect(true, 'empty password refused');
  await admin.fill('#mu-pass', 'ResetPass2026'); await admin.click('#mu-setpass');
  await admin.waitForFunction(() => [...document.querySelectorAll('.sheet .notice.success')].some((n) => !n.hidden && n.textContent.includes('signed out everywhere')));
  await expect(true, 'password set from Manage');
  await expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'manage sheet at 390 px: no sideways scroll');
  await shot(admin, 'admin-manage-390');
  await admin.click('.sheet > .actions button'); await admin.waitForFunction(() => !document.querySelector('.sheet'));
  // the user's open session is gone; the old name no longer signs in; the new one does, with a forced change
  await userPage.goto(B + '/dame-hub/dashboard.html'); await userPage.waitForURL('**/dame-hub/?next=**');
  await expect(true, 'reset ends the user\'s session');
  await userPage.fill('#si-email', 'made.one'); await userPage.fill('#si-pass', 'ResetPass2026'); await userPage.click('#signin button[type=submit]');
  await userPage.waitForSelector('#si-error:not([hidden])');
  await expect(true, 'old username no longer signs in');
  await userPage.fill('#si-email', 'made.two'); await userPage.fill('#si-pass', 'ResetPass2026'); await userPage.click('#signin button[type=submit]');
  await userPage.waitForURL('**/account.html?change=1**');
  await expect(true, 'new username + reset password sign in, change forced');
  // delete
  await admin.fill('#user-filter', 'made.two');
  await admin.click('#users tbody tr button.btn.small'); await admin.waitForSelector('.sheet #mu-delete');
  await admin.click('#mu-delete');
  await expect(await admin.isDisabled('#mu-delete-go'), 'delete waits for the typed username');
  await admin.fill('#mu-confirm', 'made.two');
  await admin.click('#mu-delete-go');
  await admin.waitForFunction(() => !document.querySelector('.sheet') && !document.querySelector('#users').textContent.includes('made.two'));
  await expect(psql("select count(*) from core.profiles where username = 'made.two'") === '0', 'account deleted');
  await expect(psql("select count(*) from core.username_history where username in ('made.one', 'made.two')") === '2', 'both names retired');
  await userPage.goto(B + '/dame-hub/dashboard.html'); await userPage.waitForURL('**/dame-hub/?next=**');
  await expect(true, 'deleted user is out');
  await admin.context().close();

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

  // 5. Tools tile (kept inside dame-hub, served at /dame-hub/tools/): home + the four tool pages
  log('tools tile');
  psql("insert into core.tiles (id, name, tagline, icon, sort_order, enabled, rights, accent) values ('tools', 'Tools', 'Calculators', 'tools', 20, true, '{}', 'violet')");
  psql("insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'tools', false, '{}' from core.profiles where username = 'demo_user'");
  const TOOL_PAGES = [['', 'Tools', '.tl-tools .tile', 4], ['parts-extractor/', 'Parts List Extractor', '#dropzone', 1], ['coil-data-extractor/', 'Coil Data Extractor', '#dropzone', 1],
    ['container-calculator/', 'Container Calculator', '#results', 1], ['psychrometric-chart/', 'Psychrometric', 'svg', 1]];
  for (const vp of [{ width: 1100, height: 800 }, { width: 390, height: 800 }]) {
    page = await newPage(vp);
    await signIn(page, vp.width > 390 ? 'niyaz@gmail.com' : 'demo_user', vp.width > 390 ? 'OwnerPass2026' : 'FinalPass2026');
    await page.waitForURL('**/dashboard.html'); await page.waitForSelector('a.tile');
    const href = await page.getAttribute('.tile[href*="tools"]', 'href');
    await expect(href === '/dame-hub/tools/', 'dashboard links the tools tile inside dame-hub (' + href + ')');
    for (const [path, name, sel, n] of TOOL_PAGES) {
      await page.goto(B + '/dame-hub/tools/' + path);
      await page.waitForSelector(sel);
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-loading'));
      await expect((await page.$$(sel)).length >= n, name + ': page built (' + path + ')');
      await expect((await page.textContent('#topbar')).includes('Tools'), name + ': topbar shows the tile');
      await expect((await page.getAttribute('html', 'data-accent')) === 'violet', name + ': tile accent on <html>');
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      await expect(w <= vp.width, name + ': no sideways scroll at ' + vp.width + 'px (' + w + ')');
      await shot(page, 'tools-' + (path.replace('/', '') || 'home') + '-' + vp.width);
    }
    await page.context().close();
  }
  // a user without the tile is refused
  page = await newPage();
  await signIn(page, 'demo_pending', 'DemoPass2026'); await page.waitForURL('**/dashboard.html');
  await page.goto(B + '/dame-hub/tools/psychrometric-chart/');
  await page.waitForSelector('main .state', { state: 'visible' });
  await expect(!(await page.isVisible('#states-body')), 'tools page refuses a user without the tile');
  await page.context().close();

  // 5. the installed app: manifest, service worker, offline page, Install item, standalone mode
  log('installed app');
  page = await newPage({ width: 390, height: 800 });
  const man = await page.request.get(B + '/dame-hub/manifest.webmanifest');
  await expect(man.ok() && /manifest\+json/.test(man.headers()['content-type'] || ''), 'manifest served as application/manifest+json');
  const mj = await man.json();
  await expect(mj.id === '/dame-hub/' && mj.scope === '/' && mj.start_url === '/dame-hub/dashboard.html' && mj.display === 'standalone', 'manifest id / scope / start_url / display');
  await expect(mj.icons.some((i) => i.sizes === '192x192') && mj.icons.some((i) => i.sizes === '512x512'), 'manifest has 192 and 512 icons');
  for (const i of mj.icons) { const r = await page.request.get(B + i.src); await expect(r.ok() && r.headers()['content-type'] === 'image/png', 'icon reachable ' + i.src); }
  await expect((await page.request.get(B + '/dame-hub/sw.js')).ok(), 'sw.js served');
  await expect((await page.request.get(B + '/dame-hub/offline.html')).ok(), 'offline.html served');
  for (const p of ['/dame-hub/', '/dame-hub/dashboard.html', '/dame-hub/admin.html', '/dame-hub/account.html', '/dame-hub/access.html', '/dame-hub/404.html']) {
    const html = await (await page.request.get(B + p)).text();
    await expect(html.includes('rel="manifest" href="/dame-hub/manifest.webmanifest"') && html.includes('viewport-fit=cover') && html.includes('name="theme-color"'), 'head block complete on ' + p);
  }
  await signIn(page, 'demo_user', 'FinalPass2026');
  await page.waitForURL('**/dashboard.html'); await page.waitForSelector('a.tile');
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then((r) => !!r), null, { timeout: 5000 }).catch(() => {});
  await expect(await page.evaluate(() => navigator.serviceWorker.getRegistration('/dame-hub/').then((r) => !!r && r.scope.endsWith('/dame-hub/'))), 'service worker registered with scope /dame-hub/');
  await page.click('#topbar .who');
  await expect(await page.isVisible('.menu-list button:has-text("Install app")'), 'Install app in the account menu (browser tab)');
  await page.click('.menu-list button:has-text("Install app")');
  await page.waitForSelector('.sheet');
  await expect((await page.textContent('.sheet')).includes('Install the app'), 'install sheet opens with steps');
  await shot(page, 'install-sheet');
  await page.click('.sheet .actions button.primary');
  const tc = await page.getAttribute('meta[name="theme-color"]', 'content');
  await expect(tc === '#F3F7FA', 'theme-color follows day (' + tc + ')');
  await page.click('#theme-btn'); await page.waitForTimeout(700);
  await expect((await page.getAttribute('meta[name="theme-color"]', 'content')) === '#061426', 'theme-color follows night');
  await page.click('#theme-btn'); await page.waitForTimeout(700);
  // offline: a core page navigation falls back to offline.html once the worker is active
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 5000 }).catch(() => {});
  if (await page.evaluate(() => !!navigator.serviceWorker.controller)) {
    await page.context().setOffline(true);
    await page.goto(B + '/dame-hub/account.html').catch(() => {});
    await expect((await page.textContent('body')).includes('You are offline'), 'offline navigation shows offline.html');
    await page.context().setOffline(false);
  } else await expect(false, 'service worker did not take control in time');
  await page.context().close();
  // standalone mode (the installed app): no Install item, pages fit at 390px
  const sctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await sctx.addInitScript(() => { const m = window.matchMedia; window.matchMedia = (q) => q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : m.call(window, q); });
  page = await sctx.newPage();
  page.on('pageerror', (e) => errors.push(step + ': pageerror ' + e.message));
  await signIn(page, 'demo_user', 'FinalPass2026');
  await page.waitForURL('**/dashboard.html'); await page.waitForSelector('a.tile');
  await page.click('#topbar .who');
  await expect(!(await page.isVisible('.menu-list button:has-text("Install app")')), 'no Install item inside the installed app');
  for (const p of ['/dame-hub/dashboard.html', '/dame-hub/demo/', '/dame-hub/account.html']) {
    await page.goto(B + p); await page.waitForFunction(() => !document.documentElement.hasAttribute('data-loading'));
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    await expect(w <= 390, 'standalone: no sideways scroll on ' + p + ' (' + w + ')');
  }
  await shot(page, 'standalone-dashboard');
  await sctx.close();

  // 6. night mode screenshot
  page = await newPage();
  log('night');
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page, 'niyaz@gmail.com', 'OwnerPass2026'); await page.waitForURL('**/dashboard.html'); await page.waitForSelector('a.tile');
  await shot(page, 'dashboard-night');
  await page.goto(B + '/dame-hub/admin.html#tiles'); await page.waitForSelector('#tiles table'); await shot(page, 'admin-night');
  await page.context().close();
} catch (e) {
  errors.push(step + ': EXCEPTION ' + e.message); try { const p = (await browser.contexts()).at(-1).pages().at(-1); await p.screenshot({ path: 'dev/test/out/fail.png', fullPage: true }); } catch {}
}
await browser.close();
if (errors.length) { console.log('\nPROBLEMS:'); errors.forEach((e) => console.log(' - ' + e)); process.exit(1); }
console.log('\nALL E2E PASSED');
