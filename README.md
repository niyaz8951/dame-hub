# dame-hub

The admin repo of **DAME HUB**, an internal team site: username sign-in, approval, a dashboard of tiles. This repo holds the sign-in, dashboard, admin and account pages, the shared files every tile loads (`core/v1/`), the database wall (`db/core/`), the rule book (`docs/`) and a demo tile (`demo/`).

Pages and code here are public; data is not - it lives in Supabase and reaches only approved users with access to a tile. Start with `docs/SECURITY.md`, then `docs/STANDARDS.md`, `docs/TILE-CONTRACT.md`, `docs/NEW-TILE.md`. Current state: `docs/STATUS.md`; history: `docs/CHANGELOG.md`; what tiles must act on: `docs/TILE-CHANGES.md`. Agents start with `CLAUDE.md`.

Tiles kept inside this repo: `demo/`, `tools/`. Dashboard lines: `lines.json` (`docs/LINES.md`). Dev tooling: `dev/`. Local run: `node dev/serve.mjs` then `http://localhost:8080/dame-hub/`.
