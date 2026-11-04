/* Account: display name, password. */
(function () {
  'use strict';
  var $ = Core.$;
  function setError(box, msg) { box.textContent = msg || ''; box.hidden = !msg; }

  Core.requireLogin({ page: 'Account' }).then(function (me) {
    $('#username').textContent = '@' + me.username + (me.email && me.email.indexOf('@' + DAME_CONFIG.INTERNAL_DOMAIN) < 0 ? ' (' + me.email + ')' : '');
    $('#display-name').value = me.display_name;
    var mustChange = !!me.must_change_password || Core.param('change') === '1';
    if (me.must_change_password) {
      $('#must-change').hidden = false;
      // the temporary password is known to the owner, so it is not asked for again
      $('#current-field').hidden = true;
      $('#new1').focus();
    }

    $('#name-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#name-error'), btn = e.target.querySelector('button');
      var v = $('#display-name').value.trim();
      setError(err, '');
      if (!v) { setError(err, 'Enter a display name.'); return; }
      Core.busy(btn, function () { return Api.rpc('core_set_display_name', { p_display_name: v }); })
        .then(function (r) { Core.toast('Name saved', 'success'); me.display_name = r.display_name; Core.buildTopbar(me); })
        .catch(function (ex) { setError(err, Api.errorMessage(ex)); });
    });

    $('#pass-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#pass-error'), btn = e.target.querySelector('button');
      var cur = $('#current').value, n1 = $('#new1').value, n2 = $('#new2').value;
      setError(err, '');
      if (!me.must_change_password && !cur) { setError(err, 'Enter your current password.'); return; }
      if (!Api.auth.validPassword(n1)) { setError(err, Api.messages.WEAK_PASSWORD); return; }
      if (n1 !== n2) { setError(err, 'The two passwords differ.'); return; }
      if (n1 === cur) { setError(err, 'The new password is the same as the current one.'); return; }
      Core.busy(btn, function () {
        var check = me.must_change_password ? Promise.resolve() : Api.auth.verify(me.email || me.username, cur).catch(function () { throw new Api.Error('BAD_CURRENT', 'The current password is wrong.'); });
        return check
          .then(function () { return Api.auth.updatePassword(n1); })
          .then(function () { return Api.rpc('core_password_changed'); })
          .then(function () { return Api.auth.signOutOthers(); });
      }).then(function () {
        me.must_change_password = false; $('#must-change').hidden = true; $('#current-field').hidden = false;
        $('#current').value = ''; $('#new1').value = ''; $('#new2').value = '';
        Core.toast('Password changed', 'success');
        if (mustChange) setTimeout(function () { Core.go(Core.safeNext(Core.param('next'))); }, 600);
      }).catch(function (ex) { setError(err, Api.errorMessage(ex)); });
    });
  });
})();
