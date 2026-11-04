/* Admin page: requests, users, tiles, access, audit. Super user only. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  var tilesCache = [];

  Core.requireLogin({ super: true, page: 'Admin' }).then(function () {
    // tabs
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role=tab]'));
    function showTab(name) {
      tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); $('#tab-' + b.dataset.tab).hidden = b.dataset.tab !== name; });
      if (name === 'requests') loadRequests();
      if (name === 'users') loadUsers();
      if (name === 'tiles') loadTiles();
      if (name === 'audit') loadAudit(true);
      if (window.location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    }
    tabs.forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
    var start = window.location.hash.replace('#', '');
    showTab(['requests', 'users', 'tiles', 'audit'].indexOf(start) >= 0 ? start : 'requests');
    countRequests();
  });

  function loading(host) { Core.clear(host); host.appendChild(el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), 'Loading')); }
  function fail(host, err) { Core.clear(host); host.appendChild(el('p', { class: 'notice danger', text: Api.errorMessage(err) })); }

  // ---------- requests ----------
  function countRequests() {
    Api.rpc('core_admin_users', { p_status: 'pending' }).then(function (rows) {
      var c = $('#count-requests'); c.textContent = String(rows.length); c.hidden = rows.length === 0;
    }).catch(function () {});
  }
  function loadRequests() {
    var host = $('#requests'); loading(host);
    Api.rpc('core_admin_users', { p_status: 'pending' }).then(function (rows) {
      Core.clear(host);
      var c = $('#count-requests'); c.textContent = String(rows.length); c.hidden = rows.length === 0;
      if (!rows.length) { host.appendChild(el('div', { class: 'state' }, el('h2', { text: 'No requests' }), el('p', { text: 'Nobody is waiting for approval.' }))); return; }
      rows.forEach(function (u) {
        var card = el('div', { class: 'card tight row between' },
          el('div', { class: 'grow' }, el('div', null, el('strong', { text: u.display_name }), ' ', el('span', { class: 'faint mono', text: '@' + u.username })),
            el('div', { class: 'muted', text: (u.email ? u.email + ' - ' : '') + 'Requested ' + Core.dateTime(u.created_at) })),
          el('div', { class: 'row' },
            el('button', { class: 'btn primary', type: 'button', text: 'Approve', on: { click: function (e) { var btn = e.currentTarget;
              Core.busy(btn, function () { return Api.rpc('core_admin_set_status', { p_user: u.id, p_status: 'active' }); })
                .then(function () { Core.toast('Approved ' + u.username, 'success'); loadRequests(); }).catch(Core.showError);
            } } }),
            el('button', { class: 'btn danger', type: 'button', text: 'Refuse', on: { click: function (e) { var btn = e.currentTarget;
              Core.confirm('Refuse ' + u.username + '? The account is disabled; you can enable it later from Users.', { ok: 'Refuse', danger: true }).then(function (yes) {
                if (!yes) return;
                Core.busy(btn, function () { return Api.rpc('core_admin_set_status', { p_user: u.id, p_status: 'disabled' }); })
                  .then(function () { Core.toast('Refused ' + u.username); loadRequests(); }).catch(Core.showError);
              });
            } } })));
        host.appendChild(card);
      });
    }).catch(function (err) { fail(host, err); });
  }

  // ---------- users ----------
  var usersAll = [];
  function loadUsers() {
    var host = $('#users'); loading(host);
    Api.rpc('core_admin_users', { p_status: null }).then(function (rows) { usersAll = rows; renderUsers(); }).catch(function (err) { fail(host, err); });
  }
  $('#user-filter').addEventListener('input', renderUsers);
  function renderUsers() {
    var host = $('#users'); Core.clear(host);
    var q = $('#user-filter').value.trim().toLowerCase();
    var rows = usersAll.filter(function (u) { return !q || u.username.indexOf(q) >= 0 || u.display_name.toLowerCase().indexOf(q) >= 0 || (u.email || '').indexOf(q) >= 0; });
    if (!rows.length) { host.appendChild(el('p', { class: 'state', text: usersAll.length ? 'No match.' : 'No users yet.' })); return; }
    var table = el('table', null, el('thead', null, el('tr', null, el('th', { text: 'User' }), el('th', { text: 'Status' }), el('th', { text: 'Tiles' }), el('th', { text: 'Last sign-in' }), el('th'))));
    var body = el('tbody');
    rows.forEach(function (u) {
      var status = el('span', { class: 'badge ' + (u.status === 'active' ? 'success' : u.status === 'pending' ? 'warning' : 'danger'), text: u.status });
      var tr = el('tr', null,
        el('td', null, el('div', null, el('strong', { text: u.display_name }), u.is_super ? el('span', { class: 'badge brand', text: 'super' }) : null), el('div', { class: 'faint mono', text: '@' + u.username + (u.email ? ' - ' + u.email : '') })),
        el('td', null, status),
        el('td', null, u.tiles.length ? u.tiles.join(', ') : el('span', { class: 'faint', text: '-' })),
        el('td', { text: u.last_sign_in ? Core.dateTime(u.last_sign_in) : '-' }));
      var actions = el('td', { class: 'actions' });
      if (!u.is_super && u.username !== Core.user.username) {
        if (u.status === 'active') actions.appendChild(el('button', { class: 'btn small danger', type: 'button', text: 'Disable', on: { click: function (e) { var btn = e.currentTarget;
          Core.confirm('Disable ' + u.username + '? He is signed out at once and cannot sign in until enabled again.', { ok: 'Disable', danger: true }).then(function (yes) {
            if (!yes) return;
            Core.busy(btn, function () { return Api.rpc('core_admin_set_status', { p_user: u.id, p_status: 'disabled' }); }).then(loadUsers).catch(Core.showError);
          });
        } } }));
        else actions.appendChild(el('button', { class: 'btn small', type: 'button', text: u.status === 'pending' ? 'Approve' : 'Enable', on: { click: function (e) { var btn = e.currentTarget;
          Core.busy(btn, function () { return Api.rpc('core_admin_set_status', { p_user: u.id, p_status: 'active' }); }).then(function () { loadUsers(); countRequests(); }).catch(Core.showError);
        } } }));
      }
      tr.appendChild(actions);
      body.appendChild(tr);
    });
    table.appendChild(body); host.appendChild(table);
  }

  // ---------- tiles ----------
  function loadTiles() {
    var host = $('#tiles'); loading(host);
    Api.rpc('core_admin_tiles').then(function (rows) {
      tilesCache = rows; Core.clear(host);
      if (!rows.length) { host.appendChild(el('p', { class: 'state', text: 'No tiles yet. Register the first one with "New tile".' })); return; }
      var table = el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Tile' }), el('th', { text: 'On' }), el('th', { text: 'Rights' }), el('th', { text: 'Users' }), el('th', { text: 'Tile admins' }), el('th'))));
      var body = el('tbody');
      rows.forEach(function (t) {
        var sw = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(t.enabled), 'aria-label': 'Switch ' + t.id + (t.enabled ? ' off' : ' on'),
          on: { click: function () {
            sw.disabled = true;
            Api.rpc('core_admin_tile_enable', { p_id: t.id, p_enabled: !t.enabled }).then(function () { Core.toast(t.name + (t.enabled ? ' is off' : ' is on')); loadTiles(); }).catch(function (err) { Core.showError(err); loadTiles(); });
          } } });
        var icon = Core.ICONS.indexOf(t.icon) >= 0 ? t.icon : 'tile';
        var tr = el('tr', null,
          el('td', null, el('div', { class: 'row' }, el('span', { class: 'icon i-' + icon, 'aria-hidden': 'true' }), el('div', null, el('div', null, el('strong', { text: t.name })), el('div', { class: 'faint mono', text: '/' + t.id + '/' })))),
          el('td', null, sw),
          el('td', { text: t.rights.length ? t.rights.join(', ') : '-' }),
          el('td', { text: String(t.users) }),
          el('td', { text: t.admins.length ? t.admins.join(', ') : '-' }),
          el('td', { class: 'actions' },
            el('button', { class: 'btn small', type: 'button', text: 'Access', on: { click: function () { openAccess(t); } } }), ' ',
            el('button', { class: 'btn small', type: 'button', text: 'Edit', on: { click: function () { tileForm(t); } } })));
        body.appendChild(tr);
      });
      table.appendChild(body); host.appendChild(table);
    }).catch(function (err) { fail(host, err); });
  }
  $('#tile-new').addEventListener('click', function () { tileForm(null); });

  function tileForm(t) {
    var isNew = !t;
    t = t || { id: '', name: '', tagline: '', icon: 'tile', sort_order: 100, rights: [] };
    function field(id, label, value, hint, attrs) {
      var input = el('input', Object.assign({ id: 'tf-' + id, value: value }, attrs || {}));
      return el('div', { class: 'field' }, el('label', { for: 'tf-' + id, text: label }), input, hint ? el('span', { class: 'hint', text: hint }) : null);
    }
    var iconSel = el('select', { id: 'tf-icon' });
    Core.ICONS.forEach(function (i) { iconSel.appendChild(el('option', { value: i, text: i, selected: i === t.icon })); });
    var err = el('p', { class: 'notice danger', hidden: true });
    var body = el('div', null,
      field('id', 'Tile id', t.id, 'Lower case, digits and dashes; the repo name and the path /<tile-id>/. Cannot change later.', { maxlength: 30, disabled: !isNew, autocapitalize: 'none', spellcheck: 'false' }),
      field('name', 'Name', t.name, null, { maxlength: 40 }),
      field('tagline', 'Tagline', t.tagline, 'Neutral, one line.', { maxlength: 80 }),
      el('div', { class: 'field' }, el('label', { for: 'tf-icon', text: 'Icon' }), iconSel),
      field('order', 'Order', String(t.sort_order), 'Lower comes first on the dashboard.', { type: 'number', min: 0, max: 9999 }),
      field('rights', 'Rights', t.rights.join(', '), 'Comma-separated, as declared in the tile\'s docs/TILE.md (e.g. edit, export). Removing one removes it from every user.', { autocapitalize: 'none', spellcheck: 'false' }),
      err);
    Core.sheet({ title: isNew ? 'New tile' : 'Edit ' + t.name, body: body, actions: [
      { label: 'Cancel', value: false },
      { label: 'Save', kind: 'primary', onClick: function () {
        var params = { p_id: isNew ? body.querySelector('#tf-id').value : t.id, p_name: body.querySelector('#tf-name').value,
          p_tagline: body.querySelector('#tf-tagline').value, p_icon: iconSel.value,
          p_sort_order: parseInt(body.querySelector('#tf-order').value, 10) || 100,
          p_rights: body.querySelector('#tf-rights').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) };
        return Api.rpc('core_admin_tile_save', params).then(function () { Core.toast('Saved', 'success'); loadTiles(); return true; },
          function (ex) { err.textContent = Api.errorMessage(ex); err.hidden = false; return false; });
      } }] });
  }

  function openAccess(t) {
    Core.sheet({ title: 'Access to ' + t.name, body: Access.panel(t, true), actions: [{ label: 'Done', value: true }] }).then(function () { loadTiles(); });
  }

  // ---------- audit ----------
  var auditBefore = null;
  function loadAudit(reset) {
    var host = $('#audit');
    if (reset) { auditBefore = null; loading(host); }
    var more = $('#audit-more'); more.disabled = true;
    var params = { p_limit: 100, p_before: auditBefore, p_tile: $('#audit-tile').value.trim() || null, p_username: $('#audit-user').value.trim().toLowerCase() || null };
    Api.rpc('core_admin_audit', params).then(function (rows) {
      if (reset) Core.clear(host);
      var table = host.querySelector('table');
      if (!table) {
        if (!rows.length) { host.appendChild(el('p', { class: 'state', text: 'Nothing recorded.' })); more.hidden = true; return; }
        table = el('table', null, el('thead', null, el('tr', null, el('th', { text: 'When' }), el('th', { text: 'Who' }), el('th', { text: 'Tile' }), el('th', { text: 'Action' }), el('th', { text: 'Detail' }))), el('tbody'));
        host.appendChild(table);
      }
      var body = table.querySelector('tbody');
      rows.forEach(function (r) {
        var detail = r.detail && Object.keys(r.detail).length ? Object.keys(r.detail).map(function (k) { return k + ': ' + (typeof r.detail[k] === 'object' ? JSON.stringify(r.detail[k]) : r.detail[k]); }).join(', ') : '';
        body.appendChild(el('tr', null, el('td', { text: Core.dateTime(r.at) }), el('td', { class: 'mono', text: r.username || '-' }), el('td', { class: 'mono', text: r.tile_id || '-' }), el('td', { text: r.action }), el('td', { class: 'muted', text: detail })));
      });
      if (rows.length) auditBefore = rows[rows.length - 1].at;
      more.hidden = rows.length < 100; more.disabled = false;
    }).catch(function (err) { fail(host, err); });
  }
  $('#audit-go').addEventListener('click', function () { loadAudit(true); });
  $('#audit-more').addEventListener('click', function () { loadAudit(false); });
})();
