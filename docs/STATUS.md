# DAME status

Chats that start with **DAME-ADMIN** continue from here. This file is **now and next** only; what was built and decided is in `docs/CHANGELOG.md`, what tiles must act on in `docs/TILE-CHANGES.md`.

## Environment
- GitHub `niyaz8951/dame-hub` (Pages, `main`, root). Tiles: sibling repos, `docs/TILES.md`.
- Supabase: live project **`dame-hub`** (`https://cykpvtekrdfmqimtrcps.supabase.co`). No staging project for now (owner, 2026-11-05: `dame-staging` deleted, to be revisited); `core/v1/config.js` `STAGING` equals `LIVE`. Until one exists "staging" in the rule book means the live project, and `seed-staging.sql` demo accounts are removed before the team arrives (disable them in Admin > Users, or `delete from auth.users where email like 'demo\_%@example.com'`).
- Tests: `dev/test/run.sh` (local Postgres stand-in + Playwright), `node dev/migrations-check.mjs`, `node dev/lines-check.mjs`.

## What the core does today
- Sign in (username or email + password), request access, approval, one session per user, 12 hours; owner-created accounts with a forced password change; rename, set password, disable and delete accounts.
- Dashboard with tile accents and the daily line; Admin: Requests, Users (Manage: name, password, disable, delete, **Access**: Check access + Hand over), **Groups**, Tiles (Access by level for people and groups, special rights, managers, on / off, colour, declared or not), Audit, **Health** (security check, nightly job, SQL files waiting); `access.html` for a tile's managers; Account page.
- **Access model (011)**: levels read < contribute < edit < approve < manage per tile, own or through a group; tile declarations (`core.tile_declare`); containers shared from the Access panel (`Core.share`), tile level as ceiling, managers open everything (`docs/TILE-CONTRACT.md` section 5).
- The installed app (one app for the whole site, offline page only).
- Shared files `core/v1/*` (incl. `share.js`); tiles inside the admin repo (`demo`, `tools`); helpers for tiles: `core.require_tile`, `core.require_level`, `core.has_tile`, `core.tile_level`, `core.require_container`, `core.container_*`, `core.tile_declare`, `core.username_of`, `core.display_names`, `core.tile_users`.
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
| `db/core/011_access.sql` | applied 2026-11-06 |
| `demo/db/demo/001_init.sql`, `002_access.sql` | - (demo not registered on live) |
| `db/core/seed-staging.sql` | - (optional, demo accounts) |

**Fresh project (staging), in this order:** `001_init`, `004_email_signin`, `005_owner_users`, `006_display_names`, `007_tile_accent`, `008_manage_users`, `009_tile_users`, `010_health`, `011_access`, `demo/db/demo/001_init.sql`, `002_access.sql`, every tile's files in the order of its `db/migrations.json`, then `seed-staging.sql`. `002` and `003` are skipped on a fresh project (marked `superseded`): `004` replaces the same trigger and nothing depends on them.

## Next
**Site-wide needs and their order: `docs/FOUNDATIONS.md`** (read first in every chat; F10-F23 open).
1. **011 applied on live** (2026-11-06 15:58 Dubai). Owner: Admin > Health > **Run check now** (must say Clean; the two pg_cron policies no longer show), Security Advisor; Admin > Tiles > each tile's **Access**: check every level (011 set them from the old rights); make the **groups** (Admin > Groups).
2. **Tiles move to the model, one at a time, in their own chats** (plan per tile in `docs/TILE-CHANGES.md`, 2026-11-06): `hvac-notes` (notebooks as containers, levels for publish / approve), then `maps` (maps as containers; managers see private maps), then `projects` (projects as containers, members into shares, owners share their own). Each is one SQL file + pages; the admin project answers their core requests.
3. **Owner, first (still open): the HVAC Notes backup.** Old `HVAC` repo: if deleted without its zip, the tile's export (HVAC Notes > Publish > *Download all pages*) is the only copy outside Supabase; keep one off this computer, then tell the admin project the date `HVAC` went (Phase 3 step 9).
4. **Tiles, next delivery** (from 2026-11-05): `maps` adds `db/migrations.json` + `CLAUDE.md` if not yet there; `hvac-notes` `publish.html` and the four `tools/` tool pages take the `theme-color` head line; `projects` moves its `core.tile_users` request to Done.
5. **Staging, before the team arrives.** Every tile file goes straight to live, which holds real work. The second free Supabase slot as `dame-staging` (`docs/RUNBOOK.md`, "Add a staging project").
6. **Backups.** Free plan keeps no restorable backup: weekly `pg_dump` (`docs/RUNBOOK.md`, "Export") kept off the computer, or Pro once the team relies on it.
7. **Tools and Demo.** Tools registered with id `tools`, on? Demo stays off on live.
8. **Thinkneering**: Pages off when nothing needs the old site live; delete only after `projects` step 5 and `maps` steps 4-5.
9. Candidates, on request: on the dashboard **Shared with me** and **Waiting for you** (counts from each tile), **Request access** to a tile; checks on every push (GitHub Actions); phone notifications for access requests; password-verification hook; search across tiles.

## Open core requests
- `hvac-notes` (2026-11-06): health check flags pg_cron's own policies - **done in `011_access.sql`** (rule h passes `cron.job: cron_job_policy` and `cron.job_run_details: cron_job_run_details_policy` only in pg_cron's own shape; anything else still reported). The tile moves its entry to Done once 011 is applied.
- `projects`: `core.tile_users` delivered in `009` (2026-11-05); the tile moves its entry to Done. Its Share sheet is replaced by `Core.share` when it moves to the access model.
- `maps`: instructions copy updated 2026-11-05 (flowcharts); the tile moves its entry to Done.

## Changes tiles must know
Moved to **`docs/TILE-CHANGES.md`** (2026-11-05). Tile projects whose instructions still say "`docs/STATUS.md`, section Changes tiles must know" read that file instead.

## Security notes
- No key or password has ever been in this repo or in chat (the publishable key in `config.js` is public by design).
- 2026-11-05 - Closed: the owner deleted the old repos (`QuickTools`, `RECKON`, `dame-tools-hub` and `HVAC` are no longer publicly reachable). `Thinkneering` is still public: it is the source of `projects` and `maps` and loaded no outside code when checked on 2026-11-04; turn its Pages off when nothing needs it live (`docs/SECURITY.md` section 5).
