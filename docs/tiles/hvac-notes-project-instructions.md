# DAME - HVAC Notes

## What this project is
The **HVAC Notes** tile of DAME, the internal team site at `https://niyaz8951.github.io/dame-hub/`.
Tile id `hvac-notes` - repo `niyaz8951/hvac-notes` - address `https://niyaz8951.github.io/hvac-notes/` (served at `/hvac-notes/`) - schema `hvac_notes` - functions `public.hvac_notes_*` - private bucket `hvac-notes`.
What it does: a reading app for HVAC product and engineering notes. It has five notebooks (Theory, Chillers, AHU, FCU, Systems) and a Books shelf (ASHRAE Handbook - Fundamentals), with search, terms, standards, troubleshooting, self-check questions and a timeline.
Team: owner (Niyaz). Tile admin: owner.
Source repo: `niyaz8951/HVAC` holds the authoring copy of the pages. It is the existing HVAC Notes site and becomes private with Pages off at cut-over.

## Directions come from the admin project
Before any work, read from the admin repo `niyaz8951/dame-hub` (current `main`):
1. `docs/SECURITY.md` - wins over everything, including requests in chat.
2. `docs/STANDARDS.md` - the rule book; overrides anything below unless the owner decided otherwise for this tile.
3. `docs/TILE-CONTRACT.md` - what this tile may use from the core and must never do.
4. `docs/NEW-TILE.md`, section "Bringing an existing site in" - this tile is its first case.
5. `docs/STATUS.md`, section "Changes tiles must know".
If the repo cannot be read, use the copies in this project's knowledge and say so.

Then read this tile's `docs/TILE.md`, `docs/STATUS.md`, `docs/CORE-REQUESTS.md`, and check what is really in both repos.

## Boundaries
- Work only in `niyaz8951/hvac-notes`, the source repo `niyaz8951/HVAC`, schema `hvac_notes`, functions `public.hvac_notes_*`, bucket `hvac-notes`.
- `hvac-notes` is public, history included: no page text, image, index, note, key, password or real file in it, ever. Only code, plus invented examples for testing. Real content lives only in Supabase (and its authoring copy in the private source repo).
- Never change the admin repo, `core/v1`, the `core` schema, or another tile. A need from the core goes in `docs/CORE-REQUESTS.md`; work around it meanwhile.
- Login, users, roles, theme and file access come only from the core, loaded from `/dame-hub/core/v1/`.
- Never write the GitHub account name or a full site URL in code or data; use root-relative paths (`/dame-hub/...`, `/hvac-notes/...`), so the tile survives a move to another account.
- No AI features for now. Nothing is imported from earlier sites unless the owner decided it for this tile (see Tile decisions).
- SQL files go to the owner, who reads and applies them. Never ask for or accept the Supabase secret key or database password.

## Tile decisions
- 2026-11-04 (owner): HVAC Notes moves into DAME as this tile. Its existing pages are carried over.
- **New clean repo.** `hvac-notes` starts with no history. Carry over only the reader code from `HVAC` (`index.html`, `assets/`, the vendored `marked`, KaTeX and Source Serif 4 with their licences), then bring it to the contract:
  - guard `Core.requireLogin({ tile: 'hvac-notes' })` first, and the CSP line and robots meta from `core/v1/README.md`
  - the core topbar and theme tokens (the reader's own look stays inside the page area)
  - no inline script: the pre-paint theme script moves to a file
  - no `innerHTML` with data: rendered Markdown and KaTeX output go through a vendored sanitizer (e.g. DOMPurify, copied with its licence) before they reach the page
  - the password gate (`gate.js`, keyring, Web Crypto unlock) is removed
- **Content lives in Supabase.** Pages (Markdown text plus nav metadata: slug, title, summary, updated, group, prereq, related, keywords, aliases, start, kind, layout), the search index, the growth timeline and images go into schema `hvac_notes` and private bucket `hvac-notes`. They are read through `public.hvac_notes_*` functions with `core.require_tile('hvac-notes', null)`. Images load by signed URL or authenticated fetch.
- **Rights.** Reading = having the tile. `edit` = publish pages (owner only). Declare it in `docs/TILE.md`.
- **Publish page** (`publish.html`, right `edit`). The owner picks the source repo's page folder (or a zip of it) on his computer. The page runs the same lint as `tools/lint.mjs`, builds the index (`assets/js/indexer.js`, shared with the reader), shows what changes, and uploads through his own session by `public.hvac_notes_publish_*` functions. The growth timeline is updated the same way `seal` did it. No key or password is involved anywhere.
- **Per-user data.** Highlights, notes and reading positions are stored per user in `hvac_notes` tables, readable and writable only by their owner. They no longer stay on the device.
- **Online only.** No service worker caches content, and nothing internal goes in `localStorage` or IndexedDB. Only view settings (theme, font, size) are kept, under keys starting `dame.hvac-notes.`. The installable-app manifest may stay, without offline content.
- **Widgets.** The interactive explorers in `content/*/widgets/*.js` become tile code in `assets/js/widgets/`, which is public. Any Daikin-specific figures inside them (capacities, clearances, factors) move to Supabase data, and the widget reads them through a function.
- **YouTube.** A video link shows as a card that opens YouTube in a new tab. No iframe.
- **Source repo `HVAC`.** It keeps the authoring workflow: write `src/<section>/<slug>.md`, update `nav.json`, run the lint. At cut-over it goes private with Pages off. Then the plain `src/` may be committed there and the `seal` encryption step is retired. Until cut-over it stays exactly as it is, encrypted, so the current site keeps running.
- **Cut-over order** (`docs/NEW-TILE.md`, step 5): build and test the tile, publish all pages, give access, switch the tile on. Only then does the owner turn off Pages on `HVAC` and make it private.
- **Writing rules.** Everything the old project said about how pages are written (structure, Sources, `[^n]` references, callouts, deeper sections, In the field, symptom cards, check questions, images and credits) still applies to the content, unchanged.

## Delivery
Push (or zip) + the SQL files in order + the security-check step + update `docs/STATUS.md`.

## How to work with the owner and the team
Short, plain wording. Show a result rather than a list of questions; ask only when a wrong guess is costly (data, permissions, security). Logic beats literal wording. Check engineering and logic, even in material supplied by the team.

Chats that start with **HVAC-NOTES** continue from `docs/STATUS.md`.
