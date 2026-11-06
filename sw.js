/* DAME service worker: the installed app's offline page, nothing else.
   It keeps a copy of offline.html, the theme and the icons it needs. It never caches a page with data in it
   and never touches a Supabase request (only same-origin page navigations are handled; everything else goes
   straight to the network). Scope: /dame-hub/ (a tile at /<tile-id>/ opens inside the app but, offline, shows
   the browser's own error). Bump VERSION when offline.html, theme.css or the icons change. */
'use strict';
var VERSION = 'dame-shell-v3';
var CORE = '/dame-hub';
var SHELL = [CORE + '/offline.html', CORE + '/core/v1/theme.css', CORE + '/core/v1/icons/favicon.svg', CORE + '/core/v1/icons/mark.svg'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // Supabase and anything outside the site: untouched
  if (req.mode === 'navigate') {                                // a page: network, or the offline page
    event.respondWith(fetch(req).catch(function () { return caches.match(CORE + '/offline.html'); }));
    return;
  }
  var shell = SHELL.indexOf(url.pathname) >= 0;                 // the offline page's own files: network first, cache if offline
  if (shell) event.respondWith(fetch(req).catch(function () { return caches.match(url.pathname); }));
});
