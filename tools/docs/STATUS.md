# Tools tile status

## Built
- 2026-11-04 - home page and four tools (parts extractor, coil data extractor, container calculator, psychrometric chart) brought over from QuickTools / Thinkneering; CSP-clean (no inline scripts, no style attributes, no outside code; SheetJS and pdf.js vendored). Covered by `dev/test/e2e.mjs` (home + every page at 1100 px and 390 px, topbar, accent, refusal without the tile).

- 2026-11-06 - TILE-CHANGES of 2026-11-06 applied. Foundations: read; what F14/F19/F20/F21 mean here is in `TILE.md` Decisions (all "none"); one site-wide need raised in `CORE-REQUESTS.md` (watch of vendored libraries). Access model: `TILE.md` "Who can do what" replaces "Rights" (read only, declared by core 011, already live); no code or SQL change.

## SQL
None. The tile has no schema.

## Next
- Owner: register the tile in Admin > Tiles (id `tools`, no rights) if not done, pick its colour, switch it on, give access.
- Owner: Admin > Tiles > Tools > Access: check everyone given the tile shows level Read (011 set it).
- Tile: harden the vendored libraries (see `CORE-REQUESTS.md`): `isEvalSupported: false` in the coil extractor's `getDocument` call now; replace SheetJS 0.18.5 with 0.20.3 and pdf.js 3.11.174 with a 4.x build, after checking they make no network calls.
- Owner: try each tool once with a real file on the live site, day and night, laptop and phone, and say what should change.
