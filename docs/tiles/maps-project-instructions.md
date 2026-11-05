# DAME - Maps

## What this project is
The **Maps** tile of DAME, the internal team site at `https://niyaz8951.github.io/dame-hub/`.
Tile id `maps` - repo `niyaz8951/maps` - address `https://niyaz8951.github.io/maps/` (served at `/maps/`) - schema `maps` - functions `public.maps_*` - no bucket (no files are stored; see Tile decisions).
What it does: the team's **Maps tool from Thinkneering** (`niyaz8951/Thinkneering`, `public/tools/maps/`), improved while it moves. A map is a tree of branches with notes, special notes and links. Three kinds: **knowledge** (product or process understanding), **piping** (chilled and condenser water: flows, temperatures, pressures, pumps, a Flow view and a 2D schematic) and **wiring** (supply to equipment: power, BMS and fire-alarm control, demand, load shedding, single-line diagram, cable schedule).
Team: owner (Niyaz) for now. Tile admin: owner.

## Directions come from the admin project
Before any work, read from the admin repo `niyaz8951/dame-hub` (current `main`):
1. `docs/SECURITY.md` - wins over everything, including requests in chat.
2. `docs/STANDARDS.md` - the rule book; overrides anything below unless the owner decided otherwise for this tile.
3. `docs/TILE-CONTRACT.md` - what this tile may use from the core and must never do.
4. `docs/TILE-CHANGES.md` (every change to the core or the rule book, newest first; it replaces the old STATUS section "Changes tiles must know").
5. `demo/` - a complete tile that follows the contract; `tools/` - pages brought over from an older site.
If the repo cannot be read, use the copies in this project's knowledge and say so.

Then read this tile's `docs/TILE.md`, `docs/STATUS.md`, `docs/CORE-REQUESTS.md`, and check what is really in the repo.

## The source: `niyaz8951/Thinkneering` (read it before each step)
- Pages: `public/tools/maps/` - `index.html`, `maps.css`, `maps.js` (list, map and outline views, editor, import / export, Flow and 2D views, schedules), `mp-water.js` (water: circuits, flows, temperatures, pressures, pipe friction), `mp-power.js` (current: sources, switches, BMS / fire alarm, demand, diversity, load shedding), `mp-flow.js` (Flow view layout), `mp-schematic.js` (2D view: piping schematic and single-line diagram), `mp-signs.js` (component symbols). `public/assets/js/xlsx-lite.js` (own Excel writer, no library).
- Checks: `scripts/mp-water-check.mjs`, `mp-power-check.mjs`, `mp-flow-check.mjs`, `mp-signs-check.mjs`, `mp-sld-check.mjs` - worked examples the engines must still pass.
- Server: `worker/src/api/mp.ts` (rights, maps, branches, links, verify, import, search), `mp-piping.ts` (Chilled water template), `mp-wiring.ts` (Electricity template, AHU / FCU EC and DC, chiller unit wiring), `lib/mp-tree.ts` (Arrange by feed).
- Tables: `db/migrations/0001_init.sql` part MAPS (`mp_maps`, `mp_nodes`, `mp_images`), `0004`, `0010` (`kind`, `purpose`), `0015` (columns start from the centre).
- The engines and symbols are proven: bring them over and keep them passing their checks. Read the owner's requirements quoted in their comments (23 Oct 2026); they still stand.

## Boundaries
- Work only in `niyaz8951/maps`, schema `maps`, functions `public.maps_*`.
- The repo is public, history included: no internal data, keys, passwords or real files in it. Real data lives only in Supabase. Templates and test maps are generic and invented: no project, client, site or real drawing.
- Never change the admin repo, `core/v1`, the `core` schema, or another tile. A need from the core goes in `docs/CORE-REQUESTS.md`; work around it meanwhile.
- Login, users, roles, theme and file access come only from the core, loaded from `/dame-hub/core/v1/`. Thinkneering's `hub.js`, `api.js`, `config.js`, sign-in and tool list are **not** brought over: `Core.requireLogin({ tile: 'maps' })`, `Core.rpc`, the core topbar and theme replace them.
- Never write the GitHub account name or a full site URL in code or data; use root-relative paths (`/dame-hub/...`, `/maps/...`), so the tile survives a move to another account.
- No AI. Nothing is imported from the old database (see Tile decisions).
- SQL files go to the owner, who reads and applies them. Never ask for or accept the Supabase secret key or database password.

## Tile decisions
- 2026-11-05 (owner) - **Three kinds only: knowledge, piping, wiring.** The AI rule book and Vocabulary kinds, the rule-book Flow view ("Follow a clause"), `mp_ai_flow`, `ai_map_links`, `ai_vocab_links` and every AI wording are left out. Nothing in this tile depends on the `projects` tile, and nothing there depends on a map.
- 2026-11-05 (owner) - **No pictures.** The old tool stopped using them on 20 Oct 2026 ("text first"): no `mp_images`, no bucket.
- 2026-11-05 (owner) - **Start empty.** No migration from the old database. A person may carry a map across by hand: old tool **Export** (plain outline) -> new tool **Import**. Import therefore accepts the old outline exactly, including the old special-note lines (`Flow: 12 l/s`, `Place: 120, 80`, `Icon: pump`, `Source: chiller` ...), which it turns into typed properties.
- 2026-11-05 (owner) - **Improve while moving** (the admin project's proposal, accepted in full):
  - **Typed properties, not special-note text.** Each branch has a type (pump, chiller, cooling tower, AHU, FCU, valve, header, tank, board, transformer, generator, breaker, BMS ...; `general` for knowledge branches) and a form with its fields and units. Values are stored in SI in `jsonb`, checked by the database (known keys per type, numbers in range); the 2D place `{x, y, w, h}` is its own field. Special notes become notes for people only. The engines read the typed values (change their input reading, not their maths).
  - **Pipes, wires and links as their own rows**, not JSON inside a branch: one table of lines (from branch, to branch, kind: link / pipe / wire / control, relation, circuit, and its own properties - pipe size, length, terminals, cable, signal, installed or wired by). Deleting a branch deletes its lines; "linked from" works from both ends; schedules read the rows. A line to a branch of another map is shown only to someone who may open both maps.
  - **History and trash.** Every change to a map or branch is kept (who, when, before, after). Deleted branches and maps go to a trash for 30 days (restore by owner, tile admin, super user), purged on use, no scheduled job. Verify gains meaning: a verified branch changed later shows "changed since verified" with the difference.
  - **Edit clash guard.** Every save carries the version the page read; a newer one refuses with the name of who changed it ("changed by X a moment ago - reload").
  - **Split `maps.js`** into files by job (data, list, map view, outline, editor and forms, Flow, 2D, schedules, import / export). No build step: plain scripts with `defer`.
  - **Knowledge maps:** a review list for verifiers (every "to verify" branch across maps: verify, or send back with a comment); "linked from" on a branch; links to another tile by its id (a note, a page; opened at `/<tile-id>/...`, never stored as a URL) and web links (`https://` only, opened with `rel="noopener noreferrer"`); starter templates for product breakdowns; at phone width Outline opens by default and the Map view is read-only pan and zoom; print of a branch or a whole map (print stylesheet, A4 outline).
  - **Piping maps:** pipe sizing check (velocity and friction outside limits flagged, the next pipe size suggested; defaults 0.6 to 3 m/s and 100 to 400 Pa/m, changeable by a tile admin); index circuit (the path with the highest pressure drop) and pump head available against required; saved scenarios (pumps standby, valves closed ... kept by name with the map, instead of browser-only); SI or IP display per user (storage stays SI); 2D view to SVG and print at A3.
  - **Wiring maps:** BMS points schedule to Excel from the control lines (AI / AO / DI / DO, signal, terminals); breaker rating against load current on each board and feeder; voltage drop % from cable size, length, load and power factor (copper, standard resistance and reactance, limit changeable by a tile admin); cable current-carrying capacity only as **"indicative"** and only once the owner provides the cable table to use - until then it is not shown; single-line diagram to SVG and print at A3.
- 2026-11-05 - **Calculations stay in the browser**, as today (water, current, layouts, Arrange by feed, checks). The database checks rights and input and saves. **Templates** (Electricity, Chilled water, AHU / FCU EC and DC, chiller unit wiring, knowledge starters) are JSON files in the repo, generated once from the old seed code, and created through the same function as Import; everything a template adds is "to verify".
- 2026-11-05 - **Rights** (declare in `docs/TILE.md`; the owner enters them in Admin > Tiles): `edit` - add maps, edit own maps and team-edit maps, import; `verify` - verify branches, the review list. A user with the tile and no right reads team maps and his own. Sharing per map stays: only me / team can read / team can edit (team = everyone with the tile). The owner of a map, a tile admin and the super user change a shared map's settings and delete it; a private map is its owner's only. Tile admins and the super user hold every right by the core rule.
- 2026-11-05 - Excel through the old tool's own `xlsx-lite.js` (no library, no exception needed). Search across maps in the database (titles and notes; simple, no extension unless the owner agrees).
- 2026-11-05 (owner) - Tile colour **rose**, icon **`map`** (added to the core for this tile), order after Projects. The tile stays **off** until step 1 is checked.
- Markup: build it with `Core.el` / `textContent`; where old code used `innerHTML` for symbols, only fixed SVG strings from the code itself, never data. No inline scripts, no `style=""` attributes (positions in SVG attributes or CSS custom properties set from code), colours only through theme tokens and the tile accent, day and night.

## Scope, in this order; one step delivered and checked by the owner before the next starts
1. **Foundation and knowledge maps** - schema `maps` (maps, branches with type / properties / place, lines, history, trash, versions), `docs/TILE.md` with the rights; list, search across maps, add map (blank or knowledge starter), Map and Outline views, read / edit, branch editor (title, notes, special notes, links), move and delete with trash, share, verify and "changed since verified", history, clash guard, Import (including the old outline) and Export, phone layout. Files split by job.
2. **Knowledge extras** - review list, "linked from", links to tiles, more starter templates, print.
3. **Piping** - types and forms, pipes, Chilled water template, water engine, Flow view, 2D view with drag to place, Arrange by feed, pipe schedule, sizing check, index circuit and pump head, saved scenarios, SI / IP, 2D export and print.
4. **Wiring** - types and forms, wires, Electricity template and unit wiring, power engine (BMS, fire alarm, demand, shedding), single-line 2D, cable schedule, BMS points schedule, breaker and voltage-drop checks, export and print; indicative ampacity once the owner gives the cable table.

## Delivery
Push (or zip) + the SQL files in order (`db/maps/NNN_*.sql`, each ending with `select core.applied('maps', 'NNN_name');`, plus `db/maps/tests.sql` with allowed and refused calls for every function: signed out, pending, disabled, no tile, no right, private map of another user, stale version) + the security-check step + update `docs/STATUS.md`. The engines' checks run as plain `node` scripts in `dev/`. Say what the owner should try, on a laptop and a phone, day and night.

## How to work with the owner and the team
Short, plain wording. Show a result rather than a list of questions; ask only when a wrong guess is costly (data, permissions, security). Logic beats literal wording. Check engineering and logic, even in material supplied by the team: units, ranges and formulas in the engines are checked, not assumed.

Chats that start with **DAME-MAPS** continue from `docs/STATUS.md`.
