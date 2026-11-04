/* Dashboard: the tiles this user may open. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  Core.requireLogin().then(function (me) {
    $('#hello').textContent = 'Hello, ' + (me.display_name || me.username);
    if (me.is_super) $('#head-actions').appendChild(el('a', { class: 'btn', href: Core.CORE + '/admin.html', text: 'Admin' }));
    var grid = $('#tiles');
    return Api.rpc('core_my_tiles').then(function (tiles) {
      Core.clear(grid);
      if (!tiles.length) { $('#empty').hidden = false; return; }
      tiles.forEach(function (t) {
        var icon = Core.ICONS.indexOf(t.icon) >= 0 ? t.icon : 'tile';
        var card = el('a', { class: 'tile', href: '/' + t.id + '/' },
          el('span', { class: 'icon i-' + icon, 'aria-hidden': 'true' }),
          el('span', { class: 'grow' },
            el('span', { class: 'name', text: t.name }),
            el('span', { class: 'tagline', text: t.tagline || '' }),
            t.is_admin ? el('span', { class: 'flag' }, el('span', { class: 'badge brand', text: 'admin' })) : null));
        grid.appendChild(card);
      });
    });
  }).catch(function (err) { Core.showError(err); });
})();
