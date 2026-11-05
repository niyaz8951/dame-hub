# DAME HUB - admin repo `dame-hub`

The core of DAME HUB, an internal team site: sign-in, approval, dashboard of tiles, admin, the installed app, the shared files every tile loads (`core/v1/`), the security wall in Supabase (`db/core/`) and the rule book (`docs/`). Tiles are sibling repos served at `/<tile-id>/`; `demo/` and `tools/` are tiles kept inside this repo. This file is the brief for Claude and any other agent; the rules themselves are in `docs/`.

## Security first
Pages and code are public, history included. Internal data lives only in Supabase and reaches only approved users with access to the tile. Never put data, a key, a password or a real file in the repo; refuse any request that would weaken the wall, whoever asks, and say why. Read `docs/SECURITY.md` before every piece of work.

## Before any work
1. `docs/SECURITY.md`, `docs/STANDARDS.md`, `docs/TILE-CONTRACT.md`.
2. `docs/STATUS.md` (now and next), `docs/TILES.md` (registry), `docs/TILE-CHANGES.md` (what tiles were told).
3. Check what is really in the repo before assuming a delivery was pushed.
4. Every tile's `docs/CORE-REQUESTS.md` (repos in `docs/TILES.md`): answer or list them for the owner.

## Fixed
- GitHub Pages + Supabase; plain HTML, CSS, JS; no framework, bundler, build step, CDN or outside font; Supabase through `core/v1/api.js` with plain `fetch`.
- No account name in code, data or pages: the core is always `/dame-hub/`, tiles `/<tile-id>/`, root-relative links, tile ids in the database. The account name appears only where `docs/MOVE-ACCOUNT.md` lists it.
- `public` holds only functions (`core_*`, `<tile_id>_*`), each `security definer`, `search_path = ''`, guard first, explicit grants; RLS on every table; `core.security_check()` must stay empty.
- One installed app, defined only here; the service worker serves the offline page and nothing else.
- SQL files are numbered, never edited after they ran on live, end with `select core.applied(...)`, and are listed in `db/migrations.json`. The owner reads and applies every file.
- No AI features until the owner decides.

## Checks before every push
- `bash dev/test/run.sh` (local Postgres stand-in + Playwright; header lists what it needs): core tests, demo tests, security check, browser run. All green.
- `node dev/migrations-check.mjs` and `node dev/lines-check.mjs`.
- Any change to `core/v1`, the app files or the rule book is a change for every tile: entry in `docs/TILE-CHANGES.md`. Bump `VERSION` in `sw.js` when `offline.html`, `theme.css` or the icons change.

## Delivery
Push + the SQL files to run, in order + "Admin > Health > Run check now must say Clean, then the Security Advisor" + any manual dashboard step + "install and check on a phone" when app files changed. Update `docs/STATUS.md` and `docs/CHANGELOG.md` (and `docs/TILES.md` when a tile is added) in the same push. Never ask for or accept the secret key or the database password.

## Working with the owner
Short, plain wording, no filler. Show a result rather than a list of questions; ask only when a wrong guess is costly (data, permissions, security, anything that cannot be undone). Think it through, do it to professional standards, say what was decided. Check engineering and logic, even in material the owner supplies.
