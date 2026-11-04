/* DAME core: page guard, topbar, theme, small UI helpers. Loaded by every page after api.js.
   Pages call Core.requireLogin({ tile, right, super }) first; the result decides what is shown. */
window.Core = (function () {
  'use strict';
  var cfg = window.DAME_CONFIG;
  var Api = window.Api;
  var CORE = cfg.CORE;
  var ICONS = ['tile', 'notes', 'chart', 'tools', 'users', 'folder', 'book', 'calc', 'gear', 'shield', 'wind', 'check'];
  var Core = { user: null, tile: null, CORE: CORE, ICONS: ICONS, SITE_NAME: cfg.SITE_NAME };

  // ---------- DOM ----------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'on') { for (var ev in v) node.addEventListener(ev, v[ev]); }
        else if (k === 'dataset') { for (var d in v) node.dataset[d] = v[d]; }
        else if (k === 'disabled' || k === 'checked' || k === 'hidden' || k === 'selected' || k === 'required') node[k] = !!v;
        else if (k === 'value') node.value = v;
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  Core.el = el; Core.append = append; Core.clear = clear; Core.$ = $;

  // ---------- theme ----------
  function themeGet() { try { return localStorage.getItem(cfg.THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function themeApply(t) {
    if (t === 'day' || t === 'night') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function themeIsNight() {
    var t = themeGet();
    if (t === 'night') return true;
    if (t === 'day') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function themeToggle() {
    var next = themeIsNight() ? 'day' : 'night';
    try { localStorage.setItem(cfg.THEME_KEY, next); } catch (e) {}
    themeApply(next);
    var b = $('#theme-btn'); if (b) b.textContent = themeIsNight() ? 'Day' : 'Night';
  }
  themeApply(themeGet());
  Core.themeToggle = themeToggle;

  // ---------- helpers ----------
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  Core.date = function (v) {
    if (!v) return '';
    var d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };
  Core.dateTime = function (v) {
    if (!v) return '';
    var d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    return Core.date(d) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  Core.errorMessage = function (err) { return Api.errorMessage(err); };
  Core.setTitle = function (text) { document.title = (text ? text + ' - ' : '') + cfg.SITE_NAME; };
  Core.download = function (name, blob) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };
  Core.param = function (name) { return new URLSearchParams(window.location.search).get(name); };
  Core.go = function (path) { window.location.assign(path); };
  // Only paths on this site may be used as a "next" destination.
  Core.safeNext = function (p) { return p && /^\/[a-z0-9][a-z0-9-]*\/[^\s]*$/i.test(p) && p.indexOf('//') !== 0 ? p : CORE + '/dashboard.html'; };

  // ---------- toast ----------
  Core.toast = function (text, kind) {
    var host = $('#toasts') || document.body.appendChild(el('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }));
    var t = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: text });
    host.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  };

  // ---------- sheet (dialog) ----------
  // Core.sheet({ title, body: node|string, actions: [{ label, kind:'primary'|'danger'|'', value, close:false }] }) -> Promise(value)
  Core.sheet = function (opts) {
    return new Promise(function (resolve) {
      var back = el('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true' });
      var box = el('div', { class: 'sheet' });
      if (opts.title) box.appendChild(el('h2', { text: opts.title }));
      var bodyNode = typeof opts.body === 'string' ? el('p', { text: opts.body }) : opts.body;
      if (bodyNode) box.appendChild(bodyNode);
      var actions = el('div', { class: 'actions' });
      function done(v) { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener('keydown', onKey); resolve(v); }
      (opts.actions || [{ label: 'Close', value: null }]).forEach(function (a) {
        actions.appendChild(el('button', { class: 'btn ' + (a.kind || ''), type: 'button', text: a.label, on: { click: function () {
          if (typeof a.onClick === 'function') {
            var r = a.onClick();
            Promise.resolve(r).then(function (res) { if (res !== false) done(a.value !== undefined ? a.value : res); });
          } else done(a.value);
        } } }));
      });
      box.appendChild(actions);
      back.appendChild(box);
      back.addEventListener('click', function (e) { if (e.target === back && !opts.modal) done(null); });
      function onKey(e) { if (e.key === 'Escape' && !opts.modal) done(null); }
      document.addEventListener('keydown', onKey);
      document.body.appendChild(back);
      var first = box.querySelector('input, textarea, select, button.primary, button');
      if (first) first.focus();
      if (opts.onOpen) opts.onOpen(box);
    });
  };
  Core.confirm = function (text, opts) {
    opts = opts || {};
    return Core.sheet({ title: opts.title || 'Are you sure?', body: text,
      actions: [{ label: 'Cancel', value: false }, { label: opts.ok || 'Yes', kind: opts.danger ? 'danger' : 'primary', value: true }] });
  };

  // ---------- states ----------
  function showState(title, text, link) {
    var main = $('main') || document.body.appendChild(el('main'));
    clear(main);
    var box = el('div', { class: 'state' }, el('h2', { text: title }), el('p', { text: text }));
    if (link) box.appendChild(el('a', { class: 'btn', href: link.href, text: link.label }));
    main.appendChild(box);
    main.hidden = false;
    document.documentElement.removeAttribute('data-loading');
  }
  Core.showState = showState;
  Core.ready = function () { document.documentElement.removeAttribute('data-loading'); };

  // ---------- sign out ----------
  Core.signOut = function () {
    return Api.rpc('core_sign_out').catch(function () {}).then(function () { return Api.auth.signOut(); })
      .then(function () { Core.go(CORE + '/'); });
  };
  function toLogin() {
    Api.auth.clear();
    var here = window.location.pathname + window.location.search;
    Core.go(CORE + '/?next=' + encodeURIComponent(here));
  }

  // ---------- topbar ----------
  function buildTopbar(me) {
    var bar = $('#topbar');
    if (!bar) return;
    clear(bar);
    var inner = el('div', { class: 'inner' });
    inner.appendChild(el('a', { class: 'home', href: CORE + '/dashboard.html', 'aria-label': cfg.SITE_NAME + ' dashboard' },
      el('span', { class: 'mark', 'aria-hidden': 'true' }), el('span', { text: cfg.SITE_NAME })));
    if (Core.tile) {
      inner.appendChild(el('span', { class: 'crumb', 'aria-hidden': 'true', text: '/' }));
      inner.appendChild(el('span', { class: 'here', text: Core.tile.name }));
    } else if (Core.pageName) {
      inner.appendChild(el('span', { class: 'crumb', 'aria-hidden': 'true', text: '/' }));
      inner.appendChild(el('span', { class: 'here', text: Core.pageName }));
    }
    inner.appendChild(el('span', { class: 'spacer' }));
    inner.appendChild(el('button', { id: 'theme-btn', class: 'btn ghost small', type: 'button', text: themeIsNight() ? 'Day' : 'Night', on: { click: themeToggle } }));
    if (me) {
      var menu = el('div', { class: 'menu' });
      var list = el('div', { class: 'menu-list', hidden: true });
      var btn = el('button', { class: 'btn ghost small who', type: 'button', text: me.display_name || me.username, 'aria-haspopup': 'true', 'aria-expanded': 'false',
        on: { click: function (e) { e.stopPropagation(); list.hidden = !list.hidden; btn.setAttribute('aria-expanded', String(!list.hidden)); } } });
      list.appendChild(el('div', { class: 'head', text: '@' + me.username }));
      list.appendChild(el('a', { href: CORE + '/dashboard.html', text: 'Dashboard' }));
      if (Core.tile && (me.tile_admin || me.is_super)) list.appendChild(el('a', { href: CORE + '/access.html?tile=' + encodeURIComponent(Core.tile.id), text: 'Access to ' + Core.tile.name }));
      if (me.is_super) list.appendChild(el('a', { href: CORE + '/admin.html', text: 'Admin' }));
      list.appendChild(el('a', { href: CORE + '/account.html', text: 'Account' }));
      list.appendChild(el('div', { class: 'sep' }));
      list.appendChild(el('button', { type: 'button', text: 'Sign out', on: { click: function () { Core.signOut(); } } }));
      document.addEventListener('click', function () { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
      menu.appendChild(btn); menu.appendChild(list);
      inner.appendChild(menu);
    }
    bar.appendChild(inner);
  }
  Core.buildTopbar = buildTopbar;

  // ---------- the guard ----------
  // opts: { tile: 'id', right: 'edit', super: true, page: 'Name' }
  Core.requireLogin = function (opts) {
    opts = opts || {};
    Core.pageName = opts.page || null;
    buildTopbar(null);
    if (!Api.auth.session()) { toLogin(); return new Promise(function () {}); }
    return Api.rpc('core_me', { p_tile: opts.tile || null }).then(function (me) {
      Core.user = me;
      if (me.status === 'disabled') { toLogin(); return new Promise(function () {}); }
      if (me.tile) Core.tile = me.tile;
      buildTopbar(me);
      if (me.status === 'pending') {
        showState('Waiting for approval', 'Your request was received. The site admin will approve it; until then there is nothing to see here.',
          { href: CORE + '/', label: 'Back' });
        return new Promise(function () {});
      }
      var onAccount = /\/account\.html$/.test(window.location.pathname);
      if (me.must_change_password && !onAccount) { Core.go(CORE + '/account.html?change=1'); return new Promise(function () {}); }
      if (opts.super && !me.is_super) { showState('Nothing here', 'There is nothing here for you.', { href: CORE + '/dashboard.html', label: 'Dashboard' }); return new Promise(function () {}); }
      if (opts.right && !me.is_super && (me.rights || []).indexOf(opts.right) < 0) {
        showState('Nothing here', 'There is nothing here for you.', { href: CORE + '/dashboard.html', label: 'Dashboard' }); return new Promise(function () {});
      }
      document.documentElement.removeAttribute('data-loading');
      return me;
    }).catch(function (err) {
      if (err && err.code === 'SIGNED_OUT') { toLogin(); return new Promise(function () {}); }
      buildTopbar(null);
      if (err && (err.code === 'NO_ACCESS' || err.code === 'NO_RIGHT' || err.code === 'NOT_APPROVED')) {
        showState('Nothing here', err.code === 'NOT_APPROVED' ? Api.messages.NOT_APPROVED : 'There is nothing here for you.', { href: CORE + '/dashboard.html', label: 'Dashboard' });
      } else {
        showState('Cannot load', Api.errorMessage(err), { href: window.location.pathname, label: 'Try again' });
      }
      return new Promise(function () {});
    });
  };

  // Public pages (sign in): theme + topbar without a user.
  Core.initPublic = function () { buildTopbar(null); document.documentElement.removeAttribute('data-loading'); };

  // Shows a plain error from a thrown ApiError in a form's error box, or as a toast.
  Core.showError = function (err, box) {
    var msg = Api.errorMessage(err);
    if (box) { box.textContent = msg; box.hidden = false; } else Core.toast(msg, 'danger');
    if (err && err.code === 'SIGNED_OUT') setTimeout(toLogin, 800);
  };

  // Runs an async action from a button: disables it and shows a spinner meanwhile.
  Core.busy = function (btn, fn) {
    if (btn.disabled) return Promise.resolve();
    var label = btn.textContent;
    btn.disabled = true; clear(btn); btn.appendChild(el('span', { class: 'spin' })); btn.appendChild(document.createTextNode(' ' + label));
    return Promise.resolve().then(fn).then(function (r) { btn.disabled = false; btn.textContent = label; return r; },
      function (e) { btn.disabled = false; btn.textContent = label; throw e; });
  };

  return Core;
})();
