# DAME - Projects

## What this project is
The **Projects** tile of DAME, the internal team site at `https://niyaz8951.github.io/dame-hub/`.
Tile id `projects` - repo `niyaz8951/projects` - address `https://niyaz8951.github.io/projects/` (served at `/projects/`) - schema `projects` - functions `public.projects_*` - private bucket `projects`.
What it does: a register of the team's projects. Each project is opened from a list and holds, in time, its rule book and knowledge maps, a compliance review and product options. Everything a page shows is data and lives in Supabase.
Team: owner (Niyaz) for now. Tile admin: owner.

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
- Work only in `niyaz8951/projects`, schema `projects`, functions `public.projects_*`, bucket `projects`.
- The repo is public, history included: no internal data, keys, passwords or real files in it. Real data lives only in Supabase. Staging examples are invented: no real project name, customer, site, price or factor, even as a sample.
- Never change the admin repo, `core/v1`, the `core` schema, or another tile. A need from the core goes in `docs/CORE-REQUESTS.md`; work around it meanwhile.
- Login, users, roles, theme and file access come only from the core, loaded from `/dame-hub/core/v1/`.
- Never write the GitHub account name or a full site URL in code or data; use root-relative paths (`/dame-hub/...`, `/projects/...`), so the tile survives a move to another account.
- No AI features for now. Nothing is imported from earlier sites unless the owner decided it for this tile (see Tile decisions).
- SQL files go to the owner, who reads and applies them. Never ask for or accept the Supabase secret key or database password.

## Tile decisions
- 2026-11-04 - **Reference, not source.** The old tool `niyaz8951/Thinkneering`, folder `tools/projects`, is read **only to learn its features** (what a user could do, which fields and outputs mattered). Copy **no** code, data, library or layout from it. Rebuild everything to the DAME rules: core guard and topbar, theme tokens and the tile accent, `Core.el` / `textContent`, no inline scripts, no CDN or external map or font, functions behind `core.require_tile('projects', ...)`.
- 2026-11-04 - **Scope, in this order; one step delivered and checked by the owner before the next starts:**
  1. **Project register** - list, create, open a project.
  2. **Maps** - the project's **rule book and knowledge maps** (structured maps of the rules, clauses and knowledge that govern a project, as the old tool had them), **not** geographic maps. Drawn with the tile's own code (SVG / HTML built with `Core.el`); the nodes and links are data in schema `projects`.
  3. **Compliance review** inside a project.
  4. **Product options** inside a project.
- 2026-11-04 - **Data only in schema `projects` and bucket `projects`** of the one DAME database, never a separate Supabase project: one sign-in, rights, audit and `core.security_check()` only work inside one project, and the schema and bucket already isolate it. If the tile outgrows the Free limits, the path is Pro on the DAME project, not a second project.
- 2026-11-05 - **Specification PDFs are not stored.** Only the clause text the user extracts or types is kept, as records in schema `projects` (clause reference, title, text, source document name and page as plain fields). The PDF itself stays on the user's device; reading it to pick clauses happens in the browser and nothing of the file is uploaded. Bucket `projects` stays reserved for later needs and is created only when a step needs it.
- 2026-11-04 - Rights: declare them in `docs/TILE.md` as each step needs them (step 1 will need at least `edit` for create); the owner enters the same list in Admin > Tiles. Tile colour to be chosen by the owner later (blue until then). The tile stays **off** until step 1 is checked.

## Delivery
Push (or zip) + the SQL files in order (`db/projects/NNN_*.sql`, each ending with `select core.applied('projects', 'NNN_name');`, plus `db/projects/tests.sql`) + the security-check step + update `docs/STATUS.md`. Say in the delivery what the owner should try on a laptop and a phone, day and night.

## How to work with the owner and the team
Short, plain wording. Show a result rather than a list of questions; ask only when a wrong guess is costly (data, permissions, security). Logic beats literal wording. Check engineering and logic, even in material supplied by the team.

Chats that start with **DAME-PROJECTS** continue from `docs/STATUS.md`.
