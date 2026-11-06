/* Access to one tile: the level of each person and group (read, contribute, edit, approve, manage) and the tile's
   special rights. Used by admin.html (super user) and access.html (the tile's managers). The database decides
   (core_tile_access_list / core_tile_level_set); only the super user gives or takes Manage. */
window.Access = (function () {
  'use strict';
  var el = Core.el;

  // Before db/core/011_access.sql has run, its functions do not exist (404 -> NOT_FOUND).
  function notReady(err) {
    if (!err || err.code !== 'NOT_FOUND' || !/does not exist/.test(err.message || '')) return null;
    return el('p', { class: 'notice warning' }, el('strong', { text: 'Access by level is not set up yet. ' }),
      'Apply ', el('a', { href: '/dame-hub/db/core/011_access.sql', text: 'db/core/011_access.sql' }), ' in the Supabase SQL editor, then reload this page.');
  }

  function levelSelect(current, allowManage, label) {
    var sel = el('select', { class: 'lvl', 'aria-label': label }, el('option', { value: '', text: 'No access' }));
    Core.LEVELS.forEach(function (l) {
      if (l === 'manage' && !allowManage && current !== 'manage') return;
      sel.appendChild(el('option', { value: l, text: Core.LEVEL_NAMES[l] }));
    });
    sel.value = current || '';
    return sel;
  }

  // Returns a node; reloads itself after each change.
  function panel(tile) {
    var tileId = typeof tile === 'string' ? tile : tile.id;
    var root = el('div', { class: 'stack' });
    var host = el('div');
    root.appendChild(host);
    var filter = '';

    function load() {
      Core.clear(host);
      host.appendChild(el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), 'Loading'));
      return Api.rpc('core_tile_access_list', { p_tile: tileId }).then(render).catch(function (err) {
        Core.clear(host); host.appendChild(notReady(err) || el('p', { class: 'notice danger', text: Api.errorMessage(err) }));
      });
    }

    function save(type, id, level, rights, ctl) {
      if (ctl) ctl.disabled = true;
      return Api.rpc('core_tile_level_set', { p_tile: tileId, p_type: type, p_id: id, p_level: level || null, p_rights: rights || null })
        .then(function () { Core.toast('Saved', 'success'); return load(); })
        .catch(function (err) { Core.showError(err); return load(); });
    }

    function render(d) {
      Core.clear(host);
      var t = d.tile, decl = t.access || {}, specials = t.rights || [], meanings = decl.levels || {}, rightNotes = decl.rights || {};
      var canName = d.can_name_managers;
      var withAccess = d.people.filter(function (p) { return p.effective; }).length;
      var groupsIn = d.groups.filter(function (g) { return g.level; }).length;
      host.appendChild(el('p', { class: 'muted', text: withAccess + ' of ' + d.people.length + ' active people and ' + groupsIn + ' of ' + d.groups.length +
        ' groups have ' + t.name + '. A person\'s level is the highest of his own and his groups\'. ' +
        (canName ? 'Only you name managers.' : 'Only the super user names managers.') }));

      // what the levels mean here
      var legend = el('dl', { class: 'lvl-legend' });
      Core.LEVELS.forEach(function (l) {
        legend.appendChild(el('dt', { text: Core.LEVEL_NAMES[l] }));
        legend.appendChild(el('dd', { text: meanings[l] || Core.LEVEL_HINTS[l] }));
      });
      specials.forEach(function (r) {
        legend.appendChild(el('dt', { class: 'mono', text: r }));
        legend.appendChild(el('dd', { text: (rightNotes[r] || 'Special right') + ' (given one by one)' }));
      });
      host.appendChild(el('details', null, el('summary', { text: 'What the levels mean in ' + t.name }), legend,
        decl.levels ? null : el('p', { class: 'faint', text: 'This tile has not described its levels yet; the general meanings are shown.' })));

      function chips(rights, level, onChange) {
        if (!specials.length || !level) return null;
        var box = el('div', { class: 'chips' });
        specials.forEach(function (r) {
          var on = level === 'manage' || rights.indexOf(r) >= 0;
          box.appendChild(el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), text: r, disabled: level === 'manage',
            title: level === 'manage' ? 'Managers hold every right' : (rightNotes[r] || ''),
            on: { click: function (e) {
              var list = rights.filter(function (x) { return x !== r; });
              if (!on) list.push(r);
              onChange(list, e.currentTarget);
            } } }));
        });
        return box;
      }

      // groups
      host.appendChild(el('h3', { class: 'section-title', text: 'Groups' }));
      if (!d.groups.length) host.appendChild(el('p', { class: 'faint', text: canName ? 'No groups yet (Admin > Groups).' : 'No groups yet.' }));
      else {
        var gl = el('div', { class: 'plist' });
        d.groups.forEach(function (g) {
          var lockedManage = g.level === 'manage' && !canName;
          var sel = levelSelect(g.level, canName, 'Level of group ' + g.name);
          sel.disabled = lockedManage;
          sel.addEventListener('change', function () { save('group', g.id, sel.value, null, sel); });
          gl.appendChild(el('div', { class: 'pitem', dataset: { type: 'group', name: g.name } },
            el('span', { class: 'avatar group', 'aria-hidden': 'true', text: Core.initials(g.name) }),
            el('div', { class: 'grow' }, el('span', { class: 'n', text: g.name }),
              el('span', { class: 'u', text: g.members + (g.members === 1 ? ' person' : ' people') + (g.note ? ' - ' + g.note : '') }),
              chips(g.rights, g.level, function (list, btn) { save('group', g.id, g.level, list, btn); })),
            sel));
        });
        host.appendChild(gl);
      }

      // people
      var head = el('div', { class: 'row between' }, el('h3', { class: 'section-title', text: 'People' }));
      var find = el('input', { placeholder: 'Find a person', 'aria-label': 'Find a person', value: filter });
      head.appendChild(el('div', { class: 'grow' }, find));
      host.appendChild(head);
      var pl = el('div', { class: 'plist', id: 'access-people' });
      host.appendChild(pl);
      function drawPeople() {
        Core.clear(pl);
        var q = filter.trim().toLowerCase();
        var rows = d.people.filter(function (p) { return !q || p.username.indexOf(q) >= 0 || p.display_name.toLowerCase().indexOf(q) >= 0; });
        if (!rows.length) { pl.appendChild(el('p', { class: 'faint', text: d.people.length ? 'Nobody matches.' : 'No active people yet.' })); return; }
        rows.forEach(function (p) {
          var self = p.id === d.me;
          var sel = levelSelect(p.level, canName, 'Level of ' + p.username);
          sel.disabled = (self && !canName) || (p.level === 'manage' && !canName);
          sel.addEventListener('change', function () { save('user', p.id, sel.value, null, sel); });
          var via = (p.via || []).map(function (v) { return Core.LEVEL_NAMES[v.level] + ' through ' + v.group; });
          pl.appendChild(el('div', { class: 'pitem', dataset: { type: 'user', name: p.username } },
            el('span', { class: 'avatar', 'aria-hidden': 'true', text: Core.initials(p.display_name) }),
            el('div', { class: 'grow' }, el('span', { class: 'n', text: p.display_name }),
              el('span', { class: 'u', text: '@' + p.username + (via.length ? ' - ' + via.join(', ') : '') + (self ? ' - you' : '') }),
              chips(p.rights, p.level, function (list, btn) { save('user', p.id, p.level, list, btn); })),
            sel));
        });
      }
      find.addEventListener('input', function () { filter = find.value; drawPeople(); });
      drawPeople();
    }

    load();
    return root;
  }

  return { panel: panel, notReady: notReady };
})();
