/* Access page for tile admins: /dame-hub/access.html?tile=<id> */
(function () {
  'use strict';
  var $ = Core.$;
  var tile = (Core.param('tile') || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(tile)) { Core.showState('Nothing here', 'No tile was named.', { href: Core.CORE + '/dashboard.html', label: 'Dashboard' }); return; }
  Core.requireLogin({ tile: tile }).then(function (me) {
    if (!me.tile_admin) { Core.showState('Nothing here', 'There is nothing here for you.', { href: '/' + tile + '/', label: 'Back' }); return; }
    Core.setTitle('Access to ' + me.tile.name);
    $('#title').textContent = 'Access to ' + me.tile.name;
    $('#back').href = '/' + tile + '/';
    $('#panel').appendChild(Access.panel(me.tile, me.is_super));
  });
})();
