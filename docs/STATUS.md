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
- Owner-created accounts (005): Admin > Users > New user gives username + temporary password; the account is inserted directly into `auth.users` with `<username>@users.dame-hub.local` (Supabase checks domains only on self-service sign-up), active at once, `must_change_password` set. The sign-in box accepts a username (internal address appended) or an email.
- Self-service sign-in is by the user's own email address + password (Supabase Auth has no username field and rejects made-up addresses). The username is a unique handle shown instead of the address; the address appears only on the account page and in the admin user list. Nothing is ever mailed.
- Sessions: `core_session_start()` binds the sign-in session to the account; any other session of that user is refused; 12 hours max. The browser also drops a session older than 12 hours by itself.
- Failed sign-ins cannot be seen by the database (Supabase Auth rejects them first); they are in Supabase > Logs > Auth. `docs/SECURITY.md` section 7 still lists them; a password-verification Auth hook can add them to `core.audit` later.
- Default privileges: functions the owner creates in **any** schema are executable by nobody until granted (Postgres cannot do this per schema). Every SQL file grants `authenticated` explicitly, as the contract already says.
- Owner password reset: `core.reset_password(username, temp)` sets `must_change_password`; the account page forces the change and skips the "current password" field in that case.
- The demo tile lives in `dame-hub/demo/` (served at `/demo/` locally); it is live once a repo `demo` exists in the account with that folder's contents.
- `access.html` added (not in the original page list): tile admins manage their users there, reached from the account menu on the tile.
- `core.username_of(uuid)` added to the contract for Storage paths `<username>/...`.

## Decisions 2026-11-04 (tile `hvac-notes`)
- The owner's existing repos may join as tiles when he decides (the original idea: several repos, linked as tiles on the main site). The "nothing is imported" rule now applies to users and accounts only. Pattern in `docs/NEW-TILE.md`, "Bringing an existing site in".
- First case: `HVAC` (HVAC Notes reader) -> tile **`hvac-notes`**, a new clean public repo. Its content (pages, images, index) moves to schema `hvac_notes` and private bucket `hvac-notes`. Per-user highlights, notes and reading positions move to the database. The shared-password encryption goes.
- No source repo for this tile (owner, 2026-11-04): `HVAC` is **deleted** after cut-over, once the tile is checked and two offline backups are kept. Supabase is the only home of the content. The Publish page (right `edit`) uploads zips of pages and exports all pages as a zip (authoring copy and backup). Claude sends new or changed pages as a zip in the chat.
- **Online only**: no offline copy of the content on devices (no service worker cache of tile data).
- Videos open on YouTube (no iframe); content widgets become tile code.
- The Claude project "HVAC Engineering" becomes "DAME - HVAC Notes" (instructions from the `docs/NEW-TILE.md` template, filled by the admin project).
- History of `HVAC` checked (95 commits): no plain content, key or password was ever committed; only ciphertext, a wrapped key and empty `nav.json` files.

## SQL applied
| File | `dame-hub` project |
|---|---|
| `db/core/001_init.sql` | applied 2026-11-04 |
| `db/core/002_email_domain.sql` | applied 2026-11-04 (superseded) |
| `db/core/003_email_domain.sql` | applied 2026-11-04 (superseded) |
| `db/core/004_email_signin.sql` | applied 2026-11-04 |
| `db/core/005_owner_users.sql` | - |
| `demo/db/demo/001_init.sql` | - |
| `db/core/seed-staging.sql` | - (optional, demo accounts) |

## Next
1. Owner: apply `db/core/005_owner_users.sql`, security check, then Admin > Users > New user for the first colleague (sign-in by username only). Register tile `demo` in the admin page, apply `demo/db/demo/001_init.sql`, switch it on (RUNBOOK "First run").
2. Done: Supabase refuses made-up email domains (`.local`, `example.com`, ...), so the username-only scheme (001-003) was dropped. Since 004 an account is the user's own email + password, with a chosen username as the visible handle. No account existed before 004, so nothing migrates.
3. Owner: check the live site on a laptop and a phone; report anything odd.
4. Step 2 candidates (on request): Playwright run against the real project with the demo accounts; password-verification hook for failed sign-ins; staging project.
5. **Owner, now:** turn off GitHub Pages on `QuickTools` (it loads cdnjs and Google Fonts on the DAME address, `docs/SECURITY.md` section 5). Also turn it off on `RECKON`, `Thinkneering` and `dame-tools-hub` unless one is needed live; a live one must load no outside code.
6. **Tile `hvac-notes`:** repo created and tile registered (on) 2026-11-04. Owner converts the "HVAC Engineering" Claude project with the instructions delivered 2026-11-04, then the tile project builds it. Cut-over to follow "Bringing an existing site in", step 5.

## Changes tiles must know
- 2026-11-04 - Rule book: an existing site may join as a tile (`docs/NEW-TILE.md`, "Bringing an existing site in"); `docs/SECURITY.md` section 1 allows a private **source repo** for a tile's authoring copy and says shared-password encryption in a public repo is not allowed. `docs/STANDARDS.md` section 1 and the project template wording changed to match.
- 2026-11-04 - `core_me()` also returns `email` (the caller's own address). Tiles keep showing `username`; never show or store the address in a tile.
- 2026-11-04 - Site is named **DAME HUB**; theme now carries the Daikin Middle East palette (`--brand #0097E0`, night `#2FB0EC`), the layers-glyph mark and favicons in `core/v1/icons/`. Token names unchanged; `--link`, `--focus`, `--glass`, `--scrim`, `--ease`, `--brand-sky`, `--brand-navy` added. Pages add `<link rel="icon" href="/dame-hub/core/v1/icons/favicon.svg">` and the apple-touch-icon line (see `core/v1/README.md`).
- 2026-11-04 - core/v1 first version. Icons are `.icon.i-<name>`; `Core.requireLogin` returns a promise of `me`; `core.username_of` available; CSP line in `core/v1/README.md`.

## Security notes
- No key or password has ever been in this repo or in chat (the publishable key in `config.js` is public by design).
- 2026-11-04 - Account scan: `QuickTools` pages load `cdnjs.cloudflare.com` scripts and Google Fonts. If its Pages is on, that code runs on the same address as DAME and could read the session. Open until the owner turns its Pages off. `RECKON`, `Thinkneering` and `dame-tools-hub` load no outside code in their pages (checked in their current files).
