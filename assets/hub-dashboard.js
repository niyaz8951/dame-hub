/* Dashboard: the tiles this user may open. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  // One line from /dame-hub/lines.json in the hero (docs/LINES.md). Public file, no data; any failure leaves the spot empty.
  var KINDS = { history: 'HVAC history', rule: 'Rule of thumb', fact: 'Did you know', quote: 'Quote', news: 'Latest' };
  var RECENT_KEY = 'dame.lines.recent';

  function localDay(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function recentGet() { try { var r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function recentSet(r) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {} }

  function showLine() {
    fetch(Core.CORE + '/lines.json', { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('lines ' + r.status);
      return r.json();
    }).then(function (data) {
      var today = localDay(new Date());
      var pool = (data && Array.isArray(data.lines) ? data.lines : []).filter(function (l) {
        return l && typeof l.id === 'string' && typeof l.text === 'string' && l.text.length && l.text.length <= 240 &&
          KINDS[l.kind] && (!l.expires || l.expires >= today) && (!l.added || l.added <= today);
      });
      if (!pool.length) return;
      // Skip what was shown recently: the last half of the pool, at most 40 lines.
      var keep = Math.min(40, Math.floor(pool.length / 2));
      var recent = recentGet();
      var fresh = pool.filter(function (l) { return recent.indexOf(l.id) < 0; });
      if (!fresh.length) fresh = pool;
      var line = fresh[Math.floor(Math.random() * fresh.length)];
      recent = recent.filter(function (id) { return id !== line.id; });
      recent.push(line.id);
      recentSet(keep ? recent.slice(-keep) : []);
      $('#line-kind').textContent = KINDS[line.kind];
      $('#line-text').textContent = line.kind === 'quote' ? '\u201C' + line.text + '\u201D' : line.text;
      $('#line-by').textContent = typeof line.by === 'string' && line.by ? '\u2014 ' + line.by : '';
      $('#line').setAttribute('data-id', line.id);
      $('#line').hidden = false;
    }).catch(function () { /* no line today; the hero still works */ });
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
    showLine();
    var grid = $('#tiles');
    return Api.rpc('core_my_tiles').then(function (tiles) {
      Core.clear(grid);
      grid.removeAttribute('aria-busy');
      if (!tiles.length) { $('#empty').hidden = false; return; }
      tiles.forEach(function (t) {
        var icon = Core.ICONS.indexOf(t.icon) >= 0 ? t.icon : 'tile';
        var card = el('a', { class: 'tile', href: Core.tilePath(t.id), 'data-accent': Core.accent(t.accent) },
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
