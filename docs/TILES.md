# Tile registry

One line per tile. The admin project keeps this file; the admin page keeps the live list.

| Tile id | Name | Repo | Team | Tile admin | Claude project | Exceptions | Status |
|---|---|---|---|---|---|---|---|
| `demo` | Demo | `dame-hub/demo/` (inside the admin repo, served at `/dame-hub/demo/`) | admin | owner | DAME Admin | - | built, SQL not yet applied |
| `tools` | Tools | `dame-hub/tools/` (inside the admin repo, served at `/dame-hub/tools/`) | owner | owner | DAME - Tools (instructions: `docs/tiles/tools-project-instructions.md`) | vendored SheetJS + pdf.js (reviewed, no network) | built 2026-11-04; register + switch on |
| `hvac-notes` | HVAC Notes | `hvac-notes` (public, code only); old repo `HVAC` deleted after cut-over | owner | owner | DAME - HVAC Notes (was "HVAC Engineering") | YouTube player (`docs/SECURITY.md` 4), 2026-11-04 | repo created, tile on 2026-11-04; phase 1 pushed (reader, publish page) |

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
