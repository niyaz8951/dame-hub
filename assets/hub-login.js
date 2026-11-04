/* Sign in and request access. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  var next = Core.safeNext(Core.param('next'));

  function show(pane) {
    ['signin', 'request', 'pending'].forEach(function (p) { $('#pane-' + p).hidden = p !== pane; });
    var first = $('#pane-' + pane + ' input'); if (first) first.focus();
  }
  function setError(box, msg) { box.textContent = msg || ''; box.hidden = !msg; }
  function mark(input, bad) { input.closest('.field').classList.toggle('invalid', !!bad); }

  // After a successful Auth sign-in: bind the session, then go where the user was heading.
  function afterSignIn() {
    return Api.rpc('core_session_start').then(function (me) {
      if (me.status === 'disabled') {
        return Api.auth.signOut().then(function () { throw new Api.Error('DISABLED', 'This account is disabled.'); });
      }
      if (me.status === 'pending') { show('pending'); return; }
      if (me.must_change_password) { Core.go(Core.CORE + '/account.html?change=1&next=' + encodeURIComponent(next)); return; }
      Core.go(next);
    });
  }

  // Already signed in? Check the session and move on.
  if (Api.auth.session()) {
    Core.initPublic();
    Api.rpc('core_me').then(function (me) {
      if (me.status === 'pending') { show('pending'); return; }
      if (me.status === 'disabled') { Api.auth.clear(); show('signin'); return; }
      Core.go(me.must_change_password ? Core.CORE + '/account.html?change=1' : next);
    }).catch(function () { Api.auth.clear(); show('signin'); });
  } else {
    Core.initPublic();
    show(window.location.hash === '#request' ? 'request' : 'signin');
  }

  $('#to-request').addEventListener('click', function (e) { e.preventDefault(); show('request'); });
  $('#to-signin').addEventListener('click', function (e) { e.preventDefault(); show('signin'); });
  $('#pending-signout').addEventListener('click', function () { Core.signOut(); });

  $('#signin').addEventListener('submit', function (e) {
    e.preventDefault();
    var user = $('#si-user'), pass = $('#si-pass'), err = $('#si-error'), btn = e.target.querySelector('button[type=submit]');
    var u = user.value.trim().toLowerCase();
    setError(err, '');
    mark(user, !u); mark(pass, !pass.value);
    if (!u || !pass.value) { setError(err, 'Enter your username and password.'); return; }
    if (!Api.auth.validUsername(u)) { setError(err, Api.messages.BAD_LOGIN); return; }
    Core.busy(btn, function () {
      return Api.auth.signIn(u, pass.value).then(afterSignIn);
    }).catch(function (ex) { setError(err, Api.errorMessage(ex)); pass.value = ''; pass.focus(); });
  });

  $('#request').addEventListener('submit', function (e) {
    e.preventDefault();
    var user = $('#rq-user'), name = $('#rq-name'), pass = $('#rq-pass'), pass2 = $('#rq-pass2'), err = $('#rq-error');
    var btn = e.target.querySelector('button[type=submit]');
    var u = user.value.trim().toLowerCase();
    setError(err, '');
    var problems = [];
    mark(user, !Api.auth.validUsername(u)); if (!Api.auth.validUsername(u)) problems.push('Username: 3 to 30 characters, lower-case letters, digits, dot, dash, underscore.');
    mark(name, !name.value.trim()); if (!name.value.trim()) problems.push('Enter a display name.');
    mark(pass, !Api.auth.validPassword(pass.value)); if (!Api.auth.validPassword(pass.value)) problems.push(Api.messages.WEAK_PASSWORD);
    mark(pass2, pass.value !== pass2.value); if (pass.value !== pass2.value) problems.push('The two passwords differ.');
    if (problems.length) { setError(err, problems[0]); return; }
    Core.busy(btn, function () {
      return Api.auth.signUp(u, pass.value, name.value.trim()).then(function (s) {
        if (!s || !s.access_token) {
          // sign-up succeeded but returned no session (confirm-email left on): sign in explicitly
          return Api.auth.signIn(u, pass.value).then(afterSignIn);
        }
        return afterSignIn();
      });
    }).catch(function (ex) { setError(err, Api.errorMessage(ex)); });
  });
})();
