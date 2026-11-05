# DAME status

Chats that start with **DAME-ADMIN** continue from here. This file is **now and next** only; what was built and decided is in `docs/CHANGELOG.md`, what tiles must act on in `docs/TILE-CHANGES.md`.

## Environment
- GitHub `niyaz8951/dame-hub` (Pages, `main`, root). Tiles: sibling repos, `docs/TILES.md`.
- Supabase: live project **`dame-hub`** (`https://cykpvtekrdfmqimtrcps.supabase.co`). No staging project for now (owner, 2026-11-05: `dame-staging` deleted, to be revisited); `core/v1/config.js` `STAGING` equals `LIVE`. Until one exists "staging" in the rule book means the live project, and `seed-staging.sql` demo accounts are removed before the team arrives (disable them in Admin > Users, or `delete from auth.users where email like 'demo\_%@example.com'`).
- Tests: `dev/test/run.sh` (local Postgres stand-in + Playwright), `node dev/migrations-check.mjs`, `node dev/lines-check.mjs`.

## What the core does today
- Sign in (username or email + password), request access, approval, one session per user, 12 hours; owner-created accounts with a forced password change; rename, set password, disable and delete accounts.
- Dashboard with tile accents and the daily line; Admin: Requests, Users, Tiles (access, rights, tile admins, on / off, colour), Audit, **Health** (security check, nightly job, SQL files waiting); `access.html` for tile admins; Account page.
- The installed app (one app for the whole site, offline page only).
- Shared files `core/v1/*`; tiles inside the admin repo (`demo`, `tools`); helpers for tiles: `core.require_tile`, `core.has_tile`, `core.username_of`, `core.display_names`, `core.tile_users`.
- Wall: `core.security_check()` (9 checks), run nightly once `010` is applied.

## SQL applied
Admin > Health > SQL files shows this live from the database and each repo's `db/migrations.json`; this table is the record at the last delivery.

| File | `dame-hub` project |
|---|---|
| `db/core/001_init.sql` | applied 2026-11-04 |
| `db/core/002_email_domain.sql` | applied 2026-11-04 (superseded) |
| `db/core/003_email_domain.sql` | applied 2026-11-04 (superseded) |
| `db/core/004_email_signin.sql` | applied 2026-11-04 |
| `db/core/005_owner_users.sql` | applied |
| `db/core/006_display_names.sql` | applied (owner, 2026-11-05) |
| `db/core/007_tile_accent.sql` | applied (owner, 2026-11-05) |
| `db/core/008_manage_users.sql` | applied (owner, 2026-11-05) |
| `db/core/009_tile_users.sql` | **to apply** |
| `db/core/010_health.sql` | **to apply** |
| `demo/db/demo/001_init.sql` | see Admin > Health |
| `db/core/seed-staging.sql` | - (optional, demo accounts) |

**Fresh project (staging), in this order:** `001_init`, `004_email_signin`, `005_owner_users`, `006_display_names`, `007_tile_accent`, `008_manage_users`, `009_tile_users`, `010_health`, `demo/db/demo/001_init.sql`, every tile's files in the order of its `db/migrations.json`, then `seed-staging.sql`. `002` and `003` are skipped on a fresh project (marked `superseded`): `004` replaces the same trigger and nothing depends on them.

## Next
1. **Owner, now:** apply `db/core/009_tile_users.sql`, then `db/core/010_health.sql` (read each first). The notice at the end of 010 says whether the nightly job was scheduled; if not: Supabase > Integrations > Cron > enable, then run the `do $schedule$ ... $schedule$;` block of 010 again. Then **Admin > Health**: the check should say Clean and the nightly job On; the SQL files table shows what else has not run (demo, tiles). Security Advisor as usual.
2. **Owner:** install and check on a phone (RUNBOOK "Install the app"), if not done yet: open a tile from inside the app, switch day / night, look at the status bar.
3. **Tiles, on their next delivery** (`docs/TILE-CHANGES.md`, 2026-11-05): `db/migrations.json` + `CLAUDE.md` in `hvac-notes`, `projects`, `maps`. `projects` can now fill its Share sheet once 009 is applied.
4. **Tile set-ups still open** (owner): Tools - registered and on with id `tools`? Projects - building one step at a time in "DAME - Projects". Maps - repo settings (`docs/NEW-TILE.md` step 2), Claude project "DAME - Maps", Admin > Tiles entry (id `maps`, Maps, icon `map`, rose, rights `edit, verify`, off), then `DAME-MAPS: step 1`. HVAC Notes - cut-over per "Bringing an existing site in", step 5.
5. Weekly lines refresh runs as a scheduled task (Monday morning, Dubai); it pushes `lines.json` and logs in `docs/LINES.md`.
6. Candidates, on request: checks on every push (GitHub Actions: contract lint, SQL lists, SQL tests on a throw-away database; needs the owner's yes, it is a new GitHub feature in use), phone notifications for access requests (Supabase Edge Function + web push; needs the owner's yes), staging project, password-verification hook for failed sign-ins, search across tiles.

## Open core requests
- (none) - `projects`: `core.tile_users` delivered in `009` (2026-11-05). `hvac-notes`, `maps`: nothing open.

## Changes tiles must know
Moved to **`docs/TILE-CHANGES.md`** (2026-11-05). Tile projects whose instructions still say "`docs/STATUS.md`, section Changes tiles must know" read that file instead.

## Security notes
- No key or password has ever been in this repo or in chat (the publishable key in `config.js` is public by design).
- 2026-11-05 - Closed: the owner deleted the old repos (`QuickTools`, `RECKON`, `dame-tools-hub` and `HVAC` are no longer publicly reachable). `Thinkneering` is still public: it is the source of `projects` and `maps` and loaded no outside code when checked on 2026-11-04; turn its Pages off when nothing needs it live (`docs/SECURITY.md` section 5).
