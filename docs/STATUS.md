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
| `db/core/009_tile_users.sql` | applied 2026-11-05 |
| `db/core/010_health.sql` | applied 2026-11-05 |
| `demo/db/demo/001_init.sql` | - (demo not registered on live) |
| `db/core/seed-staging.sql` | - (optional, demo accounts) |

**Fresh project (staging), in this order:** `001_init`, `004_email_signin`, `005_owner_users`, `006_display_names`, `007_tile_accent`, `008_manage_users`, `009_tile_users`, `010_health`, `demo/db/demo/001_init.sql`, every tile's files in the order of its `db/migrations.json`, then `seed-staging.sql`. `002` and `003` are skipped on a fresh project (marked `superseded`): `004` replaces the same trigger and nothing depends on them.

## Next
Review 2026-11-05 evening (owner: "review and suggest what is done, or some step missed, and way forward"). Contract scan of every tile (CSP line on every page, no outside code, no `innerHTML` with data, no account name, every `public` function `security definer` + `search_path = ''` with execute revoked from `public, anon`, nothing granted to `anon`, no table in `public`, no manifest or service worker): **clean** in `hvac-notes`, `projects`, `maps`, `tools`.

1. **Owner, first: the HVAC Notes backup.** The old `HVAC` repo is no longer public. Its cut-over (`hvac-notes/docs/STATUS.md`, Phase 3) asked for two backups before deleting it. If `HVAC` is deleted and its zip was not kept, the tile's own export is now the only copy outside Supabase: HVAC Notes > Publish > *Download all pages*, kept off this computer. Then tell the admin project the date `HVAC` went (Phase 3 step 9) so the registry closes it.
2. **Done 2026-11-05 (Admin > Health, owner's screenshot):** core up to date (001-010), `projects` up to date (001-010), `maps` 5 files ran (001-005), `hvac-notes` 3 ran (001-003); `demo` is not registered on live (fine: tests only). **`hvac-notes` `003_names` broke shared highlights on live** (each user saw only his own): the owner restored the `002` body of `hvac_notes_shared()` by hand; the tile delivers `004` without the temp table (prompt given 2026-11-05).
3. **Tiles, next delivery** (`docs/TILE-CHANGES.md`): `maps` and `hvac-notes` add `db/migrations.json` + `CLAUDE.md` (`projects` has both); `hvac-notes` `publish.html` and the four `tools/` tool pages take the `theme-color` head line; `projects` moves its `core.tile_users` request to Done.
4. **Staging, before the team arrives.** Every tile file now goes straight to live, which holds real work (projects, the compliance library, maps). The second free Supabase slot as `dame-staging` (`docs/RUNBOOK.md`, "Add a staging project"): tiles test there, the owner applies to live after. The admin project wires `config.js` and the CSP lines on request.
5. **Backups.** The free plan keeps no backup you can restore. Until Pro: a weekly `pg_dump` (`docs/RUNBOOK.md`, "Export") kept off the computer, or move `dame-hub` to Pro (daily backups) once the team relies on it.
6. **Tools and Demo.** Tools: registered with id `tools`, on, tried with a real file (`tools/docs/STATUS.md`)? Demo: keep it **off** on live (it proves the contract in tests; nobody needs it on the dashboard).
7. **Thinkneering**: still public and still the source for `projects` step 5 and `maps` steps 4-5. Pages off on it now if nothing needs the old site live (the tiles read its code from GitHub, not from Pages); delete it only after both tiles are complete.
8. Weekly lines refresh: scheduled task, Mondays 07:43 Dubai, first run 9 Nov.
9. Candidates, on request, best done before the team grows: checks on every push (GitHub Actions: this contract scan, SQL lists, SQL tests on a throw-away database; needs the owner's yes), phone notifications for access requests (Supabase Edge Function + web push; needs the owner's yes), password-verification hook for failed sign-ins, search across tiles.

## Open core requests
- `projects`: `core.tile_users` delivered in `009` (2026-11-05); the tile moves its entry to Done.
- `maps` (2026-11-05): update `docs/tiles/maps-project-instructions.md` for flowcharts as a fourth kind - **done** 2026-11-05 (scope now 1 foundation, 2 knowledge extras, 3 flowcharts, 4 piping, 5 wiring). The owner pastes the updated copy into the "DAME - Maps" project instructions if they differ.
- `hvac-notes`: nothing open.

## Changes tiles must know
Moved to **`docs/TILE-CHANGES.md`** (2026-11-05). Tile projects whose instructions still say "`docs/STATUS.md`, section Changes tiles must know" read that file instead.

## Security notes
- No key or password has ever been in this repo or in chat (the publishable key in `config.js` is public by design).
- 2026-11-05 - Closed: the owner deleted the old repos (`QuickTools`, `RECKON`, `dame-tools-hub` and `HVAC` are no longer publicly reachable). `Thinkneering` is still public: it is the source of `projects` and `maps` and loaded no outside code when checked on 2026-11-04; turn its Pages off when nothing needs it live (`docs/SECURITY.md` section 5).
