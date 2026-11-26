/* Files page of an uploaded tile: /dame-hub/upload.html?tile=<id>. For the tile's managers and the super user.
   Upload -> preview (dame-hub/<tile>/_next/) -> Make live (replaces dame-hub/<tile>/) -> versions, Restore.
   The work is done by the Edge Function tile-upload; the database records each version (db/core/012_uploads.sql). */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  var tile = (Core.param('tile') || '').toLowerCase();
  var LIMIT_FILES = 300, LIMIT_BYTES = 20 * 1024 * 1024;
  var chosen = [];          // [{ path, blob }]
  var state = null;         // core_upload_check result

  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(tile)) { Core.showState('Nothing here', 'No tile was named.', { href: Core.CORE + '/dashboard.html', label: 'Dashboard' }); return; }

  function size(n) { return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function who(name, at) { return (name ? name : 'someone') + (at ? ', ' + Core.dateTime(at) : ''); }

  function showNotes(list, notes) {
    Core.clear(list);
    (notes || []).forEach(function (n) {
      var label = n.level === 'error' ? 'Must fix' : n.level === 'warn' ? 'Check' : 'Done';
      list.appendChild(el('li', { class: 'up-note ' + n.level },
        el('span', { class: 'badge ' + (n.level === 'error' ? 'danger' : n.level === 'warn' ? 'warning' : 'success'), text: label }), ' ',
        n.file ? el('span', { class: 'mono', text: n.file + ': ' }) : null, n.text));
    });
  }

  // ---------- reading what was chosen: files, a folder, or a .zip ----------
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function unzip(file) {
    return file.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf), end = -1;
      for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { end = i; break; }
      if (end < 0) throw new Error(file.name + ' is not a readable .zip.');
      var count = u16(b, end + 10), off = u32(b, end + 16), jobs = [];
      for (var n = 0; n < count; n++) {
        if (u32(b, off) !== 0x02014b50) throw new Error(file.name + ': the .zip is damaged.');
        var flags = u16(b, off + 8), method = u16(b, off + 10), csize = u32(b, off + 20);
        var nlen = u16(b, off + 28), xlen = u16(b, off + 30), clen = u16(b, off + 32), local = u32(b, off + 42);
        var name = new TextDecoder().decode(b.subarray(off + 46, off + 46 + nlen));
        off += 46 + nlen + xlen + clen;
        if (/\/$/.test(name)) continue;
        if (flags & 1) throw new Error(file.name + ' is protected with a password. Make it without one.');
        if (method !== 0 && method !== 8) throw new Error(file.name + ' uses a packing method the browser cannot open. Make it again with Windows "Send to > Compressed folder".');
        var start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
        jobs.push({ name: name, method: method, data: b.subarray(start, start + csize) });
      }
      return Promise.all(jobs.map(function (j) {
        if (j.method === 0) return Promise.resolve({ path: j.name, blob: new Blob([j.data]) });
        if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open .zip files. Choose the files or the folder instead.');
        return new Response(new Blob([j.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()
          .then(function (blob) { return { path: j.name, blob: blob }; });
      }));
    });
  }
  function fromEntries(items) {   // drag and drop of a folder (webkitGetAsEntry)
    var out = [];
    function walk(entry, prefix) {
      return new Promise(function (resolve) {
        if (entry.isFile) entry.file(function (f) { out.push({ path: prefix + entry.name, blob: f }); resolve(); }, function () { resolve(); });
        else if (entry.isDirectory) {
          var reader = entry.createReader(), all = [];
          (function more() {
            reader.readEntries(function (list) {
              if (!list.length) { Promise.all(all.map(function (e) { return walk(e, prefix + entry.name + '/'); })).then(function () { resolve(); }); return; }
              all = all.concat(Array.prototype.slice.call(list)); more();
            }, function () { resolve(); });
          })();
        } else resolve();
      });
    }
    return Promise.all(items.map(function (e) { return walk(e, ''); })).then(function () { return out; });
  }
  function take(list) {
    var zips = list.filter(function (f) { return /\.zip$/i.test(f.path); });
    var rest = list.filter(function (f) { return !/\.zip$/i.test(f.path); });
    if (zips.length > 1 || (zips.length && rest.length)) return Promise.reject(new Error('Choose one .zip on its own, or the files without a .zip.'));
    return (zips.length ? unzip(zips[0].blob) : Promise.resolve(rest)).then(function (files) {
      files = files.filter(function (f) { return !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(f.path); });
      if (!files.length) throw new Error('Nothing to upload.');
      var total = files.reduce(function (s, f) { return s + f.blob.size; }, 0);
      if (files.length > LIMIT_FILES) throw new Error('Too many files: ' + files.length + ' (at most ' + LIMIT_FILES + ').');
      if (total > LIMIT_BYTES) throw new Error('Too big: ' + size(total) + ' (at most 20 MB).');
      chosen = files;
      showChosen();
    });
  }
  function showChosen() {
    var box = $('#chosen'), list = $('#chosen-list');
    Core.clear(list);
    if (!chosen.length) { box.hidden = true; return; }
    var total = chosen.reduce(function (s, f) { return s + f.blob.size; }, 0);
    var pages = chosen.filter(function (f) { return /\.html?$/i.test(f.path); });
    $('#chosen-text').textContent = chosen.length + ' file' + (chosen.length === 1 ? '' : 's') + ', ' + size(total) + ', ' +
      (pages.length ? pages.length + ' page' + (pages.length === 1 ? '' : 's') : 'no HTML page') + '.';
    chosen.slice(0, 12).forEach(function (f) { list.appendChild(el('li', { class: 'mono', text: f.path + '  (' + size(f.blob.size) + ')' })); });
    if (chosen.length > 12) list.appendChild(el('li', { class: 'faint', text: '... and ' + (chosen.length - 12) + ' more' }));
    box.hidden = false;
  }
  function fail(err) { var e = $('#upload-error'); e.textContent = err && err.message ? err.message : String(err); e.hidden = false; }
  function pick(input) {
    input.addEventListener('change', function () {
      $('#upload-error').hidden = true;
      var files = Array.prototype.map.call(input.files || [], function (f) { return { path: f.webkitRelativePath || f.name, blob: f }; });
      input.value = '';
      take(files).catch(fail);
    });
  }

  // ---------- the function ----------
  function call(action, extra, files) {
    var fd = new FormData();
    for (var k in extra || {}) fd.append(k, String(extra[k]));
    if (files) {
      fd.append('paths', JSON.stringify(files.map(function (f) { return f.path; })));
      files.forEach(function (f) { fd.append('file', f.blob, f.path.split('/').pop()); });
    }
    return Api.fn('tile-upload?tile=' + encodeURIComponent(tile) + '&action=' + action, fd);
  }

  // ---------- what is live, the preview, the versions ----------
  function render() {
    var t = state, live = t.live, prev = t.preview;
    $('#live-text').textContent = live
      ? 'Version ' + live.id + ': ' + live.files + ' files, ' + size(live.bytes) + '. Uploaded by ' + who(live.uploaded_by, live.uploaded_at) + '; live since ' + Core.dateTime(live.live_at) + ' (' + (live.live_by || 'someone') + ').'
      : 'Nothing is live yet. Users see "Not ready yet" on the tile until a preview is made live.';
    var open = $('#open-live');
    open.hidden = !live; open.href = Core.tilePath({ id: tile, hosting: 'upload' });
    $('#preview-card').hidden = !prev;
    if (prev) {
      $('#preview-text').textContent = 'Version ' + prev.id + ': ' + prev.files + ' files, ' + size(prev.bytes) + '. Uploaded by ' + who(prev.uploaded_by, prev.uploaded_at) + '.';
      $('#preview-open').href = Core.CORE + '/' + tile + '/_next/';
      showNotes($('#preview-notes'), (prev.report || []).filter(function (n) { return n.level !== 'info'; }));
    }
    $('#upload-title').textContent = live || prev ? 'Replace the files' : 'Upload the tool';
  }
  function loadHistory() {
    var host = $('#history');
    return Api.rpc('core_upload_list', { p_tile: tile }).then(function (rows) {
      Core.clear(host);
      if (!rows.length) { host.appendChild(el('p', { class: 'faint', text: 'No uploads yet.' })); return; }
      var table = el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Version' }), el('th', { text: 'State' }), el('th', { text: 'Files' }),
        el('th', { text: 'Uploaded' }), el('th', { text: 'Live' }), el('th'))));
      var body = el('tbody');
      rows.forEach(function (r) {
        var badge = { live: 'success', preview: 'warning', old: '', discarded: '' }[r.status];
        body.appendChild(el('tr', null,
          el('td', { text: String(r.id) }),
          el('td', null, el('span', { class: 'badge ' + badge, text: r.status })),
          el('td', { text: r.files + ', ' + size(r.bytes) }),
          el('td', { text: who(r.uploaded_by, r.uploaded_at) }),
          el('td', { text: r.live_at ? who(r.live_by, r.live_at) : '-' }),
          el('td', { class: 'actions' }, r.status === 'old' && r.live_commit ? el('button', { class: 'btn small', type: 'button', text: 'Restore',
            on: { click: function (ev) { restore(r, ev.currentTarget); } } }) : null)));
      });
      table.appendChild(body); host.appendChild(el('div', { class: 'table-wrap' }, table));
    }).catch(function (err) { Core.clear(host); host.appendChild(el('p', { class: 'notice danger', text: Api.errorMessage(err) })); });
  }
  function refresh() {
    return Api.rpc('core_upload_check', { p_tile: tile }).then(function (s) { state = s; render(); return loadHistory(); });
  }
  function restore(r, btn) {
    Core.confirm('Version ' + r.id + ' replaces the live files of ' + state.name + (state.preview ? ', and the waiting preview is dropped' : '') + '. Go ahead?',
      { title: 'Restore version ' + r.id, ok: 'Restore' }).then(function (yes) {
      if (!yes) return;
      Core.busy(btn, function () { return call('rollback', { release: r.id }); })
        .then(function () { Core.toast('Version ' + r.id + ' is live again. The site shows it in about a minute.', 'success'); return refresh(); })
        .catch(function (err) { Core.showError(err); });
    });
  }

  // The guard is core_upload_check, not the tile itself: files go up while the tile is still switched off.
  Core.requireLogin().then(function () {
    return Api.rpc('core_upload_check', { p_tile: tile });
  }).then(function (s) {
    state = s;
    Core.setTitle('Files of ' + s.name);
    $('#title').textContent = 'Files of ' + s.name;
    if (!s.enabled) $('#live-card').appendChild(el('p', { class: 'notice warning', text: 'This tile is switched off: users do not see it yet. The site owner switches it on in Admin > Tiles.' }));
    $('#guide').appendChild(HubGuide.box(s.name));
    if (!('webkitdirectory' in document.createElement('input'))) $('#pick-folder-label').hidden = true;
    pick($('#pick-files')); pick($('#pick-folder'));
    var drop = $('#drop');
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('over'); $('#upload-error').hidden = true;
      var items = Array.prototype.slice.call(e.dataTransfer.items || []);
      var entries = items.map(function (i) { return i.webkitGetAsEntry ? i.webkitGetAsEntry() : null; }).filter(Boolean);
      var p = entries.length ? fromEntries(entries) : Promise.resolve(Array.prototype.map.call(e.dataTransfer.files || [], function (f) { return { path: f.name, blob: f }; }));
      p.then(take).catch(fail);
    });
    $('#export').addEventListener('click', function (ev) {
      Core.busy(ev.currentTarget, function () { return Api.rpc('core_data_export', { p_tile: tile }); }).then(function (out) {
        if (!out.records.length) { Core.toast('The tool has no shared data yet.'); return; }
        Core.download(tile + '-data-' + new Date().toISOString().slice(0, 10) + '.json', new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      }).catch(function (err) { Core.showError(err); });
    });
    $('#clear').addEventListener('click', function () { chosen = []; showChosen(); Core.clear($('#upload-notes')); });
    $('#send').addEventListener('click', function (ev) {
      $('#upload-error').hidden = true; Core.clear($('#upload-notes'));
      Core.busy(ev.currentTarget, function () { return call('upload', null, chosen); }).then(function (res) {
        chosen = []; showChosen();
        showNotes($('#upload-notes'), res.notes);
        Core.toast('Uploaded as a preview. Open it in about a minute, then Make live.', 'success');
        return refresh();
      }).catch(function (err) {
        fail(err);
        if (err && err.raw && err.raw.notes) showNotes($('#upload-notes'), err.raw.notes);
      });
    });
    $('#make-live').addEventListener('click', function (ev) {
      var btn = ev.currentTarget;
      Core.confirm('The preview replaces everything now live in ' + state.name + '. Users see it in about a minute. The current version stays in Versions and can be restored.',
        { title: 'Make the preview live', ok: 'Make live' }).then(function (yes) {
        if (!yes) return;
        Core.busy(btn, function () { return call('live', { release: state.preview.id }); })
          .then(function () { Core.toast('Live. The site shows it in about a minute.', 'success'); return refresh(); })
          .catch(function (err) { Core.showError(err); refresh(); });
      });
    });
    $('#discard').addEventListener('click', function (ev) {
      var btn = ev.currentTarget;
      Core.confirm('The preview is deleted. What is live does not change.', { title: 'Discard the preview', ok: 'Discard', danger: true }).then(function (yes) {
        if (!yes) return;
        Core.busy(btn, function () { return call('discard'); })
          .then(function () { Core.toast('Preview discarded.'); return refresh(); })
          .catch(function (err) { Core.showError(err); refresh(); });
      });
    });
    return refresh();
  }).catch(function (err) {
    var code = err && err.code;
    if (code === 'INVALID:hosting') Core.showState('Built in its own repo', 'This is not an uploaded tile; its team changes it in its own repo. The site owner can switch it in Admin > Tiles > Edit.', { href: Core.CORE + '/dashboard.html', label: 'Dashboard' });
    else if (code === 'NO_ACCESS' || code === 'NO_RIGHT' || code === 'NOT_FOUND') Core.showState('Nothing here', 'Only the tile\'s managers upload its files.', { href: Core.CORE + '/dashboard.html', label: 'Dashboard' });
    else Core.showError(err);
  });
})();
