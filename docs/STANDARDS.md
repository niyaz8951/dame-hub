# DAME standards (rule book for the admin repo and every tile)

Kept in the admin repo as `docs/STANDARDS.md`. Every DAME Claude project reads it, together with `docs/SECURITY.md`, before work. Security wins over everything. If a tile's own instructions disagree with this file, this file wins unless the owner decided otherwise for that tile.

## 1. What DAME is
An internal team site. Users sign in with their email address and password, wait for approval, and see only the tiles they were given. Each tile is a separate repo, run by its own team and Claude project; the admin repo provides login, theme and permissions to all of them. No AI for now. Users and accounts start fresh; an existing site of the owner may join as a tile when he decides it (`docs/NEW-TILE.md`, "Bringing an existing site in").

## 2. Architecture

```
https://<account>.github.io/dame-hub/    admin repo <account>/dame-hub   (sign in, dashboard, admin, core/v1)
https://<account>.github.io/<tile-id>/   tile repo <account>/<tile-id>   (one per tile, one team)
   today <account> = niyaz8951
                |
        Supabase project "dame-hub"      (a separate staging project is added when the team starts using the site)
          Auth                          username accounts, sessions
          schema core                   profiles, tiles, access, audit
          schema <tile_id>              one per tile, not reachable by the API
          public.core_* / public.<tile_id>_*   functions: the only door
          Storage bucket <tile-id>      private, one per tile
```

- **Hosting:** GitHub Pages, branch `main`, root. A push is live in about a minute. Every repo has `.nojekyll`.
- **One address**, so the session kept by `core.js` is shared by every tile.
- **No account name anywhere in code or data.** The core is always at `/dame-hub/`, tiles at `/<tile-id>/`. Pages use root-relative paths (`/dame-hub/core/v1/core.js`, `/<tile-id>/page.html`); the database stores tile ids, never URLs. Moving to another account is a repo transfer (`docs/MOVE-ACCOUNT.md`).
- **Environments:** `core/v1/config.js` has a `LIVE` and a `STAGING` entry and uses `STAGING` when the host is `localhost`. Until a staging project exists, `STAGING` points at the same project as `LIVE` (see `docs/STATUS.md`); once it exists, only `config.js` changes. Claude never tests against the live project once the team uses the site.
- **Tiles inside the admin repo:** a tile the owner keeps in `dame-hub` itself (today `demo`, `tools`) lives in the folder `dame-hub/<tile-id>/` and is served at `/dame-hub/<tile-id>/`. `core/v1/config.js` lists these ids in `INSIDE_CORE`; `Core.tilePath(id)` gives the path and the dashboard uses it. Everything else about the tile (id, guard, schema, bucket, docs) is the same as for a sibling repo; such a tile is run by the owner and the admin project, and can move out to its own repo later by removing it from `INSIDE_CORE`.
- **Local run:** clone `dame-hub` and the tile repos side by side; `node dev/serve.mjs` in `dame-hub` serves it at `http://localhost:8080/dame-hub/` and each sibling repo at `/<tile-id>/`, the same layout as GitHub Pages (tiles inside the admin repo come with it, at `/dame-hub/<tile-id>/`).
- **Who runs what:** the owner runs the GitHub account, `dame-hub` and Supabase, and applies every SQL file. Each tile repo has its team as collaborators with write access to that repo only. A tile id never reuses the name of another repo in the account.

## 3. Users and roles
- Account = username + password, created by the super user (no email needed), or self-service with the user's own email address + password (Supabase Auth). Username: 3-30 characters, `a-z 0-9 . _ -`, lower case, unique; shown everywhere instead of the address. Display name. Nothing else personal.
- Status: `pending` (requested), `active`, `disabled`. Only `active` users get anything.
- **Super user** (the owner): approves accounts, makes groups, creates and switches tiles, names managers (level manage), checks access, hands over, sees the audit.
- **Manager of a tile** (level manage, "tile admin"): gives people and groups the levels read to approve on his tile, and opens every container in it.
- **Everyone else:** one level per tile (read, contribute, edit, approve), own or through a group; what each level means in a tile is that tile's declaration (`docs/TILE-CONTRACT.md` section 5). Projects, maps, notebooks and the like are shared from their Access panel (`Core.share`).
- Nothing is shown as locked: a user sees only what he may open. Tile taglines are neutral.
- Sign-in, session and password rules: `docs/SECURITY.md` section 2.

## 4. Database
- Schemas: `core`, plus one per tile = tile id with `-` turned into `_` (`hvac-notes` -> `hvac_notes`). `public` holds only functions.
- Browser calls: `public.core_<action>` and `public.<tile_id>_<action>` only. Rules for functions, rights, RLS and Storage: `docs/SECURITY.md` section 3.
- Errors are plain codes pages can show: `SIGNED_OUT`, `NOT_APPROVED`, `NO_ACCESS`, `NO_RIGHT`, `NOT_FOUND`, `INVALID:<field>`.
- **SQL files:** `db/<schema>/NNN_short_name.sql` in the repo that owns the schema, numbered, never edited after they ran on live (a fix is a new file). Each file ends with `select core.applied('<repo>', 'NNN_short_name');` and is listed in the repo's `db/migrations.json` (`docs/TILE-CONTRACT.md` section 4, "SQL list"); Admin > Health shows the owner which listed files have not run. The owner reads and runs them in the SQL editor: staging, `core.security_check()`, test, then live.
- Types: `uuid` ids (`gen_random_uuid()`), `timestamptz`, `text` tile ids, `jsonb` only for genuinely free-form data.
- Rows stay small; files, images and long tables go to the tile's private Storage bucket.

## 5. Browser rules
- Plain HTML, CSS, JS; no framework, bundler, CDN, external font or tracker. A library a tile truly needs (markdown, maths) is copied into the tile's `vendor/` with its licence.
- Every page, in this order: CSP meta and `robots` noindex meta (`docs/SECURITY.md` section 4), then `/dame-hub/core/v1/theme.css`, `/dame-hub/core/v1/config.js`, `/dame-hub/core/v1/api.js`, `/dame-hub/core/v1/core.js`; `<html lang="en" data-loading>`; `<header id="topbar"></header>`; the guard first: `Core.requireLogin()`, `Core.requireLogin({ tile: 'hvac-notes' })`, `{ tile, level: 'approve' }`, `{ tile, right: 'edit' }`, `{ super: true }`. A **Share** button (opening `Core.share`) sits beside the title of every container page and on each row of its list, for the owner and managers; others may open it to see who has access.
- Data only through `Api.rpc(name, params)` and `Api.file(...)`. They add the session, refresh it, and turn error codes into plain messages; `SIGNED_OUT` sends the user to `/dame-hub/?next=<path>`.
- `textContent` / `Core.el()`, never `innerHTML` with data. No inline scripts or handlers.
- `Core.sheet` and `Core.toast` instead of `alert` / `confirm` / `prompt`.
- Dates shown as `4 Nov 2026`, local time.

## 6. Theme
- Tokens only in `/dame-hub/core/v1/theme.css`: brand blue, surfaces, text, lines, success / warning / danger, radius, spacing; day and night (follows the device, user can switch). Never a hard-coded colour in a tile.
- **One theme, tile accents** (owner, 2026-11-04). Everything a user sees inside DAME - core pages, tile pages, notes, lists, sheets, downloads - uses the core tokens and components: surfaces, text, lines, radius, spacing, topbar, cards, buttons, tabs, chips, badges, progress bars, day and night. A tile writes no colour, font, radius or shadow of its own.
- Each tile has **one accent** from the core palette (`blue` = DAME brand, `teal`, `green`, `orange`, `violet`, `rose`, `slate`), chosen by the super user in Admin > Tiles > Colour. The core sets `data-accent` on `<html>` for the tile's pages and on its dashboard card; buttons, tabs, chips, icons and progress bars follow it through the `--accent-*` tokens (`core/v1/README.md`, Theme). The topbar, mark, hero and avatar stay brand blue everywhere, so every tile is visibly DAME.
- Inside a tile, a section may use another hue from the same palette (e.g. notebook covers) only by putting `data-accent="<name>"` on that element and using `var(--accent-*)`; never a hex or named colour.
- System font. Calm, clear, plenty of space; pleasant to use on a laptop and a phone.
- Site name `DAME HUB` and the mark (the layers glyph on Daikin blue, `core/v1/icons/mark.svg`, `favicon.svg`) come from `core/v1/config.js` (`SITE_NAME`) and `core/v1/icons/`. Colours are the Daikin Middle East palette (`--brand #0097E0`); no other logo.

## 7. Quality bar (every page, every function)
- Day and night; phone width 390 px with no sideways page scroll.
- Validated inputs with plain messages; loading, empty and error states.
- Engineering figures carry units and the standard they come from, checked against a known worked example.
- Take-away output opens in office tools (xlsx, docx, pdf, csv), built in the browser.
- Every function refuses correctly and has a test proving it.

## 8. Testing
- Playwright against `node dev/serve.mjs` (`http://localhost:8080/dame-hub/`) + the staging project.
- `db/<schema>/tests.sql`, run on staging: for each function one allowed call and refused calls for signed out, pending, disabled, no tile, too low a level, a container not shared with him (`NOT_FOUND`), another user's record.
- Demo accounts on staging only (`demo_admin`, `demo_user`, `demo_pending`, `demo_none`), from `db/core/seed-staging.sql`. Demo data is invented, never copied from real work.

## 9. Delivery (every project)
- Push to the repo (or a zip) + the SQL files in order + the security-check step + any manual step.
- Update the repo's `docs/STATUS.md` in the same delivery.
- A need from the core goes in the tile's `docs/CORE-REQUESTS.md`; tiles never change the core.

## 10. Working with the owner
Short, plain wording, no filler. Show a result rather than a list of questions; ask only when a wrong guess is costly. Logic beats literal wording: think it through, do it properly, say what was decided. Check engineering and logic even in material the owner supplies.

## 11. Handover to IT
- Code: `dame-hub` and the tile repos, transferred as they are to an official GitHub account or organization (`docs/MOVE-ACCOUNT.md`). Private repos, access-controlled Pages or another host: `docs/MOVE-ACCOUNT.md` section C (what each costs and changes). Data: Supabase organization `DAME`; IT is made owner. Neither depends on the other's account.
- No secret in any repo. The Supabase URL and publishable key in `config.js` are public by design.
- Company sign-in later: Supabase Auth supports company single sign-on (Pro); usernames map to company accounts without changing tiles.
- A company domain later: pointed at the new account's Pages; the paths `/dame-hub/` and `/<tile-id>/` stay, so tiles do not change.
- Export: database backup (Pro: daily; Free: `pg_dump` with the connection string) plus Storage buckets; the repos are the code. `docs/RUNBOOK.md` has the commands.

## 12. The installed app
- **One app for the whole site**, defined only in `dame-hub`: `/dame-hub/manifest.webmanifest` (`id` `/dame-hub/`, `scope` `/`, `start_url` the dashboard, `display` `standalone`, icons `core/v1/icons/icon-192.png` and `icon-512.png`, `background_color` `#F3F7FA`, `theme_color` `#0097E0`), `/dame-hub/sw.js`, `/dame-hub/offline.html`. Every core page links the manifest.
- **Tiles never install on their own.** A tile has no manifest, no service worker, no app icons and no install prompt. Because the scope is `/`, every tile page opens inside the app once it is installed; a tile only needs the standard head block from `core/v1/README.md` (`viewport-fit=cover` and `theme-color`), so its page sits right under the notch and above the home bar.
- **The service worker serves `offline.html` and nothing else.** It handles same-origin page navigations (network, or the offline page) and keeps only that page's own files; it never caches a page with data in it, never touches a Supabase request, never stores anything internal. Its scope is `/dame-hub/` (GitHub Pages cannot widen it); offline, a sibling tile shows the browser's own error, which is acceptable because DAME is online only.
- **Install app** is in the account menu, hidden once the page already runs inside the app. On Chrome and Edge it opens the browser's own prompt; elsewhere a sheet with the steps for the device (iPhone and iPad: Safari > Share > Add to Home Screen).
- `theme-color` follows the page background, day or night (`core.js` updates the meta); the topbar, `main`, sheets and toasts pad for the safe areas.
- Team instructions: `docs/RUNBOOK.md`, "Install the app". Checked on a real phone whenever an app file changes.
