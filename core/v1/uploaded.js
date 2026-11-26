/* DAME core: the shell of an uploaded tile (docs/BLUEPRINT.md section 6, docs/STANDARDS.md section 13). tile-upload
   writes one small page, index.html, into the tile's folder; it loads this file. The shell:
   1. checks the user: signed in, approved, has the tile (a preview under _next/: the tile's managers only);
   2. shows the DAME bar (home, tile, Files for managers);
   3. loads the tool's page (stored as <page>.txt, never as HTML) into a SEALED frame: sandboxed, without an origin,
      so the uploaded code cannot read the session, this page, the site's storage or any outside address;
   4. answers the frame's messages (core/v1/sealed.js): the data service, the tool's localStorage, page changes,
      downloads. Every answer comes from the database with the user's own session; the frame never sees a token. */
(function () {
  'use strict';
  var cfg = window.DAME_CONFIG, CORE = cfg.CORE, doc = document;
  var meta = doc.querySelector('meta[name="dame-tile"]');
  var tile = meta ? meta.getAttribute('content') : '';
  var parts = window.location.pathname.split('/');            // ['', 'dame-hub', '<tile>', ('_next'), ...]
  var pathTile = '/' + parts[1] === CORE ? parts[2] : '';
  var preview = parts[3] === '_next';
  var base = CORE + '/' + tile + '/' + (preview ? '_next/' : '');
  var BOOT_MARK = '<!--DAME-BOOT-->';
  var SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads';   // never allow-same-origin, popups or top navigation
  var me = null, frame = null, tileName = '';

  function el(tag, attrs, text) {
    var n = doc.createElement(tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }
  function night() {
    var t = 'auto';
    try { t = localStorage.getItem(cfg.THEME_KEY) || 'auto'; } catch (e) {}
    if (t === 'night') return true;
    if (t === 'day') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function gate(title, text, link) {
    var old = doc.getElementById('up-gate'); if (old) old.parentNode.removeChild(old);
    if (frame) { frame.parentNode.removeChild(frame); frame = null; }
    var box = el('div', { id: 'up-gate', role: 'alert', 'class': night() ? 'night' : '' });
    box.appendChild(el('h2', null, title));
    box.appendChild(el('p', null, text));
    box.appendChild(el('a', { href: link ? link.href : CORE + '/dashboard.html' }, link ? link.label : 'Dashboard'));
    doc.body.appendChild(box);
  }
  function bar() {
    var b = el('div', { id: 'up-bar', 'class': night() ? 'night' : '', role: 'navigation', 'aria-label': cfg.SITE_NAME });
    var home = el('a', { 'class': 'up-home', href: CORE + '/dashboard.html', 'aria-label': cfg.SITE_NAME + ' dashboard' });
    home.appendChild(el('img', { src: CORE + '/core/v1/icons/mark.svg', alt: '', width: '20', height: '20' }));
    home.appendChild(el('span', null, cfg.SITE_NAME));
    b.appendChild(home);
    b.appendChild(el('span', { 'class': 'up-sep', 'aria-hidden': 'true' }, '/'));
    b.appendChild(el('span', { 'class': 'up-here' }, tileName));
    if (preview) b.appendChild(el('span', { 'class': 'up-badge' }, 'Preview, not live'));
    b.appendChild(el('span', { 'class': 'up-grow' }));
    if (me.is_super || me.level === 'manage') b.appendChild(el('a', { 'class': 'up-link', href: CORE + '/upload.html?tile=' + encodeURIComponent(tile) }, preview ? 'Back to Files' : 'Files'));
    doc.body.insertBefore(b, doc.body.firstChild);
  }
  var toastTimer = null;
  function toast(text) {
    var t = doc.getElementById('up-toast') || doc.body.appendChild(el('div', { id: 'up-toast', role: 'status' }));
    t.textContent = String(text).slice(0, 200); t.className = 'show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3500);
  }
  function toLogin() {
    Api.auth.clear();
    window.location.assign(CORE + '/?next=' + encodeURIComponent(window.location.pathname + window.location.search));
  }

  // ---------- the tool's pages ----------
  function pageFromHash() {
    var p = decodeURIComponent(window.location.hash.replace(/^#/, '')) || 'index.html';
    return /^[A-Za-z0-9 ._()@+\/-]{1,300}\.html?$/.test(p) && p.indexOf('..') < 0 && p[0] !== '/' && p.indexOf('//') < 0 ? p : null;
  }
  // An address inside this tile's folder -> the page path, or null.
  function pageOf(href) {
    var u; try { u = new URL(href, window.location.href); } catch (e) { return null; }
    if (u.origin !== window.location.origin || u.pathname.indexOf(base) !== 0) return null;
    var p = decodeURIComponent(u.pathname.slice(base.length)) || 'index.html';
    if (/\/$/.test(p)) p += 'index.html';
    return /\.html?$/.test(p) ? p : null;
  }
  function data(op, a) {
    var common = { p_tile: tile, p_collection: a.collection, p_mine: !!a.mine, p_preview: preview };
    if (op === 'get') return Api.rpc('core_data_get', Object.assign({ p_id: a.id }, common));
    if (op === 'list') return Api.rpc('core_data_list', Object.assign({ p_limit: a.limit || 500, p_after: a.after || null }, common));
    if (op === 'put') return Api.rpc('core_data_put', Object.assign({ p_id: a.id || null, p_data: a.data }, common));
    if (op === 'remove') return Api.rpc('core_data_delete', Object.assign({ p_id: a.id }, common));
  }
  var localSave = Promise.resolve();
  function onMessage(e) {
    var m = e.data;
    if (!frame || e.source !== frame.contentWindow || !m || m.dame !== 1 || typeof m.op !== 'string') return;
    var a = m.args || {};
    function answer(p) {
      if (!m.id) { if (p && p.catch) p.catch(function () {}); return; }
      Promise.resolve(p).then(function (v) { e.source.postMessage({ dame: 1, id: m.id, ok: true, value: v === undefined ? null : v }, '*'); },
        function (err) { e.source.postMessage({ dame: 1, id: m.id, ok: false, code: err && err.code, message: Api.errorMessage(err) }, '*'); });
    }
    if (m.op === 'get' || m.op === 'list' || m.op === 'put' || m.op === 'remove') answer(data(m.op, a));
    else if (m.op === 'local') {           // the tool's localStorage, one private record; saves run one after another
      localSave = localSave.then(function () { return Api.rpc('core_data_put', { p_tile: tile, p_collection: '_local', p_id: 'store', p_data: a.data || {}, p_mine: true, p_preview: preview }); })
        .catch(function (err) { toast('Could not save: ' + Api.errorMessage(err)); });
    }
    else if (m.op === 'nav') { var p = pageOf(a.href); if (p) window.location.hash = p === 'index.html' ? '' : '#' + encodeURIComponent(p).replace(/%2F/g, '/'); }
    else if (m.op === 'open') {
      if (/^https?:\/\//i.test(a.href || '') && window.confirm('This tool wants to open an outside address:\n\n' + String(a.href).slice(0, 300) + '\n\nOpen it?')) window.open(a.href, '_blank', 'noopener,noreferrer');
    }
    else if (m.op === 'title') doc.title = String(a.text || '').slice(0, 80) + ' - ' + cfg.SITE_NAME;
    else if (m.op === 'toast') toast(a.text || '');
    else if (m.op === 'download') {
      if (!(a.blob instanceof Blob)) { answer(Promise.reject(new Error('Nothing to download'))); return; }
      var url = URL.createObjectURL(a.blob), link = el('a', { href: url, download: String(a.name || 'download').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) });
      doc.body.appendChild(link); link.click(); link.parentNode.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      answer(true);
    }
  }
  function show(page) {
    var gateBox = doc.getElementById('up-gate'); if (gateBox) gateBox.parentNode.removeChild(gateBox);
    if (!page) { gate('Nothing here', 'That page is not part of this tool.', { href: base, label: 'Start page' }); return; }
    var dir = page.lastIndexOf('/') < 0 ? '' : page.slice(0, page.lastIndexOf('/') + 1);
    Promise.all([
      fetch(base + page + '.txt', { cache: 'no-cache', credentials: 'omit' }).then(function (r) { if (!r.ok) throw { missing: r.status === 404 }; return r.text(); }),
      Api.rpc('core_data_get', { p_tile: tile, p_collection: '_local', p_id: 'store', p_mine: true, p_preview: preview }).catch(function () { return null; })
    ]).then(function (got) {
      var html = got[0];
      if (html.indexOf(BOOT_MARK) < 0) { gate('Cannot load', 'This page was not prepared by the site. Upload the tool again.'); return; }
      var boot = { tile: tile, preview: preview, page: page, local: got[1] && got[1].data || {},
        user: { username: me.username, display_name: me.display_name || me.username, level: me.level, is_super: !!me.is_super } };
      var head = '<base href="' + window.location.origin + base + encodeURI(dir) + '">' +
        '<script type="application/json" id="dame-boot">' + JSON.stringify(boot).replace(/</g, '\\u003c') + '</script>';
      var f = el('iframe', { id: 'up-frame', sandbox: SANDBOX, title: tileName, referrerpolicy: 'no-referrer' });
      f.srcdoc = html.replace(BOOT_MARK, head);
      if (frame) frame.parentNode.replaceChild(f, frame); else doc.body.appendChild(f);
      frame = f;
    }).catch(function (err) {
      if (err && err.missing) gate('Nothing here', page === 'index.html' ? 'This tool has no files yet.' : 'That page is not part of this tool.', { href: page === 'index.html' ? CORE + '/dashboard.html' : base, label: page === 'index.html' ? 'Dashboard' : 'Start page' });
      else gate('Cannot load', 'The page could not be loaded. Check the connection and try again.', { href: window.location.href, label: 'Try again' });
    });
  }

  function start() {
    doc.body.className = 'up-shell';
    if (!tile || tile !== pathTile) { gate('Nothing here', 'This page is not in its tile\'s folder.'); return; }
    if (window.top !== window.self) { gate('Nothing here', 'This page cannot be shown inside another page.'); return; }
    if (!Api.auth.session()) { toLogin(); return; }
    // A preview is for the tile's managers, also while the tile is still switched off: the upload check decides.
    var ask = preview
      ? Api.rpc('core_upload_check', { p_tile: tile }).then(function (c) { return { status: 'active', username: c.username, is_super: c.is_super, level: 'manage', tile: { name: c.name } }; })
      : Api.rpc('core_me', { p_tile: tile });
    ask.then(function (who) {
      if (who.status === 'disabled') { toLogin(); return; }
      if (who.must_change_password) { window.location.assign(CORE + '/account.html?change=1'); return; }
      me = who; tileName = who.tile ? who.tile.name : tile;
      doc.title = tileName + ' - ' + cfg.SITE_NAME;
      bar();
      window.addEventListener('message', onMessage);
      window.addEventListener('hashchange', function () { show(pageFromHash()); });
      show(pageFromHash());
    }, function (err) {
      var code = err && err.code;
      if (code === 'SIGNED_OUT') { toLogin(); return; }
      if (code === 'NOT_APPROVED') gate('Waiting for approval', Api.messages.NOT_APPROVED);
      else if (preview && (code === 'NO_ACCESS' || code === 'NO_RIGHT' || code === 'NOT_FOUND')) gate('Nothing here', 'This preview is only for the tile\'s managers.');
      else if (code === 'NO_ACCESS' || code === 'NO_RIGHT') gate('Nothing here', 'There is nothing here for you.');
      else gate('Cannot load', Api.errorMessage(err), { href: window.location.pathname, label: 'Try again' });
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
