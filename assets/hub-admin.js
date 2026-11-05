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
  $('#user-new').addEventListener('click', function () {
    function field(id, label, hint, attrs) {
      var input = el('input', Object.assign({ id: 'nu-' + id }, attrs || {}));
      return el('div', { class: 'field' }, el('label', { for: 'nu-' + id, text: label }), input, hint ? el('span', { class: 'hint', text: hint }) : null);
    }
    var err = el('p', { class: 'notice danger', hidden: true });
    var body = el('div', null,
      el('p', { class: 'muted', text: 'The person signs in with this username and the temporary password, and must choose a new password at the first sign-in. No email is needed.' }),
      field('user', 'Username', '3 to 30 characters: lower-case letters, digits, dot, dash, underscore.', { maxlength: 30, autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off' }),
      field('name', 'Display name', null, { maxlength: 60, autocomplete: 'off' }),
      field('pass', 'Temporary password', 'At least 10 characters with lower case, upper case and a digit. Tell it to the person by voice, not in writing.', { autocomplete: 'off', spellcheck: 'false' }),
      el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'button', text: 'Generate', on: { click: function () { body.querySelector('#nu-pass').value = makePassword(); } } })),
      err);
    Core.sheet({ title: 'New user', body: body, actions: [
      { label: 'Cancel', value: false },
      { label: 'Create', kind: 'primary', onClick: function () {
        var u = body.querySelector('#nu-user').value.trim().toLowerCase(), n = body.querySelector('#nu-name').value.trim(), p = body.querySelector('#nu-pass').value;
        err.hidden = true;
        if (!Api.auth.validUsername(u)) { err.textContent = 'Please check the username.'; err.hidden = false; return false; }
        if (!Api.auth.validPassword(p)) { err.textContent = Api.messages.WEAK_PASSWORD; err.hidden = false; return false; }
        return Api.rpc('core_admin_create_user', { p_username: u, p_display_name: n || u, p_temp_password: p })
          .then(function () { Core.toast('Created ' + u, 'success'); loadUsers(); return true; },
                function (ex) { err.textContent = ex.code === 'TAKEN:username' ? Api.messages.TAKEN_USERNAME : Api.errorMessage(ex); err.hidden = false; return false; });
      } }] });
  });
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
        el('td', null, el('div', null, el('strong', { text: u.display_name }), u.is_super ? el('span', { class: 'badge brand', text: 'super' }) : null), el('div', { class: 'faint mono', text: '@' + u.username + (u.email && u.email.indexOf('@' + DAME_CONFIG.INTERNAL_DOMAIN) < 0 ? ' - ' + u.email : '') })),
        el('td', null, status),
        el('td', null, u.tiles.length ? u.tiles.join(', ') : el('span', { class: 'faint', text: '-' })),
        el('td', { text: u.last_sign_in ? Core.dateTime(u.last_sign_in) : '-' }));
      var actions = el('td', { class: 'actions' },
        el('button', { class: 'btn small', type: 'button', text: 'Manage', 'aria-label': 'Manage ' + u.username, on: { click: function () { manageUser(u); } } }));
      tr.appendChild(actions);
      body.appendChild(tr);
    });
    table.appendChild(body); host.appendChild(table);
  }

  // Temporary password: 14 characters, no look-alikes (0/O, 1/l/I), always lower + upper + digit.
  function makePassword() {
    var sets = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'], all = sets.join(''), out = [];
    var rnd = new Uint32Array(14); crypto.getRandomValues(rnd);
    for (var i = 0; i < 14; i++) { var set = i < 3 ? sets[i] : all; out.push(set[rnd[i] % set.length]); }
    for (var j = out.length - 1; j > 0; j--) { var k = rnd[j] % (j + 1), t = out[j]; out[j] = out[k]; out[k] = t; }
    return out.join('');
  }

  // Admin > Users > Manage: name, password, disable / enable, delete. Super users and oneself: name only.
  function manageUser(u) {
    var self = u.username === Core.user.username, internal = !u.email || u.email.indexOf('@' + DAME_CONFIG.INTERNAL_DOMAIN) >= 0;
    var limited = self || u.is_super, changed = false, sheetBox = null;
    function close() { var b = sheetBox && sheetBox.lastElementChild.querySelector('button'); if (b) b.click(); }
    function field(id, label, value, hint, attrs) {
      var input = el('input', Object.assign({ id: 'mu-' + id, value: value || '' }, attrs || {}));
      return el('div', { class: 'field' }, el('label', { for: 'mu-' + id, text: label }), input, hint ? el('span', { class: 'hint', text: hint }) : null);
    }
    function note(kind) { return el('p', { class: 'notice ' + kind, hidden: true, role: kind === 'danger' ? 'alert' : 'status' }); }
    function say(box, text) { box.textContent = text; box.hidden = false; }
    function badge(st) { return el('span', { class: 'badge ' + (st === 'active' ? 'success' : st === 'pending' ? 'warning' : 'danger'), text: st }); }

    var headName = el('strong', { text: u.display_name }), headUser = el('span', { class: 'faint mono', text: '@' + u.username }), headBadge = badge(u.status);
    var head = el('div', { class: 'card tight' },
      el('div', { class: 'row between' }, el('div', null, headName, ' ', headUser), headBadge),
      el('div', { class: 'muted', text: (internal ? 'Signs in with the username' : 'Signs in with ' + u.email) + ' - ' +
        (u.tiles.length ? 'tiles: ' + u.tiles.join(', ') : 'no tiles') }));

    // name
    var nameErr = note('danger'), nameOk = note('success');
    var nameBox = el('div', { class: 'stack' },
      el('h3', { class: 'section-title', text: 'Name' }),
      field('user', 'Username', u.username, internal
        ? '3 to 30 characters: lower-case letters, digits, dot, dash, underscore. The person signs in with the new username at once; tell him.'
        : '3 to 30 characters: lower-case letters, digits, dot, dash, underscore. Only the name shown changes; sign-in stays ' + u.email + '.',
        { maxlength: 30, autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off' }),
      field('name', 'Display name', u.display_name, null, { maxlength: 60, autocomplete: 'off' }),
      nameErr, nameOk,
      el('div', { class: 'row end' }, el('button', { class: 'btn primary', type: 'button', id: 'mu-save', text: 'Save name', on: { click: function (e) {
        var nu = nameBox.querySelector('#mu-user').value.trim().toLowerCase(), nn = nameBox.querySelector('#mu-name').value.trim();
        nameErr.hidden = true; nameOk.hidden = true;
        if (!Api.auth.validUsername(nu)) return say(nameErr, 'Please check the username.');
        if (!nn) return say(nameErr, 'Please check the display name.');
        if (nu === u.username && nn === u.display_name) return say(nameOk, 'Nothing to change.');
        var old = u.username;
        Core.busy(e.currentTarget, function () { return Api.rpc('core_admin_update_user', { p_user: u.id, p_username: nu, p_display_name: nn }); })
          .then(function (r) {
            u.username = r.username; u.display_name = r.display_name; changed = true;
            headName.textContent = u.display_name; headUser.textContent = '@' + u.username;
            nameBox.querySelector('#mu-user').value = u.username;
            say(nameOk, old !== u.username
              ? (internal ? 'Saved. ' + old + ' now signs in as ' + u.username + '.' : 'Saved. Shown as @' + u.username + ' from now on.')
              : 'Saved.');
            if (self) setTimeout(function () { window.location.reload(); }, 900);
          }, function (ex) { say(nameErr, Api.errorMessage(ex)); });
      } } })));

    var parts = [head, nameBox];

    if (!limited) {
      // password
      var passErr = note('danger'), passOk = note('success');
      var must = el('input', { type: 'checkbox', id: 'mu-must', checked: true });
      var passBox = el('div', { class: 'stack' },
        el('h3', { class: 'section-title', text: 'Password' }),
        field('pass', 'New password', '', 'At least 10 characters with lower case, upper case and a digit. Tell it to the person by voice, not in writing.', { autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' }),
        el('label', { class: 'check', for: 'mu-must' }, must, 'Ask for a new password at the next sign-in (recommended)'),
        passErr, passOk,
        el('div', { class: 'row between' },
          el('button', { class: 'btn', type: 'button', text: 'Generate', on: { click: function () { passBox.querySelector('#mu-pass').value = makePassword(); } } }),
          el('button', { class: 'btn primary', type: 'button', id: 'mu-setpass', text: 'Set password', on: { click: function (e) {
            var p = passBox.querySelector('#mu-pass').value; passErr.hidden = true; passOk.hidden = true;
            if (!Api.auth.validPassword(p)) return say(passErr, Api.messages.WEAK_PASSWORD);
            Core.busy(e.currentTarget, function () { return Api.rpc('core_admin_set_password', { p_user: u.id, p_password: p, p_must_change: must.checked }); })
              .then(function () {
                changed = true;
                say(passOk, 'Password set. ' + u.username + ' is signed out everywhere' + (must.checked ? ' and must choose a new password at the next sign-in.' : '.'));
              }, function (ex) { say(passErr, Api.errorMessage(ex)); });
          } } })));
      parts.push(passBox);

      // account: disable / enable, delete
      var accErr = note('danger');
      var statusBtn = el('button', { class: 'btn' + (u.status === 'active' ? ' danger' : ''), type: 'button', id: 'mu-status',
        text: u.status === 'active' ? 'Disable' : u.status === 'pending' ? 'Approve' : 'Enable', on: { click: function (e) {
          var to = u.status === 'active' ? 'disabled' : 'active'; accErr.hidden = true;
          Core.busy(e.currentTarget, function () { return Api.rpc('core_admin_set_status', { p_user: u.id, p_status: to }); })
            .then(function () {
              u.status = to; changed = true;
              var nb = badge(to); headBadge.parentNode.replaceChild(nb, headBadge); headBadge = nb;
              statusBtn.textContent = to === 'active' ? 'Disable' : 'Enable'; statusBtn.className = 'btn' + (to === 'active' ? ' danger' : '');
              Core.toast(to === 'active' ? u.username + ' is active' : u.username + ' is disabled and signed out');
            }, function (ex) { say(accErr, Api.errorMessage(ex)); });
        } } });
      var confirmInput = el('input', { id: 'mu-confirm', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Type the username to confirm' });
      var delGo = el('button', { class: 'btn danger', type: 'button', id: 'mu-delete-go', text: 'Delete for good', disabled: true, on: { click: function (e) {
        accErr.hidden = true;
        Core.busy(e.currentTarget, function () { return Api.rpc('core_admin_delete_user', { p_user: u.id, p_confirm: confirmInput.value }); })
          .then(function () { changed = true; Core.toast('Deleted ' + u.username, 'success'); close(); },
            function (ex) { say(accErr, Api.errorMessage(ex)); });
      } } });
      confirmInput.addEventListener('input', function () { delGo.disabled = confirmInput.value.trim().toLowerCase() !== u.username; });
      var delBox = el('div', { class: 'notice danger stack', hidden: true },
        el('div', null, 'This removes the account, its sign-in and all its tile access. What ', el('strong', { text: u.username }),
          ' wrote in tiles stays, and the username cannot be given to anyone else. It cannot be undone.'),
        el('div', { class: 'field' }, el('label', { for: 'mu-confirm', text: 'Type ' + u.username + ' to confirm' }), confirmInput),
        el('div', { class: 'row end' }, delGo));
      var accBox = el('div', { class: 'stack' },
        el('h3', { class: 'section-title', text: 'Account' }),
        el('p', { class: 'muted', text: 'Disable signs the person out at once and can be undone. Delete cannot.' }),
        el('div', { class: 'row between' }, statusBtn,
          el('button', { class: 'btn danger', type: 'button', id: 'mu-delete', text: 'Delete account', on: { click: function () {
            delBox.hidden = !delBox.hidden; if (!delBox.hidden) { confirmInput.value = ''; delGo.disabled = true; confirmInput.focus(); }
          } } })),
        delBox, accErr);
      parts.push(accBox);
    } else {
      parts.push(el('p', { class: 'muted', text: self
        ? 'Your own password is changed on the Account page.'
        : 'A super user\'s password and account are managed in the SQL editor (RUNBOOK).' }));
    }

    Core.sheet({ title: 'Manage ' + u.display_name, body: el('div', { class: 'stack' }, parts),
      actions: [{ label: 'Close', value: true }], onOpen: function (box) { sheetBox = box; } })
      .then(function () { if (changed) { loadUsers(); countRequests(); } });
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
          el('td', null, el('div', { class: 'row' }, el('span', { class: 'icon i-' + icon, 'aria-hidden': 'true', 'data-accent': Core.accent(t.accent) }), el('div', null, el('div', null, el('strong', { text: t.name })), el('div', { class: 'faint mono', text: '/' + t.id + '/' })))),
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
    t = t || { id: '', name: '', tagline: '', icon: 'tile', accent: 'blue', sort_order: 100, rights: [] };
    function field(id, label, value, hint, attrs) {
      var input = el('input', Object.assign({ id: 'tf-' + id, value: value }, attrs || {}));
      return el('div', { class: 'field' }, el('label', { for: 'tf-' + id, text: label }), input, hint ? el('span', { class: 'hint', text: hint }) : null);
    }
    var iconSel = el('select', { id: 'tf-icon' });
    Core.ICONS.forEach(function (i) { iconSel.appendChild(el('option', { value: i, text: i, selected: i === t.icon })); });
    var accentSel = el('select', { id: 'tf-accent' });
    Core.ACCENTS.forEach(function (c) { accentSel.appendChild(el('option', { value: c, text: c, selected: c === t.accent })); });
    var swatch = el('span', { class: 'icon i-' + t.icon, 'aria-hidden': 'true', 'data-accent': Core.accent(t.accent) });
    function preview() { swatch.className = 'icon i-' + iconSel.value; swatch.setAttribute('data-accent', accentSel.value); }
    iconSel.addEventListener('change', preview); accentSel.addEventListener('change', preview);
    var err = el('p', { class: 'notice danger', hidden: true });
    var body = el('div', null,
      field('id', 'Tile id', t.id, 'Lower case, digits and dashes; the repo name and the path /<tile-id>/. Cannot change later.', { maxlength: 30, disabled: !isNew, autocapitalize: 'none', spellcheck: 'false' }),
      field('name', 'Name', t.name, null, { maxlength: 40 }),
      field('tagline', 'Tagline', t.tagline, 'Neutral, one line.', { maxlength: 80 }),
      el('div', { class: 'row' },
        el('div', { class: 'field grow' }, el('label', { for: 'tf-icon', text: 'Icon' }), iconSel),
        el('div', { class: 'field grow' }, el('label', { for: 'tf-accent', text: 'Colour' }), accentSel, el('span', { class: 'hint', text: 'The tile\'s hue on the dashboard and inside it.' })),
        el('div', { class: 'field' }, el('label', { text: 'Preview' }), swatch)),
      field('order', 'Order', String(t.sort_order), 'Lower comes first on the dashboard.', { type: 'number', min: 0, max: 9999 }),
      field('rights', 'Rights', t.rights.join(', '), 'Comma-separated, as declared in the tile\'s docs/TILE.md (e.g. edit, export). Removing one removes it from every user.', { autocapitalize: 'none', spellcheck: 'false' }),
      err);
    Core.sheet({ title: isNew ? 'New tile' : 'Edit ' + t.name, body: body, actions: [
      { label: 'Cancel', value: false },
      { label: 'Save', kind: 'primary', onClick: function () {
        var params = { p_id: isNew ? body.querySelector('#tf-id').value : t.id, p_name: body.querySelector('#tf-name').value,
          p_tagline: body.querySelector('#tf-tagline').value, p_icon: iconSel.value, p_accent: accentSel.value,
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
