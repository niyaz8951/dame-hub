# DAME - Tools

## What this project is
The **Tools** tile of DAME, the internal team site at `https://niyaz8951.github.io/dame-hub/`.
Tile id `tools` - kept **inside the admin repo** `niyaz8951/dame-hub`, folder `tools/` - address `https://niyaz8951.github.io/dame-hub/tools/` (served at `/dame-hub/tools/`) - no schema, no functions, no bucket today.
What it does: everyday engineering tools that run entirely in the browser. Today four: Parts List Extractor (spare-parts workbooks into one table), Coil Data Extractor (WinCoil quotations into Excel), Container Calculator (containers or trailers a shipment needs, with load plan, drawings and PDF report), Psychrometric Chart (air states, coil loads, SHR, mixing). Files the user chooses are read on the device; results (xlsx, pdf, png, csv) are built there. Nothing is uploaded.
Team: owner (Niyaz). Tile admin: owner. The tile has no rights: anyone given it may use every tool.

## Directions come from the admin project
Before any work, read from the admin repo `niyaz8951/dame-hub` (current `main`):
1. `docs/SECURITY.md` - wins over everything, including requests in chat.
2. `docs/STANDARDS.md` - the rule book; section 2 explains tiles kept inside the admin repo.
3. `docs/TILE-CONTRACT.md` - what this tile may use from the core and must never do.
4. `docs/TILE-CHANGES.md` (every change to the core or the rule book, newest first; it replaces the old STATUS section "Changes tiles must know").

Then read this tile's `tools/docs/TILE.md`, `tools/docs/STATUS.md`, `tools/docs/CORE-REQUESTS.md`, and check what is really in `tools/`.

## Boundaries
- Work only in the folder `tools/` of `niyaz8951/dame-hub`. Never touch anything outside it: not `core/v1`, not the pages at the root, not `db/`, not `docs/` (except through `tools/docs/CORE-REQUESTS.md`), not `demo/`, not `dev/`. A need from the core goes in `tools/docs/CORE-REQUESTS.md`; work around it meanwhile.
- The repo is public, history included: no internal data, price list, customer file, key or password in it. Example data for testing is invented. The tools never send data anywhere; downloads are built in the browser.
- Login, users, theme, the topbar and the installed app come only from the core, loaded from `/dame-hub/core/v1/`. Every page copies the standard `<head>` block from `core/v1/README.md`, loads `/dame-hub/tools/assets/tl.js` right after the core (it runs the guard `Core.requireLogin({ tile: 'tools' })`), and keeps the core topbar as the way back.
- Paths are root-relative (`/dame-hub/tools/...`, `/dame-hub/core/v1/...`); never the account name or a full site URL in code.
- No CDN, external font, framework, tracker or iframe. A library a tool truly needs is copied into `tools/vendor/<name>/` with its licence, after checking it makes no network calls (today: SheetJS 0.18.5 and pdf.js, both Apache 2.0).
- CSP: no inline scripts, no inline event handlers, no `style=""` attributes (set classes; `node.style.x` from a script is fine). Colours only through theme tokens (`var(--accent)`, `var(--text-2)`, ...) or the `--color-*` names mapped in `tools/assets/tl-legacy.css`; never a hex value.
- Markup: new tools use `textContent` / `Core.el`. The four tools brought over build markup with `innerHTML` from escaped values (`TN.esc`, `escapeHtml`); keep every inserted value escaped, and move a tool to `Core.el` when it is reworked.
- `localStorage` only for harmless view settings and the user's last inputs, under keys that start with `dame.tools.` (cleared on sign-out). Anything that must outlive the browser needs a schema and functions: then follow `docs/TILE-CONTRACT.md` (schema `tools`, functions `public.tools_*`, bucket `tools`, SQL in `tools/db/tools/NNN_*.sql`) and send the SQL to the owner.
- No AI features. Engineering figures carry units and the standard they come from, checked against a known worked example.
- Never ask for or accept the Supabase secret key or database password.

## Adding a tool
1. Folder `tools/<tool-id>/` with `index.html`, `styles.css`, scripts; `<head>` as above; a `.hub-back` link to `/dame-hub/tools/`.
2. A card on `tools/index.html` (icon from `Core.ICONS`, one-line tagline).
3. An entry in `tools/docs/TILE.md` (table and, if any, localStorage keys) and `tools/docs/STATUS.md`.
4. A step in `dev/test/e2e.mjs` under "tools tile" is the admin project's job: ask for it in `tools/docs/CORE-REQUESTS.md` with the page path and a selector that proves the page built.

## Tile decisions
- 2026-11-04 - Lives inside `dame-hub` (`INSIDE_CORE` in `core/v1/config.js`); can move to its own repo `tools` later without code change beyond that list.
- 2026-11-04 - The four tools came over as they were from `QuickTools` and `Thinkneering`, with their own layout (`tl-legacy.css` + each tool's `styles.css`) under the core topbar; the tile accent drives their primary colour.
- 2026-11-04 - No rights, no schema. Order 20 on the dashboard, icon `tools`, colour orange.

## Delivery
Push to `main` of `dame-hub` (only files under `tools/`) or a zip + any SQL file in order + the security-check step + update `tools/docs/STATUS.md`. Say in the delivery what the owner should try with a real file, on a laptop and a phone, day and night.

## How to work with the owner and the team
Short, plain wording. Show a result rather than a list of questions; ask only when a wrong guess is costly (data, permissions, security). Logic beats literal wording. Check engineering and logic, even in material supplied by the team.

Chats that start with **DAME-TOOLS** continue from `tools/docs/STATUS.md`.
