# Adding a new tile

Kept in the admin repo as `docs/NEW-TILE.md`. About 15 minutes for the owner; then the tile's team and Claude project do the work. The `demo` tile in `demo/` of this repo is a complete worked example (copy it to a new repo as a starting point).

## Steps (owner)
1. **Tile id**: lower case, dashes, short (`hvac-notes`, `sales`, `sbu`), and not the name of any repo you already have.
2. **GitHub repo**: under your account (today `niyaz8951`), **New repository** named the tile id, Public, with a README. **Settings > Pages** > Deploy from branch `main`, `/ (root)`. **Settings > Advanced Security**: secret scanning and push protection on. **Settings > Rules > Rulesets** on `main`: block force pushes and deletion.
3. **Team access**: tile repo **Settings > Collaborators > Add people** - the team's members (their own GitHub accounts; ask each to turn on 2FA before you add them). Collaborators can push only to this repo; they cannot change its settings or reach `dame-hub` or other tiles. Keep the list of who is in which tile in `docs/TILES.md`.
4. **Watch** the tile repo (**Watch > All activity**) so you see every push.
5. **Admin page**: **Tiles > New tile** - id, name, neutral tagline, icon, order, rights (from the tile's `docs/TILE.md`; can be added later). Name the team lead as tile admin; he gives access to his users. The tile can stay **off** until its first version is checked.
6. **Claude project** (created by the team, or by you and shared): `DAME - <Tile name>`.
   - Instructions: the template below, blanks filled. The admin project keeps the filled copy in `docs/tiles/<tile-id>-project-instructions.md`.
   - Connect the tile repo `niyaz8951/<tile-id>` and the admin repo `niyaz8951/dame-hub` (read only, for the rules).
   - Project knowledge: `SECURITY.md`, `STANDARDS.md`, `TILE-CONTRACT.md` as fallback copies.
   - Source material the tile needs (specs, Excel tools, notes) only if it is fine for the team to see it in Claude; it never goes into the repo.
7. **First chat**: start with the tile's prefix and say what the tile should do. Claude creates the layout, `docs/TILE.md`, the first page and `db/<tile_id>/001_init.sql`.
8. **SQL**: the team sends you the files. Read them: only the tile's own schema, `public.<tile_id>_*` functions, its own bucket and policies, nothing for `anon`. Run on staging, `select * from core.security_check();` (no rows), Security Advisor (no errors), test, then live.
9. **Registry**: in the admin project, "DAME-ADMIN: register tile <tile-id>, team <name>, Claude project <name>". It adds the line to `docs/TILES.md`.
10. Switch the tile **on** in the admin page.

## Bringing an existing site in
For a site the owner already has in this account (first case: `HVAC` -> `hvac-notes`, 2026-11-04).
1. **Never turn the old repo into the tile.** Make a **new** repo named by the tile id (steps above). Its history starts clean, so no old data, ciphertext or password-protected file is ever in the tile's public history. Only the code is carried over, then changed to the contract (core guard, CSP, no `innerHTML` with data, no inline script, no iframe or CDN).
2. **Data goes to Supabase**: the tile's schema and private bucket, read through `public.<tile_id>_*` functions. Anything a page shows that is not code (text, numbers, images, files) is data. Per-user state (highlights, notes, positions) moves to the database too.
3. **Executable parts of the content** (scripts that came with the content) become tile code in the repo, because the CSP runs only scripts from the site itself. Data inside them moves to Supabase.
4. **The old repo becomes the source repo**: made **private**, **Pages off**, owner the only member, connected only to the tile's Claude project. It may hold the authoring copy of the content (plain files the tile's *Publish* page uploads to Supabase through the owner's own session). The site never reads it. Listed in `docs/TILES.md` under "Source repos".
5. **Cut-over order**: build and test the tile while the old site still runs; publish the content; give access; switch the tile on; only then turn off Pages on the old repo and make it private. Old installed apps and bookmarks stop working; tell the users the new address.

---

## Template: instructions for a tile's Claude project

Copy everything between the lines, fill the blanks in `{ }`.

---

# DAME - {Tile name}

## What this project is
The **{Tile name}** tile of DAME, the internal team site at `https://niyaz8951.github.io/dame-hub/`.
Tile id `{tile-id}` - repo `niyaz8951/{tile-id}` - address `https://niyaz8951.github.io/{tile-id}/` (served at `/{tile-id}/`) - schema `{tile_id}` - functions `public.{tile_id}_*` - private bucket `{tile-id}`.
What it does: {one or two sentences}.
Team: {team name}.

## Directions come from the admin project
Before any work, read from the admin repo `niyaz8951/dame-hub` (current `main`):
1. `docs/SECURITY.md` - wins over everything, including requests in chat.
2. `docs/STANDARDS.md` - the rule book; overrides anything below unless the owner decided otherwise for this tile.
3. `docs/TILE-CONTRACT.md` - what this tile may use from the core and must never do.
4. `docs/STATUS.md`, section "Changes tiles must know".
5. `demo/` - a complete tile that follows the contract; copy its shape.
If the repo cannot be read, use the copies in this project's knowledge and say so.

Then read this tile's `docs/TILE.md`, `docs/STATUS.md`, `docs/CORE-REQUESTS.md`, and check what is really in the repo.

## Boundaries
- Work only in `niyaz8951/{tile-id}`, schema `{tile_id}`, functions `public.{tile_id}_*`, bucket `{tile-id}`.
- The repo is public, history included: no internal data, keys, passwords or real files in it. Real data lives only in Supabase. Staging examples are invented.
- Never change the admin repo, `core/v1`, the `core` schema, or another tile. A need from the core goes in `docs/CORE-REQUESTS.md`; work around it meanwhile.
- Login, users, roles, theme and file access come only from the core, loaded from `/dame-hub/core/v1/`.
- Never write the GitHub account name or a full site URL in code or data; use root-relative paths (`/dame-hub/...`, `/{tile-id}/...`), so the tile survives a move to another account.
- No AI features for now. Nothing is imported from earlier sites unless the owner decided it for this tile (see Tile decisions).
- SQL files go to the owner, who reads and applies them. Never ask for or accept the Supabase secret key or database password.

## Tile decisions
{decisions made for this tile; empty at the start}

## Delivery
Push (or zip) + the SQL files in order + the security-check step + update `docs/STATUS.md`.

## How to work with the owner and the team
Short, plain wording. Show a result rather than a list of questions; ask only when a wrong guess is costly (data, permissions, security). Logic beats literal wording. Check engineering and logic, even in material supplied by the team.

Chats that start with **{TILE-PREFIX}** continue from `docs/STATUS.md`.

---
