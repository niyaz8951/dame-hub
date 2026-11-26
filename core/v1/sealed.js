/* DAME core: the bridge inside a sealed tool page (docs/BLUEPRINT.md section 6). tile-upload adds it as the first
   script of every uploaded page; the page itself runs in a sandboxed frame with no origin of its own, so it cannot
   read the DAME session, the site's storage, the page around it or any outside address. Through this file it gets:
     Dame.user()                              { username, display_name, level, is_super, tile, preview }
     Dame.save(collection, record, opts)      record.id optional; resolves to { id, data, by, at, ... }
     Dame.load(collection, id, opts)          the record or null
     Dame.list(collection, opts)              records, newest change first ({ limit, after })
     Dame.remove(collection, id, opts)        true / false
        opts.mine = true: private to the user. Otherwise shared with everyone who has the tile (levels decide).
     Dame.go('page.html'), Dame.download(name, blobOrText), Dame.toast(text)
     localStorage / sessionStorage            stand-ins; localStorage is kept per user by the site, on every device
   It also applies style="" attributes through the CSSOM and binds the handlers tile-upload moved out of the markup. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var boot = {};
  try { boot = JSON.parse(doc.getElementById('dame-boot').textContent) || {}; } catch (e) {}

  // ---------- messages to the shell ----------
  var seq = 0, waiting = {};
  function ask(op, args, transfer) {
    return new Promise(function (resolve, reject) {
      var id = ++seq; waiting[id] = [resolve, reject];
      window.parent.postMessage({ dame: 1, id: id, op: op, args: args || {} }, '*', transfer || []);
    });
  }
  function tell(op, args) { window.parent.postMessage({ dame: 1, id: 0, op: op, args: args || {} }, '*'); }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== window.parent || !m || m.dame !== 1 || !waiting[m.id]) return;
    var w = waiting[m.id]; delete waiting[m.id];
    if (m.ok) w[0](m.value); else { var err = new Error(m.message || 'Failed'); err.code = m.code; w[1](err); }
  });

  // ---------- storage stand-ins ----------
  function makeStore(initial, onChange) {
    var data = Object.create(null);
    Object.keys(initial || {}).forEach(function (k) { data[k] = String(initial[k]); });
    var api = {
      getItem: function (k) { k = String(k); return k in data ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); onChange(data); },
      removeItem: function (k) { delete data[String(k)]; onChange(data); },
      clear: function () { Object.keys(data).forEach(function (k) { delete data[k]; }); onChange(data); },
      key: function (i) { var k = Object.keys(data); return i < k.length ? k[i] : null; }
    };
    Object.defineProperty(api, 'length', { get: function () { return Object.keys(data).length; } });
    if (typeof Proxy !== 'function') return api;
    return new Proxy(api, {
      get: function (t, k) { return k in t ? t[k] : (typeof k === 'string' && k in data ? data[k] : undefined); },
      set: function (t, k, v) { if (k in t) return true; data[String(k)] = String(v); onChange(data); return true; },
      deleteProperty: function (t, k) { delete data[String(k)]; onChange(data); return true; },
      has: function (t, k) { return k in t || k in data; },
      ownKeys: function () { return Object.keys(data); },
      getOwnPropertyDescriptor: function (t, k) { return k in data ? { value: data[k], writable: true, enumerable: true, configurable: true } : undefined; }
    });
  }
  var timer = null;
  var local = makeStore(boot.local, function (data) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; tell('local', { data: JSON.parse(JSON.stringify(data)) }); }, 400);
  });
  var session = makeStore(null, function () {});
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return local; } });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return session; } });
  } catch (e) {}
  window.addEventListener('pagehide', function () { if (timer) { clearTimeout(timer); timer = null; var d = {}; for (var i = 0; i < local.length; i++) d[local.key(i)] = local.getItem(local.key(i)); tell('local', { data: d }); } });

  // ---------- Dame ----------
  function opts(o) { return { mine: !!(o && o.mine) }; }
  window.Dame = {
    user: function () { return Object.assign({ tile: boot.tile, preview: !!boot.preview }, boot.user || {}); },
    save: function (collection, record, o) {
      var rec = Object.assign({}, record || {}), id = rec.id == null ? null : String(rec.id);
      return ask('put', Object.assign({ collection: collection, id: id, data: rec }, opts(o)));
    },
    load: function (collection, id, o) { return ask('get', Object.assign({ collection: collection, id: String(id) }, opts(o))); },
    list: function (collection, o) { return ask('list', Object.assign({ collection: collection, limit: o && o.limit, after: o && o.after }, opts(o))); },
    remove: function (collection, id, o) { return ask('remove', Object.assign({ collection: collection, id: String(id) }, opts(o))); },
    go: function (page) { tell('nav', { href: new URL(String(page), doc.baseURI).href }); },
    toast: function (text) { tell('toast', { text: String(text) }); },
    download: function (name, content) {
      var blob = content instanceof Blob ? content : new Blob([String(content)], { type: 'text/plain' });
      return ask('download', { name: String(name), blob: blob });
    }
  };
  window.open = function (url) { if (url) tell('open', { href: new URL(String(url), doc.baseURI).href }); return null; };

  // ---------- links: other pages of the tool load through the shell; outside links ask the user ----------
  doc.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    var raw = a.getAttribute('href');
    if (!raw || raw[0] === '#' || /^(blob:|data:|mailto:|tel:)/i.test(raw)) return;
    e.preventDefault();
    var url = new URL(raw, doc.baseURI);
    if (/^https?:$/.test(url.protocol)) tell(url.host === new URL(doc.baseURI).host ? 'nav' : 'open', { href: url.href });
  });

  // ---------- style attributes through the CSSOM; handlers moved out of the markup ----------
  var applied = new WeakMap(), bound = new WeakSet();
  function applyStyle(el) {
    var v = el.getAttribute('style');
    if (v === null || !el.style || applied.get(el) === v) return;
    if (el.style.cssText !== v) { try { el.style.cssText = v; } catch (e) { return; } }
    applied.set(el, el.getAttribute('style'));
  }
  function bind(el) {
    var key = el.getAttribute('data-up-on');
    var spec = key && window.DAME_UP_ON ? window.DAME_UP_ON[key] : null;
    if (!spec || bound.has(el)) return;
    bound.add(el);
    Object.keys(spec).forEach(function (k) {
      var onWindow = k.indexOf('window:') === 0, type = onWindow ? k.slice(7) : k, fn = spec[k], target = onWindow ? window : el;
      target.addEventListener(type, function (ev) { if (fn.call(target, ev) === false) ev.preventDefault(); });
    });
  }
  function scan(el) { if (el.hasAttribute('style')) applyStyle(el); if (el.hasAttribute('data-up-on')) bind(el); }
  function visit(node) {
    if (!node || node.nodeType !== 1) return;
    scan(node);
    if (node.firstElementChild) { var list = node.querySelectorAll('[style], [data-up-on]'); for (var i = 0; i < list.length; i++) scan(list[i]); }
  }
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'attributes') { if (r.target.nodeType === 1) scan(r.target); }
      else for (var j = 0; j < r.addedNodes.length; j++) visit(r.addedNodes[j]);
    }
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-up-on'] });
  visit(root);

  function title() { if (doc.title) tell('title', { text: doc.title }); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', title); else title();
})();
