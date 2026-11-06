# DAME tile contract

Kept in the admin repo as `docs/TILE-CONTRACT.md`. What a tile may use from the core, what it must provide, and what it must never do. Read with `docs/SECURITY.md` and `docs/STANDARDS.md`.

## 1. One id everywhere
Tile id: lower case with dashes, e.g. `hvac-notes`.

| Where | Form | Example |
|---|---|---|
| GitHub repo | `<account>/<tile-id>` (today `niyaz8951`) | `niyaz8951/hvac-notes` |
| Address | `/<tile-id>/` (a tile kept inside the admin repo: `/dame-hub/<tile-id>/`, `docs/STANDARDS.md` section 2) | `https://niyaz8951.github.io/hvac-notes/` |
| Database schema | `<tile_id>` | `hvac_notes` |
| Function prefix | `public.<tile_id>_` | `public.hvac_notes_ask` |
| Storage bucket | `<tile-id>` (private) | `hvac-notes` |
| Guard | `{ tile: '<tile-id>' }` | `Core.requireLogin({ tile: 'hvac-notes' })` |
| Container kinds | `[a-z][a-z0-9_]`, declared with `core.tile_declare` | `notebook`, `map`, `project` |
| Accent | one of `Core.ACCENTS`, set in the admin page | `green` -> `<html data-accent="green">` |
| SQL files | `db/<tile_id>/NNN_*.sql` | `db/hvac_notes/001_init.sql` |

## 2. What the core gives every tile
The tile id must not be the name of any other repo in the account.

**Paths:** load the core with root-relative paths (`/dame-hub/core/v1/core.js`), link inside the tile with `/<tile-id>/...` or relative paths, link to the dashboard with `/dame-hub/dashboard.html`. Never write the account name or a full `https://` address of the site in code or data, so the tile keeps working after a move to another account.

**In the browser** (`/dame-hub/core/v1/`):
- `Core.requireLogin({ tile, level })` (or `{ tile, right }`) - stops the page unless the user is signed in, active, has the tile (and the level or right). Returns a promise; `Core.user` = `{ username, display_name, is_super, tile_admin, level, levels, rights }` for this tile, for showing and hiding only. `Core.atLeast('approve')` answers for the current tile; `Core.LEVELS`, `Core.LEVEL_NAMES`, `Core.levelMeaning(level)`.
- `Core.share({ kind, id })` - the **Access panel** of one container (section 5): who can open it, people and groups with Can view / Can edit, the owner, Change owner for managers. Resolves `true` when something changed. Loaded on first use; no extra script line.
- Topbar: site name, tile name, back to the dashboard, theme switch, account menu.
- `Api.rpc('hvac_notes_list', { ... })` - calls a function with the session; returns data or throws `{ code, message }`.
- `Api.file.upload(bucket, path, blob)`, `Api.file.url(bucket, path)`, `Api.file.download(bucket, path)`, `Api.file.remove(bucket, path)` - Storage through the session; the bucket's policies decide.
- `Core.el(tag, attrs, ...children)`, `Core.sheet(...)`, `Core.toast(text)`, `Core.date(value)`, `Core.download(name, blob)`, `Core.setTitle(text)`, `Core.errorMessage(err)`.
- Theme tokens in `theme.css`; the CSP line in `core/v1/README.md`.
- **Accent** (2026-11-04): the tile's hue, set by the super user in the admin page, arrives with `core_me` (`Core.tile.accent`) and the core puts `data-accent` on `<html>` before the page shows. `--accent`, `--accent-2`, `--accent-strong`, `--accent-soft`, `--on-accent`, `--accent-grad`, `--accent-glow`, `--accent-ring` follow it in day and night; so do `.btn.primary`, `.tabs`, `.chip`, `.badge.accent`, `.notice.accent`, `.icon`, `.progress`, `.cover` and input focus. For a different hue on one element (a section, a cover), put `data-accent="<name>"` on that element (`Core.ACCENTS` lists the names; `Core.setAccent(name, node)`). Nothing else: the tile never defines a colour.

**In the database** (call these, never copy them):
- `core.require_user()` -> the caller's profile, or raises `SIGNED_OUT` / `NOT_APPROVED`
- `core.require_tile('<tile-id>', <right, level or null>)` -> the caller's profile, or raises `SIGNED_OUT` / `NOT_APPROVED` / `NO_ACCESS` / `NO_RIGHT`
- `core.require_level('<tile-id>', '<level>')` -> the same, by level name (`read`, `contribute`, `edit`, `approve`, `manage`)
- `core.has_tile(user_id, '<tile-id>', <right, level or null>)` -> boolean, for Storage policies
- `core.is_tile_admin(user_id, '<tile-id>')` -> level manage (own or through a group; super users always)
- `core.tile_level(user_id, '<tile-id>')` -> the user's level in the tile, or null
- Containers (section 5): `core.container_put(tile, kind, id, name, everyone default 'edit', owner default the caller)`, `core.container_drop(tile, kind, id)`, `core.require_container(tile, kind, id, level default 'read')` -> profile or `NOT_FOUND` / `NO_RIGHT`, `core.container_level(user_id, tile, kind, id)` (also for Storage policies), `core.container_ids(tile, kind, level default 'read')` -> the ids the caller may open, `core.container_info(tile, kind, id)` -> `{ level, mine, owner_id, owner_name, everyone, shared }` or null
- `core.tile_declare('<tile-id>', spec)` - only in the tile's own SQL file, for its own id (section 5)
- Moving existing sharing into the core, only in the tile's own SQL file: `core.container_put(..., p_owner)` for each record, `core.share_put(tile, kind, id, user_id, group_id, 'read' | 'edit')`, `core.shares_from_right(tile, right, kind, id, level)` (everyone holding a special right gets a share of that container)
- `core.username_of(user_id)` -> username of an active user, for Storage paths `<username>/...`
- **Accounts can be renamed and deleted** by the super user (2026-11-05). Key everything by user id (`v_user.id`), never by username; a username or display name saved next to a record is a label of that moment (show the current one through `core.display_names`, the saved one as fallback). A deleted user's id simply matches nobody: show the saved name. Never tie a tile table to `core.profiles` or `auth.users` with a foreign key that blocks a delete (no `references`, or `on delete cascade` / `set null` when the rows should go with the account). A retired username is never given to anyone else, so `<username>/...` Storage folders stay safe, but a renamed user's files stay under the old folder name: new tiles use `<user_id>/...` (`auth.uid()::text`).
- **Tests:** a test that acts as a user inserts the Supabase session first, as sign-in does: `insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, v_id, now(), now());` before `core_session_start()` (since 008, a session Supabase does not have is refused). See `demo/db/demo/tests.sql`, `pg_temp.act_as`.
- `core.display_names('<tile-id>', ids uuid[])` -> `(id, username, display_name, active)` for the authors of shared records; pending accounts and unknown ids are left out, disabled users come back with `active = false`. Raises like `core.require_tile`. Callable only inside the tile's own functions, never from the page; return only the names the page needs.
- `core.tile_users('<tile-id>')` -> `(id, username, display_name)` of the active users who can open the tile (directly, through a group, or super users), by username: for "assign to" lists (sharing itself is `Core.share`). Same rules as `core.display_names`.
- `core.audit('<tile-id>', action, detail jsonb)`
- `core.applied('<repo>', 'NNN_name')` - last line of every SQL file

**Versions:** all of the above live under `/dame-hub/core/v1/` and keep working. A change that could break a tile goes to `/dame-hub/core/v2/`; tiles move up when ready. Every change is listed in the admin repo's `docs/TILE-CHANGES.md`, newest first.

## 3. A tile function, the pattern

```sql
create or replace function public.hvac_notes_list(p_section text)
returns table (id uuid, title text, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  return query
    select n.id, n.title, n.updated_at
    from hvac_notes.notes n
    where n.section = p_section
      and n.notebook in (select core.container_ids('hvac-notes', 'notebook'));
end $$;
revoke execute on function public.hvac_notes_list(text) from public, anon;
grant execute on function public.hvac_notes_list(text) to authenticated;
```

Tables: `create table hvac_notes.<name> (...)`, then `alter table ... enable row level security;` with no policies.

## 4. What every tile repo contains

```
<tile-id>/
  .nojekyll
  index.html              the tile's home page (the dashboard tile opens it)
  *.html                  other pages
  assets/                 the tile's own css, js, images (prefixed, e.g. hn-*.css)
  vendor/                 copied libraries with licences (only if needed)
  db/<tile_id>/NNN_*.sql  schema, tables, functions, bucket and its policies; tests.sql
  db/migrations.json      every NNN_*.sql in run order ("SQL list" below); Admin > Health reads it
  CLAUDE.md               short brief for Claude / any agent: ids, checks, pointers to the rule book
  docs/TILE.md            what the tile does, who can do what (section 5), its data, its decisions
  docs/STATUS.md          what is built, what is next, SQL applied where
  docs/CORE-REQUESTS.md   what the tile needs from the core (open / done)
  README.md               one paragraph + link to docs/TILE.md
```

**SQL list.** `db/migrations.json` names every numbered SQL file of the repo in the order it runs:

```json
{ "repo": "<tile-id>", "files": [
  { "name": "001_init", "path": "db/<tile_id>/001_init.sql" },
  { "name": "002_replies", "path": "db/<tile_id>/002_replies.sql" }
] }
```

`repo` is the first argument of the files' `core.applied` line; `"superseded": true` marks a file a later one replaced (not counted as waiting). A tile without SQL publishes `"files": []`. The file is public like every page and holds file names only. Check before every push: `node ../dame-hub/dev/migrations-check.mjs .` (needs `dame-hub` cloned next to the tile).

## 5. Access (one model for every tile, core 011, owner 2026-11-06)
One user base and one access base, held by the core; inspired by SharePoint, kept small. Three layers:

**a. Level in the tile.** Every person (or group) given the tile has one of five levels; each includes the ones before it. A person's level is the highest of his own and his groups'. Super users have Manage everywhere.

| Level | Means in every tile |
|---|---|
| `read` | open and read what is shared with him |
| `contribute` | create his own items, comment, reply |
| `edit` | change others' work where it is shared with him to edit |
| `approve` | approve, verify, send back, remove others' content |
| `manage` | the tile's people and access, every item, settings, handover (only the super user gives it) |

Groups are site-wide (Admin > Groups); managers give levels to people and groups on the access page; only the super user names managers.

**b. Containers.** A container is what a tile shares as a whole: a project, a map, a notebook. The tile registers it when it is made (`core.container_put`) and checks it first in every function that touches it (`core.require_container`). Its owner (with at least contribute) and the tile's managers choose, in the Access panel (`Core.share`):
- **Everyone in the tile** - can edit (default) or can view;
- **Only the people and groups listed** - each with *Can view* (read) or *Can edit* (works at his own tile level).

The tile level is always the ceiling: sharing never gives more than a person's tile level, so taking someone's tile access away takes everything in it. **Managers open every container**, private ones too (owner, 2026-11-06: technical data only). Items inside a container (pages, branches, records) follow their container and never get access of their own. A container a person may not open answers `NOT_FOUND`, never a hint that it exists. Handover (Admin > Users > Manage) moves every container of a person to another; an account that still owns containers cannot be deleted.

**c. The tile's declaration.** Each tile describes itself once, in its own SQL file, for its own id:

```sql
select core.tile_declare('maps', '{
  "levels":  { "read": "Read team maps", "contribute": "Add maps, edit his own and team-edit maps", "approve": "Verify branches", "manage": "Every map" },
  "aliases": { "edit": "contribute", "verify": "approve" },
  "rights":  { },
  "kinds":   { "map": "Map" },
  "default": "contribute"
}');
```

- `levels` - what each level means here (shown on the access page; levels a tile does not use may be left out).
- `aliases` - the tile's own words for a level, so existing `core.require_tile('<tile>', 'verify')` calls keep working. New code checks levels: `core.require_level`, `core.require_container`.
- `rights` - **special rights**, given one by one on the access page. Keep them rare: anything about *which* things someone sees is a container, not a right; anything about *what* someone may do is a level.
- `kinds` - container kinds and their label in the Access panel.
- `default` - the level given when a manager switches access on (never manage).

Running `core.tile_declare` again replaces the declaration; special rights no longer declared leave every person and group. Once declared, the admin page no longer edits the tile's rights. `docs/TILE.md` says the same in words, under **Who can do what**: the levels, aliases and special rights, the container kinds, and for each function its level.

Rules:
- Check levels in the database (`core.require_level`, `core.require_container`, `core.container_ids` for lists); the page only shows and hides (`Core.atLeast`, `Core.user.level`, the `level` a list function returns).
- Use `core.is_tile_admin` only for what is truly the manager's: settings of the tile, every item, handover. Approving is `approve`, not manage.
- Never keep a list of who may see what in the tile's own tables. Sharing lives in the core so Check access, Handover, groups and the Access panel work the same in every tile.

## 6. A tile must never
- Put internal data, a key, a password or a real file in the repo (it is public, history included). Example data for staging is invented.
- Create a table, view or sequence in `public`, or a function without its prefix.
- Grant anything to `anon` or `public`, make a bucket public, or write a policy for `anon`.
- Edit the admin repo, `core/v1`, the `core` schema, or another tile's schema, functions, bucket or repo; read another tile's tables.
- Keep its own users, passwords, sessions, groups or lists of who may open what (section 5).
- Write the GitHub account name or a full site URL in code or data.
- Use a CDN, external font, framework, tracker or iframe (only exception: the YouTube player for tiles the owner allowed, on the conditions in `docs/SECURITY.md` section 4); use `innerHTML` with data; inline scripts; hard-coded colours (a hue is chosen only through `data-accent` and the `--accent-*` tokens).
- Trust the page for any permission.

## 7. Asking the core for something
In the tile's `docs/CORE-REQUESTS.md`:

```
## Open
- 2026-11-10 - Need core.display_names(ids uuid[]) to show who asked a question. Why: questions list. Blocking: no (shows usernames meanwhile).
## Done
```

The admin project reads every tile's file at the start of each chat and answers there.

## 8. Done means
- [ ] `docs/SECURITY.md` section 8 checklist passed
- [ ] Guard on every page and the check in every function use the same tile id and level (or right); every container registered on creation and checked with `core.require_container`
- [ ] Day + night, 390 px, loading / empty / error states
- [ ] `tests.sql`: allowed + refused cases for every new function, run on staging
- [ ] SQL files numbered, ending with `core.applied`, never edited after live, listed in `db/migrations.json` (`node ../dame-hub/dev/migrations-check.mjs .` OK)
- [ ] `docs/STATUS.md` updated; **Who can do what** in `docs/TILE.md` matches the tile's `core.tile_declare`
