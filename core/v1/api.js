/* DAME core: Supabase Auth, REST (rpc) and Storage with plain fetch. No supabase-js.
   Every call carries the session, refreshes it when needed, and turns errors into { code, message }. */
window.Api = (function () {
  'use strict';
  var cfg = window.DAME_CONFIG;
  var base = cfg.SUPABASE.url;
  var apikey = cfg.SUPABASE.key;
  var refreshing = null;

  var MESSAGES = {
    SIGNED_OUT: 'Please sign in again.',
    NOT_APPROVED: 'Your account is waiting for approval.',
    NO_ACCESS: 'There is nothing here for you.',
    NO_RIGHT: 'You do not have the right to do this.',
    NOT_FOUND: 'Not found.',
    NETWORK: 'Cannot reach the server. Check the connection and try again.',
    BAD_LOGIN: 'Wrong username or password.',
    TAKEN: 'That email address is already registered. Sign in instead.',
    TAKEN_USERNAME: 'That username is already taken.',
    WEAK_PASSWORD: 'Password: at least 10 characters with lower case, upper case and a digit.',
    UNKNOWN: 'Something went wrong. Try again.'
  };
  var FIELDS = { username: 'username', password: 'password', display_name: 'display name', title: 'title', body: 'text',
    id: 'id', name: 'name', tagline: 'tagline', icon: 'icon', rights: 'rights', user: 'user', status: 'status' };

  function ApiError(code, message, status, raw) {
    this.code = code; this.message = message; this.status = status || 0; this.raw = raw;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function messageFor(code, fallback) {
    if (MESSAGES[code]) return MESSAGES[code];
    var m = /^INVALID:([a-z_]+)$/.exec(code || '');
    if (m) return 'Please check the ' + (FIELDS[m[1]] || m[1].replace(/_/g, ' ')) + '.';
    return fallback || MESSAGES.UNKNOWN;
  }

  // ---- session (localStorage, cleared on sign-out) ----
  function getSession() {
    try { var s = JSON.parse(localStorage.getItem(cfg.SESSION_KEY) || 'null'); return s && s.access_token ? s : null; }
    catch (e) { return null; }
  }
  function setSession(s) {
    if (!s) { try { localStorage.removeItem(cfg.SESSION_KEY); } catch (e) {} return; }
    var keep = { access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)),
      user_id: s.user && s.user.id ? s.user.id : (s.user_id || null),
      started_at: s.started_at || Math.floor(Date.now() / 1000) };
    try { localStorage.setItem(cfg.SESSION_KEY, JSON.stringify(keep)); } catch (e) {}
  }
  function clearLocal() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('dame.') === 0 && k !== cfg.THEME_KEY) keys.push(k); }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  function headers(withAuth, extra) {
    var h = { 'apikey': apikey, 'Content-Type': 'application/json' };
    if (withAuth) { var s = getSession(); if (s) h['Authorization'] = 'Bearer ' + s.access_token; }
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  function parseBody(res) {
    return res.text().then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return { message: t }; } });
  }

  function authError(status, body) {
    var msg = body && (body.msg || body.message || body.error_description || body.error) || '';
    var code = body && (body.error_code || body.code) || '';
    if (status === 400 && /invalid login credentials|invalid_credentials/i.test(msg + code)) return new ApiError('BAD_LOGIN', MESSAGES.BAD_LOGIN, status, body);
    if (/already registered|user_already_exists|already been registered/i.test(msg + code)) return new ApiError('TAKEN', MESSAGES.TAKEN, status, body);
    if (/TAKEN:username/.test(msg)) return new ApiError('TAKEN_USERNAME', MESSAGES.TAKEN_USERNAME, status, body);
    if (/weak_password|password should/i.test(msg + code)) return new ApiError('WEAK_PASSWORD', MESSAGES.WEAK_PASSWORD, status, body);
    if (/INVALID:[a-z_]+/.test(msg)) { var m = /INVALID:[a-z_]+/.exec(msg)[0]; return new ApiError(m, messageFor(m), status, body); }
    if (status === 401 || status === 403) return new ApiError('SIGNED_OUT', MESSAGES.SIGNED_OUT, status, body);
    if (status === 429) return new ApiError('RATE', 'Too many attempts. Wait a minute and try again.', status, body);
    return new ApiError('AUTH', msg || MESSAGES.UNKNOWN, status, body);
  }

  function authPost(path, payload, withAuth) {
    return fetch(base + '/auth/v1' + path, { method: 'POST', headers: headers(withAuth), body: JSON.stringify(payload || {}) })
      .catch(function () { throw new ApiError('NETWORK', MESSAGES.NETWORK); })
      .then(function (res) { return parseBody(res).then(function (body) { if (!res.ok) throw authError(res.status, body); return body; }); });
  }

  // A username (no @) means an owner-created account; an address is used as typed.
  function emailFor(login) { var v = String(login || '').trim().toLowerCase(); return v.indexOf('@') >= 0 ? v : v + '@' + cfg.INTERNAL_DOMAIN; }

  var auth = {
    validUsername: function (u) { return /^[a-z0-9._-]{3,30}$/.test(String(u || '').trim().toLowerCase()); },
    validEmail: function (m) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(m || '').trim()) && String(m).length <= 120; },
    validPassword: function (p) { return /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,}$/.test(String(p || '')); },
    signIn: function (email, password) {
      return authPost('/token?grant_type=password', { email: emailFor(email), password: password }, false)
        .then(function (s) { setSession(s); return s; });
    },
    // Checks a password without touching the stored session (used before a password change).
    verify: function (email, password) {
      return authPost('/token?grant_type=password', { email: emailFor(email), password: password }, false)
        .then(function (s) {
          // end the session this check created
          return fetch(base + '/auth/v1/logout?scope=local', { method: 'POST', headers: { 'apikey': apikey, 'Authorization': 'Bearer ' + s.access_token } })
            .catch(function () {}).then(function () { return true; });
        });
    },
    signUp: function (email, password, username, displayName) {
      return authPost('/signup', { email: emailFor(email), password: password,
        data: { username: String(username).trim().toLowerCase(), display_name: String(displayName || '').trim() } }, false)
        .then(function (s) { if (s && s.access_token) setSession(s); return s; });
    },
    refresh: function () {
      if (refreshing) return refreshing;
      var s = getSession();
      if (!s || !s.refresh_token) return Promise.reject(new ApiError('SIGNED_OUT', MESSAGES.SIGNED_OUT));
      refreshing = authPost('/token?grant_type=refresh_token', { refresh_token: s.refresh_token }, false)
        .then(function (n) { n.started_at = s.started_at; setSession(n); refreshing = null; return n; },
              function (err) { refreshing = null; if (err.code !== 'NETWORK') setSession(null); throw err; });
      return refreshing;
    },
    updatePassword: function (newPassword) {
      return fetch(base + '/auth/v1/user', { method: 'PUT', headers: headers(true), body: JSON.stringify({ password: newPassword }) })
        .catch(function () { throw new ApiError('NETWORK', MESSAGES.NETWORK); })
        .then(function (res) { return parseBody(res).then(function (body) { if (!res.ok) throw authError(res.status, body); return body; }); });
    },
    signOutOthers: function () {
      return fetch(base + '/auth/v1/logout?scope=others', { method: 'POST', headers: headers(true) }).catch(function () {});
    },
    signOut: function () {
      var s = getSession();
      var p = s ? fetch(base + '/auth/v1/logout?scope=local', { method: 'POST', headers: headers(true) }).catch(function () {}) : Promise.resolve();
      return p.then(function () { setSession(null); clearLocal(); });
    },
    session: getSession,
    clear: function () { setSession(null); clearLocal(); }
  };

  // Makes sure the access token is fresh (or that there is none).
  function ensureFresh() {
    var s = getSession();
    if (!s) return Promise.resolve(null);
    var now = Math.floor(Date.now() / 1000);
    if (s.started_at && now - s.started_at > cfg.SESSION_HOURS * 3600) { setSession(null); clearLocal(); return Promise.resolve(null); }
    if (s.expires_at && s.expires_at - now < 60) return auth.refresh().then(function () { return getSession(); }, function () { return null; });
    return Promise.resolve(s);
  }

  function restError(status, body) {
    var msg = body && body.message || '';
    if (/^(SIGNED_OUT|NOT_APPROVED|NO_ACCESS|NO_RIGHT|NOT_FOUND|INVALID:[a-z_]+)$/.test(msg)) return new ApiError(msg, messageFor(msg), status, body);
    if (msg === 'TAKEN:username') return new ApiError('TAKEN:username', MESSAGES.TAKEN_USERNAME, status, body);
    var m = /ALREADY_APPLIED|INVALID:[a-z_]+/.exec(msg);
    if (m) return new ApiError(m[0], messageFor(m[0]), status, body);
    if (status === 401) return new ApiError('SIGNED_OUT', MESSAGES.SIGNED_OUT, status, body);
    if (status === 403 || (body && body.code === '42501')) return new ApiError('NO_RIGHT', MESSAGES.NO_RIGHT, status, body);
    if (status === 404) return new ApiError('NOT_FOUND', 'That action does not exist (' + (body && body.message || '') + ').', status, body);
    if (status === 429) return new ApiError('RATE', 'Too many requests. Wait a minute and try again.', status, body);
    if (body && body.code === '23505') return new ApiError('DUPLICATE', 'That already exists.', status, body);
    if (body && body.code === '23514') return new ApiError('INVALID', 'Please check the values.', status, body);
    return new ApiError('SERVER', msg || MESSAGES.UNKNOWN, status, body);
  }

  // Calls public.<name>(params). Retries once after a token refresh on 401.
  function rpc(name, params, _retried) {
    return ensureFresh().then(function () {
      return fetch(base + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers(true), body: JSON.stringify(params || {}) })
        .catch(function () { throw new ApiError('NETWORK', MESSAGES.NETWORK); })
        .then(function (res) {
          if (res.status === 401 && !_retried && getSession()) return auth.refresh().then(function () { return rpc(name, params, true); });
          return parseBody(res).then(function (body) { if (!res.ok) throw restError(res.status, body); return body; });
        });
    });
  }

  function storageError(status, body) {
    if (status === 401) return new ApiError('SIGNED_OUT', MESSAGES.SIGNED_OUT, status, body);
    if (status === 403 || status === 400 && /row-level security|violates/i.test(body && body.message || '')) return new ApiError('NO_RIGHT', MESSAGES.NO_RIGHT, status, body);
    if (status === 404) return new ApiError('NOT_FOUND', MESSAGES.NOT_FOUND, status, body);
    if (status === 413) return new ApiError('TOO_BIG', 'The file is too big.', status, body);
    return new ApiError('STORAGE', body && (body.message || body.error) || MESSAGES.UNKNOWN, status, body);
  }
  function storageFetch(path, opts, raw, _retried) {
    return ensureFresh().then(function () {
      var s = getSession();
      if (!s) throw new ApiError('SIGNED_OUT', MESSAGES.SIGNED_OUT);
      opts = opts || {};
      opts.headers = opts.headers || {};
      opts.headers['apikey'] = apikey; opts.headers['Authorization'] = 'Bearer ' + s.access_token;
      return fetch(base + '/storage/v1' + path, opts)
        .catch(function () { throw new ApiError('NETWORK', MESSAGES.NETWORK); })
        .then(function (res) {
          if (res.status === 401 && !_retried) return auth.refresh().then(function () { return storageFetch(path, opts, raw, true); });
          if (!res.ok) return parseBody(res).then(function (body) { throw storageError(res.status, body); });
          return raw ? res : parseBody(res);
        });
    });
  }
  var file = {
    upload: function (bucket, path, blob, contentType) {
      return storageFetch('/object/' + bucket + '/' + path, { method: 'POST', body: blob,
        headers: { 'Content-Type': contentType || (blob && blob.type) || 'application/octet-stream', 'x-upsert': 'true' } });
    },
    url: function (bucket, path, seconds) {
      return storageFetch('/object/sign/' + bucket + '/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: seconds || 300 }) })
        .then(function (r) { return base + '/storage/v1' + r.signedURL; });
    },
    download: function (bucket, path) {
      return storageFetch('/object/authenticated/' + bucket + '/' + path, { method: 'GET' }, true).then(function (res) { return res.blob(); });
    },
    list: function (bucket, prefix, limit) {
      return storageFetch('/object/list/' + bucket, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: prefix || '', limit: limit || 100, offset: 0, sortBy: { column: 'name', order: 'asc' } }) });
    },
    remove: function (bucket, path) {
      return storageFetch('/object/' + bucket, { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] }) });
    }
  };

  return { auth: auth, rpc: rpc, file: file, Error: ApiError, messages: MESSAGES,
    errorMessage: function (err) {
      if (!err) return MESSAGES.UNKNOWN;
      if (err instanceof ApiError) return err.message || messageFor(err.code);
      return err.message || MESSAGES.UNKNOWN;
    } };
})();
