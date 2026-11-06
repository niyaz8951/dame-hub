/* Admin page: requests, users, groups, tiles, access, audit, health. Super user only. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  var tilesCache = [];

  Core.requireLogin({ super: true, page: 'Admin' }).then(function () {
    // tabs
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role=tab]'));
    function showTab(name) {
      tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); $('#tab-' + b.dataset.tab).hidden = b.dataset.tab !== name; });
      var sel = tabs.filter(function (b) { return b.dataset.tab === name; })[0];
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // phones: the tab row scrolls sideways
      if (name === 'requests') loadRequests();
      if (name === 'users') loadUsers();
      if (name === 'groups') loadGroups();
      if (name === 'tiles') loadTiles();
      if (name === 'audit') loadAudit(true);
      if (name === 'health') loadHealth();
      if (window.location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    }
    tabs.forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
    var start = window.location.hash.replace('#', '');
    showTab(['requests', 'users', 'groups', 'tiles', 'audit', 'health'].indexOf(start) >= 0 ? start : 'requests');
    countRequests();
    if (start !== 'health') loadHealth(true);
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

    var parts = [head, nameBox, accessBox(u, function () { changed = true; })];

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

  // Users > Manage > Access: Check access (every tile, group and shared item, and why) and Handover.
  function accessBox(u, onChange) {
    var box = el('div', { class: 'stack' }, el('h3', { class: 'section-title', text: 'Access' }));
    var out = el('div', { class: 'stack', id: 'mu-access' });
    box.appendChild(out);
    function draw() {
      Core.clear(out); out.appendChild(el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), 'Loading'));
      Api.rpc('core_admin_check_access', { p_user: u.id }).then(function (a) {
        Core.clear(out);
        out.appendChild(el('p', { class: 'muted', text: a.groups.length ? 'Groups: ' + a.groups.map(function (g) { return g.name; }).join(', ') + '.' : 'In no group.' }));
        if (!a.tiles.length) out.appendChild(el('p', { class: 'faint', text: 'No tile.' }));
        else {
          var tl = el('div', { class: 'plist' });
          a.tiles.forEach(function (t) {
            var why = [];
            if (a.user.is_super) why.push('super user');
            else {
              if (t.own) why.push('own ' + Core.LEVEL_NAMES[t.own]);
              (t.via || []).forEach(function (v) { why.push(Core.LEVEL_NAMES[v.level] + ' through ' + v.group); });
            }
            if (t.rights && t.rights.length) why.push('rights ' + t.rights.join(', '));
            if (t.owns) why.push('owns ' + t.owns);
            if (t.shared) why.push(t.shared + ' shared with him');
            tl.appendChild(el('div', { class: 'pitem', dataset: { tile: t.id } },
              el('div', { class: 'grow' }, el('span', { class: 'n', text: t.name + (t.enabled ? '' : ' (off)') }), el('span', { class: 'u', text: why.join(' - ') || '-' })),
              el('span', { class: 'badge' + (t.level ? '' : ' warning'), text: t.level ? Core.LEVEL_NAMES[t.level] : 'No access' })));
          });
          out.appendChild(tl);
        }
        if (a.owns.length) {
          out.appendChild(el('p', { class: 'muted', text: 'Owns ' + a.owns.length + ': ' + a.owns.slice(0, 12).map(function (c) { return c.name + ' (' + c.tile + ')'; }).join(', ') + (a.owns.length > 12 ? ' ...' : '') }));
          var to = el('select', { id: 'mu-handover-to', 'aria-label': 'Hand over to' }, el('option', { value: '', text: 'Hand everything over to ...' }));
          usersAll.filter(function (x) { return x.status === 'active' && x.id !== u.id; }).forEach(function (x) { to.appendChild(el('option', { value: x.id, text: x.display_name + ' (@' + x.username + ')' })); });
          var go = el('button', { class: 'btn', type: 'button', id: 'mu-handover', text: 'Hand over', on: { click: function () {
            if (!to.value) { Core.toast('Choose who takes them over.'); return; }
            Core.busy(go, function () { return Api.rpc('core_admin_handover', { p_from: u.id, p_to: to.value, p_tile: null }); })
              .then(function (r) {
                onChange();
                Core.toast(r.moved + ' handed over', 'success');
                if (r.without_access && r.without_access.length) Core.toast('The new owner has no access to: ' + r.without_access.join(', ') + '. Give it in Tiles > Access.', 'danger');
                draw();
              }).catch(Core.showError);
          } } });
          out.appendChild(el('div', { class: 'row' }, el('div', { class: 'grow' }, to), go));
        } else out.appendChild(el('p', { class: 'faint', text: 'Owns nothing in the tiles.' }));
      }).catch(function (err) { Core.clear(out); out.appendChild(Access.notReady(err) || el('p', { class: 'notice danger', text: Api.errorMessage(err) })); });
    }
    draw();
    return box;
  }

  // ---------- groups ----------
  function loadGroups() {
    var host = $('#groups'); loading(host);
    var need = usersAll.length ? Promise.resolve(usersAll) : Api.rpc('core_admin_users', { p_status: null }).then(function (r) { usersAll = r; return r; });
    Promise.all([Api.rpc('core_admin_groups', {}), need]).then(function (res) {
      var groups = res[0];
      Core.clear(host);
      if (!groups.length) { host.appendChild(el('div', { class: 'state' }, el('h2', { text: 'No groups yet' }), el('p', { text: 'Make one for each team or region that works the same way, then give it a level on the tiles it needs.' }))); return; }
      groups.forEach(function (g) {
        var members = g.members.length ? g.members.map(function (m) { return m.display_name + (m.status === 'active' ? '' : ' (' + m.status + ')'); }).join(', ') : 'No members yet';
        host.appendChild(el('div', { class: 'card tight stack', dataset: { group: g.name } },
          el('div', { class: 'row between' },
            el('div', { class: 'grow' }, el('strong', { text: g.name }), g.note ? el('span', { class: 'faint', text: ' - ' + g.note }) : null),
            el('span', { class: 'badge', text: g.members.length + (g.members.length === 1 ? ' person' : ' people') })),
          el('div', { class: 'muted', text: members }),
          el('div', { class: 'faint', text: (g.tiles.length ? 'Tiles: ' + g.tiles.map(function (t) { return t.name + ' ' + Core.LEVEL_NAMES[t.level]; }).join(', ') : 'No tile yet (Tiles > Access).') +
            (g.shares ? ' - shared items: ' + g.shares : '') }),
          el('div', { class: 'row end' },
            el('button', { class: 'btn small', type: 'button', text: 'Members', on: { click: function () { groupMembers(g); } } }),
            el('button', { class: 'btn small', type: 'button', text: 'Edit', on: { click: function () { groupForm(g); } } }),
            el('button', { class: 'btn small danger', type: 'button', text: 'Delete', on: { click: function () { groupDelete(g); } } }))));
      });
    }).catch(function (err) { var n = Access.notReady(err); if (n) { Core.clear(host); host.appendChild(n); } else fail(host, err); });
  }
  $('#group-new').addEventListener('click', function () { groupForm(null); });

  function groupForm(g) {
    var err = el('p', { class: 'notice danger', hidden: true });
    var name = el('input', { id: 'gf-name', maxlength: 40, value: g ? g.name : '', autocomplete: 'off' });
    var note = el('input', { id: 'gf-note', maxlength: 200, value: g ? g.note : '', autocomplete: 'off' });
    var body = el('div', null,
      el('div', { class: 'field' }, el('label', { for: 'gf-name', text: 'Name' }), name, el('span', { class: 'hint', text: '2 to 40 characters, e.g. Application, Sales KSA.' })),
      el('div', { class: 'field' }, el('label', { for: 'gf-note', text: 'Note' }), note, el('span', { class: 'hint', text: 'Optional, one line: who belongs in it.' })),
      err);
    Core.sheet({ title: g ? 'Edit ' + g.name : 'New group', body: body, actions: [
      { label: 'Cancel', value: false },
      { label: 'Save', kind: 'primary', onClick: function () {
        err.hidden = true;
        return Api.rpc('core_admin_group_save', { p_id: g ? g.id : null, p_name: name.value, p_note: note.value })
          .then(function (r) { Core.toast('Saved', 'success'); loadGroups(); if (!g) groupMembers({ id: r.id, name: r.name, members: [] }); return true; },
            function (ex) { err.textContent = Api.errorMessage(ex); err.hidden = false; return false; });
      } }] });
  }

  function groupMembers(g) {
    var chosen = {};
    g.members.forEach(function (m) { chosen[m.id] = true; });
    var find = el('input', { placeholder: 'Find a person', 'aria-label': 'Find a person' });
    var list = el('div', { class: 'plist', id: 'gm-list' });
    var count = el('p', { class: 'muted' });
    function draw() {
      Core.clear(list);
      var q = find.value.trim().toLowerCase();
      var people = usersAll.filter(function (u) { return u.status !== 'pending' && (!q || u.username.indexOf(q) >= 0 || u.display_name.toLowerCase().indexOf(q) >= 0); });
      people.forEach(function (u) {
        var box = el('input', { type: 'checkbox', id: 'gm-' + u.id, checked: !!chosen[u.id] });
        box.addEventListener('change', function () { if (box.checked) chosen[u.id] = true; else delete chosen[u.id]; counter(); });
        list.appendChild(el('label', { class: 'pitem', for: 'gm-' + u.id, dataset: { name: u.username } }, box,
          el('div', { class: 'grow' }, el('span', { class: 'n', text: u.display_name }), el('span', { class: 'u', text: '@' + u.username + (u.status === 'active' ? '' : ' - ' + u.status) }))));
      });
      if (!people.length) list.appendChild(el('p', { class: 'faint', text: 'Nobody matches.' }));
    }
    function counter() { var n = Object.keys(chosen).length; count.textContent = n + (n === 1 ? ' member' : ' members') + ' chosen.'; }
    find.addEventListener('input', draw);
    draw(); counter();
    var err = el('p', { class: 'notice danger', hidden: true });
    Core.sheet({ title: 'Members of ' + g.name, body: el('div', { class: 'stack' }, find, count, list, err), actions: [
      { label: 'Cancel', value: false },
      { label: 'Save', kind: 'primary', onClick: function () {
        err.hidden = true;
        return Api.rpc('core_admin_group_members_set', { p_group: g.id, p_users: Object.keys(chosen) })
          .then(function () { Core.toast('Members saved', 'success'); loadGroups(); return true; },
            function (ex) { err.textContent = Api.errorMessage(ex); err.hidden = false; return false; });
      } }] });
  }

  function groupDelete(g) {
    var input = el('input', { id: 'gd-confirm', autocomplete: 'off', 'aria-label': 'Type the group name to confirm' });
    var err = el('p', { class: 'notice danger', hidden: true });
    Core.sheet({ title: 'Delete ' + g.name, body: el('div', { class: 'stack' },
      el('p', { text: 'The group\'s levels on tiles and everything shared with the group go with it. Its members keep their own access. It cannot be undone.' }),
      el('div', { class: 'field' }, el('label', { for: 'gd-confirm', text: 'Type ' + g.name + ' to confirm' }), input), err), actions: [
      { label: 'Cancel', value: false },
      { label: 'Delete', kind: 'danger', onClick: function () {
        err.hidden = true;
        return Api.rpc('core_admin_group_delete', { p_id: g.id, p_confirm: input.value })
          .then(function () { Core.toast('Deleted ' + g.name, 'success'); loadGroups(); return true; },
            function (ex) { err.textContent = Api.errorMessage(ex); err.hidden = false; return false; });
      } }] });
  }

  // ---------- tiles ----------
  function loadTiles() {
    var host = $('#tiles'); loading(host);
    Api.rpc('core_admin_tiles').then(function (rows) {
      tilesCache = rows; Core.clear(host);
      if (!rows.length) { host.appendChild(el('p', { class: 'state', text: 'No tiles yet. Register the first one with "New tile".' })); return; }
      var table = el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Tile' }), el('th', { text: 'On' }), el('th', { text: 'Access' }), el('th', { text: 'Given to' }), el('th', { text: 'Managers' }), el('th'))));
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
          el('td', null, declared(t) ? el('span', { class: 'badge success', text: 'Declared' }) : el('span', { class: 'badge warning', title: 'The tile has not run core.tile_declare yet', text: 'Not declared' }),
            t.rights.length ? el('div', { class: 'faint', text: 'Rights: ' + t.rights.join(', ') }) : null,
            t.containers ? el('div', { class: 'faint', text: t.containers + ' shared item' + (t.containers === 1 ? '' : 's') }) : null),
          el('td', { text: t.users + (t.users === 1 ? ' person' : ' people') + (t.groups ? ', ' + t.groups + (t.groups === 1 ? ' group' : ' groups') : '') }),
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
  function declared(t) { return t.access && Object.keys(t.access).length > 0; }

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
      declared(t)
        ? el('div', { class: 'field' }, el('label', { text: 'Access' }),
            el('p', { class: 'muted', text: 'Declared by the tile (levels, aliases' + (t.rights.length ? ', special rights ' + t.rights.join(', ') : '') + '). It changes only through the tile\'s own SQL file (core.tile_declare).' }),
            el('input', { type: 'hidden', id: 'tf-rights', value: t.rights.join(', ') }))
        : field('rights', 'Rights', t.rights.join(', '), 'Only until the tile declares itself (core.tile_declare). Comma-separated. Removing one removes it from every person and group.', { autocapitalize: 'none', spellcheck: 'false' }),
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
    Core.sheet({ title: 'Access to ' + t.name, body: Access.panel(t.id), actions: [{ label: 'Done', value: true }] }).then(function () { loadTiles(); });
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
  // ---------- health: security check + SQL files waiting to run ----------
  // Each repo publishes db/migrations.json (docs/TILE-CONTRACT.md, "SQL list"); core.migrations says what ran.
  function getList(base) {
    return fetch(base + 'db/migrations.json', { cache: 'no-cache', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && typeof j.repo === 'string' && Array.isArray(j.files) ? j : null; }, function () { return null; });
  }
  function sqlState(applied, tiles) {
    var ran = {};
    applied.forEach(function (m) { ran[m.repo + '/' + m.name] = m.applied_at; });
    var repos = [{ id: 'dame-hub', name: 'Core', base: '/dame-hub/' }].concat(tiles.map(function (t) { return { id: t.id, name: t.name, base: Core.tilePath(t.id) }; }));
    return Promise.all(repos.map(function (r) { return getList(r.base); })).then(function (lists) {
      return repos.map(function (r, i) {
        var list = lists[i], repo = list ? list.repo : r.id;
        var waiting = list ? list.files.filter(function (f) { return !f.superseded && !ran[repo + '/' + f.name]; }) : [];
        var listed = {};
        if (list) list.files.forEach(function (f) { listed[f.name] = true; });
        var ranCount = applied.filter(function (m) { return m.repo === repo; }).length;
        var unlisted = list ? applied.filter(function (m) { return m.repo === repo && !listed[m.name]; }) : [];
        return { repo: r, list: list, waiting: waiting, ranCount: ranCount, unlisted: unlisted };
      });
    });
  }
  function setHealthCount(n) { var c = $('#count-health'); c.textContent = String(n); c.hidden = !n; }

  function loadHealth(countOnly) {
    var hostCheck = $('#health-check'), hostSql = $('#health-sql');
    if (!countOnly) { loading(hostCheck); Core.clear(hostSql); }
    return Promise.all([Api.rpc('core_admin_health', {}), Api.rpc('core_admin_tiles', {})]).then(function (res) {
      var h = res[0], tiles = res[1] || [];
      return sqlState(h.applied || [], tiles).then(function (repos) {
        var waiting = repos.reduce(function (n, r) { return n + r.waiting.length; }, 0);
        var problems = h.last ? h.last.problems : 0;
        setHealthCount(problems + waiting);
        if (!countOnly) { renderCheck(hostCheck, h); renderSql(hostSql, repos, waiting); }
      });
    }).catch(function (err) {
      if (countOnly) return;
      if (err && err.code === 'NOT_FOUND') {   // 010_health.sql not applied yet
        Core.clear(hostCheck);
        hostCheck.appendChild(el('div', { class: 'notice warning' },
          el('strong', { text: 'Health is not set up yet. ' }),
          'Apply ', el('a', { href: '/dame-hub/db/core/010_health.sql', text: 'db/core/010_health.sql' }), ' in the Supabase SQL editor, then reload this page.'));
        return;
      }
      fail(hostCheck, err);
    });
  }

  function renderCheck(host, h) {
    Core.clear(host);
    var last = h.last, ok = last && last.problems === 0;
    var nightly = h.nightly === true ? el('span', { class: 'badge success', text: 'Nightly check on' })
      : el('span', { class: 'badge warning', text: h.nightly === false ? 'Nightly check off' : 'Nightly check not installed' });
    var status = !last ? el('span', { class: 'badge', text: 'Never run' })
      : ok ? el('span', { class: 'badge success', text: 'Clean' })
      : el('span', { class: 'badge danger', text: last.problems + (last.problems === 1 ? ' problem' : ' problems') });
    var run = el('button', { class: 'btn primary', type: 'button', id: 'health-run', text: 'Run check now', on: { click: function (e) {
      Core.busy(e.currentTarget, function () { return Api.rpc('core_admin_health_run', {}); })
        .then(function (r) { Core.toast(r.last && r.last.problems ? 'Check found ' + r.last.problems + ' problem(s)' : 'Check is clean', r.last && r.last.problems ? 'danger' : 'success'); loadHealth(); })
        .catch(Core.showError);
    } } });
    var card = el('div', { class: 'card' },
      el('div', { class: 'row between' },
        el('div', { class: 'grow' },
          el('h2', { text: 'Security check' }),
          el('p', { class: 'muted', text: last ? 'Last run ' + Core.dateTime(last.ran_at) + ' (' + ({ nightly: 'nightly', admin: 'from this page', sql: 'SQL editor' }[last.source] || last.source) + ').' : 'Not run yet.' })),
        el('div', { class: 'row' }, status, nightly)),
      el('p', { class: 'muted', text: 'core.security_check() looks for anything that would weaken the wall: a table without RLS, something other than a function in public, a function open to signed-out visitors, a public bucket, a policy for anon. It must be clean. The Supabase Security Advisor is still checked by hand after every SQL file.' }));
    if (last && last.problems) {
      var table = el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Problem' }), el('th', { text: 'Object' }))), el('tbody'));
      last.detail.forEach(function (d) { table.tBodies[0].appendChild(el('tr', null, el('td', { text: d.problem }), el('td', { class: 'mono', text: d.object }))); });
      card.appendChild(el('div', { class: 'table-wrap' }, table));
      card.appendChild(el('p', { class: 'notice danger', text: 'Fix before anything else: switch off the tile that owns the object (Tiles), then tell the admin project which object is listed.' }));
    }
    if (h.failed_runs_30d && ok) card.appendChild(el('p', { class: 'muted', text: h.failed_runs_30d + ' earlier run(s) in the last 30 days found problems (see Audit, action security_check_problems).' }));
    if (h.nightly !== true) card.appendChild(el('p', { class: 'notice warning', text: 'Nightly check: Supabase > Integrations > Cron > enable, then run the "schedule" block at the end of db/core/010_health.sql again.' }));
    card.appendChild(el('div', { class: 'row end' }, run));
    host.appendChild(card);
  }

  function renderSql(host, repos, waiting) {
    var card = el('div', { class: 'card' },
      el('div', { class: 'row between' },
        el('h2', { class: 'grow', text: 'SQL files' }),
        waiting ? el('span', { class: 'badge danger', text: waiting + ' waiting' }) : el('span', { class: 'badge success', text: 'All applied' })),
      el('p', { class: 'muted', text: 'Files each repo lists in db/migrations.json that have not run on this database yet. Run them in the order shown (core first), read each one before it runs, then Run check now.' }));
    var table = el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Repo' }), el('th', { text: 'State' }), el('th', { text: 'Waiting, in order' }))), el('tbody'));
    repos.forEach(function (r) {
      var state, files = el('td');
      if (!r.list) state = el('span', { class: 'badge warning', text: 'No list' + (r.ranCount ? ' (' + r.ranCount + ' ran)' : '') });
      else if (r.waiting.length) state = el('span', { class: 'badge danger', text: r.waiting.length + ' waiting' });
      else state = el('span', { class: 'badge success', text: r.list.files.length ? 'Up to date' : 'No SQL' });
      r.waiting.forEach(function (f, i) {
        files.appendChild(el('div', null, el('a', { class: 'mono', href: r.repo.base + f.path, target: '_blank', rel: 'noopener', text: f.path }), i === 0 ? el('span', { class: 'faint', text: '  next' }) : null));
      });
      if (!r.list) files.appendChild(el('span', { class: 'faint', text: 'The tile publishes db/migrations.json on its next delivery.' }));
      r.unlisted.forEach(function (m) { files.appendChild(el('div', { class: 'faint', text: m.name + ' ran but is not in the list' })); });
      table.tBodies[0].appendChild(el('tr', null, el('td', null, el('strong', { text: r.repo.name }), ' ', el('span', { class: 'faint mono', text: r.repo.id })), el('td', null, state), files));
    });
    card.appendChild(el('div', { class: 'table-wrap' }, table));
    host.appendChild(card);
  }

  $('#audit-go').addEventListener('click', function () { loadAudit(true); });
  $('#audit-more').addEventListener('click', function () { loadAudit(false); });
})();
