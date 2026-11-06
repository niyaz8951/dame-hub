# Demo tile

Tile id `demo` - path `/dame-hub/demo/` (inside the admin repo) - schema `demo` - functions `public.demo_*` - private bucket `demo`.

## What it does
Shows what the core gives a page (`Core.user`), a list of notes, each one a container its author shares from the Access panel (`Core.share`), an add/delete form for level contribute, two buttons that call functions the database refuses, and a private file area under `<username>/`.

## Who can do what (002, core 011)
Container kind: `note` ("Note") - one note; new ones start as everyone in Demo can view.
| Level | In this tile |
|---|---|
| read | read the notes shared with him |
| contribute | add notes and files, share and delete his own notes |
| manage | every note, people and access of the tile (core rule) |
Aliases: `edit` = contribute (used by the bucket policies since 001). Special rights: none.
Functions: `demo_list` - the tile, notes from `core.container_ids`; `demo_add` - contribute; `demo_delete` - contribute on the note (`core.require_container`), own note only; `demo_manage` - manage.

## Data
- `demo.notes` (id, user_id, username, title, body, created_at) - RLS on, no policies. Who may open each note: `core.containers` / `core.shares` (kind `note`, id = the note id).
- Bucket `demo`: path `<username>/<file>`; read for anyone with the tile, write/delete with `edit` in your own folder only.

## Functions
- `demo_list()` - the notes the caller may open, newest first, with `mine` and `access` (`core.container_info`: level, owner, who can open it).
- `demo_add(p_title, p_body)` - level contribute; registers the note as a container (everyone can view).
- `demo_delete(p_id)` - contribute on that note, own note only (`NOT_FOUND` otherwise); drops the container.
- `demo_manage()` - level manage: the tile's managers and the super user; `NO_RIGHT` for everyone else.

## Decisions
- Lives in `dame-hub/demo/` so it moves with the core, served at `/dame-hub/demo/` live and locally (`INSIDE_CORE` in `core/v1/config.js`, since 2026-11-04). No `demo` repo is needed.
