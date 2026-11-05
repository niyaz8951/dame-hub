# DAME - HVAC Notes

## What this project is
The **HVAC Notes** tile of DAME, the internal team site at `https://niyaz8951.github.io/dame-hub/`.
Tile id `hvac-notes` - repo `niyaz8951/hvac-notes` - address `https://niyaz8951.github.io/hvac-notes/` (served at `/hvac-notes/`) - schema `hvac_notes` - functions `public.hvac_notes_*` - private bucket `hvac-notes`.
What it does: a reading app for HVAC product and engineering notes. It has five notebooks (Theory, Chillers, AHU, FCU, Systems) and a Books shelf (ASHRAE Handbook - Fundamentals), with search, terms, standards, troubleshooting, self-check questions and a timeline.
Team: owner (Niyaz). Tile admin: owner.
No source repo: Supabase is the only home of the content. The old site's repo `niyaz8951/HVAC` is read only to carry the code and the pages over, and is **deleted** after cut-over (owner decision 2026-11-04).

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
- Work only in `niyaz8951/hvac-notes` (and read `niyaz8951/HVAC` until it is deleted), schema `hvac_notes`, functions `public.hvac_notes_*`, bucket `hvac-notes`.
- `hvac-notes` is public, history included: no page text, image, index, note, key, password or real file in it, ever. Only code, plus invented examples for testing. Real content lives only in Supabase.
- Never change the admin repo, `core/v1`, the `core` schema, or another tile. A need from the core goes in `docs/CORE-REQUESTS.md`; work around it meanwhile.
- Login, users, roles, theme and file access come only from the core, loaded from `/dame-hub/core/v1/`.
- Never write the GitHub account name or a full site URL in code or data; use root-relative paths (`/dame-hub/...`, `/hvac-notes/...`), so the tile survives a move to another account.
- No AI features for now. Nothing is imported from earlier sites unless the owner decided it for this tile (see Tile decisions).
- SQL files go to the owner, who reads and applies them. Never ask for or accept the Supabase secret key or database password.

## Tile decisions
- 2026-11-04 (owner): **colours stay as they are.** HVAC Notes keeps its current look (blue tile accent; notebook covers Chillers blue / AHU green / FCU orange / Theory violet). Core change `007_tile_accent`: covers and any coloured element use `data-accent="<name>"` and the `--accent-*` tokens instead of own colour values; no visible change. Other tiles will try other accents later.
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
- **Export** (same page, right `edit`): *Download all pages* gives a zip of `src/` (Markdown, `nav.json`, images) exactly as published. It is the authoring copy for changes and the backup.
- **Shared highlights and notes** (owner, 2026-11-04). Everyone with the tile sees every highlight and note, with the author's current name from `core.display_names('hvac-notes', ids)` (called inside the tile's functions; never store or show the email). Only the author edits or deletes his own; the tile admin and the super user may delete any (audited with `core.audit`). Reading positions stay private to each user. Nothing is kept on the device.
- **Online only.** No service worker caches content, and nothing internal goes in `localStorage` or IndexedDB. Only view settings (theme, font, size) are kept, under keys starting `dame.hvac-notes.`. The old site's manifest, service worker and app icons are dropped: the one installed app is defined in `dame-hub` and the tile opens inside it (`docs/STANDARDS.md` section 12).
- **Widgets.** The interactive explorers in `content/*/widgets/*.js` become tile code in `assets/js/widgets/`, which is public. Any Daikin-specific figures inside them (capacities, clearances, factors) move to Supabase data, and the widget reads them through a function.
- **YouTube.** A video link shows as a card that opens YouTube in a new tab. No iframe.
- **Writing notes after the move.** Same format as before (`src/<section>/<slug>.md`, `nav.json`, images). Claude writes new or changed pages and sends them as a zip in the chat. To change existing pages, the owner first attaches the export zip (or the pages concerned). The owner uploads on the Publish page. Page text never goes into any repo.
- **Tools.** `lint.mjs`, `indexer.js`, the page template and the growth logic move into `hvac-notes` as code (they hold no content), so the Publish page and Claude use the same rules. `seal.mjs`, `gate.js`, the keyring and the encryption are dropped.
- **`HVAC` until deletion.** It stays exactly as it is, encrypted, so the current site keeps running until cut-over. Nothing is pushed to it any more.
- **Cut-over order** (`docs/NEW-TILE.md`, step 5): build and test the tile, publish all pages, give access, switch the tile on. Then the owner keeps two offline backups (the tile's *Download all pages* zip, and GitHub **Code > Download ZIP** of `HVAC`), turns off Pages on `HVAC` and **deletes** the repo (Settings > Danger zone). Deleting cannot be undone; do it only after the owner confirms that every page, image and widget works on the tile.
- **Writing rules.** Everything the old project said about how pages are written (structure, Sources, `[^n]` references, callouts, deeper sections, In the field, symptom cards, check questions, images and credits) still applies to the content, unchanged.

## Delivery
Push (or zip) + the SQL files in order + the security-check step + update `docs/STATUS.md`.

## How to work with the owner and the team
Short, plain wording. Show a result rather than a list of questions; ask only when a wrong guess is costly (data, permissions, security). Logic beats literal wording. Check engineering and logic, even in material supplied by the team.

Chats that start with **HVAC-NOTES** continue from `docs/STATUS.md`.
