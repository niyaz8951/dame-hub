# DAME standards (rule book for the admin repo and every tile)

Kept in the admin repo as `docs/STANDARDS.md`. Every DAME Claude project reads it, together with `docs/SECURITY.md`, before work. Security wins over everything. If a tile's own instructions disagree with this file, this file wins unless the owner decided otherwise for that tile.

## 1. What DAME is
An internal team site. Users sign in with their email address and password, wait for approval, and see only the tiles they were given. Each tile is a separate repo, run by its own team and Claude project; the admin repo provides login, theme and permissions to all of them. Everything starts fresh; no AI for now.

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
- **Local run:** clone `dame-hub` and the tile repos side by side; `node tools/serve.mjs` in `dame-hub` serves it at `http://localhost:8080/dame-hub/` and each sibling repo at `/<tile-id>/`, the same layout as GitHub Pages.
- **Who runs what:** the owner runs the GitHub account, `dame-hub` and Supabase, and applies every SQL file. Each tile repo has its team as collaborators with write access to that repo only. A tile id never reuses the name of another repo in the account.

## 3. Users and roles
- Account = username + password, created by the super user (no email needed), or self-service with the user's own email address + password (Supabase Auth). Username: 3-30 characters, `a-z 0-9 . _ -`, lower case, unique; shown everywhere instead of the address. Display name. Nothing else personal.
- Status: `pending` (requested), `active`, `disabled`. Only `active` users get anything.
- **Super user** (the owner): approves accounts, creates and switches tiles, names tile admins, sees the audit.
- **Tile admin:** gives and removes access and rights for his tile only.
- **User:** sees his tiles; per-tile rights (e.g. `edit`, `reply`) are declared by each tile.
- Nothing is shown as locked: a user sees only what he may open. Tile taglines are neutral.
- Sign-in, session and password rules: `docs/SECURITY.md` section 2.

## 4. Database
- Schemas: `core`, plus one per tile = tile id with `-` turned into `_` (`hvac-notes` -> `hvac_notes`). `public` holds only functions.
- Browser calls: `public.core_<action>` and `public.<tile_id>_<action>` only. Rules for functions, rights, RLS and Storage: `docs/SECURITY.md` section 3.
- Errors are plain codes pages can show: `SIGNED_OUT`, `NOT_APPROVED`, `NO_ACCESS`, `NO_RIGHT`, `NOT_FOUND`, `INVALID:<field>`.
- **SQL files:** `db/<schema>/NNN_short_name.sql` in the repo that owns the schema, numbered, never edited after they ran on live (a fix is a new file). Each file ends with `select core.applied('<repo>', 'NNN_short_name');`. The owner reads and runs them in the SQL editor: staging, `core.security_check()`, test, then live.
- Types: `uuid` ids (`gen_random_uuid()`), `timestamptz`, `text` tile ids, `jsonb` only for genuinely free-form data.
- Rows stay small; files, images and long tables go to the tile's private Storage bucket.

## 5. Browser rules
- Plain HTML, CSS, JS; no framework, bundler, CDN, external font or tracker. A library a tile truly needs (markdown, maths) is copied into the tile's `vendor/` with its licence.
- Every page, in this order: CSP meta and `robots` noindex meta (`docs/SECURITY.md` section 4), then `/dame-hub/core/v1/theme.css`, `/dame-hub/core/v1/config.js`, `/dame-hub/core/v1/api.js`, `/dame-hub/core/v1/core.js`; `<html lang="en" data-loading>`; `<header id="topbar"></header>`; the guard first: `Core.requireLogin()`, `Core.requireLogin({ tile: 'hvac-notes' })`, `{ tile, right: 'edit' }`, `{ super: true }`.
- Data only through `Api.rpc(name, params)` and `Api.file(...)`. They add the session, refresh it, and turn error codes into plain messages; `SIGNED_OUT` sends the user to `/dame-hub/?next=<path>`.
- `textContent` / `Core.el()`, never `innerHTML` with data. No inline scripts or handlers.
- `Core.sheet` and `Core.toast` instead of `alert` / `confirm` / `prompt`.
- Dates shown as `4 Nov 2026`, local time.

## 6. Theme
- Tokens only in `/dame-hub/core/v1/theme.css`: brand blue, surfaces, text, lines, success / warning / danger, radius, spacing; day and night (follows the device, user can switch). Never a hard-coded colour in a tile.
- System font. Calm, clear, plenty of space; pleasant to use on a laptop and a phone.
- Site name `DAME HUB` and the mark (the layers glyph on Daikin blue, `core/v1/icons/mark.svg`, `favicon.svg`) come from `core/v1/config.js` (`SITE_NAME`) and `core/v1/icons/`. Colours are the Daikin Middle East palette (`--brand #0097E0`); no other logo.

## 7. Quality bar (every page, every function)
- Day and night; phone width 390 px with no sideways page scroll.
- Validated inputs with plain messages; loading, empty and error states.
- Engineering figures carry units and the standard they come from, checked against a known worked example.
- Take-away output opens in office tools (xlsx, docx, pdf, csv), built in the browser.
- Every function refuses correctly and has a test proving it.

## 8. Testing
- Playwright against `node tools/serve.mjs` (`http://localhost:8080/dame-hub/`) + the staging project.
- `db/<schema>/tests.sql`, run on staging: for each function one allowed call and refused calls for signed out, pending, disabled, no tile, no right, another user's record.
- Demo accounts on staging only (`demo_admin`, `demo_user`, `demo_pending`, `demo_none`), from `db/core/seed-staging.sql`. Demo data is invented, never copied from real work.

## 9. Delivery (every project)
- Push to the repo (or a zip) + the SQL files in order + the security-check step + any manual step.
- Update the repo's `docs/STATUS.md` in the same delivery.
- A need from the core goes in the tile's `docs/CORE-REQUESTS.md`; tiles never change the core.

## 10. Working with the owner
Short, plain wording, no filler. Show a result rather than a list of questions; ask only when a wrong guess is costly. Logic beats literal wording: think it through, do it properly, say what was decided. Check engineering and logic even in material the owner supplies.

## 11. Handover to IT
- Code: `dame-hub` and the tile repos, transferred as they are to an official GitHub account or organization (`docs/MOVE-ACCOUNT.md`). Data: Supabase organization `DAME`; IT is made owner. Neither depends on the other's account.
- No secret in any repo. The Supabase URL and publishable key in `config.js` are public by design.
- Company sign-in later: Supabase Auth supports company single sign-on (Pro); usernames map to company accounts without changing tiles.
- A company domain later: pointed at the new account's Pages; the paths `/dame-hub/` and `/<tile-id>/` stay, so tiles do not change.
- Export: database backup (Pro: daily; Free: `pg_dump` with the connection string) plus Storage buckets; the repos are the code. `docs/RUNBOOK.md` has the commands.
