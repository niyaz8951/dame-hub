# DAME status

Chats that start with **DAME-ADMIN** continue from here.

## Environment
- GitHub `niyaz8951/dame-hub` (Pages, `main`, root). Tiles: sibling repos, `docs/TILES.md`.
- Supabase: live project **`dame-hub`** (`https://cykpvtekrdfmqimtrcps.supabase.co`). A staging project `dame-staging` was created by the owner on 2026-11-04 (second Free slot); `core/v1/config.js` `STAGING` still equals `LIVE` until its URL and publishable key arrive (see Next, item 0). Until then "staging" in the rule book means the live project, and `seed-staging.sql` demo accounts are removed before the team arrives (disable them in Admin > Users, or `delete from auth.users where email like 'demo\_%@example.com'`).

## Built (step 1, 2026-11-04)
- `docs/`: SECURITY, STANDARDS, TILE-CONTRACT, NEW-TILE, MOVE-ACCOUNT (the rule book), STATUS, TILES, RUNBOOK.
- `db/core/001_init.sql`: schema `core` (profiles, tiles, tile_access, audit, migrations), sign-up trigger, `core.require_session/require_user/require_tile/has_tile/is_tile_admin/username_of/audit/applied/make_super/reset_password/require_super`, `public.core_*` (site_info, session_start, me, my_tiles, sign_out, password_changed, set_display_name, admin_users, admin_set_status, admin_tiles, admin_tile_save, admin_tile_enable, admin_audit, tile_users, tile_access_set), `core.security_check()` (9 checks). `db/core/tests.sql` (allowed + refused for every function, rolled back), `db/core/seed-staging.sql`.
- `core/v1/`: theme.css (Daikin palette, day/night, components), config.js, api.js (Auth, rpc, Storage with plain fetch), core.js (guard, topbar, sheet, toast, helpers), icons (13 SVG), README.md (CSP line, API).
- Pages: `index.html` (sign in, request access, waiting), `dashboard.html`, `admin.html` (requests, users, tiles + access, audit), `access.html` (tile admins), `account.html` (name, password, forced change), `404.html`, `robots.txt`, `.nojekyll`.
- `dev/serve.mjs` (GitHub Pages layout locally), `dev/test/` (local Postgres stand-in for Supabase + Playwright run; all green).
- `demo/`: a complete tile - page, `db/demo/001_init.sql` (schema, 4 functions, private bucket + policies), `tests.sql`, docs.

## Decisions made in step 1 (say if any should change)
- Super user has every tile and every right; tile admins have every *declared* right of their tile; a right not declared on the tile refuses everyone but the super user.
- Owner-created accounts (005): Admin > Users > New user gives username + temporary password; the account is inserted directly into `auth.users` with `<username>@users.dame-hub.local` (Supabase checks domains only on self-service sign-up), active at once, `must_change_password` set. The sign-in box accepts a username (internal address appended) or an email.
- Self-service sign-in is by the user's own email address + password (Supabase Auth has no username field and rejects made-up addresses). The username is a unique handle shown instead of the address; the address appears only on the account page and in the admin user list. Nothing is ever mailed.
- Sessions: `core_session_start()` binds the sign-in session to the account; any other session of that user is refused; 12 hours max. The browser also drops a session older than 12 hours by itself.
- Failed sign-ins cannot be seen by the database (Supabase Auth rejects them first); they are in Supabase > Logs > Auth. `docs/SECURITY.md` section 7 still lists them; a password-verification Auth hook can add them to `core.audit` later.
- Default privileges: functions the owner creates in **any** schema are executable by nobody until granted (Postgres cannot do this per schema). Every SQL file grants `authenticated` explicitly, as the contract already says.
- Owner password reset: `core.reset_password(username, temp)` sets `must_change_password`; the account page forces the change and skips the "current password" field in that case.
- The demo tile lives in `dame-hub/demo/`; since 2026-11-04 it is served at `/dame-hub/demo/` (tile inside the admin repo), so no `demo` repo is needed.
- `access.html` added (not in the original page list): tile admins manage their users there, reached from the account menu on the tile.
- `core.username_of(uuid)` added to the contract for Storage paths `<username>/...`.

## Decisions 2026-11-04 (tile `hvac-notes`)
- The owner's existing repos may join as tiles when he decides (the original idea: several repos, linked as tiles on the main site). The "nothing is imported" rule now applies to users and accounts only. Pattern in `docs/NEW-TILE.md`, "Bringing an existing site in".
- First case: `HVAC` (HVAC Notes reader) -> tile **`hvac-notes`**, a new clean public repo. Its content (pages, images, index) moves to schema `hvac_notes` and private bucket `hvac-notes`. Per-user highlights, notes and reading positions move to the database. The shared-password encryption goes.
- No source repo for this tile (owner, 2026-11-04): `HVAC` is **deleted** after cut-over, once the tile is checked and two offline backups are kept. Supabase is the only home of the content. The Publish page (right `edit`) uploads zips of pages and exports all pages as a zip (authoring copy and backup). Claude sends new or changed pages as a zip in the chat.
- **Shared highlights and notes** (owner): visible to everyone with the tile; author edits and deletes his own, tile admin and super user may delete any; reading positions stay private.
- **Online only**: no offline copy of the content on devices (no service worker cache of tile data).
- Videos open on YouTube (no iframe); content widgets become tile code.
- The Claude project "HVAC Engineering" becomes "DAME - HVAC Notes" (instructions from the `docs/NEW-TILE.md` template, filled by the admin project).
- History of `HVAC` checked (95 commits): no plain content, key or password was ever committed; only ciphertext, a wrapped key and empty `nav.json` files.

## Look refresh (2026-11-04, owner: "more immersive, modern; day/night as an icon")
- Decided without asking: sun/moon icon switch, avatar menu, hero band on the dashboard (greeting by time of day, date, tile count, Admin as a glass button), skeleton tiles while loading, brand block on the sign-in page, segmented tabs, rounder cards and sheets, pill toasts. Colours stay Daikin Middle East; system fonts only; no new outside source (CSP unchanged).
- Checked: day and night, 1280 px and 390 px (no sideways scroll), menu, theme switch, admin page.

## Tile accents (2026-11-04, owner: "theme must reflect in tiles and everything; each tile its own colour, close to the base; HVAC Notes keeps its colours")
- `db/core/007_tile_accent.sql`: `core.tiles.accent` (palette check, default `blue`), `core_my_tiles` and `core_admin_tiles` return it, `core_me` puts it in `tile`, `core_admin_tile_save` takes `p_accent` (7 arguments; the 6-argument version is dropped). Tests cover an invalid accent and the value on every path.
- `theme.css`: `--accent-*` tokens, palette blue / teal / green / orange / violet / rose / slate for day and night, `.progress`, `.cover`; buttons, tabs, chips, badges, icons and input focus now follow `--accent` (= brand unless a tile sets one). Topbar, mark, hero, avatar stay brand. `core.js` sets `data-accent` on `<html>` from `core_me`; `Core.ACCENTS`, `Core.accent`, `Core.setAccent`. Dashboard cards carry `data-accent`; Admin > Tiles has a Colour field with a live preview.
- Checked: core tests, demo tests, `core.security_check()` empty, full Playwright run green; dashboard and demo tile at 1100 px, day and night, with four accents.
- Decided without asking: the "on" switch in admin stays green (success), not accent; `.badge.brand` and `.notice.brand` keep working and now equal `.badge.accent` / `.notice.accent`.

## Tools tile (2026-11-04, owner: "a new tile Tools, in dame-hub itself; bring over the parts extractor from QuickTools and the coil data extractor, container calculator and psychrometric chart from Thinkneering")
- **Tiles inside the admin repo** (core change, no SQL): `core/v1/config.js` `INSIDE_CORE: ['tools', 'demo']`; `Core.tilePath(id)`; the dashboard links such tiles at `/dame-hub/<id>/`. `docs/STANDARDS.md` section 2 describes it. The demo tile moved to `/dame-hub/demo/` with it (its two asset paths changed); no `demo` repo is needed any more.
- The dev tooling moved from `tools/` to `dev/` (`dev/serve.mjs`, `dev/test/`) to free the folder; `serve.mjs` no longer maps inside tiles to `/<id>/`.
- `tools/`: home page (four cards, core theme), `assets/tl.js` (guard + the `TN` / `Hub` helpers the tools call), `assets/tl-legacy.css` (the old site's stylesheet with every token pointed at `theme.css` and the tile accent; no hard-coded colour), the four tools as they were, `vendor/pdfjs` (Apache 2.0) and `vendor/xlsx` SheetJS 0.18.5 from npm (Apache 2.0; replaces the cdnjs load the parts extractor's worker used). Both vendored files checked: no network calls.
- Changes to the tools: standard `<head>` (CSP, core files, `defer`), inline `Hub.requireLogin` scripts removed, back links to `/dame-hub/tools/`, pdf.js worker path, `localStorage` keys renamed to `dame.tools.*` (cleared on sign-out), psychrometric chart series colours as classes instead of `style=` attributes (the CSP blocks them), container PDF reads the `day` theme (was `light`) and its fallback palette is Daikin blue, one unescaped vehicle name escaped. `tools/docs/TILE.md` records the accepted deviation: markup built with `innerHTML` from escaped values, no database data.
- Checked: `dev/test/run.sh` green (core tests, demo tests, security check empty, browser run incl. the new "tools tile" step: dashboard link, home and the four pages at 1100 px and 390 px, topbar, accent, no sideways scroll, no console errors, a user without the tile refused). Screenshots in `dev/test/out/`.
- Decided without asking: tile has no rights and no schema; its colour is whatever the owner sets (test used violet); page heads stack (eyebrow, title, lede) under the core topbar; the tile is listed in `docs/TILES.md` as run by the owner and this project.

## Projects tile (2026-11-04, owner: "register tile `projects`; data stays in the one DAME database")
- Registered: id `projects`, name Projects, repo `niyaz8951/projects` (created by the owner), team and tile admin the owner for now, Claude project "DAME - Projects" (instructions in `docs/tiles/projects-project-instructions.md`, chats start `DAME-PROJECTS`). Order after Tools, colour to be chosen later, **off** until its first version is checked.
- **Decision (owner):** Projects keeps its data in schema `projects` and private bucket `projects` inside the one DAME database, **not** a separate Supabase project: one sign-in, rights, audit and `core.security_check()` only work inside one project, and the schema and bucket already isolate it. If it outgrows the Free limits, the path is Pro on `dame-hub`, not a second project. The second Free slot is the staging project.
- 2026-11-05 (owner): **the tile is the Thinkneering Projects tool moved as it is** (`niyaz8951/Thinkneering`, `public/tools/projects` + the parts of `datasheet-notes`, `compliance-maker`, `product-options` it uses; `docs/End-to-End-Walkthrough.md` there is the specification). Browser code brought over and adapted to the core like the Tools tile; the Worker/D1 server side rewritten as `public.projects_*` functions in schema `projects`. The earlier "copy no code" line is withdrawn.
- 2026-11-05 (owner): must remain exactly as it is - datasheet values shown under the clauses that ask for them (blue chips), and without a datasheet the dashed chips from approved Product Options.
- 2026-11-05 (owner): **Maps are not in this tile**; rule books / knowledge maps / vocabulary become a separate tile later, discussed after the compliance maker, datasheet reading and Product Options are ready. (My 2026-11-04 reading of "maps" as project locations was wrong; corrected.)
- 2026-11-05 (owner): specification PDFs are **not** stored; only the clauses are, as rows in schema `projects`, as the old tool did. Datasheet PDFs are not stored either; the table read from them is (`jsonb`, not the bucket). Bucket `projects` only if a later step needs real files.
- 2026-11-05 (owner): no split later - Compliance review and Product Options stay pages of the tile; on a converted spec each clause shows the datasheet value (blue), else the approved Product Options (dashed, other colour), plus the library answer from Compliance review, so the reader fills the compliance easily.
- Decided without asking (admin rule "no AI"): the `ai_*` parts of the old tool (Focus-mode proposals, AI review, AI rules, Check the AI, vocabulary, AI notes) are left out; Focus mode stays as the manual pane. Seeds allowed: products, factories, client types, regions, starter keywords (configuration, no internal data); everything else starts empty.
- Scope, one step at a time, each checked before the next: (1) project register; (2) datasheet notes + row mapping + Product Options collection; (3) specification and record with chips, Focus mode, Excel downloads; (4) compliance review (factory library); (5) Product Options pages. Then the Maps tile discussion.

## SQL applied
| File | `dame-hub` project |
|---|---|
| `db/core/001_init.sql` | applied 2026-11-04 |
| `db/core/002_email_domain.sql` | applied 2026-11-04 (superseded) |
| `db/core/003_email_domain.sql` | applied 2026-11-04 (superseded) |
| `db/core/004_email_signin.sql` | applied 2026-11-04 |
| `db/core/005_owner_users.sql` | - |
| `db/core/006_display_names.sql` | - |
| `db/core/007_tile_accent.sql` | - |
| `demo/db/demo/001_init.sql` | - |
| `db/core/seed-staging.sql` | - (optional, demo accounts) |

**Fresh project (staging), in this order:** `001_init`, `004_email_signin`, `005_owner_users`, `006_display_names`, `007_tile_accent`, `demo/db/demo/001_init.sql`, every tile's `db/<tile_id>/NNN_*.sql` (today `hvac-notes`), then `seed-staging.sql`. `002` and `003` are skipped on a fresh project: `004` replaces the same trigger and nothing depends on them.

## Next
0. **Staging values:** the URL and key sent on 2026-11-04 for `dame-staging` were the live project's (`cykpvtekrdfmqimtrcps`); waiting for the staging project's own Project URL + publishable key (Supabase > `dame-staging` > Project Settings > API Keys). On arrival: `config.js` `STAGING`, staging URL in `img-src` and `connect-src` of the CSP line in `core/v1/README.md` and every page (core, `demo/`, `tools/`), entry under "Changes tiles must know" so `hvac-notes` updates its CSP line.
0a. Owner: apply `db/core/007_tile_accent.sql` (after 005 and 006), `select * from core.security_check();`, Security Advisor. Until it runs, the live admin tile form cannot save (it calls the 7-argument function) and the dashboard shows every tile in blue.
1. Owner: apply `db/core/005_owner_users.sql`, security check, then Admin > Users > New user for the first colleague (sign-in by username only). Register tile `demo` in the admin page, apply `demo/db/demo/001_init.sql`, switch it on (RUNBOOK "First run").
2. Done: Supabase refuses made-up email domains (`.local`, `example.com`, ...), so the username-only scheme (001-003) was dropped. Since 004 an account is the user's own email + password, with a chosen username as the visible handle. No account existed before 004, so nothing migrates.
3. Owner: check the live site on a laptop and a phone; report anything odd.
4. Step 2 candidates (on request): Playwright run against the real project with the demo accounts; password-verification hook for failed sign-ins; staging project.
5. **Owner, now:** turn off GitHub Pages on `QuickTools` (it loads cdnjs and Google Fonts on the DAME address, `docs/SECURITY.md` section 5). Also turn it off on `RECKON`, `Thinkneering` and `dame-tools-hub` unless one is needed live; a live one must load no outside code.
6. **Tools tile:** Claude project "DAME - Tools" (instructions in `docs/tiles/tools-project-instructions.md`, delivered 2026-11-04) takes over the tile's features from here; this project keeps the core and the e2e step. Admin > Tiles: make sure a tile with id **`tools`** exists (name Tools, icon `tools`, no rights), pick its colour, switch it on, give access. Open `/dame-hub/tools/` on a laptop and a phone and try each tool with a real file. If the registered tile has another id, say so: `INSIDE_CORE` and the folder name must match it.
7. **Tile `projects`:** registered 2026-11-04 (see "Projects tile"). Owner creates the Claude project "DAME - Projects" from `docs/tiles/projects-project-instructions.md`, enters the tile in Admin > Tiles (off), then starts `DAME-PROJECTS: step 1 - project register`. Connect `niyaz8951/Thinkneering` to that project (read): it is the source of the tool.
8. **Tile `hvac-notes`:** repo created and tile registered (on) 2026-11-04. Owner converts the "HVAC Engineering" Claude project with the instructions delivered 2026-11-04, then the tile project builds it. Cut-over to follow "Bringing an existing site in", step 5.

## Changes tiles must know
- 2026-11-04 - **Tiles inside the admin repo** (`core/v1/config.js` `INSIDE_CORE`, `Core.tilePath`; no breaking change). A tile the owner keeps in `dame-hub/<id>/` is served at `/dame-hub/<id>/` and the dashboard links it there. Sibling-repo tiles change nothing. The dev tooling is now `dev/serve.mjs` and `dev/test/` (was `tools/`).
- 2026-11-04 - **Tile accents** (`db/core/007_tile_accent.sql`, `core/v1` theme.css + core.js; no breaking change). Each tile has one hue from the core palette, set in Admin > Tiles > Colour; the core puts `data-accent` on `<html>` and primary buttons, tabs, chips, badges, icons, input focus and the new `.progress` / `.cover` follow it. Tiles change nothing to get it. A tile that colours sections of its own (covers, headings) replaces its colour values with `data-accent="<name>"` + `var(--accent-*)` on its next delivery; `docs/TILE-CONTRACT.md` section 2 lists the tokens and names. **`hvac-notes` keeps its current colours** (blue accent; its covers map to blue / green / orange / violet).
- 2026-11-04 - **`core.display_names(p_tile, p_ids uuid[])`** (`db/core/006_display_names.sql`, requested by `hvac-notes`): current `username` and `display_name` (plus `active`) of the authors of shared records. Call it only inside the tile's own functions; the caller must have the tile; pending accounts are never returned; max 500 ids. Listed in `docs/TILE-CONTRACT.md` section 2. Tiles that saved a name next to each record may keep it as a fallback.
- 2026-11-04 - **Embedded YouTube player allowed for `hvac-notes` only.** It adds `frame-src https://www.youtube-nocookie.com` to its CSP on pages that show videos (exact line in `core/v1/README.md`), on the conditions in `docs/SECURITY.md` section 4: click to load, iframe `src` built from a checked video id, `sandbox`, `referrerpolicy`, and a "Watch on YouTube" link. `docs/TILE-CONTRACT.md` section 6 names the exception. Other tiles: unchanged, no iframes; ask the owner through `docs/CORE-REQUESTS.md` if one needs it. `docs/TILES.md` has a new column, Exceptions.
- 2026-11-04 - **Look refresh (core/v1, no breaking change).** Day/night is now a round sun/moon icon button with a circular reveal; account menu is an avatar + name pill (also on phones, where it used to be hidden); soft brand glow behind every page (`body` is transparent, `html` carries `--bg`); primary buttons use the brand gradient; `.tabs` is a segmented control; tiles have gradient icons, a hover arrow and a staggered entrance. New tokens and classes in `core/v1/README.md` (Theme). Tiles change nothing; a tile that set its own `body` background should drop it so the glow shows. Icon classes now also work without `.icon` (`.i-<name>`).
- 2026-11-04 - Rule book: an existing site may join as a tile (`docs/NEW-TILE.md`, "Bringing an existing site in"); `docs/SECURITY.md` section 1 allows a private **source repo** for a tile's authoring copy and says shared-password encryption in a public repo is not allowed. `docs/STANDARDS.md` section 1 and the project template wording changed to match.
- 2026-11-04 - `core_me()` also returns `email` (the caller's own address). Tiles keep showing `username`; never show or store the address in a tile.
- 2026-11-04 - Site is named **DAME HUB**; theme now carries the Daikin Middle East palette (`--brand #0097E0`, night `#2FB0EC`), the layers-glyph mark and favicons in `core/v1/icons/`. Token names unchanged; `--link`, `--focus`, `--glass`, `--scrim`, `--ease`, `--brand-sky`, `--brand-navy` added. Pages add `<link rel="icon" href="/dame-hub/core/v1/icons/favicon.svg">` and the apple-touch-icon line (see `core/v1/README.md`).
- 2026-11-04 - core/v1 first version. Icons are `.icon.i-<name>`; `Core.requireLogin` returns a promise of `me`; `core.username_of` available; CSP line in `core/v1/README.md`.

## Security notes
- No key or password has ever been in this repo or in chat (the publishable key in `config.js` is public by design).
- 2026-11-04 - Account scan: `QuickTools` pages load `cdnjs.cloudflare.com` scripts and Google Fonts. If its Pages is on, that code runs on the same address as DAME and could read the session. Open until the owner turns its Pages off. `RECKON`, `Thinkneering` and `dame-tools-hub` load no outside code in their pages (checked in their current files).
