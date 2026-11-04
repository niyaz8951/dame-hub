/* Dashboard: the tiles this user may open. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  Core.requireLogin().then(function (me) {
    var name = me.display_name || me.username;
    var now = new Date();
    $('#today').textContent = DAYS[now.getDay()] + ', ' + Core.date(now);
    $('#hello').textContent = greeting() + ', ' + name.split(/\s+/)[0];
    if (me.is_super) {
      $('#head-actions').appendChild(el('a', { class: 'btn glass', href: Core.CORE + '/admin.html' },
        el('span', { class: 'ico i-gear', 'aria-hidden': 'true' }), 'Admin'));
    }
    var grid = $('#tiles');
    return Api.rpc('core_my_tiles').then(function (tiles) {
      Core.clear(grid);
      grid.removeAttribute('aria-busy');
      $('#sub').textContent = tiles.length === 1 ? '1 tile ready for you.' : tiles.length ? tiles.length + ' tiles ready for you.' : 'Your tools, in one place.';
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
  }).catch(function (err) {
    var grid = $('#tiles'); if (grid) { Core.clear(grid); grid.removeAttribute('aria-busy'); }
    Core.showError(err);
  });
})();
