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
| Accent | one of `Core.ACCENTS`, set in the admin page | `green` -> `<html data-accent="green">` |
| SQL files | `db/<tile_id>/NNN_*.sql` | `db/hvac_notes/001_init.sql` |

## 2. What the core gives every tile
The tile id must not be the name of any other repo in the account.

**Paths:** load the core with root-relative paths (`/dame-hub/core/v1/core.js`), link inside the tile with `/<tile-id>/...` or relative paths, link to the dashboard with `/dame-hub/dashboard.html`. Never write the account name or a full `https://` address of the site in code or data, so the tile keeps working after a move to another account.

**In the browser** (`/dame-hub/core/v1/`):
- `Core.requireLogin({ tile, right })` - stops the page unless the user is signed in, active, has the tile (and the right). Returns a promise; `Core.user` = `{ username, display_name, is_super, tile_admin, rights }` for this tile, for showing and hiding only.
- Topbar: site name, tile name, back to the dashboard, theme switch, account menu.
- `Api.rpc('hvac_notes_list', { ... })` - calls a function with the session; returns data or throws `{ code, message }`.
- `Api.file.upload(bucket, path, blob)`, `Api.file.url(bucket, path)`, `Api.file.download(bucket, path)`, `Api.file.remove(bucket, path)` - Storage through the session; the bucket's policies decide.
- `Core.el(tag, attrs, ...children)`, `Core.sheet(...)`, `Core.toast(text)`, `Core.date(value)`, `Core.download(name, blob)`, `Core.setTitle(text)`, `Core.errorMessage(err)`.
- Theme tokens in `theme.css`; the CSP line in `core/v1/README.md`.
- **Accent** (2026-11-04): the tile's hue, set by the super user in the admin page, arrives with `core_me` (`Core.tile.accent`) and the core puts `data-accent` on `<html>` before the page shows. `--accent`, `--accent-2`, `--accent-strong`, `--accent-soft`, `--on-accent`, `--accent-grad`, `--accent-glow`, `--accent-ring` follow it in day and night; so do `.btn.primary`, `.tabs`, `.chip`, `.badge.accent`, `.notice.accent`, `.icon`, `.progress`, `.cover` and input focus. For a different hue on one element (a section, a cover), put `data-accent="<name>"` on that element (`Core.ACCENTS` lists the names; `Core.setAccent(name, node)`). Nothing else: the tile never defines a colour.

**In the database** (call these, never copy them):
- `core.require_user()` -> the caller's profile, or raises `SIGNED_OUT` / `NOT_APPROVED`
- `core.require_tile('<tile-id>', <right or null>)` -> the caller's profile, or raises `SIGNED_OUT` / `NOT_APPROVED` / `NO_ACCESS` / `NO_RIGHT`
- `core.has_tile(user_id, '<tile-id>', <right or null>)` -> boolean, for Storage policies
- `core.is_tile_admin(user_id, '<tile-id>')`
- `core.username_of(user_id)` -> username of an active user, for Storage paths `<username>/...`
- `core.display_names('<tile-id>', ids uuid[])` -> `(id, username, display_name, active)` for the authors of shared records; pending accounts and unknown ids are left out, disabled users come back with `active = false`. Raises like `core.require_tile`. Callable only inside the tile's own functions, never from the page; return only the names the page needs.
- `core.audit('<tile-id>', action, detail jsonb)`
- `core.applied('<repo>', 'NNN_name')` - last line of every SQL file

**Versions:** all of the above live under `/dame-hub/core/v1/` and keep working. A change that could break a tile goes to `/dame-hub/core/v2/`; tiles move up when ready. Every change is listed in the admin repo's `docs/STATUS.md` under "Changes tiles must know".

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
    where n.section = p_section;
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
  docs/TILE.md            what the tile does, its rights, its data, its decisions
  docs/STATUS.md          what is built, what is next, SQL applied where
  docs/CORE-REQUESTS.md   what the tile needs from the core (open / done)
  README.md               one paragraph + link to docs/TILE.md
```

## 5. Rights
A tile declares its rights in `docs/TILE.md` (e.g. `edit`, `reply`, `export`) with one line each. The super user enters the same list on the tile in the admin page; tile admins give them to users. Functions check them with `core.require_tile('<tile-id>', 'edit')`, Storage policies with `core.has_tile(auth.uid(), '<tile-id>', 'edit')`.

## 6. A tile must never
- Put internal data, a key, a password or a real file in the repo (it is public, history included). Example data for staging is invented.
- Create a table, view or sequence in `public`, or a function without its prefix.
- Grant anything to `anon` or `public`, make a bucket public, or write a policy for `anon`.
- Edit the admin repo, `core/v1`, the `core` schema, or another tile's schema, functions, bucket or repo; read another tile's tables.
- Keep its own users, passwords or sessions.
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
- [ ] Guard on every page and the check in every function use the same tile id and right
- [ ] Day + night, 390 px, loading / empty / error states
- [ ] `tests.sql`: allowed + refused cases for every new function, run on staging
- [ ] SQL files numbered, ending with `core.applied`, never edited after live
- [ ] `docs/STATUS.md` updated; rights in `docs/TILE.md` match the admin page
