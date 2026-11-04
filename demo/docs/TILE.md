# Demo tile

Tile id `demo` - path `/demo/` - schema `demo` - functions `public.demo_*` - private bucket `demo`.

## What it does
Shows what the core gives a page (`Core.user`), a list of notes anyone with the tile can read, an add/delete form for users with the right `edit`, two buttons that call functions the database refuses, and a private file area under `<username>/`.

## Rights
- `edit` - add and delete your own notes; upload and delete your own files.

## Data
- `demo.notes` (id, user_id, username, title, body, created_at) - RLS on, no policies.
- Bucket `demo`: path `<username>/<file>`; read for anyone with the tile, write/delete with `edit` in your own folder only.

## Functions
- `demo_list()` - notes, newest first, with `mine`.
- `demo_add(p_title, p_body)` - right `edit`.
- `demo_delete(p_id)` - right `edit`, own note only (`NOT_FOUND` otherwise).
- `demo_manage()` - needs the right `manage`, which the tile does not declare: always `NO_RIGHT` except for the super user.

## Decisions
- Lives in `dame-hub/demo/` so it moves with the core. Local: `node tools/serve.mjs` serves it at `/demo/`. Live: once the repo `demo` exists in the account.
