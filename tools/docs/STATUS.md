# Tools tile status

## Built
- 2026-11-04 - home page and four tools (parts extractor, coil data extractor, container calculator, psychrometric chart) brought over from QuickTools / Thinkneering; CSP-clean (no inline scripts, no style attributes, no outside code; SheetJS and pdf.js vendored). Covered by `dev/test/e2e.mjs` (home + every page at 1100 px and 390 px, topbar, accent, refusal without the tile).

## SQL
None. The tile has no schema.

## Next
- Owner: register the tile in Admin > Tiles (id `tools`, no rights) if not done, pick its colour, switch it on, give access.
- Owner: try each tool once with a real file on the live site, day and night, laptop and phone, and say what should change.
