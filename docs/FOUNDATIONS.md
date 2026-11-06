# DAME foundations

Kept in the admin repo as `docs/FOUNDATIONS.md`. The things every tile depends on, which cost little to settle early and a lot to retrofit once several tiles have built around their absence (the access model, 2026-11-06, was one). Owner, 2026-11-06: "such things are highlighted at an early stage in any chat anywhere".

## The rule
- **Every DAME chat reads this file first** - the admin project and every tile project, before `docs/STATUS.md`.
- **Raise it in the first reply.** Anything a chat notices that every tile will need (or that one tile is about to invent for itself) is said at the start of the reply, before any feature is built around it: a tile writes it in its `docs/CORE-REQUESTS.md` and works on; the admin project adds it below with a priority.
- **Nothing site-wide is built inside a tile.** Sign-in, people, groups, access, sharing, notifications, search, history, export conventions: the core decides once, tiles use it.
- Each line carries its status. The admin project keeps it current in the same push as the work.

## Settled
| # | Foundation | Where |
|---|---|---|
| F1 | Sign-in, approval, owner-created accounts, one session, 12 hours; rename, reset, disable, delete | `db/core/001`-`008`, `docs/SECURITY.md` 2 |
| F2 | **Access**: levels read < contribute < edit < approve < manage, groups, tile declarations, containers shared from one Access panel, managers see everything, Check access, Handover | `db/core/011`, `docs/TILE-CONTRACT.md` 5 |
| F3 | Security wall: functions only in `public`, RLS everywhere, `core.security_check()` nightly, Health tab | `docs/SECURITY.md` 3, `db/core/010` |
| F4 | Audit of every sign-in, approval, access and sharing change | `core.audit`, `docs/SECURITY.md` 7 |
| F5 | One installed app for the whole site; tiles never install on their own | `docs/STANDARDS.md` 12 |
| F6 | One theme, tile accents, shared components | `core/v1`, `docs/TILE-CONTRACT.md` 2 |
| F7 | Tile contract, registry, SQL lists, core requests, changes for tiles | `docs/TILE-CONTRACT.md`, `docs/TILES.md`, `docs/TILE-CHANGES.md` |
| F8 | Portability: no account name in code or data; moving account, going private | `docs/MOVE-ACCOUNT.md` |
| F9 | Data class: technical data only, nothing personal beyond username and display name (owner, 2026-11-06) | `docs/SECURITY.md` 1 |

## Open, in the order to do them
| # | Foundation | Why it cannot wait | Who | Status |
|---|---|---|---|---|
| F10 | **Staging project** (second free Supabase slot) | Every tile file runs straight on live, which holds real work | Owner, 15 min (`docs/RUNBOOK.md`, "Add a staging project") | open |
| F11 | **Backups and one tested restore** | The free plan keeps no backup you can restore; a backup never restored is a hope | Owner: Pro on `dame-hub` (daily backups) or the weekly export kept off the computer; then one restore into staging | open |
| F12 | **Second super user, break-glass** | Today one person holds GitHub, Supabase and the only super account; illness or a lost phone stops everything | Owner names who (IT once approved); Supabase and GitHub MFA recovery codes kept offline | open |
| F13 | **IT approval pack**: one document for IT - what is public, where data lives, the wall, accounts and access, audit, backups, exit plan | DAME is waiting for IT approval; IT asks the same questions for every tile | Admin project writes it from the rule book | next |
| F14 | **Waiting for you**: each tile reports what waits for the signed-in user (`public.<tile>_waiting()` -> count + link); the dashboard shows the counts on the tiles | Projects (review), HVAC Notes (page approval), Maps (verify) each have a queue already; reviewers should not open every tile to find work | Core convention + dashboard; tiles add one function | next (core 012) |
| F15 | **Shared with me, Request access**: the dashboard lists what was shared with the user lately and the tiles he does not have, with a request his managers approve | Built on F2; without it people ask the owner by chat | Core | next (core 012) |
| F16 | **Checks on every push** (GitHub Actions in every repo): the contract scan (CSP, `innerHTML`, account name, manifest, grants), the SQL list, SQL tests on a throw-away database | Manual scans stop working as tiles and teams grow; a tile team cannot break the wall unnoticed | Core writes the workflow; owner says yes and adds it to each repo | waiting for the owner's yes |
| F17 | **Usage and limits in Health**: database size, storage per tile bucket, biggest tables, slowest functions | Free-plan limits arrive without warning; tiles with files (datasheets) grow fast | Core | planned |
| F18 | **Page errors reported**: `core.js` sends unexpected errors (`core_log_error`, no data) to Health | A tile page that breaks for one user today is invisible to the owner | Core | planned |
| F19 | **Search across tiles**: one index (`core.search_put`) that respects containers, one search box on the dashboard | Each tile searching only itself is fine for three tiles, not for ten; the index shape must be fixed before tiles feed it | Core contract first, tiles feed it when they next deliver | planned |
| F20 | **Data lifecycle per tile**: an export a manager can download, what is kept how long, retiring a tile (export, off, schema dropped) | IT will ask; a tile retired without an export loses its data | Rule book section + one export function per tile | planned |
| F21 | **One history shape**: who changed what, when, before and after, per record | Projects and Maps already keep history in two different shapes; Check access and handover will want one view | Rule book convention; tiles adopt it on their next change | planned |
| F22 | **Company sign-in (SSO) when IT asks** | Must stay possible without touching tiles | Decided by design: tiles key everything by user id (F1), so the sign-in method can change in the core alone | settled by design, nothing to build now |
| F23 | **Language and direction**: English, left to right, for the whole site | Arabic or right-to-left later would touch every page | Owner to confirm | proposed |

## Watch
- **Scale of access checks**: `core.container_ids` checks each container in turn; fine for hundreds per tile, to be indexed before thousands (F17 will show it).
- **Tile count on one account**: every Pages site of the account shares one address (`docs/SECURITY.md` 5); a DAME-only account or organization before many teams join (`docs/MOVE-ACCOUNT.md`).
