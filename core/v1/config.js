/* DAME core config. Public by design: the Supabase URL and publishable key open nothing on their own.
   Loaded by every page right after theme.css. No secret ever goes here. */
window.DAME_CONFIG = (function () {
  'use strict';
  var LIVE = {
    url: 'https://cykpvtekrdfmqimtrcps.supabase.co',
    key: 'sb_publishable_kJ5zkVqC00ki60zFkiLYLg_MJlJWZsN'
  };
  // Until a separate staging project exists, local testing uses the live project.
  // When it exists: STAGING = { url: 'https://<staging>.supabase.co', key: 'sb_publishable_...' }
  // and add its URL to the CSP line in core/v1/README.md and every page.
  var STAGING = LIVE;

  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1';
  return {
    SITE_NAME: 'DAME HUB',
    CORE: '/dame-hub',                    // the admin repo is always served here
    ENV: isLocal ? 'staging' : 'live',
    SUPABASE: isLocal ? STAGING : LIVE,
    EMAIL_DOMAIN: 'users.dame-hub.local', // internal address, never shown or mailed
    SESSION_KEY: 'dame.session',
    THEME_KEY: 'dame.theme',
    SESSION_HOURS: 12
  };
})();
