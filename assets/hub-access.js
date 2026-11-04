/* Access panel for one tile: who may open it, with which rights, who is tile admin.
   Used by admin.html (super user) and access.html (tile admins). */
window.Access = (function () {
  'use strict';
  var el = Core.el;

  // Returns a node; reloads itself after each change.
  function panel(tile, canName) {
    var root = el('div', { class: 'stack' });
    var info = el('p', { class: 'muted' });
    var wrap = el('div', { class: 'table-wrap' });
    root.appendChild(info); root.appendChild(wrap);
    var rights = tile.rights || [];

    function load() {
      Core.clear(wrap);
      wrap.appendChild(el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), 'Loading'));
      return Api.rpc('core_tile_users', { p_tile: tile.id }).then(render).catch(function (err) {
        Core.clear(wrap); wrap.appendChild(el('p', { class: 'notice danger', text: Api.errorMessage(err) }));
      });
    }

    function save(u, access, newRights, admin, btn) {
      var params = { p_tile: tile.id, p_user: u.id, p_access: access, p_rights: newRights, p_admin: canName ? admin : null };
      return (btn ? Core.busy(btn, function () { return Api.rpc('core_tile_access_set', params); }) : Api.rpc('core_tile_access_set', params))
        .then(function () { Core.toast('Saved', 'success'); return load(); })
        .catch(function (err) { Core.showError(err); return load(); });
    }

    function render(users) {
      Core.clear(wrap);
      var withAccess = users.filter(function (u) { return u.has_access; }).length;
      info.textContent = withAccess + ' of ' + users.length + ' active users have ' + tile.name + '.' +
        (rights.length ? ' Rights: ' + rights.join(', ') + '.' : ' This tile declares no rights.') +
        (canName ? ' A tile admin gives access and rights to users and has every right of the tile.' : '');
      if (!users.length) { wrap.appendChild(el('p', { class: 'state', text: 'No active users yet.' })); return; }
      var table = el('table');
      var head = el('tr', null, el('th', { text: 'User' }), el('th', { text: 'Access' }));
      if (rights.length) head.appendChild(el('th', { text: 'Rights' }));
      if (canName) head.appendChild(el('th', { text: 'Tile admin' }));
      table.appendChild(el('thead', null, head));
      var body = el('tbody');
      users.forEach(function (u) {
        var tr = el('tr');
        tr.appendChild(el('td', null, el('div', { text: u.display_name }), el('div', { class: 'faint mono', text: '@' + u.username })));
        var sw = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(u.has_access), 'aria-label': 'Access for ' + u.username,
          on: { click: function () { sw.disabled = true; save(u, !u.has_access, u.has_access ? null : [], null); } } });
        tr.appendChild(el('td', null, sw));
        if (rights.length) {
          var chips = el('div', { class: 'chips' });
          rights.forEach(function (r) {
            var on = u.is_admin || u.rights.indexOf(r) >= 0;
            chips.appendChild(el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), text: r, disabled: !u.has_access || u.is_admin,
              title: u.is_admin ? 'Tile admins have every right' : '',
              on: { click: function (e) {
                var list = u.rights.slice();
                if (on) list = list.filter(function (x) { return x !== r; }); else list.push(r);
                save(u, true, list, null, e.currentTarget);
              } } }));
          });
          tr.appendChild(el('td', null, chips));
        }
        if (canName) {
          var adminSw = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(u.is_admin), disabled: !u.has_access, 'aria-label': 'Tile admin ' + u.username,
            on: { click: function () { adminSw.disabled = true; save(u, true, null, !u.is_admin); } } });
          tr.appendChild(el('td', null, adminSw));
        }
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);
    }

    load();
    return root;
  }

  return { panel: panel };
})();
