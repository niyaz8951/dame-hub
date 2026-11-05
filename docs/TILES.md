# Tile registry

One line per tile. The admin project keeps this file; the admin page keeps the live list.

| Tile id | Name | Repo | Team | Tile admin | Claude project | Exceptions | Status |
|---|---|---|---|---|---|---|---|
| `demo` | Demo | `dame-hub/demo/` (inside the admin repo, served at `/dame-hub/demo/`) | admin | owner | DAME Admin | - | built, SQL not yet applied |
| `tools` | Tools | `dame-hub/tools/` (inside the admin repo, served at `/dame-hub/tools/`) | owner | owner | DAME - Tools (instructions: `docs/tiles/tools-project-instructions.md`) | vendored SheetJS + pdf.js (reviewed, no network) | built 2026-11-04; register + switch on |
| `hvac-notes` | HVAC Notes | `hvac-notes` (public, code only); old repo `HVAC` deleted after cut-over | owner | owner | DAME - HVAC Notes (was "HVAC Engineering") | YouTube player (`docs/SECURITY.md` 4), 2026-11-04 | repo created, tile on 2026-11-04; phase 1 pushed (reader, publish page) |
| `projects` | Projects | `projects` (public, code only); source: Thinkneering Projects tool, moved as it is | owner | owner | DAME - Projects (instructions: `docs/tiles/projects-project-instructions.md`; chats `DAME-PROJECTS`) | vendored pdf.js (as Tools) | registered 2026-11-04, **off** until step 1 (project register) is checked |
| `maps` | Maps | `maps` (public, code only); source: Thinkneering Maps tool, moved and improved (knowledge, piping, wiring) | owner | owner | DAME - Maps (instructions: `docs/tiles/maps-project-instructions.md`; chats `DAME-MAPS`) | - | registered 2026-11-05 (repo created, empty), **off** until step 1 is checked; colour rose, icon `map` |

## Source repos
Private repos holding a tile's authoring copy (`docs/NEW-TILE.md`, "Bringing an existing site in"). Pages always off; the site never reads them.
| Repo | Tile | People |
|---|---|---|
| (none) | | |

## Collaborators
| Repo | People |
|---|---|
| `dame-hub` | owner only, always |
| `hvac-notes` | owner only |
| `projects` | owner only |
| `maps` | owner only |
