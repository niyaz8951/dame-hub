# DAME status

Chats that start with **DAME-ADMIN** continue from here.

## Environment
- GitHub `niyaz8951/dame-hub` (Pages, `main`, root). Tiles: sibling repos, `docs/TILES.md`.
- Supabase: **one project, `dame-hub`** (`https://cykpvtekrdfmqimtrcps.supabase.co`), used for testing and live until the team starts using the site. `core/v1/config.js` already has a `STAGING` slot (today = LIVE); `docs/RUNBOOK.md` "Add a staging project" says what changes when it exists. Until then "staging" in the rule book means this project, and `seed-staging.sql` demo accounts are removed before the team arrives (disable them in Admin > Users, or `delete from auth.users where email like 'demo\_%@example.com'`).

## Built (step 1, 2026-11-04)
- `docs/`: SECURITY, STANDARDS, TILE-CONTRACT, NEW-TILE, MOVE-ACCOUNT (the rule book), STATUS, TILES, RUNBOOK.
- `db/core/001_init.sql`: schema `core` (profiles, tiles, tile_access, audit, migrations), sign-up trigger, `core.require_session/require_user/require_tile/has_tile/is_tile_admin/username_of/audit/applied/make_super/reset_password/require_super`, `public.core_*` (site_info, session_start, me, my_tiles, sign_out, password_changed, set_display_name, admin_users, admin_set_status, admin_tiles, admin_tile_save, admin_tile_enable, admin_audit, tile_users, tile_access_set), `core.security_check()` (9 checks). `db/core/tests.sql` (allowed + refused for every function, rolled back), `db/core/seed-staging.sql`.
- `core/v1/`: theme.css (Daikin palette, day/night, components), config.js, api.js (Auth, rpc, Storage with plain fetch), core.js (guard, topbar, sheet, toast, helpers), icons (13 SVG), README.md (CSP line, API).
- Pages: `index.html` (sign in, request access, waiting), `dashboard.html`, `admin.html` (requests, users, tiles + access, audit), `access.html` (tile admins), `account.html` (name, password, forced change), `404.html`, `robots.txt`, `.nojekyll`.
- `tools/serve.mjs` (GitHub Pages layout locally), `tools/test/` (local Postgres stand-in for Supabase + Playwright run; all green).
- `demo/`: a complete tile - page, `db/demo/001_init.sql` (schema, 4 functions, private bucket + policies), `tests.sql`, docs.

## Decisions made in step 1 (say if any should change)
- Super user has every tile and every right; tile admins have every *declared* right of their tile; a right not declared on the tile refuses everyone but the super user.
- Sessions: `core_session_start()` binds the sign-in session to the account; any other session of that user is refused; 12 hours max. The browser also drops a session older than 12 hours by itself.
- Failed sign-ins cannot be seen by the database (Supabase Auth rejects them first); they are in Supabase > Logs > Auth. `docs/SECURITY.md` section 7 still lists them; a password-verification Auth hook can add them to `core.audit` later.
- Default privileges: functions the owner creates in **any** schema are executable by nobody until granted (Postgres cannot do this per schema). Every SQL file grants `authenticated` explicitly, as the contract already says.
- Owner password reset: `core.reset_password(username, temp)` sets `must_change_password`; the account page forces the change and skips the "current password" field in that case.
- The demo tile lives in `dame-hub/demo/` (served at `/demo/` locally); it is live once a repo `demo` exists in the account with that folder's contents.
- `access.html` added (not in the original page list): tile admins manage their users there, reached from the account menu on the tile.
- `core.username_of(uuid)` added to the contract for Storage paths `<username>/...`.

## SQL applied
| File | `dame-hub` project |
|---|---|
| `db/core/001_init.sql` | applied 2026-11-04 |
| `db/core/002_email_domain.sql` | applied 2026-11-04 (superseded by 003) |
| `db/core/003_email_domain.sql` | - |
| `demo/db/demo/001_init.sql` | - |
| `db/core/seed-staging.sql` | - (optional, demo accounts) |

## Next
1. Owner: apply `db/core/003_email_domain.sql`, security check, request access as `niyaz`, `core.make_super('niyaz')`, register tile `demo` in the admin page, apply `demo/db/demo/001_init.sql`, switch it on (RUNBOOK "First run").
2. Owner: Supabase Auth settings from `01-SETUP.md` step 2.4 (confirm email off, password rules, Site URL, `public` only exposed). If Supabase refuses `@example.com` at sign-up, say so: `config.js` `EMAIL_DOMAIN` and the trigger's domain check change together (new SQL file).
3. Owner: check the live site on a laptop and a phone; report anything odd.
4. Step 2 candidates (on request): Playwright run against the real project with the demo accounts; password-verification hook for failed sign-ins; staging project.

## Changes tiles must know
- 2026-11-04 - Site is named **DAME HUB**; theme now carries the Daikin Middle East palette (`--brand #0097E0`, night `#2FB0EC`), the layers-glyph mark and favicons in `core/v1/icons/`. Token names unchanged; `--link`, `--focus`, `--glass`, `--scrim`, `--ease`, `--brand-sky`, `--brand-navy` added. Pages add `<link rel="icon" href="/dame-hub/core/v1/icons/favicon.svg">` and the apple-touch-icon line (see `core/v1/README.md`).
- 2026-11-04 - core/v1 first version. Icons are `.icon.i-<name>`; `Core.requireLogin` returns a promise of `me`; `core.username_of` available; CSP line in `core/v1/README.md`.

## Security notes
- No key or password has ever been in this repo or in chat (the publishable key in `config.js` is public by design).
