/* DAME core: loaded by every page of an uploaded tile (tile-upload adds it; docs/STANDARDS.md section 13).
   Loaded in <head>, after config.js and api.js, before the page's own scripts. It does three things:
   1. style="" attributes: the site's security policy blocks them as written; they are applied here through the
      CSSOM, which the policy allows. Also for elements the page adds later (innerHTML, templates).
   2. onclick="" and other handlers: tile-upload moved them into _dame/js/<page>-on.js (window.DAME_UP_ON);
      they are bound here to every element carrying data-up-on, also to ones added later.
   3. The guard: the page stays hidden until the user is signed in, approved and has the tile (a preview under
      _next/ only for the tile's managers); then a slim DAME bar goes on top (home, tile, Files for managers).
   The database decides what anyone may read or change; this only decides what is shown. */
(function () {
  'use strict';
  var cfg = window.DAME_CONFIG, CORE = cfg.CORE;
  var doc = document, root = doc.documentElement;
  var meta = doc.querySelector('meta[name="dame-tile"]');
  var tile = meta ? meta.getAttribute('content') : '';
  var parts = window.location.pathname.split('/');            // ['', 'dame-hub', '<tile>', ('_next'), ...]
  var pathTile = '/' + parts[1] === CORE ? parts[2] : '';
  var preview = parts[3] === '_next';

  // ---------- 1. style attributes through the CSSOM ----------
  var applied = typeof WeakMap === 'function' ? new WeakMap() : null;
  function applyStyle(el) {
    var v = el.getAttribute('style');
    if (v === null || !el.style || (applied && applied.get(el) === v)) return;
    if (el.style.cssText !== v) {
      try { el.style.cssText = v; } catch (e) { return; }
    }
    if (applied) applied.set(el, el.getAttribute('style'));
  }

  // ---------- 2. handlers moved out of the markup ----------
  var bound = typeof WeakSet === 'function' ? new WeakSet() : null;
  function bind(el) {
    var key = el.getAttribute('data-up-on');
    var spec = key && window.DAME_UP_ON ? window.DAME_UP_ON[key] : null;
    if (!spec || !bound || bound.has(el)) return;
    bound.add(el);
    Object.keys(spec).forEach(function (k) {
      var onWindow = k.indexOf('window:') === 0;
      var type = onWindow ? k.slice(7) : k;
      var fn = spec[k];
      var target = onWindow ? window : el;
      target.addEventListener(type, function (ev) {
        var r = fn.call(target, ev);
        if (r === false) ev.preventDefault();
      });
    });
  }

  function scan(el) {
    if (el.hasAttribute('style')) applyStyle(el);
    if (el.hasAttribute('data-up-on')) bind(el);
  }
  function visit(node) {
    if (!node || node.nodeType !== 1) return;
    scan(node);
    if (node.firstElementChild) {
      var list = node.querySelectorAll('[style], [data-up-on]');
      for (var i = 0; i < list.length; i++) scan(list[i]);
    }
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'attributes') { if (r.target.nodeType === 1) scan(r.target); }
        else for (var j = 0; j < r.addedNodes.length; j++) visit(r.addedNodes[j]);
      }
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-up-on'] });
  }
  visit(root);

  // ---------- 3. the guard and the DAME bar ----------
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
  function first(node) { doc.body.insertBefore(node, doc.body.firstChild); }
  function gate(title, text, link) {
    var old = doc.getElementById('up-gate'); if (old) old.parentNode.removeChild(old);
    var box = el('div', { id: 'up-gate', role: 'alert', 'class': night() ? 'night' : '' });
    box.appendChild(el('h2', null, title));
    box.appendChild(el('p', null, text));
    var a = el('a', { href: link ? link.href : CORE + '/dashboard.html' }, link ? link.label : 'Dashboard');
    box.appendChild(a);
    first(box);
  }
  function bar(me) {
    var b = el('div', { id: 'up-bar', 'class': night() ? 'night' : '', role: 'navigation', 'aria-label': cfg.SITE_NAME });
    var home = el('a', { 'class': 'up-home', href: CORE + '/dashboard.html', 'aria-label': cfg.SITE_NAME + ' dashboard' });
    home.appendChild(el('img', { src: CORE + '/core/v1/icons/mark.svg', alt: '', width: '20', height: '20' }));
    home.appendChild(el('span', null, cfg.SITE_NAME));
    b.appendChild(home);
    b.appendChild(el('span', { 'class': 'up-sep', 'aria-hidden': 'true' }, '/'));
    b.appendChild(el('span', { 'class': 'up-here' }, me.tile ? me.tile.name : tile));
    if (preview) b.appendChild(el('span', { 'class': 'up-badge' }, 'Preview, not live'));
    b.appendChild(el('span', { 'class': 'up-grow' }));
    if (me.is_super || me.level === 'manage') b.appendChild(el('a', { 'class': 'up-link', href: CORE + '/upload.html?tile=' + encodeURIComponent(tile) }, preview ? 'Back to Files' : 'Files'));
    // Edge to edge whatever margin the tool gives <body> (set through the CSSOM, which the policy allows).
    var cs = window.getComputedStyle(doc.body);
    var ml = parseFloat(cs.marginLeft) || 0, mr = parseFloat(cs.marginRight) || 0, mt = parseFloat(cs.marginTop) || 0;
    if (ml || mr || mt) { b.style.marginLeft = -ml + 'px'; b.style.marginTop = -mt + 'px'; b.style.width = 'calc(100% + ' + (ml + mr) + 'px)'; b.style.marginBottom = mt + 'px'; }
    first(b);
  }
  function toLogin() {
    Api.auth.clear();
    window.location.assign(CORE + '/?next=' + encodeURIComponent(window.location.pathname + window.location.search));
  }
  function start() {
    if (!tile || tile !== pathTile) { gate('Nothing here', 'This page is not in its tile\'s folder.'); return; }
    if (!Api.auth.session()) { toLogin(); return; }
    Api.rpc('core_me', { p_tile: tile }).then(function (me) {
      if (me.status === 'disabled') { toLogin(); return; }
      if (me.must_change_password) { window.location.assign(CORE + '/account.html?change=1'); return; }
      if (preview && !me.is_super && me.level !== 'manage') { gate('Nothing here', 'This preview is only for the tile\'s managers.'); return; }
      bar(me);
      root.removeAttribute('data-up-locked');
    }, function (err) {
      var code = err && err.code;
      if (code === 'SIGNED_OUT') { toLogin(); return; }
      if (code === 'NOT_APPROVED') gate('Waiting for approval', Api.messages.NOT_APPROVED);
      else if (code === 'NO_ACCESS' || code === 'NO_RIGHT') gate('Nothing here', 'There is nothing here for you.');
      else gate('Cannot load', Api.errorMessage(err), { href: window.location.pathname, label: 'Try again' });
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
