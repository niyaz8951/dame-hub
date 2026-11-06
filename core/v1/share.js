/* DAME core: the Access panel of one container (a project, a map, a notebook ...). Loaded on first use by Core.share.
   Core.share({ kind, id, tile? }) -> Promise(true when something changed).
   Who can open it: everyone in the tile (can edit or can view), or only the people and groups listed.
   The database decides everything (core_share_get / core_share_set / core_share_owner_set); this only shows it. */
window.CoreShare = (function () {
  'use strict';
  var el = Core.el;
  var LEVELS = { edit: 'Can edit', read: 'Can view' };

  function avatar(item) {
    if (item.type === 'group') return el('span', { class: 'avatar group', 'aria-hidden': 'true', text: Core.initials(item.name) });
    return el('span', { class: 'avatar', 'aria-hidden': 'true', text: Core.initials(item.name || item.username) });
  }
  function sub(item) {
    if (item.type === 'group') return 'Group - ' + item.members + (item.members === 1 ? ' person' : ' people');
    var s = '@' + item.username;
    if (item.active === false) s += ' - disabled';
    else if (item.has_tile === false) s += ' - no access to the tile';
    return s;
  }

  function open(opts) {
    if (!opts || !opts.tile || !opts.kind || opts.id === undefined || opts.id === null) return Promise.reject(new Error('Core.share needs tile, kind and id'));
    var params = { p_tile: opts.tile, p_kind: opts.kind, p_id: String(opts.id) };
    return Promise.all([Api.rpc('core_share_get', params), Api.rpc('core_share_people', { p_tile: opts.tile })])
      .then(function (res) { return sheet(params, res[0], res[1]); },
        function (err) { Core.showError(err); return false; });
  }

  function sheet(params, view, people) {
    var changed = false;
    var list = view.shares.map(function (s) { return Object.assign({}, s); });
    var can = !!view.can_share;
    var tileName = view.tile.name;

    var body = el('div', { class: 'stack share' });
    body.appendChild(el('p', { class: 'muted', text: view.kind_label + ' - ' + view.name }));

    // who can open it
    var every = el('select', { id: 'sh-everyone', disabled: !can, 'aria-label': 'Who can open it' },
      el('option', { value: 'edit', text: 'Everyone in ' + tileName + ' (can edit)' }),
      el('option', { value: 'read', text: 'Everyone in ' + tileName + ' can view' }),
      el('option', { value: '', text: 'Only the people and groups below' }));
    every.value = view.everyone || '';
    body.appendChild(el('div', { class: 'field' }, el('label', { for: 'sh-everyone', text: 'Who can open it' }), every,
      el('span', { class: 'hint', text: 'Can edit lets each person do here what his level in ' + tileName + ' allows. Can view is read only.' })));

    // add a person or a group
    var find = el('input', { id: 'sh-find', placeholder: 'Add a person or group', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Add a person or group' });
    var addLevel = el('select', { id: 'sh-add-level', 'aria-label': 'Level for the one you add' },
      el('option', { value: 'edit', text: 'Can edit' }), el('option', { value: 'read', text: 'Can view' }));
    var picks = el('div', { class: 'picks', hidden: true, role: 'listbox' });
    function candidates() {
      var q = find.value.trim().toLowerCase();
      var taken = {};
      list.forEach(function (s) { taken[s.type + ':' + s.id] = true; });
      if (view.owner) taken['user:' + view.owner.id] = true;
      var out = [];
      people.groups.forEach(function (g) {
        if (!taken['group:' + g.id] && (!q || g.name.toLowerCase().indexOf(q) >= 0)) out.push({ type: 'group', id: g.id, name: g.name, members: g.members });
      });
      people.people.forEach(function (p) {
        if (!taken['user:' + p.id] && (!q || p.username.indexOf(q) >= 0 || p.display_name.toLowerCase().indexOf(q) >= 0))
          out.push({ type: 'user', id: p.id, name: p.display_name, username: p.username, active: true, has_tile: true });
      });
      return out.slice(0, 30);
    }
    function showPicks() {
      Core.clear(picks);
      var c = candidates();
      if (!c.length) { picks.hidden = !find.value; if (find.value) picks.appendChild(el('div', { class: 'faint', text: 'Nobody matches.' })); return; }
      c.forEach(function (item) {
        picks.appendChild(el('button', { type: 'button', role: 'option', on: { click: function () {
          item.level = addLevel.value; list.push(item); find.value = ''; picks.hidden = true; render(); find.focus();
        } } }, el('strong', { text: item.name }), ' ', el('span', { class: 'faint', text: sub(item) })));
      });
      picks.hidden = false;
    }
    if (can) {
      find.addEventListener('input', showPicks);
      find.addEventListener('focus', showPicks);
      body.appendChild(el('div', { class: 'stack' }, el('div', { class: 'row' }, el('div', { class: 'grow' }, find), addLevel), picks));
    }

    // the list
    var host = el('div', { class: 'plist', id: 'sh-list' });
    body.appendChild(host);
    function render() {
      Core.clear(host);
      if (view.owner) {
        host.appendChild(el('div', { class: 'pitem' }, avatar({ type: 'user', name: view.owner.display_name }),
          el('div', { class: 'grow' }, el('span', { class: 'n', text: view.owner.display_name }), el('span', { class: 'u', text: '@' + view.owner.username + ' - owner' })),
          el('span', { class: 'faint', text: 'Owner' })));
      }
      list.forEach(function (item, i) {
        var right;
        if (can) {
          right = el('select', { 'aria-label': 'Level for ' + item.name },
            el('option', { value: 'edit', text: LEVELS.edit }), el('option', { value: 'read', text: LEVELS.read }), el('option', { value: 'remove', text: 'Remove' }));
          right.value = item.level;
          right.addEventListener('change', function () {
            if (right.value === 'remove') { list.splice(i, 1); render(); } else item.level = right.value;
          });
        } else right = el('span', { class: 'faint', text: LEVELS[item.level] });
        host.appendChild(el('div', { class: 'pitem', dataset: { type: item.type, name: item.username || item.name } }, avatar(item),
          el('div', { class: 'grow' }, el('span', { class: 'n', text: item.name }), el('span', { class: 'u', text: sub(item) })), right));
      });
      if (!list.length) host.appendChild(el('p', { class: 'faint', text: every.value ? 'Nobody added one by one.' : 'Only the owner and the managers of ' + tileName + ' can open it.' }));
    }
    render();
    body.appendChild(el('p', { class: 'muted', text: 'Managers of ' + tileName + ' can always open it.' + (can ? '' : ' Only the owner and the managers change who can.') }));

    // a manager may hand it to someone else
    if (view.can_change_owner) {
      var who = el('select', { id: 'sh-owner', 'aria-label': 'New owner' }, el('option', { value: '', text: 'Choose a person' }));
      people.people.forEach(function (p) { if (!view.owner || p.id !== view.owner.id) who.appendChild(el('option', { value: p.id, text: p.display_name + ' (@' + p.username + ')' })); });
      var ownerBtn = el('button', { class: 'btn', type: 'button', id: 'sh-owner-go', text: 'Change owner', on: { click: function () {
        if (!who.value) { Core.toast('Choose the new owner first.'); return; }
        Core.busy(ownerBtn, function () { return Api.rpc('core_share_owner_set', Object.assign({ p_user: who.value }, params)); })
          .then(function (v) { changed = true; view.owner = v.owner; list = v.shares.map(function (s) { return Object.assign({}, s); }); render(); Core.toast('Owner changed', 'success'); })
          .catch(Core.showError);
      } } });
      body.appendChild(el('details', null, el('summary', { text: 'Change owner' }),
        el('div', { class: 'row' }, el('div', { class: 'grow' }, who), ownerBtn)));
    }

    var err = el('p', { class: 'notice danger', hidden: true, role: 'alert' });
    body.appendChild(err);
    var actions = can ? [{ label: 'Cancel', value: false }, { label: 'Save', kind: 'primary', onClick: function () {
      err.hidden = true;
      var shares = list.map(function (s) { return { type: s.type, id: s.id, level: s.level }; });
      return Api.rpc('core_share_set', Object.assign({ p_everyone: every.value || null, p_shares: shares }, params))
        .then(function () { Core.toast('Access saved', 'success'); return true; },
          function (ex) { err.textContent = Api.errorMessage(ex); err.hidden = false; return false; });
    } }] : [{ label: 'Close', value: false }];
    return Core.sheet({ title: 'Access', body: body, actions: actions }).then(function (v) { return !!v || changed; });
  }

  return { open: open };
})();
