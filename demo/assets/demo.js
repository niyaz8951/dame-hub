/* Demo tile. Guard first; everything after it only shows or hides - the database decides. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  var TILE = 'demo';

  Core.requireLogin({ tile: TILE }).then(function (me) {
    var canEdit = Core.atLeast('contribute');
    var isManager = Core.atLeast('manage');

    // facts
    var facts = $('#facts');
    [['username', me.username], ['display name', me.display_name], ['super user', String(me.is_super)],
     ['level here', Core.LEVEL_NAMES[me.level] + ' - ' + Core.levelMeaning(me.level)], ['tile manager', String(me.tile_admin)],
     ['names held', me.rights.length ? me.rights.join(', ') : '(none)']].forEach(function (f) {
      facts.appendChild(el('dt', { text: f[0] })); facts.appendChild(el('dd', { text: f[1] }));
    });

    $('#add-card').hidden = !canEdit;
    $('#file-card').hidden = false;

    // notes
    function loadNotes() {
      var host = $('#notes'); Core.clear(host);
      host.appendChild(el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), 'Loading'));
      return Api.rpc('demo_list').then(function (rows) {
        Core.clear(host);
        if (!rows.length) { host.appendChild(el('p', { class: 'state', text: 'No notes yet.' })); return; }
        rows.forEach(function (n) {
          var a = n.access || {};
          var who = a.everyone === 'edit' ? 'Everyone' : a.everyone === 'read' ? 'Everyone can view' : a.shared ? 'Shared with ' + a.shared : 'Only the owner';
          var item = el('div', { class: 'demo-note', dataset: { id: n.id } },
            el('div', { class: 'row between' }, el('strong', { text: n.title }),
              el('div', { class: 'row' },
                el('span', { class: 'badge', text: who }),
                n.mine || isManager ? el('button', { class: 'btn small', type: 'button', text: 'Share', on: { click: function () {
                  Core.share({ kind: 'note', id: n.id }).then(function (changed) { if (changed) loadNotes(); });
                } } }) : null,
                n.mine && canEdit ? el('button', { class: 'btn small ghost danger', type: 'button', text: 'Delete', on: { click: function (e) { var btn = e.currentTarget;
                  Core.confirm('Delete "' + n.title + '"?', { ok: 'Delete', danger: true }).then(function (yes) {
                    if (!yes) return;
                    Core.busy(btn, function () { return Api.rpc('demo_delete', { p_id: n.id }); }).then(loadNotes).catch(Core.showError);
                  });
                } } }) : null)),
            n.body ? el('div', { class: 'text', text: n.body }) : null,
            el('div', { class: 'meta', text: '@' + n.username + ' - ' + Core.dateTime(n.created_at) + ' - you: ' + Core.LEVEL_NAMES[a.level] }));
          host.appendChild(item);
        });
      }).catch(function (err) { Core.clear(host); host.appendChild(el('p', { class: 'notice danger', text: Api.errorMessage(err) })); });
    }
    loadNotes();
    $('#reload').addEventListener('click', loadNotes);

    $('#add').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#add-error'), btn = e.target.querySelector('button');
      var title = $('#title').value.trim();
      err.hidden = true;
      if (!title) { err.textContent = 'Enter a title.'; err.hidden = false; return; }
      Core.busy(btn, function () { return Api.rpc('demo_add', { p_title: title, p_body: $('#body').value }); })
        .then(function () { $('#title').value = ''; $('#body').value = ''; Core.toast('Added', 'success'); loadNotes(); })
        .catch(function (ex) { err.textContent = Api.errorMessage(ex); err.hidden = false; });
    });

    // refused calls
    function tryCall(name, params) {
      var box = $('#refused');
      box.className = 'notice'; box.textContent = 'Calling ' + name + '...'; box.hidden = false;
      Api.rpc(name, params).then(function () { box.className = 'notice success'; box.textContent = name + ' was allowed (you must be the super user).'; },
        function (err) { box.className = 'notice danger'; box.textContent = name + ' refused: ' + err.code + ' - ' + Api.errorMessage(err); });
    }
    $('#try-manage').addEventListener('click', function () { tryCall('demo_manage', {}); });
    $('#try-other').addEventListener('click', function () { tryCall('core_admin_users', { p_status: null }); });

    // files
    function loadFiles() {
      var host = $('#files'); Core.clear(host);
      Api.file.list(TILE, me.username + '/').then(function (rows) {
        if (!rows.length) { host.appendChild(el('p', { class: 'faint', text: 'No files yet.' })); return; }
        rows.forEach(function (f) {
          var path = me.username + '/' + f.name;
          host.appendChild(el('div', { class: 'demo-file' }, el('span', { class: 'grow mono', text: f.name }),
            el('button', { class: 'btn small', type: 'button', text: 'Download', on: { click: function (e) { var btn = e.currentTarget;
              Core.busy(btn, function () { return Api.file.download(TILE, path).then(function (blob) { Core.download(f.name, blob); }); }).catch(Core.showError);
            } } }),
            canEdit ? el('button', { class: 'btn small danger', type: 'button', text: 'Delete', on: { click: function (e) { var btn = e.currentTarget;
              Core.busy(btn, function () { return Api.file.remove(TILE, path); }).then(loadFiles).catch(Core.showError);
            } } }) : null));
        });
      }).catch(function (err) { host.appendChild(el('p', { class: 'notice danger', text: Api.errorMessage(err) })); });
    }
    loadFiles();
    $('#upload').addEventListener('click', function (e) { var btn = e.currentTarget;
      var input = $('#file');
      if (!input.files || !input.files[0]) { Core.toast('Choose a file first.'); return; }
      var f = input.files[0];
      if (f.size > 5 * 1024 * 1024) { Core.toast('Keep it under 5 MB.', 'danger'); return; }
      var name = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      Core.busy(btn, function () { return Api.file.upload(TILE, me.username + '/' + name, f); })
        .then(function () { Core.toast('Uploaded', 'success'); input.value = ''; loadFiles(); })
        .catch(function (err) { Core.showError(err); });
    });
  });
})();
